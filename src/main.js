/**
 * Точка входа: авторизация → загрузка семьи → подписки на данные → роутинг.
 */

import { $, el, render } from './core/dom.js?v=112';
import {
  t, localeInfo, isRTL, applyDocumentLocale, translateDocument,
} from './core/i18n.js?v=112';
import { state, set, subscribe } from './core/store.js?v=112';
import { applyTheme } from './core/theme.js?v=112';
import { SUPPORT_WHATSAPP } from './config.js?v=112';
import { openBaseCurrencyPicker } from './views/currencyPicker.js?v=112';
import { monthKey, monthLabel, shiftMonth } from './core/dates.js?v=112';
import { unpaidBills } from './core/selectors.js?v=112';

import { watchAuth, signIn } from './services/auth.js?v=112';
import {
  loadAccount, isAdmin, joinByCode, listFamilies, watchFamily, setMarketing,
} from './services/account.js?v=112';
import { setFamilyId } from './core/session.js?v=112';
import { askProfile } from './views/signup.js?v=112';
import {
  watchTransactions,
  watchCategories,
  seedCategoriesIfEmpty,
  syncNewCategories,
  retireTealColor,
} from './services/transactions.js?v=112';
import { watchBills } from './services/bills.js?v=112';
import { runAutoBills } from './services/autoBills.js?v=112';
import { loadRates } from './services/rates.js?v=112';

import { renderDashboard } from './views/dashboard.js?v=112';
import { renderList } from './views/list.js?v=112';
import { renderBills } from './views/bills.js?v=112';
import { renderPrices } from './views/prices.js?v=112';
import { renderAdmin } from './views/admin.js?v=112';
import { openBudgetMenu, budgetName } from './views/budgetMenu.js?v=112';
import { renderCharts, destroyCharts } from './views/charts.js?v=112';
import { renderSettings } from './views/settings.js?v=112';
import { openTxForm } from './views/txForm.js?v=112';
import { openMoreMenu, MORE_ROUTES } from './views/moreMenu.js?v=112';
import { initRoseButton, drawRoseButton, resetRose } from './views/roseGlasses.js?v=112';
import { openSheet, closeSheet } from './ui/sheet.js?v=112';
import { toastError, toastOk } from './ui/toast.js?v=112';

// Язык ставим до первой отрисовки: иначе видно, как надписи меняются на ходу.
applyDocumentLocale();
translateDocument();

// Кнопка связи появляется, только если номер вписан в config.js.
if (SUPPORT_WHATSAPP) {
  const wa = $('#btn-whatsapp');
  wa.href = `https://wa.me/${SUPPORT_WHATSAPP}`;
  wa.hidden = false;
}

initRoseButton();

const ROUTES = {
  dashboard: renderDashboard,
  list: renderList,
  bills: renderBills,
  prices: renderPrices,
  charts: renderCharts,
  settings: renderSettings,
  admin: renderAdmin,
};

let unsubscribers = [];

/** Автооплата отрабатывает один раз за сессию бюджета, а не на каждое обновление. */
let autoBillsStarted = false;

// ---------------------------------------------------------------- запуск

watchAuth(async (user) => {
  teardown();

  if (!user) {
    setFamilyId(null);
    // Экран меняем до set(): иначе перерисовка успеет полезть в data вышедшего
    // пользователя, и до переключения экрана дело не дойдёт.
    showScreen('auth');
    set({
      user: null, family: null, profile: null, families: [],
      isAdmin: false, transactions: [], categories: [], bills: [], loading: false,
    });
    return;
  }

  set({ user, isAdmin: isAdmin(user), loading: true });
  showScreen('boot');

  try {
    let account = await loadAccount(user);

    // Профиля нет — человек здесь впервые. Анкета заводит и его, и семью.
    if (!account.profile) {
      showScreen('signup');
      account = await askProfile(user);
      showScreen('boot');
    }

    account = await acceptInvite(user, account);

    setFamilyId(account.family.id);
    set({ family: account.family, profile: account.profile });

    // Список бюджетов нужен только переключателю — грузим, не задерживая экран.
    listFamilies(account.profile)
      .then((families) => set({ families }))
      .catch(() => {});

    await startData();
    showScreen('app');

    // Пришёл по ссылке «отписаться» из письма — выключаем письма.
    handleUnsubscribe();
  } catch (error) {
    console.error(error);
    showScreen('auth');
    showAuthError(error.message || t('auth.loadFailed'));
  }
});

/**
 * Переход по ссылке-приглашению: ?join=код в адресе.
 *
 * Код убираем из адреса сразу — иначе он останется в истории браузера и
 * при следующем открытии приложение снова полезет вступать в тот же бюджет.
 */
async function acceptInvite(user, account) {
  const code = new URLSearchParams(location.search).get('join');
  if (!code) return account;

  history.replaceState(null, '', location.pathname);

  try {
    await joinByCode(user, account.profile, code);
    // Состав семьи и список бюджетов изменились — перечитываем начисто.
    const fresh = await loadAccount(user);
    toastOk(t('invite.joined'));
    return fresh;
  } catch (error) {
    console.error(error);
    toastError(error.message || t('invite.failed'));
    return account;
  }
}

/**
 * Подписки на данные семьи.
 *
 * Сначала подписки, потом всё остальное. Раньше экран ждал курсы валют, а за
 * ними досев категорий — три запроса подряд, и только после них появлялись
 * операции. Курсы нужны лишь для пересчёта в валюту сводных сумм: до их
 * приезда считаем по сохранённым, и разницы никто не замечает.
 */
async function startData() {
  const familyId = state.family.id;
  const ready = { bills: false, transactions: false, rates: false };

  /**
   * Автооплата ждёт все три источника сразу.
   *
   * Счета говорят, что платить, операции — что уже оплачено, курсы нужны для
   * снимка, который кладётся в запись. Запустив раньше, можно было бы завести
   * второй платёж поверх существующего или зафиксировать курс по умолчанию
   * вместо настоящего — а он останется в записи навсегда.
   */
  const runAutoBillsWhenReady = () => {
    if (autoBillsStarted || !ready.bills || !ready.transactions || !ready.rates) return;
    if (state.family?.id !== familyId) return;
    autoBillsStarted = true;

    runAutoBills(state)
      .then((done) => {
        if (!done.length) return;
        const names = [...new Set(done.map((row) => row.bill.name))].join(', ');
        toastOk(t('bills.autoDone', { names }));
      })
      .catch((error) => console.error('Автооплата не прошла', error));
  };

  unsubscribers.push(
    watchCategories(
      (categories) => set({ categories }),
      (error) => { console.error(error); toastError(t('error.categories')); },
    ),
    watchTransactions(
      (transactions) => {
        set({ transactions, loading: false });
        shareOldPrices(transactions);
        ready.transactions = true;
        runAutoBillsWhenReady();
      },
      (error) => { console.error(error); toastError(t('error.transactions')); },
    ),
    watchBills(
      (bills) => {
        set({ bills });
        ready.bills = true;
        runAutoBillsWhenReady();
      },
      (error) => { console.error(error); toastError(t('error.bills')); },
    ),
    watchFamily(
      familyId,
      (family) => set({ family }),
      // Отказ в доступе здесь означает, что нас убрали из бюджета, — перезаходим.
      (error) => { console.error(error); location.reload(); },
    ),
  );

  // Дальше — в фоне. Ответ может прийти уже после смены бюджета, поэтому
  // сверяем, к тому ли бюджету он относится.
  loadRates()
    .then(({ rates, fetchedAt, stale }) => {
      if (state.family?.id !== familyId) return;
      set({ rates, ratesFetchedAt: fetchedAt });
      if (stale) toastError(t('error.rates'));
    })
    .catch((error) => console.error(error))
    // Курсы могли и не приехать: тогда в записи ляжет запасной набор — это
    // хуже точного, но лучше, чем не записать платёж вовсе.
    .finally(() => { ready.rates = true; runAutoBillsWhenReady(); });

  seedCategoriesIfEmpty()
    // Категории, добавленные в код позже первого запуска, довозим молча.
    .then(() => syncNewCategories())
    // И один раз меняем бирюзовый цвет категорий на голубой — он выпадал из гаммы.
    .then(() => retireTealColor())
    .catch((error) => console.error(error));
}

/**
 * Смена бюджета без перезагрузки страницы.
 *
 * Раньше здесь стоял location.reload(): он тянул заново весь код, шрифты и
 * вход в Google — секунд семь на ровном месте. Данных же меняется всего
 * ничего, достаточно отписаться от старой семьи и подписаться на новую.
 */
async function switchBudget(familyId) {
  const family = (state.families || []).find((f) => f.id === familyId);
  if (!family || family.id === state.family?.id) return;

  teardown();
  setFamilyId(family.id);

  set({
    family,
    profile: state.profile ? { ...state.profile, familyId } : null,
    transactions: [],
    categories: [],
    bills: [],
    loading: true,
    // Экраны у бюджетов свои: показываем главный, а не тот, где стояли.
    route: 'dashboard',
  });

  await startData();
}

window.addEventListener('switch-budget', (event) => {
  switchBudget(event.detail).catch((error) => {
    console.error(error);
    toastError(t('budget.openFailed'));
  });
});

/**
 * Товары из чеков, внесённых до появления базы цен, переносим туда один раз.
 *
 * Делаем это в фоне после первой загрузки операций: экран уже нарисован, и
 * ждать перенос человеку не нужно. Повторный запуск отсекается отметкой в
 * самой базе, флаг здесь — только чтобы не начать второй проход в этой сессии.
 */
let backfillStarted = false;

function shareOldPrices(transactions) {
  if (backfillStarted || !state.user || !transactions.length) return;
  backfillStarted = true;

  import('./services/prices.js?v=112')
    .then(({ backfillPrices }) => backfillPrices(transactions, state.user.uid))
    .catch((error) => console.error('Не удалось перенести историю цен', error));
}

function teardown() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  backfillStarted = false;
  autoBillsStarted = false;
  destroyCharts();
  closeSheet();
  resetRose();
}

// ---------------------------------------------------------------- экраны

function showScreen(name) {
  $('#boot').hidden = name !== 'boot';
  $('#auth').hidden = name !== 'auth';
  $('#signup').hidden = name !== 'signup';
  $('#app').hidden = name !== 'app';
}

function showAuthError(text) {
  const node = $('#auth-error');
  node.textContent = text;
  node.hidden = false;
}

// ---------------------------------------------------------------- отрисовка

subscribe(() => {
  // Без пользователя рисовать нечего: половина экранов лезет в его профиль,
  // и на выходе из аккаунта это валило перерисовку.
  if (!state.user || $('#app').hidden) return;
  drawChrome();
  drawView();
});

function drawChrome() {
  $('#btn-month').textContent = monthLabel(state.month);
  orderMonthArrows();

  // Одна кнопка на язык и валюту: RU/RSD, EN/USD, IL/ILS.
  $('#btn-base-currency').textContent = `${localeInfo().short}/${state.base}`;

  // Вперёд дальше текущего месяца не пускаем.
  $('#btn-next-month').disabled = state.month >= monthKey(new Date());

  // Метка на вкладке платежей: сколько счетов месяца ещё не оплачено.
  const overdue = unpaidBills(state).length;
  const badge = $('#bills-badge');
  badge.hidden = overdue === 0;
  badge.textContent = overdue || '';
  $('#btn-month').classList.toggle('has-overdue', overdue > 0);

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.route === state.route);
  });

  // На телефоне открытый раздел может лежать внутри «Ещё» — подсвечиваем её.
  $('#btn-more').classList.toggle('is-active', MORE_ROUTES.includes(state.route));

  // Админ-панель существует только для меня.
  $('.tab[data-route="admin"]').hidden = !state.isAdmin;

  // Подпись очков зависит от языка — обновляем её здесь же, где и остальную шапку.
  drawRoseButton();

  drawBudgetPick();

  // Профиль в боковой колонке (на телефоне скрыт стилями).
  const photo = $('#user-photo');
  photo.hidden = !state.user?.photoURL;
  if (state.user?.photoURL) photo.src = state.user.photoURL;
  $('#user-name').textContent = state.user?.displayName || state.user?.email || '';
}

/**
 * Кнопка выбора бюджета в двух местах сразу.
 *
 * Пока бюджет один, переключать не из чего — обе кнопки прячем, чтобы не
 * занимать место ради выбора из одного варианта.
 */
function drawBudgetPick() {
  const many = (state.families || []).length > 1;
  const label = budgetName(state.family);

  for (const id of ['#btn-budget-rail', '#btn-budget-bar']) {
    const node = $(id);
    node.hidden = !many;
    node.querySelector('.budget-pick__name').textContent = label;
  }
}

/**
 * Порядок стрелок листания месяца.
 *
 * В иврите пара зеркальна: «назад» справа, «вперёд» слева — и по виду, и по
 * действию. Переставляем сами узлы, а не полагаемся на разворот строки
 * браузером: он делает это по-разному в зависимости от содержимого, и кнопки
 * оказывались то так, то этак.
 */
function orderMonthArrows() {
  const box = $('.topbar__period');
  const prev = $('#btn-prev-month');
  const month = $('#btn-month');
  const next = $('#btn-next-month');

  const order = isRTL() ? [next, month, prev] : [prev, month, next];
  if (box.firstElementChild === order[0]) return;
  box.append(...order);
}

let drawnRoute = null;

/** Перерисовка экрана. Chart.js держит canvas — старые графики гасим явно. */
function drawView() {
  const view = $('#view');
  if (state.route !== 'charts') destroyCharts();

  const content = (ROUTES[state.route] || renderDashboard)();
  render(view, [].concat(content));

  // Наверх поднимаем только при переходе между экранами. Иначе смена периода
  // или фильтра дёргала бы страницу под руками. Прокручиваем окно, а не блок:
  // scrollIntoView прижимал #view к верху и прятал шапку с выбором месяца.
  if (state.route !== drawnRoute) {
    window.scrollTo({ top: 0 });
    drawnRoute = state.route;
  }
}

// ---------------------------------------------------------------- события

$('#btn-signin').addEventListener('click', async () => {
  $('#auth-error').hidden = true;
  try {
    await signIn();
  } catch (error) {
    console.error(error);
    showAuthError(t('auth.failed'));
  }
});

$('#btn-prev-month').addEventListener('click', () => set({ month: shiftMonth(state.month, -1) }));

$('#btn-next-month').addEventListener('click', () => {
  const next = shiftMonth(state.month, 1);
  if (next <= monthKey(new Date())) set({ month: next });
});

$('#btn-month').addEventListener('click', () => set({ month: monthKey(new Date()) }));

$('#btn-base-currency').addEventListener('click', openBaseCurrencyPicker);

$('#btn-add').addEventListener('click', () => openTxForm());
$('#btn-add-wide').addEventListener('click', () => openTxForm());
$('#btn-user').addEventListener('click', () => set({ route: 'settings' }));

document.querySelectorAll('.tab[data-route]').forEach((tab) => {
  tab.addEventListener('click', () => set({ route: tab.dataset.route }));
});

$('#btn-more').addEventListener('click', openMoreMenu);

$('#btn-budget-rail').addEventListener('click', openBudgetMenu);
$('#btn-budget-bar').addEventListener('click', openBudgetMenu);

// Кнопка «все» на обзоре ведёт в список операций.
window.addEventListener('goto-list', () => set({ route: 'list' }));

/*
 * Смена темы перерисовывает экран.
 *
 * Разметку переодевают стили, но графики нарисованы на canvas: их цвета
 * заданы числами в момент отрисовки и сами не поменяются. Проще перерисовать
 * текущий экран целиком, чем держать отдельный путь обновления для графиков.
 */
// Скрипт в <head> уже поставил тему; здесь модуль берёт её под своё наблюдение.
applyTheme();

/**
 * Отписка по ссылке из письма.
 *
 * Ссылка ведёт сюда же, в приложение: страницы, которая пишет в базу без
 * человека, у нас нет. Если он уже вошёл — выключаем письма сразу и говорим
 * об этом; если нет — он увидит вход, а отписка сработает следом, потому что
 * адрес остаётся тем же до перезагрузки.
 */
async function handleUnsubscribe() {
  const params = new URLSearchParams(location.search);
  if (params.get('unsubscribe') !== '1') return;
  if (!state.user || !state.profile) return;

  // Адрес чистим сразу: перезагрузка страницы не должна отписывать заново
  // того, кто минуту назад передумал и включил письма обратно.
  params.delete('unsubscribe');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));

  try {
    await setMarketing(state.user.uid, false);
    set({ profile: { ...state.profile, marketing: false, mailOptOut: true } });
    confirmUnsubscribed();
  } catch (error) {
    console.error(error);
    toastError(t('settings.mailFailed'));
  }
}

/**
 * Подтверждение отписки.
 *
 * Уведомления мало: человек пришёл сюда из письма ради одного действия и
 * должен увидеть, что оно сделано, а не поймать всплывшую и погасшую строку.
 * Тут же кнопка вернуть — отписаться можно и по ошибке, а искать переключатель
 * в настройках после этого никто не станет.
 */
function confirmUnsubscribed() {
  openSheet({
    title: t('unsub.title'),
    body: [
      el('p', { style: 'margin:0 0 6px' }, t('unsub.text')),
      el('p', { class: 'hint' }, t('unsub.keeps')),
    ],
    footer: [
      el('button', {
        class: 'btn btn--wide',
        onclick: async () => {
          try {
            await setMarketing(state.user.uid, true);
            set({ profile: { ...state.profile, marketing: true, mailOptOut: false } });
            toastOk(t('settings.mailOn'));
          } catch (error) {
            console.error(error);
            toastError(t('settings.mailFailed'));
          }
          closeSheet();
        },
      }, t('unsub.undo')),
      el('button', { class: 'btn btn--primary btn--wide', onclick: () => closeSheet() }, t('common.close')),
    ],
  });
}

window.addEventListener('theme-change', () => {
  if (state.user && !$('#app').hidden) drawView();
});

// ---------------------------------------------------------------- установка

/**
 * Service worker нужен, чтобы приложение ставилось на телефон значком и
 * открывалось без адресной строки. Обновления он не задерживает: внутри
 * стратегия «сначала сеть», а найденную новую версию активируем сразу.
 */
if ('serviceWorker' in navigator) {
  // При самой первой установке воркер тоже «меняется», но перезагружать нечего:
  // страница уже свежая. Перезагрузка нужна только когда воркер сменился под
  // работающим приложением, то есть приехала новая версия кода.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => {
      console.error('Не удалось зарегистрировать service worker', error);
    });
  });
}
