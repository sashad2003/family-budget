/**
 * Состояние приложения: один объект + подписки.
 * Никакой магии — set() сливает патч и уведомляет слушателей.
 */

import { DEFAULT_BASE_CURRENCY, FALLBACK_RATES } from '../config.js?v=7';
import { monthKey } from './dates.js?v=7';

const listeners = new Set();

export const state = {
  /** Профиль вошедшего пользователя (firebase User) */
  user: null,
  /** Документ семьи */
  family: null,
  /** Является ли пользователь участником семьи */
  isMember: false,

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
  /** Активный экран */
  route: 'dashboard',

  loading: true,
};

export function set(patch) {
  Object.assign(state, patch);
  if (patch.base) localStorage.setItem('base', patch.base);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
