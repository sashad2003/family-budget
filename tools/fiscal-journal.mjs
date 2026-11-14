/**
 * Разбор журнала сербского фискального чека.
 *
 * Страница по ссылке из QR прячет под кнопкой «Журнал» печатный вид чека —
 * тот же текст, что на бумажной ленте. В нём есть все строки товаров, и
 * читаются они однозначно: название (иногда перенесённое на вторую строку),
 * затем строка «цена количество сумма».
 *
 * Разбираем сами, а не просим модель: формат машинный, ответ должен быть
 * одинаковым каждый раз, и платить за это незачем. В api-proxy.php лежит
 * тот же разбор на PHP — он работает в бою, а этот нужен проверкам и
 * разовым сверкам старых записей.
 */

/** Сербские числа: 1.299,00 → 1299. */
const num = (value) => Number(String(value).replace(/\./g, '').replace(',', '.'));

/** Ширина печатной ленты: по ней видно, разорвано ли слово переносом. */
const WIDTH = 40;

export function parseJournal(html) {
  const pre = String(html).match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  if (!pre) return [];

  const text = pre[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  const raw = text.split('\n').map((line) => line.replace(/\s+$/, ''));
  const lines = raw.map((line) => line.trim());

  const start = lines.findIndex((line) => /^Артикли$/i.test(line));
  if (start === -1) return [];

  const items = [];
  let name = '';
  let prevFull = false;

  const addPart = (part, full) => {
    if (!name) { name = part; prevFull = full; return; }
    // Предыдущая часть занимала всю ширину — значит слово разорвано
    // переносом и склеивать надо вплотную: «WELLNESS 21» + «0G» → «210G».
    name += prevFull ? part : ` ${part}`;
    prevFull = full;
  };

  const NUMS = /^([\d.]+,\d{2})\s+([\d.]+(?:,\d+)?)\s+([\d.]+,\d{2})$/;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[=-]{5,}$/.test(line)) {
      // Черта под списком закрывает его, черта над ним — ещё нет.
      if (items.length) break;
      continue;
    }
    if (!line || /^Назив/i.test(line)) continue;
    if (/^(Укупан износ|Ознака|Име|Порез|Укупно)/i.test(line)) break;

    const match = line.match(NUMS);
    if (match) {
      items.push({
        name: name.replace(/\s+/g, ' ').trim(),
        price: num(match[1]),
        qty: num(match[2]),
        total: num(match[3]),
      });
      name = '';
      prevFull = false;
    } else {
      addPart(line, raw[i].length >= WIDTH);
    }
  }

  return items.filter((item) => item.name && item.total > 0);
}
