// adapters/dualAdapter.js
// 🔄 DualAdapter — комбинированный адаптер для работы с заметками.
// Основная база — локальная SQLite (быстрая работа + оффлайн).
// Дополнительно делаем копию заметок в файлах (FileAdapter).
// Если Firestore инициализирован (админ доступен) — включается облачная синхронизация.

import * as SqliteAdapter from './sqliteAdapter.js';
import * as FileAdapter from './fileAdapter.js';
import admin from 'firebase-admin';

// =============================
// Вспомогательная функция для получения Firestore.
// Если admin ещё не инициализирован — возвращаем null.
// =============================
function getFirestoreSafe() {
  try {
    return admin.firestore();
  } catch (e) {
    return null;
  }
}

// =============================
// Фильтрация заметок (унифицированная логика).
// Используется для поиска как по локальной БД, так и по Firestore.
// =============================
function matchesFilters(note, filters = {}) {
  if (!filters.includeDeleted && note.isDeleted) return false;
  if (filters.uid && note.uid !== filters.uid) return false;

  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    if (
      !(
        ((note.title || '').toLowerCase().includes(q)) ||
        ((note.body || '').toLowerCase().includes(q))
      )
    ) return false;
  }

  if (filters.updatedAfter && Number(note.updatedAt || 0) <= Number(filters.updatedAfter)) return false;
  if (filters.dateFrom && !(note.date && Number(note.date) >= Number(filters.dateFrom))) return false;
  if (filters.dateTo && !(note.date && Number(note.date) <= Number(filters.dateTo))) return false;
  if (filters.time && note.time !== filters.time) return false;

  if (Array.isArray(filters.tags) && filters.tags.length) {
    if (!Array.isArray(note.tags)) return false;
    for (const t of filters.tags) {
      if (!note.tags.includes(t)) return false;
    }
  }
  return true;
}

// =============================
// Инициализация адаптера.
// 1. Инициализируем SQLite и файловый адаптер.
// 2. Проверяем доступность Firestore.
// =============================
export async function init(basePath) {
  await SqliteAdapter.init(basePath);
  await FileAdapter.init(basePath);

  const firestore = getFirestoreSafe();
  if (firestore) {
    console.log('[DualAdapter] Firestore доступен — облачная синхронизация включена');
  } else {
    console.log('[DualAdapter] Firestore недоступен — работаем только локально');
  }
}

// =============================
// Получение заметки по id.
// 1. Сначала пробуем достать из локальной SQLite.
// 2. Если нет — пробуем из Firestore.
// 3. Если нашли в Firestore — кешируем локально (SQLite + File).
// =============================
export async function get(id) {
  const local = await SqliteAdapter.get(id);
  if (local) return local;

  const firestore = getFirestoreSafe();
  if (!firestore) return null;

  try {
    const snap = await firestore.collection('notes').doc(id).get();
    if (!snap.exists) return null;

    const note = snap.data();
    // Кешируем заметку локально
    try {
      await SqliteAdapter.upsert(note);
      await FileAdapter.upsert(note);
      console.log(`[DualAdapter] Заметка ${id} загружена из Firestore и сохранена локально`);
    } catch (e) {
      console.warn(`[DualAdapter] Ошибка при кешировании заметки ${id} локально:`, e && e.message);
    }
    return note;
  } catch (e) {
    console.error('[DualAdapter][get] Ошибка Firestore:', e && e.message);
    return null;
  }
}

// =============================
// Сохранение/обновление заметки (upsert).
// 1. Сохраняем в SQLite и файлы.
// 2. Если Firestore доступен — пушим туда.
// =============================
export async function upsert(note) {
  // Локальное сохранение обязательно
  await Promise.all([
    SqliteAdapter.upsert(note),
    FileAdapter.upsert(note)
  ]);

  const firestore = getFirestoreSafe();
  if (!firestore) {
    console.log(`[DualAdapter] Firestore недоступен — заметка ${note.id} сохранена только локально`);
    return;
  }

  try {
    // В Firestore обязательно наличие uid (привязка к пользователю)
    await firestore.collection('notes').doc(note.id).set(note, { merge: true });
    console.log(`[DualAdapter] Заметка ${note.id} синхронизирована с Firestore`);
  } catch (e) {
    console.error(`[DualAdapter] Ошибка при сохранении заметки ${note.id} в Firestore:`, e && e.message);
  }
}

// =============================
// Поиск заметок по фильтрам.
// 1. Достаём из SQLite (быстро, оффлайн).
// 2. Если Firestore доступен — подгружаем заметки оттуда (по uid).
// 3. Объединяем списки (локальные имеют приоритет).
// 4. Новые из Firestore — кешируем локально.
// =============================
export async function find(filters = {}) {
  // Локальные заметки
  const localNotes = await SqliteAdapter.find(filters);

  const firestore = getFirestoreSafe();
  if (!firestore) {
    return localNotes;
  }

  try {
    let q = firestore.collection('notes');
    if (filters.uid) q = q.where('uid', '==', filters.uid);

    const snap = await q.get();
    const remoteNotes = snap.docs.map(d => d.data());

    // Применяем фильтры на клиенте (чтобы не усложнять Firestore-запрос)
    const filteredRemote = remoteNotes.filter(n => matchesFilters(n, filters));

    // Объединение локальных и удалённых заметок
    const mapLocal = new Set(localNotes.map(n => n.id));
    const merged = [...localNotes];

    for (const rn of filteredRemote) {
      if (!mapLocal.has(rn.id)) {
        merged.push(rn);
        // Кешируем новые заметки из Firestore
        try {
          await SqliteAdapter.upsert(rn);
          await FileAdapter.upsert(rn);
          console.log(`[DualAdapter] Заметка ${rn.id} загружена из Firestore и сохранена локально`);
        } catch (e) {
          console.warn(`[DualAdapter] Ошибка кеширования заметки ${rn.id} во время поиска:`, e && e.message);
        }
      }
    }

    // Сортируем по дате обновления
    merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return merged;
  } catch (e) {
    console.error('[DualAdapter] Ошибка при получении заметок из Firestore:', e && e.message);
    return localNotes;
  }
}
