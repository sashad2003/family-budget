/**
 * Сверка с уже записанным.
 *
 * Раньше при подозрении на повтор показывался просто список похожих операций:
 * человек видел чужие строки, но не свои, и не понимал ни почему сработало
 * предупреждение, ни где искать найденную запись. Здесь каждая находка
 * разложена в две колонки — «вы вводите» против «уже записано», — снабжена
 * разбором совпадения и ссылкой на саму операцию.
 *
 * Решение всегда за человеком: добавить второй записью, дополнить найденную
 * или вернуться назад.
 */

import { el } from '../core/dom.js?v=97';
import { state } from '../core/store.js?v=97';
import { formatAmount } from '../core/money.js?v=97';
import { dayLabel, monthLabel, monthOf } from '../core/dates.js?v=97';
import { duplicateMatch, sameMoment } from '../core/selectors.js?v=97';
import { openSheet, closeSheet } from '../ui/sheet.js?v=97';
import { toastOk, toastError } from '../ui/toast.js?v=97';
import { updateTransaction } from '../services/transactions.js?v=97';
import { t } from '../core/i18n.js?v=97';

const DASH = '—';

/**
 * openDupCompare({ candidate, twins, ... })
 *   candidate  — то, что человек вводит: модель формы или черновик чека
 *   twins      — найденные похожие операции
 *   onAddAnyway— «всё равно добавить»
 *   onBack     — безопасный выход: вернуться к форме или отменить добавление
 *   addLabel   — подпись первой кнопки: «Всё равно добавить» / «Продолжить ввод»
 *   backLabel  — подпись безопасной кнопки: «Вернуться» / «Не добавлять»
 *   backToNew  — чем вернуть набранное, если человек ушёл смотреть операцию
 *   onMerged   — что сделать после дополнения найденной записи
 */
export function openDupCompare({
  candidate,
  twins,
  onAddAnyway,
  onBack,
  addLabel = null,
  backLabel = null,
  backToNew = null,
  onMerged = null,
}) {
  // Совпавшее до минуты время — почти наверняка та же покупка, показываем первой.
  const sorted = [...twins].sort(
    (a, b) => Number(sameMoment(b, candidate)) - Number(sameMoment(a, candidate)),
  );
  const exact = sorted.some((tx) => sameMoment(tx, candidate));

  openSheet({
    title: t(exact ? 'dup.titleExact' : 'dup.titleMaybe'),
    body: [
      el('div', { class: 'alert' }, [
        el('div', { class: 'alert__title' },
          exact
            ? t('dup.exact')
            : sorted.length === 1 ? t('dup.one') : t('dup.many', { n: sorted.length })),
        el('div', { class: 'alert__row' }, t('dup.compareHint')),
      ]),
      ...sorted.slice(0, 5).map((tx) => twinCard(tx, candidate, { backToNew, onMerged })),
      el('p', { class: 'hint', style: 'margin-top:12px' }, t('dup.ok')),
    ],
    // Безопасный выбор — основной: по умолчанию повтор не добавляется.
    footer: [
      el('button', {
        class: 'btn btn--danger',
        onclick: () => onAddAnyway(),
      }, addLabel || t('dup.addAnyway')),
      el('button', {
        class: 'btn btn--primary',
        onclick: () => onBack(),
      }, backLabel || t('dup.dontAdd')),
    ],
  });
}

/** Одна находка: где лежит, чем похожа, чем отличается и что с ней можно сделать. */
function twinCard(tx, candidate, { backToNew, onMerged }) {
  const match = duplicateMatch(tx, candidate);
  const additions = mergeAdditions(tx, candidate);

  return el('div', { class: 'dup-card' }, [
    el('div', { class: 'dup-card__head' }, [
      el('div', {}, [
        el('div', { class: 'dup-card__title' },
          tx.merchant || categoryName(tx.categoryId) || t('form.noDescription')),
        el('div', { class: 'dup-card__where' }, t('dup.where', { place: whereToFind(tx) })),
      ]),
      el('span', { class: 'num' }, formatAmount(tx.amount, tx.currency, { exact: true })),
    ]),

    el('div', { class: 'dup-card__why' }, whyText(match, candidate)),

    compareTable(tx, candidate, match),

    el('div', { class: 'dup-card__acts' }, [
      el('button', {
        class: 'chip',
        onclick: () => openTwin(tx, backToNew),
      }, t('dup.open')),

      // Дополнять нечем — кнопки нет: у найденной записи и так всё заполнено.
      additions.length
        ? el('button', {
            class: 'chip',
            onclick: () => mergeIntoTwin(tx, candidate, onMerged),
          }, t('dup.merge'))
        : null,
    ]),

    additions.length
      ? el('div', { class: 'dup-card__why' },
          t('dup.mergeAdds', { list: additions.map((key) => t(key)).join(', ') }))
      : null,
  ]);
}

/** «февраль 2026 · 14 февраля · Продукты» — ответ на «где эту операцию искать». */
function whereToFind(tx) {
  const parts = [monthLabel(monthOf(tx.date)), dayLabel(tx.date)];
  const cat = categoryName(tx.categoryId);
  if (cat) parts.push(cat);
  return parts.join(' · ');
}

/** Разбор совпадения словами: почему эта операция вообще попала в предупреждение. */
function whyText(match, candidate) {
  const parts = [];
  if (match.byReceipt) parts.push(t('dup.whyReceipt'));
  if (match.sameAmount) {
    parts.push(t('dup.whyAmount', {
      sum: formatAmount(candidate.amount, candidate.currency, { exact: true }),
    }));
  }
  if (match.sameTime) parts.push(t('dup.whyTime'));
  else if (match.sameDay) parts.push(t('dup.whySameDay'));
  if (match.sameMerchant) parts.push(t('dup.whyMerchant'));
  if (match.sameCategory) parts.push(t('dup.whyCategory'));

  const why = t('dup.why', { list: parts.join(', ') });

  // Расхождение в датах — самая частая причина, по которой это всё-таки
  // разные покупки, поэтому пишем его отдельной половиной строки.
  if (!match.sameDay && match.dayDiff) {
    return `${why} · ${t('dup.whyDayDiff', { n: match.dayDiff })}`;
  }
  return why;
}

/**
 * Две колонки: слева то, что человек вводит, справа то, что уже записано.
 * Совпавшие значения приглушены, разошедшиеся подсвечены — сверка сводится
 * к одному взгляду.
 */
function compareTable(tx, candidate, match) {
  const rows = compareRows(tx, candidate, match);

  const cells = [
    el('div', { class: 'dup-cmp__head' }, ''),
    el('div', { class: 'dup-cmp__head' }, t('dup.mine')),
    el('div', { class: 'dup-cmp__head' }, t('dup.theirs')),
  ];

  for (const row of rows) {
    cells.push(
      el('div', { class: 'dup-cmp__label' }, row.label),
      el('div', { class: `dup-cmp__val ${row.same ? 'dup-cmp__val--same' : 'dup-cmp__val--diff'}` }, row.mine),
      el('div', { class: `dup-cmp__val ${row.same ? 'dup-cmp__val--same' : 'dup-cmp__val--diff'}` }, row.theirs),
    );
  }

  return el('div', { class: 'dup-cmp' }, cells);
}

function compareRows(tx, candidate, match) {
  const itemsMine = (candidate.items || []).length;
  const itemsTheirs = (tx.items || []).length;

  const rows = [
    {
      label: t('form.colSum'),
      mine: formatAmount(candidate.amount, candidate.currency, { exact: true }),
      theirs: formatAmount(tx.amount, tx.currency, { exact: true }),
      same: match.sameAmount,
    },
    {
      label: t('form.date'),
      mine: dayLabel(candidate.date),
      theirs: dayLabel(tx.date),
      same: match.sameDay,
    },
  ];

  const optional = [
    {
      label: t('form.time'),
      mine: candidate.time,
      theirs: tx.time,
      same: Boolean(candidate.time) && candidate.time === tx.time,
    },
    {
      label: t('form.category'),
      mine: categoryName(candidate.categoryId),
      theirs: categoryName(tx.categoryId),
      same: match.sameCategory,
    },
    {
      label: t('form.merchant'),
      mine: candidate.merchant,
      theirs: tx.merchant,
      same: match.sameMerchant,
    },
    {
      label: t('form.note'),
      mine: candidate.note,
      theirs: tx.note,
      same: String(candidate.note || '').trim() === String(tx.note || '').trim(),
    },
    {
      label: t('dup.fItems'),
      mine: itemsMine ? String(itemsMine) : '',
      theirs: itemsTheirs ? String(itemsTheirs) : '',
      same: itemsMine === itemsTheirs,
    },
    {
      label: t('dup.fReceipt'),
      mine: candidate.receiptUrl ? t('dup.yes') : '',
      theirs: tx.receiptUrl ? t('dup.yes') : '',
      same: Boolean(candidate.receiptUrl) === Boolean(tx.receiptUrl),
    },
  ];

  // Строку, пустую с обеих сторон, не показываем: сверять там нечего.
  for (const row of optional) {
    if (!row.mine && !row.theirs) continue;
    rows.push({ ...row, mine: row.mine || DASH, theirs: row.theirs || DASH });
  }

  return rows;
}

// ---------------------------------------------------------------- действия

/**
 * Открыть найденную операцию. Набранное не теряется: в её форме появляется
 * кнопка возврата к тому, что человек вводил.
 */
async function openTwin(tx, backToNew) {
  const { openTxForm } = await import('./txForm.js?v=97');
  closeSheet();
  openTxForm({ tx, backTo: backToNew });
}

/**
 * Поля, которых у найденной записи нет, а у нового ввода есть.
 * Ими и дополняем — уже записанное не переписываем: правка чужих значений
 * втихую хуже второй записи, её хотя бы видно.
 */
function mergeAdditions(tx, candidate) {
  const keys = [];
  const missing = (field) => !String(tx[field] || '').trim() && String(candidate[field] || '').trim();

  if (missing('time')) keys.push('form.time');
  if (missing('merchant')) keys.push('form.merchant');
  if (missing('note')) keys.push('form.note');
  if (missing('address')) keys.push('dup.fAddress');
  if (missing('receiptUrl')) keys.push('dup.fReceipt');
  if (!tx.categoryId && candidate.categoryId) keys.push('form.category');
  if (!(tx.items || []).length && (candidate.items || []).length) keys.push('dup.fItems');

  return keys;
}

async function mergeIntoTwin(tx, candidate, onMerged) {
  const pick = (field) => (String(tx[field] || '').trim() ? tx[field] : candidate[field] || '');

  const merged = {
    ...tx,
    time: pick('time'),
    merchant: pick('merchant'),
    note: pick('note'),
    address: pick('address'),
    receiptUrl: pick('receiptUrl'),
    categoryId: tx.categoryId || candidate.categoryId || null,
    items: (tx.items || []).length ? tx.items : (candidate.items || []),
  };

  try {
    await updateTransaction(tx.id, merged, {
      rates: state.rates,
      user: state.user,
      previous: tx,
    });
    toastOk(t('dup.merged'));
    closeSheet();
    onMerged?.();
  } catch (error) {
    console.error(error);
    toastError(t('dup.mergeFailed'));
  }
}

const categoryName = (id) => state.categories.find((c) => c.id === id)?.name || '';
