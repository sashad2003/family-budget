/**
 * Анкета при первом входе.
 *
 * Google даёт почту и имя, но телефон он не отдаёт, а без него нельзя ни
 * связаться с человеком, ни отличить двух тёзок. Спрашиваем один раз.
 *
 * Согласие на письма — отдельной галочкой и не по умолчанию: без явного «да»
 * ни один сервис рассылок не станет отправлять письма этому адресу.
 */

import { el, render, $ } from '../core/dom.js?v=51';
import { registerUser } from '../services/account.js?v=51';
import { logout } from '../services/auth.js?v=51';
import { toastError } from '../ui/toast.js?v=51';
import { t } from '../core/i18n.js?v=51';

/**
 * Показывает анкету и ждёт, пока человек её заполнит.
 * Возвращает { profile, family } — с этого момента он полноценный пользователь.
 */
export function askProfile(user) {
  return new Promise((resolve) => {
    renderForm(user, resolve);
  });
}

function renderForm(user, done) {
  const name = el('input', {
    class: 'input',
    type: 'text',
    placeholder: t('signup.namePlaceholder'),
    value: user.displayName || '',
    autocomplete: 'name',
  });

  const phone = el('input', {
    class: 'input',
    type: 'tel',
    placeholder: '+381 60 123 4567',
    autocomplete: 'tel',
  });

  const marketing = el('input', { type: 'checkbox', id: 'signup-marketing' });

  const submit = el('button', { class: 'btn btn--primary btn--wide' }, t('signup.submit'));

  submit.addEventListener('click', async () => {
    if (name.value.trim().length < 2) {
      toastError(t('signup.nameRequired'));
      return;
    }
    // Телефон свободной формы: страны пишут его по-разному, придираться не к чему.
    if (phone.value.replace(/\D/g, '').length < 8) {
      toastError(t('signup.phoneRequired'));
      return;
    }

    submit.disabled = true;
    submit.textContent = t('signup.creating');

    try {
      const result = await registerUser(user, {
        name: name.value,
        phone: phone.value,
        marketing: marketing.checked,
      });
      done(result);
    } catch (error) {
      console.error(error);
      toastError(error.message || t('signup.failed'));
      submit.disabled = false;
      submit.textContent = t('signup.submit');
    }
  });

  render($('#signup-card'), [
    el('h1', { class: 'auth__title' }, t('signup.title')),

    el('p', { class: 'auth__sub' }, t('signup.sub')),

    el('div', { class: 'field' }, [el('label', { class: 'field__label' }, t('signup.name')), name]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label' }, t('signup.phone')), phone]),

    el('label', { class: 'check', for: 'signup-marketing' }, [
      marketing,
      el('span', {}, t('signup.marketing')),
    ]),

    el('p', { class: 'hint' }, t('signup.privacy')),

    submit,

    el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-top:10px',
      onclick: () => logout(),
    }, t('signup.signOut', { email: user.email })),
  ]);
}
