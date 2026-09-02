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
 *   auto            true — оплата записывается сама, без нажатия
 *   autoPaidThrough 'YYYY-MM', последний месяц, за который автооплата отработала
 *
 * Факт оплаты отдельно не хранится: оплата — обычная транзакция с полем
 * billId. Так суммы попадают в отчёты, а «оплачено» всегда сходится с базой.
 *
 * Исключение — autoPaidThrough. Казалось бы, хватило бы проверки «за этот
 * месяц оплаты нет», но тогда отменённая вручную автооплата воскресала бы
 * при следующем открытии приложения, и отменить её было бы нельзя вовсе.
 * Отметка запоминает, что месяц уже отработан, независимо от судьбы записи.
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


import { db } from '../core/firebase.js?v=108';
import { getFamilyId } from '../core/session.js?v=108';

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
  const fixed = Boolean(input.fixed);

  return {
    name: String(input.name || '').trim(),
    categoryId: input.categoryId || null,
    currency: input.currency,
    amount: Number(input.amount) || 0,
    fixed,
    dueDay: Math.min(31, Math.max(0, Number(input.dueDay) || 0)),
    startMonth: input.startMonth,
    active: input.active !== false,
    order: Number(input.order) || 500,

    /**
     * Автооплата возможна только у постоянной суммы: у меняющейся заранее
     * известна лишь прошлая, и записывать её как факт — значит выдумывать
     * расход. Снятие «постоянной суммы» гасит и автооплату, иначе счёт
     * остался бы с включённым флагом, который молча ничего не делает.
     */
    auto: fixed && Boolean(input.auto),
    autoPaidThrough: input.autoPaidThrough || null,
  };
}

/**
 * Отметка о последнем отработанном месяце.
 *
 * Пишется отдельно от остального счёта: её ставит автооплата, и трогать
 * ею поля, которые человек в это время правит в форме, не нужно.
 */
export function markAutoPaid(id, month) {
  return updateDoc(doc(billCollection(), id), { autoPaidThrough: month });
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
