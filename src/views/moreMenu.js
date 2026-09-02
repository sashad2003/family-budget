/**
 * Меню «Ещё» — то, что не поместилось в док на телефоне.
 *
 * На широком экране эти разделы стоят прямо в боковой колонке, поэтому
 * кнопка «Ещё» там скрыта и меню не используется.
 */

import { el } from '../core/dom.js?v=82';
import { state, set } from '../core/store.js?v=82';
import { openSheet, closeSheet } from '../ui/sheet.js?v=82';
import { t } from '../core/i18n.js?v=82';

/** Разделы дока, спрятанные под «Ещё». Порядок — от частого к редкому. */
export const MORE_ROUTES = ['list', 'prices', 'charts', 'admin', 'settings'];

/** Подписи берём из словаря: ключи те же, что у кнопок в боковой колонке. */
const ITEMS = (route) => ({ title: t(`nav.${route}`), hint: t(`more.${route}`) });

/**
 * Значок берём из соответствующей кнопки дока: разметка иконок живёт
 * в index.html в одном месте, и меню не может разойтись с навигацией.
 */
function routeIcon(route) {
  const source = document.querySelector(`.tab[data-route="${route}"] .tab__ico svg`);
  return source ? source.cloneNode(true) : null;
}

export function openMoreMenu() {
  // Админ-панель есть не у всех — в меню её показываем по тому же признаку,
  // что и кнопку в боковой колонке.
  const routes = MORE_ROUTES.filter((route) => route !== 'admin' || state.isAdmin);

  const body = routes.map((route) => {
    const item = ITEMS(route);

    return el('button', {
      class: `more-item ${state.route === route ? 'is-active' : ''}`,
      onclick: () => { closeSheet(); set({ route }); },
    }, [
      el('span', { class: 'more-item__ico' }, routeIcon(route)),
      el('span', {}, [
        el('div', { class: 'more-item__title' }, item.title),
        el('div', { class: 'more-item__hint' }, item.hint),
      ]),
    ]);
  });

  openSheet({ title: t('nav.more'), body });
}
