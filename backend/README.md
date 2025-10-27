notesapp_bundle/
├─ mobile/                      # фронтенд (Expo React Native)
│  ├─ App.js
│  ├─ package.json
│  └─ src/
│     ├─ screens/
│     ├─ components/
│     └─ services/
└─ backend/                     # бэкенд (Node.js + Express)
├── adapters/
│   └── dualAdapter.js
├── middleware/
│   └── auth.js
├── routes/
│   ├── notes.js       ← сюда вынесем /notes
│   └── sync.js        ← сюда вынесем /sync
├── server.js          ← только инициализация, app.use() и запуск
├── firebase-key.json
└── data/


Из каких технологий состоит бэкенд

Node.js — среда выполнения JavaScript на сервере.

ECMAScript Modules (ESM) — проект настроен как ESM ("type": "module" в package.json).

Express — веб-фреймворк для создания REST API.

SQLite (опция) — для серверного хранения заметок в реляционной базе (используются пакеты sqlite3 и sqlite).

Файловая система (опция) — хранение заметок как JSON-файлов в каталоге backend/data/notes_files/.

nanoid — генерация уникальных id для заметок.

dotenv — (опционально) загрузка переменных окружения из .env.

CORS & body-parser — для обработки запросов от мобильного клиента.

Что делает бэкенд (кратко)

Предоставляет REST API для CRUD операций над заметками:

создание, чтение, обновление, мягкое удаление;

поиск по ключевым словам, дате, времени, тегам;

Поддерживает два варианта хранения данных на сервере:

файловое хранилище (file) — JSON-файлы: backend/data/notes_files/{id}.json;

SQLite (sqlite) — файл БД: backend/data/notes.db.

Реализует простую стратегию синхронизации:

POST /sync/push — клиент отправляет свои изменения;

GET /sync/pull?lastSync=<ms> — клиент запрашивает изменения с сервера.

Конфликты решаются политикой last-write-wins по полю updatedAt.

Основные файлы (backend)

server.js — основной сервер, маршруты API и логика выборки/фильтрации.

adapters/fileAdapter.js — реализация CRUD и поиска на основе файловой системы.

adapters/sqliteAdapter.js — реализация CRUD и поиска через SQLite.

data/ — папка, где создаются:

notes_files/ (если STORAGE=file) — JSON-файлы заметок;

notes.db (если STORAGE=sqlite) — файл SQLite.

package.json — зависимости, скрипты и "type": "module".



1. Положи service account JSON в backend/firebase-key.json (или установи GOOGLE_APPLICATION_CREDENTIALS)
2. Включи Cloud Firestore в Firebase Console (Firestore Database → Create database)
3. Убедись, что Cloud Firestore API включён: https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=<PROJECT_ID>
4. Запусти сервер: node server.js
5. Проверь лог — должен быть: [Firebase] initialized, Firestore available
6. Создай тестовую заметку: POST /notes
7. Проверь Firestore Console → Data → коллекция `notes`
8. Проверь SQLite (backend/data/notes.db) и JSON-файлы (backend/data/notes_files)
