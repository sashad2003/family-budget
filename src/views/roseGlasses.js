/**
 * Розовые очки — режим, в котором на счету миллиард евро.
 *
 * Данных он не трогает: подменяется только то, что нарисовано на обзоре.
 *
 * Надеваются и снимаются очки одной и той же кнопкой в шапке. Пока они
 * надеты, у кнопки сверху горит красная полоска — иначе непонятно, что
 * нажатие не добавит ещё миллиард, а вернёт настоящие цифры. Второй выход
 * стоит под самим миллиардом: шапку в этот момент могли и не пролистать.
 *
 * Режим живёт только до перезагрузки страницы. Так и задумано: очки — шутка
 * на минуту, а не настройка, о которой потом забудут и испугаются баланса.
 */

import { $, el } from '../core/dom.js?v=121';
import { state, set } from '../core/store.js?v=121';
import { formatAmount } from '../core/money.js?v=121';
import { t } from '../core/i18n.js?v=121';

/** Мечта считается в евро независимо от валюты сводок: миллиард так миллиард. */
const DREAM = 1_000_000_000;

export function isRose() {
  return state.rose === true;
}

/**
 * Включение и выключение: перерисовку сводки делает подписка на состояние.
 *
 * Надевая очки, заодно уходим на обзор: миллиард нарисован там, а кнопка
 * стоит в шапке, которая видна с любого экрана. Нажать её из списка операций
 * и не увидеть ничего — половина шутки пропадала.
 *
 * Снимая, экран не меняем: человек уже смотрит на обзор, и уносить его
 * куда-то ещё после возврата к настоящим цифрам незачем.
 */
export function setRose(on) {
  if (on === isRose()) return;
  set(on ? { rose: on, route: 'dashboard' } : { rose: on });
  if (on) startSky(); else stopSky();
  drawRoseButton();
}

/**
 * Снять очки при выходе и смене бюджета.
 *
 * Флаг гасим напрямую, без set(): к этому моменту старые данные уже
 * отписаны, а лишняя перерисовка полезла бы в них и упала.
 */
export function resetRose() {
  state.rose = false;
  stopSky();
  drawRoseButton();
}

// ---------------------------------------------------------------- кнопка

/** Кнопка с очками в шапке: одна на оба действия. */
export function initRoseButton() {
  $('#btn-rose').addEventListener('click', () => setRose(!isRose()));
  drawRoseButton();
}

/**
 * Вид кнопки под текущее состояние.
 *
 * aria-pressed говорит то же самое, что красная полоска, — экранному диктору
 * полоску не видно, а знать, надеты очки или нет, нужно и ему.
 */
export function drawRoseButton() {
  const button = $('#btn-rose');
  if (!button) return;

  const on = isRose();
  button.classList.toggle('is-on', on);
  button.setAttribute('aria-pressed', String(on));
  button.setAttribute('aria-label', t(on ? 'rose.off' : 'rose.on'));
}

// ---------------------------------------------------------------- сводка

/** Розовая замена блока баланса: миллиард пришёл, тратить его не на что. */
export function roseBalance() {
  return el('div', {}, [
    el('div', { class: 'card balance balance--rose' }, [
      el('div', { class: 'balance__label' }, t('rose.balance')),
      el('div', { class: 'balance__value num' }, formatAmount(DREAM, 'EUR', { whole: true })),
      el('div', { class: 'balance__sub' }, t('rose.sub')),
    ]),

    el('div', { class: 'stat-row' }, [
      el('div', { class: 'stat stat--in' }, [
        el('div', { class: 'stat__label' }, [el('span', { class: 'stat__dot' }), t('charts.income')]),
        el('div', { class: 'stat__value num' }, formatAmount(DREAM, 'EUR', { whole: true })),
      ]),
      el('div', { class: 'stat stat--out' }, [
        el('div', { class: 'stat__label' }, [el('span', { class: 'stat__dot' }), t('charts.expense')]),
        el('div', { class: 'stat__value num' }, formatAmount(0, 'EUR', { whole: true })),
      ]),
    ]),

    // Второй выход, кроме очков в шапке: миллиард видно раньше, чем шапку,
    // и искать глазами, чем его убрать, человеку не приходится.
    el('button', {
      class: 'btn rose-back',
      onclick: () => setRose(false),
      // Без стрелки в подписи: на иврите строка идёт справа налево, и
      // «назад» показывало бы в противоположную сторону.
    }, t('rose.back')),
  ]);
}

// ---------------------------------------------------------------- сердечки

const SYMBOLS = ['💖', '💕', '💗', '💘', '💞', '€', '€', '💶', '✨'];

/** Сколько значков держим в небе разом: больше — заметная нагрузка на телефон. */
const MAX_ITEMS = 40;

let sky = null;
let timer = null;

/** Уважаем системную настройку «меньше движения»: розовое останется, полёт — нет. */
function motionAllowed() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function startSky() {
  if (sky || !motionAllowed()) return;

  sky = el('div', { class: 'rose-sky', 'aria-hidden': 'true' });
  document.body.append(sky);

  // Первую горсть выпускаем сразу, иначе экран пару секунд стоит пустым.
  for (let i = 0; i < 10; i += 1) spawn();
  timer = setInterval(spawn, 380);
}

function stopSky() {
  clearInterval(timer);
  timer = null;
  sky?.remove();
  sky = null;
}

function spawn() {
  // Во вкладке в фоне анимации не идут, а таймер тикает: без потолка к
  // возвращению человека в небе висели бы сотни неподвижных сердечек.
  if (!sky || sky.childElementCount >= MAX_ITEMS) return;

  const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const item = el('span', {
    class: 'rose-sky__item',
    style: [
      `left:${Math.random() * 100}%`,
      `font-size:${24 + Math.random() * 39}px`,
      `animation-duration:${5.5 + Math.random() * 4.5}s`,
      `--drift:${(Math.random() * 2 - 1) * 90}px`,
      `--spin:${(Math.random() * 2 - 1) * 40}deg`,
    ].join(';'),
  }, symbol);

  item.addEventListener('animationend', () => item.remove());
  sky.append(item);
}
