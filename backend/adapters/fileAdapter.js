// adapters/fileAdapter.js
// 📂 FileAdapter — файловый адаптер для заметок.
// Каждая заметка сохраняется как отдельный JSON-файл.
// Используется как дополнительный слой хранения (резервное копирование).
// Основная БД — SQLite, но файлы помогают при отладке и восстановлении данных.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DATA_DIR = null;

// =============================
// Инициализация файлового адаптера.
// Создаём директорию "notes_files" внутри basePath.
// =============================
export async function init(basePath) {
  DATA_DIR = path.join(basePath, 'notes_files');
  await fs.mkdir(DATA_DIR, { recursive: true });
  console.log(`[FileAdapter] Папка для заметок инициализирована: ${DATA_DIR}`);
}

// =============================
// Вспомогательная функция — путь к файлу заметки по её id.
// =============================
const filePathFor = (id) => path.join(DATA_DIR, `${id}.json`);

// =============================
// Получение заметки по id.
// Читаем JSON-файл и возвращаем объект.
// Если файла нет — возвращаем null.
// =============================
export async function get(id) {
  try {
    const txt = await fs.readFile(filePathFor(id), 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    console.warn(`[FileAdapter] Заметка ${id} не найдена в файловом хранилище`);
    return null;
  }
}

// =============================
// Сохранение или обновление заметки.
// Перезаписываем JSON-файл полностью.
// =============================
export async function upsert(note) {
  try {
    await fs.writeFile(
      filePathFor(note.id),
      JSON.stringify(note, null, 2),
      'utf8'
    );
    console.log(`[FileAdapter] Заметка ${note.id} сохранена в файл`);
  } catch (e) {
    console.error(`[FileAdapter] Ошибка при сохранении заметки ${note.id}:`, e && e.message);
  }
}

// =============================
// Поиск заметок с фильтрацией.
// 1. Загружаем все JSON-файлы.
// 2. Применяем фильтры (удалённые, uid, текстовый поиск, даты, теги).
// 3. Сортируем по updatedAt (сначала новые).
// =============================
export async function find(filters = {}) {
  filters = filters || {};
  const files = await fs.readdir(DATA_DIR);
  const notes = [];

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const txt = await fs.readFile(path.join(DATA_DIR, f), 'utf8');
      const note = JSON.parse(txt);
      notes.push(note);
    } catch (e) {
      console.warn(`[FileAdapter] Ошибка чтения файла ${f}:`, e && e.message);
    }
  }

  // Базовая фильтрация
  let result = notes.filter(n => filters.includeDeleted ? true : !n.isDeleted);

  // Фильтр по пользователю (uid)
  if (filters.uid) {
    result = result.filter(n => n.uid === filters.uid);
  }

  // Полнотекстовый поиск по title/body
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    result = result.filter(
      n => (n.title || '').toLowerCase().includes(q) ||
           (n.body || '').toLowerCase().includes(q)
    );
  }

  // Фильтры по датам
  if (filters.updatedAfter) result = result.filter(n => (n.updatedAt || 0) > filters.updatedAfter);
  if (filters.dateFrom) result = result.filter(n => n.date && n.date >= filters.dateFrom);
  if (filters.dateTo) result = result.filter(n => n.date && n.date <= filters.dateTo);

  // Фильтр по времени
  if (filters.time) result = result.filter(n => n.time === filters.time);

  // Фильтр по тегам
  if (Array.isArray(filters.tags) && filters.tags.length) {
    result = result.filter(n => Array.isArray(n.tags) && filters.tags.every(t => n.tags.includes(t)));
  }

  // Сортировка по updatedAt (новые сверху)
  result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  console.log(`[FileAdapter] Найдено заметок после фильтрации: ${result.length}`);
  return result;
}

// =============================
// Удаление файла заметки.
// (Используется редко, так как у нас soft-delete).
// =============================
export async function deleteFile(id) {
  try {
    await fs.unlink(filePathFor(id));
    console.log(`[FileAdapter] Заметка ${id} удалена из файлового хранилища`);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`[FileAdapter] Ошибка удаления файла заметки ${id}:`, e && e.message);
      throw e;
    }
  }
}
