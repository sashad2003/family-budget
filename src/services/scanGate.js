/**
 * Пускать ли к распознаванию.
 *
 * Разбор чека стоит денег, и они на общем счету: кончатся — перестанет
 * работать у всех сразу. Сервер отвечает на это отдельным отказом, а здесь
 * он запоминается, чтобы следующий человек не ждал ответа впустую и увидел
 * понятную надпись вместо ошибки.
 *
 * Память короткая — четверть часа. Счёт могли пополнить в ту же минуту, и
 * держать сканирование закрытым дольше, чем нужно, хуже, чем сделать один
 * лишний запрос.
 */

const KEY = 'scanBlockedAt';
const REMEMBER_MS = 15 * 60 * 1000;

export function scanBlocked() {
  const at = Number(localStorage.getItem(KEY) || 0);
  if (!at) return false;
  if (Date.now() - at < REMEMBER_MS) return true;

  // Срок вышел — забываем и даём попробовать снова.
  localStorage.removeItem(KEY);
  return false;
}

export function blockScan() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch { /* приватный режим: обойдёмся без памяти */ }
}

export function unblockScan() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* не важно */ }
}
