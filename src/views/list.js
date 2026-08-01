/** Список операций с фильтрами по типу, категории и тексту. */

import { el, render } from '../core/dom.js?v=29';
import { state } from '../core/store.js?v=29';
import { formatAmount, txAmountIn } from '../core/money.js?v=29';
import { dayLabel } from '../core/dates.js?v=29';
import { monthTransactions, groupByDate, totals } from '../core/selectors.js?v=29';
import { openTxForm } from './txForm.js?v=29';

/** Фильтры живут вне state: они локальны для экрана и не влияют на другие. */
const filters = { type: 'all', categoryId: null, query: '' };

export function renderList() {
  const container = el('div');

  const draw = () => {
    const list = monthTransactions(state, filters);
    const { income, expense } = totals(list, state);

    render(container, [
      filterBar(draw),

      list.length
        ? el('div', {}, [
            el('div', {
              class: 'section-title',
            }, [
              el('span', {}, `${list.length} операц${plural(list.length)}`),
              el('span', { class: 'num', style: 'font-size:12px' },
                `+${formatAmount(income, state.base)} · −${formatAmount(expense, state.base)}`),
            ]),
            ...groupByDate(list).map(([date, items]) =>
              el('div', {}, [
                el('div', { class: 'tx-group__date' }, dayLabel(date)),
                ...items.map((tx) => txRow(tx, () => openTxForm({ tx }))),
              ]),
            ),
          ])
        : el('div', { class: 'empty' }, [
            el('span', { class: 'empty__ico' }, '🔍'),
            el('div', {}, 'Ничего не найдено'),
          ]),
    ]);
  };

  draw();
  return container;
}

function filterBar(draw) {
  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Поиск по описанию, магазину, товарам',
    value: filters.query,
    oninput: (e) => { filters.query = e.target.value; draw(); },
  });

  const typeChips = ['all', 'expense', 'income'].map((value) =>
    el('button', {
      class: `chip ${filters.type === value ? 'is-active' : ''}`,
      onclick: () => { filters.type = value; filters.categoryId = null; draw(); },
    }, { all: 'Все', expense: 'Расходы', income: 'Доходы' }[value]),
  );

  const pool = state.categories.filter(
    (c) => !c.archived && (filters.type === 'all' || c.type === filters.type),
  );

  const catChips = pool.map((cat) =>
    el('button', {
      class: `chip ${filters.categoryId === cat.id ? 'is-active' : ''}`,
      style: filters.categoryId === cat.id ? `color:${cat.color}` : '',
      onclick: () => {
        filters.categoryId = filters.categoryId === cat.id ? null : cat.id;
        draw();
      },
    }, `${cat.icon} ${cat.name}`),
  );

  return el('div', { style: 'margin-bottom:4px' }, [
    search,
    el('div', { class: 'chip-row', style: 'margin-top:10px' }, typeChips),
    el('div', { class: 'chip-row', style: 'margin-top:7px' }, catChips),
  ]);
}

/** Строка операции. Используется и на главной, и в списке. */
export function txRow(tx, onClick) {
  const cat = state.categories.find((c) => c.id === tx.categoryId);
  const isIncome = tx.type === 'income';

  const title = tx.merchant || cat?.name || 'Операция';
  const metaParts = [];
  // Список уже сгруппирован по дням, поэтому в строке полезно только время.
  if (tx.time) metaParts.push(tx.time);
  if (tx.merchant && cat) metaParts.push(cat.name);
  if (tx.note) metaParts.push(tx.note);
  else if (tx.items?.length) metaParts.push(`${tx.items.length} поз.`);
  if (tx.source === 'sms') metaParts.push('SMS');
  else if (tx.source !== 'manual') metaParts.push('чек');

  const inBase = txAmountIn(tx, state.base, state.rates);

  return el('button', { class: 'tx', onclick: onClick }, [
    el('div', {
      class: 'tx__ico',
      style: `background:${tileGradient(cat?.color)}`,
    }, cat?.icon || '•'),

    el('div', { class: 'tx__body' }, [
      el('div', { class: 'tx__title' }, title),
      metaParts.length ? el('div', { class: 'tx__meta' }, metaParts.join(' · ')) : null,
    ]),

    el('div', {}, [
      el('div', {
        class: `tx__amount num ${isIncome ? 'tx__amount--in' : 'tx__amount--out'}`,
      }, `${isIncome ? '+' : '−'}${formatAmount(tx.amount, tx.currency, { exact: true })}`),

      tx.currency !== state.base
        ? el('span', { class: 'tx__converted num' }, `≈ ${formatAmount(inBase, state.base)}`)
        : null,
    ]),
  ]);
}

/**
 * Насыщенная плитка под иконку категории: цвет категории с уходом в тень,
 * как цветные квадраты в референсе.
 */
export function tileGradient(hex) {
  const value = String(hex || '').replace('#', '');
  if (value.length !== 6) return 'linear-gradient(150deg, #3a3a52, #23233a)';

  const rgb = [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
  const darker = rgb
    .map((c) => Math.round(c * 0.62).toString(16).padStart(2, '0'))
    .join('');

  return `linear-gradient(150deg, #${value}, #${darker})`;
}

function plural(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ия';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ии';
  return 'ий';
}
