/**
 * Сканирование чека: фото или ссылка со страницы чека (та, что зашита в QR инвойса).
 * Результат — черновик, который открывается в редактируемой форме.
 */

import { el, render } from '../core/dom.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { toastError } from '../ui/toast.js';
import { scanReceiptImage, scanReceiptUrl } from '../services/receipts.js';

/** openScanSheet(onDraft) — onDraft получает распознанный черновик. */
export function openScanSheet(onDraft) {
  const body = el('div');

  const busy = (text) => render(body, el('div', { class: 'empty' }, [
    el('div', { class: 'spinner', style: 'margin:0 auto 14px' }),
    el('div', {}, text),
    el('div', { class: 'hint', style: 'margin-top:6px' }, 'Обычно занимает 5–15 секунд'),
  ]));

  const handle = async (task, waitText) => {
    busy(waitText);
    try {
      const draft = await task();
      closeSheet();
      onDraft(draft);
    } catch (error) {
      console.error(error);
      toastError(error.message || 'Не удалось распознать');
      showForm();
    }
  };

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    style: 'display:none',
    onchange: (e) => {
      const file = e.target.files?.[0];
      if (file) handle(() => scanReceiptImage(file), 'Распознаём чек…');
    },
  });

  function showForm() {
    const urlInput = el('input', {
      class: 'input',
      type: 'url',
      inputmode: 'url',
      placeholder: 'https://…',
    });

    render(body, [
      el('div', {
        class: 'scan-drop',
        onclick: () => fileInput.click(),
      }, [
        el('span', { class: 'scan-drop__ico' }, '🧾'),
        el('div', {}, 'Сфотографировать или выбрать чек'),
        el('div', { class: 'hint' }, 'AI прочитает магазин, товары, цены и итог'),
      ]),

      fileInput,

      el('div', { class: 'divider' }, 'или ссылка из QR-кода'),

      urlInput,
      el('p', { class: 'hint' },
        'Страница фискального чека по ссылке с инвойса — оттуда берётся точный список товаров и цен.'),

      el('button', {
        class: 'btn btn--primary btn--wide',
        style: 'margin-top:12px',
        onclick: () => {
          const url = urlInput.value.trim();
          if (!/^https:\/\//i.test(url)) { toastError('Ссылка должна начинаться с https://'); return; }
          handle(() => scanReceiptUrl(url), 'Читаем страницу чека…');
        },
      }, 'Разобрать по ссылке'),
    ]);
  }

  showForm();
  openSheet({ title: 'Сканирование чека', body });
}
