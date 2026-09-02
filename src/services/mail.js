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

import { PROXY_URL, SUPPORT_WHATSAPP } from '../config.js?v=115';
import { idToken } from './auth.js?v=115';
import { t, tIn, LOCALES } from '../core/i18n.js?v=115';

/** Столько же, сколько прокси принимает за раз. */
export const MAIL_BATCH = 50;

/**
 * Ссылка «отписаться» ведёт в само приложение: страницы, которая пишет в базу
 * без человека, у нас нет и заводить её ради этого незачем. Приложение по
 * этому адресу выключает письма и говорит об этом.
 */
export const UNSUBSCRIBE_URL = `${location.origin}${location.pathname}?unsubscribe=1`;

/**
 * Язык, на котором писать этому человеку.
 *
 * Он лежит в профиле с тех пор, как человек его выбрал; у тех, кто завёлся
 * раньше, поля нет — им пишем по-русски, на языке, на котором приложение
 * начиналось.
 */
export function localeOf(user) {
  const code = String(user?.locale || '');
  return LOCALES.some((l) => l.code === code) ? code : 'ru';
}

/**
 * Письмо целиком, на языке получателя.
 *
 * Тело приходит в одном из двух видов. Простой текст разбивается на абзацы по
 * пустой строке и экранируется — так пишут обычные письма. Разметка
 * вставляется как есть: её пишут, когда нужно письмо с картинками, кнопками и
 * заголовками, и ломать её экранированием нельзя.
 *
 * Общая рамка — светлый фон, белый лист, подпись со ссылкой отписки — остаётся
 * в обоих случаях: она и делает письмо письмом приложения, а не куском текста.
 *
 * Стили проставлены прямо в тегах: почтовые программы вырезают внешние
 * таблицы стилей, а половина из них не понимает и современных правил.
 * Направление тоже здесь — иврит читается справа налево, и без dir абзацы
 * разъезжаются.
 */
export function buildLetter(title, body, locale = 'ru') {
  const rtl = locale === 'he';
  const dir = rtl ? 'rtl' : 'ltr';
  const align = rtl ? 'right' : 'left';

  /*
   * Разметка это или просто текст, видно по самому тексту: письмо с тегами
   * вставляем как есть, письмо без них разбиваем на абзацы и экранируем.
   * Спрашивать об этом человека незачем — он и так видит, что написал.
   */
  const raw = String(body || '');
  const isMarkup = /<[a-z][\s\S]*>/i.test(raw);

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const content = isMarkup
    ? raw
    : paragraphs
        .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n    ');

  /*
   * Подвал письма. Подпись, ссылка отписки и приглашение написать — три разные
   * вещи, разведённые по строкам и по весу: одной строкой они склеивались в
   * предложение и читались неверно.
   *
   * Кнопка в WhatsApp стоит в каждом письме: человек, у которого что-то не
   * работает, пишет туда, где ему удобно, а не ищет адрес поддержки.
   */
  const contact = SUPPORT_WHATSAPP ? `
    <p style="margin:26px 0 12px;font-size:15px;line-height:1.6">${esc(tIn(locale, 'mail.contactHint'))}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0">
      <tr>
        <td style="border-radius:12px;background:#25d366">
          <a href="https://wa.me/${SUPPORT_WHATSAPP}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none">${esc(tIn(locale, 'mail.contact'))}</a>
        </td>
      </tr>
    </table>` : '';

  const html = `
<div dir="${dir}" style="margin:0;padding:24px;background:#eceef6;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;text-align:${align}">
  <div style="max-width:560px;margin:0 auto;padding:28px;background:#ffffff;border-radius:18px;color:#14141f">
    <h1 style="margin:0 0 18px;font-size:22px;font-weight:600">${esc(title)}</h1>
    ${content}
    ${contact}
    <div style="margin:26px 0 0;padding-top:18px;border-top:1px solid #e2e4ee">
      <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8a9c">${esc(tIn(locale, 'mail.footer'))}</p>
      <p style="margin:6px 0 0;font-size:13px;line-height:1.6">
        <a href="${UNSUBSCRIBE_URL}" style="color:#8a8a9c">${esc(tIn(locale, 'mail.unsubscribe'))}</a>
      </p>
    </div>
  </div>
</div>`.trim();

  /*
   * Текстовая часть письма нужна всегда: почтовые программы без разметки, а
   * заодно и антиспам-фильтры, читают именно её. Из разметки её получаем,
   * выкинув теги, — отдельно писать то же самое дважды никто не станет.
   */
  const plain = isMarkup ? stripTags(raw) : paragraphs.join('\n\n');
  const write = SUPPORT_WHATSAPP
    ? `\n\n${tIn(locale, 'mail.contactHint')} https://wa.me/${SUPPORT_WHATSAPP}`
    : '';

  const text = `${title}\n\n${plain}${write}\n\n`
    + `${tIn(locale, 'mail.footer')}\n`
    + `${tIn(locale, 'mail.unsubscribe')}: ${UNSUBSCRIBE_URL}`;

  return { html, text };
}

/**
 * Разметка → читаемый текст: переносы там, где были блоки.
 *
 * Отступы разметки после снятия тегов остаются пробелами в начале строк, а
 * вложенные таблицы дают вереницу пустых строк. И то и другое убираем: эту
 * часть письма читают почтовики без разметки и антиспам-фильтры, и выглядеть
 * она должна как письмо, а не как обломки вёрстки.
 */
function stripTags(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Перевод письма на остальные языки — той же моделью, что разбирает чеки.
 * Разметку она сохраняет, переводится только текст между тегами.
 */
export async function translateLetter({ subject, body, from, targets }) {
  const token = await idToken();
  if (!token) throw new Error(t('receipt.signInAgain'));

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'translate_mail', subject, body, from, targets }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.translations) {
    throw new Error(mailError(data?.error, response.status));
  }

  return data.translations;
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

/**
 * Человеческое описание отказа.
 *
 * Коды приходят и от прокси, и от почтового сервера; у SMTP их с десяток, и
 * каждый чинится по-своему — поэтому расшифровываем, а не показываем как
 * есть. Неизвестный код всё же выводим целиком: он полезнее пустого «не
 * получилось».
 */
export function mailError(code, status = 0) {
  const known = {
    not_admin: 'mail.notAdmin',
    mail_not_configured: 'mail.notConfigured',
    mail_subject_invalid: 'mail.subjectInvalid',
    mail_body_empty: 'mail.bodyEmpty',
    mail_body_too_large: 'mail.bodyTooLarge',
    mail_recipients_invalid: 'mail.recipientsInvalid',
    invalid_email: 'mail.badAddress',
    translate_input_invalid: 'mail.bodyEmpty',
    claude_error: 'mail.translateFailed',
    claude_unparsable: 'mail.translateFailed',

    smtp_connect_failed: 'mail.smtpConnect',
    smtp_greeting_failed: 'mail.smtpConnect',
    smtp_ehlo_failed: 'mail.smtpConnect',
    smtp_starttls_refused: 'mail.smtpTls',
    smtp_tls_failed: 'mail.smtpTls',
    smtp_auth_unsupported: 'mail.smtpAuthUnsupported',
    smtp_auth_failed: 'mail.smtpAuth',
    smtp_from_refused: 'mail.smtpFrom',
    smtp_recipient_refused: 'mail.smtpRecipient',
    smtp_data_refused: 'mail.smtpSend',
    smtp_send_failed: 'mail.smtpSend',
  };

  const text = String(code || '');
  // У части кодов к ним приписана подробность: «smtp_connect_failed: 111 …».
  const head = text.split(':')[0].trim();
  const tail = text.slice(head.length + 1).trim();

  if (known[head]) return tail ? `${t(known[head])} (${tail})` : t(known[head]);
  if (head.startsWith('send_failed_')) {
    return t('mail.serviceRefused', { code: head.replace('send_failed_', '') });
  }

  return t('receipt.genericError', { code: text || status });
}
