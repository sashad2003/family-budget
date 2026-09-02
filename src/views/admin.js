/**
 * Админ-панель: кто зарегистрировался.
 *
 * Виден только тем, чья почта в ADMIN_EMAILS, и это же проверяют правила
 * Firestore — спрятанной кнопки мало, чужие профили закрывает база.
 */

import { el, render } from '../core/dom.js?v=94';
import { state } from '../core/store.js?v=94';
import { formatAmount } from '../core/money.js?v=94';
import { listUsers } from '../services/account.js?v=94';
import {
  loadPriceRows, summarizePrices, summarizeUsers,
  ownPriceRows, summarizeOwnSources, summarizeUsage,
} from '../services/adminStats.js?v=94';
import { loadUsage } from '../services/usage.js?v=94';
import { toastError, toastOk } from '../ui/toast.js?v=94';
import { section } from '../ui/section.js?v=94';
import { t, plural, intlLocale } from '../core/i18n.js?v=94';

const cache = { users: null, query: '', prices: null, usage: null };

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
    mine(),
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

/**
 * Своя статистика — подробная, с товарами и магазинами.
 *
 * Считается по операциям своей же семьи, которые и так лежат на устройстве.
 * Это единственное место, где видно, кто именно что купил, — и видит это
 * человек про себя.
 */
function mine() {
  const rows = ownPriceRows(state.transactions, state.user?.uid);
  const stats = summarizePrices(rows, state.base, state.rates);
  const sources = summarizeOwnSources(state.transactions);
  const money = (value) => formatAmount(value, state.base, { whole: true });

  return [
    section(t('admin.mine'), [
      el('div', { class: 'card' }, [
        statRow(t('admin.myTx'), String((state.transactions || []).length)),
        statRow(t('admin.myPhoto'), String(sources.photo)),
        statRow(t('admin.myQr'), String(sources.qr)),
        statRow(t('admin.mySms'), String(sources.sms)),
        statRow(t('admin.myManual'), String(sources.manual + sources.bill)),
        statRow(t('admin.myItems'), String(stats.rows)),
      ]),
      el('p', { class: 'hint' }, t('admin.mineHint')),
    ]),

    stats.items.length
      ? section(t('admin.myItemsTop'), el('div', { class: 'card' },
          stats.items.slice(0, 15).map((item) => rankRow(item.name, money(item.total),
            priceRange(item, money)))))
      : null,

    stats.shops.length
      ? section(t('admin.myShops'), el('div', { class: 'card' },
          stats.shops.slice(0, 15).map((shop) => rankRow(shop.name, money(shop.total),
            shopMeta(shop)))))
      : null,
  ];
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
      [cache.prices, cache.usage] = await Promise.all([loadPriceRows(), loadUsage()]);
    } catch (error) {
      console.error(error);
      render(node, el('div', { class: 'empty' }, t('admin.loadFailed')));
      return;
    }
  }

  // Свои строки из общей витрины убираем: они уже показаны выше и подробнее,
  // а здесь интересно, что делают остальные.
  const others = cache.prices.filter((row) => row.uid !== state.user?.uid);
  const stats = summarizePrices(others, state.base, state.rates);
  const usage = summarizeUsage(cache.usage);
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

      el('div', { class: 'tx-group__date' }, t('admin.howEntered')),
      el('div', { class: 'card' }, [
        statRow(t('admin.usageTotal'), String(usage.total)),
        statRow(t('admin.usagePhoto'), String(usage.photo)),
        statRow(t('admin.usageQr'), String(usage.qr)),
        statRow(t('admin.usageSms'), String(usage.sms)),
        statRow(t('admin.usageManual'), String(usage.manual + usage.bill)),
      ]),
      el('p', { class: 'hint' }, t('admin.usageHint')),
    ], el('button', { class: 'chip', onclick: () => loadMarket(node, true) }, t('common.refresh'))),

    section(t('admin.topShops'), [
      el('div', { class: 'card' }, stats.shops.slice(0, 20).map((shop) => rankRow(
        shop.name, money(shop.total), shopMeta(shop),
      ))),
    ]),

    section(t('admin.topItems'), [
      el('div', { class: 'card' }, stats.items.slice(0, 20).map((item) => rankRow(
        item.name, money(item.total), priceRange(item, money),
      ))),
      el('p', { class: 'hint' }, t('admin.topItemsHint')),
    ]),

    section(t('admin.byMonth'), [
      el('div', { class: 'card' }, stats.months.slice(-12).reverse().map((row) => rankRow(
        row.month, money(row.total), plural(row.count, ['покупка', 'покупки', 'покупок'], 'admin.rowsShort'),
      ))),
    ]),
  ]);
}

/**
 * «32 названия · 36 покупок» — то, из чего сложилась сумма магазина.
 *
 * Раньше здесь стояли «32 тов. · 36 зап.»: сокращения коротко влезали, но
 * прочесть их было нельзя — «зап.» ничего не значит. Записи в общей базе это
 * позиции чеков, то есть покупки, а товары — сколько среди них разных
 * названий.
 */
function shopMeta(shop) {
  return t('admin.shopMeta', {
    items: plural(shop.items, ['название', 'названия', 'названий'], 'admin.namesShort'),
    rows: plural(shop.count, ['покупка', 'покупки', 'покупок'], 'admin.rowsShort'),
  });
}

/** Строка «название — сумма — пояснение справа». */
function rankRow(name, value, meta) {
  return el('div', { class: 'legend-row' }, [
    el('span', { class: 'legend-name' }, name),
    el('span', { class: 'legend-val num' }, value),
    el('span', {
      style: 'width:104px;text-align:right;color:var(--fg-2);font-size:12.5px',
    }, meta),
  ]);
}

/** «Цена от и до» — по ней видно разброс между магазинами. */
function priceRange(item, money) {
  if (!item.min && !item.max) return plural(item.count, ['покупка', 'покупки', 'покупок'], 'admin.rowsShort');
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
