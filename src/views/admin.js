/**
 * Админ-панель: кто зарегистрировался.
 *
 * Виден только тем, чья почта в ADMIN_EMAILS, и это же проверяют правила
 * Firestore — спрятанной кнопки мало, чужие профили закрывает база.
 */

import { el, render } from '../core/dom.js?v=125';
import { state } from '../core/store.js?v=125';
import { formatAmount } from '../core/money.js?v=125';
import { listUsers, wantsMail } from '../services/account.js?v=125';
import {
  loadPriceRows, summarizePrices, summarizeUsers,
  ownPriceRows, summarizeOwnSources, summarizeUsage,
} from '../services/adminStats.js?v=125';
import { loadUsage } from '../services/usage.js?v=125';
import { loadSpend, summarizeSpend, LOW_BALANCE_USD } from '../services/spend.js?v=125';
import {
  saveDraft, loadDraft, listTemplates, saveTemplate, deleteTemplate,
} from '../services/mailTemplates.js?v=125';
import {
  buildLetter, sendBatch, translateLetter, letterTexts, applyLetterTexts,
  localeOf, mailError, MAIL_BATCH,
} from '../services/mail.js?v=125';
import { toastError, toastOk } from '../ui/toast.js?v=125';
import { section } from '../ui/section.js?v=125';
import { richText } from '../ui/richText.js?v=125';
import { t, plural, intlLocale, LOCALES } from '../core/i18n.js?v=125';

const cache = { users: null, query: '', prices: null, usage: null, spend: null, tab: 'mine' };

/**
 * Черновик письма живёт до перезагрузки: набранное не должно теряться.
 *
 * Текст пишется на каждом языке отдельно — переводить некому, а прислать
 * человеку письмо на языке, которого он не знает, значит не написать вовсе.
 * Незаполненные языки просто не отправляются: пустое письмо хуже молчания.
 */
const letter = {
  drafts: loadDraft() || {
    ru: { subject: '', body: '' },
    en: { subject: '', body: '' },
    he: { subject: '', body: '' },
  },
  lang: 'ru',
  busy: false,
  /** Шаблоны из базы, подгружаются при первом открытии экрана */
  templates: null,
};

/** Черновик пишется в браузер на каждой букве — перезагрузка его не стирает. */
function keepDraft() {
  saveDraft(letter.drafts);
}

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

  /*
   * Поле письма живёт между перерисовками: пересоздавать редактор на каждый
   * чих нельзя — вместе с ним пропадали бы курсор и выделение.
   */
  let editor = null;

  const draw = () => {
    const draft = letter.drafts[letter.lang];
    const dir = letter.lang === 'he' ? 'rtl' : 'ltr';

    const subject = el('input', {
      class: 'input',
      placeholder: t('mail.subjectPlaceholder'),
      value: draft.subject,
      dir,
      oninput: (e) => { draft.subject = e.target.value; keepDraft(); },
    });

    editor = richText({
      value: draft.body,
      dir,
      onChange: (html) => { draft.body = html; keepDraft(); },
    });

    render(fields, [
      subject,
      el('div', { style: 'margin-top:10px' }, editor.node),
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
        templateBar(draw),
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
        /*
         * Кому и на каком языке уйдёт — перед кнопкой, а не после отправки.
         * Языки без текста показаны отдельно: их люди не получат ничего, и
         * заметить это надо до нажатия, а не по итогу.
         */
        ...LOCALES.map((lang) => {
          const people = recipientsBy(lang.code);
          const draft = letter.drafts[lang.code];
          const ready = Boolean(draft.subject.trim() && draft.body.trim());

          return statRow(
            lang.name,
            people.length
              ? t(ready ? 'mail.willGet' : 'mail.willSkip', { n: people.length })
              : t('mail.nobodyHere'),
          );
        }),
        el('p', { class: 'hint', style: 'margin-top:10px' }, t('mail.sendWarning')),
        el('button', {
          class: 'btn btn--primary btn--wide',
          style: 'margin-top:12px',
          onclick: (e) => sendLetter(status, e.target),
        }, t('mail.send')),
      ]),
      el('p', { class: 'hint' }, t('mail.langHint')),
    ]),
  ];
}

/**
 * Строка шаблонов: сохранить нынешнее письмо, открыть или удалить прежнее.
 *
 * Письмо пишется долго и на трёх языках, а до сих пор жило только в полях:
 * перезагрузка — и всё заново. Черновик теперь пишется в браузер сам, а под
 * именем письмо кладётся в базу и открывается с любого устройства.
 */
function templateBar(redraw) {
  const box = el('div', { style: 'margin-bottom:12px' });

  const draw = () => {
    const list = letter.templates || [];

    render(box, [
      el('div', { class: 'tx-group__date', style: 'margin-bottom:6px' }, t('mail.templates')),
      el('div', { class: 'chip-row' }, [
        ...list.map((item) => el('button', {
          class: 'chip',
          onclick: () => {
            letter.drafts = {
              ru: { ...item.drafts?.ru }, en: { ...item.drafts?.en }, he: { ...item.drafts?.he },
            };
            keepDraft();
            redraw();
            toastOk(t('mail.templateLoaded', { name: item.name }));
          },
        }, item.name)),

        el('button', {
          class: 'chip',
          onclick: () => saveCurrent(draw),
        }, `💾 ${t('mail.saveTemplate')}`),

        list.length ? el('button', {
          class: 'chip',
          onclick: () => removeTemplate(draw),
        }, `🗑 ${t('mail.deleteTemplate')}`) : null,
      ]),
    ]);
  };

  if (letter.templates === null) {
    letter.templates = [];
    listTemplates()
      .then((list) => { letter.templates = list; draw(); })
      .catch((error) => console.error('Шаблоны не загрузились', error));
  }

  draw();
  return box;
}

async function saveCurrent(redraw) {
  const suggested = letter.drafts[letter.lang].subject.trim();
  const name = window.prompt(t('mail.templateName'), suggested);
  if (!name?.trim()) return;

  try {
    const where = await saveTemplate(name, letter.drafts);
    letter.templates = await listTemplates();
    redraw();

    // Сохранилось всегда — вопрос лишь в том, увидит ли его другое устройство.
    toastOk(t(where === 'both' ? 'mail.templateSaved' : 'mail.templateLocal', { name: name.trim() }));
  } catch (error) {
    console.error(error);
    toastError(t('mail.templateFailed'));
  }
}

async function removeTemplate(redraw) {
  const list = letter.templates || [];
  const name = window.prompt(t('mail.templateDelete', { names: list.map((i) => i.name).join(', ') }));
  const found = list.find((item) => item.name === name?.trim());
  if (!found) return;

  try {
    await deleteTemplate(found.id);
    letter.templates = await listTemplates();
    redraw();
    toastOk(t('mail.templateDeleted', { name: found.name }));
  } catch (error) {
    console.error(error);
    toastError(t('mail.templateFailed'));
  }
}

/**
 * Как письмо выглядит у получателя — прямо на странице, в рамке.
 *
 * Два вида. Обычный — то, что придёт большинству. Тёмный — как письмо
 * перекрашивают почтовые программы с ночной темой: они инвертируют цвета
 * сами, письмо на это повлиять не может, и посмотреть на результат заранее
 * полезнее, чем узнать о нём от людей.
 *
 * Инверсия здесь приблизительная: у каждого клиента она своя, точной картины
 * не даст никто. Она отвечает на один вопрос — не пропадёт ли что-нибудь
 * совсем.
 */
function showPreview(node) {
  const draft = letter.drafts[letter.lang];
  if (!draft.subject.trim() && !draft.body.trim()) {
    toastError(t('mail.bodyEmpty'));
    return;
  }

  // Предпросмотр строится из письма и может упасть на кривой разметке. Молчать
  // тут нельзя: человек нажал кнопку и должен понять, что произошло.
  try {
    const { html } = buildLetter(draft.subject.trim(), draft.body.trim(), letter.lang);

    /*
     * Ночной вид собирается так же, как его делают почтовые программы:
     * переворачиваются цвета всей страницы, а картинки и цветные кнопки
     * переворачиваются обратно. Иначе фотография чека выходила негативом, а
     * зелёная кнопка — розовой, чего в почте не бывает: клиенты трогают фон и
     * текст, а картинки и заливки оставляют.
     */
    const darkSkin = `<style>
      html { background: #15151a; filter: invert(1) hue-rotate(180deg); }
      img, td[style*="background:#"], th[style*="background:#"] { filter: invert(1) hue-rotate(180deg); }
    </style>`;

    const frame = el('iframe', {
      // Отдельное окно: стили письма не текут на страницу, скрипты из него не
      // выполняются.
      srcdoc: html,
      sandbox: '',
      style: 'width:100%;height:460px;border:1px solid var(--edge);border-radius:12px;background:#fff',
    });

    const modes = el('div', { class: 'segmented', style: 'margin:14px 0 10px' },
      [[false, t('mail.previewLight')], [true, t('mail.previewDark')]].map(([value, label]) =>
        el('button', {
          class: value === false ? 'is-active' : '',
          onclick: (e) => {
            [...modes.children].forEach((b) => b.classList.remove('is-active'));
            e.target.classList.add('is-active');
            frame.srcdoc = value ? darkSkin + html : html;
            frame.style.background = value ? '#15151a' : '#fff';
          },
        }, label)));

    render(node, [
      modes,
      frame,
      el('p', { class: 'hint', style: 'margin-top:8px' }, t('mail.previewHint')),
    ]);
  } catch (error) {
    console.error(error);
    toastError(t('mail.previewFailed'));
  }
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
  const texts = letterTexts(draft.body);

  letter.busy = true;
  button.disabled = true;

  try {
    /*
     * Языки переводим по очереди, отдельными запросами: два языка в одном
     * ответе не укладывались во время, отведённое серверу, и он обрывал
     * запрос с ошибкой 504. Готовый язык сразу ложится в свой язычок — если
     * второй не дойдёт, первый уже никуда не денется.
     */
    for (const code of targets) {
      const name = LOCALES.find((l) => l.code === code)?.name || code;
      status.textContent = t('mail.translatingOne', { lang: name });

      // eslint-disable-next-line no-await-in-loop -- языки идут по очереди намеренно
      const result = await translateLetter({
        subject: draft.subject.trim(),
        texts,
        from: letter.lang,
        to: code,
      });

      letter.drafts[code].subject = result.subject || draft.subject;
      letter.drafts[code].body = applyLetterTexts(draft.body, result.items || []);
      keepDraft();
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

/** Кому уйдёт письмо на этом языке/** Кому уйдёт письмо на этом языке: не отписавшиеся, у кого он выбран. */
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
      const { html, text } = buildLetter(subject, part.draft.body.trim(), part.locale);

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

  const spend = el('div');

  load(body, false, activity);
  loadMarket(market);
  loadSpendCard(spend);

  return [
    // Деньги на распознавание — первым делом: кончатся они молча, и чеки
    // перестанут сканироваться у всех сразу.
    spend,
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

/**
 * Деньги на распознавание чеков.
 *
 * Расход считает сервер по каждому ответу модели — браузер видит только свои
 * обращения, а платим мы за все. Остаток же Anthropic по запросу не отдаёт:
 * его переписывают из кабинета руками, и дальше приложение само вычитает.
 */
async function loadSpendCard(node, force = false) {
  if (!cache.spend || force) {
    render(node, el('div', { class: 'empty' }, el('div', { class: 'spinner' })));

    try {
      cache.spend = summarizeSpend(await loadSpend());
    } catch (error) {
      console.error('Расход на Claude недоступен', error);
      render(node, section(t('spend.title'),
        el('div', { class: 'card' }, el('div', { class: 'hint' }, t('spend.failed')))));
      return;
    }
  }

  drawSpend(node);
}

function drawSpend(node) {
  const data = cache.spend;
  const usd = (value) => `$${value.toFixed(value < 1 ? 4 : 2)}`;
  const num = (value) => value.toLocaleString(intlLocale());

  const field = el('input', {
    class: 'input',
    type: 'number',
    step: '0.01',
    min: '0',
    inputmode: 'decimal',
    placeholder: t('spend.balanceLabel'),
    value: data.left === null ? '' : String(data.left),
  });

  const save = el('button', {
    class: 'chip',
    onclick: async () => {
      const amount = Number(field.value);
      if (!Number.isFinite(amount) || amount < 0) return;

      save.disabled = true;
      try {
        cache.spend = summarizeSpend(await loadSpend(amount));
        toastOk(t('spend.balanceSaved'));
        drawSpend(node);
      } catch (error) {
        console.error(error);
        toastError(t('spend.failed'));
        save.disabled = false;
      }
    },
  }, t('spend.balanceSave'));

  const rows = [
    statRow(t('spend.left'), data.left === null ? t('spend.leftUnknown') : usd(data.left)),
  ];

  // «На сколько хватит» имеет смысл, только когда известны и остаток, и
  // средняя цена чека: без одного из них это гадание.
  if (data.scansLeft !== null) {
    rows.push(statRow(t('spend.scansLeft'), t('spend.scans', { n: num(data.scansLeft) })));
  }
  if (data.thisMonth) {
    rows.push(statRow(t('spend.spentMonth'), usd(data.thisMonth.cost)));
  }
  rows.push(statRow(t('spend.spentAll'), usd(data.spent)));
  rows.push(statRow(t('spend.calls'), num(data.calls)));
  if (data.calls) {
    rows.push(statRow(t('spend.avg'), usd(data.avg)));
  }

  const warn = data.left !== null && data.left < LOW_BALANCE_USD
    ? el('p', { class: 'hint', style: 'color:var(--expense)' }, t('spend.low'))
    : null;

  const byMonth = data.months.length > 1
    ? [
        el('div', { class: 'tx-group__date' }, t('spend.byMonth')),
        el('div', { class: 'card' }, data.months.slice(0, 12).map((row) => rankRow(
          row.month,
          usd(row.cost),
          t('spend.tokens', { in: num(row.input), out: num(row.output) }),
        ))),
      ]
    : [];

  render(node, section(t('spend.title'), [
    el('div', { class: 'card' }, rows),
    warn,
    ...byMonth,
    el('div', { class: 'card' }, [
      el('label', { class: 'field__label' }, t('spend.balanceLabel')),
      field,
      el('div', { class: 'chip-row', style: 'margin-top:10px' }, [
        save,
        data.balanceAt
          ? el('span', { class: 'hint' }, t('spend.balanceAt', {
              date: data.balanceAt.toLocaleDateString(intlLocale()),
            }))
          : null,
      ]),
      el('p', { class: 'hint' }, t('spend.hint')),
      data.writable ? null : el('p', { class: 'hint', style: 'color:var(--expense)' }, t('spend.notWritable')),
      el('p', { class: 'hint' }, t('spend.since')),
    ]),
  ], el('button', { class: 'chip', onclick: () => loadSpendCard(node, true) }, t('common.refresh'))));
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
  // Язык человека: по нему видно, какой вариант письма ему уйдёт.
  meta.push(LOCALES.find((l) => l.code === localeOf(user))?.name || localeOf(user));
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
