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

import { db } from '../core/firebase.js?v=124';

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

/**
 * Шаблоны в браузере — запасное хранилище.
 *
 * Правила Firestore для коллекции выкладываются отдельно от кода, и пока это
 * не сделано, база отвечает отказом. Терять из-за этого написанное письмо
 * нельзя, поэтому сохранённое всегда ложится и сюда: с этого устройства оно
 * откроется в любом случае, а на другие уедет, когда база станет доступна.
 */
const LOCAL_KEY = 'mailTemplates';

function localList() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function localSave(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch (error) {
    console.error('Шаблон не сохранился в браузере', error);
  }
}

/**
 * Все шаблоны, свежие сверху: из базы и из браузера, без повторов по имени.
 *
 * База главнее — она общая для всех устройств. Отказ базы не ошибка для
 * вызывающего: показываем то, что есть локально, и пишем причину в консоль.
 */
export async function listTemplates() {
  const local = localList();

  try {
    const snap = await getDocs(query(templates(), orderBy('updatedAt', 'desc')));
    const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const names = new Set(remote.map((item) => item.name));

    return [...remote, ...local.filter((item) => !names.has(item.name))];
  } catch (error) {
    console.error('Шаблоны из базы недоступны', error);
    return local;
  }
}

/**
 * Сохранение под именем. Имя и есть ключ: сохранив дважды одно и то же письмо,
 * человек ожидает увидеть один шаблон, а не два одинаковых.
 *
 * Возвращает, куда легло: 'both' — и в базу, и в браузер, 'local' — только в
 * браузер, потому что база отказала. Второе честно показывается человеку: он
 * должен знать, что с другого устройства письма пока не будет.
 */
export async function saveTemplate(name, drafts) {
  const id = String(name || '').trim().slice(0, 80);
  if (!id) throw new Error('empty_name');

  const local = localList().filter((item) => item.name !== id);
  localSave([{ id, name: id, drafts, local: true }, ...local]);

  try {
    await setDoc(doc(templates(), id), { name: id, drafts, updatedAt: serverTimestamp() });
    return 'both';
  } catch (error) {
    console.error('Шаблон не сохранился в базе', error);
    return 'local';
  }
}

export async function deleteTemplate(id) {
  localSave(localList().filter((item) => item.id !== id));

  try {
    await deleteDoc(doc(templates(), id));
  } catch (error) {
    console.error('Шаблон не удалился из базы', error);
  }
}
