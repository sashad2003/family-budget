/**
 * Тема оформления: ночная, светлая или как в системе.
 *
 * Выбор человека хранится у него в браузере, а не в семье: на одном столе
 * могут сидеть двое, и телефон у каждого свой. Ключ тот же, что читает
 * короткий скрипт в index.html, — он ставит тему до первой отрисовки, иначе
 * страница успевала бы мигнуть ночным фоном перед светлым.
 *
 * Наружу всегда выставляется конкретная тема: на <html> стоит либо
 * data-theme="dark", либо data-theme="light". Поэтому в стилях хватает
 * одного набора значений и не нужен второй такой же в @media.
 */

export const THEMES = ['system', 'light', 'dark'];

const KEY = 'theme';

/** Цвет строки состояния браузера — должен совпадать с фоном страницы. */
const BAR = { dark: '#0b0b14', light: '#eceef6' };

const media = window.matchMedia('(prefers-color-scheme: light)');

export function getTheme() {
  const saved = localStorage.getItem(KEY);
  return THEMES.includes(saved) ? saved : 'system';
}

/** Что показано на самом деле: 'dark' или 'light'. */
export function activeTheme() {
  const choice = getTheme();
  if (choice !== 'system') return choice;
  return media.matches ? 'light' : 'dark';
}

export function setTheme(choice) {
  localStorage.setItem(KEY, THEMES.includes(choice) ? choice : 'system');
  applyTheme();
}

/**
 * Ставит тему на страницу.
 *
 * color-scheme нужен помимо цветов: по нему браузер красит свои собственные
 * части — полосы прокрутки, поля ввода даты, выпадающие списки. Без него на
 * светлой теме календарь открывался чёрным.
 */
export function applyTheme() {
  const theme = activeTheme();
  const root = document.documentElement;

  if (root.dataset.theme === theme) return;

  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', BAR[theme]);

  window.dispatchEvent(new CustomEvent('theme-change', { detail: { theme } }));
}

/**
 * Пока выбрано «как в системе», следим за системой: телефон переключается
 * на ночной режим по расписанию, и приложение должно уходить в него вместе
 * с остальными, не дожидаясь перезапуска.
 */
media.addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme();
});

/** Цвет из стилей — графики рисуются на canvas и токенов сами не видят. */
export function themeColor(token, fallback = '') {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}
