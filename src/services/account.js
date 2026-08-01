/**
 * Профиль пользователя и его семья.
 *
 * users/{uid}
 *   name        имя и фамилия — как ввёл человек, а не как записано в Google
 *   email       почта из Google, менять нельзя
 *   phone       телефон с кодом страны
 *   familyId    в какой семье он ведёт бюджет
 *   marketing   согласился ли получать письма о новых возможностях
 *   createdAt   когда зарегистрировался
 *   trialEndsAt до какого числа бесплатно
 *   subscription 'trial' | 'active' | 'expired'
 *
 * invites/{email}
 *   familyId    куда приглашён
 *   byName      кто позвал — показываем при входе
 *   createdAt
 *
 * Приглашение лежит отдельным документом с почтой в имени: так приглашённый
 * читает ровно свою запись и не видит чужих. Искать семью перебором нельзя —
 * это открыло бы список всех семей приложения.
 */

import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=26';
import { ADMIN_EMAILS, LEGACY_FAMILY_ID, TRIAL_DAYS } from '../config.js?v=26';

const userRef = (uid) => doc(db, 'users', uid);
const inviteRef = (email) => doc(db, 'invites', String(email).toLowerCase());
const familyRef = (id) => doc(db, 'families', id);

export function isAdmin(user) {
  return ADMIN_EMAILS.includes(String(user?.email || '').toLowerCase());
}

/**
 * Кто вошёл и что с ним делать дальше.
 *
 * Возвращает { profile, family } либо { profile: null } — второе значит, что
 * человек здесь впервые и ему надо показать анкету.
 */
export async function loadAccount(user) {
  const snap = await getDoc(userRef(user.uid));

  if (snap.exists()) {
    const profile = { uid: user.uid, ...snap.data() };
    return { profile, family: await loadFamily(profile.familyId) };
  }

  // Старые участники моей семьи профиля не имеют — заводим им его молча.
  // Посторонним правила читать её не дают, и это нормально: значит, не наш.
  const legacy = await getDoc(familyRef(LEGACY_FAMILY_ID)).catch(() => null);
  if (legacy?.exists() && (legacy.data().memberUids || []).includes(user.uid)) {
    const profile = await createProfile(user, {
      familyId: LEGACY_FAMILY_ID,
      name: user.displayName || '',
      phone: '',
      marketing: false,
    });
    return { profile, family: { id: legacy.id, ...legacy.data() } };
  }

  return { profile: null, family: null };
}

/** Данные приглашения, если этого человека куда-то звали. */
export async function pendingInvite(email) {
  const snap = await getDoc(inviteRef(email));
  return snap.exists() ? { email: snap.id, ...snap.data() } : null;
}

/**
 * Регистрация: заводим профиль и либо создаём свою семью, либо входим в ту,
 * куда позвали.
 */
export async function registerUser(user, { name, phone, marketing }) {
  const invite = await pendingInvite(user.email);

  const familyId = invite
    ? await joinFamily(user, invite, name)
    : await createFamily(user, name);

  const profile = await createProfile(user, { familyId, name, phone, marketing });
  return { profile, family: await loadFamily(familyId) };
}

async function createProfile(user, { familyId, name, phone, marketing }) {
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  const data = {
    name: String(name || '').trim() || user.displayName || user.email,
    email: String(user.email || '').toLowerCase(),
    phone: String(phone || '').trim(),
    familyId,
    marketing: Boolean(marketing),
    createdAt: serverTimestamp(),
    trialEndsAt: trialEndsAt.toISOString().slice(0, 10),
    subscription: 'trial',
  };

  await setDoc(userRef(user.uid), data);
  return { uid: user.uid, ...data };
}

/** Своя семья: создатель сразу и владелец, и единственный участник. */
async function createFamily(user, name) {
  const ref = await addDoc(collection(db, 'families'), {
    title: `Бюджет ${String(name || '').split(' ')[0] || 'семьи'}`,
    ownerUid: user.uid,
    memberUids: [user.uid],
    members: { [user.uid]: profileOf(user, name) },
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Вход по приглашению. Приглашение после этого больше не нужно. */
async function joinFamily(user, invite, name) {
  await updateDoc(familyRef(invite.familyId), {
    memberUids: arrayUnion(user.uid),
    [`members.${user.uid}`]: profileOf(user, name),
  });
  await deleteDoc(inviteRef(user.email)).catch(() => {});
  return invite.familyId;
}

async function loadFamily(familyId) {
  const snap = await getDoc(familyRef(familyId));
  if (!snap.exists()) throw new Error('Семья не найдена. Напишите в поддержку.');
  return { id: snap.id, ...snap.data() };
}

function profileOf(user, name) {
  return {
    name: String(name || '').trim() || user.displayName || user.email || 'Без имени',
    email: user.email || '',
    photo: user.photoURL || '',
  };
}

// ---------------------------------------------------------------- приглашения

/** Зовём человека в свою семью по почте. Он войдёт через Google и попадёт к нам. */
export async function inviteToFamily(familyId, email, byName) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    throw new Error('Проверьте адрес почты');
  }

  const existing = await getDoc(inviteRef(clean));
  if (existing.exists() && existing.data().familyId !== familyId) {
    throw new Error('Этого человека уже позвали в другой бюджет');
  }

  await setDoc(inviteRef(clean), {
    familyId,
    byName: String(byName || ''),
    createdAt: serverTimestamp(),
  });
  return clean;
}

export function cancelInvite(email) {
  return deleteDoc(inviteRef(email));
}

/** Убрать участника из семьи. Его записи остаются — это общий бюджет. */
export async function removeMember(familyId, uid) {
  await updateDoc(familyRef(familyId), {
    memberUids: arrayRemove(uid),
    [`members.${uid}`]: deleteField(),
  });
}

// ---------------------------------------------------------------- админ

/** Все зарегистрированные — для админ-панели. Правила пустят только админа. */
export async function listUsers(max = 500) {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
