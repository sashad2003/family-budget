/**
 * Чтение QR с камеры.
 *
 * На инвойсе напечатан QR со ссылкой на страницу фискального чека — ту самую,
 * которую до сих пор приходилось переписывать руками или копировать из камеры
 * телефона. Здесь она читается прямо в приложении.
 *
 * Читает сам браузер: BarcodeDetector встроен в Chrome на Android и в
 * Samsung Internet. Библиотеку не берём — приложение живёт без зависимостей,
 * а там, где детектора нет (iPhone), есть свой обходной путь: камера телефона
 * распознаёт QR сама, и ссылку остаётся вставить из буфера.
 */

import { el } from '../core/dom.js?v=126';
import { openSheet, closeSheet } from '../ui/sheet.js?v=126';
import { t } from '../core/i18n.js?v=126';

/** Умеет ли браузер читать QR сам. Проверяется до показа кнопки. */
export async function qrSupported() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code');
  } catch {
    return false;
  }
}

/**
 * Открывает камеру и ждёт QR. onResult получает прочитанную строку.
 *
 * Съёмка идёт живым видео, кадры не сохраняются и никуда не уходят: ссылка
 * распознаётся на самом телефоне.
 */
export async function openQrScanner(onResult, onCancel = () => {}) {
  const video = el('video', {
    autoplay: true,
    muted: true,
    playsinline: true,
    style: 'width:100%;border-radius:var(--r-md);background:#000;aspect-ratio:3/4;object-fit:cover',
  });
  video.muted = true;

  const hint = el('p', { class: 'hint' }, t('qr.aim'));

  let stream = null;
  let timer = null;
  let done = false;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const track of stream?.getTracks() || []) track.stop();
    stream = null;
  };

  openSheet({
    title: t('qr.title'),
    body: [video, hint],
    onClose: () => {
      stop();
      // Закрыли, ничего не прочитав, — вернуть того, кто открывал, на место.
      if (!done) onCancel();
    },
  });

  try {
    // Задняя камера: чек держат перед телефоном, а не за ним.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
  } catch (error) {
    console.error('Камера недоступна', error);
    hint.textContent = t('qr.noCamera');
    hint.style.color = 'var(--expense)';
    return;
  }

  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

  timer = setInterval(async () => {
    if (done || video.readyState < 2) return;

    try {
      const codes = await detector.detect(video);
      const value = codes.find((code) => code.rawValue)?.rawValue;
      if (!value) return;

      done = true;
      stop();
      closeSheet();
      onResult(value.trim());
    } catch (error) {
      // Отдельный неудачный кадр — обычное дело: рука дрогнула, не в фокусе.
      // Ошибку здесь показывать нечего, следующий кадр придёт через четверть
      // секунды.
      console.debug('Кадр не разобран', error);
    }
  }, 250);
}
