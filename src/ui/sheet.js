/** Нижняя шторка — единственный тип модального окна в приложении. */

import { el } from '../core/dom.js?v=98';
import { t } from '../core/i18n.js?v=98';

let current = null;

/**
 * Открытой шторке соответствует одна запись в истории браузера.
 *
 * Без неё жест «назад» на телефоне закрывал бы всё приложение: страница у нас
 * одна, возвращаться некуда. С записью первый свайп снимает шторку, и только
 * следующий уводит из приложения — как в обычных мобильных программах.
 *
 * Запись одна на любую шторку: если одна шторка сменяет другую, история не
 * растёт, иначе выход из приложения требовал бы столько свайпов, сколько окон
 * успело смениться.
 */
let historyEntry = false;

/**
 * Снятие записи отложено на микрозадачу.
 *
 * По коду сплошь встречается «закрыть шторку и тут же открыть другую»
 * (подтверждение удаления, форма после распознавания чека). Если снимать
 * запись сразу, ответное событие истории прилетело бы уже к новой шторке и
 * погасило бы её. Отложенное снятие успевает отмениться, а запись достаётся
 * новой шторке.
 */
let pendingBack = false;

/**
 * openSheet({ title, body, footer, onClose })
 *   body    — DOM-узел или массив узлов
 *   footer  — кнопки; если не передан, подвала нет
 *   onClose — вызывается при любом закрытии этой шторки
 * Возвращает { close }.
 */
export function openSheet({ title = '', body = [], footer = null, onClose = null }) {
  // Историю здесь не трогаем: запись переиспользуется новой шторкой.
  destroy();

  const backdrop = el('div', { class: 'sheet-backdrop', onclick: closeSheet });

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { class: 'sheet__head' }, [
      el('div', { class: 'sheet__title' }, title),
      el('button', { class: 'icon-btn', onclick: closeSheet, 'aria-label': t('common.close') }, '✕'),
    ]),
    el('div', { class: 'sheet__body' }, body),
    footer ? el('div', { class: 'sheet__foot' }, footer) : null,
  ]);

  document.getElementById('sheet-root').append(backdrop, sheet);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onEscape);

  current = { backdrop, sheet, onClose };

  if (pendingBack) {
    // Закрыли и сразу открыли новую — запись остаётся прежней.
    pendingBack = false;
    historyEntry = true;
  } else if (!historyEntry) {
    history.pushState({ sheet: true }, '');
    historyEntry = true;
  }

  return { close: closeSheet };
}

export function closeSheet() {
  if (!current) return;
  destroy();

  // Свою запись в истории снимаем сами — иначе после закрытия шторки крестиком
  // жест «назад» тратился бы впустую вместо выхода из приложения.
  if (!historyEntry || pendingBack) return;

  historyEntry = false;
  pendingBack = true;
  queueMicrotask(() => {
    if (!pendingBack) return;
    pendingBack = false;
    history.back();
  });
}

/** Убирает шторку с экрана. Историю не трогает — этим занимается вызывающий. */
function destroy() {
  if (!current) return;
  const { onClose } = current;
  current.backdrop.remove();
  current.sheet.remove();
  current = null;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', onEscape);
  // После очистки: обработчик может открыть новую шторку.
  onClose?.();
}

// Жест «назад» или кнопка браузера: запись уже снята системой, гасим шторку.
window.addEventListener('popstate', () => {
  historyEntry = false;
  pendingBack = false;
  destroy();
});

function onEscape(event) {
  if (event.key === 'Escape') closeSheet();
}

/** Подтверждение опасного действия. */
export function confirmSheet({ title, text, confirmLabel = null, onConfirm }) {
  openSheet({
    title,
    body: el('p', { style: 'color:var(--fg-1);font-size:14px;margin:4px 0 8px' }, text),
    footer: [
      el('button', { class: 'btn btn--ghost', onclick: closeSheet }, t('common.cancel')),
      el('button', {
        class: 'btn btn--danger',
        onclick: async () => {
          closeSheet();
          await onConfirm();
        },
      }, confirmLabel || t('common.delete')),
    ],
  });
}
