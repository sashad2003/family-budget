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
 *   time       'HH:MM' — время покупки, если известно (с чека или из SMS банка)
 *   month      'YYYY-MM' — для выборок и графиков
 *   note       комментарий
 *   merchant   магазин (с чека)
 *   address    адрес точки, если он был в чеке
 *   items      [{ name, norm, qty, price, total }] — строки чека, редактируемые;
 *              norm — то же название обычными словами, для базы цен
 *   source     'manual' | 'receipt-photo' | 'receipt-url' | 'sms' | 'bill'
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
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=36';
import { getFamilyId } from '../core/session.js?v=36';
import { DEFAULT_CATEGORIES } from '../data/categories.js?v=36';
import { amountsInAllCurrencies } from '../core/money.js?v=36';
import { monthOf } from '../core/dates.js?v=36';

const txCollection = () => collection(db, 'families', getFamilyId(), 'transactions');
const catCollection = () => collection(db, 'families', getFamilyId(), 'categories');

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

/**
 * Довозит категории, появившиеся в коде после первого запуска.
 *
 * Что уже присылали — помним в meta/categorySeed, поэтому удалённую вручную
 * категорию не воскрешаем: добавляется только то, чего семья ещё не видела.
 */
export async function syncNewCategories() {
  const seedRef = doc(db, 'families', getFamilyId(), 'meta', 'categorySeed');
  const [seedSnap, catSnap] = await Promise.all([getDoc(seedRef), getDocs(catCollection())]);

  const delivered = new Set(seedSnap.exists() ? seedSnap.data().ids || [] : []);
  const existing = new Set(catSnap.docs.map((d) => d.id));

  // Первый запуск на старой базе: считаем уже показанным всё, что там лежит.
  const fresh = DEFAULT_CATEGORIES.filter((c) => !delivered.has(c.id) && !existing.has(c.id));
  if (!fresh.length) {
    if (!seedSnap.exists()) {
      await setDoc(seedRef, { ids: DEFAULT_CATEGORIES.map((c) => c.id) });
    }
    return 0;
  }

  const batch = writeBatch(db);
  for (const { id, ...data } of fresh) batch.set(doc(catCollection(), id), data);
  batch.set(seedRef, { ids: DEFAULT_CATEGORIES.map((c) => c.id) });
  await batch.commit();

  return fresh.length;
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
  /**
   * Сумму храним как есть, без округления до знаков валюты. У динара их ноль,
   * и округление стирало копейки — а именно они надёжнее всего связывают
   * покупку из чека с SMS о том же списании. На экране число всё равно
   * показывается через formatAmount, то есть вид не меняется.
   */
  const amount = Number(input.amount) || 0;
  const items = (input.items || [])
    .filter((it) => String(it.name || '').trim() !== '')
    .map((it) => ({
      name: String(it.name).trim(),
      /**
       * Понятное название по-русски: в чеках печатают `SLADOLED KING 100G`,
       * и без перевода поиск по базе цен не нашёл бы «мороженое».
       * Заполняется при распознавании чека, у ручного ввода пустое.
       */
      norm: String(it.norm || '').trim(),
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
    /** Время знаем не всегда: ручной ввод и часть чеков его не содержат. */
    time: /^\d{2}:\d{2}$/.test(String(input.time || '')) ? input.time : '',
    month: monthOf(input.date),
    note: String(input.note || '').trim(),
    merchant: String(input.merchant || '').trim(),
    /**
     * Адрес точки. В шапке чека часто стоит юрлицо («DELHAIZE SERBIA»),
     * которому принадлежит несколько сетей, — по одному названию не понять,
     * где именно человек был. Адрес это и разводит.
     */
    address: String(input.address || '').trim(),
    items,
    source: input.source || 'manual',
    receiptUrl: input.receiptUrl || '',
    /** Ссылка на регулярный платёж — по ней считается «оплачено в этом месяце». */
    billId: input.billId || null,
  };
}

export async function createTransaction(input, { rates, user }) {
  const data = buildTx(input, rates);
  const ref = await addDoc(txCollection(), {
    ...data,
    createdBy: { uid: user.uid, name: user.displayName || user.email, photo: user.photoURL || '' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await shareItemPrices(ref.id, data, user);
  return ref;
}

/**
 * Товары чека уходят в общую базу цен отдельно от самой операции.
 *
 * Сбой здесь не должен ронять сохранение: операция уже записана, а цены —
 * дело второе, их подхватит следующая правка или разовый перенос истории.
 */
async function shareItemPrices(txId, tx, user) {
  try {
    const { publishPrices } = await import('./prices.js?v=36');
    await publishPrices(txId, tx, user.uid);
  } catch (error) {
    console.error('Не удалось обновить базу цен', error);
  }
}

/**
 * Правка операции. Курсы пересчитываем только если поменялись сумма или валюта —
 * иначе исходный снимок остаётся нетронутым.
 */
export async function updateTransaction(id, input, { rates, user, previous }) {
  const currencyChanged = previous?.currency !== input.currency;
  const amountChanged = Number(previous?.amount) !== Number(input.amount);
  const effectiveRates = currencyChanged || amountChanged ? rates : previous?.rates || rates;

  const patch = buildTx(input, effectiveRates);
  if (!currencyChanged && !amountChanged && previous?.rateDate) {
    patch.rateDate = previous.rateDate;
  }

  await updateDoc(doc(txCollection(), id), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: { uid: user.uid, name: user.displayName || user.email },
  });

  await shareItemPrices(id, patch, user);
}

export async function deleteTransaction(id, user = null) {
  await deleteDoc(doc(txCollection(), id));

  if (!user) return;
  try {
    const { removePrices } = await import('./prices.js?v=36');
    await removePrices(id, user.uid);
  } catch (error) {
    console.error('Не удалось убрать цены удалённой операции', error);
  }
}
