/**
 * Курсы валют.
 *
 * Источник — бесплатный API без ключа, дёргается через api-proxy.php.
 * Свежий снимок кладётся в families/{id}/meta/rates, чтобы:
 *   1. все устройства семьи видели одни и те же цифры;
 *   2. при недоступности источника было чем считать.
 *
 * Тянем не чаще раза в сутки.
 */

import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=123';
import { FALLBACK_RATES, PROXY_URL } from '../config.js?v=123';
import { getFamilyId } from '../core/session.js?v=123';
import { idToken } from './auth.js?v=123';

const DAY_MS = 24 * 60 * 60 * 1000;
const ratesRef = () => doc(db, 'families', getFamilyId(), 'meta', 'rates');

/**
 * Возвращает актуальные курсы к EUR.
 * Порядок: снимок из базы → обновление из сети (если протух) → запасные значения.
 */
export async function loadRates() {
  let snapshot = null;
  try {
    const snap = await getDoc(ratesRef());
    if (snap.exists()) snapshot = snap.data();
  } catch {
    // Нет связи с базой — пойдём в сеть.
  }

  const age = snapshot?.fetchedAt ? Date.now() - new Date(snapshot.fetchedAt).getTime() : Infinity;
  if (snapshot?.rates && age < DAY_MS) {
    return { rates: snapshot.rates, fetchedAt: snapshot.fetchedAt, stale: false };
  }

  try {
    const fresh = await fetchFromProxy();
    await setDoc(ratesRef(), fresh, { merge: true }).catch(() => {});
    return { rates: fresh.rates, fetchedAt: fresh.fetchedAt, stale: false };
  } catch {
    if (snapshot?.rates) {
      return { rates: snapshot.rates, fetchedAt: snapshot.fetchedAt, stale: true };
    }
    return { rates: { ...FALLBACK_RATES }, fetchedAt: null, stale: true };
  }
}

async function fetchFromProxy() {
  const token = await idToken();
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action: 'rates' }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.rates) {
    throw new Error(data?.error || `rates_http_${response.status}`);
  }
  return data;
}

/** Принудительное обновление — кнопка в настройках. */
export async function refreshRates() {
  const fresh = await fetchFromProxy();
  await setDoc(ratesRef(), fresh, { merge: true }).catch(() => {});
  return fresh;
}
