/** Вход через Google и присоединение к семье. */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { auth, db } from '../core/firebase.js?v=14';
import { FAMILY_ID } from '../config.js?v=14';

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

export const familyRef = () => doc(db, 'families', FAMILY_ID);

/**
 * Загружает семью и при необходимости добавляет пользователя в участники.
 * Правила Firestore пропустят self-join только для почт из allowedEmails.
 */
export async function loadFamily(user) {
  const snap = await getDoc(familyRef());
  if (!snap.exists()) {
    throw new Error(`Документ families/${FAMILY_ID} не найден. Создайте его в Firebase Console.`);
  }

  const family = { id: snap.id, ...snap.data() };
  const memberUids = family.memberUids || [];

  if (memberUids.includes(user.uid)) {
    await touchProfile(user, family);
    return { family, isMember: true };
  }

  const invited = (family.allowedEmails || [])
    .map((e) => String(e).toLowerCase())
    .includes(String(user.email).toLowerCase());

  if (!invited) return { family, isMember: false };

  await updateDoc(familyRef(), {
    memberUids: arrayUnion(user.uid),
    [`members.${user.uid}`]: profileOf(user),
  });

  const fresh = await getDoc(familyRef());
  return { family: { id: fresh.id, ...fresh.data() }, isMember: true };
}

/** Обновляет имя и аватар, если пользователь их сменил. */
async function touchProfile(user, family) {
  const stored = family.members?.[user.uid] || {};
  const next = profileOf(user);
  if (stored.name === next.name && stored.photo === next.photo) return;
  await updateDoc(familyRef(), { [`members.${user.uid}`]: next }).catch(() => {});
}

function profileOf(user) {
  return {
    name: user.displayName || user.email || 'Без имени',
    email: user.email || '',
    photo: user.photoURL || '',
  };
}

/** Свежий ID-токен для авторизации запросов к api-proxy.php. */
export function idToken() {
  return auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
}
