/**
 * Меню «Ещё» — то, что не поместилось в док на телефоне.
 *
 * На широком экране эти разделы стоят прямо в боковой колонке, поэтому
 * кнопка «Ещё» там скрыта и меню не используется.
 */

import { el } from '../core/dom.js?v=21';
import { state, set } from '../core/store.js?v=21';
import { openSheet, closeSheet } from '../ui/sheet.js?v=21';

/** Разделы дока, спрятанные под «Ещё». Порядок — от частого к редкому. */
export const MORE_ROUTES = ['list', 'charts', 'settings'];

const ITEMS = {
  list: { title: 'Операции', hint: 'Полный список за месяц с поиском и фильтрами' },
  charts: { title: 'Статистика', hint: 'Траты по категориям и динамика за период' },
  settings: { title: 'Настройки', hint: 'Категории, валюта, профиль' },
};

/**
 * Значок берём из соответствующей кнопки дока: разметка иконок живёт
 * в index.html в одном месте, и меню не может разойтись с навигацией.
 */
function routeIcon(route) {
  const source = document.querySelector(`.tab[data-route="${route}"] .tab__ico svg`);
  return source ? source.cloneNode(true) : null;
}

export function openMoreMenu() {
  const body = MORE_ROUTES.map((route) => {
    const item = ITEMS[route];

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

  openSheet({ title: 'Ещё', body });
}
