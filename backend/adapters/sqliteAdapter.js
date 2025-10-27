// adapters/sqliteAdapter.js
// ========================
// SQLite адаптер для хранения заметок.
// Особенности:
//   - хранит все заметки в notes.db;
//   - поддерживает колонку uid (идентификатор владельца);
//   - имеет методы init, get, upsert, find;
//   - логирует SQL-запросы для отладки;
//   - умеет фильтровать по uid (multi-user режим);
//   - умеет фильтровать по датам, тегам, строке поиска;
//   - работает через промисы (sqlite wrapper).

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs/promises';

let db = null;
let DB_PATH = null;

// === Инициализация базы ===
export async function init(basePath){
  // создаём директорию для базы, если нет
  await fs.mkdir(basePath, { recursive: true });
  DB_PATH = path.join(basePath, 'notes.db');
  // открываем базу
  db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  console.log('[SQL][init] SQLite DB path:', DB_PATH);

  // создаём таблицу, если нет
  // Колонка uid = "владелец заметки" (Firebase user.uid)
  const createSql = `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    uid TEXT,                -- ← ключ пользователя
    title TEXT,
    body TEXT,
    createdAt INTEGER,
    updatedAt INTEGER,
    date INTEGER,
    time TEXT,
    tags TEXT,
    isDeleted INTEGER DEFAULT 0
  );`;
  await db.exec(createSql);
}

// === Получить заметку по id ===
export async function get(id){
  const sql = 'SELECT * FROM notes WHERE id = ?';
  const params = [id];
  console.log('[SQL][get] ', sql, params);
  try {
    const row = await db.get(sql, ...params);
    if(!row) return null;
    // преобразуем флаги и JSON-поля
    return { ...row, tags: row.tags ? JSON.parse(row.tags) : [], isDeleted: !!row.isDeleted };
  } catch(err){
    console.error('[SQL][get][ERROR]', err, sql, params);
    throw err;
  }
}

// === Вставка или обновление заметки ===
export async function upsert(note){
  // note.uid обязателен, чтобы понимать владельца
  const existing = await get(note.id);
  const tagsTxt = JSON.stringify(note.tags || []);
  if(existing){
    // Обновляем существующую запись
    const sql = `UPDATE notes 
                 SET uid=?, title=?, body=?, createdAt=?, updatedAt=?, date=?, time=?, tags=?, isDeleted=? 
                 WHERE id=?`;
    const params = [
      note.uid || null,
      note.title,
      note.body,
      note.createdAt,
      note.updatedAt,
      note.date,
      note.time,
      tagsTxt,
      note.isDeleted ? 1 : 0,
      note.id
    ];
    console.log('[SQL][upsert][UPDATE] ', sql, params);
    try {
      await db.run(sql, ...params);
    } catch(err){
      console.error('[SQL][upsert][UPDATE][ERROR]', err, sql, params);
      throw err;
    }
  } else {
    // Вставляем новую запись
    const sql = `INSERT INTO notes 
                 (id, uid, title, body, createdAt, updatedAt, date, time, tags, isDeleted) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
      note.id,
      note.uid || null,
      note.title,
      note.body,
      note.createdAt,
      note.updatedAt,
      note.date,
      note.time,
      tagsTxt,
      note.isDeleted ? 1 : 0
    ];
    console.log('[SQL][upsert][INSERT] ', sql, params);
    try {
      await db.run(sql, ...params);
    } catch(err){
      console.error('[SQL][upsert][INSERT][ERROR]', err, sql, params);
      throw err;
    }
  }
}

// === Поиск заметок по фильтрам ===
export async function find(filters = {}){
  const where = [];
  const params = [];

  // 🔑 если задан uid — ищем только заметки конкретного пользователя
  if(filters.uid){
    where.push('uid = ?');
    params.push(filters.uid);
  }

  // исключаем удалённые по умолчанию
  if(!filters.includeDeleted) {
    where.push('isDeleted = 0');
  }

  // поиск по тексту
  if(filters.q){
    where.push('(LOWER(title) LIKE ? OR LOWER(body) LIKE ?)');
    params.push(`%${String(filters.q).toLowerCase()}%`, `%${String(filters.q).toLowerCase()}%`);
  }

  // фильтрация по обновлению
  if(filters.updatedAfter){
    where.push('updatedAt > ?'); params.push(filters.updatedAfter);
  }

  // фильтрация по датам
  if(filters.dateFrom){
    where.push('date >= ?'); params.push(filters.dateFrom);
  }
  if(filters.dateTo){
    where.push('date <= ?'); params.push(filters.dateTo);
  }

  // фильтр по времени
  if(filters.time){
    where.push('time = ?'); params.push(filters.time);
  }

  // фильтр по тегам (массив)
  if(Array.isArray(filters.tags) && filters.tags.length){
    filters.tags.forEach(t=>{
      where.push('tags LIKE ?'); params.push(`%\"${t}\"%`);
    });
  }

  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  const sql = `SELECT * FROM notes ${whereSql} ORDER BY updatedAt DESC`;
  console.log('[SQL][find] ', sql, params);
  try {
    const rows = await db.all(sql, ...params);
    return rows.map(r=> ({ ...r, tags: r.tags ? JSON.parse(r.tags) : [], isDeleted: !!r.isDeleted }) );
  } catch(err){
    console.error('[SQL][find][ERROR]', err, sql, params);
    throw err;
  }
}
