# Семейный бюджет

Учёт семейных расходов и доходов в трёх валютах (RSD / EUR / ILS) с распознаванием чеков через Claude.

**Прод:** https://mybudget.sitemarket.co.il

---

## Что внутри

| Слой | Технология |
|---|---|
| Фронтенд | Чистый JS, ES-модули, без сборки |
| Данные | Firebase Firestore (realtime) |
| Вход | Firebase Auth, Google |
| Графики | Chart.js 4 (CDN, грузится по требованию) |
| AI | Claude через `api-proxy.php` |
| Хостинг | Hostinger, автодеплой из GitHub |

### Почему без фреймворка

Приложение — четыре экрана и одна форма. Vite + Preact дали бы компоненты и HMR, но взамен
потребовали бы шаг сборки: автодеплой Hostinger кладёт файлы из репозитория как есть, поэтому
пришлось бы прогонять `npm run build` через GitHub Actions и деплоить `dist/`. Это лишняя
движущаяся часть без выигрыша на таком объёме. Модульность здесь даётся структурой каталогов
и чистыми функциями в `src/core/`, а не библиотекой.

---

## Структура

```
index.html              каркас: экран входа, шапка, таббар
api-proxy.php           прокси к Claude API + курсы валют
config.example.php      шаблон серверного конфига (реальный config.php не коммитится)
firestore.rules         правила доступа к базе
assets/css/app.css      вся вёрстка

src/
  config.js             Firebase-конфиг, ID семьи, список валют
  main.js               вход, подписки на данные, роутинг

  core/
    firebase.js         инициализация SDK
    store.js            состояние + подписки
    dom.js              el() / render() / esc()
    dates.js            'YYYY-MM-DD', ярлыки месяцев и дней
    money.js            конвертация, округление, форматирование
    selectors.js        агрегаты: итоги, разбивка по категориям, динамика

  data/
    categories.js       категории по умолчанию, подбор категории по тексту

  services/
    auth.js             вход через Google, вступление в семью
    transactions.js     CRUD операций и категорий
    rates.js            курсы валют + кеш в Firestore
    receipts.js         сжатие фото, вызовы прокси, нормализация ответа AI

  ui/
    sheet.js            нижняя шторка
    toast.js            уведомления

  views/
    dashboard.js  list.js  charts.js  settings.js
    txForm.js           форма операции
    scan.js             сканирование чека
```

---

## Схема данных в Firestore

```
families/family_drutz
  name          "Семья Друц"
  baseCurrency  "RSD"
  memberUids    ["uid1", "uid2"]          — кто имеет доступ
  members       { uid1: {name,email,photo} }
  allowedEmails ["a@gmail.com"]           — кто может присоединиться сам

  transactions/{txId}
    type       "expense" | "income"
    amount     1234.5                      сумма в валюте операции
    currency   "RSD" | "EUR" | "ILS"
    amounts    { RSD, EUR, ILS }           посчитано при сохранении
    rates      { RSD, EUR, ILS }           снимок курсов к EUR
    rateDate   ISO-строка
    categoryId "groceries"
    date       "2026-07-29"
    month      "2026-07"
    note, merchant
    items      [{ name, qty, price, total }]
    source     "manual" | "receipt-photo" | "receipt-url"
    receiptUrl
    createdBy  { uid, name, photo }
    createdAt, updatedAt

  categories/{catId}
    name, type, icon, color, order, archived

  meta/rates
    base "EUR", rates { EUR, RSD, ILS }, fetchedAt, source
```

### Как считаются валюты

Курсы хранятся относительно евро: `rates.RSD` — сколько динаров в одном евро.

В момент сохранения операции считаются суммы **сразу во всех трёх валютах** и кладутся
в `amounts`, а использованные курсы — в `rates`. Отчёты за прошлые месяцы после этого
не меняются при колебании курса. Пересчёт происходит только если отредактировать сумму
или валюту самой операции.

Переключатель валюты в шапке меняет только валюту отображения итогов — данные не трогает.

---

## Развёртывание с нуля

### 1. Firebase

1. Firebase Console → проект `mony-y-hac-b-kormaney`.
2. **Authentication** → Sign-in method → включить **Google**.
3. **Authentication → Settings → Authorized domains** → добавить `mybudget.sitemarket.co.il`.
4. **Firestore Database** → создать базу (production mode).
5. Вкладка **Rules** → вставить содержимое [`firestore.rules`](firestore.rules) → Publish.
6. Создать документ вручную: коллекция `families`, ID документа `family_drutz`, поля:

   | Поле | Тип | Значение |
   |---|---|---|
   | `name` | string | `Семья Друц` |
   | `baseCurrency` | string | `RSD` |
   | `memberUids` | array | пустой |
   | `members` | map | пустая |
   | `allowedEmails` | array | почты членов семьи |

   Категории засеются сами при первом входе.

7. **Project settings → Your apps → Web app** → скопировать `firebaseConfig`
   и подставить значения в [`src/config.js`](src/config.js) вместо `ЗАПОЛНИТЬ_*`.

### 2. Сервер (Hostinger)

1. Скопировать `config.example.php` → `config.php` **на сервере** (в репозиторий он не попадает —
   он в `.gitignore`).
2. Заполнить:
   - `anthropic_key` — ключ из console.anthropic.com;
   - `allowed_emails` — те же почты, что в `allowedEmails` Firestore;
   - `allowed_origins` — `https://mybudget.sitemarket.co.il`.
3. Права на файл: `chmod 600 config.php`.
4. Требования: **PHP 8.1+** (используется тип `never`) с расширением `curl` —
   на Hostinger это версия по умолчанию, проверить можно в hPanel → PHP Configuration.

### 3. GitHub → Hostinger

Автодеплой уже настроен: пуш в `main` репозитория `sashad2003/family-budget` выкладывает файлы.
Сборки нет — что в репозитории, то и на сервере.

```bash
git add -A
git commit -m "feat: rebuild v3"
git push origin main
```

`config.php` деплой не перезаписывает: его нет в репозитории.

### 4. Локальная разработка

ES-модули требуют http, с `file://` работать не будут:

```bash
python3 -m http.server 8080
# открыть http://localhost:8080
```

`localhost:8080` уже есть в `allowed_origins` шаблона конфига. Чтобы сканирование чеков
работало локально, нужен локальный PHP:

```bash
php -S localhost:8080
```

---

## Безопасность

Что закрывает доступ:

- **Ключ Anthropic** живёт только в `config.php` на сервере. На фронтенд не попадает.
- **Прокси требует Firebase ID-токен**: проверяется подпись (через Google), поле `aud`
  (совпадение с проектом) и почта по белому списку.
- **Модель, лимит токенов и адрес запроса** задаются в прокси. Вызывающий их не выбирает —
  чужой запрос не может превратиться в дорогой.
- **CORS** — только домены из `allowed_origins`.
- **Лимит** — 60 AI-запросов в час на пользователя.
- **SSRF** — разбор чека по ссылке пускает только `https` и только на публичные IP,
  ответ обрезается до 512 КБ.
- **Firestore** — читать и писать может только участник семьи; вступить в неё
  может только владелец почты из `allowedEmails`.

> Ключ Anthropic из предыдущей версии кода был захардкожен в `api-proxy.php` и попал
> в историю git. Считайте его скомпрометированным: отзовите в консоли Anthropic
> и выпустите новый.

---

## Работа с чеками

**По фото.** Снимок сжимается в браузере до 1600 px и уходит в прокси, тот вызывает Claude
со строгой JSON-схемой. Возвращаются магазин, дата, валюта, итог, список товаров и подсказка
категории.

**По ссылке из QR.** Прокси скачивает страницу фискального чека, вырезает разметку и отдаёт
текст модели — так список товаров и цен получается точнее, чем с фотографии.

**Результат всегда редактируемый.** AI ошибается в названиях товаров, поэтому после
распознавания открывается обычная форма: любое поле и любую строку товара можно исправить,
удалить или добавить. Если сумма строк расходится с итогом, приложение подсвечивает это
и предлагает подставить пересчитанную сумму.
