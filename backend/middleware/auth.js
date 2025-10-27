// middleware/auth.js
// ==================
// Middleware для верификации Firebase ID token.
// Использует Firebase Admin SDK:
//   - admin.auth().verifyIdToken(token)
//   - результат = { uid, email, ...claims }
//
// Задачи:
//   1. Проверить, что клиент прислал заголовок Authorization: Bearer <idToken>.
//   2. Верифицировать токен через Firebase Admin.
//   3. При успехе → добавить req.user (uid/email).
//   4. Если невалиден → вернуть 401 Unauthorized.

import admin from 'firebase-admin';

/**
 * authMiddleware
 * -------------------------------
 * Использование:
 *   app.use('/api/secure', authMiddleware, secureRouter);
 *
 * После middleware:
 *   - req.user.uid → уникальный идентификатор Firebase пользователя
 *   - req.user.email → email (если есть)
 *
 * Требования:
 *   - Перед каждым запросом фронтенд обязан вызывать
 *     firebase.auth().currentUser.getIdToken()
 *     и подставлять его в заголовок:
 *     Authorization: Bearer <idToken>
 */
export async function authMiddleware(req, res, next) {
  // Достаём заголовок Authorization
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header) {
    return res.status(401).json({
      error: 'unauthorized',
      reason: 'no_authorization_header'
    });
  }

  // Проверяем формат: "Bearer <token>"
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      error: 'unauthorized',
      reason: 'bad_authorization_format'
    });
  }

  const token = parts[1];

  try {
    // 🔑 Firebase Admin проверяет подпись токена и возвращает payload:
    //   { uid: "...", email: "...", auth_time: ..., exp: ... }
    const decoded = await admin.auth().verifyIdToken(token);

    // сохраняем uid/email и прочие claims в req.user
    req.user = decoded;

    // идём дальше (к твоим роутам /sync, /notes и т.д.)
    next();
  } catch (err) {
    console.error('[Auth] Token verification failed:', err && err.message);
    return res.status(401).json({ error: 'invalid_token' });
  }
}
