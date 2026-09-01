/**
 * Разбор банковской SMS о списании по карте — без обращения к AI.
 *
 * Формат сербских банков (ALTA и родственные) устроен одинаково:
 *   Placanje VISA karticom **5295: iznos 1,733.94RSD, mesto 213 - MAXI 236>,
 *   dana 31.07.2026 u 20:33:09h. Rasp.: RSD 34,973.32. Vasa ALTA banka
 *
 * Здесь ловится только этот привычный случай. Всё остальное возвращает null —
 * такой текст уходит в Claude, который разберёт любой банк и язык.
 */

import { CURRENCY_CODES } from '../config.js?v=80';

/** Сумма и валюта: «iznos 1,733.94RSD» или «RSD 1.733,94». */
const AMOUNT_RE = new RegExp(
  `iznos[\\s:]*(?:(${CURRENCY_CODES.join('|')})[\\s]*)?([\\d.,]+)[\\s]*(${CURRENCY_CODES.join('|')})?`,
  'i',
);
/** Место покупки: всё между «mesto» и следующей запятой. */
const PLACE_RE = /mesto[\s:]*([^,]+)/i;
/** Дата операции: «dana 31.07.2026». */
const DATE_RE = /dana[\s:]*(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/i;
/** Время операции: «u 20:33:09h». Секунды в бюджете не нужны. */
const TIME_RE = /\bu\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*h?/i;

/**
 * Возвращает черновик в том же виде, что и ответ модели по чеку,
 * либо null, если текст не похож на знакомую SMS.
 */
export function parseBankSms(text) {
  const raw = String(text || '');
  if (!raw.trim()) return null;

  const amountMatch = raw.match(AMOUNT_RE);
  const dateMatch = raw.match(DATE_RE);
  if (!amountMatch || !dateMatch) return null;

  const currency = (amountMatch[1] || amountMatch[3] || '').toUpperCase();
  const total = parseSmsNumber(amountMatch[2]);
  if (!currency || !total) return null;

  const [, day, month, year] = dateMatch;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  const timeMatch = raw.match(TIME_RE);
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '';

  return {
    merchant: cleanPlace(raw.match(PLACE_RE)?.[1] || ''),
    date,
    time,
    currency,
    total,
    category_hint: '',
    items: [],
  };
}

/**
 * Число из SMS: разделители встречаются в обоих порядках («1,733.94» и «1.733,94»).
 * Десятичным считаем последний знак, если за ним осталось не больше двух цифр,
 * всё остальное — разряды тысяч.
 */
function parseSmsNumber(input) {
  // Хвостовой разделитель — это запятая предложения, а не часть числа.
  const cleaned = String(input).replace(/[^\d.,]/g, '').replace(/[.,]+$/, '');
  if (!cleaned) return 0;

  const lastSeparator = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  const tail = lastSeparator === -1 ? '' : cleaned.slice(lastSeparator + 1);

  const normalized = lastSeparator !== -1 && tail.length > 0 && tail.length <= 2
    ? `${cleaned.slice(0, lastSeparator).replace(/[.,]/g, '')}.${tail}`
    : cleaned.replace(/[.,]/g, '');

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Название магазина из поля mesto: «213 - MAXI 236>» → «MAXI».
 * Банк заворачивает его в служебные номера терминала — они только мешают
 * искать по названию и сверять с чеком.
 */
function cleanPlace(input) {
  let place = String(input).trim();

  // Ведущий код терминала отделён дефисом.
  place = place.replace(/^\s*\d+\s*[-–]\s*/, '');
  // Хвостовой номер точки и мусорные символы вроде «>».
  place = place.replace(/[\s>]*\d*\s*>?\s*$/, '');

  return place.replace(/\s+/g, ' ').trim();
}
