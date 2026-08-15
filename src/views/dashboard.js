/** Обзор: баланс месяца, доходы/расходы, разбивка по категориям, последние операции. */

import { el } from '../core/dom.js?v=65';
import { state } from '../core/store.js?v=65';
import { formatAmount } from '../core/money.js?v=65';
import { monthTransactions, totals, byCategory, unpaidBills } from '../core/selectors.js?v=65';
import { set } from '../core/store.js?v=65';
import { txRow, tileGradient } from './list.js?v=65';
import { openTxForm } from './txForm.js?v=65';
import { openScanSheet } from './scan.js?v=65';
import { section } from '../ui/section.js?v=65';
import { t } from '../core/i18n.js?v=65';
import { isRose, roseBalance } from './roseGlasses.js?v=65';

export function renderDashboard() {
  const list = monthTransactions(state);
  const { income, expense, balance } = totals(list, state);

  if (!list.length) {
    return [
      balanceBlock(balance, income, expense),
      billsReminder(),
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__ico' }, '🧾'),
        el('div', {}, t('dash.empty')),
        el('div', { class: 'hint' }, t('dash.emptyHint')),
        el('button', {
          class: 'btn btn--ghost',
          style: 'margin-top:18px',
          onclick: () => openScanSheet((draft) => openTxForm({ draft })),
        }, t('dash.scan')),
      ]),
    ];
  }

  const spent = byCategory(list.filter((tx) => tx.type === 'expense'), state);
  const earned = byCategory(list.filter((tx) => tx.type === 'income'), state);
  const recent = list.slice(0, 6);

  // Две колонки на широком экране, одна на телефоне — раскладку задаёт CSS.
  return el('div', { class: 'dash' }, [
    el('div', { class: 'dash__main' }, [
      balanceBlock(balance, income, expense),
      billsReminder(),
      spent.length ? categoriesCard(t('dash.where'), spent) : null,
      // Доходы раскрываем так же, как расходы: одной суммой не видно,
      // что именно кончилось, если в следующем месяце её не станет.
      earned.length ? categoriesCard(t('dash.from'), earned) : null,
    ]),

    el('div', { class: 'dash__side' }, [
      section(t('dash.recent'),
        recent.map((tx) => txRow(tx, () => openTxForm({ tx }))),
        el('button', {
          class: 'chip',
          onclick: () => window.dispatchEvent(new CustomEvent('goto-list')),
        }, t('common.all'))),
    ]),
  ]);
}

/** Красное напоминание о неоплаченных счетах месяца. */
function billsReminder() {
  // В розовых очках долгов не бывает — иначе шутка ломается на первом же счёте.
  if (isRose()) return null;

  const unpaid = unpaidBills(state);
  if (!unpaid.length) return null;

  return el('button', {
    class: 'card card--alert card--action',
    onclick: () => set({ route: 'bills' }),
  }, [
    el('div', { class: 'card__label', style: 'color:#ffb3b3' },
      `Не оплачено · ${unpaid.length}`),
    el('div', { style: 'font-size:16px;line-height:1.4' },
      unpaid.map((row) => row.bill.name).join(', ')),
    el('div', { class: 'hint', style: 'margin-top:6px' }, t('dash.tapToPay')),
  ]);
}

function balanceBlock(balance, income, expense) {
  if (isRose()) return roseBalance();

  return el('div', {}, [
    el('div', { class: 'card balance' }, [
      el('div', { class: 'balance__label' }, t('dash.balance')),
      el('div', {
        class: 'balance__value num',
        style: `color:${balance < 0 ? 'var(--expense)' : 'var(--fg-0)'}`,
      }, formatAmount(balance, state.base, { sign: true })),
      el('div', { class: 'balance__sub' }, `сводка в ${state.base} · курс зафиксирован на каждой операции`),
    ]),

    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat stat--in' }, [
        el('div', { class: 'stat__label' }, [el('span', { class: 'stat__dot' }), t('charts.income')]),
        el('div', { class: 'stat__value num' }, formatAmount(income, state.base)),
      ]),
      el('div', { class: 'stat stat--out' }, [
        el('div', { class: 'stat__label' }, [el('span', { class: 'stat__dot' }), t('charts.expense')]),
        el('div', { class: 'stat__value num' }, formatAmount(expense, state.base)),
      ]),
    ]),
  ]);
}

/**
 * Пирог долей — на чём уходит больше, видно раньше, чем прочитаны числа.
 *
 * Нарисован conic-gradient, без графической библиотеки. Chart.js на обзоре
 * означал бы полмегабайта с чужого сервера на самом частом экране ради одной
 * картинки без подсказок и анимации — здесь достаточно одного свойства CSS.
 *
 * Доли считаем от точных сумм, а не от округлённых процентов из byCategory:
 * их сумма даёт то 99, то 101, и на стыке появлялась щель или нахлёст.
 */
function pie(rows) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total <= 0) return null;

  const stops = [];
  let from = 0;

  rows.forEach((row, index) => {
    // Последний сегмент дотягиваем до конца сами: иначе остаток дробей
    // оставлял тонкую полоску фона.
    const to = index === rows.length - 1 ? 100 : from + (row.total / total) * 100;
    stops.push(`${safeColor(row.color)} ${from.toFixed(3)}% ${to.toFixed(3)}%`);
    from = to;
  });

  return el('div', {
    class: 'pie',
    'aria-hidden': 'true',
    style: `background: conic-gradient(${stops.join(',')})`,
  });
}

/**
 * Цвет приходит из базы, а её наполняет вся семья. В style он попадает
 * через setAttribute, так что разметку подменить нельзя, но испортить
 * страницу кривым значением можно — пропускаем только настоящие цвета.
 */
function safeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : '#8a8a94';
}

function categoriesCard(title, categories) {
  return section(title, [
    el('div', { class: 'card cat-card' }, [
      // Пирог из одного куска ничего не показывает — только занимает место.
      categories.length > 1 ? pie(categories) : null,

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
              style: 'width:42px;text-align:right;color:var(--fg-2);font-size:12.5px',
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
