/** Выбор валюты списком — перебор по кругу неудобен, когда валют больше двух. */

import { el } from '../core/dom.js?v=40';
import { state, set } from '../core/store.js?v=40';
import { CURRENCIES } from '../config.js?v=40';
import { formatAmount, convert } from '../core/money.js?v=40';
import { openSheet, closeSheet } from '../ui/sheet.js?v=40';
import { t } from '../core/i18n.js?v=40';

/** Валюта сводных сумм: в какой считать баланс и итоги месяца. */
export function openBaseCurrencyPicker() {
  openSheet({
    title: t('currency.title'),
    body: [
      el('div', { class: 'cur-list' }, CURRENCIES.map((cur) =>
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
