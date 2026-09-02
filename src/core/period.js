/**
 * Периоды для статистики. Месяц может быть в плюсе, а год — в минусе,
 * поэтому итоги должны считаться на любом отрезке, а не только за месяц.
 *
 * Отсчёт идёт от выбранного в шапке месяца: 3 месяца — это он и два до него.
 */

import { monthRange, monthLabel, shiftMonth, today, monthOf } from './dates.js?v=118';
import { t } from './i18n.js?v=118';

export const PERIODS = [
  // Подписи берутся из словаря при отрисовке: набор периодов от языка не зависит.
  { kind: 'month' },
  { kind: 'm3' },
  { kind: 'm6' },
  { kind: 'm12' },
  { kind: 'ytd' },
  { kind: 'all' },
  { kind: 'custom' },
];

const MONTHS_BACK = { m3: 3, m6: 6, m12: 12 };

/**
 * Границы периода: { from, to, months, label }.
 * from/to — даты 'YYYY-MM-DD' включительно, months — список месяцев для графика.
 */
export function resolvePeriod(state) {
  const period = state.period || { kind: 'month' };
  const anchor = state.month;
  const [, monthEnd] = monthRange(anchor);

  if (period.kind === 'custom') {
    const from = period.from || monthRange(anchor)[0];
    const to = period.to || monthEnd;
    // Хвостом вперёд не считаем: если границы перевёрнуты, меняем местами.
    const [a, b] = from <= to ? [from, to] : [to, from];
    return { from: a, to: b, months: monthsBetween(monthOf(a), monthOf(b)), label: `${a} — ${b}` };
  }

  if (period.kind === 'all') {
    const earliest = state.transactions.length
      ? state.transactions[state.transactions.length - 1].date
      : monthRange(anchor)[0];
    const latest = maxDate(monthEnd, today());
    return {
      from: earliest,
      to: latest,
      months: monthsBetween(monthOf(earliest), monthOf(latest)),
      label: t('period.allLower'),
    };
  }

  if (period.kind === 'ytd') {
    const year = anchor.slice(0, 4);
    return {
      from: `${year}-01-01`,
      to: monthEnd,
      months: monthsBetween(`${year}-01`, anchor),
      label: `${year} год`,
    };
  }

  const back = MONTHS_BACK[period.kind];
  if (back) {
    const startMonth = shiftMonth(anchor, -(back - 1));
    return {
      from: monthRange(startMonth)[0],
      to: monthEnd,
      months: monthsBetween(startMonth, anchor),
      label: `${monthLabel(startMonth)} — ${monthLabel(anchor)}`,
    };
  }

  const [from, to] = monthRange(anchor);
  return { from, to, months: [anchor], label: monthLabel(anchor) };
}

/** Список месяцев от одного до другого включительно. */
export function monthsBetween(fromKey, toKey) {
  const out = [];
  let cursor = fromKey;
  // Предохранитель: 40 лет месяцев хватит любому бюджету.
  for (let i = 0; cursor <= toKey && i < 480; i += 1) {
    out.push(cursor);
    cursor = shiftMonth(cursor, 1);
  }
  return out;
}

const maxDate = (a, b) => (a > b ? a : b);
