/** Главная: баланс за месяц, доходы/расходы, разбивка по категориям, последние операции. */

import { el } from '../core/dom.js';
import { state } from '../core/store.js';
import { formatAmount } from '../core/money.js';
import { monthTransactions, totals, byCategory } from '../core/selectors.js';
import { txRow } from './list.js';
import { openTxForm } from './txForm.js';

export function renderDashboard() {
  const list = monthTransactions(state);
  const { income, expense, balance } = totals(list, state);

  if (!list.length) {
    return [
      balanceCard(balance, income, expense),
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__ico' }, '🧾'),
        el('div', {}, 'В этом месяце пока пусто'),
        el('div', { class: 'hint' }, 'Нажмите «+», чтобы добавить операцию или отсканировать чек'),
      ]),
    ];
  }

  const categories = byCategory(list.filter((tx) => tx.type === 'expense'), state);
  const recent = list.slice(0, 5);

  return [
    balanceCard(balance, income, expense),

    categories.length
      ? el('div', {}, [
          el('div', { class: 'section-title' }, [el('span', {}, 'Расходы по категориям')]),
          el('div', { class: 'card' }, [
            el('div', { class: 'bar-legend' }, categories.slice(0, 6).map((row) =>
              el('div', { class: 'legend-row' }, [
                el('span', { class: 'legend-dot', style: `background:${row.color}` }),
                el('span', { class: 'legend-name' }, row.name),
                el('span', { class: 'legend-val' }, formatAmount(row.total, state.base)),
                el('span', { style: 'color:var(--fg-2);font-size:11.5px;width:34px;text-align:right' },
                  `${row.share}%`),
              ]),
            )),
          ]),
        ])
      : null,

    el('div', {}, [
      el('div', { class: 'section-title' }, [el('span', {}, 'Последние операции')]),
      ...recent.map((tx) => txRow(tx, () => openTxForm({ tx }))),
    ]),
  ];
}

function balanceCard(balance, income, expense) {
  return el('div', {}, [
    el('div', { class: 'card balance' }, [
      el('div', { class: 'card__label' }, 'Баланс за месяц'),
      el('div', {
        class: 'balance__value num',
        style: balance < 0 ? 'color:var(--expense)' : 'color:var(--income)',
      }, formatAmount(balance, state.base, { sign: true })),
      el('div', { class: 'balance__sub' }, `в ${state.base}`),
    ]),

    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat stat--in' }, [
        el('div', { class: 'stat__label' }, 'Доходы'),
        el('div', { class: 'stat__value num' }, formatAmount(income, state.base)),
      ]),
      el('div', { class: 'stat stat--out' }, [
        el('div', { class: 'stat__label' }, 'Расходы'),
        el('div', { class: 'stat__value num' }, formatAmount(expense, state.base)),
      ]),
    ]),
  ]);
}
