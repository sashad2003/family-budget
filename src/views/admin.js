/**
 * Админ-панель: кто зарегистрировался.
 *
 * Виден только тем, чья почта в ADMIN_EMAILS, и это же проверяют правила
 * Firestore — спрятанной кнопки мало, чужие профили закрывает база.
 */

import { el, render } from '../core/dom.js?v=31';
import { listUsers } from '../services/account.js?v=31';
import { toastError, toastOk } from '../ui/toast.js?v=31';

const cache = { users: null, query: '' };

export function renderAdmin() {
  const container = el('div');
  const body = el('div');

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Поиск по имени, почте или телефону',
    value: cache.query,
    oninput: (e) => { cache.query = e.target.value; draw(body); },
  });

  render(container, [
    el('div', { class: 'section-title' }, [
      el('span', {}, 'Подписчики'),
      el('button', {
        class: 'chip',
        onclick: () => load(body, true),
      }, 'Обновить'),
    ]),
    search,
    el('div', { style: 'margin-top:12px' }, body),
  ]);

  load(body);
  return container;
}

async function load(body, force = false) {
  if (cache.users && !force) {
    draw(body);
    return;
  }

  render(body, el('div', { class: 'empty' }, el('div', { class: 'spinner' })));

  try {
    cache.users = await listUsers();
    draw(body);
  } catch (error) {
    console.error(error);
    toastError('Нет доступа к списку пользователей');
    render(body, el('div', { class: 'empty' }, 'Не удалось загрузить'));
  }
}

function draw(body) {
  const needle = cache.query.trim().toLowerCase();
  const list = (cache.users || []).filter((u) => !needle
    || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(needle));

  if (!list.length) {
    render(body, el('div', { class: 'empty' }, 'Никого не найдено'));
    return;
  }

  render(body, [
    el('div', { class: 'section-title' }, [
      el('span', {}, `${list.length} из ${cache.users.length}`),
      el('button', {
        class: 'chip',
        onclick: () => copyEmails(list),
      }, 'Скопировать почты'),
    ]),
    ...list.map(userRow),
  ]);
}

function userRow(user) {
  const status = {
    active: { text: 'подписка', color: '#2dd98a' },
    trial: { text: `пробный до ${user.trialEndsAt || '—'}`, color: 'var(--fg-2)' },
    expired: { text: 'истекла', color: '#ff8080' },
  }[user.subscription] || { text: user.subscription || '—', color: 'var(--fg-2)' };

  const meta = [user.email];
  if (user.phone) meta.push(user.phone);
  if (user.marketing) meta.push('согласен на письма');

  return el('div', { class: 'tx' }, [
    el('div', { class: 'tx__body' }, [
      el('div', { class: 'tx__title' }, user.name || '—'),
      el('div', { class: 'tx__meta' }, meta.join(' · ')),
    ]),
    el('div', {}, [
      el('div', { class: 'tx__amount', style: `color:${status.color};font-size:13px` }, status.text),
      el('span', { class: 'tx__converted' }, dateOf(user.createdAt)),
    ]),
  ]);
}

/** Дата регистрации: в Firestore это отметка времени, а не строка. */
function dateOf(value) {
  const date = value?.toDate?.();
  return date ? date.toLocaleDateString('ru-RU') : '';
}

/**
 * Почты в буфер обмена — для рассылки берём только тех, кто на неё согласился.
 * Остальным писать нельзя, и выгружать их адреса тоже незачем.
 */
async function copyEmails(list) {
  const emails = list.filter((u) => u.marketing).map((u) => u.email);
  if (!emails.length) {
    toastError('Среди них никто не согласился на письма');
    return;
  }

  try {
    await navigator.clipboard.writeText(emails.join(', '));
    toastOk(`Скопировано ${emails.length} адресов`);
  } catch {
    toastError('Браузер не дал доступ к буферу обмена');
  }
}
