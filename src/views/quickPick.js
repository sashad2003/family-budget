/**
 * Быстрый выбор товаров — для покупок без чека (базар).
 * Отмечаешь нужное, суммы подставляются из прошлых покупок и правятся в форме.
 */

import { el, render } from '../core/dom.js?v=12';
import { state } from '../core/store.js?v=12';
import { quickItemSuggestions } from '../core/selectors.js?v=12';
import { DEFAULT_QUICK_ITEMS } from '../data/quickItems.js?v=12';
import { openSheet, closeSheet } from '../ui/sheet.js?v=12';
import { formatAmount } from '../core/money.js?v=12';

/**
 * openQuickPick(currency, { onDone, onCancel })
 *   onDone   — получает массив строк товаров
 *   onCancel — вызывается при закрытии без выбора (чтобы вернуть форму)
 */
export function openQuickPick(currency, { onDone, onCancel }) {
  const all = quickItemSuggestions(state, currency, DEFAULT_QUICK_ITEMS);
  const chosen = new Map();
  let needle = '';
  let done = false;

  const listBox = el('div', { class: 'pick-grid' });
  const footer = el('div', { style: 'display:flex;gap:10px;flex:1' });

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Найти или добавить свой товар',
    oninput: (e) => { needle = e.target.value.trim(); drawList(); drawFooter(); },
  });

  const add = (name, price) => {
    const key = name.toLowerCase();
    if (chosen.has(key)) chosen.delete(key);
    else chosen.set(key, { name, price: Number(price) || 0 });
    drawList();
    drawFooter();
  };

  function drawList() {
    const lower = needle.toLowerCase();
    const visible = lower ? all.filter((item) => item.name.toLowerCase().includes(lower)) : all;

    const nodes = visible.slice(0, 120).map((item) => {
      const active = chosen.has(item.name.toLowerCase());
      return el('button', {
        class: `pick ${active ? 'is-active' : ''}`,
        onclick: () => add(item.name, item.price),
      }, [
        el('span', { class: 'pick__name' }, item.name),
        item.price
          ? el('span', { class: 'pick__price num' }, formatAmount(item.price, currency))
          : null,
      ]);
    });

    // Своё название, которого ещё нет в списке
    const isNew = needle && !all.some((item) => item.name.toLowerCase() === lower);
    if (isNew) {
      nodes.unshift(el('button', {
        class: 'pick pick--new',
        onclick: () => { add(needle, 0); search.value = ''; needle = ''; drawList(); drawFooter(); },
      }, [el('span', { class: 'pick__name' }, `＋ ${needle}`)]));
    }

    render(listBox, nodes.length ? nodes : el('p', { class: 'hint' }, 'Ничего не найдено'));
  }

  function drawFooter() {
    const count = chosen.size;
    render(footer, [
      el('button', {
        class: 'btn btn--ghost',
        style: 'flex:0 0 auto',
        onclick: () => closeSheet(),
      }, 'Отмена'),
      el('button', {
        class: 'btn btn--primary',
        style: 'flex:1',
        disabled: count === 0,
        onclick: () => {
          done = true;
          closeSheet();
          onDone([...chosen.values()].map((item) => ({
            name: item.name,
            qty: 1,
            price: item.price,
            total: item.price,
          })));
        },
      }, count ? `Добавить ${count}` : 'Ничего не выбрано'),
    ]);
  }

  drawList();
  drawFooter();

  const sheet = openSheet({
    title: 'Быстрый выбор товаров',
    body: [
      search,
      el('p', { class: 'hint' }, 'Цены подставлены из прошлых покупок — поправишь в форме.'),
      listBox,
    ],
    footer: [footer],
    onClose: () => { if (!done) onCancel?.(); },
  });

  return sheet;
}
