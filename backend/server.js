// server.js (ESM)
// Основной серверный файл — Express API + инициализация Firebase admin + подключение middleware авторизации.

// ===================== Импорты =====================
import express from 'express';      // Web-фреймворк для создания API
import cors from 'cors';            // CORS — чтобы фронтенд мог обращаться к серверу
import dotenv from 'dotenv';        // Загрузка переменных окружения из .env
import path from 'path';            // Работа с путями
import { fileURLToPath } from 'url';// Получение __dirname в ESM
import admin from 'firebase-admin'; // Firebase Admin SDK
import fs from 'fs';                // Работа с файловой системой
import { registerSyncRoutes } from './routes/sync.js';
import { registerNotesRoutes } from './routes/notes.js'; 

// Загружаем переменные окружения
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================== Firebase =====================
// Пробуем инициализировать Firebase Admin SDK, если есть ключ
let firestore = null;
try {
  const keyPath = path.join(__dirname, 'firebase-key.json');
  if (fs.existsSync(keyPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firestore = admin.firestore();
    console.log('[Firebase] Инициализация прошла успешно, Firestore доступен');
  } else {
    console.log('[Firebase] Файл firebase-key.json не найден — сервер запускается без Firestore');
  }
} catch (err) {
  console.warn('[Firebase] Ошибка инициализации Firestore. Работаем без него. Причина:', err && err.message);
  firestore = null;
}

// ===================== Middleware =====================
// Импортируем middleware авторизации (после инициализации admin, чтобы verifyIdToken работал)
const { authMiddleware } = await import('./middleware/auth.js');

// ===================== Адаптеры хранения =====================
// DualAdapter — умеет писать и в SQLite, и в файлы
const DualAdapterModule = await import('./adapters/dualAdapter.js');
const adapter = DualAdapterModule;

// ===================== Express =====================
const app = express();
const PORT = process.env.PORT || 3001;
const STORAGE = (process.env.STORAGE || 'file').toLowerCase();

// Подключаем middleware
app.use(cors());
app.use(express.json());

// ===================== Инициализация адаптера =====================
try {
  await adapter.init(path.join(__dirname, 'data'));
  console.log('[Server] Хранилище инициализировано (SQLite + файлы; Firestore синхронизация может быть включена)');
} catch (err) {
  console.error('[Server] Ошибка инициализации адаптера:', err && err.message);
  process.exit(1);
}


// ===================== Middleware авторизации =====================
// Защищаем маршруты /notes и /sync
app.use('/notes', authMiddleware);
app.use('/sync', authMiddleware);

// // ===================== Notes API =====================


// --- Routes ---
app.use('/notes', registerNotesRoutes(DualAdapterModule));
app.use('/sync', registerSyncRoutes(DualAdapterModule));



// ===================== Запуск сервера =====================
app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}  (режим хранения STORAGE=${STORAGE})`);
  if (!firestore) console.log('[Server] Firestore отключён — облачная синхронизация недоступна');
});


// 🔹 2. Методы /sync

// Эти методы нужны для синхронизации между устройствами и для работы в оффлайне.

// Почему это важно?

// Если приложение будет использовать только /notes, то при отсутствии интернета пользователь не сможет ничего сохранить.
// А /sync позволяет:

// Работать оффлайн (сохранять в SQLite/файлы).

// Потом при появлении интернета отправить все изменения на сервер.

// Получить изменения с сервера (например, если пользователь редактировал заметки на другом устройстве).


// Методы:

// POST /sync/push
// Клиент отправляет на сервер свои локальные изменения (новые заметки, правки, удаление).
// Сервер проверяет:

// кому принадлежит заметка (uid),

// что версия свежая (updatedAt),

// и либо сохраняет, либо игнорирует.

// ➡️ Пример:

// Ты была оффлайн, создала заметку "Совещание".

// Через час появился интернет.

// Приложение делает POST /sync/push → сервер принял заметку → теперь она доступна на всех устройствах.

// GET /sync/pull?lastSync=...
// Клиент спрашивает у сервера: "Какие заметки изменились после моего последнего сеанса?".
// Сервер возвращает только новые или обновлённые заметки.

// ➡️ Пример:

// Ты на телефоне создала заметку "Доклад".

// Потом на ноутбуке открылось приложение → оно делает GET /sync/pull?lastSync=1696000000.

// Сервер возвращает новую заметку "Доклад".

// Теперь на ноутбуке список заметок синхронизирован.