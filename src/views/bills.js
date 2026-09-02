/**
 * Регулярные платежи. Раз завёл счёт — дальше каждый месяц он ждёт оплаты:
 * оплаченные отмечены галочкой, забытые горят красным.
 */

import { el, render } from '../core/dom.js?v=102';
import { state, set, currencyChoices } from '../core/store.js?v=102';
import { formatAmount, parseAmount, currencyInfo, convert } from '../core/money.js?v=102';
import { monthLabel, monthKey, today } from '../core/dates.js?v=102';
import { billsForMonth } from '../core/selectors.js?v=102';
import { createBill, updateBill, deleteBill } from '../services/bills.js?v=102';
import { autoStartMark } from '../services/autoBills.js?v=102';
import { createTransaction, deleteTransaction } from '../services/transactions.js?v=102';
import { openSheet, closeSheet, confirmSheet } from '../ui/sheet.js?v=102';
import { toastOk, toastError } from '../ui/toast.js?v=102';
import { openTxForm } from './txForm.js?v=102';
import { tileStyle } from './list.js?v=102';
import { section } from '../ui/section.js?v=102';
import { t } from '../core/i18n.js?v=102';

export function renderBills() {
  const rows = billsForMonth(state);
  const container = el('div');

  if (!rows.length) {
    render(container, [
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__ico' }, '🧾'),
        el('div', {}, t('bills.empty')),
        el('div', { class: 'hint' },
          t('bills.emptyHint')),
      ]),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: () => openBillForm(),
      }, t('bills.addFirst')),
    ]);
    return container;
  }

  const unpaid = rows.filter((row) => !row.paid && row.tracked);
  const isPast = state.month <= monthKey(new Date());

  render(container, [
    unpaid.length && isPast
      ? el('div', { class: 'card card--alert' }, [
          el('div', { class: 'card__label', style: 'color:var(--expense-ink)' },
            `Не оплачено · ${monthLabel(state.month)}`),
          el('div', { style: 'font-size:17px' },
            unpaid.map((row) => row.bill.name).join(', ')),
        ])
      : null,

    section(`Платежи · ${monthLabel(state.month)}`, [
      // Группировка по категориям: коммунальные отдельно от услуг и учёбы
      ...groupByCategory(rows).map(({ category, list, total }) => el('div', {}, [
        el('div', { class: 'bills__group' }, [
          el('span', {}, `${category?.icon || '•'} ${category?.name || t('tx.noCategory')}`),
          el('span', { class: 'num' }, formatAmount(total, state.base)),
        ]),
        el('div', { class: 'bills' }, list.map((row) => billRow(row))),
      ])),

      el('p', { class: 'hint' }, t('bills.hint')),
    ], el('button', { class: 'chip', onclick: () => openBillForm() }, t('bills.add'))),
  ]);

  return container;
}

/** Платежи по категориям + сколько выходит за месяц в сводной валюте. */
function groupByCategory(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = row.bill.categoryId || 'none';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const category = state.categories.find((c) => c.id === key) || null;
      const total = list.reduce((sum, row) => {
        const amount = row.paid ? Number(row.tx.amount) : row.expected;
        const currency = row.paid ? row.tx.currency : row.bill.currency;
        return sum + convert(amount, currency, state.base, state.rates);
      }, 0);
      return { category, list, total, order: category?.order ?? 999 };
    })
    .sort((a, b) => a.order - b.order);
}

function billRow({ bill, tx, paid, expected, tracked }) {
  const category = state.categories.find((c) => c.id === bill.categoryId);
  const overdue = !paid && tracked && state.month <= monthKey(new Date());

  return el('div', { class: `bill ${paid ? 'is-paid' : ''} ${overdue ? 'is-overdue' : ''}` }, [
    el('button', {
      class: 'bill__main',
      onclick: () => (paid ? openPaidBill(bill, tx) : payBill(bill, expected)),
    }, [
      el('span', {
        class: 'bill__ico',
        style: tileStyle(category?.color || '#5b9fff'),
      }, paid ? '✓' : category?.icon || '•'),

      el('span', { class: 'bill__body' }, [
        el('span', { class: 'bill__name' }, bill.name),
        el('span', { class: 'bill__meta' }, billMeta(bill, paid, tx, overdue)),
      ]),

      el('span', { class: 'bill__amount num' },
        paid ? formatAmount(tx.amount, tx.currency)
             : expected ? formatAmount(expected, bill.currency) : '—'),
    ]),

    el('button', {
      class: 'bill__edit',
      'aria-label': t('bills.settingsLabel'),
      onclick: () => openBillForm(bill),
    }, '⚙'),
  ]);
}

function billMeta(bill, paid, tx, overdue) {
  if (paid) {
    const date = tx?.date ? ` · ${tx.date.slice(8)}.${tx.date.slice(5, 7)}` : '';
    // Автоматическую оплату отмечаем: иначе непонятно, откуда взялся расход,
    // которого никто не подтверждал.
    const how = tx?.id?.startsWith('auto-') ? t('bills.paidAuto') : t('bills.paidManual');
    return `${how}${date}`;
  }
  if (overdue) {
    return bill.dueDay ? t('bills.unpaidBy', { day: bill.dueDay }) : t('bills.unpaid');
  }
  if (bill.auto) return t('bills.autoMeta', { day: bill.dueDay || 1 });
  return t(bill.fixed ? 'bills.fixedSum' : 'bills.varyingSum');
}

// ---------------------------------------------------------------- оплата

/**
 * Оплата с подтверждением: случайное касание не должно записывать деньги.
 * Постоянную сумму подтверждаем одной кнопкой, меняющуюся правим в форме.
 */
function payBill(bill, expected) {
  const model = {
    type: 'expense',
    amount: expected,
    currency: bill.currency,
    categoryId: bill.categoryId,
    date: paymentDate(state.month),
    note: bill.name,
    merchant: '',
    items: [],
    source: 'bill',
    receiptUrl: '',
    billId: bill.id,
    showItems: false,
    mismatch: false,
  };

  if (!bill.fixed || !expected) {
    openTxForm({ model });
    return;
  }

  const write = el('button', { class: 'btn btn--primary' }, t('bills.pay'));
  write.addEventListener('click', async () => {
    write.disabled = true;
    try {
      await createTransaction(model, { rates: state.rates, user: state.user });
      toastOk(`${bill.name} — оплачено`);
      closeSheet();
    } catch (error) {
      console.error(error);
      toastError(t('bills.payFailed'));
      write.disabled = false;
    }
  });

  openSheet({
    title: bill.name,
    body: [
      el('div', { class: 'confirm-sum num' }, formatAmount(expected, bill.currency)),
      el('p', { class: 'hint', style: 'text-align:center' },
        `Запишем расход за ${monthLabel(state.month)}. Сумму потом можно изменить или отменить оплату.`),
    ],
    footer: [
      el('button', {
        class: 'btn btn--ghost',
        onclick: () => closeSheet(),
      }, t('common.cancel')),
      el('button', {
        class: 'btn btn--ghost',
        onclick: () => openTxForm({ model }),
      }, t('bills.otherSum')),
      write,
    ],
  });
}

/** Уже оплаченный счёт: посмотреть, поправить сумму или отменить оплату. */
function openPaidBill(bill, tx) {
  openSheet({
    title: bill.name,
    body: [
      el('div', { class: 'confirm-sum num', style: 'color:var(--income)' },
        formatAmount(tx.amount, tx.currency)),
      el('p', { class: 'hint', style: 'text-align:center' },
        `Оплачено ${tx.date}. Отмена уберёт эту операцию из бюджета — счёт снова станет неоплаченным.`),
    ],
    footer: [
      el('button', {
        class: 'btn btn--danger',
        onclick: async () => {
          try {
            await deleteTransaction(tx.id, state.user);
            toastOk(t('bills.paymentCancelled'));
            closeSheet();
          } catch {
            toastError(t('bills.cancelFailed'));
          }
        },
      }, t('bills.cancelPayment')),
      el('button', {
        class: 'btn btn--primary',
        onclick: () => openTxForm({ tx }),
      }, t('bills.edit')),
    ],
  });
}

/** В текущем месяце — сегодня, в прошлом — последний день того месяца. */
function paymentDate(month) {
  const now = today();
  if (month === now.slice(0, 7)) return now;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- форма счёта

export function openBillForm(bill = null) {
  const model = bill
    ? { ...bill }
    : {
        name: '',
        categoryId: null,
        currency: state.base,
        amount: 0,
        fixed: false,
        dueDay: 0,
        startMonth: state.month,
        active: true,
        order: 500,
        auto: false,
        autoPaidThrough: null,
      };

  const body = el('div');
  const rerender = () => render(body, buildBillBody(model, rerender));
  rerender();

  const save = el('button', { class: 'btn btn--primary' }, t(bill ? 'common.save' : 'common.add'));
  save.addEventListener('click', async () => {
    if (!model.name.trim()) { toastError(t('bills.nameRequired')); return; }
    if (!model.categoryId) { toastError(t('bills.categoryRequired')); return; }
    if (model.fixed && !model.amount) { toastError(t('bills.amountRequired')); return; }

    save.disabled = true;
    try {
      if (bill) await updateBill(bill.id, model);
      else await createBill(model);
      toastOk(t('bills.saved'));
      closeSheet();
    } catch (error) {
      console.error(error);
      toastError(t('bills.saveFailed'));
      save.disabled = false;
    }
  });

  const footer = bill
    ? [
        el('button', {
          class: 'btn btn--danger',
          onclick: () => {
            closeSheet();
            confirmSheet({
              title: t('bills.deleteTitle'),
              text: t('bills.deleteText'),
              onConfirm: async () => {
                try {
                  await deleteBill(bill.id);
                  toastOk(t('bills.deleted'));
                } catch {
                  toastError(t('bills.deleteFailed'));
                }
              },
            });
          },
        }, t('common.delete')),
        save,
      ]
    : [save];

  openSheet({ title: t(bill ? 'bills.one' : 'bills.new'), body, footer });
}

function buildBillBody(model, rerender) {
  const pool = state.categories.filter((c) => c.type === 'expense' && !c.archived);

  return [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('bills.name')),
      el('input', {
        class: 'input',
        type: 'text',
        value: model.name,
        placeholder: t('bills.namePlaceholder'),
        oninput: (e) => { model.name = e.target.value; },
      }),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('bills.category')),
      el('div', { class: 'cat-grid' }, pool.map((cat) =>
        el('button', {
          class: `cat ${model.categoryId === cat.id ? 'is-active' : ''}`,
          onclick: () => { model.categoryId = cat.id; rerender(); },
        }, [
          el('span', { class: 'cat__ico', style: tileStyle(cat.color) },
            cat.icon || '•'),
          el('span', {}, cat.name),
        ]),
      )),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('bills.currency')),
      el('div', { class: 'segmented' }, currencyChoices(model.currency).map((code) =>
        el('button', {
          class: model.currency === code ? 'is-active' : '',
          onclick: () => { model.currency = code; rerender(); },
        }, `${code} ${currencyInfo(code).symbol}`),
      )),
    ]),

    // Постоянная сумма — тот случай, когда платёж записывается одним тапом
    el('button', {
      class: `toggle ${model.fixed ? 'is-on' : ''}`,
      onclick: () => {
        model.fixed = !model.fixed;
        // Автооплата без постоянной суммы невозможна: записывать нечего.
        if (!model.fixed) model.auto = false;
        rerender();
      },
    }, [
      el('span', {}, [
        el('span', { class: 'toggle__title' }, t('bills.fixedTitle')),
        el('span', { class: 'toggle__sub' },
          t('bills.fixedSub')),
      ]),
      el('span', { class: 'toggle__knob' }),
    ]),

    /**
     * Автооплата работает только у постоянной суммы: у меняющейся заранее
     * известна лишь прошлая, и записать её как факт — значит выдумать расход.
     *
     * Раньше при меняющейся сумме переключателя не было вовсе, и получалось
     * молчаливое исчезновение: о том, что такая возможность вообще есть,
     * узнать было неоткуда. Теперь он на месте, но погашен и сам говорит,
     * чего ему не хватает.
     */
    el('button', {
      class: `toggle ${model.auto ? 'is-on' : ''} ${model.fixed ? '' : 'is-locked'}`,
      style: 'margin-top:10px',
      onclick: () => {
        // Нажатие при меняющейся сумме объясняет, а не молчит.
        if (!model.fixed) { toastError(t('bills.autoNeedsFixed')); return; }

        model.auto = !model.auto;
        // Отметка ставится в момент включения: она решает, с какого
        // месяца счёт начнёт платиться, и назад не отодвигается.
        if (model.auto) model.autoPaidThrough = autoStartMark(model);
        rerender();
      },
    }, [
      el('span', {}, [
        el('span', { class: 'toggle__title' }, t('bills.autoTitle')),
        el('span', { class: 'toggle__sub' },
          t(model.fixed ? 'bills.autoSub' : 'bills.autoNeedsFixed')),
      ]),
      el('span', { class: 'toggle__knob' }),
    ]),

    el('div', { class: 'field', style: 'margin-top:14px' }, [
      el('label', { class: 'field__label' },
        t(model.fixed ? 'bills.fixedLabel' : 'bills.approxLabel')),
      el('input', {
        class: 'input',
        type: 'text',
        inputmode: 'decimal',
        value: model.amount ? String(model.amount) : '',
        placeholder: '0',
        oninput: (e) => { model.amount = parseAmount(e.target.value); },
      }),
    ]),

    el('div', { class: 'row' }, [
      el('div', {}, [
        el('label', { class: 'field__label' }, t('bills.dueDay')),
        el('input', {
          class: 'input',
          type: 'number',
          min: '0',
          max: '31',
          value: model.dueDay || '',
          placeholder: '—',
          oninput: (e) => { model.dueDay = Number(e.target.value) || 0; },
        }),
      ]),
      el('div', {}, [
        el('label', { class: 'field__label' }, t('bills.startMonth')),
        el('input', {
          class: 'input',
          type: 'month',
          value: model.startMonth || state.month,
          oninput: (e) => { model.startMonth = e.target.value || state.month; },
        }),
      ]),
    ]),

    el('button', {
      class: `toggle ${model.active !== false ? 'is-on' : ''}`,
      style: 'margin-top:14px',
      onclick: () => { model.active = model.active === false; rerender(); },
    }, [
      el('span', {}, [
        el('span', { class: 'toggle__title' }, t('bills.remindTitle')),
        el('span', { class: 'toggle__sub' }, t('bills.remindSub')),
      ]),
      el('span', { class: 'toggle__knob' }),
    ]),
  ];
}

/** Открыть экран платежей — из напоминания на обзоре. */
export const gotoBills = () => set({ route: 'bills' });
