/**
 * Точка входа: авторизация → загрузка семьи → подписки на данные → роутинг.
 */

import { $, render } from './core/dom.js';
import { state, set, subscribe } from './core/store.js';
import { CURRENCY_CODES } from './config.js';
import { monthKey, monthLabel, shiftMonth } from './core/dates.js';

import { watchAuth, signIn, loadFamily } from './services/auth.js';
import { watchTransactions, watchCategories, seedCategoriesIfEmpty } from './services/transactions.js';
import { loadRates } from './services/rates.js';

import { renderDashboard } from './views/dashboard.js';
import { renderList } from './views/list.js';
import { renderCharts, destroyCharts } from './views/charts.js';
import { renderSettings } from './views/settings.js';
import { openTxForm } from './views/txForm.js';
import { closeSheet } from './ui/sheet.js';
import { toastError } from './ui/toast.js';

const ROUTES = {
  dashboard: renderDashboard,
  list: renderList,
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

  unsubscribers.push(
    watchCategories(
      (categories) => set({ categories }),
      (error) => { console.error(error); toastError('Нет доступа к категориям'); },
    ),
    watchTransactions(
      (transactions) => set({ transactions, loading: false }),
      (error) => { console.error(error); toastError('Нет доступа к операциям'); },
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

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.route === state.route);
  });

  // Профиль в боковой колонке (на телефоне скрыт стилями).
  const photo = $('#user-photo');
  photo.hidden = !state.user?.photoURL;
  if (state.user?.photoURL) photo.src = state.user.photoURL;
  $('#user-name').textContent = state.user?.displayName || state.user?.email || '';
}

/** Перерисовка экрана. Chart.js держит canvas — старые графики гасим явно. */
function drawView() {
  const view = $('#view');
  if (state.route !== 'charts') destroyCharts();

  const content = (ROUTES[state.route] || renderDashboard)();
  render(view, [].concat(content));
  view.scrollIntoView({ block: 'start' });
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

$('#btn-base-currency').addEventListener('click', () => {
  const index = CURRENCY_CODES.indexOf(state.base);
  set({ base: CURRENCY_CODES[(index + 1) % CURRENCY_CODES.length] });
});

$('#btn-add').addEventListener('click', () => openTxForm());
$('#btn-add-wide').addEventListener('click', () => openTxForm());
$('#btn-user').addEventListener('click', () => set({ route: 'settings' }));

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => set({ route: tab.dataset.route }));
});

// Кнопка «все» на обзоре ведёт в список операций.
window.addEventListener('goto-list', () => set({ route: 'list' }));
