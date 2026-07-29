/** Обзор: баланс месяца, доходы/расходы, разбивка по категориям, последние операции. */

import { el } from '../core/dom.js?v=3';
import { state } from '../core/store.js?v=3';
import { formatAmount } from '../core/money.js?v=3';
import { monthTransactions, totals, byCategory } from '../core/selectors.js?v=3';
import { txRow, tileGradient } from './list.js?v=3';
import { openTxForm } from './txForm.js?v=3';
import { openScanSheet } from './scan.js?v=3';

export function renderDashboard() {
  const list = monthTransactions(state);
  const { income, expense, balance } = totals(list, state);

  if (!list.length) {
    return [
      balanceBlock(balance, income, expense),
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__ico' }, '🧾'),
        el('div', {}, 'В этом месяце пока пусто'),
        el('div', { class: 'hint' }, 'Добавьте операцию или отсканируйте чек — данные появятся здесь'),
        el('button', {
          class: 'btn btn--ghost',
          style: 'margin-top:18px',
          onclick: () => openScanSheet((draft) => openTxForm({ draft })),
        }, '📷  Отсканировать чек'),
      ]),
    ];
  }

  const categories = byCategory(list.filter((tx) => tx.type === 'expense'), state);
  const recent = list.slice(0, 6);

  // Две колонки на широком экране, одна на телефоне — раскладку задаёт CSS.
  return el('div', { class: 'dash' }, [
    el('div', { class: 'dash__main' }, [
      balanceBlock(balance, income, expense),
      categories.length ? categoriesCard(categories) : null,
    ]),

    el('div', { class: 'dash__side' }, [
      el('div', { class: 'section-title' }, [
        el('span', {}, 'Последние операции'),
        el('button', { class: 'chip', onclick: () => window.dispatchEvent(new CustomEvent('goto-list')) }, 'все'),
      ]),
      ...recent.map((tx) => txRow(tx, () => openTxForm({ tx }))),
    ]),
  ]);
}

function balanceBlock(balance, income, expense) {
  return el('div', {}, [
    el('div', { class: 'card balance' }, [
      el('div', { class: 'balance__label' }, 'Баланс за месяц'),
      el('div', {
        class: 'balance__value num',
        style: `color:${balance < 0 ? 'var(--expense)' : 'var(--fg-0)'}`,
      }, formatAmount(balance, state.base, { sign: true })),
      el('div', { class: 'balance__sub' }, `сводка в ${state.base} · курс зафиксирован на каждой операции`),
    ]),

    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat stat--in' }, [
        el('div', { class: 'stat__label' }, [el('span', { class: 'stat__dot' }), 'Доходы']),
        el('div', { class: 'stat__value num' }, formatAmount(income, state.base)),
      ]),
      el('div', { class: 'stat stat--out' }, [
        el('div', { class: 'stat__label' }, [el('span', { class: 'stat__dot' }), 'Расходы']),
        el('div', { class: 'stat__value num' }, formatAmount(expense, state.base)),
      ]),
    ]),
  ]);
}

function categoriesCard(categories) {
  return el('div', {}, [
    el('div', { class: 'section-title' }, [el('span', {}, 'Куда уходят деньги')]),
    el('div', { class: 'card' }, [
      el('div', { class: 'bar-legend' }, categories.slice(0, 7).map((row) =>
        el('div', {}, [
          el('div', { class: 'legend-row' }, [
            el('span', {
              class: 'tx__ico',
              style: `flex:0 0 30px;height:30px;border-radius:9px;font-size:14px;background:${tileGradient(row.color)}`,
            }, row.icon),
            el('span', { class: 'legend-name' }, row.name),
            el('span', { class: 'legend-val' }, formatAmount(row.total, state.base)),
            el('span', {
              style: 'width:38px;text-align:right;color:var(--fg-2);font-size:11.5px',
            }, `${row.share}%`),
          ]),
          el('div', { class: 'legend-bar' }, el('i', {
            style: `width:${Math.max(row.share, 2)}%;background:${tileGradient(row.color)}`,
          })),
        ]),
      )),
    ]),
  ]);
}
