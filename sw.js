/**
 * Service worker: делает приложение устанавливаемым и даёт запас на случай
 * пропавшей связи.
 *
 * Стратегия — «сначала сеть». Кеш здесь только резерв: он читается, когда
 * запрос не прошёл. Поэтому свежий код доезжает сам, без чистки кеша, а
 * старый показывается лишь когда сети нет вовсе.
 *
 * Обратная стратегия («сначала кеш») быстрее, но именно она превращает
 * установленное приложение в вечно устаревшее — так делать здесь нельзя.
 */

const CACHE = 'budget-v1';

/** Оболочка, чтобы приложение открылось офлайн хотя бы на последних данных. */
const SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  // Новая версия воркера заступает сразу, не дожидаясь закрытия вкладок.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Чужие домены (Firebase, шрифты) и всё, кроме чтения, отдаём браузеру как есть.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Ответы прокси зависят от запроса и живут один раз — кешировать их незачем.
  if (request.url.includes('api-proxy.php')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request);
      if (cached) return cached;

      // Переход по адресу без сети — отдаём сохранённую оболочку.
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
