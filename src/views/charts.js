/**
 * Графики на Chart.js: расходы по категориям, динамика по месяцам, доходы vs расходы.
 * Библиотека грузится с CDN по требованию — на других экранах она не нужна.
 */

import { el, render } from '../core/dom.js?v=5';
import { state } from '../core/store.js?v=5';
import { formatAmount } from '../core/money.js?v=5';
import { monthLabel } from '../core/dates.js?v=5';
import { monthTransactions, byCategory, totals, monthlySeries } from '../core/selectors.js?v=5';

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
  const container = el('div');
  const list = monthTransactions(state);

  if (!list.length) {
    render(container, el('div', { class: 'empty' }, [
      el('span', { class: 'empty__ico' }, '📊'),
      el('div', {}, 'За этот месяц нет данных'),
    ]));
    return container;
  }

  const expenses = list.filter((tx) => tx.type === 'expense');
  const cats = byCategory(expenses, state);
  const series = monthlySeries(state, 6);
  const { income, expense } = totals(list, state);

  const donutCanvas = el('canvas');
  const trendCanvas = el('canvas');
  const compareCanvas = el('canvas');

  render(container, el('div', { class: 'chart-grid' }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'card__label' }, `Расходы по категориям · ${monthLabel(state.month)}`),
      el('div', { class: 'chart-box' }, donutCanvas),
      el('div', { class: 'bar-legend', style: 'margin-top:16px' }, cats.map((row) =>
        el('div', { class: 'legend-row' }, [
          el('span', { class: 'legend-dot', style: `background:${row.color}` }),
          el('span', { class: 'legend-name' }, `${row.icon} ${row.name}`),
          el('span', { class: 'legend-val' }, formatAmount(row.total, state.base)),
        ]),
      )),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__label' }, 'Динамика за 6 месяцев'),
      el('div', { class: 'chart-box' }, trendCanvas),
    ]),

    el('div', { class: 'card' }, [
      el('div', { class: 'card__label' }, 'Доходы и расходы за месяц'),
      el('div', { class: 'chart-box', style: 'height:190px' }, compareCanvas),
    ]),
  ]));

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
        labels: series.map((row) => monthLabel(row.month).slice(0, 3)),
        datasets: [
          lineSet('Доходы', series.map((r) => Math.round(r.income)), '#2dd98a'),
          lineSet('Расходы', series.map((r) => Math.round(r.expense)), '#ff5b5b'),
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
        labels: ['Доходы', 'Расходы'],
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
    container.append(el('p', { class: 'hint' }, 'Не удалось загрузить библиотеку графиков'));
  });

  return container;
}

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
    pointRadius: 3,
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
