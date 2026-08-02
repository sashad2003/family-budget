/**
 * Цены: где товар дешевле.
 *
 * Пишешь название — показываем магазины, отсортированные по последней цене.
 * Данные берутся из общей базы: свои чеки и чеки других пользователей.
 */

import { el, render } from '../core/dom.js?v=41';
import { state } from '../core/store.js?v=41';
import { formatAmount, convert } from '../core/money.js?v=41';
import { dayLabel } from '../core/dates.js?v=41';
import { searchPrices, groupByShop } from '../services/prices.js?v=41';
import { quickItemSuggestions } from '../core/selectors.js?v=41';
import { toastError } from '../ui/toast.js?v=41';
import { tileGradient } from './list.js?v=41';
import { openTxForm } from './txForm.js?v=41';
import { section } from '../ui/section.js?v=41';
import { t, getLocale } from '../core/i18n.js?v=41';

/** Запрос живёт вне state: он локален для экрана. */
const search = { query: '', rows: null, busy: false };

export function renderPrices() {
  const container = el('div');

  const results = el('div');

  const input = el('input', {
    class: 'input',
    type: 'search',
    placeholder: t('prices.search'),
    value: search.query,
    oninput: (e) => {
      search.query = e.target.value;
      schedule(() => run(results));
    },
  });

  render(container, [
    el('div', { style: 'margin-bottom:12px' }, [
      input,
      el('div', { class: 'hint', style: 'margin-top:8px' }, t('prices.source')),
    ]),
    suggestionRow((name) => {
      search.query = name;
      input.value = name;
      run(results);
    }),
    results,
  ]);

  drawResults(results);
  return container;
}

/** Не дёргаем базу на каждую букву. */
let timer = null;
function schedule(fn) {
  clearTimeout(timer);
  timer = setTimeout(fn, 350);
}

async function run(results) {
  const query = search.query.trim();
  if (query.length < 3) {
    search.rows = null;
    drawResults(results);
    return;
  }

  search.busy = true;
  drawResults(results);

  try {
    search.rows = await searchPrices(query);
  } catch (error) {
    console.error(error);
    search.rows = [];
    toastError(t('prices.failed'));
  } finally {
    search.busy = false;
    drawResults(results);
  }
}

/** Частые товары из своих чеков — чтобы не набирать руками. */
function suggestionRow(onPick) {
  const names = quickItemSuggestions(state, state.base)
    .filter((item) => item.count > 1)
    .slice(0, 12);

  if (!names.length) return null;

  return el('div', { class: 'chip-row', style: 'margin-bottom:12px' },
    names.map((item) => el('button', {
      class: 'chip',
      onclick: () => onPick(item.name),
    }, item.name)),
  );
}

function drawResults(node) {
  if (search.busy) {
    render(node, el('div', { class: 'empty' }, [
      el('div', { class: 'spinner' }),
    ]));
    return;
  }

  if (search.rows === null) {
    render(node, el('div', { class: 'empty' }, [
      el('span', { class: 'empty__ico' }, '🏷️'),
      el('div', {}, t('prices.prompt')),
    ]));
    return;
  }

  if (!search.rows.length) {
    render(node, el('div', { class: 'empty' }, [
      el('span', { class: 'empty__ico' }, '🤷'),
      el('div', {}, t('prices.empty')),
      el('div', { class: 'hint', style: 'margin-top:6px' }, t('prices.emptyHint')),
    ]));
    return;
  }

  const shops = groupByShop(search.rows, toBase);
  // Дешевле всех — первый в списке; с чем сравнивать, видно сразу.
  const cheapest = shops[0];

  render(node, [
    section(shopsLabel(shops.length),
      shops.map((shop) => shopRow(shop, cheapest)),
      el('span', { class: 'hint' }, t('prices.records', { n: search.rows.length }))),
  ]);
}

/** Цена в валюте сводных сумм — чтобы динары и евро сравнивались между собой. */
function toBase(price, currency) {
  return convert(Number(price) || 0, currency, state.base, state.rates);
}

function shopRow(shop, cheapest) {
  const last = shop.last;
  const inBase = toBase(last.price, last.currency);
  const cheapestBase = toBase(cheapest.last.price, cheapest.last.currency);

  // Насколько дороже самого дешёвого магазина.
  const overpay = cheapestBase > 0 ? Math.round((inBase / cheapestBase - 1) * 100) : 0;

  const meta = [dayLabel(last.date)];
  if (last.address) meta.push(last.address);
  if (shop.count > 1) meta.push(t('prices.entries', { n: shop.count }));
  if (Number(shop.min.price) < Number(last.price)) {
    meta.push(t('prices.wasCheaper', {
      price: formatAmount(shop.min.price, shop.currency, { exact: true }),
    }));
  }

  /**
   * По своей цене можно провалиться в чек, откуда она взялась: там видно всё
   * остальное, что покупалось тогда же. Чужие записи не открываем — операции
   * другой семьи нам недоступны.
   */
  const source = state.transactions.find((tx) => tx.id === last.txId) || null;

  return el(source ? 'button' : 'div', {
    class: 'tx',
    onclick: source ? () => openTxForm({ tx: source }) : null,
  }, [
    el('div', {
      class: 'tx__ico',
      style: `background:${tileGradient(overpay === 0 ? '#2dd98a' : '#5b9fff')}`,
    }, '🏪'),

    el('div', { class: 'tx__body' }, [
      el('div', { class: 'tx__title' }, last.merchant || '—'),
      el('div', { class: 'tx__meta' }, meta.join(' · ')),
      el('div', { class: 'tx__meta' }, last.norm || last.name),
    ]),

    el('div', {}, [
      el('div', {
        class: `tx__amount num ${overpay === 0 ? 'tx__amount--in' : ''}`,
      }, formatAmount(last.price, last.currency, { exact: true })),

      el('span', { class: 'tx__converted num' },
        overpay === 0 ? t('prices.cheapest') : `+${overpay}%`),
    ]),
  ]);
}

/** «3 магазина» — склонение нужно только русскому. */
function shopsLabel(n) {
  if (getLocale() !== 'ru') return t('prices.shops', { n });

  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} магазин`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} магазина`;
  return `${n} магазинов`;
}
