/**
 * Разовая настройка Firestore под новую схему.
 *
 * Запуск:
 *   node setup-firestore.mjs <путь-к-ключу-сервисного-аккаунта.json>
 *
 * Что делает:
 *   1. Создаёт документ families/family_drutz с полями доступа.
 *   2. Удаляет транзакции старой версии (другой формат, миграция не нужна).
 *   3. Печатает конфиг веб-приложения для src/config.js.
 *
 * Скрипт идемпотентный: повторный запуск ничего не ломает.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import { readFileSync } from 'fs';

const FAMILY_ID = 'family_drutz';
const ALLOWED_EMAILS = ['sashad2003@gmail.com', 'irinap.2001@gmail.com'];

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Укажите путь к ключу: node setup-firestore.mjs key.json');
  process.exit(1);
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(key) });
const db = getFirestore();

// 1. Документ семьи. memberUids и members заполнит само приложение при первом входе.
const familyRef = db.doc(`families/${FAMILY_ID}`);
const existing = await familyRef.get();

await familyRef.set({
  name: 'Семья Друц',
  baseCurrency: 'RSD',
  allowedEmails: ALLOWED_EMAILS,
  memberUids: existing.data()?.memberUids ?? [],
  members: existing.data()?.members ?? {},
  createdAt: existing.data()?.createdAt ?? new Date().toISOString(),
});
console.log(`✓ families/${FAMILY_ID} готов, приглашены: ${ALLOWED_EMAILS.join(', ')}`);

// 2. Транзакции прошлой версии — формат несовместим, начинаем с чистого листа.
const oldTx = await db.collection(`families/${FAMILY_ID}/transactions`).get();
for (const snapshot of oldTx.docs) {
  await snapshot.ref.delete();
}
console.log(`✓ удалено операций старого формата: ${oldTx.size}`);

// 3. Конфиг веб-приложения — то, что нужно вписать в src/config.js.
const auth = new GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/firebase'] });
const client = await auth.getClient();
const base = `https://firebase.googleapis.com/v1beta1/projects/${key.project_id}`;

const { data: list } = await client.request({ url: `${base}/webApps` });
const apps = list.apps ?? [];

if (!apps.length) {
  console.log('⚠ Веб-приложение в проекте не зарегистрировано — создайте его в Project settings → Your apps → Web.');
} else {
  const { data: config } = await client.request({ url: `${base}/webApps/${apps[0].appId}/config` });
  console.log('CONFIG_JSON=' + JSON.stringify(config));
}

process.exit(0);
