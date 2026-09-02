/**
 * Админ-панель: кто зарегистрировался.
 *
 * Виден только тем, чья почта в ADMIN_EMAILS, и это же проверяют правила
 * Firestore — спрятанной кнопки мало, чужие профили закрывает база.
 */

import { el, render } from '../core/dom.js?v=109';
import { state } from '../core/store.js?v=109';
import { formatAmount } from '../core/money.js?v=109';
import { listUsers, wantsMail } from '../services/account.js?v=109';
import {
  loadPriceRows, summarizePrices, summarizeUsers,
  ownPriceRows, summarizeOwnSources, summarizeUsage,
} from '../services/adminStats.js?v=109';
import { loadUsage } from '../services/usage.js?v=109';
import {
  buildLetter, sendBatch, translateLetter, localeOf, mailError, MAIL_BATCH,
} from '../services/mail.js?v=109';
import { toastError, toastOk } from '../ui/toast.js?v=109';
import { section } from '../ui/section.js?v=109';
import { t, plural, intlLocale, LOCALES } from '../core/i18n.js?v=109';

const cache = { users: null, query: '', prices: null, usage: null, tab: 'mine' };

/**
 * Черновик письма живёт до перезагрузки: набранное не должно теряться.
 *
 * Текст пишется на каждом языке отдельно — переводить некому, а прислать
 * человеку письмо на языке, которого он не знает, значит не написать вовсе.
 * Незаполненные языки просто не отправляются: пустое письмо хуже молчания.
 */
const letter = {
  drafts: {
    ru: { subject: '', body: '' },
    en: { subject: '', body: '' },
    he: { subject: '', body: '' },
  },
  lang: 'ru',
  /** 'text' — обычные абзацы, 'html' — своя разметка с картинками и кнопками */
  format: 'text',
  busy: false,
};

/**
 * Админ-панель на два язычка.
 *
 * Своё и чужое разведены намеренно. Своя статистика подробная, с товарами и
 * магазинами; чужая — обезличенная, и смотреть их одним списком значит всё
 * время сверять в уме, где кто. Выбранный язычок держится в памяти экрана:
 * при возврате открывается тот же.
 */
export function renderAdmin() {
  const container = el('div');
  const view = el('div');

  const tabs = () => el('div', { class: 'segmented', style: 'margin-bottom:16px' },
    [['mine', t('admin.tabMine')], ['others', t('admin.tabOthers')]].map(([key, label]) =>
      el('button', {
        class: cache.tab === key ? 'is-active' : '',
        onclick: () => { cache.tab = key; draw(); },
      }, label),
    ));

  const draw = () => {
    render(container, [tabs(), view]);
    render(view, cache.tab === 'mine' ? mine() : others());
  };

  draw();
  return container;
}

/**
 * Письмо всем, кто не отписался.
 *
 * Адреса берутся из уже загруженного списка людей, письма уходят порциями:
 * прокси отправляет по одному сообщению на адрес, и сотня адресов за один
 * запрос упёрлась бы в таймаут. После каждой порции счётчик обновляется — за
 * молчащей кнопкой не понять, идёт рассылка или всё повисло.
 */
function mailer() {
  const status = el('div', { class: 'hint', style: 'margin-top:10px' });
  const fields = el('div');
  const preview = el('div');

  const draw = () => {
    const draft = letter.drafts[letter.lang];
    const dir = letter.lang === 'he' ? 'rtl' : 'ltr';

    render(fields, [
      el('input', {
        class: 'input',
        placeholder: t('mail.subjectPlaceholder'),
        value: draft.subject,
        dir,
        oninput: (e) => { draft.subject = e.target.value; },
      }),
      el('textarea', {
        class: 'input textarea',
        style: `margin-top:10px;min-height:${letter.format === 'html' ? 220 : 150}px`
          + (letter.format === 'html' ? ';font-family:var(--mono);font-size:13px' : ''),
        placeholder: t(letter.format === 'html' ? 'mail.htmlPlaceholder' : 'mail.bodyPlaceholder'),
        dir: letter.format === 'html' ? 'ltr' : dir,
        oninput: (e) => { draft.body = e.target.value; },
      }, draft.body),
      el('div', { class: 'hint', style: 'margin-top:8px' },
        t('mail.forLang', { n: recipientsBy(letter.lang).length })),
    ]);

    render(preview, []);
  };

  const tabs = el('div', { class: 'segmented', style: 'margin-bottom:12px' },
    LOCALES.map((lang) => el('button', {
      class: letter.lang === lang.code ? 'is-active' : '',
      lang: lang.code,
      onclick: () => { letter.lang = lang.code; drawTabs(); draw(); },
    }, `${lang.name} · ${recipientsBy(lang.code).length}`)));

  const drawTabs = () => {
    [...tabs.children].forEach((button, index) => {
      button.classList.toggle('is-active', LOCALES[index].code === letter.lang);
    });
  };

  // Вид письма: простые абзацы или своя разметка.
  const formats = el('div', { class: 'segmented', style: 'margin-bottom:12px' },
    [['text', t('mail.formatText')], ['html', t('mail.formatHtml')]].map(([key, label]) =>
      el('button', {
        class: letter.format === key ? 'is-active' : '',
        onclick: () => {
          letter.format = key;
          [...formats.children].forEach((b, i) => b.classList.toggle('is-active', i === (key === 'text' ? 0 : 1)));
          draw();
        },
      }, label)));

  const translate = el('button', {
    class: 'chip',
    onclick: () => translateDraft(status, translate),
  }, `✨ ${t('mail.translate')}`);

  const show = el('button', {
    class: 'chip',
    onclick: () => showPreview(preview),
  }, `👁 ${t('mail.preview')}`);

  const test = el('button', {
    class: 'chip',
    onclick: () => sendTest(status, test),
  }, `✉️ ${t('mail.sendTest')}`);

  draw();

  return [
    section(t('mail.title'), [
      el('div', { class: 'card' }, [
        tabs,
        formats,
        fields,
        // Проверочные действия стоят вместе и выглядят как второстепенные:
        // рядом с ними не должно быть кнопки, которая пишет сразу всем.
        el('div', { class: 'chip-row', style: 'margin-top:12px' }, [translate, show, test]),
        status,
        preview,
      ]),
      el('p', { class: 'hint' }, t('mail.hint')),
    ]),

    /*
     * Отправка всем — отдельным разделом и внизу.
     *
     * Раньше она стояла кнопка в кнопку с пробным письмом: два действия, одно
     * из которых отзывается, а другое нет, не должны находиться на расстоянии
     * промаха мышью.
     */
    section(t('mail.sendTitle'), [
      el('div', { class: 'card' }, [
        el('p', { style: 'margin:0 0 12px;font-size:14.5px' }, t('mail.sendWarning')),
        el('button', {
          class: 'btn btn--primary btn--wide',
          onclick: (e) => sendLetter(status, e.target),
        }, t('mail.send')),
      ]),
    ]),
  ];
}

/** Как письмо выглядит у получателя — прямо на странице, в рамке. */
function showPreview(node) {
  const draft = letter.drafts[letter.lang];
  if (!draft.subject.trim() && !draft.body.trim()) {
    toastError(t('mail.bodyEmpty'));
    return;
  }

  const { html } = buildLetter(
    draft.subject.trim(), draft.body.trim(), letter.lang, letter.format,
  );

  render(node, el('iframe', {
    // Предпросмотр в отдельном окне: стили письма не должны потечь на
    // страницу, а скрипты из него — выполниться.
    srcdoc: html,
    sandbox: '',
    style: 'width:100%;height:420px;margin-top:14px;border:1px solid var(--edge);border-radius:12px;background:#fff',
  }));
}

/** Перевод черновика на остальные языки — той же моделью, что читает чеки. */
async function translateDraft(status, button) {
  if (letter.busy) return;

  const draft = letter.drafts[letter.lang];
  if (!draft.subject.trim() || !draft.body.trim()) {
    toastError(t('mail.bodyEmpty'));
    return;
  }

  const targets = LOCALES.map((l) => l.code).filter((code) => code !== letter.lang);

  letter.busy = true;
  button.disabled = true;
  status.textContent = t('mail.translating');

  try {
    const result = await translateLetter({
      subject: draft.subject.trim(),
      body: draft.body.trim(),
      from: letter.lang,
      targets,
    });

    for (const code of targets) {
      if (result[code]?.subject) letter.drafts[code].subject = result[code].subject;
      if (result[code]?.body) letter.drafts[code].body = result[code].body;
    }

    status.textContent = t('mail.translated');
    toastOk(t('mail.translated'));
  } catch (error) {
    console.error(error);
    status.textContent = error.message;
    toastError(error.message);
  } finally {
    letter.busy = false;
    button.disabled = false;
  }
}

/** Письмо себе — на том языке, который открыт сейчас. */
async function sendTest(status, button) {
  if (letter.busy) return;

  const draft = letter.drafts[letter.lang];
  const email = state.user?.email;
  if (!draft.subject.trim() || !draft.body.trim()) {
    toastError(t('mail.bodyEmpty'));
    return;
  }
  if (!email) return;

  letter.busy = true;
  button.disabled = true;
  status.textContent = t('mail.testSending', { email });

  try {
    const subject = draft.subject.trim();
    const { html, text } = buildLetter(subject, draft.body.trim(), letter.lang, letter.format);
    const result = await sendBatch({
      subject, html, text, recipients: [{ email, name: state.profile?.name || '' }],
    });

    if (result.sent) {
      status.textContent = t('mail.testSent', { email });
      toastOk(t('mail.testSent', { email }));
    } else {
      const reason = mailError(result.failed?.[0]?.error);
      status.textContent = t('mail.testFailed', { reason });
      toastError(t('mail.testFailed', { reason }));
      console.warn('Письмо не ушло', result.failed);
    }
  } catch (error) {
    console.error(error);
    status.textContent = error.message;
    toastError(error.message);
  } finally {
    letter.busy = false;
    button.disabled = false;
  }
}

/** Кому уйдёт письмо на этом языке: не отписавшиеся, у кого он выбран. */
function recipientsBy(locale) {
  return (cache.users || [])
    .filter((u) => u.email && wantsMail(u) && localeOf(u) === locale);
}

/**
 * Отправка. Каждый язык уходит своим письмом, порциями: прокси шлёт по одному
 * сообщению на адрес, и сотня адресов за раз упёрлась бы в таймаут.
 */
async function sendLetter(status, button) {
  if (letter.busy) return;

  const plan = LOCALES
    .map((lang) => ({
      locale: lang.code,
      draft: letter.drafts[lang.code],
      people: recipientsBy(lang.code),
    }))
    .filter((part) => part.people.length
      && part.draft.subject.trim() && part.draft.body.trim());

  if (!plan.length) {
    toastError(t('mail.nothingToSend'));
    return;
  }

  const total = plan.reduce((sum, part) => sum + part.people.length, 0);
  if (!window.confirm(t('mail.confirm', { n: total }))) return;

  letter.busy = true;
  button.disabled = true;

  let sent = 0;
  const failed = [];

  try {
    for (const part of plan) {
      const subject = part.draft.subject.trim();
      const { html, text } = buildLetter(subject, part.draft.body.trim(), part.locale, letter.format);

      for (let i = 0; i < part.people.length; i += MAIL_BATCH) {
        const chunk = part.people.slice(i, i + MAIL_BATCH)
          .map((u) => ({ email: u.email, name: u.name || '' }));

        // eslint-disable-next-line no-await-in-loop -- порции идут по очереди намеренно
        const result = await sendBatch({ subject, html, text, recipients: chunk });
        sent += result.sent;
        failed.push(...result.failed);
        status.textContent = t('mail.progress', { sent, total });
      }
    }

    status.textContent = failed.length
      ? t('mail.doneWithErrors', { sent, failed: failed.length })
      : t('mail.done', { sent });
    if (failed.length) console.warn('Часть писем не ушла', failed);
    toastOk(t('mail.done', { sent }));
  } catch (error) {
    console.error(error);
    status.textContent = error.message;
    toastError(error.message);
  } finally {
    letter.busy = false;
    button.disabled = false;
  }
}

/** Всё, что про остальных: активность, витрина цен, список людей. */
function others() {
  const body = el('div');
  const activity = el('div');
  const market = el('div');

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: t('admin.search'),
    value: cache.query,
    oninput: (e) => { cache.query = e.target.value; draw(body); },
  });

  load(body, false, activity);
  loadMarket(market);

  return [
    activity,
    mailer(),
    market,
    // Список людей — в самом низу: он длинный, и всё, ради чего сюда заходят,
    // должно быть видно раньше, чем начнётся перечисление подписчиков.
    section(t('admin.title'), [
      search,
      body,
    ], el('button', { class: 'chip', onclick: () => load(body, true, activity) }, t('common.refresh'))),
  ];
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
      cache.prices = await loadPriceRows();
    } catch (error) {
      console.error(error);
      render(node, el('div', { class: 'empty' }, t('admin.loadFailed')));
      return;
    }

    /*
     * Счётчик способов записи живёт по своим правилам доступа, и пока они не
     * выложены на сервер, запрос к нему отказывает. Витрину цен это ронять не
     * должно: она считается по другой коллекции и работает сама по себе.
     */
    try {
      cache.usage = await loadUsage();
    } catch (error) {
      console.error('Счётчик способов записи недоступен', error);
      cache.usage = null;
    }
  }

  // Свои строки из общей витрины убираем: они уже показаны выше и подробнее,
  // а здесь интересно, что делают остальные.
  const others = cache.prices.filter((row) => row.uid !== state.user?.uid);
  const stats = summarizePrices(others, state.base, state.rates);
  const usage = summarizeUsage(cache.usage);
  const money = (value) => formatAmount(value, state.base, { whole: true });

  const usageCard = [
    el('div', { class: 'tx-group__date' }, t('admin.howEntered')),
    el('div', { class: 'card' }, cache.usage === null
      ? [el('div', { class: 'hint' }, t('admin.usageClosed'))]
      : [
          statRow(t('admin.usageTotal'), String(usage.total)),
          statRow(t('admin.usagePhoto'), String(usage.photo)),
          statRow(t('admin.usageQr'), String(usage.qr)),
          statRow(t('admin.usageSms'), String(usage.sms)),
          statRow(t('admin.usageManual'), String(usage.manual + usage.bill)),
        ]),
    el('p', { class: 'hint' }, t('admin.usageHint')),
  ];

  // Пока других семей нет — или они ещё не сканировали чеки, — витрине нечего
  // показывать. Это не ошибка, и объяснить это надо словами, а не пустотой.
  if (!stats.rows) {
    render(node, section(t('admin.market'), [
      el('div', { class: 'card' }, el('div', { class: 'hint' }, t('admin.marketEmpty'))),
      ...usageCard,
    ], el('button', { class: 'chip', onclick: () => loadMarket(node, true) }, t('common.refresh'))));
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
      ...usageCard,
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
  if (!wantsMail(user)) meta.push(t('admin.optedOut'));

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
 * Почты в буфер обмена — все, кроме отписавшихся.
 *
 * Пока приложение бесплатное и тестовое, письма о новом получают все, кто не
 * сказал «не пишите». Отписка исключает человека сразу и навсегда: поле
 * mailOptOut ставит он сам, и обратно его ставит тоже только он.
 */
async function copyEmails(list) {
  const emails = list.filter(wantsMail).map((u) => u.email);
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
