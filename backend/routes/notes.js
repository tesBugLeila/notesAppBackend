// routes/notes.js
// Маршруты CRUD для заметок (/notes).
// Экспортирует функцию registerNotesRoutes(adapter), где adapter должен предоставлять
// методы: init(basePath), get(id), upsert(note), find(filters).
//
// Логика:
// - Все операции привязаны к текущему пользователю (req.user.uid) — проверяем право владения.
// - POST — создание/upsert заметки (uid берём из req.user).
// - PUT  — обновление (проверяем существование + владение).
// - DELETE — мягкое удаление (isDeleted = true).
// - GET / — поиск/фильтрация заметок (adapter.find поддерживает фильтры).
// - GET /:id — получить заметку по id (проверяем владение).
//
// Предполагается, что в server.js к роутам /notes применён authMiddleware,
// который кладёт decoded token в req.user (с полем uid).

import express from 'express';
import { nanoid } from 'nanoid';

export function registerNotesRoutes(adapter) {
  const router = express.Router();

  // Нормализация входных данных заметки и установка владельца (uid)
  function normalizeNoteInput(body, user) {
    return {
      id: body.id ?? nanoid(),
      uid: user?.uid ?? body.uid ?? null,
      title: body.title ?? '',
      body: body.body ?? '',
      createdAt: body.createdAt ?? Date.now(),
      updatedAt: body.updatedAt ?? Date.now(),
      date: body.date ?? null,
      time: body.time ?? null,
      tags: Array.isArray(body.tags)
        ? body.tags
        : (body.tags ? String(body.tags).split(',').map(t => t.trim()).filter(Boolean) : []),
      isDeleted: body.isDeleted ? true : false
    };
  }

  // -----------------------
  // GET /notes
  // Список заметок с фильтрами.
  // Фильтрация по uid выполняется на сервере — возвращаем только заметки пользователя.
  // Query params: q, dateFrom, dateTo, time, tags (csv), updatedAfter, includeDeleted
router.get('/', async (req, res) => {
  try {
    if (!req.user || !req.user.uid) {
      console.warn('[GET /notes] Отказано — пользователь не авторизован');
      return res.status(401).json({ error: 'unauthorized' });
    }

    const filters = {
      q: req.query.q,
  
      dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom + 'T00:00:00').getTime() : undefined,
      dateTo: req.query.dateTo ? new Date(req.query.dateTo + 'T23:59:59').getTime() : undefined,
      time: req.query.time,
      tags: req.query.tags ? String(req.query.tags).split(',').map(t => t.trim()).filter(Boolean) : undefined,
      updatedAfter: req.query.updatedAfter ? Number(req.query.updatedAfter) : undefined,
      includeDeleted: req.query.includeDeleted === '1' || req.query.includeDeleted === 'true',
      uid: req.user.uid
    };

    console.log(`[GET /notes] Пользователь ${req.user.uid} запрашивает заметки с фильтрами:`, {
      ...filters,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      dateFromTimestamp: filters.dateFrom,
      dateToTimestamp: filters.dateTo
    });

    const notes = await adapter.find(filters);
    console.log(`[GET /notes] Найдено заметок: ${notes.length}`);
    res.json(notes);
  } catch (e) {
    console.error('[GET /notes] Ошибка:', e && e.message);
    res.status(500).json({ error: 'server_error' });
  }
});
  // -----------------------
  // GET /notes/:id
  // Получить заметку по id — только если принадлежит текущему пользователю
  router.get('/:id', async (req, res) => {
    try {
      if (!req.user || !req.user.uid) {
        console.warn('[GET /notes/:id] Отказано — пользователь не авторизован');
        return res.status(401).json({ error: 'unauthorized' });
      }

      const id = req.params.id;
      const note = await adapter.get(id);
      if (!note) {
        console.log(`[GET /notes/:id] Заметка ${id} не найдена`);
        return res.status(404).json({ error: 'not_found' });
      }

      if (note.uid !== req.user.uid) {
        console.warn(`[GET /notes/:id] Доступ к заметке ${id} запрещён — не принадлежит пользователю ${req.user.uid}`);
        return res.status(403).json({ error: 'forbidden' });
      }

      console.log(`[GET /notes/:id] Пользователь ${req.user.uid} запросил заметку ${id}`);
      res.json(note);
    } catch (e) {
      console.error('[GET /notes/:id] Ошибка:', e && e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------
  // POST /notes
  // Создать новую заметку или upsert (если пришёл id) — устанавливаем uid из req.user
  router.post('/', async (req, res) => {
    try {
      if (!req.user || !req.user.uid) {
        console.warn('[POST /notes] Отказано — пользователь не авторизован');
        return res.status(401).json({ error: 'unauthorized' });
      }

      const note = normalizeNoteInput(req.body, req.user);
      await adapter.upsert(note);
      console.log(`[POST /notes] Пользователь ${req.user.uid} создал/синхронизировал заметку ${note.id}`);
      res.status(201).json(note);
    } catch (e) {
      console.error('[POST /notes] Ошибка:', e && e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------
  // PUT /notes/:id
  // Обновление заметки — проверяем существование и владение
  router.put('/:id', async (req, res) => {
    try {
      if (!req.user || !req.user.uid) {
        console.warn('[PUT /notes/:id] Отказано — пользователь не авторизован');
        return res.status(401).json({ error: 'unauthorized' });
      }

      const id = req.params.id;
      const existing = await adapter.get(id);
      if (!existing) {
        console.log(`[PUT /notes/:id] Заметка ${id} не найдена`);
        return res.status(404).json({ error: 'not_found' });
      }

      if (existing.uid !== req.user.uid) {
        console.warn(`[PUT /notes/:id] Доступ к заметке ${id} запрещён — не принадлежит пользователю ${req.user.uid}`);
        return res.status(403).json({ error: 'forbidden' });
      }

      // Мержим существующую заметку с присланными полями, сохраняем uid и updatedAt
      const merged = {
        ...existing,
        ...req.body,
        id,
        uid: req.user.uid,
        updatedAt: Date.now()
      };

      await adapter.upsert(merged);
      console.log(`[PUT /notes/:id] Пользователь ${req.user.uid} обновил заметку ${id}`);
      res.json(merged);
    } catch (e) {
      console.error('[PUT /notes/:id] Ошибка:', e && e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // -----------------------
  // DELETE /notes/:id
  // Мягкое удаление: помечаем isDeleted = true и обновляем updatedAt
  router.delete('/:id', async (req, res) => {
    try {
      if (!req.user || !req.user.uid) {
        console.warn('[DELETE /notes/:id] Отказано — пользователь не авторизован');
        return res.status(401).json({ error: 'unauthorized' });
      }

      const id = req.params.id;
      const existing = await adapter.get(id);
      if (!existing) {
        console.log(`[DELETE /notes/:id] Заметка ${id} не найдена`);
        return res.status(404).json({ error: 'not_found' });
      }

      if (existing.uid !== req.user.uid) {
        console.warn(`[DELETE /notes/:id] Доступ к заметке ${id} запрещён — не принадлежит пользователю ${req.user.uid}`);
        return res.status(403).json({ error: 'forbidden' });
      }

      existing.isDeleted = true;
      existing.updatedAt = Date.now();
      await adapter.upsert(existing);
      console.log(`[DELETE /notes/:id] Пользователь ${req.user.uid} пометил заметку ${id} как удалённую`);
      res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /notes/:id] Ошибка:', e && e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });


// GET /notes/:id/export - экспорт заметки в виде TXT-файла
// router.get('/:id/export', async (req, res) => {
//   try {
//     if (!req.user || !req.user.uid) {
//       return res.status(401).json({ error: 'Неавторизован' });
//     }

//     const note = await adapter.get(req.params.id);
//     if (!note) {
//       return res.status(404).json({ error: 'Заметка не найдена' });
//     }

//     if (note.uid !== req.user.uid) {
//       return res.status(403).json({ error: 'Нет доступа к этой заметке' });
//     }

//     const formatDate = (timestamp) => {
//       if (!timestamp) return 'не указана';
//       try {
//         const date = isNaN(timestamp) ? new Date(timestamp) : new Date(Number(timestamp));
//         return date.toLocaleDateString('ru-RU');
//       } catch {
//         return String(timestamp);
//       }
//     };

//     const formatTime = (timestamp, timeStr) => {
//       if (timeStr) return timeStr;
//       if (!timestamp) return 'не указано';
//       try {
//         const date = isNaN(timestamp) ? new Date(timestamp) : new Date(Number(timestamp));
//         return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
//       } catch {
//         return 'не указано';
//       }
//     };

//     const content = `
// ЗАМЕТКА: ${note.title || '(без названия)'}

// Дата: ${formatDate(note.date)}
// Время: ${formatTime(note.date, note.time)}
// Теги: ${Array.isArray(note.tags) && note.tags.length > 0
//   ? note.tags.map(tag => `#${tag}`).join(', ')
//   : 'нет тегов'}

// Содержание:
// ${note.body || '(нет текста)'}

// ---
// Создана: ${formatDate(note.createdAt)}
// Обновлена: ${formatDate(note.updatedAt)}
// `.trim();

//     // 🧹 Безопасное имя файла для заголовка (только ASCII)
//     const safeFilename = `note_${note.id}.txt`;
    
//     // Альтернативное имя с транслитерацией кириллицы
//     const transliterate = (text) => {
//       const cyrToLat = {
//         'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
//         'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
//         'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
//         'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
//         'я': 'ya'
//       };
      
//       return text
//         .toLowerCase()
//         .split('')
//         .map(char => cyrToLat[char] || (/[a-z0-9]/.test(char) ? char : '_'))
//         .join('')
//         .replace(/_+/g, '_')
//         .replace(/^_|_$/g, '');
//     };

//     const titleForFile = note.title ? transliterate(note.title).substring(0, 50) : 'note';
//     const filenameWithTitle = `note_${titleForFile}_${note.id}.txt`;

//     // Устанавливаем заголовки
//     res.setHeader('Content-Type', 'text/plain; charset=utf-8');
//     res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    
//     // Дополнительный заголовок для Unicode имен (не все браузеры поддерживают)
//     res.setHeader('X-Filename', encodeURIComponent(filenameWithTitle));

//     // Отправляем содержимое
//     res.send(content);

//   } catch (error) {
//     console.error('[Export] Ошибка:', error);
//     res.status(500).json({ error: 'Ошибка при экспорте заметки' });
//   }
// });

router.get('/:id/export', async (req, res) => {
  try {
    const note = await adapter.get(req.params.id);
    if (!note) {
      return res.status(404).json({ error: 'Заметка не найдена' });
    }

    // Проверяем права доступа
    if (note.uid !== req.user.uid) {
      return res.status(403).json({ error: 'Нет доступа к этой заметке' });
    }

    // Форматируем для экспорта
    const formatDate = (timestamp) => {
      if (!timestamp) return 'не указана';
      try {
        const date = new Date(Number(timestamp));
        return date.toLocaleDateString('ru-RU');
      } catch {
        return String(timestamp);
      }
    };

    const formatTime = (timestamp, timeStr) => {
      if (timeStr) return timeStr;
      if (!timestamp) return 'не указано';
      try {
        const date = new Date(Number(timestamp));
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      } catch {
        return 'не указано';
      }
    };

    const exportData = {
      filename: `заметка_${note.title ? note.title.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_') : note.id}.txt`,
      content: `
ЗАМЕТКА: ${note.title || '(без названия)'}

Дата: ${formatDate(note.date)}
Время: ${formatTime(note.date, note.time)}
Теги: ${Array.isArray(note.tags) && note.tags.length > 0 
  ? note.tags.map(tag => `#${tag}`).join(', ') 
  : 'нет тегов'}

Содержание:
${note.body || '(нет текста)'}

---
Создана: ${formatDate(note.createdAt)}
Обновлена: ${formatDate(note.updatedAt)}
`.trim(),
      note: note
    };

    res.json(exportData);
  } catch (error) {
    console.error('[Export] Ошибка:', error);
    res.status(500).json({ error: 'Ошибка при экспорте заметки' });
  }
});








  return router;
}
