/**
 * Состояние приложения: один объект + подписки.
 * Никакой магии — set() сливает патч и уведомляет слушателей.
 */

import { DEFAULT_BASE_CURRENCY, FALLBACK_RATES } from '../config.js?v=52';
import { monthKey } from './dates.js?v=52';

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

export function set(patch) {
  Object.assign(state, patch);
  if (patch.base) localStorage.setItem('base', patch.base);
  if (patch.period?.kind) localStorage.setItem('period', patch.period.kind);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
