/**
 * Форма операции. Она же приёмник результата распознавания чека:
 * после сканирования каждое поле и каждая строка товара остаются редактируемыми.
 */

import { el, render } from '../core/dom.js?v=44';
import { state } from '../core/store.js?v=44';
import { CURRENCY_CODES } from '../config.js?v=44';
import { formatAmount, parseAmount, roundCents, convert, currencyInfo } from '../core/money.js?v=44';
import { today, dayLabel } from '../core/dates.js?v=44';
import { guessCategory } from '../data/categories.js?v=44';
import { createTransaction, updateTransaction, deleteTransaction } from '../services/transactions.js?v=44';
import { tileGradient } from './list.js?v=44';
import { openSheet, closeSheet, confirmSheet } from '../ui/sheet.js?v=44';
import { toastOk, toastError } from '../ui/toast.js?v=44';
import { scanFromCamera, scanFromGallery, openScanUrlSheet, openScanSmsSheet } from './scan.js?v=44';
import { openQuickPick } from './quickPick.js?v=44';
import { findDuplicates, sameMoment } from '../core/selectors.js?v=44';
import { t } from '../core/i18n.js?v=44';

/**
 * openTxForm({ tx })      — правка существующей операции
 * openTxForm({ draft })   — новая операция, предзаполненная из чека
 * openTxForm({ model })   — возврат к уже набранной форме (после выбора товаров)
 * openTxForm()            — пустая новая операция
 */
export function openTxForm({ tx = null, draft = null, model: restored = null } = {}) {
  const model = restored || (tx ? fromTx(tx) : fromDraft(draft));

  const body = el('div');
  // Перенос — как в подвале шторки: длинные подписи не должны уезжать за край.
  const footer = el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;flex:1' });

  const rerender = () => {
    render(body, buildBody(model, rerender));
    render(footer, buildFooter(model, tx));
  };
  rerender();

  openSheet({
    title: t(tx ? 'form.title' : 'form.newTitle'),
    body,
    footer: [footer],
  });
}

// ---------------------------------------------------------------- модель

function fromTx(tx) {
  return {
    type: tx.type || 'expense',
    amount: Number(tx.amount) || 0,
    currency: tx.currency || state.base,
    categoryId: tx.categoryId || null,
    date: tx.date || today(),
    time: tx.time || '',
    note: tx.note || '',
    merchant: tx.merchant || '',
    address: tx.address || '',
    items: (tx.items || []).map((it) => ({ ...it })),
    source: tx.source || 'manual',
    receiptUrl: tx.receiptUrl || '',
    // Связь с регулярным платежом при правке не теряем.
    billId: tx.billId || null,
    showItems: (tx.items || []).length > 0,
    mismatch: false,
  };
}

function fromDraft(draft) {
  if (!draft) {
    return {
      type: 'expense',
      amount: 0,
      currency: state.base,
      categoryId: null,
      date: today(),
      time: '',
      note: '',
      merchant: '',
      address: '',
      items: [],
      source: 'manual',
      receiptUrl: '',
      showItems: false,
      mismatch: false,
    };
  }

  const guessed = guessCategory(
    `${draft.categoryHint} ${draft.merchant}`,
    state.categories,
    'expense',
  );

  return {
    type: 'expense',
    amount: draft.total || 0,
    currency: draft.currency || state.base,
    categoryId: guessed,
    date: draft.date || today(),
    time: draft.time || '',
    note: '',
    merchant: draft.merchant || '',
    address: draft.address || '',
    items: draft.items || [],
    source: draft.source || 'manual',
    receiptUrl: draft.receiptUrl || '',
    showItems: (draft.items || []).length > 0,
    mismatch: Boolean(draft.mismatch),
  };
}

const itemsSum = (model) => model.items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);

// ---------------------------------------------------------------- разметка

function buildBody(model, rerender) {
  const nodes = [];

  // Чек — самое частое действие, поэтому стоит первым.
  if (!model.showItems) nodes.push(buildScanRow());

  // Тип операции
  nodes.push(
    el('div', { class: 'segmented', style: 'margin-bottom:14px' }, [
      typeButton('expense', t('form.expense'), model, rerender),
      typeButton('income', t('form.income'), model, rerender),
    ]),
  );

  // Сумма + валюта
  const amountInput = el('input', {
    class: 'input input--amount',
    type: 'text',
    inputmode: 'decimal',
    value: model.amount ? String(model.amount) : '',
    placeholder: '0',
    oninput: (e) => { model.amount = parseAmount(e.target.value); updateHint(); },
  });

  const hint = el('div', { class: 'hint', style: 'text-align:center' });
  const updateHint = () => {
    if (model.currency === state.base || !model.amount) { hint.textContent = ''; return; }
    const converted = convert(model.amount, model.currency, state.base, state.rates);
    hint.textContent = t('form.converted', { sum: formatAmount(converted, state.base) });
  };

  nodes.push(el('div', { class: 'field' }, [amountInput, hint]));
  updateHint();

  nodes.push(
    el('div', { class: 'field' }, [
      el('div', { class: 'segmented' }, CURRENCY_CODES.map((code) =>
        el('button', {
          class: `${model.currency === code ? 'is-active' : ''}`,
          onclick: () => { model.currency = code; rerender(); },
        }, `${code} ${currencyInfo(code).symbol}`),
      )),
    ]),
  );
  setTimeout(updateHint, 0);

  // Категории
  const pool = state.categories.filter((c) => c.type === model.type && !c.archived);
  nodes.push(
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('form.category')),
      el('div', { class: 'cat-grid' }, pool.map((cat) =>
        el('button', {
          class: `cat ${model.categoryId === cat.id ? 'is-active' : ''}`,
          style: model.categoryId === cat.id ? `color:${cat.color}` : '',
          onclick: () => { model.categoryId = cat.id; rerender(); },
        }, [
          el('span', {
            class: 'cat__ico',
            style: `background:${tileGradient(cat.color)}`,
          }, cat.icon || '•'),
          el('span', {}, cat.name),
        ]),
      )),
    ]),
  );

  // Дата и время в одной строке. Время необязательно: с чека и из SMS оно
  // приходит само, при ручном вводе его обычно не заполняют.
  nodes.push(
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('form.date')),
        el('input', {
          class: 'input',
          type: 'date',
          value: model.date,
          oninput: (e) => { model.date = e.target.value || today(); },
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('form.time')),
        el('input', {
          class: 'input',
          type: 'time',
          value: model.time,
          oninput: (e) => { model.time = e.target.value || ''; },
        }),
      ]),
    ]),
  );

  // Магазин — во всю ширину: названия бывают длинные
  nodes.push(
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('form.merchant')),
      el('input', {
        class: 'input',
        type: 'text',
        value: model.merchant,
        placeholder: '—',
        oninput: (e) => { model.merchant = e.target.value; },
      }),
    ]),
  );

  // Комментарий
  nodes.push(
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, t('form.note')),
      el('textarea', {
        class: 'textarea',
        placeholder: t('form.notePlaceholder'),
        oninput: (e) => { model.note = e.target.value; },
      }, model.note),
    ]),
  );

  // Чек
  nodes.push(buildReceiptBlock(model, rerender));

  return nodes;
}

/** Две кнопки съёмки и ссылка из QR — вверху формы. */
function buildScanRow() {
  const toForm = (draft) => openTxForm({ draft });

  return el('div', { style: 'margin-bottom:16px' }, [
    el('div', { class: 'scan-row' }, [
      el('button', { class: 'scan-tile', onclick: () => scanFromCamera(toForm) }, [
        el('span', { class: 'scan-tile__ico' }, '📷'),
        el('span', {}, t('form.shootReceipt')),
      ]),
      el('button', { class: 'scan-tile', onclick: () => scanFromGallery(toForm) }, [
        el('span', { class: 'scan-tile__ico' }, '🖼'),
        el('span', {}, t('scan.gallery')),
      ]),
    ]),
    el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-top:8px',
      onclick: () => openScanUrlSheet(toForm),
    }, t('scan.urlButton')),
    el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-top:8px',
      onclick: () => openScanSmsSheet(toForm),
    }, t('scan.smsButton')),
  ]);
}

function typeButton(value, label, model, rerender) {
  return el('button', {
    class: model.type === value ? 'is-active' : '',
    dataset: { value },
    onclick: () => {
      if (model.type === value) return;
      model.type = value;
      model.categoryId = null;
      rerender();
    },
  }, label);
}

function buildReceiptBlock(model, rerender) {
  if (!model.showItems) {
    return el('div', {}, [
      el('div', { class: 'divider' }, t('form.itemsDivider')),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: () => pickItems(model),
      }, t('form.quickPick')),
      el('button', {
        class: 'btn btn--ghost btn--wide',
        style: 'margin-top:8px',
        onclick: () => { model.showItems = true; model.items.push(emptyItem()); rerender(); },
      }, t('form.addManually')),
    ]);
  }

  const sum = itemsSum(model);
  const diff = Math.abs(sum - model.amount) > 0.01;

  return el('div', { style: 'margin-top:18px' }, [
    el('div', { class: 'section__head' }, [
      el('h2', { class: 'section__title' }, t('form.items', { n: model.items.length })),
      el('div', { style: 'display:flex;gap:6px' }, [
        el('button', { class: 'chip', onclick: () => pickItems(model) }, t('form.pick')),
        el('button', {
          class: 'chip',
          onclick: () => { model.items.push(emptyItem()); rerender(); },
        }, t('form.addRow')),
      ]),
    ]),

    model.mismatch
      ? el('p', { class: 'hint', style: 'color:var(--yellow)' },
          t('form.mismatch'))
      : null,

    el('div', { class: 'items__head' }, [
      el('span', {}, t('form.colName')),
      el('span', {}, t('form.colQty')),
      el('span', {}, t('form.colSum')),
      el('span', {}, ''),
    ]),

    el('div', { class: 'items' }, model.items.map((item, index) =>
      itemRow(item, index, model, rerender),
    )),

    el('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px',
    }, [
      el('span', { style: 'color:var(--fg-1)' }, t('form.itemsSum')),
      el('span', { class: 'num' }, formatAmount(sum, model.currency, { exact: true })),
    ]),

    diff
      ? el('button', {
          class: 'btn btn--ghost btn--wide',
          style: 'margin-top:10px',
          // Сумму строк переносим как есть: округление здесь стирало копейки чека.
          onclick: () => { model.amount = sum; model.mismatch = false; rerender(); },
        }, t('form.useSum', { sum: formatAmount(sum, model.currency, { exact: true }) }))
      : null,
  ]);
}

function itemRow(item, index, model, rerender) {
  const recalcTotal = () => {
    // Копейки в строке чека сохраняем: у динара знаков после запятой нет,
    // но цена в чеке с ними, и по ней потом сверяются покупки.
    item.total = roundCents((Number(item.qty) || 0) * (Number(item.price) || 0));
    totalInput.value = item.total || '';
  };

  const nameInput = el('input', {
    class: 'input',
    type: 'text',
    value: item.name,
    placeholder: t('form.colName'),
    oninput: (e) => { item.name = e.target.value; },
  });

  const qtyInput = el('input', {
    class: 'input input--num',
    type: 'text',
    inputmode: 'decimal',
    value: item.qty ?? 1,
    oninput: (e) => { item.qty = parseAmount(e.target.value); recalcTotal(); },
  });

  const totalInput = el('input', {
    class: 'input input--num',
    type: 'text',
    inputmode: 'decimal',
    value: item.total || '',
    oninput: (e) => {
      item.total = parseAmount(e.target.value);
      item.price = item.qty ? item.total / item.qty : item.total;
    },
  });

  return el('div', { class: 'item-row' }, [
    nameInput,
    qtyInput,
    totalInput,
    el('button', {
      class: 'item-row__del',
      'aria-label': t('form.deleteRow'),
      onclick: () => {
        model.items.splice(index, 1);
        if (!model.items.length) model.showItems = false;
        rerender();
      },
    }, '✕'),
  ]);
}

const emptyItem = () => ({ name: '', qty: 1, price: 0, total: 0 });

/**
 * Быстрый выбор товаров. Шторка одна на всё приложение, поэтому форма
 * закрывается и открывается заново с тем же черновиком — набранное не теряется.
 */
function pickItems(model) {
  openQuickPick(model.currency, {
    onDone: (picked) => {
      // Уже добавленное не дублируем, пустую заготовку выкидываем.
      const existing = new Set(model.items.map((it) => it.name.trim().toLowerCase()));
      model.items = model.items.filter((it) => it.name.trim() !== '');

      for (const item of picked) {
        if (!existing.has(item.name.toLowerCase())) model.items.push(item);
      }

      model.showItems = model.items.length > 0;

      // Сумма ещё не введена — подставляем итог по строкам.
      const sum = itemsSum(model);
      if (!model.amount && sum) model.amount = sum;

      openTxForm({ model });
    },
    onCancel: () => openTxForm({ model }),
  });
}

// ---------------------------------------------------------------- сохранение

/** Запись в базу. true — сохранили, false — ошибка (кнопку возвращаем в строй). */
async function persist(model, tx) {
  try {
    const payload = { ...model, items: model.showItems ? model.items : [] };
    if (tx) {
      await updateTransaction(tx.id, payload, {
        rates: state.rates,
        user: state.user,
        previous: tx,
      });
      toastOk(t('form.saved'));
    } else {
      await createTransaction(payload, { rates: state.rates, user: state.user });
      toastOk(t('form.added'));
    }
    closeSheet();
    return true;
  } catch (error) {
    console.error(error);
    toastError(t('form.saveFailed'));
    return false;
  }
}

/** Предупреждение о похожей операции. Решение всегда за человеком. */
function askAboutDuplicate(model, twins, tx = null) {
  const rows = twins.slice(0, 4).map((twin) => el('div', { class: 'list-item' }, [
    el('div', {}, [
      el('div', {}, twin.merchant || categoryName(twin.categoryId) || t('form.noDescription')),
      el('div', { class: 'list-item__sub' }, [
        `${dayLabel(twin.date)}${twin.time ? ` ${twin.time}` : ''}`,
        twin.note ? ` · ${twin.note}` : '',
        // Та же минута — почти наверняка та же покупка, а не похожая.
        sameMoment(twin, model) ? el('b', {}, t('dup.sameTime')) : null,
      ]),
    ]),
    el('span', { class: 'num' }, formatAmount(twin.amount, twin.currency, { exact: true })),
  ]));

  const exact = twins.some((twin) => sameMoment(twin, model));

  openSheet({
    title: t(exact ? 'dup.titleExact' : 'dup.formTitleMaybe'),
    body: [
      el('div', { class: 'alert' },
        exact
          ? t('dup.formExact')
          : twins.length === 1 ? t('dup.formOne') : t('dup.formMany', { n: twins.length })),
      ...rows,
      el('p', { class: 'hint', style: 'margin-top:12px' },
        t('dup.formOk')),
    ],
    // Безопасный выбор — основной: по умолчанию возвращаемся к форме.
    footer: [
      el('button', {
        class: 'btn btn--danger',
        onclick: async () => {
          model.duplicateConfirmed = true;
          await persist(model, tx);
        },
      }, t('dup.addAnyway')),
      el('button', {
        class: 'btn btn--primary',
        onclick: () => { closeSheet(); openTxForm({ tx, model }); },
      }, t('dup.back')),
    ],
  });
}

const categoryName = (id) => state.categories.find((c) => c.id === id)?.name || '';

function buildFooter(model, tx) {
  const save = el('button', { class: 'btn btn--primary' }, t(tx ? 'common.save' : 'common.add'));

  save.addEventListener('click', async () => {
    if (!model.amount) { toastError(t('form.amountRequired')); return; }
    if (!model.categoryId) { toastError(t('form.categoryRequired')); return; }

    // Двойной ввод — частая ошибка, поэтому предупреждаем, но не запрещаем.
    const twins = findDuplicates(state, model, { excludeId: tx?.id || null });
    if (twins.length && !model.duplicateConfirmed) {
      askAboutDuplicate(model, twins, tx);
      return;
    }

    save.disabled = true;
    const ok = await persist(model, tx);
    if (!ok) save.disabled = false;
  });

  if (!tx) return [save];

  return [
    el('button', {
      class: 'btn btn--danger',
      onclick: () => {
        closeSheet();
        confirmSheet({
          title: t('form.deleteTitle'),
          text: t('form.deleteText'),
          onConfirm: async () => {
            try {
              await deleteTransaction(tx.id, state.user);
              toastOk(t('form.deleted'));
            } catch {
              toastError(t('form.deleteFailed'));
            }
          },
        });
      },
    }, t('common.delete')),
    save,
  ];
}
