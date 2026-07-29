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

    // Кто имеет право дёргать прокси. Совпадает с allowedEmails в Firestore.
    'allowed_emails' => [
        'sashad2003@gmail.com',
    ],

    // Откуда принимаем запросы. Пустой массив = запретить всё.
    'allowed_origins' => [
        'https://budget.sitemarket.co.il',
        'http://localhost:8080',
    ],

    // Лимит AI-запросов на пользователя в час.
    'rate_limit_per_hour' => 60,
];
