/** Работа с датами. Дата транзакции хранится строкой 'YYYY-MM-DD' — без часовых поясов. */

import { t, intlLocale } from './i18n.js?v=130';

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

/**
 * Дата покупки из того, что вернула модель.
 *
 * Модель переводит дату чека в YYYY-MM-DD сама и иногда читает её
 * по-американски: «04.10.2026» в сербском чеке — это 4 октября, а не
 * 10 апреля. Ошибка тихая: запись уходит в другой месяц, человек её не
 * находит и заводит заново.
 *
 * Поэтому дату пересобираем здесь, а не доверяем переводу:
 *   1. Если видна дата, как она напечатана, читаем день первым — так пишут
 *      и в Сербии, и в Израиле.
 *   2. Будущего у чека не бывает. Дата впереди сегодняшней означает, что
 *      день и месяц переставлены местами: пробуем обратный порядок.
 *   3. Ничего не вышло — сегодня: пусть человек поправит в форме, зато
 *      запись не потеряется в чужом месяце.
 *
 * Возвращает { date, guessed }: guessed — что порядок пришлось менять, об
 * этом в форме стоит предупредить.
 */
export function receiptDate(isoFromModel, rawAsPrinted = '', now = today()) {
  const raw = String(rawAsPrinted || '').trim();

  // Напечатанная дата числами: день первым, как принято здесь.
  const printed = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/.test(raw) ? normalizeDate(raw) : '';
  const model = /^\d{4}-\d{2}-\d{2}$/.test(String(isoFromModel || '')) ? String(isoFromModel) : '';

  for (const candidate of [printed, model]) {
    if (!candidate) continue;
    if (candidate <= now) return { date: candidate, guessed: false };

    // Дата из будущего: скорее всего день и месяц переставлены.
    const swapped = swapDayMonth(candidate);
    if (swapped && swapped <= now) return { date: swapped, guessed: true };
  }

  return { date: now, guessed: Boolean(printed || model) };
}

/** '2026-04-10' → '2026-10-04'. Пустая строка, если так месяца не бывает. */
function swapDayMonth(iso) {
  const [y, m, d] = iso.split('-');
  if (Number(d) < 1 || Number(d) > 12) return '';

  const swapped = `${y}-${d}-${m}`;
  const [, , dayNow] = swapped.split('-');
  const last = new Date(Number(y), Number(d), 0).getDate();
  return Number(dayNow) <= last ? swapped : '';
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
