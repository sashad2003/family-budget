/**
 * Админ-панель: кто зарегистрировался.
 *
 * Виден только тем, чья почта в ADMIN_EMAILS, и это же проверяют правила
 * Firestore — спрятанной кнопки мало, чужие профили закрывает база.
 */

import { el, render } from '../core/dom.js?v=50';
import { listUsers } from '../services/account.js?v=50';
import { toastError, toastOk } from '../ui/toast.js?v=50';
import { section } from '../ui/section.js?v=50';
import { t, intlLocale } from '../core/i18n.js?v=50';

const cache = { users: null, query: '' };

export function renderAdmin() {
  const container = el('div');
  const body = el('div');

  const search = el('input', {
    class: 'input',
    type: 'search',
    placeholder: t('admin.search'),
    value: cache.query,
    oninput: (e) => { cache.query = e.target.value; draw(body); },
  });

  render(container, section(t('admin.title'), [
    search,
    body,
  ], el('button', { class: 'chip', onclick: () => load(body, true) }, t('common.refresh'))));

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
    toastError(t('admin.noAccess'));
    render(body, el('div', { class: 'empty' }, t('admin.loadFailed')));
  }
}

function draw(body) {
  const needle = cache.query.trim().toLowerCase();
  const list = (cache.users || []).filter((u) => !needle
    || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(needle));

  if (!list.length) {
    render(body, el('div', { class: 'empty' }, t('admin.nobody')));
    return;
  }

  render(body, section(
    t('admin.ofTotal', { n: list.length, total: cache.users.length }),
    list.map(userRow),
    el('button', { class: 'chip', onclick: () => copyEmails(list) }, t('admin.copyEmails')),
  ));
}

function userRow(user) {
  const status = {
    active: { text: t('admin.subActive'), color: '#2dd98a' },
    trial: { text: t('admin.subTrial', { date: user.trialEndsAt || '—' }), color: 'var(--fg-2)' },
    expired: { text: t('admin.subExpired'), color: '#ff8080' },
  }[user.subscription] || { text: user.subscription || '—', color: 'var(--fg-2)' };

  const meta = [user.email];
  if (user.phone) meta.push(user.phone);
  if (user.marketing) meta.push(t('admin.agreedMail'));

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
  return date ? date.toLocaleDateString(intlLocale()) : '';
}

/**
 * Почты в буфер обмена — для рассылки берём только тех, кто на неё согласился.
 * Остальным писать нельзя, и выгружать их адреса тоже незачем.
 */
async function copyEmails(list) {
  const emails = list.filter((u) => u.marketing).map((u) => u.email);
  if (!emails.length) {
    toastError(t('admin.noneAgreed'));
    return;
  }

  try {
    await navigator.clipboard.writeText(emails.join(', '));
    toastOk(t('admin.copied', { n: emails.length }));
  } catch {
    toastError(t('admin.clipboardDenied'));
  }
}
