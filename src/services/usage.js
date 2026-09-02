/**
 * Обезличенный счётчик записей — сколько операций и каким способом заведено.
 *
 * Документ на месяц: usage/2026-09 с полями photo, qr, sms, manual, bill.
 * Внутри только числа. Ни uid, ни сумм, ни названий: по такому документу
 * нельзя сказать, кто именно фотографировал чек, — можно только увидеть, чем
 * люди вообще пользуются. Из-за этого счётчик и разрешено читать админу, не
 * нарушая обещание из политики.
 *
 * Считаем через increment на сервере, а не «прочитать и записать»: две
 * операции, заведённые в одну секунду с двух телефонов, иначе затёрли бы
 * друг друга.
 */

import {
  doc, setDoc, getDocs, collection, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=94';
import { monthKey } from '../core/dates.js?v=94';

/** Способы записи. Всё незнакомое считаем ручным вводом. */
const KINDS = {
  'receipt-photo': 'photo',
  'receipt-url': 'qr',
  sms: 'sms',
  bill: 'bill',
  manual: 'manual',
};

export const USAGE_KINDS = ['photo', 'qr', 'sms', 'bill', 'manual'];

/**
 * Отмечает способ записи. Ошибку глотаем: счётчик — вещь второстепенная, и
 * из-за него операция человека провалиться не должна.
 */
export async function countUsage(source, date = new Date()) {
  const kind = KINDS[source] || 'manual';
  const month = monthKey(date);

  try {
    await setDoc(doc(db, 'usage', month), { [kind]: increment(1) }, { merge: true });
  } catch (error) {
    console.error('Счётчик записей не обновился', error);
  }
}

/** Все месяцы счётчика — для админ-панели. */
export async function loadUsage() {
  const snap = await getDocs(collection(db, 'usage'));
  return snap.docs.map((d) => ({ month: d.id, ...d.data() }));
}
