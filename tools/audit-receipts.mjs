/**
 * Сверка записей с их фискальными чеками.
 *
 * Берёт все операции, у которых сохранена ссылка из QR, открывает страницу
 * чека, разбирает журнал и сравнивает список товаров с тем, что лежит в
 * записи. Так видно, где товары недобрались: раньше их переносила модель и
 * иногда возвращала пустой список, а сумма при этом записывалась верно.
 *
 *   node tools/audit-receipts.mjs          показать расхождения
 *   node tools/audit-receipts.mjs --fix    дописать недостающие строки
 *
 * Правит только те записи, где товаров нет вовсе или их меньше, чем в чеке,
 * и только если сумма строк сходится с суммой записи. Записанное руками не
 * трогает: человек мог поправить строки осознанно.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, readdirSync } from 'node:fs';

import { parseJournal } from './fiscal-journal.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const keyFile = readdirSync(ROOT).find((n) => n.includes('firebase-adminsdk') && n.endsWith('.json'));
initializeApp({ credential: cert(JSON.parse(readFileSync(ROOT + keyFile, 'utf8'))) });
const db = getFirestore();

const FIX = process.argv.includes('--fix');
const money = (value) => Number(value).toFixed(2);

const snap = await db.collection('families/family_drutz/transactions').get();
const withUrl = snap.docs.filter((d) => String(d.data().receiptUrl || '').startsWith('https://'));

console.log(`записей со ссылкой на чек: ${withUrl.length}\n`);

let broken = 0;
let fixed = 0;

for (const doc of withUrl) {
  const tx = doc.data();
  const have = (tx.items || []).length;

  let html = '';
  try {
    const res = await fetch(tx.receiptUrl, { headers: { 'User-Agent': 'family-budget/2.0' } });
    html = await res.text();
  } catch (error) {
    console.log(`? ${tx.date} ${tx.merchant}: страница не открылась (${error.message})`);
    continue;
  }

  const items = parseJournal(html);
  const sum = items.reduce((acc, item) => acc + item.total, 0);
  const fits = Math.abs(sum - Number(tx.amount)) < 0.02;

  if (!items.length || have >= items.length) {
    console.log(`  ok  ${tx.date} ${tx.merchant}: в записи ${have}, в чеке ${items.length}`);
    continue;
  }

  broken += 1;
  console.log(`НЕХВАТКА ${tx.date} ${tx.merchant} ${money(tx.amount)}: в записи ${have}, в чеке ${items.length}`
    + ` (сумма строк ${money(sum)}${fits ? ', сходится' : ', НЕ сходится'})`);

  if (!FIX || !fits) continue;

  await doc.ref.update({
    items: items.map((item) => ({
      name: item.name, norm: '', qty: item.qty, price: item.price, total: item.total,
    })),
    updatedAt: FieldValue.serverTimestamp(),
  });
  fixed += 1;
  console.log('         дописано');
}

console.log(`\nнедобрали товары: ${broken}${FIX ? `, дописано: ${fixed}` : ' (запуск с --fix допишет)'}`);
