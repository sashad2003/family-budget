/**
 * Статистика: круг расходов по категориям, динамика по месяцам и сравнение
 * доходов с расходами.
 *
 * Графики рисуются своими силами, обычным SVG (см. ui/plot.js). Раньше их
 * рисовала Chart.js с внешнего адреса, и там, где этот адрес недоступен,
 * весь экран оставался пустыми прямоугольниками — при том что цифры в
 * таблице под ними были на месте.
 */

import { el, render } from '../core/dom.js?v=133';
import { state, set } from '../core/store.js?v=133';
import { formatAmount } from '../core/money.js?v=133';
import { monthLabel, shiftMonth } from '../core/dates.js?v=133';
import { PERIODS, resolvePeriod, monthsBetween } from '../core/period.js?v=133';
import { rangeTransactions, byCategory, totals, seriesForMonths } from '../core/selectors.js?v=133';
import { t, getLocale } from '../core/i18n.js?v=133';
import { themeColor } from '../core/theme.js?v=133';
import { donut, lines, barsH } from '../ui/plot.js?v=133';

/**
 * Раньше здесь уничтожались холсты Chart.js, иначе она держала их и текла
 * памятью. SVG живёт сам и исчезает вместе с разметкой, но вызовы остались
 * в main.js при смене экрана — пусть ничего не делают, чем править четыре
 * места ради пустоты.
 */
export function destroyCharts() {}

export function renderCharts() {
  destroyCharts();

  const period = resolvePeriod(state);
  const list = rangeTransactions(state, period);
  const container = el('div');
  const head = [periodPicker(), periodCaption(period, list.length)];

  if (!list.length) {
    render(container, [
      ...head,
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__ico' }, '📊'),
        el('div', {}, t('charts.noData')),
      ]),
    ]);
    return container;
  }

  const expenses = list.filter((tx) => tx.type === 'expense');
  const cats = byCategory(expenses, state);

  /*
   * Динамику всегда показываем на нескольких месяцах, даже когда выбран один.
   *
   * «Месяц» стоит по умолчанию, и график из одной точки выглядел поломкой:
   * линии нет, таблицы под ним нет, и непонятно, то ли данных не хватает, то
   * ли что-то сломалось. Полгода назад — это контекст, ради которого на
   * график и смотрят; остальные карточки по-прежнему считают ровно период.
   */
  const trendMonths = period.months.length > 1
    ? period.months
    : monthsBetween(shiftMonth(state.month, -5), state.month);
  const wider = trendMonths.length > period.months.length;

  const series = seriesForMonths(state, trendMonths);
  const { income, expense, balance } = totals(list, state);

  const grid = themeColor('--edge', 'rgba(255,255,255,0.09)');
  const ink = themeColor('--fg-1', '#8a8a94');
  const incomeColor = themeColor('--income', '#2dd98a');
  const expenseColor = themeColor('--expense', '#ff5b5b');

  render(container, [
    ...head,
    summaryCard(income, expense, balance, period.months.length),

    el('div', { class: 'chart-grid' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__label' }, t('charts.byCategory')),
        el('div', { class: 'chart-box' },
          donut(cats.map((row) => ({ value: row.total, color: row.color, label: row.name })))),
        el('div', { class: 'bar-legend', style: 'margin-top:16px' }, cats.map((row) =>
          el('div', { class: 'legend-row' }, [
            el('span', { class: 'legend-dot', style: `background:${row.color}` }),
            el('span', { class: 'legend-name' }, [
              el('span', { class: 'chip__ico' }, row.icon), row.name,
            ]),
            el('span', { class: 'legend-val' },
              `${row.share}% · ${formatAmount(row.total, state.base)}`),
          ]),
        )),
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card__label' },
          series.length > 1 ? t('charts.trendN', { n: series.length }) : t('charts.trend')),
        el('div', { class: 'chart-box' }, lines({
          labels: series.map((row) => shortMonth(row.month)),
          lines: [
            { label: t('charts.income'), color: incomeColor, values: series.map((r) => r.income) },
            { label: t('charts.expense'), color: expenseColor, values: series.map((r) => r.expense) },
          ],
          grid,
          ink,
        })),
        el('div', { class: 'bar-legend', style: 'margin-top:12px' }, [
          legendRow(t('charts.income'), incomeColor),
          legendRow(t('charts.expense'), expenseColor),
        ]),
        // Период один месяц, а на графике их шесть — говорим об этом, иначе
        // цифры под ним не сойдутся с итогом периода.
        wider ? el('p', { class: 'hint', style: 'margin-top:10px' }, t('charts.trendWider')) : null,
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card__label' }, t('charts.inOut')),
        el('div', { class: 'chart-box', style: 'height:130px' }, barsH({
          items: [
            { label: t('charts.income'), value: income, color: incomeColor },
            { label: t('charts.expense'), value: expense, color: expenseColor },
          ],
          ink,
          format: (value) => formatAmount(value, state.base, { whole: true }),
        })),
        // Пустая половина круга ничего не объясняет: доходов может не быть
        // вовсе, и тогда дело не в графике, а в том, что их не записывают.
        income ? null : el('p', { class: 'hint', style: 'margin-top:10px' }, t('charts.noIncome')),
      ]),
    ]),

    series.length > 1 ? monthTable(series) : null,
  ]);

  return container;
}

// ---------------------------------------------------------------- период

function periodPicker() {
  const kind = state.period?.kind || 'month';

  const chips = el('div', { class: 'chip-row' }, PERIODS.map((item) =>
    el('button', {
      class: `chip ${kind === item.kind ? 'is-active' : ''}`,
      onclick: () => set({
        period: item.kind === 'custom'
          ? { kind: 'custom', from: state.period?.from || '', to: state.period?.to || '' }
          : { kind: item.kind },
      }),
    }, t(`period.${item.kind}`)),
  ));

  if (kind !== 'custom') return chips;

  // Свой срок: пустые поля означают границы выбранного месяца
  const dateInput = (field) => el('input', {
    class: 'input',
    type: 'date',
    value: state.period[field] || '',
    oninput: (e) => set({ period: { ...state.period, [field]: e.target.value } }),
  });

  return el('div', {}, [
    chips,
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('div', {}, [el('label', { class: 'field__label' }, t('charts.from')), dateInput('from')]),
      el('div', {}, [el('label', { class: 'field__label' }, t('charts.to')), dateInput('to')]),
    ]),
  ]);
}

function periodCaption(period, count) {
  return el('p', { class: 'hint', style: 'margin:12px 0 16px' },
    `${period.label} · ${txCount(count)}`);
}

// ---------------------------------------------------------------- итоги

function summaryCard(income, expense, balance, monthCount) {
  return el('div', { class: 'card balance' }, [
    el('div', { class: 'balance__label' }, t(balance < 0 ? 'charts.minus' : 'charts.plus')),
    el('div', {
      class: 'balance__value num',
      style: `color:${balance < 0 ? 'var(--expense)' : 'var(--income)'}`,
    }, formatAmount(balance, state.base, { sign: true })),

    el('div', { class: 'sum-rows' }, [
      sumRow(t('charts.income'), income, 'var(--income)'),
      sumRow(t('charts.expense'), expense, 'var(--expense)'),
    ]),

    monthCount > 1
      ? el('div', { class: 'sum-rows' }, [
          sumRow(t('charts.avgMonth'), balance / monthCount, balance < 0 ? 'var(--expense)' : 'var(--fg-0)', true),
          sumRow(t('charts.expenseMonth'), expense / monthCount, 'var(--fg-1)'),
        ])
      : null,
  ]);
}

function sumRow(label, value, color, sign = false) {
  return el('div', { class: 'sum-row' }, [
    el('span', {}, label),
    el('span', { class: 'num', style: `color:${color}` }, formatAmount(value, state.base, { sign })),
  ]);
}

/** Таблица по месяцам — видно, какой именно месяц утащил в минус. */
function monthTable(series) {
  return el('div', {}, [
    el('div', { class: 'section__head' }, el('h2', { class: 'section__title' }, t('charts.byMonth'))),
    el('div', { class: 'card' }, [
      el('div', { class: 'mrow mrow--head' }, [
        el('span', {}, t('charts.colMonth')),
        el('span', {}, t('charts.colIncome')),
        el('span', {}, t('charts.colExpense')),
        el('span', {}, t('charts.colTotal')),
      ]),
      ...series.slice().reverse().map((row) => {
        const balance = row.income - row.expense;
        return el('div', { class: 'mrow' }, [
          el('span', { class: 'mrow__month' }, monthLabel(row.month)),
          el('span', { class: 'num', style: 'color:var(--income)' },
            formatAmount(row.income, state.base)),
          el('span', { class: 'num', style: 'color:var(--expense)' },
            formatAmount(row.expense, state.base)),
          el('span', {
            class: 'num',
            style: `color:${balance < 0 ? 'var(--expense)' : 'var(--fg-0)'}`,
          }, formatAmount(balance, state.base, { sign: true })),
        ]);
      }),
    ]),
  ]);
}

// ---------------------------------------------------------------- графики

/** Строка легенды: точка цвета и подпись — одна на каждую линию графика. */
function legendRow(label, color) {
  return el('div', { class: 'legend-row' }, [
    el('span', { class: 'legend-dot', style: `background:${color}` }),
    el('span', { class: 'legend-name' }, label),
  ]);
}

/** 'июл' на коротком периоде, 'июл 25' — когда важен год. */
function shortMonth(key) {
  const [name, year] = monthLabel(key).split(' ');
  return year ? `${name.slice(0, 3)} ${year.slice(2)}` : name.slice(0, 3);
}

/** «12 операций» — три формы нужны только русскому. */
function txCount(n) {
  if (getLocale() !== 'ru') return t('charts.txCount', { n });

  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} операция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} операции`;
  return `${n} операций`;
}
