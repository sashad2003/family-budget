/** Список операций с фильтрами по типу, категории и тексту. */

import { el, render } from '../core/dom.js?v=83';
import { state } from '../core/store.js?v=83';
import { formatAmount, txAmountIn } from '../core/money.js?v=83';
import { dayLabel } from '../core/dates.js?v=83';
import { monthTransactions, groupByDate, totals } from '../core/selectors.js?v=83';
import { openTxForm } from './txForm.js?v=83';
import { section } from '../ui/section.js?v=83';
import { t, getLocale } from '../core/i18n.js?v=83';
import { activeTheme } from '../core/theme.js?v=83';

/** Фильтры живут вне state: они локальны для экрана и не влияют на другие. */
const filters = { type: 'all', categoryId: null, query: '' };

/**
 * Открывает список сразу на одной категории — с обзора, по нажатию на неё.
 *
 * Остальные фильтры сбрасываем: человек пришёл смотреть эту категорию, а
 * оставшийся с прошлого раза поиск показал бы ему пустоту без объяснений.
 */
export function openCategoryList(categoryId, type = 'all') {
  Object.assign(filters, { type, categoryId, query: '' });
  window.dispatchEvent(new CustomEvent('goto-list'));
}

export function renderList() {
  const container = el('div');

  /**
   * Поле поиска создаётся один раз и не участвует в перерисовке.
   *
   * Раньше каждая буква перерисовывала экран целиком вместе с самим полем —
   * браузер терял на нём фокус, и клавиатура закрывалась после первого же
   * символа. Название товара так было не набрать.
   */
  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: t('list.searchPlaceholder'),
    value: filters.query,
    oninput: (e) => { filters.query = e.target.value; drawResults(); },
  });

  const chips = el('div');
  const results = el('div');

  const drawResults = () => {
    const list = monthTransactions(state, filters);
    const { income, expense } = totals(list, state);

    render(results, [
      list.length
        ? section(
            countLabel(list.length),
            groupByDate(list).map(([date, items]) =>
              el('div', {}, [
                el('div', { class: 'tx-group__date' }, dayLabel(date)),
                ...items.map((tx) => txRow(tx, () => openTxForm({ tx }))),
              ]),
            ),
            el('span', { class: 'num', style: 'font-size:12px;color:var(--fg-1)' },
              `+${formatAmount(income, state.base)} · −${formatAmount(expense, state.base)}`),
          )
        : el('div', { class: 'empty' }, [
            el('span', { class: 'empty__ico' }, '🔍'),
            el('div', {}, t('common.notFound')),
          ]),
    ]);
  };

  const draw = () => { drawChips(chips, draw); drawResults(); };

  render(container, [
    el('div', { style: 'margin-bottom:4px' }, [search, chips]),
    results,
  ]);

  draw();
  return container;
}

/** Кнопки типа и категорий. Перерисовываются отдельно от поля поиска. */
function drawChips(node, draw) {
  const typeChips = ['all', 'expense', 'income'].map((value) =>
    el('button', {
      class: `chip ${filters.type === value ? 'is-active' : ''}`,
      onclick: () => { filters.type = value; filters.categoryId = null; draw(); },
    }, { all: t('list.typeAll'), expense: t('list.typeExpense'), income: t('list.typeIncome') }[value]),
  );

  const pool = state.categories.filter(
    (c) => !c.archived && (filters.type === 'all' || c.type === filters.type),
  );

  const catChips = pool.map((cat) =>
    el('button', {
      class: `chip ${filters.categoryId === cat.id ? 'is-active' : ''}`,
      // Цвет категории отдаём стилям через --tint: на светлой теме его надо затемнить.
      style: filters.categoryId === cat.id ? `--tint:${cat.color}` : '',
      onclick: () => {
        filters.categoryId = filters.categoryId === cat.id ? null : cat.id;
        draw();
      },
    }, `${cat.icon} ${cat.name}`),
  );

  render(node, [
    el('div', { class: 'chip-row', style: 'margin-top:10px' }, typeChips),
    el('div', { class: 'chip-row', style: 'margin-top:7px' }, catChips),
  ]);
}

/** Строка операции. Используется и на главной, и в списке. */
export function txRow(tx, onClick) {
  const cat = state.categories.find((c) => c.id === tx.categoryId);
  const isIncome = tx.type === 'income';

  const title = tx.merchant || cat?.name || t('tx.operation');
  const metaParts = [];
  // Список уже сгруппирован по дням, поэтому в строке полезно только время.
  if (tx.time) metaParts.push(tx.time);
  if (tx.merchant && cat) metaParts.push(cat.name);
  if (tx.note) metaParts.push(tx.note);
  else if (tx.items?.length) metaParts.push(t('tx.items', { n: tx.items.length }));
  if (tx.source === 'sms') metaParts.push(t('tx.fromSms'));
  else if (tx.source !== 'manual') metaParts.push(t('tx.fromReceipt'));

  const inBase = txAmountIn(tx, state.base, state.rates);
  const foreign = tx.currency !== state.base;

  return el('button', { class: 'tx', onclick: onClick }, [
    el('div', { class: 'tx__ico', style: tileStyle(cat?.color) }, cat?.icon || '•'),

    el('div', { class: 'tx__body' }, [
      el('div', { class: 'tx__title' }, title),
      metaParts.length ? el('div', { class: 'tx__meta' }, metaParts.join(' · ')) : null,
    ]),

    /**
     * Валюта ввода помечена отдельно, а не только знаком в конце суммы.
     *
     * Знак валюты стоит после цифр и при беглом просмотре теряется: суммы
     * в списке разного порядка, глаз цепляется за числа, и операция в евро
     * среди динаров выглядит просто маленькой. Искать по памяти «это было
     * двенадцать евро» так не выходит. Метка с кодом валюты стоит перед
     * суммой, поэтому такие строки видно, не читая их.
     *
     * Ставим её только там, где валюта не совпадает со сводной: помечать
     * ею весь список — значит снова ничего не выделить.
     */
    el('div', { class: 'tx__sums' }, [
      el('div', {
        class: `tx__amount num ${isIncome ? 'tx__amount--in' : 'tx__amount--out'}`,
      }, [
        foreign ? el('span', { class: 'tx__cur' }, tx.currency) : null,
        `${isIncome ? '+' : '−'}${formatAmount(tx.amount, tx.currency, { exact: true })}`,
      ]),

      foreign
        ? el('span', { class: 'tx__converted num' }, `≈ ${formatAmount(inBase, state.base)}`)
        : null,
    ]),
  ]);
}

/**
 * Значок категории: без подложки, только цвет самого знака.
 *
 * Сначала плитка заливалась насыщенным цветом, потом бледной подложкой — и
 * то и другое спорит с эмодзи внутри. Эмодзи и так цветной, ему подложка не
 * нужна: она добавляет квадрат вокруг каждой строки и дробит список.
 *
 * Цвет всё же передаём: у «Прочего» вместо эмодзи точка, у оплаченного счёта
 * галочка — им цвет категории заменяет отсутствующую картинку. На светлой
 * теме знак затемняется: светлые цвета палитры на белом фоне не читаются.
 */
export function tileStyle(hex) {
  const value = String(hex || '').replace('#', '');
  const color = value.length === 6 ? `#${value}` : '#8a8a94';
  if (activeTheme() !== 'light') return `color:${color}`;

  const rgb = [0, 2, 4].map((i) => Number.parseInt(color.slice(1 + i, 3 + i), 16));
  return `color:#${rgb.map((c) => Math.round(c * 0.6).toString(16).padStart(2, '0')).join('')}`;
}

/** Сплошной цвет категории — для полосок доли и точек. */
export function tileColor(hex) {
  const value = String(hex || '').replace('#', '');
  return value.length === 6 ? `#${value}` : '#8a8a94';
}

/**
 * «12 операций».
 *
 * Русский требует три формы в зависимости от числа, остальные языки обходятся
 * одной — им отдаём готовую строку из словаря.
 */
function countLabel(n) {
  if (getLocale() !== 'ru') return t('list.count', { n });

  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} операция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} операции`;
  return `${n} операций`;
}
