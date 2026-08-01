/**
 * Сканирование чека: фото с камеры, фото из галереи или ссылка со страницы
 * чека (та, что зашита в QR инвойса). Результат — черновик, который
 * открывается в редактируемой форме.
 */

import { el, render } from '../core/dom.js?v=36';
import { openSheet, closeSheet } from '../ui/sheet.js?v=36';
import { toastError } from '../ui/toast.js?v=36';
import { state } from '../core/store.js?v=36';
import { findDuplicates, sameMoment } from '../core/selectors.js?v=36';
import { formatAmount } from '../core/money.js?v=36';
import { scanReceiptImages, scanReceiptUrl, scanSmsText, MAX_RECEIPT_IMAGES } from '../services/receipts.js?v=36';

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

    // Одну и ту же покупку легко внести дважды: сначала чек, потом SMS о списании.
    // Ровное совпадение суммы, валюты и дня — повод спросить, пока форма не открыта.
    const candidate = {
      type: 'expense',
      amount: draft.total,
      currency: draft.currency,
      date: draft.date,
      time: draft.time,
      receiptUrl: draft.receiptUrl,
    };
    const twins = findDuplicates(state, candidate, { dayWindow: 0 });

    if (twins.length) {
      warnAboutDuplicate(draft, twins, candidate, onDraft);
      return;
    }

    onDraft(draft);
  } catch (error) {
    console.error(error);
    closeSheet();
    toastError(error.message || 'Не удалось распознать');
  }
}

/** «Уже вносили?» — показываем найденные операции и оставляем выбор за человеком. */
function warnAboutDuplicate(draft, twins, candidate, onDraft) {
  // Совпавшее до минуты время — почти наверняка та же покупка, показываем первой.
  const sorted = [...twins].sort(
    (a, b) => Number(sameMoment(b, candidate)) - Number(sameMoment(a, candidate)),
  );
  const exact = sorted.some((tx) => sameMoment(tx, candidate));

  const rows = sorted.slice(0, 5).map((tx) => el('div', { class: 'alert__row' }, [
    el('b', {}, formatAmount(tx.amount, tx.currency, { exact: true })),
    ` · ${tx.date}${tx.time ? ` ${tx.time}` : ''}${tx.merchant ? ` · ${tx.merchant}` : ''}`,
    sameMoment(tx, candidate) ? el('b', {}, ' · то же время') : null,
  ]));

  openSheet({
    title: exact ? '⚠️ Это уже внесено' : '⚠️ Возможно, уже внесено',
    body: [
      el('div', { class: 'alert' }, [
        el('div', { class: 'alert__title' },
          exact
            ? 'Та же сумма в ту же минуту — почти наверняка эта покупка уже записана'
            : twins.length === 1
              ? 'На эту дату уже есть операция на ту же сумму'
              : `На эту дату уже есть операции на ту же сумму (${twins.length})`),
        ...rows,
      ]),
      el('p', { class: 'hint', style: 'margin-top:12px' },
        'Если это другая покупка — добавляйте, ничего страшного.'),
    ],
    // Безопасный выбор — основной: по умолчанию повтор не добавляется.
    footer: [
      el('button', {
        class: 'btn btn--danger',
        onclick: () => { closeSheet(); onDraft(draft); },
      }, 'Всё равно добавить'),
      el('button', { class: 'btn btn--primary', onclick: () => closeSheet() }, 'Не добавлять'),
    ],
  });
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

/**
 * Шторка для SMS банка о списании.
 * Знакомый формат разбирается мгновенно, незнакомый уходит в AI —
 * поэтому текст ожидания нейтральный.
 */
export function openScanSmsSheet(onDraft) {
  const textInput = el('textarea', {
    class: 'textarea',
    rows: '5',
    placeholder: 'Вставьте сюда текст SMS от банка целиком',
  });

  const submit = () => {
    const text = textInput.value.trim();
    if (!text) {
      toastError('Вставьте текст SMS');
      return;
    }
    run(() => scanSmsText(text), 'Разбираем SMS…', onDraft);
  };

  openSheet({
    title: 'SMS от банка',
    body: [
      textInput,
      el('p', { class: 'hint' },
        'Из SMS берутся сумма, магазин, дата и время. Список товаров банк не присылает — '
        + 'при желании добавьте его в форме.'),
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
    el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-top:8px',
      onclick: () => openScanSmsSheet(onDraft),
    }, '💬  SMS от банка'),
  ]);

  openSheet({ title: 'Сканирование чека', body });
}
