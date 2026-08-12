/** Выборки и агрегаты над транзакциями. Чистые функции — их удобно переиспользовать. */

import { txAmountIn, round } from './money.js?v=52';
import { monthOf, shiftMonth } from './dates.js?v=52';
import { t } from './i18n.js?v=52';

/** Операции выбранного месяца с учётом фильтров экрана «Операции». */
export function monthTransactions(state, filters = {}) {
  const { type = 'all', categoryId = null, query = '' } = filters;
  const needle = query.trim().toLowerCase();

  return state.transactions.filter((tx) => {
    if (monthOf(tx.date) !== state.month) return false;
    if (type !== 'all' && tx.type !== type) return false;
    if (categoryId && tx.categoryId !== categoryId) return false;
    if (needle) {
      const haystack = `${tx.note} ${tx.merchant} ${(tx.items || []).map((i) => i.name).join(' ')}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }
    return true;
  });
}

/** Операции за произвольный отрезок дат (границы включительно). */
export function rangeTransactions(state, { from, to }) {
  return state.transactions.filter((tx) => tx.date >= from && tx.date <= to);
}

/** Доходы и расходы по каждому месяцу списка — для графика динамики. */
export function seriesForMonths(state, months) {
  return months.map((key) => {
    const list = state.transactions.filter((tx) => monthOf(tx.date) === key);
    const { income, expense } = totals(list, state);
    return { month: key, income, expense };
  });
}

export function totals(list, state) {
  let income = 0;
  let expense = 0;
  for (const tx of list) {
    const value = txAmountIn(tx, state.base, state.rates);
    if (tx.type === 'income') income += value;
    else expense += value;
  }
  return { income, expense, balance: income - expense };
}

/** Суммы по категориям, от большей к меньшей, с долей в процентах. */
export function byCategory(list, state) {
  const map = new Map();
  for (const tx of list) {
    const value = txAmountIn(tx, state.base, state.rates);
    map.set(tx.categoryId, (map.get(tx.categoryId) || 0) + value);
  }

  const total = [...map.values()].reduce((sum, value) => sum + value, 0) || 1;

  return [...map.entries()]
    .map(([categoryId, value]) => {
      const cat = state.categories.find((c) => c.id === categoryId);
      return {
        id: categoryId,
        name: cat?.name || t('tx.noCategory'),
        color: cat?.color || '#8a8a94',
        icon: cat?.icon || '•',
        total: value,
        share: Math.round((value / total) * 100),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Группировка по дням для списка операций. */
export function groupByDate(list) {
  const groups = new Map();
  for (const tx of list) {
    if (!groups.has(tx.date)) groups.set(tx.date, []);
    groups.get(tx.date).push(tx);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/**
 * Похожие операции — защита от двойного ввода.
 *
 * Ссылка на чек совпадает точно; в остальном ловим ту же сумму в той же
 * валюте рядом по датам, потому что чаще всего дублируют именно её.
 *
 * Суммы сверяем и точно, и после округления до знаков валюты: у динара их
 * ноль, поэтому записи, сохранённые раньше, лежат в базе без копеек. Иначе
 * покупка из чека и SMS о том же списании выглядели бы разными операциями.
 */
export function findDuplicates(state, candidate, { excludeId = null, dayWindow = 3 } = {}) {
  const amount = Number(candidate.amount) || 0;
  if (!amount) return [];

  const url = String(candidate.receiptUrl || '').trim();
  const day = 24 * 60 * 60 * 1000;
  const when = Date.parse(candidate.date);

  return state.transactions
    .filter((tx) => {
      if (tx.id === excludeId) return false;
      if (url && String(tx.receiptUrl || '').trim() === url) return true;

      if (tx.type !== candidate.type) return false;
      if (tx.currency !== candidate.currency) return false;
      if (!sameAmount(Number(tx.amount), amount, tx.currency)) return false;

      const diff = Math.abs(Date.parse(tx.date) - when);
      return Number.isFinite(diff) && diff <= dayWindow * day;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Совпадение сумм: точное либо в пределах округления валюты. */
function sameAmount(a, b, currency) {
  if (Math.abs(a - b) <= 0.001) return true;
  return Math.abs(round(a, currency) - round(b, currency)) <= 0.001;
}

/**
 * Точное время покупки — самый надёжный признак того, что это одна и та же
 * операция: две разные покупки в одном магазине на ту же сумму в ту же минуту
 * практически не встречаются.
 */
export function sameMoment(tx, candidate) {
  return Boolean(tx.time) && Boolean(candidate.time)
    && tx.date === candidate.date
    && tx.time === candidate.time;
}

/**
 * Чем именно похожа найденная операция.
 *
 * Правило поиска повторов живёт в коде, а человеку показывают только итог
 * «похоже на повтор» — и непонятно, что именно сработало. Разбор совпадения
 * позволяет предупреждению объяснить себя словами: совпала сумма, разошлись
 * даты на день, магазин другой.
 */
export function duplicateMatch(tx, candidate) {
  const url = String(candidate.receiptUrl || '').trim();
  const day = 24 * 60 * 60 * 1000;
  const gap = Math.abs(Date.parse(tx.date) - Date.parse(candidate.date));

  return {
    byReceipt: Boolean(url) && String(tx.receiptUrl || '').trim() === url,
    sameTime: sameMoment(tx, candidate),
    sameDay: tx.date === candidate.date,
    dayDiff: Number.isFinite(gap) ? Math.round(gap / day) : null,
    sameAmount: sameAmount(Number(tx.amount), Number(candidate.amount) || 0, tx.currency)
      && tx.currency === candidate.currency,
    sameMerchant: Boolean(normText(tx.merchant))
      && normText(tx.merchant) === normText(candidate.merchant),
    sameCategory: Boolean(tx.categoryId) && tx.categoryId === candidate.categoryId,
  };
}

const normText = (value) => String(value || '').trim().toLowerCase();

/**
 * Товары для быстрого выбора: сначала то, что покупали раньше (частое выше),
 * затем базовый список. Цена берётся из последней покупки в этой валюте.
 */
export function quickItemSuggestions(state, currency, defaults = []) {
  const seen = new Map();

  // Транзакции приходят от новых к старым, поэтому первая цена — самая свежая.
  for (const tx of state.transactions) {
    for (const item of tx.items || []) {
      const name = String(item.name || '').trim();
      if (!name) continue;

      const key = name.toLowerCase();
      const entry = seen.get(key) || { name, count: 0, price: 0 };
      entry.count += 1;
      if (!entry.price && tx.currency === currency) entry.price = Number(item.price) || 0;
      seen.set(key, entry);
    }
  }

  for (const name of defaults) {
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, { name, count: 0, price: 0 });
  }

  return [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Состояние регулярных платежей за месяц.
 * Оплаченным считается счёт, по которому есть транзакция с его billId.
 * Ожидаемая сумма: у постоянных — из счёта, у остальных — из прошлой оплаты.
 */
export function billsForMonth(state, month = state.month) {
  const paidBy = new Map();
  const lastAmount = new Map();

  for (const tx of state.transactions) {
    if (!tx.billId) continue;
    if (monthOf(tx.date) === month) paidBy.set(tx.billId, tx);
    // Транзакции отсортированы от новых к старым — первая встреченная свежайшая.
    if (!lastAmount.has(tx.billId)) lastAmount.set(tx.billId, Number(tx.amount) || 0);
  }

  return state.bills
    .filter((bill) => bill.active !== false || paidBy.has(bill.id))
    .map((bill) => {
      const tx = paidBy.get(bill.id) || null;
      const expected = bill.fixed
        ? Number(bill.amount) || 0
        : lastAmount.get(bill.id) || Number(bill.amount) || 0;

      return {
        bill,
        tx,
        paid: Boolean(tx),
        expected,
        /** Месяц раньше начала слежения — не напоминаем и не подсвечиваем. */
        tracked: !bill.startMonth || month >= bill.startMonth,
      };
    });
}

/** Неоплаченные счета месяца. Будущие месяцы не тревожим. */
export function unpaidBills(state, month = state.month) {
  if (month > monthOf(new Date().toISOString())) return [];
  return billsForMonth(state, month).filter((row) => !row.paid && row.tracked);
}

/** Динамика доходов и расходов за последние N месяцев, включая выбранный. */
export function monthlySeries(state, count = 6) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(shiftMonth(state.month, -i));

  return keys.map((key) => {
    const list = state.transactions.filter((tx) => monthOf(tx.date) === key);
    const { income, expense } = totals(list, state);
    return { month: key, income, expense };
  });
}
