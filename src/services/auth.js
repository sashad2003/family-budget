/** Вход через Google. Профиль и семья — в services/account.js. */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from '../core/firebase.js?v=104';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export function watchAuth(callback) {
  getRedirectResult(auth).catch(() => {});
  return onAuthStateChanged(auth, callback);
}

export async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    // На мобильных браузерах всплывающее окно часто блокируется — уходим на редирект.
    if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}

export function logout() {
  return signOut(auth);
}

/** Свежий ID-токен для авторизации запросов к api-proxy.php. */
export function idToken() {
  return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}
