/**
 * Анкета при первом входе.
 *
 * Google даёт почту и имя, но телефон он не отдаёт, а без него нельзя ни
 * связаться с человеком, ни отличить двух тёзок. Спрашиваем один раз.
 *
 * Согласие на письма — отдельной галочкой и не по умолчанию: без явного «да»
 * ни один сервис рассылок не станет отправлять письма этому адресу.
 */

import { el, render, $ } from '../core/dom.js?v=34';
import { registerUser } from '../services/account.js?v=34';
import { logout } from '../services/auth.js?v=34';
import { toastError } from '../ui/toast.js?v=34';

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
    placeholder: 'Имя и фамилия',
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

  const submit = el('button', { class: 'btn btn--primary btn--wide' }, 'Продолжить');

  submit.addEventListener('click', async () => {
    if (name.value.trim().length < 2) {
      toastError('Напишите имя');
      return;
    }
    // Телефон свободной формы: страны пишут его по-разному, придираться не к чему.
    if (phone.value.replace(/\D/g, '').length < 8) {
      toastError('Проверьте номер телефона');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Создаём…';

    try {
      const result = await registerUser(user, {
        name: name.value,
        phone: phone.value,
        marketing: marketing.checked,
      });
      done(result);
    } catch (error) {
      console.error(error);
      toastError(error.message || 'Не удалось завершить регистрацию');
      submit.disabled = false;
      submit.textContent = 'Продолжить';
    }
  });

  render($('#signup-card'), [
    el('h1', { class: 'auth__title' }, 'Ещё пара слов'),

    el('p', { class: 'auth__sub' },
      'Заводим ваш бюджет. Пригласить мужа или жену можно сразу после.'),

    el('div', { class: 'field' }, [el('label', { class: 'field__label' }, 'Как вас зовут'), name]),
    el('div', { class: 'field' }, [el('label', { class: 'field__label' }, 'Телефон'), phone]),

    el('label', { class: 'check', for: 'signup-marketing' }, [
      marketing,
      el('span', {}, 'Присылайте мне письма о новых возможностях приложения'),
    ]),

    el('p', { class: 'hint' },
      'Имя, почту и телефон храним, чтобы вести ваш аккаунт и отвечать на вопросы. '
      + 'Никому не передаём. Удалить их можно в настройках.'),

    submit,

    el('button', {
      class: 'btn btn--ghost btn--wide',
      style: 'margin-top:10px',
      onclick: () => logout(),
    }, `Выйти из ${user.email}`),
  ]);
}
