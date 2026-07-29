/** Выборки и агрегаты над транзакциями. Чистые функции — их удобно переиспользовать. */

import { txAmountIn } from './money.js?v=2';
import { monthOf, shiftMonth } from './dates.js?v=2';

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
