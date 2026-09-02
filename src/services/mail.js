/**
 * Рассылка письма о новом в приложении.
 *
 * Письма уходят через AhaSend по HTTP API v2 — запрос делает прокси на
 * сервере, потому что ключ и адрес отправителя живут в config.php и на
 * страницу не попадают. Право писать людям прокси проверяет сам: список
 * админов лежит рядом с ключами, спрятанной кнопки для этого мало.
 *
 * Адреса выбирает эта сторона: она знает, кто отписался. Прокси шлёт по
 * одному письму на адрес, чтобы получатели не видели чужих почт.
 */

import { PROXY_URL } from '../config.js?v=101';
import { idToken } from './auth.js?v=101';
import { t } from '../core/i18n.js?v=101';

/** Столько же, сколько прокси принимает за раз. */
export const MAIL_BATCH = 50;

/**
 * Ссылка «отписаться» ведёт в само приложение: страницы, которая пишет в базу
 * без человека, у нас нет и заводить её ради этого незачем. Приложение по
 * этому адресу выключает письма и говорит об этом.
 */
export const UNSUBSCRIBE_URL = `${location.origin}${location.pathname}?unsubscribe=1`;

/**
 * Письмо целиком. Разметка простая и с проставленными стилями: почтовые
 * программы вырезают внешние таблицы стилей, а половина из них ещё и не
 * понимает современных правил.
 */
export function buildLetter(title, body) {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const html = `
<div style="margin:0;padding:24px;background:#eceef6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border-radius:18px;color:#14141f">
    <h1 style="margin:0 0 18px;font-size:22px;font-weight:600">${esc(title)}</h1>
    ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n    ')}
    <p style="margin:26px 0 0;font-size:13px;line-height:1.6;color:#66667c">
      ${esc(t('mail.footer'))}
      <a href="${UNSUBSCRIBE_URL}" style="color:#3a63ff">${esc(t('mail.unsubscribe'))}</a>
    </p>
  </div>
</div>`.trim();

  const text = `${title}\n\n${paragraphs.join('\n\n')}\n\n${t('mail.footer')} ${UNSUBSCRIBE_URL}`;

  return { html, text };
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Отправляет одну порцию. Порции гоняет вызывающий, показывая, сколько ушло:
 * рассылка на сотню адресов идёт заметное время, и молчать всё это время
 * нельзя.
 */
export async function sendBatch({ subject, html, text, recipients }) {
  const token = await idToken();
  if (!token) throw new Error(t('receipt.signInAgain'));

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'send_mail', subject, html, text, recipients,
      // По этому адресу почтовая программа рисует собственную кнопку отписки.
      unsubscribe_url: UNSUBSCRIBE_URL,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(mailError(data?.error, response.status));

  return { sent: Number(data?.sent) || 0, failed: data?.failed || [] };
}

function mailError(code, status) {
  const messages = {
    not_admin: t('mail.notAdmin'),
    smtp_auth_failed: t('mail.smtpAuth'),
    smtp_connect_failed: t('mail.smtpConnect'),
    mail_not_configured: t('mail.notConfigured'),
    mail_subject_invalid: t('mail.subjectInvalid'),
    mail_body_empty: t('mail.bodyEmpty'),
    mail_body_too_large: t('mail.bodyTooLarge'),
    mail_recipients_invalid: t('mail.recipientsInvalid'),
  };
  return messages[code] || t('receipt.genericError', { code: code || status });
}
