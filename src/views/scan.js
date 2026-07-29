/**
 * Сканирование чека: фото с камеры, фото из галереи или ссылка со страницы
 * чека (та, что зашита в QR инвойса). Результат — черновик, который
 * открывается в редактируемой форме.
 */

import { el, render } from '../core/dom.js?v=4';
import { openSheet, closeSheet } from '../ui/sheet.js?v=4';
import { toastError } from '../ui/toast.js?v=4';
import { scanReceiptImages, scanReceiptUrl, MAX_RECEIPT_IMAGES } from '../services/receipts.js?v=4';

/** Шторка «распознаём…» — на время запроса заменяет собой форму. */
function showBusy(text) {
  openSheet({
    title: 'Сканирование чека',
    body: el('div', { class: 'empty' }, [
      el('div', { class: 'spinner', style: 'margin:0 auto 14px' }),
      el('div', {}, text),
      el('div', { class: 'hint', style: 'margin-top:6px' }, 'Обычно занимает 5–15 секунд'),
    ]),
  });
}

async function run(task, waitText, onDraft) {
  showBusy(waitText);
  try {
    const draft = await task();
    closeSheet();
    onDraft(draft);
  } catch (error) {
    console.error(error);
    closeSheet();
    toastError(error.message || 'Не удалось распознать');
  }
}

/**
 * Открывает выбор файлов. С capture телефон показывает камеру,
 * без него — галерею, поэтому два разных input.
 */
function pickPhotos({ fromCamera }, onDraft) {
  const input = el('input', {
    type: 'file',
    accept: 'image/*',
    style: 'position:fixed;left:-9999px;top:0',
  });
  if (fromCamera) input.capture = 'environment';
  else input.multiple = true;

  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.remove();
    if (!files.length) return;
    if (files.length > MAX_RECEIPT_IMAGES) {
      toastError(`Не больше ${MAX_RECEIPT_IMAGES} фото за раз`);
      return;
    }
    run(
      () => scanReceiptImages(files),
      files.length > 1 ? `Распознаём чек, ${files.length} фото…` : 'Распознаём чек…',
      onDraft,
    );
  });

  document.body.append(input);
  input.click();
}

export const scanFromCamera = (onDraft) => pickPhotos({ fromCamera: true }, onDraft);
export const scanFromGallery = (onDraft) => pickPhotos({ fromCamera: false }, onDraft);

/** Шторка для ссылки со страницы фискального чека. */
export function openScanUrlSheet(onDraft) {
  const urlInput = el('input', {
    class: 'input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://…',
  });

  const submit = () => {
    const url = urlInput.value.trim();
    if (!/^https:\/\//i.test(url)) {
      toastError('Ссылка должна начинаться с https://');
      return;
    }
    run(() => scanReceiptUrl(url), 'Читаем страницу чека…', onDraft);
  };

  openSheet({
    title: 'Чек по ссылке',
    body: [
      urlInput,
      el('p', { class: 'hint' },
        'Страница фискального чека по ссылке с инвойса — оттуда берётся точный список товаров и цен.'),
    ],
    footer: [el('button', { class: 'btn btn--primary', onclick: submit }, 'Разобрать')],
  });
}

/** Полное меню сканирования — используется там, где нет своих кнопок. */
export function openScanSheet(onDraft) {
  const body = el('div');

  render(body, [
    el('div', { class: 'scan-row' }, [
      el('button', { class: 'scan-tile', onclick: () => scanFromCamera(onDraft) }, [
        el('span', { class: 'scan-tile__ico' }, '📷'),
        el('span', {}, 'Снять камерой'),
      ]),
      el('button', { class: 'scan-tile', onclick: () => scanFromGallery(onDraft) }, [
        el('span', { class: 'scan-tile__ico' }, '🖼'),
        el('span', {}, 'Из галереи'),
      ]),
    ]),
    el('p', { class: 'hint' },
      `До ${MAX_RECEIPT_IMAGES} фото одного чека — длинную ленту снимайте частями по порядку.`),
    el('div', { class: 'divider' }, 'или'),
    el('button', {
      class: 'btn btn--ghost btn--wide',
      onclick: () => openScanUrlSheet(onDraft),
    }, '🔗  Ссылка из QR-кода'),
  ]);

  openSheet({ title: 'Сканирование чека', body });
}
