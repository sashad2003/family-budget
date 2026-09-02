/**
 * Сводка по общей базе цен — для админ-панели.
 *
 * Считается по коллекции prices: что покупают, в каких магазинах и почём.
 * Это те самые записи, которые видны всем пользователям приложения и о
 * которых сказано в политике: имени, почты и телефона там нет.
 *
 * Кто именно что купил, здесь не считается и считаться не должно. В строке
 * лежит служебный uid — он нужен правилам доступа, чтобы человек мог править
 * и удалять свои же записи. Сопоставлять его с профилем нельзя: людям обещано
 * обратное, и обещание держится тем, что такого кода просто нет.
 *
 * Все суммы приводятся к валюте сводок по сегодняшнему курсу. Для витрины
 * этого достаточно: она отвечает на вопрос «что почём сейчас», а не служит
 * отчётом за прошлое, где курс обязан быть зафиксированным.
 */

import {
  collection, getDocs, query, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=123';
import { convert } from '../core/money.js?v=123';
import { monthOf } from '../core/dates.js?v=123';

/**
 * Сколько строк тянем. Считаем на телефоне, поэтому берём свежие записи, а не
 * всю базу: витрина о том, что покупают сейчас, а старое только утяжелило бы
 * загрузку. Сортировка по дате — обычный одиночный индекс, заводить ничего
 * не надо.
 */
const ROW_LIMIT = 4000;

/**
 * Строки собственных операций в том же виде, что и записи общей базы.
 *
 * Личная статистика считается по своим же данным, которые и так лежат на
 * устройстве: ходить за ними в базу незачем, а вид один и тот же — значит
 * и считаются оба разреза одной функцией.
 */
export function ownPriceRows(transactions, uid) {
  const rows = [];

  for (const tx of transactions || []) {
    for (const item of tx.items || []) {
      const qty = Number(item.qty) || 1;
      const total = Number(item.total) || 0;
      rows.push({
        uid,
        txId: tx.id,
        name: item.name,
        norm: item.norm,
        merchant: tx.merchant,
        shop: String(tx.merchant || '').trim().toLowerCase(),
        price: Number(item.price) || (qty ? total / qty : 0),
        qty,
        total: total || (Number(item.price) || 0) * qty,
        currency: tx.currency,
        date: tx.date,
      });
    }
  }

  return rows;
}

/**
 * Способы записи собственных операций — то же, что общий счётчик, только про
 * себя и по настоящим операциям, а не по числам в usage.
 */
export function summarizeOwnSources(transactions) {
  const counts = { photo: 0, qr: 0, sms: 0, bill: 0, manual: 0 };
  const map = {
    'receipt-photo': 'photo', 'receipt-url': 'qr', sms: 'sms', bill: 'bill', manual: 'manual',
  };

  for (const tx of transactions || []) counts[map[tx.source] || 'manual'] += 1;
  return counts;
}

export async function loadPriceRows(max = ROW_LIMIT) {
  const snap = await getDocs(query(
    collection(db, 'prices'),
    orderBy('date', 'desc'),
    limit(max),
  ));
  return snap.docs.map((d) => d.data());
}

/**
 * Разбор строк в готовые для показа списки.
 *
 * base и rates приходят снаружи: модуль не лезет в состояние приложения,
 * поэтому его удобно прогнать на выдуманных данных и проверить счёт.
 */
export function summarizePrices(rows, base, rates) {
  const items = new Map();
  const shops = new Map();
  const months = new Map();
  const receipts = new Set();

  let total = 0;
  let counted = 0;
  let earliest = null;
  let latest = null;

  for (const row of rows) {
    const name = String(row.norm || row.name || '').trim();
    if (!name) continue;

    const sum = convert(Number(row.total) || 0, row.currency, base, rates);
    const price = convert(Number(row.price) || 0, row.currency, base, rates);
    const shop = String(row.merchant || '').trim();

    total += sum;
    counted += 1;
    if (row.txId) receipts.add(`${row.uid}_${row.txId}`);
    if (row.date && (!earliest || row.date < earliest)) earliest = row.date;
    if (row.date && (!latest || row.date > latest)) latest = row.date;

    const key = name.toLowerCase();
    const item = items.get(key) || { name, count: 0, total: 0, min: Infinity, max: 0, shops: new Set() };
    item.count += 1;
    item.total += sum;
    if (price > 0) {
      item.min = Math.min(item.min, price);
      item.max = Math.max(item.max, price);
    }
    if (shop) item.shops.add(shop.toLowerCase());
    items.set(key, item);

    if (shop) {
      const shopKey = row.shop || shop.toLowerCase();
      const entry = shops.get(shopKey) || { name: shop, count: 0, total: 0, items: new Set() };
      entry.count += 1;
      entry.total += sum;
      entry.items.add(key);
      shops.set(shopKey, entry);
    }

    if (row.date) {
      const month = monthOf(row.date);
      const bucket = months.get(month) || { month, count: 0, total: 0 };
      bucket.count += 1;
      bucket.total += sum;
      months.set(month, bucket);
    }
  }

  const byTotal = (a, b) => b.total - a.total;

  return {
    // Строки без названия не считаем нигде: в базу они попадают из чеков,
    // где распознавание не разобрало позицию, и толку от них никакого.
    rows: counted,
    receipts: receipts.size,
    total,
    earliest,
    latest,

    items: [...items.values()]
      .map((item) => ({ ...item, shops: item.shops.size, min: item.min === Infinity ? 0 : item.min }))
      .sort(byTotal),

    shops: [...shops.values()]
      .map((shop) => ({ ...shop, items: shop.items.size }))
      .sort(byTotal),

    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/**
 * Складывает месяцы счётчика в один набор чисел.
 *
 * В документах может не быть части полей — их просто ни разу не увеличивали,
 * и это не то же самое, что ноль в базе.
 */
export function summarizeUsage(months) {
  const counts = { photo: 0, qr: 0, sms: 0, bill: 0, manual: 0 };

  for (const month of months || []) {
    for (const kind of Object.keys(counts)) counts[kind] += Number(month[kind]) || 0;
  }

  counts.total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  counts.receipts = counts.photo + counts.qr;
  return counts;
}

/**
 * Активность людей — по профилям, без содержимого их операций.
 *
 * Чужие операции админу закрыты правилами Firestore, и открывать их незачем:
 * чтобы понимать, живёт ли приложение, хватает того, сколько людей завелось
 * и в каком они состоянии подписки.
 */
export function summarizeUsers(users, now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const since = (days) => new Date(now.getTime() - days * day);

  const created = (user) => user.createdAt?.toDate?.() || null;
  const subscription = (user) => user.subscription || 'trial';

  const counts = { active: 0, trial: 0, expired: 0 };
  let week = 0;
  let month = 0;

  for (const user of users) {
    const kind = subscription(user);
    if (kind in counts) counts[kind] += 1;

    const date = created(user);
    if (!date) continue;
    if (date >= since(7)) week += 1;
    if (date >= since(30)) month += 1;
  }

  return { total: users.length, week, month, ...counts };
}
