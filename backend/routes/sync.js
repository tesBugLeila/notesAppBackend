// routes/sync.js
// Обрабатывает маршруты синхронизации (push / pull) между клиентом и сервером.

import express from 'express';
import { nanoid } from 'nanoid';

const router = express.Router();

export function registerSyncRoutes(adapter) {
  /**
   * Нормализует заметку перед сохранением.
   * Добавляет uid, updatedAt, createdAt и т.д.
   */
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
        : body.tags
        ? String(body.tags).split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      isDeleted: !!body.isDeleted,
    };
  }

  // ===================== POST /sync/push =====================
  router.post('/push', async (req, res) => {
    try {
      const notes = Array.isArray(req.body.notes) ? req.body.notes : [];
      const results = [];

      console.log(`[SYNC PUSH] Пользователь ${req.user.uid} отправил ${notes.length} заметок`);

      for (const raw of notes) {
        const note = normalizeNoteInput(raw, req.user);
        const existing = await adapter.get(note.id);

        if (!existing) {
          await adapter.upsert(note);
          results.push({ id: note.id, status: 'created' });
          console.log(`[SYNC PUSH] Заметка ${note.id} создана`);
        } else if (existing.uid !== req.user.uid) {
          results.push({ id: note.id, status: 'forbidden_owner_mismatch' });
          console.warn(`[SYNC PUSH] Заметка ${note.id} не обновлена — чужой владелец`);
        } else if (note.updatedAt > existing.updatedAt) {
          await adapter.upsert(note);
          results.push({ id: note.id, status: 'updated' });
          console.log(`[SYNC PUSH] Заметка ${note.id} обновлена`);
        } else {
          results.push({ id: note.id, status: 'skipped_server_newer' });
        }
      }

      res.json({ ok: true, results });
    } catch (e) {
      console.error('[POST /sync/push] Ошибка:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // ===================== GET /sync/pull =====================
  router.get('/pull', async (req, res) => {
    try {
      const lastSync = req.query.lastSync ? Number(req.query.lastSync) : 0;
      const notes = await adapter.find({
        updatedAfter: lastSync,
        includeDeleted: true,
        uid: req.user.uid,
      });

      console.log(`[SYNC PULL] Пользователь ${req.user.uid} запросил заметки после ${lastSync}. Найдено: ${notes.length}`);
      res.json({ notes });
    } catch (e) {
      console.error('[GET /sync/pull] Ошибка:', e.message);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}
