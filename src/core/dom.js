/** Минимум помощников для работы с DOM — вместо фреймворка. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Экранирование пользовательского текста перед вставкой в разметку. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Создаёт элемент: el('div', { class: 'x', onclick: fn }, 'текст' | [узлы]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  // Разворачиваем на любую глубину — по той же причине, что и render ниже.
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Заменяет содержимое контейнера.
 *
 * Списки разворачиваются на любую глубину: экран нередко собирается из
 * кусков, каждый из которых сам вернул несколько блоков. При развороте на
 * один уровень вложенный список молча превращался в строку — на экране
 * появлялось «[object HTMLElement]» вместо разметки.
 */
export function render(container, ...nodes) {
  container.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
}
