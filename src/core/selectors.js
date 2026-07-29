/** Выборки и агрегаты над транзакциями. Чистые функции — их удобно переиспользовать. */

import { txAmountIn } from './money.js?v=4';
import { monthOf, shiftMonth } from './dates.js?v=4';

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
        name: cat?.name || 'Без категории',
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
 * Ссылка на чек совпадает точно; в остальном ловим ту же сумму в той же
 * валюте рядом по датам, потому что чаще всего дублируют именно её.
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
      if (Math.abs(Number(tx.amount) - amount) > 0.001) return false;

      const diff = Math.abs(Date.parse(tx.date) - when);
      return Number.isFinite(diff) && diff <= dayWindow * day;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

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
