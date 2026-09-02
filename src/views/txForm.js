/**
 * Форма операции. Она же приёмник результата распознавания чека:
 * после сканирования каждое поле и каждая строка товара остаются редактируемыми.
 */

import { el, render } from '../core/dom.js?v=121';
import { state, currencyChoices } from '../core/store.js?v=121';
import { formatAmount, parseAmount, roundCents, convert, currencyInfo } from '../core/money.js?v=121';
import { today } from '../core/dates.js?v=121';
import { guessCategory } from '../data/categories.js?v=121';
import { createTransaction, updateTransaction, deleteTransaction } from '../services/transactions.js?v=121';
import { tileStyle } from './list.js?v=121';
import { openSheet, closeSheet, confirmSheet } from '../ui/sheet.js?v=121';
import { toastOk, toastError } from '../ui/toast.js?v=121';
import { scanFromCamera, scanFromGallery, openScanUrlSheet, openScanSmsSheet } from './scan.js?v=121';
import { openQuickPick } from './quickPick.js?v=121';
import { findDuplicates } from '../core/selectors.js?v=121';
import { openDupCompare } from './dupCompare.js?v=121';
import { t } from '../core/i18n.js?v=121';

/**
 * openTxForm({ tx })          — правка существующей операции
 * openTxForm({ draft })       — новая операция, предзаполненная из чека
 * openTxForm({ tx, draft })   — правка, куда подставили заново распознанный чек
 * openTxForm({ tx, model })   — возврат к набранной форме (после выбора товаров)
 * openTxForm({ tx, backTo })  — операция открыта из сверки повторов; backTo
 *                               возвращает к тому, что человек вводил
 * openTxForm()                — пустая новая операция
 *
 * tx нельзя терять при возврате в форму: без него сохранение заводит вторую
 * запись вместо правки первой, а проверка повторов находит саму правящуюся
 * операцию и ругается на неё.
 */
export function openTxForm({ tx = null, draft = null, model: restored = null, backTo = null } = {}) {
  /**
   * Черновик с чека главнее записи: если чек распознали, правя старую
   * операцию, показать надо распознанное, а tx остаётся лишь указанием,
   * какую запись обновить при сохранении.
   */
  const model = restored || (draft ? fromDraft(draft) : tx ? fromTx(tx) : fromDraft(null));

  const body = el('div');
  // Перенос — как в подвале шторки: длинные подписи не должны уезжать за край.
  const footer = el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;flex:1' });

  const rerender = () => {
    render(body, buildBody(model, rerender, tx, backTo));
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

/**
 * tx передаётся везде, где форма открывается заново — после выбора товаров,
 * после распознавания чека. Без него правка превращалась бы в создание новой
 * записи: сохранение уходило бы в addDoc, а проверка повторов находила бы
 * саму же правящуюся операцию и ругалась на неё.
 */
function buildBody(model, rerender, tx, backTo = null) {
  const nodes = [];

  // Сюда попадают из сверки повторов, уйдя посмотреть уже записанную операцию.
  // Без этой кнопки набранное пришлось бы вводить заново.
  if (backTo) {
    nodes.push(el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-bottom:14px',
      onclick: () => backTo(),
    }, t('dup.backToNew')));
  }

  // Чек — самое частое действие, поэтому стоит первым.
  if (!model.showItems) nodes.push(buildScanRow(tx));

  // Тип операции
  nodes.push(
    el('div', { class: 'segmented', style: 'margin-bottom:14px' }, [
      typeButton('expense', t('form.expense'), model, rerender),
      typeButton('income', t('form.income'), model, rerender),
    ]),
  );

  /**
   * Похожее ищем прямо во время набора, а не только по кнопке «Сохранить»:
   * узнать о повторе, когда форма уже заполнена целиком, — обидно и поздно.
   * Плашка ничего не запрещает, а лишь предлагает сверку.
   */
  const dupSlot = el('div');
  const refreshDup = () => {
    const twins = model.amount
      ? findDuplicates(state, model, { excludeId: tx?.id || null })
      : [];
    render(dupSlot, twins.length ? [dupPeekButton(model, twins, tx)] : []);
  };

  // Сумма + валюта
  const amountInput = el('input', {
    class: 'input input--amount',
    type: 'text',
    inputmode: 'decimal',
    value: model.amount ? String(model.amount) : '',
    placeholder: '0',
    oninput: (e) => {
      model.amount = parseAmount(e.target.value);
      updateHint();
      refreshDup();
    },
  });

  const hint = el('div', { class: 'hint', style: 'text-align:center' });
  const updateHint = () => {
    if (model.currency === state.base || !model.amount) { hint.textContent = ''; return; }
    const converted = convert(model.amount, model.currency, state.base, state.rates);
    hint.textContent = t('form.converted', { sum: formatAmount(converted, state.base) });
  };

  nodes.push(el('div', { class: 'field' }, [amountInput, hint]));
  nodes.push(dupSlot);
  updateHint();
  refreshDup();

  nodes.push(
    el('div', { class: 'field' }, [
      el('div', { class: 'segmented' }, currencyChoices(model.currency).map((code) =>
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
          onclick: () => { model.categoryId = cat.id; rerender(); },
        }, [
          el('span', {
            class: 'cat__ico',
            style: tileStyle(cat.color),
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
          oninput: (e) => { model.date = e.target.value || today(); refreshDup(); },
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
  nodes.push(buildReceiptBlock(model, rerender, tx));

  return nodes;
}

/** Две кнопки съёмки и ссылка из QR — вверху формы. */
function buildScanRow(tx) {
  // Распознали чек, правя старую запись, — обновляем её, а не заводим вторую.
  const toForm = (draft) => openTxForm({ tx, draft });

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

function buildReceiptBlock(model, rerender, tx) {
  if (!model.showItems) {
    return el('div', {}, [
      el('div', { class: 'divider' }, t('form.itemsDivider')),
      el('button', {
        class: 'btn btn--primary btn--wide',
        onclick: () => pickItems(model, tx),
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
        el('button', { class: 'chip', onclick: () => pickItems(model, tx) }, t('form.pick')),
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
    // Подписи у поля нет — она нужна только экранному диктору, которому
    // «второе число в строке» ни о чём не говорит.
    'aria-label': t('form.colSum'),
    value: item.total || '',
    oninput: (e) => {
      item.total = parseAmount(e.target.value);
      item.price = item.qty ? item.total / item.qty : item.total;
    },
  });

  /**
   * Позиция чека — карточка, а не строка таблицы.
   *
   * В таблице название делило ширину с количеством и суммой, и на телефоне
   * от него оставалось два слова: «KRASTAVAC (K…» — по такому огрызку не
   * понять, что за товар, а именно название человек и читает. В карточке оно
   * занимает всю ширину, а числа стоят под ним.
   *
   * Внутри карточки два ряда. Сверху название и кнопка удаления — вместе,
   * потому что удаляют именно названную строку, и держать кнопку у чисел
   * значит целиться в неё, глядя не туда.
   *
   * Снизу количество с подписью и сумма без неё. Подписи у обоих полей
   * не помещаются: два слова и два числа не влезают в ширину телефона, и
   * на тесных экранах обрезалось то одно, то другое. Подпись оставлена там,
   * где без неё не догадаться, — количество можно спутать с ценой за штуку.
   * Второе же число в строке товара всегда сумма, и слово при нём лишнее;
   * вместо слова его выделяет насыщенность.
   */
  const field = (label, input) => el('label', {
    class: `item-card__field ${label ? '' : 'item-card__field--bare'}`,
  }, [
    label ? el('span', { class: 'item-card__label' }, label) : null,
    input,
  ]);

  return el('div', { class: 'item-card' }, [
    el('div', { class: 'item-card__top' }, [
      el('div', { class: 'item-card__name' }, nameInput),
      el('button', {
        class: 'item-card__del',
        'aria-label': t('form.deleteRow'),
        onclick: () => {
          model.items.splice(index, 1);
          if (!model.items.length) model.showItems = false;
          rerender();
        },
      }, '✕'),
    ]),

    el('div', { class: 'item-card__nums' }, [
      field(t('form.colQty'), qtyInput),
      field(null, totalInput),
    ]),
  ]);
}

const emptyItem = () => ({ name: '', qty: 1, price: 0, total: 0 });

/**
 * Быстрый выбор товаров. Шторка одна на всё приложение, поэтому форма
 * закрывается и открывается заново с тем же черновиком — набранное не теряется.
 */
function pickItems(model, tx) {
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

      openTxForm({ tx, model });
    },
    onCancel: () => openTxForm({ tx, model }),
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

/**
 * Плашка «похоже на уже записанное» прямо в форме. Не запрещает ничего:
 * по нажатию открывается сверка, откуда можно вернуться к набранному.
 */
function dupPeekButton(model, twins, tx) {
  return el('button', {
    class: 'dup-hint',
    onclick: () => openDupCompare({
      candidate: model,
      twins,
      // Из формы это ещё не сохранение, поэтому «добавить» здесь означает
      // «я посмотрел, это другая покупка» — и предупреждение больше не всплывёт.
      addLabel: t('dup.keepTyping'),
      backLabel: t('dup.back'),
      onAddAnyway: () => {
        model.duplicateConfirmed = true;
        openTxForm({ tx, model });
      },
      onBack: () => openTxForm({ tx, model }),
      backToNew: () => openTxForm({ tx, model }),
    }),
  }, t('dup.peek', { n: twins.length }));
}

/** Предупреждение при сохранении. Решение всегда за человеком. */
function askAboutDuplicate(model, twins, tx = null) {
  openDupCompare({
    candidate: model,
    twins,
    backLabel: t('dup.back'),
    onAddAnyway: async () => {
      model.duplicateConfirmed = true;
      await persist(model, tx);
    },
    onBack: () => openTxForm({ tx, model }),
    backToNew: () => openTxForm({ tx, model }),
  });
}

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
