/**
 * Категории. При первом запуске набор ниже засевается в Firestore,
 * дальше семья правит его через настройки.
 */

export const DEFAULT_CATEGORIES = [
  // Расходы
  { id: 'groceries',  name: 'Продукты',    type: 'expense', icon: '🛒', color: '#2dd98a', order: 10 },
  { id: 'cafe',       name: 'Кафе',        type: 'expense', icon: '☕', color: '#ffb347', order: 20 },
  { id: 'transport',  name: 'Транспорт',   type: 'expense', icon: '🚗', color: '#5b9fff', order: 30 },
  { id: 'home',       name: 'Дом',         type: 'expense', icon: '🏠', color: '#ff7eb3', order: 40 },
  { id: 'bills',      name: 'Счета',       type: 'expense', icon: '🧾', color: '#3de8d0', order: 50 },
  { id: 'health',     name: 'Здоровье',    type: 'expense', icon: '💊', color: '#ff5b5b', order: 60 },
  { id: 'kids',       name: 'Дети',        type: 'expense', icon: '🧸', color: '#ffb347', order: 70 },
  { id: 'clothes',    name: 'Одежда',      type: 'expense', icon: '👕', color: '#5b9fff', order: 80 },
  { id: 'fun',        name: 'Развлечения', type: 'expense', icon: '🎬', color: '#ff7eb3', order: 90 },
  { id: 'travel',     name: 'Поездки',     type: 'expense', icon: '✈️', color: '#3de8d0', order: 100 },
  { id: 'other-exp',  name: 'Прочее',      type: 'expense', icon: '•',  color: '#8a8a94', order: 999 },

  // Доходы
  { id: 'salary',     name: 'Зарплата',    type: 'income',  icon: '💼', color: '#2dd98a', order: 10 },
  { id: 'freelance',  name: 'Подработка',  type: 'income',  icon: '💻', color: '#5b9fff', order: 20 },
  { id: 'gift',       name: 'Подарок',     type: 'income',  icon: '🎁', color: '#ff7eb3', order: 30 },
  { id: 'other-inc',  name: 'Прочее',      type: 'income',  icon: '•',  color: '#8a8a94', order: 999 },
];

/** Ключевые слова для подсказки категории по ответу AI и названию магазина. */
const HINTS = {
  groceries: ['продукт', 'магазин', 'супермаркет', 'еда', 'бакал', 'maxi', 'lidl', 'idea', 'shufersal', 'rami'],
  cafe: ['кафе', 'ресторан', 'кофе', 'бар', 'пекарн', 'фастфуд'],
  transport: ['транспорт', 'такси', 'бензин', 'топлив', 'парков', 'автобус', 'nis', 'omv'],
  home: ['дом', 'мебел', 'ремонт', 'хозтовар', 'быт'],
  bills: ['счет', 'счёт', 'коммунал', 'интернет', 'связь', 'электр', 'вода', 'аренда'],
  health: ['аптек', 'здоров', 'врач', 'медиц', 'apotek'],
  kids: ['дет', 'игрушк', 'школ', 'сад'],
  clothes: ['одежд', 'обув', 'магазин одежды'],
  fun: ['развлеч', 'кино', 'театр', 'подписк', 'игр'],
  travel: ['поездк', 'отель', 'билет', 'путешеств', 'авиа'],
};

/**
 * Подбирает категорию по тексту (подсказка AI + название магазина).
 * Возвращает id существующей категории или null.
 */
export function guessCategory(text, categories, type = 'expense') {
  const haystack = String(text || '').toLowerCase();
  if (!haystack) return null;

  const pool = categories.filter((c) => c.type === type);

  // Сначала — прямое совпадение с названием категории.
  const direct = pool.find((c) => haystack.includes(c.name.toLowerCase()));
  if (direct) return direct.id;

  // Затем — по ключевым словам.
  for (const [id, words] of Object.entries(HINTS)) {
    if (!pool.some((c) => c.id === id)) continue;
    if (words.some((word) => haystack.includes(word))) return id;
  }
  return null;
}
