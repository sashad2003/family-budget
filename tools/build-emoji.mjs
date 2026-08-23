/**
 * Собирает `src/data/emoji.js` — набор значков для выбора категории.
 *
 * Готовой библиотеки в проекте нет и не будет: она тянет за собой сборку и
 * чужой сервер. Но и придумывать список руками незачем — Unicode публикует
 * его сам, вместе с разбивкой на группы. Скрипт скачивает этот файл и
 * превращает в обычный модуль, который дальше лежит в репозитории как есть.
 *
 * Что отбрасываем:
 *
 * - всё, кроме `fully-qualified`: остальные записи — это те же значки без
 *   обязательной пометки «показывать картинкой», и рисуются они то буквой,
 *   то картинкой в зависимости от телефона;
 * - оттенки кожи: пять копий каждого человечка раздувают список впятеро,
 *   а для названия категории разницы нет;
 * - всё новее Emoji 14.0 (2021): на телефоне постарше свежий значок
 *   покажется пустым квадратом, и человек выберет пустоту, не зная об этом.
 *
 * Запуск:  node tools/build-emoji.mjs
 */

import { writeFileSync } from 'node:fs';

const SOURCE = 'https://unicode.org/Public/emoji/15.1/emoji-test.txt';

/** Позже этой версии значки не берём — см. рассуждение выше. */
const MAX_VERSION = 14.0;

/** Оттенки кожи: 1F3FB–1F3FF. */
const isSkinTone = (cp) => cp >= 0x1f3fb && cp <= 0x1f3ff;

/**
 * Группы Unicode в том порядке, в каком они встают вкладками.
 * `tab` — значок самой вкладки, `id` — ключ перевода `emoji.<id>`.
 */
const GROUPS = [
  { source: 'Smileys & Emotion', id: 'smileys', tab: '😀' },
  { source: 'People & Body', id: 'people', tab: '🧑' },
  { source: 'Animals & Nature', id: 'nature', tab: '🐶' },
  { source: 'Food & Drink', id: 'food', tab: '🍔' },
  { source: 'Travel & Places', id: 'travel', tab: '✈️' },
  { source: 'Activities', id: 'activities', tab: '⚽' },
  { source: 'Objects', id: 'objects', tab: '💡' },
  { source: 'Symbols', id: 'symbols', tab: '🔣' },
  { source: 'Flags', id: 'flags', tab: '🏳️' },
];

const LINE = /^([0-9A-F ]+);\s*(\S+)\s*#\s*(\S+)\s+E([\d.]+)/;

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`Не удалось скачать ${SOURCE}: ${response.status}`);
const text = await response.text();

const collected = new Map(GROUPS.map((g) => [g.source, []]));
let group = null;

for (const line of text.split('\n')) {
  if (line.startsWith('# group:')) {
    group = line.slice('# group:'.length).trim();
    continue;
  }
  if (line.startsWith('#') || !line.trim()) continue;

  const match = LINE.exec(line);
  if (!match) continue;

  const [, codes, status, glyph, version] = match;
  if (status !== 'fully-qualified') continue;
  if (Number(version) > MAX_VERSION) continue;
  if (codes.trim().split(' ').some((code) => isSkinTone(Number.parseInt(code, 16)))) continue;

  collected.get(group)?.push(glyph);
}

const body = GROUPS.map(({ source, id, tab }) => {
  const list = collected.get(source);
  if (!list.length) throw new Error(`Группа «${source}» пуста — формат исходника изменился`);
  return `  { id: '${id}', tab: '${tab}', list: '${list.join(' ')}' },`;
}).join('\n');

const total = GROUPS.reduce((sum, g) => sum + collected.get(g.source).length, 0);

const file = `/**
 * Значки для категорий: список Unicode, разложенный по группам.
 *
 * Файл собран скриптом \`tools/build-emoji.mjs\` из ${SOURCE}
 * и руками не правится. Всего значков: ${total}.
 *
 * Каждая группа — одна строка со значками через пробел. Пробел внутри значка
 * не встречается, поэтому разобрать её обратно можно простым split(' '), а
 * храниться так она стоит вчетверо дешевле массива строк.
 *
 * Подписи групп лежат в словаре под ключами \`emoji.<id>\`.
 */

export const EMOJI_GROUPS = [
${body}
];

/** Значки одной группы. */
export const emojiOf = (group) => group.list.split(' ');
`;

writeFileSync(new URL('../src/data/emoji.js', import.meta.url), file);
console.log(`src/data/emoji.js: ${total} значков в ${GROUPS.length} группах`);
