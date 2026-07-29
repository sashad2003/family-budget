/** Нижняя шторка — единственный тип модального окна в приложении. */

import { el } from '../core/dom.js?v=2';

let current = null;

/**
 * openSheet({ title, body, footer })
 *   body   — DOM-узел или массив узлов
 *   footer — кнопки; если не передан, подвала нет
 * Возвращает { close }.
 */
export function openSheet({ title = '', body = [], footer = null }) {
  closeSheet();

  const backdrop = el('div', { class: 'sheet-backdrop', onclick: closeSheet });

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'sheet__head' }, [
      el('div', { class: 'sheet__title' }, title),
      el('button', { class: 'icon-btn', onclick: closeSheet, 'aria-label': 'Закрыть' }, '✕'),
    ]),
    el('div', { class: 'sheet__body' }, body),
    footer ? el('div', { class: 'sheet__foot' }, footer) : null,
  ]);

  document.getElementById('sheet-root').append(backdrop, sheet);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onEscape);

  current = { backdrop, sheet };
  return { close: closeSheet };
}

export function closeSheet() {
  if (!current) return;
  current.backdrop.remove();
  current.sheet.remove();
  current = null;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onEscape);
}

function onEscape(event) {
  if (event.key === 'Escape') closeSheet();
}

/** Подтверждение опасного действия. */
export function confirmSheet({ title, text, confirmLabel = 'Удалить', onConfirm }) {
  openSheet({
    title,
    body: el('p', { style: 'color:var(--fg-1);font-size:14px;margin:4px 0 8px' }, text),
    footer: [
      el('button', { class: 'btn btn--ghost', onclick: closeSheet }, 'Отмена'),
      el('button', {
        class: 'btn btn--danger',
        onclick: async () => {
          closeSheet();
          await onConfirm();
        },
      }, confirmLabel),
    ],
  });
}
