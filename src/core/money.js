/**
 * Деньги и конвертация.
 *
 * Курсы всегда хранятся относительно EUR: rates.RSD — сколько динаров в одном евро.
 * Конвертация идёт через евро: сумма → EUR → целевая валюта.
 *
 * Важно: у каждой транзакции лежит собственный снимок курсов (tx.rates) и заранее
 * посчитанные суммы во всех валютах (tx.amounts). Отчёты за прошлые месяцы
 * поэтому не «плывут», когда курс меняется.
 */

import { CURRENCIES, CURRENCY_CODES, FALLBACK_RATES } from '../config.js?v=30';

const byCode = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code) {
  return byCode[code] || byCode.RSD;
}

/** Пересчёт между валютами по заданному набору курсов (EUR-based). */
export function convert(amount, from, to, rates = FALLBACK_RATES) {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;

  const fromRate = Number(rates?.[from]);
  const toRate = Number(rates?.[to]);
  if (!fromRate || !toRate) return amount;

  return (amount / fromRate) * toRate;
}

/** Считает суммы во всех валютах приложения — то, что кладётся в tx.amounts. */
export function amountsInAllCurrencies(amount, currency, rates) {
  const result = {};
  for (const code of CURRENCY_CODES) {
    result[code] = round(convert(amount, currency, code, rates), code);
  }
  return result;
}

/** Сумма транзакции в нужной валюте: берём зафиксированный снимок, иначе считаем на лету. */
export function txAmountIn(tx, code, fallbackRates) {
  const stored = tx?.amounts?.[code];
  if (Number.isFinite(stored)) return stored;

  // Валюту могли добавить позже, чем записана операция: своих курсов у неё нет,
  // поэтому недостающее берём из текущих, не трогая остальной снимок.
  const snapshot = tx?.rates || {};
  const rates = Number(snapshot[code]) ? snapshot : { ...fallbackRates, ...snapshot };

  return convert(Number(tx?.amount) || 0, tx?.currency || 'RSD', code, rates);
}

/**
 * Округление до копеек независимо от валюты.
 * Нужно там, где считаются цены из чека: у динара знаков после запятой нет,
 * а в чеке они есть, и терять их нельзя — по ним сверяются покупки.
 */
export function roundCents(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function round(value, code) {
  const decimals = currencyInfo(code).decimals;
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

/**
 * '1 234 дин' / '12,50 €'
 *
 * exact — показать копейки, даже если у валюты их обычно не печатают.
 * У динара знаков после запятой ноль, но в чеке и в SMS цена приходит с
 * копейками, и по ним человек узнаёт свою покупку. Поэтому там, где сумма
 * важна сама по себе (строка операции, сверка повторов), показываем её
 * целиком, а в сводках и на графиках оставляем округление.
 */
export function formatAmount(value, code, { sign = false, exact = false } = {}) {
  const info = currencyInfo(code);
  const num = Number(value) || 0;

  const hasFraction = Math.abs(num % 1) > 0.0001;
  const decimals = exact && hasFraction ? Math.max(info.decimals, 2) : info.decimals;

  const body = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(num));

  const prefix = sign ? (num > 0 ? '+' : num < 0 ? '−' : '') : num < 0 ? '−' : '';
  return `${prefix}${body} ${info.symbol}`;
}

/** Разбирает ввод пользователя: '1 234,56' → 1234.56 */
export function parseAmount(input) {
  const cleaned = String(input ?? '')
    .replace(/\s| /g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}
