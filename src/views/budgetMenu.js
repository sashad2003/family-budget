/**
 * Выбор бюджета.
 *
 * Живёт в двух местах — под логотипом на большом экране и строкой под шапкой
 * на телефоне, — но список один и тот же, поэтому и код один.
 */

import { el } from '../core/dom.js?v=117';
import { state } from '../core/store.js?v=117';
import { switchFamily } from '../services/account.js?v=117';
import { openSheet, closeSheet } from '../ui/sheet.js?v=117';
import { toastError } from '../ui/toast.js?v=117';
import { t, getLocale } from '../core/i18n.js?v=117';

export function budgetName(family) {
  return family?.name || family?.title || t('budget.one');
}

export function openBudgetMenu() {
  const families = state.families || [];

  openSheet({
    title: t('budget.title'),
    body: [
      el('div', { class: 'budget-list' }, families.map((family) => {
        const isOpen = family.id === state.family?.id;

        return el('button', {
          class: `budget ${isOpen ? 'is-open' : ''}`,
          onclick: () => choose(family, isOpen),
        }, [
          el('span', { class: 'budget__dot' }),
          el('span', { style: 'min-width:0;flex:1' }, [
            el('div', { class: 'budget__name' }, budgetName(family)),
            el('div', { class: 'list-item__sub' }, membersLabel(family)),
          ]),
          isOpen ? el('span', { class: 'budget__mark' }, t('budget.open')) : null,
        ]);
      })),
      el('p', { class: 'hint' }, t('budget.hint')),
    ],
  });
}

async function choose(family, isOpen) {
  if (isOpen) {
    closeSheet();
    return;
  }

  closeSheet();

  // Экраны перерисовывает main.js: страницу не перезагружаем, меняются только
  // подписки на данные. Отметку в профиле пишем следом, она нужна лишь чтобы
  // при следующем входе открылся тот же бюджет.
  window.dispatchEvent(new CustomEvent('switch-budget', { detail: family.id }));

  switchFamily(state.user.uid, family.id).catch(() => {
    toastError(t('budget.rememberFailed'));
  });
}

/**
 * «3 участника».
 *
 * Русский требует три формы в зависимости от числа, английский и иврит
 * обходятся одной, и словарь такое не различает. Поэтому склонение считаем
 * здесь и только для русского, остальным отдаём строку из словаря.
 */
export function membersLabel(family) {
  const n = (family.memberUids || []).length;
  if (getLocale() !== 'ru') return t('budget.members', { n });

  if (n % 100 >= 11 && n % 100 <= 14) return `${n} участников`;
  if (n % 10 === 1) return `${n} участник`;
  if (n % 10 >= 2 && n % 10 <= 4) return `${n} участника`;
  return `${n} участников`;
}
