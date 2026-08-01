/**
 * Статистика за выбранный период: итоги, расходы по категориям,
 * динамика по месяцам, доходы против расходов.
 *
 * Период задаётся здесь же: месяц может быть в плюсе, а год — в минусе,
 * поэтому итог по одному месяцу ничего не говорит о картине в целом.
 * Chart.js грузится с CDN по требованию — на других экранах он не нужен.
 */

import { el, render } from '../core/dom.js?v=39';
import { state, set } from '../core/store.js?v=39';
import { formatAmount } from '../core/money.js?v=39';
import { monthLabel } from '../core/dates.js?v=39';
import { PERIODS, resolvePeriod } from '../core/period.js?v=39';
import { rangeTransactions, byCategory, totals, seriesForMonths } from '../core/selectors.js?v=39';
import { t, getLocale } from '../core/i18n.js?v=39';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/+esm';

let ChartLib = null;
const charts = [];

async function loadChartJs() {
  if (!ChartLib) {
    const module = await import(CHART_JS);
    ChartLib = module.default || module.Chart;
    ChartLib.defaults.color = '#8a8a94';
    ChartLib.defaults.font.family = "'Geologica', sans-serif";
    ChartLib.defaults.font.size = 13;
  }
  return ChartLib;
}

/** Уничтожает предыдущие графики — иначе Chart.js держит canvas и течёт память. */
export function destroyCharts() {
  while (charts.length) charts.pop().destroy();
}

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
  const series = seriesForMonths(state, period.months);
  const { income, expense, balance } = totals(list, state);

  const donutCanvas = el('canvas');
  const trendCanvas = el('canvas');
  const compareCanvas = el('canvas');

  render(container, [
    ...head,
    summaryCard(income, expense, balance, period.months.length),

    el('div', { class: 'chart-grid' }, [
      el('div', { class: 'card' }, [
        el('div', { class: 'card__label' }, t('charts.byCategory')),
        el('div', { class: 'chart-box' }, donutCanvas),
        el('div', { class: 'bar-legend', style: 'margin-top:16px' }, cats.map((row) =>
          el('div', { class: 'legend-row' }, [
            el('span', { class: 'legend-dot', style: `background:${row.color}` }),
            el('span', { class: 'legend-name' }, `${row.icon} ${row.name}`),
            el('span', { class: 'legend-val' },
              `${row.share}% · ${formatAmount(row.total, state.base)}`),
          ]),
        )),
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card__label' },
          series.length > 1 ? t('charts.trendN', { n: series.length }) : t('charts.trend')),
        el('div', { class: 'chart-box' }, trendCanvas),
      ]),

      el('div', { class: 'card' }, [
        el('div', { class: 'card__label' }, t('charts.inOut')),
        el('div', { class: 'chart-box', style: 'height:190px' }, compareCanvas),
      ]),
    ]),

    series.length > 1 ? monthTable(series) : null,
  ]);

  // Рисуем после того, как узлы попали в документ, иначе canvas не знает размеров.
  loadChartJs().then((Chart) => {
    if (!donutCanvas.isConnected) return;

    charts.push(new Chart(donutCanvas, {
      type: 'doughnut',
      data: {
        labels: cats.map((c) => c.name),
        datasets: [{
          data: cats.map((c) => Math.round(c.total)),
          backgroundColor: cats.map((c) => c.color),
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        ...baseOptions(),
        cutout: '62%',
        plugins: { legend: { display: false }, tooltip: moneyTooltip() },
      },
    }));

    charts.push(new Chart(trendCanvas, {
      type: 'line',
      data: {
        labels: series.map((row) => shortMonth(row.month)),
        datasets: [
          lineSet(t('charts.income'), series.map((r) => Math.round(r.income)), '#2dd98a'),
          lineSet(t('charts.expense'), series.map((r) => Math.round(r.expense)), '#ff5b5b'),
        ],
      },
      options: {
        ...baseOptions(),
        plugins: {
          legend: { display: true, labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true } },
          tooltip: moneyTooltip(),
        },
        scales: gridScales(),
      },
    }));

    charts.push(new Chart(compareCanvas, {
      type: 'bar',
      data: {
        labels: [t('charts.income'), t('charts.expense')],
        datasets: [{
          data: [Math.round(income), Math.round(expense)],
          backgroundColor: ['#2dd98a', '#ff5b5b'],
          borderRadius: 8,
          barThickness: 44,
        }],
      },
      options: {
        ...baseOptions(),
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: moneyTooltip() },
        scales: gridScales(),
      },
    }));
  }).catch((error) => {
    console.error(error);
    container.append(el('p', { class: 'hint' }, t('charts.libFailed')));
  });

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

const baseOptions = () => ({ responsive: true, maintainAspectRatio: false });

function lineSet(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: `${color}22`,
    fill: true,
    tension: 0.35,
    borderWidth: 2,
    // На длинных периодах точки сливаются в кашу.
    pointRadius: data.length > 14 ? 0 : 3,
    pointBackgroundColor: color,
  };
}

function gridScales() {
  return {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, border: { display: false } },
    y: {
      grid: { color: 'rgba(255,255,255,0.05)' },
      border: { display: false },
      ticks: { callback: (value) => compact(value) },
    },
  };
}

function moneyTooltip() {
  return {
    callbacks: {
      label: (ctx) => {
        const value = ctx.parsed?.y ?? ctx.parsed?.x ?? ctx.parsed;
        return ` ${formatAmount(value, state.base)}`;
      },
    },
  };
}

function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
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
