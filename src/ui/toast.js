/** Короткие уведомления внизу экрана. */

import { el } from '../core/dom.js?v=33';

const root = () => document.getElementById('toast-root');

export function toast(text, kind = '') {
  const node = el('div', { class: `toast${kind ? ` toast--${kind}` : ''}` }, text);
  root().append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 200);
  }, kind === 'error' ? 4200 : 2400);
}

export const toastOk = (text) => toast(text, 'ok');
export const toastError = (text) => toast(text, 'error');
