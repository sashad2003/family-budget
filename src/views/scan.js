/**
 * Сканирование чека: фото или ссылка со страницы чека (та, что зашита в QR инвойса).
 * Результат — черновик, который открывается в редактируемой форме.
 */

import { el, render } from '../core/dom.js';
import { openSheet, closeSheet } from '../ui/sheet.js';
import { toastError } from '../ui/toast.js';
import { scanReceiptImages, scanReceiptUrl, MAX_RECEIPT_IMAGES } from '../services/receipts.js';

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

  // Два отдельных input: с capture телефон открывает камеру и не пускает в галерею.
  const runScan = (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (list.length > MAX_RECEIPT_IMAGES) {
      toastError(`Не больше ${MAX_RECEIPT_IMAGES} фото за раз`);
      return;
    }
    handle(
      () => scanReceiptImages(list),
      list.length > 1 ? `Распознаём чек, ${list.length} фото…` : 'Распознаём чек…',
    );
  };

  const cameraInput = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    style: 'display:none',
    onchange: (e) => { runScan(e.target.files); e.target.value = ''; },
  });

  const galleryInput = el('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    style: 'display:none',
    onchange: (e) => { runScan(e.target.files); e.target.value = ''; },
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
        onclick: () => cameraInput.click(),
      }, [
        el('span', { class: 'scan-drop__ico' }, '🧾'),
        el('div', {}, 'Сфотографировать чек'),
        el('div', { class: 'hint' }, 'AI прочитает магазин, товары, цены и итог'),
      ]),

      el('button', {
        class: 'btn btn--ghost btn--wide',
        style: 'margin-top:10px',
        onclick: () => galleryInput.click(),
      }, '🖼  Выбрать из галереи'),

      el('p', { class: 'hint' },
        `Можно выбрать до ${MAX_RECEIPT_IMAGES} фото одного чека — длинную ленту снимайте частями по порядку.`),

      cameraInput,
      galleryInput,

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
