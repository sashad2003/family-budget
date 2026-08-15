/**
 * Профиль пользователя и его семья.
 *
 * users/{uid}
 *   name        имя и фамилия — как ввёл человек, а не как записано в Google
 *   email       почта из Google, менять нельзя
 *   phone       телефон с кодом страны
 *   familyId    какой бюджет открыт сейчас
 *   familyIds   все бюджеты, куда он входит: свой и те, куда позвали
 *   marketing   согласился ли получать письма о новых возможностях
 *   createdAt   когда зарегистрировался
 *   trialEndsAt до какого числа бесплатно
 *   subscription 'trial' | 'active' | 'expired'
 *
 * inviteCodes/{code}
 *   familyId    в какой бюджет ведёт ссылка
 *   title       название бюджета — показать до входа
 *
 * Приглашение — случайный код в ссылке. Знание кода и есть пропуск: правила
 * пускают в семью того, кто передал код в запросе. Искать семью перебором
 * нельзя — это открыло бы список всех бюджетов приложения.
 */

import {
  doc,
  collection,
  onSnapshot,
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

import { db } from '../core/firebase.js?v=62';
import { ADMIN_EMAILS, LEGACY_FAMILY_ID, TRIAL_DAYS } from '../config.js?v=62';
import { t } from '../core/i18n.js?v=62';

const userRef = (uid) => doc(db, 'users', uid);
const codeRef = (code) => doc(db, 'inviteCodes', String(code));
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

/**
 * Регистрация: заводим профиль и либо создаём свою семью, либо входим в ту,
 * куда позвали.
 */
export async function registerUser(user, { name, phone, marketing }) {
  const familyId = await createFamily(user, name);
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
    familyIds: [familyId],
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
    title: t('account.defaultBudget', { name: String(name || '').split(' ')[0] || '' }).trim(),
    ownerUid: user.uid,
    memberUids: [user.uid],
    members: { [user.uid]: profileOf(user, name) },
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Куда ведёт ссылка-приглашение. null — код выдуман или отозван. */
export async function inviteByCode(code) {
  const snap = await getDoc(codeRef(code)).catch(() => null);
  return snap?.exists() ? { code: snap.id, ...snap.data() } : null;
}

/**
 * Вход в чужой бюджет по коду из ссылки.
 *
 * Код передаём и в запись семьи: правила по нему проверяют, что человек
 * действительно получил приглашение, а не подобрал номер бюджета.
 */
export async function joinByCode(user, profile, code) {
  const invite = await inviteByCode(code);
  if (!invite) throw new Error(t('invite.expired'));

  const already = (profile.familyIds || [profile.familyId]).includes(invite.familyId);

  if (!already) {
    await updateDoc(familyRef(invite.familyId), {
      memberUids: arrayUnion(user.uid),
      [`members.${user.uid}`]: profileOf(user, profile.name),
      joinCode: code,
    });
    await updateDoc(userRef(user.uid), {
      familyIds: arrayUnion(invite.familyId),
      familyId: invite.familyId,
    });
  } else {
    await updateDoc(userRef(user.uid), { familyId: invite.familyId });
  }

  return invite.familyId;
}

/** Переключение между своими бюджетами. */
export async function switchFamily(uid, familyId) {
  await updateDoc(userRef(uid), { familyId });
}

/** Бюджеты, в которых человек состоит — для переключателя. */
export async function listFamilies(profile) {
  const ids = profile.familyIds?.length ? profile.familyIds : [profile.familyId];
  const docs = await Promise.all(ids.map((id) => getDoc(familyRef(id)).catch(() => null)));
  return docs
    .filter((d) => d?.exists())
    .map((d) => ({ id: d.id, ...d.data() }));
}

async function loadFamily(familyId) {
  const snap = await getDoc(familyRef(familyId));
  if (!snap.exists()) throw new Error(t('account.familyMissing'));

  const family = { id: snap.id, ...snap.data() };

  /**
   * У бюджетов, заведённых до появления регистрации, хозяин не записан.
   * Считаем им того, кто вошёл первым: он и создавал бюджет, а остальные
   * пришли позже по приглашению. Без этого хозяин не смог бы никого убрать —
   * правила разрешают это только ему.
   */
  if (!family.ownerUid && family.memberUids?.length) {
    const ownerUid = family.memberUids[0];
    await updateDoc(familyRef(familyId), { ownerUid }).catch(() => {});
    family.ownerUid = ownerUid;
  }

  return family;
}

/**
 * Живая подписка на документ бюджета.
 *
 * Состав участников меняется не только на этом устройстве: кого-то убрали,
 * кто-то вошёл по ссылке. Без подписки экран показывал бы снимок, сделанный
 * при входе, и убранный человек продолжал бы висеть в списке до перезагрузки.
 */
export function watchFamily(familyId, onChange, onError) {
  return onSnapshot(
    familyRef(familyId),
    (snap) => { if (snap.exists()) onChange({ id: snap.id, ...snap.data() }); },
    onError,
  );
}

/** Хозяин бюджета — тот, кто его завёл. Только он правит состав. */
export function isOwner(family, uid) {
  return Boolean(family?.ownerUid) && family.ownerUid === uid;
}

function profileOf(user, name) {
  return {
    name: String(name || '').trim() || user.displayName || user.email || t('settings.noName'),
    email: user.email || '',
    photo: user.photoURL || '',
  };
}

// ---------------------------------------------------------------- приглашения

/**
 * Ссылка-приглашение в свой бюджет.
 *
 * Код заводится один раз и живёт с семьёй: его можно послать в мессенджере
 * кому угодно, а письма мы не шлём — почтовый сервис это отдельная история
 * со своими настройками и деньгами.
 */
export async function inviteLink(family) {
  const code = family.joinCode || await createCode(family);
  return `${location.origin}${location.pathname}?join=${code}`;
}

/** Новый код взамен старого: разосланная раньше ссылка перестаёт работать. */
export async function resetInviteLink(family) {
  if (family.joinCode) await deleteDoc(codeRef(family.joinCode)).catch(() => {});
  const code = await createCode(family);
  return `${location.origin}${location.pathname}?join=${code}`;
}

async function createCode(family) {
  // Код короткий, но подобрать его перебором нельзя: правила пускают только
  // по точному совпадению, а бюджетов в базе несопоставимо меньше вариантов.
  const code = randomCode();
  await setDoc(codeRef(code), {
    familyId: family.id,
    title: family.name || family.title || t('app.title'),
    createdAt: serverTimestamp(),
  });
  await updateDoc(familyRef(family.id), { joinCode: code });
  family.joinCode = code;
  return code;
}

function randomCode() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Убрать участника из семьи. Записи остаются — бюджет общий, и вычищать за
 * ушедшим чужие покупки было бы хуже, чем оставить их на месте.
 *
 * Право на это есть только у хозяина; правила Firestore проверяют то же
 * самое, поэтому кнопкой в чужом браузере ничего не добиться.
 */
export async function removeMember(familyId, uid) {
  await updateDoc(familyRef(familyId), {
    memberUids: arrayRemove(uid),
    [`members.${uid}`]: deleteField(),
  });
}

/**
 * Выйти из чужого бюджета.
 *
 * Убрать себя может любой — это не власть над другими, а отказ от доступа.
 * Открытым делаем какой-нибудь из оставшихся: без бюджета приложению нечего
 * показывать.
 */
export async function leaveFamily(user, profile, familyId) {
  const rest = (profile.familyIds || [profile.familyId]).filter((id) => id !== familyId);
  if (!rest.length) throw new Error(t('family.lastBudget'));

  await removeMember(familyId, user.uid);
  await updateDoc(userRef(user.uid), {
    familyIds: arrayRemove(familyId),
    familyId: rest[0],
  });
  return rest[0];
}

// ---------------------------------------------------------------- админ

/** Все зарегистрированные — для админ-панели. Правила пустят только админа. */
export async function listUsers(max = 500) {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
