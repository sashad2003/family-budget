/**
 * Выбор значка для категории: вкладки по группам и сетка значков.
 *
 * Раньше на этом месте стояло поле ввода на два символа. Значок в него нужно
 * было принести откуда-то ещё — с системной клавиатуры, которая на компьютере
 * прячется в меню, а на телефоне открывается не с первого раза. Кто не знал,
 * как это делается, оставлял точку по умолчанию, и категории в списке были
 * неразличимы.
 *
 * Список берём из Unicode (`src/data/emoji.js`), а не из библиотеки: значки
 * рисует сам телефон, картинок качать не нужно, и весь выбор — это 14 КБ
 * текста. Модуль подгружается только когда шторку с категорией открыли:
 * на остальных экранах он ни к чему.
 *
 * Поиска нет намеренно. Искать пришлось бы по названиям, а их нужно 1849
 * штук на трёх языках — это в двадцать раз больше самого списка. Вместо него
 * первой стоит вкладка «недавние»: свои десять значков человек находит там
 * быстрее, чем набрал бы слово.
 */

import { el, render } from '../core/dom.js?v=116';
import { EMOJI_GROUPS, emojiOf } from '../data/emoji.js?v=116';
import { t } from '../core/i18n.js?v=116';

const RECENT_KEY = 'emojiRecent';
const RECENT_MAX = 24;

/**
 * emojiPicker({ value, onPick }) → узел с вкладками и сеткой.
 * value — выбранный сейчас значок, onPick(значок) — что делать с новым.
 */
export function emojiPicker({ value = '', onPick }) {
  let picked = value;

  const recent = loadRecent();
  const tabs = [
    ...(recent.length ? [{ id: 'recent', tab: '🕘', list: recent.join(' ') }] : []),
    ...EMOJI_GROUPS,
  ];

  // Открываем на группе выбранного значка: правя категорию, человек чаще
  // всего меняет значок на соседний по смыслу.
  let active = tabs.find((group) => emojiOf(group).includes(picked)) || tabs[0];

  const tabRow = el('div', { class: 'emoji-pick__tabs' });
  const grid = el('div', { class: 'emoji-grid' });

  function drawTabs() {
    render(tabRow, tabs.map((group) => el('button', {
      type: 'button',
      class: `emoji-pick__tab ${group === active ? 'is-active' : ''}`,
      'aria-label': t(`emoji.${group.id}`),
      onclick: () => { active = group; drawTabs(); drawGrid(); },
    }, group.tab)));
  }

  function drawGrid() {
    render(grid, emojiOf(active).map((glyph) => el('button', {
      type: 'button',
      class: `emoji-cell ${glyph === picked ? 'is-active' : ''}`,
      'aria-label': glyph,
      onclick: () => {
        picked = glyph;
        rememberRecent(glyph);
        drawGrid();
        onPick(glyph);
      },
    }, glyph)));

    // Сетка своя у каждой вкладки, но прокручена остаётся от прошлой —
    // новая группа открывалась бы с середины.
    grid.scrollTop = 0;
  }

  drawTabs();
  drawGrid();

  return el('div', { class: 'emoji-pick' }, [tabRow, grid]);
}

/**
 * Недавние значки — общие на все бюджеты и только на этом устройстве.
 * В базу их класть незачем: это привычка руки, а не общее знание семьи.
 */
function loadRecent() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberRecent(glyph) {
  try {
    const next = [glyph, ...loadRecent().filter((x) => x !== glyph)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Хранилище закрыто (гостевое окно) — недавние просто не запомнятся.
  }
}
