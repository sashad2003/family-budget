/**
 * Точка входа: авторизация → загрузка семьи → подписки на данные → роутинг.
 */

import { $, render } from './core/dom.js?v=20';
import { state, set, subscribe } from './core/store.js?v=20';
import { openBaseCurrencyPicker } from './views/currencyPicker.js?v=20';
import { monthKey, monthLabel, shiftMonth } from './core/dates.js?v=20';
import { unpaidBills } from './core/selectors.js?v=20';

import { watchAuth, signIn, loadFamily } from './services/auth.js?v=20';
import {
  watchTransactions,
  watchCategories,
  seedCategoriesIfEmpty,
  syncNewCategories,
} from './services/transactions.js?v=20';
import { watchBills } from './services/bills.js?v=20';
import { loadRates } from './services/rates.js?v=20';

import { renderDashboard } from './views/dashboard.js?v=20';
import { renderList } from './views/list.js?v=20';
import { renderBills } from './views/bills.js?v=20';
import { renderCharts, destroyCharts } from './views/charts.js?v=20';
import { renderSettings } from './views/settings.js?v=20';
import { openTxForm } from './views/txForm.js?v=20';
import { openMoreMenu, MORE_ROUTES } from './views/moreMenu.js?v=20';
import { closeSheet } from './ui/sheet.js?v=20';
import { toastError } from './ui/toast.js?v=20';

const ROUTES = {
  dashboard: renderDashboard,
  list: renderList,
  bills: renderBills,
  charts: renderCharts,
  settings: renderSettings,
};

let unsubscribers = [];

// ---------------------------------------------------------------- запуск

watchAuth(async (user) => {
  teardown();

  if (!user) {
    set({ user: null, family: null, isMember: false, transactions: [], loading: false });
    showScreen('auth');
    return;
  }

  set({ user, loading: true });
  showScreen('boot');

  try {
    const { family, isMember } = await loadFamily(user);
    set({ family, isMember });

    if (!isMember) {
      showScreen('auth');
      showAuthError(
        `Аккаунт ${user.email} не входит в семью. Добавьте эту почту в поле allowedEmails ` +
        'документа families/family_drutz и войдите снова.',
      );
      return;
    }

    await startData();
    showScreen('app');
  } catch (error) {
    console.error(error);
    showScreen('auth');
    showAuthError(error.message || 'Не удалось загрузить данные семьи');
  }
});

async function startData() {
  const { rates, fetchedAt, stale } = await loadRates();
  set({ rates, ratesFetchedAt: fetchedAt });
  if (stale) toastError('Курсы валют не обновились, используются сохранённые');

  await seedCategoriesIfEmpty().catch(() => {});
  // Категории, добавленные в код позже первого запуска, довозим молча.
  await syncNewCategories().catch((error) => console.error(error));

  unsubscribers.push(
    watchCategories(
      (categories) => set({ categories }),
      (error) => { console.error(error); toastError('Нет доступа к категориям'); },
    ),
    watchTransactions(
      (transactions) => set({ transactions, loading: false }),
      (error) => { console.error(error); toastError('Нет доступа к операциям'); },
    ),
    watchBills(
      (bills) => set({ bills }),
      (error) => { console.error(error); toastError('Нет доступа к платежам'); },
    ),
  );
}

function teardown() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  destroyCharts();
  closeSheet();
}

// ---------------------------------------------------------------- экраны

function showScreen(name) {
  $('#boot').hidden = name !== 'boot';
  $('#auth').hidden = name !== 'auth';
  $('#app').hidden = name !== 'app';
}

function showAuthError(text) {
  const node = $('#auth-error');
  node.textContent = text;
  node.hidden = false;
}

// ---------------------------------------------------------------- отрисовка

subscribe(() => {
  if ($('#app').hidden) return;
  drawChrome();
  drawView();
});

function drawChrome() {
  $('#btn-month').textContent = monthLabel(state.month);
  $('#btn-base-currency').textContent = state.base;

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

  // Профиль в боковой колонке (на телефоне скрыт стилями).
  const photo = $('#user-photo');
  photo.hidden = !state.user?.photoURL;
  if (state.user?.photoURL) photo.src = state.user.photoURL;
  $('#user-name').textContent = state.user?.displayName || state.user?.email || '';
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
    showAuthError('Не удалось войти. Проверьте, что домен разрешён в Firebase Auth.');
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

// Кнопка «все» на обзоре ведёт в список операций.
window.addEventListener('goto-list', () => set({ route: 'list' }));

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
