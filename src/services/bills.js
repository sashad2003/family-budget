/**
 * Регулярные платежи: электричество, интернет, телефон, учёба и подобное.
 *
 * families/{familyId}/bills/{billId}
 *   name        'Электричество'
 *   categoryId  куда относить расход
 *   currency    валюта счёта
 *   amount      сумма: для fixed — постоянная, иначе подсказка на следующий раз
 *   fixed       true — сумма не меняется от месяца к месяцу
 *   dueDay      число месяца, до которого платим (0 — не указано)
 *   startMonth  'YYYY-MM', с какого месяца следим (прошлое не краснеет)
 *   active      false — счёт закрыт, но история сохранена
 *   order       порядок в списке
 *
 * Факт оплаты отдельно не хранится: оплата — обычная транзакция с полем
 * billId. Так суммы попадают в отчёты, а «оплачено» всегда сходится с базой.
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=53';
import { getFamilyId } from '../core/session.js?v=53';

const billCollection = () => collection(db, 'families', getFamilyId(), 'bills');

export function watchBills(onChange, onError) {
  return onSnapshot(
    billCollection(),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.name.localeCompare(b.name));
      onChange(list);
    },
    onError,
  );
}

function clean(input) {
  return {
    name: String(input.name || '').trim(),
    categoryId: input.categoryId || null,
    currency: input.currency,
    amount: Number(input.amount) || 0,
    fixed: Boolean(input.fixed),
    dueDay: Math.min(31, Math.max(0, Number(input.dueDay) || 0)),
    startMonth: input.startMonth,
    active: input.active !== false,
    order: Number(input.order) || 500,
  };
}

export function createBill(input) {
  return addDoc(billCollection(), { ...clean(input), createdAt: serverTimestamp() });
}

export function updateBill(id, input) {
  return updateDoc(doc(billCollection(), id), { ...clean(input), updatedAt: serverTimestamp() });
}

export function deleteBill(id) {
  return deleteDoc(doc(billCollection(), id));
}
