/**
 * Языки приложения: русский, английский, иврит.
 *
 * Словарь один на все языки — ключ и три перевода рядом. Так сразу видно,
 * где перевода не хватает, и не приходится сверять три файла между собой.
 *
 * Иврит пишется справа налево, поэтому вместе с языком меняется направление
 * всей страницы: браузер сам разворачивает раскладку, если у документа стоит
 * dir="rtl". Отдельной вёрстки для этого не нужно — нужны лишь поправки там,
 * где сторона задана жёстко (см. [dir="rtl"] в стилях).
 */

import { DICT } from '../data/i18n.js?v=49';

/** short — метка на кнопке в шапке; для иврита привычнее IL, а не HE. */
export const LOCALES = [
  { code: 'ru', short: 'RU', name: 'Русский', dir: 'ltr' },
  { code: 'en', short: 'EN', name: 'English', dir: 'ltr' },
  { code: 'he', short: 'IL', name: 'עברית', dir: 'rtl' },
];

const DEFAULT = 'ru';

/**
 * Выбранный язык переживает перезагрузку: держим его рядом с браузером, а не
 * только в профиле. Иначе экран входа — где профиля ещё нет — всегда был бы
 * русским, даже у того, кто русского не знает.
 */
let locale = localStorage.getItem('locale') || detect();

function detect() {
  const known = LOCALES.map((l) => l.code);
  for (const tag of navigator.languages || [navigator.language || '']) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (known.includes(code)) return code;
  }
  return DEFAULT;
}

export function getLocale() {
  return locale;
}

export function localeInfo(code = locale) {
  return LOCALES.find((l) => l.code === code) || LOCALES[0];
}

export function isRTL(code = locale) {
  return localeInfo(code).dir === 'rtl';
}

export function setLocale(code) {
  if (!LOCALES.some((l) => l.code === code)) return;
  locale = code;
  localStorage.setItem('locale', code);
  applyDocumentLocale();
}

/** Проставляет язык и направление всему документу. */
export function applyDocumentLocale() {
  const info = localeInfo();
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir;
}

/**
 * Перевод по ключу.
 *
 * t('family.leave')
 * t('family.title', { n: 3 })  — подстановки пишутся как {n}
 *
 * Ключа нет в словаре — возвращаем сам ключ: в интерфейсе это заметно сразу,
 * в отличие от пустой строки, и понятно, что именно не переведено.
 */
export function t(key, params = null) {
  const entry = DICT[key];
  if (!entry) return key;

  let text = entry[locale] ?? entry[DEFAULT] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * Локаль для встроенного форматирования чисел и дат.
 * У иврита это израильская раскладка, у английского — британская: она ближе
 * к привычному тут порядку «день-месяц-год», чем американская.
 */
export function intlLocale() {
  return { ru: 'ru-RU', en: 'en-GB', he: 'he-IL' }[locale] || 'ru-RU';
}

/** Подставляет переводы в статическую разметку: <span data-i18n="ключ">. */
export function translateDocument(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
}
