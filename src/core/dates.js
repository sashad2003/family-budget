/** Работа с датами. Дата транзакции хранится строкой 'YYYY-MM-DD' — без часовых поясов. */

import { t, intlLocale } from './i18n.js?v=42';

/**
 * Названия месяцев берём у браузера, а не держим списком.
 *
 * Их три набора на три языка, и в русском ещё две формы: «январь» в шапке и
 * «5 января» в дате. Intl знает всё это сам и всегда согласует форму с тем,
 * что рядом, — списки пришлось бы держать и править вручную.
 */
function monthName(year, month, withDay = null) {
  const date = new Date(year, month - 1, withDay ?? 1);
  return new Intl.DateTimeFormat(intlLocale(), withDay
    ? { day: 'numeric', month: 'long' }
    : { month: 'long' }).format(date);
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' для сегодняшнего дня по локальному времени. */
export function today() {
  return isoDate(new Date());
}

export function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM' */
export function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function monthOf(isoDateStr) {
  return String(isoDateStr).slice(0, 7);
}

/** Сдвиг месяца: shiftMonth('2026-01', -1) → '2025-12' */
export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return monthKey(date);
}

/** 'январь 2026' — год пишем только у прошлых лет, в текущем он лишний. */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const label = monthName(y, m);
  return y === new Date().getFullYear() ? label : `${label} ${y}`;
}

/** '5 февраля', 'сегодня', 'вчера' */
export function dayLabel(isoStr) {
  if (isoStr === today()) return t('date.today');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isoStr === isoDate(yesterday)) return t('date.yesterday');

  const [y, m, d] = isoStr.split('-').map(Number);
  return monthName(y, m, d);
}

/** Границы месяца включительно: ['2026-01-01', '2026-01-31'] */
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return [`${key}-01`, isoDate(new Date(y, m, 0))];
}

/** Приводит произвольный ввод к 'YYYY-MM-DD' или возвращает '' */
export function normalizeDate(value) {
  const str = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // 05.02.2026 / 5.2.26 / 05/02/2026
  const m = str.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    const [, d, mo, rawY] = m;
    const y = rawY.length === 2 ? `20${rawY}` : rawY;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return '';
}
