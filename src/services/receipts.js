/**
 * Распознавание чеков через Claude (всегда через api-proxy.php — ключ на сервере).
 *
 * Возвращает нормализованный черновик, который целиком редактируется в форме:
 * AI ошибается в названиях товаров, поэтому ни одно поле не считается финальным.
 */

import { PROXY_URL, CURRENCY_CODES } from '../config.js?v=113';
import { idToken } from './auth.js?v=113';
import { normalizeDate, today } from '../core/dates.js?v=113';
import { parseBankSms } from '../core/smsParse.js?v=113';
import { t } from '../core/i18n.js?v=113';

/** Сколько пикселей по длинной стороне отправляем. Больше — дороже и медленнее без выигрыша. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/** Сколько кадров одного чека принимаем за раз (совпадает с лимитом прокси). */
export const MAX_RECEIPT_IMAGES = 6;

/** Потолок на текст SMS — столько же принимает прокси. */
const MAX_SMS_CHARS = 2000;

/** Одно или несколько фото одного чека — модель собирает из них общий список. */
export async function scanReceiptImages(files) {
  const list = Array.from(files || []).slice(0, MAX_RECEIPT_IMAGES);
  if (!list.length) throw new Error(t('receipt.noFiles'));

  const images = [];
  for (const file of list) {
    const { base64, mediaType } = await prepareImage(file);
    images.push({ data: base64, media_type: mediaType });
  }

  const data = await callProxy({ action: 'receipt_image', images });
  return normalizeReceipt(data.receipt, 'receipt-photo');
}

export async function scanReceiptUrl(url) {
  const data = await callProxy({ action: 'receipt_url', url: String(url).trim() });
  const draft = normalizeReceipt(data.receipt, 'receipt-url');
  draft.receiptUrl = String(url).trim();
  return draft;
}

/**
 * SMS банка о списании по карте.
 *
 * Знакомый сербский формат разбирается прямо здесь — это мгновенно и без запроса.
 * Всё прочее (другой банк, другой язык) отправляем модели.
 */
export async function scanSmsText(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error(t('scan.smsEmpty'));

  const local = parseBankSms(raw);
  if (local) return normalizeReceipt(local, 'sms');

  const data = await callProxy({ action: 'sms_text', text: raw.slice(0, MAX_SMS_CHARS) });
  return normalizeReceipt(data.receipt, 'sms');
}

async function callProxy(payload) {
  const token = await idToken();
  if (!token) throw new Error(t('receipt.signInAgain'));

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.receipt) {
    throw new Error(errorText(data?.error, response.status));
  }

  /**
   * Во что обошёлся разбор — в консоль браузера. Нужно, чтобы понимать
   * настоящую стоимость чека: от неё зависит, сколько стоит подписка.
   */
  if (data.usage) {
    console.info(
      `Чек разобран: ${data.usage.input} вх. + ${data.usage.output} исх. токенов, `
      + `$${data.usage.cost_usd}`,
    );
  }

  return data;
}

function errorText(code, status) {
  const messages = {
    rate_limited: t('receipt.rateLimited'),
    not_allowed: t('receipt.notAllowed'),
    url_must_be_https: t('scan.urlHttps'),
    url_private_address: t('receipt.urlPrivate'),
    page_fetch_failed: t('receipt.pageFailed'),
    page_empty: t('receipt.pageEmpty'),
    pdf_too_large: t('receipt.pdfTooLarge'),
    image_size: t('receipt.imageSize'),
    image_count: t('receipt.imageCount', { n: MAX_RECEIPT_IMAGES }),
    images_too_large: t('receipt.imagesTooLarge'),
    unsupported_media_type: t('receipt.unsupported'),
    claude_unparsable: t('receipt.unparsable'),
    refused: t('receipt.refused'),
    config_missing: t('receipt.configMissing'),
  };
  return messages[code] || t('receipt.genericError', { code: code || status });
}

/** Сжимает фото в браузере: экономит трафик и укладывается в лимит прокси. */
async function prepareImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Браузер не умеет декодировать формат — чаще всего это HEIC из галереи iPhone.
    throw new Error(t('receipt.fileUnreadable', { name: file.name || '—' }));
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
}

/** Приводит ответ модели к форме черновика транзакции. */
function normalizeReceipt(raw, source) {
  const items = Array.isArray(raw?.items) ? raw.items : [];

  const normalizedItems = items
    .map((item) => {
      const qty = num(item?.qty) || 1;
      const price = num(item?.price);
      const total = num(item?.total) || price * qty;
      return {
        name: String(item?.name || '').trim(),
        /** Название обычными словами — по нему товар ищется в базе цен. */
        norm: String(item?.norm || '').trim(),
        qty,
        price: price || (qty ? total / qty : 0),
        total,
      };
    })
    .filter((item) => item.name !== '');

  const currency = CURRENCY_CODES.includes(raw?.currency) ? raw.currency : '';
  const itemsSum = normalizedItems.reduce((sum, item) => sum + item.total, 0);
  const total = num(raw?.total) || itemsSum;

  return {
    merchant: String(raw?.merchant || '').trim(),
    /** Адрес точки: отличает один магазин сети от другого. */
    address: String(raw?.address || '').trim(),
    date: normalizeDate(raw?.date) || today(),
    time: normalizeTime(raw?.time),
    currency,
    total,
    categoryHint: String(raw?.category_hint || '').trim(),
    items: normalizedItems,
    source,
    receiptUrl: '',
    /** Расхождение между суммой строк и итогом — повод показать подсказку. */
    mismatch: normalizedItems.length > 0 && Math.abs(itemsSum - total) > Math.max(1, total * 0.02),
  };
}

/** Время покупки к виду 'ЧЧ:ММ'. Что не разобралось — просто не заполняем. */
function normalizeTime(value) {
  const match = String(value ?? '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';

  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function num(value) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}
