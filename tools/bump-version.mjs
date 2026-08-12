/**
 * Поднимает номер версии кеша ?v=НОМЕР во всех файлах проекта.
 *
 * Зачем это нужно.
 *
 * Код и стили отдаются с заголовком Cache-Control: immutable — браузеру
 * обещано, что по такому адресу содержимое не изменится никогда, и он
 * перестаёт его перепроверять вовсе. Обещание держится ровно до тех пор,
 * пока адрес меняется вместе с содержимым: ?v=51 — это и есть адрес.
 *
 * Стоит выпустить правку, забыв поднять номер, — и у всех, кто заходил
 * раньше, приложение останется старым на месяц, без единого способа
 * починить это иначе как чисткой кеша вручную. Такое уже случалось,
 * поэтому номер поднимается не памятью человека, а хуком .githooks/pre-commit.
 *
 * Номер один на весь проект намеренно. Модули импортируют друг друга с тем
 * же ?v, и стоит версиям разъехаться, как свежий файл потянет за собой
 * старый — а это хуже, чем полностью старая версия: части приложения
 * оказываются из разных выпусков.
 *
 * Запуск вручную:  node tools/bump-version.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** Где ищем номер: расширения файлов, в которых он вообще встречается. */
const EXTENSIONS = ['js', 'mjs', 'css', 'html', 'webmanifest'];

/** Сам скрипт трогать не надо: номера в его тексте — примеры из комментариев. */
const SKIP = ['tools/bump-version.mjs'];

const VERSION = /(\?|&)v=(\d+)/g;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Все файлы под присмотром git — не задевая node_modules и прочий мусор. */
function trackedFiles() {
  return git('ls-files')
    .split('\n')
    .filter(Boolean)
    .filter((path) => EXTENSIONS.includes(path.split('.').pop()))
    .filter((path) => !SKIP.includes(path));
}

/** Текущий номер берём из разметки: она подключает стили и задаёт версию всем. */
function currentVersion() {
  const html = readFileSync('index.html', 'utf8');
  const found = html.match(/app\.css\?v=(\d+)/);
  if (!found) throw new Error('В index.html не нашёлся номер версии у app.css');
  return Number(found[1]);
}

export function bump() {
  const from = currentVersion();
  const to = from + 1;

  const changed = [];
  for (const path of trackedFiles()) {
    const before = readFileSync(path, 'utf8');
    const after = before.replace(VERSION, (_, sign) => `${sign}v=${to}`);
    if (after === before) continue;

    writeFileSync(path, after);
    changed.push(path);
  }

  return { from, to, changed };
}

// Запущен напрямую, а не импортирован хуком — поднимаем и рассказываем.
if (process.argv[1] && process.argv[1].endsWith('bump-version.mjs')) {
  const { from, to, changed } = bump();
  console.log(`Версия кеша: ${from} → ${to}, файлов изменено: ${changed.length}`);
}
