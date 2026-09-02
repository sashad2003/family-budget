/**
 * Сканирование чека: фото с камеры, фото из галереи или ссылка со страницы
 * чека (та, что зашита в QR инвойса). Результат — черновик, который
 * открывается в редактируемой форме.
 */

import { el, render } from '../core/dom.js?v=126';
import { openSheet, closeSheet } from '../ui/sheet.js?v=126';
import { toastError } from '../ui/toast.js?v=126';
import { state } from '../core/store.js?v=126';
import { findDuplicates } from '../core/selectors.js?v=126';
import { guessCategory } from '../data/categories.js?v=126';
import { openDupCompare } from './dupCompare.js?v=126';
import { scanReceiptImages, scanReceiptUrl, scanSmsText, MAX_RECEIPT_IMAGES } from '../services/receipts.js?v=126';
import { t } from '../core/i18n.js?v=126';
import { qrSupported, openQrScanner } from '../ui/qrScanner.js?v=126';
import { scanBlocked } from '../services/scanGate.js?v=126';

/** Шторка «распознаём…» — на время запроса заменяет собой форму. */
function showBusy(text) {
  openSheet({
    title: t('scan.title'),
    body: el('div', { class: 'empty' }, [
      el('div', { class: 'spinner', style: 'margin:0 auto 14px' }),
      el('div', {}, text),
      el('div', { class: 'hint', style: 'margin-top:6px' }, t('scan.wait')),
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
    //
    // Кладём в кандидата всё распознанное, а не только сумму с датой: по этим
    // полям идёт сверка с уже записанным, и ими же можно дополнить найденную
    // операцию, если это она и есть.
    const candidate = {
      type: 'expense',
      amount: draft.total,
      currency: draft.currency,
      date: draft.date,
      time: draft.time,
      merchant: draft.merchant || '',
      address: draft.address || '',
      note: '',
      items: draft.items || [],
      categoryId: guessCategory(
        `${draft.categoryHint} ${draft.merchant}`,
        state.categories,
        'expense',
      ),
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
    toastError(error.message || t('scan.failed'));
  }
}

/** «Уже вносили?» — сверка распознанного с записанным, выбор за человеком. */
function warnAboutDuplicate(draft, twins, candidate, onDraft) {
  openDupCompare({
    candidate,
    twins,
    onAddAnyway: () => { closeSheet(); onDraft(draft); },
    onBack: () => closeSheet(),
    // Ушли смотреть найденную операцию — распознанное не пропадает.
    backToNew: () => onDraft(draft),
  });
}

/**
 * Открывает выбор файлов. С capture телефон показывает камеру,
 * без него — галерею, поэтому два разных input.
 */
function pickPhotos({ fromCamera }, onDraft) {
  // Деньги на распознавание кончились: открывать камеру незачем — снимок
  // всё равно некому будет разобрать.
  if (scanBlocked()) {
    toastError(t('scan.unavailable'));
    return;
  }

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
      toastError(t('scan.tooMany', { n: MAX_RECEIPT_IMAGES }));
      return;
    }
    run(
      () => scanReceiptImages(files),
      files.length > 1 ? t('scan.readingN', { n: files.length }) : t('scan.reading'),
      onDraft,
    );
  });

  document.body.append(input);
  input.click();
}

export const scanFromCamera = (onDraft) => pickPhotos({ fromCamera: true }, onDraft);
export const scanFromGallery = (onDraft) => pickPhotos({ fromCamera: false }, onDraft);

/** Разбор ссылки со страницы фискального чека — с проверкой, что она наша. */
function readUrl(url, onDraft) {
  if (scanBlocked()) {
    toastError(t('scan.unavailable'));
    return;
  }
  if (!/^https:\/\//i.test(url)) {
    toastError(t('scan.urlHttps'));
    return;
  }
  run(() => scanReceiptUrl(url), t('scan.readingPage'), onDraft);
}

/** Шторка для ссылки со страницы фискального чека. */
export function openScanUrlSheet(onDraft) {
  const urlInput = el('input', {
    class: 'input',
    type: 'url',
    inputmode: 'url',
    placeholder: 'https://…',
  });

  /*
   * Вставка из буфера. На айфоне камера читает QR сама и кладёт ссылку в
   * буфер — тогда набирать её руками не нужно. Разрешение на чтение буфера
   * спрашивает браузер; отказ не ошибка: поле осталось, вставить можно
   * привычным долгим нажатием.
   */
  const paste = el('button', {
    class: 'chip',
    onclick: async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (text) urlInput.value = text;
      } catch (error) {
        console.debug('Буфер недоступен', error);
        toastError(t('scan.pasteFailed'));
      }
    },
  }, t('scan.paste'));

  const tools = el('div', { class: 'chip-row', style: 'margin-top:10px' }, [paste]);

  // Кнопку чтения QR показываем, только если браузер правда умеет: обещать
  // камеру и открыть пустой экран хуже, чем не обещать.
  qrSupported().then((ok) => {
    if (!ok) return;
    tools.prepend(el('button', {
      class: 'chip',
      onclick: () => openQrScanner(
        (value) => readUrl(value, onDraft),
        () => openScanUrlSheet(onDraft),
      ),
    }, t('scan.qrButton')));
  });

  openSheet({
    title: t('scan.urlTitle'),
    body: [
      urlInput,
      tools,
      el('p', { class: 'hint' },
        t('scan.urlHint')),
    ],
    footer: [el('button', {
      class: 'btn btn--primary',
      onclick: () => readUrl(urlInput.value.trim(), onDraft),
    }, t('scan.parse'))],
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
    placeholder: t('scan.smsPlaceholder'),
  });

  const submit = () => {
    const text = textInput.value.trim();
    if (!text) {
      toastError(t('scan.smsEmpty'));
      return;
    }
    run(() => scanSmsText(text), t('scan.readingSms'), onDraft);
  };

  openSheet({
    title: t('scan.smsTitle'),
    body: [
      textInput,
      el('p', { class: 'hint' },
        t('scan.smsHint')),
    ],
    footer: [el('button', { class: 'btn btn--primary', onclick: submit }, t('scan.parse'))],
  });
}

/** Полное меню сканирования — используется там, где нет своих кнопок. */
export function openScanSheet(onDraft) {
  const body = el('div');

  const tiles = el('div', { class: 'scan-row' }, [
    el('button', { class: 'scan-tile', onclick: () => scanFromCamera(onDraft) }, [
      el('span', { class: 'scan-tile__ico' }, '📷'),
      el('span', {}, t('scan.camera')),
    ]),
    el('button', { class: 'scan-tile', onclick: () => scanFromGallery(onDraft) }, [
      el('span', { class: 'scan-tile__ico' }, '🖼'),
      el('span', {}, t('scan.gallery')),
    ]),
  ]);

  // Третья плитка появляется, если браузер умеет читать QR сам.
  qrSupported().then((ok) => {
    if (!ok) return;
    tiles.append(el('button', {
      class: 'scan-tile',
      onclick: () => openQrScanner(
        (value) => readUrl(value, onDraft),
        () => openScanSheet(onDraft),
      ),
    }, [
      el('span', { class: 'scan-tile__ico' }, '🔳'),
      el('span', {}, t('scan.qr')),
    ]));
  });

  render(body, [
    // Пока денег на распознавание нет, честнее сказать это сразу, чем дать
    // человеку сфотографировать чек и показать ошибку.
    scanBlocked()
      ? el('div', { class: 'card', style: 'margin-bottom:12px' },
          el('div', { class: 'hint' }, t('scan.unavailableLong')))
      : null,
    tiles,
    el('p', { class: 'hint' },
      t('scan.photoHint', { n: MAX_RECEIPT_IMAGES })),
    el('div', { class: 'divider' }, t('scan.or')),
    el('button', {
      class: 'btn btn--ghost btn--wide',
      onclick: () => openScanUrlSheet(onDraft),
    }, t('scan.urlButton')),
    el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-top:8px',
      onclick: () => openScanSmsSheet(onDraft),
    }, t('scan.smsButton')),
  ]);

  openSheet({ title: t('scan.title'), body });
}
