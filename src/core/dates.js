/** Работа с датами. Дата транзакции хранится строкой 'YYYY-MM-DD' — без часовых поясов. */

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_NOM = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

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

/** 'январь 2026' */
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const now = new Date();
  const label = MONTHS_NOM[m - 1];
  return y === now.getFullYear() ? label : `${label} ${y}`;
}

/** '5 февраля', 'сегодня', 'вчера' */
export function dayLabel(isoStr) {
  const t = today();
  if (isoStr === t) return 'сегодня';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (isoStr === isoDate(yesterday)) return 'вчера';

  const [, m, d] = isoStr.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}`;
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
