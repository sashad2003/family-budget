/**
 * Ключи для поиска цен.
 *
 * Один товар в чеках выглядит по-разному: `SLADOLED KING 100G`, «Мороженое
 * King», `MLEKO 2,8% 1L`. Чтобы поиск «мороженое» находил всё это, каждая
 * строка чека раскладывается на слова-ключи: они пишутся в базу цен рядом с
 * ценой, а запрос ищется среди них.
 *
 * Слова берём из двух источников: как напечатано в чеке и как Claude записал
 * то же самое по-русски (поле norm). Поэтому находится и по «sladoled», и по
 * «мороженое».
 */

/**
 * Служебные слова чеков и единицы измерения. Ключами не становятся: по ним
 * нашлась бы половина базы.
 */
const STOP = new Set([
  'kom', 'kg', 'gr', 'ml', 'lit', 'litar', 'pak', 'pakovanje', 'komad',
  'шт', 'кг', 'гр', 'мл', 'литр', 'уп', 'упак', 'пакет',
  'the', 'and', 'для', 'без', 'или',
]);

/**
 * Нижний регистр без диакритики: сербское `č/ć/š/ž/đ` в чеках печатают и с
 * крючками, и без них, и это должно быть одним и тем же словом.
 */
export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

/** Слова-ключи из названия. Короткие и служебные отбрасываем. */
export function tokenize(...parts) {
  const seen = new Set();

  for (const part of parts) {
    for (const word of normalizeText(part).split(/[^\p{L}\p{N}]+/u)) {
      // Двухбуквенные обрывки («ml», «п») дают только шум.
      if (word.length < 3) continue;
      // Чистые числа — это вес, объём или проценты, а не название.
      if (/^\d+$/.test(word)) continue;
      if (STOP.has(word)) continue;
      seen.add(word);
      // Больше десятка ключей на строку не нужно, а документ они раздувают.
      if (seen.size >= 12) return [...seen];
    }
  }

  return [...seen];
}

/** Ключ магазина: «MAXI 236>» и «Maxi» — одна сеть. */
export function merchantKey(value) {
  const words = normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w));

  return words.slice(0, 2).join(' ');
}

/**
 * Слово запроса, по которому идти в базу.
 *
 * Firestore умеет искать по одному значению массива за запрос, поэтому берём
 * самое длинное слово: оно почти всегда самое редкое, и лишнего вернётся
 * меньше. Остальные слова отсеиваются уже на месте.
 */
export function searchToken(query) {
  const words = tokenize(query);
  if (!words.length) return '';
  return words.reduce((best, word) => (word.length > best.length ? word : best), '');
}
