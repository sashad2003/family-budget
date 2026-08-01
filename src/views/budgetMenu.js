/**
 * Выбор бюджета.
 *
 * Живёт в двух местах — под логотипом на большом экране и строкой под шапкой
 * на телефоне, — но список один и тот же, поэтому и код один.
 */

import { el } from '../core/dom.js?v=30';
import { state } from '../core/store.js?v=30';
import { switchFamily } from '../services/account.js?v=30';
import { openSheet, closeSheet } from '../ui/sheet.js?v=30';
import { toastError } from '../ui/toast.js?v=30';

export function budgetName(family) {
  return family?.name || family?.title || 'Бюджет';
}

export function openBudgetMenu() {
  const families = state.families || [];

  openSheet({
    title: 'Бюджеты',
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
          isOpen ? el('span', { class: 'budget__mark' }, 'открыт') : null,
        ]);
      })),
      el('p', { class: 'hint' },
        'Чужой бюджет появляется здесь после перехода по ссылке-приглашению.'),
    ],
  });
}

async function choose(family, isOpen) {
  if (isOpen) {
    closeSheet();
    return;
  }

  try {
    await switchFamily(state.user.uid, family.id);
    // От бюджета зависят все экраны разом — проще перезайти начисто.
    location.reload();
  } catch {
    toastError('Не удалось переключить бюджет');
  }
}

export function membersLabel(family) {
  const count = (family.memberUids || []).length;
  if (count % 100 >= 11 && count % 100 <= 14) return `${count} участников`;
  if (count % 10 === 1) return `${count} участник`;
  if (count % 10 >= 2 && count % 10 <= 4) return `${count} участника`;
  return `${count} участников`;
}
