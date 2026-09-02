/**
 * Простой визуальный редактор письма.
 *
 * Написан руками, а не взят библиотекой: приложение сознательно живёт без
 * зависимостей и без сборки, а редактору письма нужно немногое — заголовок,
 * жирный, ссылка, картинка, список. Всё это умеет сам браузер через
 * contenteditable.
 *
 * Разметка, которую оставляет браузер, для письма не годится: почтовые
 * программы вырезают внешние стили и по-разному понимают голые теги. Поэтому
 * при каждом изменении разметка нормализуется — каждому тегу проставляются
 * свои стили прямо в атрибут. Отсюда и правило: редактор отдаёт наружу уже
 * готовый к отправке HTML, и переключение в код показывает ровно его.
 *
 * document.execCommand объявлен устаревшим, замены ему в браузерах нет до сих
 * пор; работает он везде, где работает приложение.
 */

import { el } from '../core/dom.js?v=120';
import { t } from '../core/i18n.js?v=120';

/** Стили писем: те же, что в готовых письмах, чтобы вид совпадал с отправкой. */
const STYLE = {
  p: 'margin:0 0 14px;font-size:15px;line-height:1.6;color:#14141f',
  h2: 'margin:26px 0 8px;font-size:17px;font-weight:600;color:#14141f',
  h3: 'margin:22px 0 6px;font-size:15px;font-weight:600;color:#14141f',
  ul: 'margin:0 0 14px;padding-inline-start:22px;font-size:15px;line-height:1.6;color:#14141f',
  ol: 'margin:0 0 14px;padding-inline-start:22px;font-size:15px;line-height:1.6;color:#14141f',
  li: 'margin:0 0 6px',
  a: 'color:#3a63ff',
  img: 'display:block;width:100%;max-width:468px;height:auto;border-radius:14px;border:1px solid #e2e4ee',
  blockquote: 'margin:0 0 14px;padding:12px 16px;background:#f5f6fa;border-radius:12px;font-size:15px;line-height:1.6;color:#14141f',
};

/**
 * Приводит разметку из-под редактора к письму.
 *
 * Браузер оставляет за собой div вместо абзацев, span с собственными стилями
 * и голые теги без оформления. Здесь всё это выправляется: div становится
 * абзацем, знакомым тегам ставится их стиль, чужие атрибуты style заменяются
 * нашими — иначе письмо у получателя выглядело бы иначе, чем в редакторе.
 */
export function normalizeEmailHtml(html) {
  const box = document.createElement('div');
  box.innerHTML = String(html || '');

  box.querySelectorAll('div').forEach((node) => {
    // Пустой div от Enter — это новый абзац, а не пустой блок.
    const p = document.createElement('p');
    p.innerHTML = node.innerHTML || '<br>';
    node.replaceWith(p);
  });

  box.querySelectorAll('span,font').forEach((node) => {
    node.replaceWith(...node.childNodes);
  });

  box.querySelectorAll('*').forEach((node) => {
    const tag = node.tagName.toLowerCase();
    if (STYLE[tag]) node.setAttribute('style', STYLE[tag]);
    node.removeAttribute('class');
    node.removeAttribute('id');
    if (tag === 'a') node.setAttribute('target', '_blank');
  });

  box.querySelectorAll('script,style,link,iframe').forEach((node) => node.remove());

  return box.innerHTML
    .replace(/<p style="[^"]*"><br><\/p>/g, '')
    .trim();
}

/**
 * Поле письма: сверху кнопки, снизу либо видимое письмо, либо его код.
 *
 * onChange зовётся при каждой правке — черновик сохраняется на каждой букве,
 * и ждать особого нажатия «сохранить» человеку не нужно.
 */
export function richText({ value = '', dir = 'ltr', onChange = () => {} }) {
  let mode = 'visual';
  let html = value;

  const area = el('div', {
    class: 'input rich',
    contenteditable: 'true',
    dir,
    style: 'min-height:260px;padding:20px;overflow:auto;text-align:start',
  });
  area.innerHTML = html || '';

  const code = el('textarea', {
    class: 'input textarea',
    dir: 'ltr',
    style: 'min-height:260px;font-family:var(--mono);font-size:13px',
  }, html);

  const pass = () => onChange(html);

  area.addEventListener('input', () => {
    html = normalizeEmailHtml(area.innerHTML);
    pass();
  });
  code.addEventListener('input', () => {
    html = code.value;
    pass();
  });

  /** Кнопка панели: не даём полю потерять фокус, иначе команда не применится. */
  const tool = (label, title, run) => el('button', {
    class: 'chip',
    title,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => {
      run();
      html = normalizeEmailHtml(area.innerHTML);
      pass();
    },
  }, label);

  const cmd = (name, arg = null) => () => document.execCommand(name, false, arg);

  const link = () => {
    const url = window.prompt(t('rich.linkUrl'), 'https://');
    if (url) document.execCommand('createLink', false, url);
  };

  const image = () => {
    const url = window.prompt(t('rich.imageUrl'), 'https://mybudget.sitemarket.co.il/assets/img/');
    if (url) document.execCommand('insertImage', false, url);
  };

  const toolbar = el('div', { class: 'chip-row', style: 'margin-bottom:10px' }, [
    tool('B', t('rich.bold'), cmd('bold')),
    tool('I', t('rich.italic'), cmd('italic')),
    tool('H2', t('rich.heading'), cmd('formatBlock', '<h2>')),
    tool('¶', t('rich.paragraph'), cmd('formatBlock', '<p>')),
    tool('• —', t('rich.list'), cmd('insertUnorderedList')),
    tool('🔗', t('rich.link'), link),
    tool('🖼', t('rich.image'), image),
    tool('⌫', t('rich.clear'), cmd('removeFormat')),
  ]);

  const modes = el('div', { class: 'segmented', style: 'margin-bottom:10px' },
    [['visual', t('rich.visual')], ['code', t('rich.code')]].map(([key, label]) =>
      el('button', {
        class: mode === key ? 'is-active' : '',
        onclick: () => {
          // Переключение переносит написанное: в код уходит нормализованная
          // разметка, обратно — то, что человек в коде поправил.
          if (key === 'code') code.value = html;
          else area.innerHTML = html;

          mode = key;
          area.hidden = mode !== 'visual';
          toolbar.hidden = mode !== 'visual';
          code.hidden = mode !== 'code';
          [...modes.children].forEach((b, i) => b.classList.toggle('is-active', i === (key === 'visual' ? 0 : 1)));
        },
      }, label)));

  code.hidden = true;

  return {
    node: el('div', {}, [modes, toolbar, area, code]),
    /** Подставить другое письмо — при открытии шаблона или после перевода. */
    set(next) {
      html = next || '';
      area.innerHTML = html;
      code.value = html;
    },
    get() {
      return html;
    },
  };
}
