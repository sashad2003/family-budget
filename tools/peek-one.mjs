/** Одна запись целиком: что в ней лежит и когда её трогали. */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const keyFile = readdirSync(ROOT).find((n) => n.includes('firebase-adminsdk') && n.endsWith('.json'));
initializeApp({ credential: cert(JSON.parse(readFileSync(ROOT + keyFile, 'utf8'))) });

const doc = await getFirestore().doc(`families/family_drutz/transactions/${process.argv[2]}`).get();
const tx = doc.data();
const when = (v) => (v?.toDate ? v.toDate().toISOString().replace('T', ' ').slice(0, 19) : String(v));

for (const [key, value] of Object.entries(tx)) {
  if (key === 'items') { console.log(`items: ${value.length}`); continue; }
  if (key === 'rates' || key === 'amounts') { console.log(`${key}: ${JSON.stringify(value)}`); continue; }
  if (key === 'createdAt' || key === 'updatedAt') { console.log(`${key}: ${when(value)}`); continue; }
  console.log(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value).slice(0, 120)}`);
}
