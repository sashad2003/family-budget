/**
 * Регулярные платежи. Раз завёл счёт — дальше каждый месяц он ждёт оплаты:
 * оплаченные отмечены галочкой, забытые горят красным.
 */

import { el, render } from '../core/dom.js?v=9';
import { state, set } from '../core/store.js?v=9';
import { CURRENCY_CODES } from '../config.js?v=9';
import { formatAmount, parseAmount, currencyInfo, convert } from '../core/money.js?v=9';
import { monthLabel, monthKey, today } from '../core/dates.js?v=9';
import { billsForMonth } from '../core/selectors.js?v=9';
import { createBill, updateBill, deleteBill } from '../services/bills.js?v=9';
import { createTransaction, deleteTransaction } from '../services/transactions.js?v=9';
import { openSheet, closeSheet, confirmSheet } from '../ui/sheet.js?v=9';
import { toastOk, toastError } from '../ui/toast.js?v=9';
import { openTxForm } from './txForm.js?v=9';
import { tileGradient } from './list.js?v=9';

export function renderBills() {
  const rows = billsForMonth(state);
  const container = el('div');

  if (!rows.length) {
    render(container, [
      el('div', { class: 'empty' }, [
        el('span', { class: 'empty__ico' }, '🧾'),
        el('div', {}, 'Регулярных платежей пока нет'),
        el('div', { class: 'hint' },
          'Электричество, интернет, телефон, учёба — заведите один раз, и каждый месяц приложение напомнит.'),
      ]),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: () => openBillForm(),
      }, '＋  Добавить платёж'),
    ]);
    return container;
  }

  const unpaid = rows.filter((row) => !row.paid && row.tracked);
  const isPast = state.month <= monthKey(new Date());

  render(container, [
    unpaid.length && isPast
      ? el('div', { class: 'card card--alert' }, [
          el('div', { class: 'card__label', style: 'color:#ffb3b3' },
            `Не оплачено · ${monthLabel(state.month)}`),
          el('div', { style: 'font-size:17px' },
            unpaid.map((row) => row.bill.name).join(', ')),
        ])
      : null,

    el('div', { class: 'section-title' }, [
      el('span', {}, `Платежи · ${monthLabel(state.month)}`),
      el('button', { class: 'chip', onclick: () => openBillForm() }, '＋ платёж'),
    ]),

    // Группировка по категориям: коммунальные отдельно от услуг и учёбы
    ...groupByCategory(rows).map(({ category, list, total }) => el('div', {}, [
      el('div', { class: 'bills__group' }, [
        el('span', {}, `${category?.icon || '•'} ${category?.name || 'Без категории'}`),
        el('span', { class: 'num' }, formatAmount(total, state.base)),
      ]),
      el('div', { class: 'bills' }, list.map((row) => billRow(row))),
    ])),

    el('p', { class: 'hint', style: 'margin-top:14px' },
      'Галочка — оплачено в этом месяце. Нажатие на строку открывает оплату, шестерёнка — настройки счёта.'),
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
        style: `background:${tileGradient(category?.color || '#5b9fff')}`,
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
      'aria-label': 'Настройки платежа',
      onclick: () => openBillForm(bill),
    }, '⚙'),
  ]);
}

function billMeta(bill, paid, tx, overdue) {
  if (paid) return `оплачено${tx?.date ? ` · ${tx.date.slice(8)}.${tx.date.slice(5, 7)}` : ''}`;
  if (overdue) return bill.dueDay ? `не оплачено · до ${bill.dueDay} числа` : 'не оплачено';
  return bill.fixed ? 'постоянная сумма' : 'сумма меняется';
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

  const write = el('button', { class: 'btn btn--primary', style: 'flex:1' }, 'Записать оплату');
  write.addEventListener('click', async () => {
    write.disabled = true;
    try {
      await createTransaction(model, { rates: state.rates, user: state.user });
      toastOk(`${bill.name} — оплачено`);
      closeSheet();
    } catch (error) {
      console.error(error);
      toastError('Не удалось записать оплату');
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
        style: 'flex:0 0 auto',
        onclick: () => closeSheet(),
      }, 'Отмена'),
      el('button', {
        class: 'btn btn--ghost',
        style: 'flex:0 0 auto',
        onclick: () => openTxForm({ model }),
      }, 'Другая сумма'),
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
        style: 'flex:0 0 auto',
        onclick: async () => {
          try {
            await deleteTransaction(tx.id);
            toastOk('Оплата отменена');
            closeSheet();
          } catch {
            toastError('Не удалось отменить');
          }
        },
      }, 'Отменить оплату'),
      el('button', {
        class: 'btn btn--primary',
        style: 'flex:1',
        onclick: () => openTxForm({ tx }),
      }, 'Изменить'),
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
      };

  const body = el('div');
  const rerender = () => render(body, buildBillBody(model, rerender));
  rerender();

  const save = el('button', { class: 'btn btn--primary', style: 'flex:1' }, bill ? 'Сохранить' : 'Добавить');
  save.addEventListener('click', async () => {
    if (!model.name.trim()) { toastError('Введите название'); return; }
    if (!model.categoryId) { toastError('Выберите категорию'); return; }
    if (model.fixed && !model.amount) { toastError('Введите постоянную сумму'); return; }

    save.disabled = true;
    try {
      if (bill) await updateBill(bill.id, model);
      else await createBill(model);
      toastOk('Сохранено');
      closeSheet();
    } catch (error) {
      console.error(error);
      toastError('Не удалось сохранить');
      save.disabled = false;
    }
  });

  const footer = bill
    ? [
        el('button', {
          class: 'btn btn--danger',
          style: 'flex:0 0 auto',
          onclick: () => {
            closeSheet();
            confirmSheet({
              title: 'Удалить платёж?',
              text: 'Записанные оплаты останутся в операциях.',
              onConfirm: async () => {
                try {
                  await deleteBill(bill.id);
                  toastOk('Удалено');
                } catch {
                  toastError('Не удалось удалить');
                }
              },
            });
          },
        }, 'Удалить'),
        save,
      ]
    : [save];

  openSheet({ title: bill ? 'Платёж' : 'Новый платёж', body, footer });
}

function buildBillBody(model, rerender) {
  const pool = state.categories.filter((c) => c.type === 'expense' && !c.archived);

  return [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, 'Название'),
      el('input', {
        class: 'input',
        type: 'text',
        value: model.name,
        placeholder: 'Электричество',
        oninput: (e) => { model.name = e.target.value; },
      }),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, 'Категория'),
      el('div', { class: 'cat-grid' }, pool.map((cat) =>
        el('button', {
          class: `cat ${model.categoryId === cat.id ? 'is-active' : ''}`,
          style: model.categoryId === cat.id ? `color:${cat.color}` : '',
          onclick: () => { model.categoryId = cat.id; rerender(); },
        }, [
          el('span', { class: 'cat__ico', style: `background:${tileGradient(cat.color)}` },
            cat.icon || '•'),
          el('span', {}, cat.name),
        ]),
      )),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, 'Валюта'),
      el('div', { class: 'segmented' }, CURRENCY_CODES.map((code) =>
        el('button', {
          class: model.currency === code ? 'is-active' : '',
          onclick: () => { model.currency = code; rerender(); },
        }, `${code} ${currencyInfo(code).symbol}`),
      )),
    ]),

    // Постоянная сумма — тот случай, когда платёж записывается одним тапом
    el('button', {
      class: `toggle ${model.fixed ? 'is-on' : ''}`,
      onclick: () => { model.fixed = !model.fixed; rerender(); },
    }, [
      el('span', {}, [
        el('span', { class: 'toggle__title' }, 'Сумма не меняется'),
        el('span', { class: 'toggle__sub' },
          'Каждый месяц одинаковая — оплата одним нажатием'),
      ]),
      el('span', { class: 'toggle__knob' }),
    ]),

    el('div', { class: 'field', style: 'margin-top:14px' }, [
      el('label', { class: 'field__label' },
        model.fixed ? 'Постоянная сумма' : 'Примерная сумма (подставится при оплате)'),
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
        el('label', { class: 'field__label' }, 'Платить до числа'),
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
        el('label', { class: 'field__label' }, 'Следить с месяца'),
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
        el('span', { class: 'toggle__title' }, 'Напоминать каждый месяц'),
        el('span', { class: 'toggle__sub' }, 'Выключите, если платёж закончился'),
      ]),
      el('span', { class: 'toggle__knob' }),
    ]),
  ];
}

/** Открыть экран платежей — из напоминания на обзоре. */
export const gotoBills = () => set({ route: 'bills' });
