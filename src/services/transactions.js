/**
 * Транзакции и категории в Firestore.
 *
 * families/{familyId}/transactions/{txId}
 *   type       'expense' | 'income'
 *   amount     число в валюте операции
 *   currency   'RSD' | 'EUR' | 'ILS' | 'USD'
 *   amounts    { RSD, EUR, ILS, USD } — суммы, посчитанные в момент сохранения
 *   rates      { RSD, EUR, ILS, USD } — снимок курсов к EUR на этот момент
 *   rateDate   когда сняли курсы
 *   categoryId ссылка на categories/{id}
 *   date       'YYYY-MM-DD'
 *   month      'YYYY-MM' — для выборок и графиков
 *   note       комментарий
 *   merchant   магазин (с чека)
 *   items      [{ name, qty, price, total }] — строки чека, редактируемые
 *   source     'manual' | 'receipt-photo' | 'receipt-url' | 'bill'
 *   billId     ссылка на bills/{id}, если это оплата регулярного платежа
 *   receiptUrl исходная ссылка на страницу чека
 *   createdBy  { uid, name, photo }
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=5';
import { FAMILY_ID } from '../config.js?v=5';
import { DEFAULT_CATEGORIES } from '../data/categories.js?v=5';
import { amountsInAllCurrencies, round } from '../core/money.js?v=5';
import { monthOf } from '../core/dates.js?v=5';

const txCollection = () => collection(db, 'families', FAMILY_ID, 'transactions');
const catCollection = () => collection(db, 'families', FAMILY_ID, 'categories');

/** Живая подписка на операции. Лимит с запасом — семейный бюджет столько не набирает. */
export function watchTransactions(onChange, onError) {
  const q = query(txCollection(), orderBy('date', 'desc'), limit(2000));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export function watchCategories(onChange, onError) {
  return onSnapshot(
    catCollection(),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.order ?? 500) - (b.order ?? 500) || a.name.localeCompare(b.name));
      onChange(list);
    },
    onError,
  );
}

/** Засевает набор категорий по умолчанию, если коллекция пуста. */
export async function seedCategoriesIfEmpty() {
  const snap = await getDocs(catCollection());
  if (!snap.empty) return false;

  const batch = writeBatch(db);
  for (const { id, ...data } of DEFAULT_CATEGORIES) {
    batch.set(doc(catCollection(), id), data);
  }
  await batch.commit();
  return true;
}

export function saveCategory(id, data) {
  return setDoc(doc(catCollection(), id), data, { merge: true });
}

export function deleteCategory(id) {
  return deleteDoc(doc(catCollection(), id));
}

/**
 * Собирает документ транзакции: считает суммы во всех валютах и фиксирует курсы.
 * Дальше эти числа не пересчитываются — отчёты за прошлое остаются стабильными.
 */
function buildTx(input, rates) {
  const amount = round(Number(input.amount) || 0, input.currency);
  const items = (input.items || [])
    .filter((it) => String(it.name || '').trim() !== '')
    .map((it) => ({
      name: String(it.name).trim(),
      qty: Number(it.qty) || 1,
      price: Number(it.price) || 0,
      total: Number(it.total) || 0,
    }));

  return {
    type: input.type === 'income' ? 'income' : 'expense',
    amount,
    currency: input.currency,
    amounts: amountsInAllCurrencies(amount, input.currency, rates),
    rates: { ...rates },
    rateDate: input.rateDate || new Date().toISOString(),
    categoryId: input.categoryId || null,
    date: input.date,
    month: monthOf(input.date),
    note: String(input.note || '').trim(),
    merchant: String(input.merchant || '').trim(),
    items,
    source: input.source || 'manual',
    receiptUrl: input.receiptUrl || '',
    /** Ссылка на регулярный платёж — по ней считается «оплачено в этом месяце». */
    billId: input.billId || null,
  };
}

export function createTransaction(input, { rates, user }) {
  return addDoc(txCollection(), {
    ...buildTx(input, rates),
    createdBy: { uid: user.uid, name: user.displayName || user.email, photo: user.photoURL || '' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Правка операции. Курсы пересчитываем только если поменялись сумма или валюта —
 * иначе исходный снимок остаётся нетронутым.
 */
export function updateTransaction(id, input, { rates, user, previous }) {
  const currencyChanged = previous?.currency !== input.currency;
  const amountChanged = Number(previous?.amount) !== Number(input.amount);
  const effectiveRates = currencyChanged || amountChanged ? rates : previous?.rates || rates;

  const patch = buildTx(input, effectiveRates);
  if (!currencyChanged && !amountChanged && previous?.rateDate) {
    patch.rateDate = previous.rateDate;
  }

  return updateDoc(doc(txCollection(), id), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: { uid: user.uid, name: user.displayName || user.email },
  });
}

export function deleteTransaction(id) {
  return deleteDoc(doc(txCollection(), id));
}
