/**
 * Заведение и правка категории.
 *
 * Живёт отдельным модулем, потому что открывается из двух разных мест: из
 * настроек, где список категорий правят спокойно, и прямо из формы операции —
 * там нужной категории может не оказаться в тот момент, когда чек уже
 * распознан, и уходить за ней в настройки значит потерять набранное.
 */

import { el, render } from '../core/dom.js?v=126';
import { saveCategory, deleteCategory } from '../services/transactions.js?v=126';
import { openSheet, closeSheet, confirmSheet } from '../ui/sheet.js?v=126';
import { toastOk, toastError } from '../ui/toast.js?v=126';
import { t } from '../core/i18n.js?v=126';

export const PALETTE = ['#2dd98a', '#ff5b5b', '#5b9fff', '#ffb347', '#ff7eb3', '#8a8a94'];

/**
 * openCategoryEditor(cat, onDone)
 *
 * cat — правим существующую, null — заводим новую.
 * onDone получает id сохранённой категории: тому, кто открыл редактор из
 * формы операции, этот id нужен, чтобы сразу её и выбрать.
 *
 * options.type   — каким сделать тип новой категории (форма операции знает,
 *                  расход сейчас заводят или доход).
 * options.onCancel — что делать, если человек закрыл редактор, ничего не
 *                  сохранив. Форме операции это нужно, чтобы вернуть набранное:
 *                  шторка в приложении одна, и редактор занял её собой.
 */
export function openCategoryEditor(cat, onDone = () => {}, options = {}) {
  const model = {
    id: cat?.id || '',
    name: cat?.name || '',
    type: cat?.type || options.type || 'expense',
    icon: cat?.icon || '•',
    color: cat?.color || PALETTE[0],
    order: cat?.order ?? 500,
  };

  /**
   * Шторку собираем один раз, а нажатия меняют узлы на месте.
   *
   * Перерисовка всего тела не годится: выбор значка держит свою вкладку и
   * прокрутку внутри себя, и каждое касание цвета отбрасывало бы человека
   * в начало списка.
   */
  const typeButtons = ['expense', 'income'].map((type) => el('button', {
    class: model.type === type ? 'is-active' : '',
    dataset: { value: type },
    onclick: () => {
      model.type = type;
      typeButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.value === type));
    },
  }, t(type === 'expense' ? 'form.expense' : 'form.income')));

  // Выбранный значок стоит в подписи над списком, а не отдельным полем:
  // поле пришлось бы подгонять по высоте к соседнему, и оно всё равно
  // разъезжалось бы от размера значка.
  const preview = el('span', { class: 'cat-preview' }, model.icon);

  const colorButtons = PALETTE.map((color) => el('button', {
    class: 'chip',
    style: `background:${color}22;border-color:${model.color === color ? color : 'transparent'}`,
    onclick: () => {
      model.color = color;
      colorButtons.forEach((b, i) => {
        b.style.borderColor = PALETTE[i] === color ? color : 'transparent';
      });
    },
  }, el('span', { class: 'legend-dot', style: `background:${color}` })));

  // Место под выбор значка: сам список приезжает отдельным модулем,
  // потому что на остальных экранах он не нужен.
  const pickerBox = el('div', {}, el('p', { class: 'hint' }, t('cat.iconLoading')));

  import('../ui/emojiPicker.js?v=126')
    .then(({ emojiPicker }) => render(pickerBox, emojiPicker({
      value: model.icon,
      onPick: (glyph) => { model.icon = glyph; preview.textContent = glyph; },
    })))
    .catch(() => render(pickerBox, el('p', { class: 'hint' }, t('cat.iconFailed'))));

  const body = el('div', {}, [
    el('div', { class: 'segmented', style: 'margin-bottom:14px' }, typeButtons),

    el('div', { style: 'margin-bottom:14px' }, [
      el('label', { class: 'field__label' }, t('cat.name')),
      el('input', {
        class: 'input',
        value: model.name,
        placeholder: t('cat.namePlaceholder'),
        oninput: (e) => { model.name = e.target.value; },
      }),
    ]),

    el('div', { class: 'field__label pick-head' }, [
      el('span', {}, t('cat.icon')),
      preview,
    ]),
    pickerBox,

    el('label', { class: 'field__label', style: 'margin-top:14px' }, t('cat.color')),
    el('div', { class: 'chip-row' }, colorButtons),
  ]);

  const footer = [
    cat
      ? el('button', {
          class: 'btn btn--danger',
          onclick: () => {
            // Уходим к подтверждению — это не отказ от правки.
            handled = true;
            closeSheet();
            confirmSheet({
              title: t('cat.deleteTitle'),
              text: t('cat.deleteText'),
              onConfirm: async () => {
                await deleteCategory(cat.id);
                toastOk(t('cat.deleted'));
                handled = true;
                onDone();
              },
            });
          },
        }, t('common.delete'))
      : null,

    el('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        const name = model.name.trim();
        if (!name) { toastError(t('cat.nameRequired')); return; }

        const id = model.id || slug(name);
        const { id: _skip, ...data } = model;
        try {
          await saveCategory(id, { ...data, name });
          closeSheet();
          toastOk(t('bills.saved'));
          handled = true;
          onDone(id);
        } catch {
          toastError(t('bills.saveFailed'));
        }
      },
    }, t('common.save')),
  ].filter(Boolean);

  /*
   * Закрытие без сохранения. onClose срабатывает и когда редактор сменяется
   * другой шторкой — в том числе своей же, после удачного сохранения, — поэтому
   * отказ считаем только до того, как что-то было сделано.
   */
  let handled = false;

  openSheet({
    title: t(cat ? 'cat.title' : 'cat.new'),
    body,
    footer,
    onClose: () => { if (!handled) options.onCancel?.(); },
  });
}

/** Транслитерация в id документа: 'Кафе у дома' → 'kafe-u-doma-482'. */
function slug(name) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e',
    ю: 'yu', я: 'ya', ь: '', ъ: '',
  };
  const base = name.toLowerCase().split('').map((ch) => map[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  return `${base || 'cat'}-${Math.floor(Math.random() * 900 + 100)}`;
}
