/**
 * Разовый просмотр записей за несколько дней — глазами сервера.
 *
 * Нужен, когда с экрана непонятно, потерялось что-то при сохранении или при
 * показе: здесь видно ровно то, что лежит в базе.
 *
 *   node tools/peek-tx.mjs 2026-11-10 2026-11-14
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const keyFile = readdirSync(ROOT).find((n) => n.includes('firebase-adminsdk') && n.endsWith('.json'));
if (!keyFile) {
  console.error('Служебный ключ не найден рядом с проектом');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(ROOT + keyFile, 'utf8'))) });
const db = getFirestore();

const [from = '2026-11-10', to = '2026-11-14'] = process.argv.slice(2);

const snap = await db.collection('families/family_drutz/transactions')
  .where('date', '>=', from).where('date', '<=', to).get();

for (const doc of snap.docs) {
  const tx = doc.data();
  console.log(`\n${doc.id} | ${tx.date} ${tx.time || ''} | ${tx.merchant || '—'} | ${tx.amount} ${tx.currency}`);
  console.log(`   способ: ${tx.source} | ссылка: ${tx.receiptUrl || 'нет'} | товаров: ${(tx.items || []).length}`);
  for (const item of tx.items || []) console.log(`      · ${item.name} ×${item.qty} = ${item.total}`);
}
console.log(`\nвсего записей за ${from} — ${to}: ${snap.size}`);
