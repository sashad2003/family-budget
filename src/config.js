/**
 * Конфигурация клиента.
 *
 * Ключи Firebase здесь публичные по своей природе: они идентифицируют проект,
 * а не дают доступ. Доступ к данным закрывают правила Firestore (firestore.rules)
 * и белый список почт. Секретное (ключ Anthropic) живёт только в config.php на сервере.
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyAwBJgchwHOMiKAh1oIpV72euqNlK2wyhk',
  authDomain: 'mony-y-hac-b-kormaney.firebaseapp.com',
  projectId: 'mony-y-hac-b-kormaney',
  storageBucket: 'mony-y-hac-b-kormaney.firebasestorage.app',
  messagingSenderId: '635303578955',
  appId: '1:635303578955:web:2c396be79027e854346cce',
};

/** Документ семьи в Firestore: families/family_drutz */
export const FAMILY_ID = 'family_drutz';

/** PHP-прокси к Claude API. Относительный путь — работает и локально, и на хостинге. */
export const PROXY_URL = 'api-proxy.php';

/** Валюты приложения. Первая — база по умолчанию. */
export const CURRENCIES = [
  { code: 'RSD', symbol: 'дин', locale: 'sr-RS', decimals: 0 },
  { code: 'EUR', symbol: '€', locale: 'de-DE', decimals: 2 },
  { code: 'ILS', symbol: '₪', locale: 'he-IL', decimals: 2 },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export const DEFAULT_BASE_CURRENCY = 'RSD';

/**
 * Запасные курсы к EUR — используются, если внешний источник недоступен
 * и в базе ещё нет ни одного снимка. Порядок величины важнее точности:
 * реальные курсы подтягиваются при первом же успешном запросе.
 */
export const FALLBACK_RATES = { EUR: 1, RSD: 117.2, ILS: 3.95 };
