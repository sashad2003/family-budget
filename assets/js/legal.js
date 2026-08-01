/**
 * Переключение языка на юридических страницах.
 *
 * Все три языка лежат в самой разметке — так страницу можно прочитать без
 * единого запроса к серверу, а поисковик и проверяющий видят весь текст сразу.
 *
 * Язык берём из адреса (?lang=he), иначе из того, что выбрано в приложении,
 * иначе из настроек браузера.
 */

const LANGS = { ru: 'ltr', en: 'ltr', he: 'rtl' };

function pick() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked && LANGS[asked]) return asked;

  const saved = localStorage.getItem('locale');
  if (saved && LANGS[saved]) return saved;

  for (const tag of navigator.languages || [navigator.language || '']) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (LANGS[code]) return code;
  }
  return 'en';
}

function show(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = LANGS[lang];

  for (const article of document.querySelectorAll('article')) {
    article.classList.toggle('is-shown', article.lang === lang);
  }
  for (const link of document.querySelectorAll('.langs a')) {
    link.classList.toggle('is-active', link.dataset.lang === lang);
  }
  document.title = document.querySelector('article.is-shown h1')?.textContent || document.title;
}

show(pick());

for (const link of document.querySelectorAll('.langs a')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    show(link.dataset.lang);
    history.replaceState(null, '', `?lang=${link.dataset.lang}`);
  });
}
