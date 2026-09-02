/**
 * Расход на Claude: сколько денег уходит на разбор чеков и сколько осталось.
 *
 * Остаток на счету Anthropic по запросу не отдаёт — эту цифру видно только в
 * личном кабинете. Поэтому остаток считается так: админ переписывает сюда то,
 * что показывает кабинет, а сервер вычитает из этого расход, который считает
 * сам по ответам модели. Пока никто ничего не вписал, остаток неизвестен —
 * и показывать его выдумкой нельзя.
 *
 * Считает именно сервер: он один видит каждый вызов, а браузер — только свои.
 */

import { PROXY_URL } from '../config.js?v=126';
import { idToken } from './auth.js?v=126';

/**
 * Расход и остаток. Если передать balanceUsd — сервер сначала запомнит эту
 * цифру как остаток на сейчас, и уже от неё будет считать дальше.
 */
export async function loadSpend(balanceUsd = null) {
  const token = await idToken();
  if (!token) throw new Error('no_token');

  const payload = { action: 'usage_stats' };
  if (balanceUsd !== null) payload.balance_usd = Number(balanceUsd);

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `http_${response.status}`);
  return data;
}

/**
 * Разбирает ответ сервера в то, что показываем на экране.
 *
 * Средняя цена вызова считается по всему, что записано в журнале, а не по
 * последнему месяцу: чеков за месяц бывает десяток, и одна дорогая длинная
 * лента перекосила бы оценку «на сколько ещё хватит».
 */
export function summarizeSpend(data) {
  const months = Object.entries(data?.months || {})
    .map(([month, row]) => ({
      month,
      calls: Number(row.calls || 0),
      input: Number(row.input || 0),
      output: Number(row.output || 0),
      cost: Number(row.cost || 0),
    }))
    .sort((a, b) => (a.month < b.month ? 1 : -1));

  const calls = Number(data?.calls || 0);
  const spent = Number(data?.spent || 0);
  const avg = calls ? spent / calls : 0;
  const left = data?.left_usd === null || data?.left_usd === undefined ? null : Number(data.left_usd);

  return {
    months,
    calls,
    spent,
    avg,
    left,
    // На сколько ещё чеков хватит: пока нет ни остатка, ни средней цены,
    // честнее не показывать ничего, чем показать бесконечность.
    scansLeft: left !== null && avg > 0 ? Math.floor(left / avg) : null,
    thisMonth: months.find((m) => m.month === new Date().toISOString().slice(0, 7)) || null,
    balanceAt: data?.balance?.at ? new Date(data.balance.at * 1000) : null,
    // Сервер уже никого не пускает к распознаванию: либо счёт по нашему
    // журналу пуст, либо Anthropic только что отказал по деньгам.
    blocked: Boolean(data?.blocked),
    model: data?.model || '',
    writable: data?.writable !== false,
  };
}

/** Порог, ниже которого пора пополнять: примерно два десятка чеков. */
export const LOW_BALANCE_USD = 2;
