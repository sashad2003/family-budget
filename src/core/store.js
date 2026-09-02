/**
 * Состояние приложения: один объект + подписки.
 * Никакой магии — set() сливает патч и уведомляет слушателей.
 */

import { CURRENCY_CODES, DEFAULT_BASE_CURRENCY, FALLBACK_RATES } from '../config.js?v=86';
import { monthKey } from './dates.js?v=86';

const listeners = new Set();

export const state = {
  /** Профиль вошедшего пользователя (firebase User) */
  user: null,
  /** Документ семьи */
  family: null,
  /** Профиль из users/{uid}: имя, телефон, подписка */
  profile: null,
  /** Все бюджеты, где человек состоит — для переключателя */
  families: [],
  /** Видна ли админ-панель — почта в ADMIN_EMAILS */
  isAdmin: false,

  categories: [],
  transactions: [],
  /** Регулярные платежи (шаблоны счетов) */
  bills: [],

  /** Курсы к EUR: { EUR: 1, RSD: 117.2, ILS: 3.95, USD: 1.08 } */
  rates: { ...FALLBACK_RATES },
  ratesFetchedAt: null,

  /** Валюта сводных сумм */
  base: localStorage.getItem('base') || DEFAULT_BASE_CURRENCY,
  /** Валюты, которыми человек пользуется: только они предлагаются при вводе */
  currencies: savedCurrencies(),
  /** Выбранный месяц, 'YYYY-MM' */
  month: monthKey(new Date()),
  /** Период статистики: { kind: 'month' | 'm3' | 'm6' | 'm12' | 'ytd' | 'all' | 'custom', from, to } */
  period: { kind: localStorage.getItem('period') || 'month' },
  /** Активный экран */
  route: 'dashboard',
  /** Розовые очки: на обзоре вместо баланса миллиард евро. До перезагрузки. */
  rose: false,

  loading: true,
};

/**
 * Валюты человека. Хранятся у него в браузере, а не в семье: живущим в разных
 * странах удобно по-разному, а операции всё равно записываются каждая в своей
 * валюте и пересчитываются по снимку курсов.
 *
 * Пустой или испорченный список означает «все» — иначе выбрать валюту при
 * вводе стало бы нечем.
 */
function savedCurrencies() {
  const saved = (localStorage.getItem('currencies') || '')
    .split(',')
    .filter((code) => CURRENCY_CODES.includes(code));

  return saved.length ? CURRENCY_CODES.filter((code) => saved.includes(code)) : [...CURRENCY_CODES];
}

/**
 * Валюты для выбора при вводе.
 *
 * К своим добавляем ту, что уже стоит у редактируемой операции: валюту могли
 * выключить после того, как операция записана, и не показать её означало бы
 * молча подменить сумму при первом же сохранении.
 */
export function currencyChoices(current) {
  if (!current || state.currencies.includes(current)) return state.currencies;
  return [...state.currencies, current];
}

/**
 * Главная валюта берётся из включённых.
 *
 * Список валют человек правит сам, и валюты по умолчанию среди них может не
 * оказаться — считать итоги в валюте, которой нет в выборе, незачем.
 */
if (!state.currencies.includes(state.base)) {
  state.base = state.currencies[0];
  localStorage.setItem('base', state.base);
}

export function set(patch) {
  Object.assign(state, patch);
  if (patch.base) localStorage.setItem('base', patch.base);
  if (patch.currencies) localStorage.setItem('currencies', patch.currencies.join(','));
  if (patch.period?.kind) localStorage.setItem('period', patch.period.kind);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
