/**
 * Язык и валюта — в одной шторке.
 *
 * Обе настройки меняют вид всего приложения и нужны сразу при первом
 * знакомстве, поэтому вынесены в шапку, а не спрятаны в настройки: человеку,
 * который не читает по-русски, надо переключить язык, не понимая ни одной
 * надписи вокруг. Названия языков поэтому написаны каждое на себе самом.
 */

import { el } from '../core/dom.js?v=97';
import { state, set } from '../core/store.js?v=97';
import { CURRENCIES } from '../config.js?v=97';
import { formatAmount, convert } from '../core/money.js?v=97';
import { openSheet, closeSheet } from '../ui/sheet.js?v=97';
import {
  t, LOCALES, getLocale, setLocale, translateDocument,
} from '../core/i18n.js?v=97';

export function openBaseCurrencyPicker() {
  openSheet({
    title: t('currency.langTitle'),
    body: [
      el('div', { class: 'segmented', style: 'margin-bottom:18px' }, LOCALES.map((lang) =>
        el('button', {
          class: getLocale() === lang.code ? 'is-active' : '',
          lang: lang.code,
          onclick: () => {
            setLocale(lang.code);
            // Язык меняет и статическую разметку, и содержимое самой шторки.
            translateDocument();
            set({});
            openBaseCurrencyPicker();
          },
        }, lang.name),
      )),

      el('div', { class: 'cur-list' }, CURRENCIES.filter((cur) => state.currencies.includes(cur.code)).map((cur) =>
        el('button', {
          class: `cur ${state.base === cur.code ? 'is-active' : ''}`,
          onclick: () => { set({ base: cur.code }); closeSheet(); },
        }, [
          el('span', { class: 'cur__sym' }, cur.symbol),
          el('span', { class: 'cur__body' }, [
            el('span', { class: 'cur__code' }, cur.code),
            el('span', { class: 'cur__name' }, cur.name),
          ]),
          el('span', { class: 'cur__rate num' }, rateHint(cur.code)),
        ]),
      )),
      el('p', { class: 'hint' },
        t('currency.hint')),
    ],
  });
}

/** Сколько это в текущей базовой валюте — чтобы курс был понятен без счёта в уме. */
function rateHint(code) {
  if (code === state.base) return t('currency.current');
  const value = convert(1, code, state.base, state.rates);
  return `1 ${code} ≈ ${formatAmount(value, state.base)}`;
}
