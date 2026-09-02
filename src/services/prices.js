/**
 * Общая база цен.
 *
 * prices/{docId}
 *   uid        кто внёс (нужен правилам доступа, имени и почты здесь нет)
 *   txId       операция-источник — по нему строки обновляются и удаляются
 *   name       название как в чеке
 *   norm       понятное название по-русски, если Claude его дал
 *   tokens     слова для поиска (см. core/priceKey.js)
 *   merchant   магазин как записан
 *   address    адрес точки, если он был в чеке
 *   shop       ключ магазина, чтобы «MAXI 236>» и «Maxi» слиплись
 *   price      цена за единицу
 *   qty, total сколько взяли и на сколько
 *   currency   валюта чека
 *   date       'YYYY-MM-DD'
 *
 * Коллекция лежит вне families: цены общие, их видят все пользователи
 * приложения. Ничего личного, кроме анонимного uid, туда не попадает.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  limit,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=96';
import { getFamilyId } from '../core/session.js?v=96';
import { tokenize, merchantKey, searchToken, normalizeText } from '../core/priceKey.js?v=96';

const pricesCollection = () => collection(db, 'prices');

/** Сколько строк тянем на один запрос. Лишнее отсеивается уже на телефоне. */
const SEARCH_LIMIT = 400;

/** Строки одной операции, уже лежащие в базе. */
async function rowsOfTransaction(txId, uid) {
  const snap = await getDocs(query(
    pricesCollection(),
    where('uid', '==', uid),
    where('txId', '==', txId),
  ));
  return snap.docs;
}

/**
 * Выкладывает товары операции в общую базу.
 *
 * Старые строки этой же операции сносим и пишем заново: так правка чека
 * (убрали позицию, поправили цену) не оставляет за собой мусор.
 */
export async function publishPrices(txId, tx, uid) {
  if (!uid || !txId) return;

  const items = (tx.items || []).filter((it) => Number(it.price) > 0 || Number(it.total) > 0);
  const existing = await rowsOfTransaction(txId, uid);

  if (!items.length && !existing.length) return;

  const batch = writeBatch(db);
  for (const d of existing) batch.delete(d.ref);

  items.forEach((item, index) => {
    const name = String(item.name || '').trim();
    if (!name) return;

    const qty = Number(item.qty) || 1;
    const total = Number(item.total) || 0;
    // Цену за единицу иногда в чеке не печатают — выводим из суммы строки.
    const price = Number(item.price) || (qty ? total / qty : 0);
    if (!price) return;

    batch.set(doc(pricesCollection(), `${uid}_${txId}_${index}`), {
      uid,
      txId,
      name,
      norm: String(item.norm || '').trim(),
      tokens: tokenize(name, item.norm),
      merchant: String(tx.merchant || '').trim(),
      address: String(tx.address || '').trim(),
      shop: merchantKey(tx.merchant),
      price,
      qty,
      total,
      currency: tx.currency,
      date: tx.date,
    });
  });

  await batch.commit();
}

/** Убирает строки удалённой операции. */
export async function removePrices(txId, uid) {
  if (!uid || !txId) return;
  const existing = await rowsOfTransaction(txId, uid);
  if (!existing.length) return;

  const batch = writeBatch(db);
  for (const d of existing) batch.delete(d.ref);
  await batch.commit();
}

/**
 * Разовый перенос уже накопленных чеков в базу цен.
 *
 * Товары лежали в операциях с самого начала, поэтому история цен есть — её
 * просто некуда было показывать. Проходим её один раз при запуске; отметку
 * держим в семье, чтобы не повторять на каждом заходе.
 *
 * Версию отметки поднимаем, если формат строк поменяется и историю надо будет
 * перебрать заново.
 */
const BACKFILL_VERSION = 1;

export async function backfillPrices(transactions, uid) {
  if (!uid || !transactions?.length) return 0;

  const markRef = doc(db, 'families', getFamilyId(), 'meta', 'pricesBackfill');
  const mark = await getDoc(markRef);
  if (mark.exists() && (mark.data().version || 0) >= BACKFILL_VERSION) return 0;

  const withItems = transactions.filter((tx) => (tx.items || []).length);
  for (const tx of withItems) {
    await publishPrices(tx.id, tx, uid);
  }

  await setDoc(markRef, { version: BACKFILL_VERSION, at: new Date().toISOString() });
  return withItems.length;
}

/**
 * Поиск цен по названию товара.
 *
 * В базу идём по одному слову — больше Firestore за раз не умеет, — а полное
 * совпадение со всеми словами запроса проверяем уже здесь.
 */
export async function searchPrices(text) {
  const token = searchToken(text);
  if (!token) return [];

  const words = normalizeText(text).split(/\s+/).filter((w) => w.length >= 3);

  const snap = await getDocs(query(
    pricesCollection(),
    where('tokens', 'array-contains', token),
    limit(SEARCH_LIMIT),
  ));

  return snap.docs
    .map((d) => d.data())
    .filter((row) => {
      const haystack = normalizeText(`${row.name} ${row.norm}`);
      return words.every((word) => haystack.includes(word) || (row.tokens || []).includes(word));
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Разносит найденное по магазинам.
 *
 * В каждом магазине показываем самую свежую цену: она и интересна при выборе,
 * куда идти. Минимум за всё время держим рядом — видно, бывает ли дешевле.
 */
export function groupByShop(rows, toBase = (price) => price) {
  const shops = new Map();

  for (const row of rows) {
    const key = `${row.shop || row.merchant || '—'}|${row.currency}`;
    const shop = shops.get(key) || {
      key,
      merchant: row.merchant || '—',
      currency: row.currency,
      last: row,
      min: row,
      count: 0,
    };

    shop.count += 1;
    // Строки отсортированы от новых к старым, поэтому первая — самая свежая.
    if (String(row.date) > String(shop.last.date)) shop.last = row;
    if (Number(row.price) < Number(shop.min.price)) shop.min = row;
    shops.set(key, shop);
  }

  // Сравниваем в одной валюте: цены приходят и в динарах, и в евро.
  return [...shops.values()].sort(
    (a, b) => toBase(a.last.price, a.currency) - toBase(b.last.price, b.currency),
  );
}
