/**
 * Админ-панель: кто зарегистрировался.
 *
 * Виден только тем, чья почта в ADMIN_EMAILS, и это же проверяют правила
 * Firestore — спрятанной кнопки мало, чужие профили закрывает база.
 */

import { el, render } from '../core/dom.js?v=90';
import { state } from '../core/store.js?v=90';
import { formatAmount } from '../core/money.js?v=90';
import { listUsers } from '../services/account.js?v=90';
import { loadPriceRows, summarizePrices, summarizeUsers } from '../services/adminStats.js?v=90';
import { toastError, toastOk } from '../ui/toast.js?v=90';
import { section } from '../ui/section.js?v=90';
import { t, intlLocale } from '../core/i18n.js?v=90';

const cache = { users: null, query: '', prices: null };

export function renderAdmin() {
  const container = el('div');
  const body = el('div');

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: t('admin.search'),
    value: cache.query,
    oninput: (e) => { cache.query = e.target.value; draw(body); },
  });

  const activity = el('div');
  const market = el('div');

  render(container, [
    activity,
    section(t('admin.title'), [
      search,
      body,
    ], el('button', { class: 'chip', onclick: () => load(body, true) }, t('common.refresh'))),
    market,
  ]);

  load(body, false, activity);
  loadMarket(market);
  return container;
}

async function load(body, force = false, activity = null) {
  if (cache.users && !force) {
    draw(body);
    if (activity) drawActivity(activity);
    return;
  }

  render(body, el('div', { class: 'empty' }, el('div', { class: 'spinner' })));

  try {
    cache.users = await listUsers();
    draw(body);
    if (activity) drawActivity(activity);
  } catch (error) {
    console.error(error);
    toastError(t('admin.noAccess'));
    render(body, el('div', { class: 'empty' }, t('admin.loadFailed')));
  }
}

/** Сколько людей завелось и в каком они состоянии подписки. */
function drawActivity(node) {
  const stats = summarizeUsers(cache.users || []);

  render(node, section(t('admin.activity'), [
    el('div', { class: 'card' }, [
      statRow(t('admin.usersTotal'), String(stats.total)),
      statRow(t('admin.usersMonth'), String(stats.month)),
      statRow(t('admin.usersWeek'), String(stats.week)),
      statRow(t('admin.subsActive'), String(stats.active)),
      statRow(t('admin.subsTrial'), String(stats.trial)),
      statRow(t('admin.subsExpired'), String(stats.expired)),
    ]),
  ]));
}

/**
 * Витрина общей базы цен.
 *
 * Показывает только то, что и так видно каждому пользователю: товар, магазин,
 * цену. Кто именно покупал — не показывается и не считается, см. adminStats.js.
 */
async function loadMarket(node, force = false) {
  if (!cache.prices || force) {
    render(node, el('div', { class: 'empty' }, el('div', { class: 'spinner' })));
    try {
      cache.prices = await loadPriceRows();
    } catch (error) {
      console.error(error);
      render(node, el('div', { class: 'empty' }, t('admin.loadFailed')));
      return;
    }
  }

  const stats = summarizePrices(cache.prices, state.base, state.rates);
  const money = (value) => formatAmount(value, state.base, { whole: true });

  if (!stats.rows) {
    render(node, section(t('admin.market'), el('div', { class: 'empty' }, t('admin.marketEmpty'))));
    return;
  }

  render(node, [
    section(t('admin.market'), [
      el('div', { class: 'card' }, [
        statRow(t('admin.rows'), String(stats.rows)),
        statRow(t('admin.receipts'), String(stats.receipts)),
        statRow(t('admin.shopsCount'), String(stats.shops.length)),
        statRow(t('admin.turnover'), money(stats.total)),
        statRow(t('admin.period'), `${stats.earliest || '—'} — ${stats.latest || '—'}`),
      ]),
      el('p', { class: 'hint' }, t('admin.marketHint')),
    ], el('button', { class: 'chip', onclick: () => loadMarket(node, true) }, t('common.refresh'))),

    section(t('admin.topItems'), [
      el('div', { class: 'card' }, stats.items.slice(0, 20).map((item) => el('div', { class: 'legend-row' }, [
        el('span', { class: 'legend-name' }, item.name),
        el('span', { class: 'legend-val num' }, money(item.total)),
        el('span', {
          style: 'width:96px;text-align:right;color:var(--fg-2);font-size:12.5px',
        }, priceRange(item, money)),
      ]))),
      el('p', { class: 'hint' }, t('admin.topItemsHint')),
    ]),

    section(t('admin.topShops'), [
      el('div', { class: 'card' }, stats.shops.slice(0, 20).map((shop) => el('div', { class: 'legend-row' }, [
        el('span', { class: 'legend-name' }, shop.name),
        el('span', { class: 'legend-val num' }, money(shop.total)),
        el('span', {
          style: 'width:96px;text-align:right;color:var(--fg-2);font-size:12.5px',
        }, t('admin.shopMeta', { items: shop.items, rows: shop.count })),
      ]))),
    ]),

    section(t('admin.byMonth'), [
      el('div', { class: 'card' }, stats.months.slice(-12).reverse().map((row) => el('div', { class: 'legend-row' }, [
        el('span', { class: 'legend-name num' }, row.month),
        el('span', { class: 'legend-val num' }, money(row.total)),
        el('span', {
          style: 'width:96px;text-align:right;color:var(--fg-2);font-size:12.5px',
        }, t('admin.rowsShort', { n: row.count })),
      ]))),
    ]),
  ]);
}

/** «Цена от и до» — по ней видно разброс между магазинами. */
function priceRange(item, money) {
  if (!item.min && !item.max) return t('admin.rowsShort', { n: item.count });
  if (item.min === item.max) return money(item.min);
  return `${money(item.min)} — ${money(item.max)}`;
}

function statRow(label, value) {
  return el('div', { class: 'legend-row' }, [
    el('span', { class: 'legend-name' }, label),
    el('span', { class: 'legend-val num' }, value),
  ]);
}

function draw(body) {
  const needle = cache.query.trim().toLowerCase();
  const list = (cache.users || []).filter((u) => !needle
    || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(needle));

  if (!list.length) {
    render(body, el('div', { class: 'empty' }, t('admin.nobody')));
    return;
  }

  render(body, section(
    t('admin.ofTotal', { n: list.length, total: cache.users.length }),
    list.map(userRow),
    el('button', { class: 'chip', onclick: () => copyEmails(list) }, t('admin.copyEmails')),
  ));
}

function userRow(user) {
  const status = {
    active: { text: t('admin.subActive'), color: '#2dd98a' },
    trial: { text: t('admin.subTrial', { date: user.trialEndsAt || '—' }), color: 'var(--fg-2)' },
    expired: { text: t('admin.subExpired'), color: '#ff8080' },
  }[user.subscription] || { text: user.subscription || '—', color: 'var(--fg-2)' };

  const meta = [user.email];
  if (user.phone) meta.push(user.phone);
  if (user.marketing) meta.push(t('admin.agreedMail'));

  return el('div', { class: 'tx' }, [
    el('div', { class: 'tx__body' }, [
      el('div', { class: 'tx__title' }, user.name || '—'),
      el('div', { class: 'tx__meta' }, meta.join(' · ')),
    ]),
    el('div', {}, [
      el('div', { class: 'tx__amount', style: `color:${status.color};font-size:13px` }, status.text),
      el('span', { class: 'tx__converted' }, dateOf(user.createdAt)),
    ]),
  ]);
}

/** Дата регистрации: в Firestore это отметка времени, а не строка. */
function dateOf(value) {
  const date = value?.toDate?.();
  return date ? date.toLocaleDateString(intlLocale()) : '';
}

/**
 * Почты в буфер обмена — для рассылки берём только тех, кто на неё согласился.
 * Остальным писать нельзя, и выгружать их адреса тоже незачем.
 */
async function copyEmails(list) {
  const emails = list.filter((u) => u.marketing).map((u) => u.email);
  if (!emails.length) {
    toastError(t('admin.noneAgreed'));
    return;
  }

  try {
    await navigator.clipboard.writeText(emails.join(', '));
    toastOk(t('admin.copied', { n: emails.length }));
  } catch {
    toastError(t('admin.clipboardDenied'));
  }
}
