/**
 * Выкладывает firestore.rules на боевой проект.
 *
 * Правила лежат в репозитории, но деплой их не возит: пуш выкладывает файлы
 * сайта, а правила живут в самом Firebase. До сих пор это делалось консолью
 * Firebase руками, и код с боевыми правилами разъезжался незаметно — новая
 * коллекция появлялась, а доступ к ней оставался закрытым.
 *
 * Скрипт ходит в Firebase Rules API напрямую служебным ключом: firebase-tools
 * ставить незачем ради одного запроса, а зависимостей в проекте нет и не
 * должно быть.
 *
 *   node tools/deploy-rules.mjs           показать, что изменится
 *   node tools/deploy-rules.mjs --apply   выложить
 *
 * Ключ — тот же файл *firebase-adminsdk*.json, что лежит рядом. В репозиторий
 * он не попадает: это доступ ко всей базе.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createSign } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const RULES = `${ROOT}firestore.rules`;

const keyFile = readdirSync(ROOT).find((name) => name.includes('firebase-adminsdk') && name.endsWith('.json'));
if (!keyFile) {
  console.error('Служебный ключ не найден: положите рядом *firebase-adminsdk*.json');
  process.exit(1);
}

const key = JSON.parse(readFileSync(ROOT + keyFile, 'utf8'));
const source = readFileSync(RULES, 'utf8');

/** Access-token из служебного ключа: подписанный JWT в обмен на токен. */
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(claims)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });

  const data = await response.json();
  if (!data.access_token) throw new Error(`Токен не получен: ${JSON.stringify(data)}`);
  return data.access_token;
}

const api = async (token, path, options = {}) => {
  const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${key.project_id}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data;
};

const token = await accessToken();

// Что сейчас на бою: у релиза cloud.firestore свой набор правил.
const release = await api(token, '/releases/cloud.firestore');
const current = await api(token, `/${release.rulesetName.split('/').slice(2).join('/')}`);
const live = current.source.files[0].content;

if (live.trim() === source.trim()) {
  console.log('Правила на сервере уже совпадают с firestore.rules — выкладывать нечего.');
  process.exit(0);
}

const liveLines = live.split('\n');
const nextLines = source.split('\n');
console.log(`На сервере ${liveLines.length} строк, в репозитории ${nextLines.length}.`);
console.log('Коллекции на сервере:', [...live.matchAll(/match \/(\w+)\//g)].map((m) => m[1]).join(', '));
console.log('Коллекции в файле:  ', [...source.matchAll(/match \/(\w+)\//g)].map((m) => m[1]).join(', '));

if (!process.argv.includes('--apply')) {
  console.log('\nЭто сухой прогон. Выложить: node tools/deploy-rules.mjs --apply');
  process.exit(0);
}

const ruleset = await api(token, '/rulesets', {
  method: 'POST',
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: source }] } }),
});

await api(token, '/releases/cloud.firestore', {
  method: 'PATCH',
  body: JSON.stringify({ release: { name: `projects/${key.project_id}/releases/cloud.firestore`, rulesetName: ruleset.name } }),
});

console.log(`\nВыложено. Набор правил: ${ruleset.name}`);
