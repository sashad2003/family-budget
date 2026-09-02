<?php
// Скопировать в config.php на сервере и заполнить.
// config.php в .gitignore — в репозиторий он попасть не должен.
//
// Значения можно держать и в переменных окружения — getenv() имеет приоритет.

return [
    // Ключ Anthropic. Живёт только здесь, на фронтенд не попадает.
    'anthropic_key' => getenv('ANTHROPIC_API_KEY') ?: 'sk-ant-...',

    // Модель для распознавания чеков.
    'model' => 'claude-opus-5',

    // ID проекта Firebase — проверяется как aud в ID-токене.
    'firebase_project_id' => getenv('FIREBASE_PROJECT_ID') ?: 'mony-y-hac-b-kormaney',

    // Кто имеет право дёргать прокси.
    // Пустой массив = любой, кто вошёл в приложение через Google.
    // Расход при этом держит только rate_limit_per_hour.
    'allowed_emails' => [],

    // Откуда принимаем запросы. Пустой массив = запретить всё.
    'allowed_origins' => [
        'https://mybudget.sitemarket.co.il',
        'http://localhost:8080',
    ],

    // Лимит AI-запросов на пользователя в час.
    'rate_limit_per_hour' => 60,

    // Кому разрешено рассылать письма о новом. Проверяется на сервере:
    // спрятанной кнопки в админ-панели для этого мало.
    'admin_emails' => ['sashad2003@gmail.com'],

    // AhaSend — почта по HTTP API v2, без SMTP.
    // Ключ вида aha-sk-..., id аккаунта — из панели AhaSend.
    // Домен отправителя должен быть подтверждён там же (SPF и DKIM),
    // иначе письма уедут в спам.
    'ahasend_key'        => getenv('AHASEND_API_KEY') ?: '',
    'ahasend_account_id' => getenv('AHASEND_ACCOUNT_ID') ?: '',
    'mail_from_email'    => 'hello@sitemarket.co.il',
    'mail_from_name'     => 'Семейный бюджет',
];
