/**
 * Шаблоны писем: сохранённые тексты рассылок.
 *
 * Письмо пишется долго — разметка, три языка, правка переводов, — и терялось
 * от одной перезагрузки страницы. Здесь два разных хранилища, и оба нужны.
 *
 * Черновик лежит в браузере: он сохраняется на каждой букве и восстанавливается
 * при возврате на экран. Это защита от случайности, а не архив.
 *
 * Шаблоны лежат в Firestore и переживают смену устройства. Их видит и правит
 * только админ — так же, как список людей: правила проверяют почту, а не
 * спрятанную кнопку.
 */

import {
  collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db } from '../core/firebase.js?v=120';

const templates = () => collection(db, 'mailTemplates');

const DRAFT_KEY = 'mailDraft';

/** Черновик в браузере — чтобы перезагрузка не стирала написанное. */
export function saveDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    // Приватный режим или переполненное хранилище: письму это не мешает.
    console.error('Черновик не сохранился', error);
  }
}

export function loadDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch { /* не важно */ }
}

/** Все шаблоны, свежие сверху. */
export async function listTemplates() {
  const snap = await getDocs(query(templates(), orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Сохранение под именем. Имя и есть ключ: сохранив дважды одно и то же письмо,
 * человек ожидает увидеть один шаблон, а не два одинаковых.
 */
export async function saveTemplate(name, drafts) {
  const id = String(name || '').trim().slice(0, 80);
  if (!id) throw new Error('empty_name');

  await setDoc(doc(templates(), id), {
    name: id,
    drafts,
    updatedAt: serverTimestamp(),
  });

  return id;
}

export function deleteTemplate(id) {
  return deleteDoc(doc(templates(), id));
}
