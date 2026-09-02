<?php
declare(strict_types=1);

/**
 * Прокси между фронтендом и Claude API.
 *
 * Задачи:
 *   1. Держать ключ Anthropic на сервере — на фронтенд он не попадает.
 *   2. Пускать только авторизованных членов семьи (проверка Firebase ID-токена).
 *   3. Не давать вызывающему выбирать модель, размер запроса и адрес — всё задаётся здесь.
 *
 * Действия (POST, JSON, поле "action"):
 *   rates          — курсы валют (внешний бесплатный источник, без ключа)
 *   receipt_image  — распознать фото чека
 *   receipt_url    — распознать страницу чека по ссылке (QR с инвойса)
 *   send_mail      — письмо о новом в приложении, только админу
 *   translate_mail — перевод письма на другие языки, только админу
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

const MAX_IMAGE_BYTES  = 5 * 1024 * 1024;   // 5 МБ на base64-картинку
const MAX_IMAGES       = 6;                 // длинный чек разрешаем снять частями
const MAX_IMAGES_BYTES = 12 * 1024 * 1024;  // суммарный потолок на все кадры
const MAX_PAGE_BYTES   = 512 * 1024;        // 512 КБ с чужой страницы
const MAX_PDF_BYTES    = 4 * 1024 * 1024;   // если по ссылке отдают PDF — шлём его целиком
const MAX_SMS_CHARS    = 2000;              // банковская SMS во много раз короче
const MAX_TOKENS      = 8000;

// Рассылка. Письма уходят по одному на адрес — получатели не должны видеть
// друг друга, — поэтому порция ограничена: длинный запрос упрётся в таймаут
// PHP раньше, чем разошлётся.
const MAX_MAIL_BATCH   = 50;
const MAX_MAIL_SUBJECT = 200;
const MAX_MAIL_BYTES   = 100 * 1024;

const AHASEND_API = 'https://api.ahasend.com/v2/accounts/%s/messages';

/**
 * Цена модели в долларах за миллион токенов — чтобы знать, во что обходится
 * один чек. Нужно для решения о подписке: пока считаем, а не гадаем.
 * При смене модели в config.php поправить и здесь.
 */
const PRICE_IN_PER_MTOK  = 5.0;
const PRICE_OUT_PER_MTOK = 25.0;

// Публичные ключи, которыми Google подписывает Firebase ID-токены
const FIREBASE_CERTS_URL =
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// ---------------------------------------------------------------- конфиг

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    respond(500, ['error' => 'config_missing']);
}
$config = require $configPath;

// ---------------------------------------------------------------- CORS

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Vary: Origin');
if ($origin !== '') {
    if (!in_array($origin, $config['allowed_origins'], true)) {
        respond(403, ['error' => 'origin_not_allowed']);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Max-Age: 600');
header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['error' => 'method_not_allowed']);
}

// ---------------------------------------------------------------- запрос

$raw = file_get_contents('php://input') ?: '';
if ($raw === '' || strlen($raw) > MAX_IMAGE_BYTES + 64 * 1024) {
    respond(400, ['error' => 'bad_body']);
}
$req = json_decode($raw, true);
if (!is_array($req)) {
    respond(400, ['error' => 'invalid_json', 'detail' => json_last_error_msg()]);
}

$action = (string)($req['action'] ?? '');

// ---------------------------------------------------------------- авторизация

$user = requireUser($config);
if ($action !== 'rates') {
    enforceRateLimit($user['sub'], (int)$config['rate_limit_per_hour']);
}

// ---------------------------------------------------------------- маршруты

switch ($action) {
    case 'rates':
        respond(200, fetchRates());

    case 'receipt_image':
        $images = collectImages($req);
        $content = [];
        foreach ($images as $image) {
            $content[] = [
                'type'   => 'image',
                'source' => ['type' => 'base64', 'media_type' => $image['media_type'], 'data' => $image['data']],
            ];
        }
        $content[] = ['type' => 'text', 'text' => count($images) > 1
            ? 'Это ' . count($images) . ' фотографии одного чека (части длинной ленты или несколько страниц), '
              . 'снятые по порядку. Собери один общий список товаров без повторов на стыках кадров '
              . 'и один итог — тот, что напечатан на последнем фото.'
            : 'Извлеки данные из этого чека.'];
        respond(200, extractReceipt($config, $content));

    case 'receipt_url':
        $url = (string)($req['url'] ?? '');
        respond(200, extractReceipt($config, fetchReceiptContent($url)));

    case 'sms_text':
        $sms = trim((string)($req['text'] ?? ''));
        if ($sms === '' || mb_strlen($sms) > MAX_SMS_CHARS) {
            respond(400, ['error' => 'sms_text_invalid']);
        }
        respond(200, extractReceipt($config, [
            ['type' => 'text', 'text' =>
                "Это SMS банка о списании по карте. Извлеки из неё данные операции.\n"
                . "Списка товаров в SMS нет — оставь items пустым.\n"
                . "Магазин бери без служебных номеров терминала.\n"
                . "Не путай сумму покупки с остатком на счёте (Rasp., raspolozivo, balance).\n\n"
                . $sms],
        ]));

    case 'send_mail':
        respond(200, sendMail($config, $user, $req));

    case 'translate_mail':
        respond(200, translateMail($config, $user, $req));

    default:
        respond(400, ['error' => 'unknown_action']);
}

// ================================================================ функции

/**
 * Рассылка письма о новом в приложении.
 *
 * Отправляет по одному сообщению на адрес, а не одно на всех: в письме на
 * несколько получателей каждый видит адреса остальных, а это чужие почты.
 *
 * Право писать людям есть только у админа — список лежит в config.php рядом с
 * ключами. Проверка здесь, а не на странице: спрятанная кнопка ничего не
 * закрывает, запрос можно отправить и без неё.
 *
 * Кому именно писать, решает вызывающая сторона: она знает, кто отписался.
 * Здесь только проверяется, что адреса похожи на адреса, и что их не слишком
 * много за раз.
 */
function sendMail(array $config, array $user, array $req): array
{
    $admins = array_map('strtolower', $config['admin_emails'] ?? []);
    if ($admins === [] || !in_array($user['email'], $admins, true)) {
        respond(403, ['error' => 'not_admin']);
    }

    $transport = (string)($config['mail_transport'] ?? 'smtp');
    $fromEmail = (string)($config['mail_from_email'] ?? '');
    if ($fromEmail === '') {
        respond(500, ['error' => 'mail_not_configured']);
    }
    if ($transport === 'ahasend'
        && ((string)($config['ahasend_key'] ?? '') === '' || (string)($config['ahasend_account_id'] ?? '') === '')) {
        respond(500, ['error' => 'mail_not_configured']);
    }
    if ($transport === 'smtp' && (string)($config['smtp_host'] ?? '') === '') {
        respond(500, ['error' => 'mail_not_configured']);
    }

    $subject = trim((string)($req['subject'] ?? ''));
    $html = (string)($req['html'] ?? '');
    $text = (string)($req['text'] ?? '');
    if ($subject === '' || mb_strlen($subject) > MAX_MAIL_SUBJECT) {
        respond(400, ['error' => 'mail_subject_invalid']);
    }
    if ($html === '' && $text === '') {
        respond(400, ['error' => 'mail_body_empty']);
    }
    if (strlen($html) + strlen($text) > MAX_MAIL_BYTES) {
        respond(400, ['error' => 'mail_body_too_large']);
    }

    $recipients = is_array($req['recipients'] ?? null) ? $req['recipients'] : [];
    if ($recipients === [] || count($recipients) > MAX_MAIL_BATCH) {
        respond(400, ['error' => 'mail_recipients_invalid']);
    }

    $sent = 0;
    $failed = [];

    foreach ($recipients as $person) {
        $email = strtolower(trim((string)($person['email'] ?? '')));
        $name = trim((string)($person['name'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $failed[] = ['email' => $email, 'error' => 'invalid_email'];
            continue;
        }

        $letter = [
            'to_email'   => $email,
            'to_name'    => $name,
            'from_email' => $fromEmail,
            'from_name'  => (string)($config['mail_from_name'] ?? 'Бюджет'),
            'subject'    => $subject,
            'text'       => $text,
            'html'       => $html,
            'unsubscribe' => (string)($req['unsubscribe_url'] ?? ''),
        ];

        $error = $transport === 'smtp'
            ? sendViaSmtp($config, $letter)
            : sendViaAhaSend($config, $letter);

        if ($error === null) {
            $sent += 1;
        } else {
            $failed[] = ['email' => $email, 'error' => $error];
        }
    }

    return ['sent' => $sent, 'failed' => $failed];
}

/**
 * Перевод письма на остальные языки приложения.
 *
 * Письмо пишется на одном языке, а получают его люди с тремя разными. Перевод
 * делает та же модель, что разбирает чеки: отдельного сервиса ради трёх
 * абзацев заводить незачем.
 *
 * Разметку письма модель обязана сохранить — если админ прислал HTML, теги
 * должны остаться теми же, переводится только текст между ними.
 */
function translateMail(array $config, array $user, array $req): array
{
    $admins = array_map('strtolower', $config['admin_emails'] ?? []);
    if ($admins === [] || !in_array($user['email'], $admins, true)) {
        respond(403, ['error' => 'not_admin']);
    }

    $subject = trim((string)($req['subject'] ?? ''));
    $body = (string)($req['body'] ?? '');
    $from = (string)($req['from'] ?? 'ru');
    $targets = array_values(array_filter(
        is_array($req['targets'] ?? null) ? $req['targets'] : [],
        static fn ($code) => in_array($code, ['ru', 'en', 'he'], true),
    ));

    if ($subject === '' || $body === '' || $targets === []) {
        respond(400, ['error' => 'translate_input_invalid']);
    }
    if (strlen($subject) + strlen($body) > MAX_MAIL_BYTES) {
        respond(400, ['error' => 'mail_body_too_large']);
    }

    $names = ['ru' => 'русский', 'en' => 'английский', 'he' => 'иврит'];
    $properties = [];
    foreach ($targets as $code) {
        $properties[$code] = [
            'type' => 'object',
            'properties' => [
                'subject' => ['type' => 'string'],
                'body'    => ['type' => 'string'],
            ],
            'required' => ['subject', 'body'],
            'additionalProperties' => false,
        ];
    }

    $schema = [
        'type' => 'object',
        'properties' => $properties,
        'required' => $targets,
        'additionalProperties' => false,
    ];

    $system = <<<'TXT'
Ты переводишь письмо пользователям приложения для семейного бюджета.
Переводи так, как пишут людям, а не как переводят документы: тем же тоном,
той же длины, без канцелярита и без добавленных от себя любезностей.
Названия приложения и валют не переводи. Разметку сохраняй в точности:
если в тексте есть HTML-теги, они должны остаться теми же и на тех же местах,
переводится только текст между ними. Пустые строки между абзацами сохраняй.
TXT;

    $list = implode(', ', array_map(static fn ($c) => $names[$c] ?? $c, $targets));
    $prompt = "Исходный язык: {$names[$from]}. Переведи на: {$list}.\n\n"
        . "Тема: {$subject}\n\nТекст:\n{$body}";

    $payload = [
        'model'      => $config['model'],
        'max_tokens' => MAX_TOKENS,
        'system'     => $system,
        'messages'   => [['role' => 'user', 'content' => [['type' => 'text', 'text' => $prompt]]]],
        'output_config' => [
            'effort' => 'medium',
            'format' => ['type' => 'json_schema', 'schema' => $schema],
        ],
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . $config['anthropic_key'],
            'anthropic-version: 2023-06-01',
        ],
    ]);
    $body_raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $resp = json_decode((string)$body_raw, true);
    if ($code !== 200 || !is_array($resp)) {
        respond(502, ['error' => 'claude_error', 'status' => $code]);
    }

    foreach ($resp['content'] ?? [] as $block) {
        if (($block['type'] ?? '') === 'text') {
            $parsed = json_decode((string)$block['text'], true);
            if (is_array($parsed)) {
                return ['ok' => true, 'translations' => $parsed];
            }
        }
    }

    respond(502, ['error' => 'claude_unparsable']);
}

/**
 * AhaSend, HTTP API v2. Возвращает null при успехе или код ошибки строкой.
 *
 * Ключ идемпотентности собран из адреса, темы и даты: повторное нажатие в тот
 * же день не удвоит письмо, если рука дрогнула.
 */
function sendViaAhaSend(array $config, array $letter): ?string
{
    $payload = [
        'from' => ['email' => $letter['from_email'], 'name' => $letter['from_name']],
        'recipients' => [array_filter([
            'email' => $letter['to_email'],
            'name' => $letter['to_name'],
        ])],
        'subject' => $letter['subject'],
    ];
    if ($letter['text'] !== '') $payload['text_content'] = $letter['text'];
    if ($letter['html'] !== '') $payload['html_content'] = $letter['html'];

    $result = httpPostJson(
        sprintf(AHASEND_API, rawurlencode((string)$config['ahasend_account_id'])),
        $payload,
        20,
        [
            'Authorization: Bearer ' . (string)$config['ahasend_key'],
            'Content-Type: application/json',
            'Idempotency-Key: ' . substr(
                hash('sha256', $letter['to_email'] . '|' . $letter['subject'] . '|' . date('Y-m-d')),
                0,
                40,
            ),
        ],
    );

    return ($result['status'] >= 200 && $result['status'] < 300)
        ? null
        : 'send_failed_' . $result['status'];
}

/**
 * Обычный SMTP — почта хостинга или Gmail, стороннего сервиса не нужно.
 *
 * Клиент написан здесь, а не взят библиотекой: приложение сознательно живёт
 * без зависимостей, а нужного тут — десяток команд протокола.
 *
 * Шифрование обязательно: ssl:// сразу (порт 465) или STARTTLS после
 * приветствия (порт 587). Пароль уходит по сети, и открытым текстом ему
 * ходить нельзя. TLS 1.0 и 1.1 почтовики уже не принимают, поэтому версию не
 * понижаем ни при каких условиях.
 */
function sendViaSmtp(array $config, array $letter): ?string
{
    $host = (string)$config['smtp_host'];
    $port = (int)($config['smtp_port'] ?? 587);
    $user = (string)($config['smtp_user'] ?? '');
    $pass = (string)($config['smtp_pass'] ?? '');

    $address = ($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $context = stream_context_create(['ssl' => ['crypto_method' => STREAM_CRYPTO_METHOD_TLS_CLIENT]]);

    $socket = @stream_socket_client($address, $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $context);
    if (!$socket) {
        // Причину прикладываем к коду: «соединение отклонено» и «имя не
        // разрешается» чинятся по-разному, а по одному коду их не различить.
        return 'smtp_connect_failed: ' . $errno . ' ' . $errstr;
    }
    stream_set_timeout($socket, 20);

    $expect = static function ($socket, string $codes) {
        $line = '';
        // Многострочный ответ: «250-РАСШИРЕНИЕ» продолжается, «250 » завершает.
        do {
            $line = fgets($socket, 1024);
            if ($line === false) return false;
        } while (isset($line[3]) && $line[3] === '-');

        return in_array(substr($line, 0, 3), explode(',', $codes), true);
    };
    $say = static function ($socket, string $line) {
        fwrite($socket, $line . "\r\n");
    };

    $fail = static function ($socket, string $code): string {
        fclose($socket);
        return $code;
    };

    if (!$expect($socket, '220')) return $fail($socket, 'smtp_greeting_failed');

    $ehlo = 'budget.' . parse_url((string)($config['allowed_origins'][0] ?? 'localhost'), PHP_URL_HOST);
    $say($socket, 'EHLO ' . $ehlo);
    if (!$expect($socket, '250')) return $fail($socket, 'smtp_ehlo_failed');

    if ($port !== 465) {
        $say($socket, 'STARTTLS');
        if (!$expect($socket, '220')) return $fail($socket, 'smtp_starttls_refused');
        if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
            return $fail($socket, 'smtp_tls_failed');
        }
        // После включения шифрования разговор начинается заново.
        $say($socket, 'EHLO ' . $ehlo);
        if (!$expect($socket, '250')) return $fail($socket, 'smtp_ehlo_failed');
    }

    if ($user !== '') {
        $say($socket, 'AUTH LOGIN');
        if (!$expect($socket, '334')) return $fail($socket, 'smtp_auth_unsupported');
        $say($socket, base64_encode($user));
        if (!$expect($socket, '334')) return $fail($socket, 'smtp_auth_failed');
        $say($socket, base64_encode($pass));
        if (!$expect($socket, '235')) return $fail($socket, 'smtp_auth_failed');
    }

    $say($socket, 'MAIL FROM:<' . $letter['from_email'] . '>');
    if (!$expect($socket, '250')) return $fail($socket, 'smtp_from_refused');

    $say($socket, 'RCPT TO:<' . $letter['to_email'] . '>');
    if (!$expect($socket, '250,251')) return $fail($socket, 'smtp_recipient_refused');

    $say($socket, 'DATA');
    if (!$expect($socket, '354')) return $fail($socket, 'smtp_data_refused');

    fwrite($socket, buildMimeMessage($letter));
    $say($socket, '.');
    if (!$expect($socket, '250')) return $fail($socket, 'smtp_send_failed');

    $say($socket, 'QUIT');
    fclose($socket);
    return null;
}

/**
 * Само письмо: заголовки и две части — текст и разметка.
 *
 * Заголовки с русскими буквами кодируются по RFC 2047, иначе почтовик
 * покажет вместо темы кашу. List-Unsubscribe ставим рядом со ссылкой в теле:
 * почтовые программы рисуют по нему собственную кнопку отписки, и письмо с
 * ней реже принимают за спам.
 */
function buildMimeMessage(array $letter): string
{
    $encode = static fn (string $value): string => preg_match('/[\x80-\xFF]/', $value)
        ? '=?UTF-8?B?' . base64_encode($value) . '?='
        : $value;

    $boundary = 'b' . bin2hex(random_bytes(12));
    $from = $letter['from_name'] !== ''
        ? $encode($letter['from_name']) . ' <' . $letter['from_email'] . '>'
        : $letter['from_email'];
    $to = $letter['to_name'] !== ''
        ? $encode($letter['to_name']) . ' <' . $letter['to_email'] . '>'
        : $letter['to_email'];

    $headers = [
        'From: ' . $from,
        'To: ' . $to,
        'Subject: ' . $encode($letter['subject']),
        'Date: ' . date('r'),
        'Message-ID: <' . bin2hex(random_bytes(10)) . '@' . substr(strrchr($letter['from_email'], '@') ?: '@localhost', 1) . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
    ];
    /*
     * List-Unsubscribe: по нему почтовая программа рисует свою кнопку отписки,
     * и письмо с ней реже принимают за спам.
     *
     * Заголовка List-Unsubscribe-Post здесь намеренно нет. С ним почтовик
     * отписывает сам, послав POST на этот адрес, — а по адресу лежит страница
     * приложения, которая такой запрос не обработает. Человек нажал бы кнопку,
     * увидел «готово» и остался бы в рассылке.
     */
    if ($letter['unsubscribe'] !== '') {
        $headers[] = 'List-Unsubscribe: <' . $letter['unsubscribe'] . '>';
    }

    $part = static function (string $type, string $content) use ($boundary): string {
        return "--$boundary\r\n"
            . "Content-Type: $type; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($content), 76, "\r\n");
    };

    $body = '';
    if ($letter['text'] !== '') $body .= $part('text/plain', $letter['text']);
    if ($letter['html'] !== '') $body .= $part('text/html', $letter['html']);
    $body .= "--$boundary--\r\n";

    /*
     * Точка в начале строки в протоколе означает конец письма — её удваивают.
     * Тело у нас в base64, точек там не бывает, но правило соблюдаем: однажды
     * формат письма поменяется, а про это забудут.
     */
    $message = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    return preg_replace('/^\./m', '..', $message);
}

/** POST с JSON-телом. Ответ отдаём как есть: разбирает его вызывающий. */
function httpPostJson(string $url, array $payload, int $timeout, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
    ]);

    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['status' => $status, 'body' => is_string($body) ? $body : ''];
}

function respond(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Проверяет Firebase ID-токен и сверяет проект + белый список почт. */
function requireUser(array $config): array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(\S+)$/i', $header, $m)) {
        respond(401, ['error' => 'missing_token']);
    }

    $claims = verifyFirebaseToken($m[1], (string)$config['firebase_project_id']);

    $email = strtolower((string)($claims['email'] ?? ''));
    if ($email === '') {
        respond(403, ['error' => 'not_allowed']);
    }

    /**
     * Белый список почт нужен, пока приложением пользуюсь я один: распознавание
     * чеков идёт за мои деньги. Когда список пуст, пускаем любого, кто вошёл
     * в это приложение через Google, — расход держит лимит запросов в час.
     */
    $allowed = array_map('strtolower', $config['allowed_emails'] ?? []);
    if ($allowed !== [] && !in_array($email, $allowed, true)) {
        respond(403, ['error' => 'not_allowed']);
    }

    return ['sub' => (string)($claims['sub'] ?? $email), 'email' => $email];
}

/**
 * Локальная проверка Firebase ID-токена: разбор JWT, сверка iss/aud/exp
 * и подпись RS256 публичным ключом Google. Ключи кешируются на час.
 */
function verifyFirebaseToken(string $token, string $projectId): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        respond(401, ['error' => 'invalid_token']);
    }
    [$head64, $body64, $sig64] = $parts;

    $header = json_decode(b64urlDecode($head64), true);
    $claims = json_decode(b64urlDecode($body64), true);
    $signature = b64urlDecode($sig64);

    if (!is_array($header) || !is_array($claims) || $signature === '') {
        respond(401, ['error' => 'invalid_token']);
    }
    if (($header['alg'] ?? '') !== 'RS256' || ($header['kid'] ?? '') === '') {
        respond(401, ['error' => 'invalid_token']);
    }

    $now = time();
    if ((int)($claims['exp'] ?? 0) <= $now) {
        respond(401, ['error' => 'token_expired']);
    }
    if ((int)($claims['iat'] ?? 0) > $now + 300) {
        respond(401, ['error' => 'invalid_token']);
    }
    if (($claims['sub'] ?? '') === '') {
        respond(401, ['error' => 'invalid_token']);
    }
    if (($claims['aud'] ?? '') !== $projectId
        || ($claims['iss'] ?? '') !== 'https://securetoken.google.com/' . $projectId) {
        respond(403, ['error' => 'wrong_project']);
    }

    // Ключи ротируются: если kid незнаком, перечитываем список принудительно.
    $certs = firebaseCerts(false);
    $cert = $certs[$header['kid']] ?? null;
    if ($cert === null) {
        $certs = firebaseCerts(true);
        $cert = $certs[$header['kid']] ?? null;
    }
    if ($cert === null) {
        respond(401, ['error' => 'unknown_signing_key']);
    }

    $publicKey = openssl_pkey_get_public($cert);
    if ($publicKey === false) {
        respond(500, ['error' => 'cert_unreadable']);
    }
    if (openssl_verify($head64 . '.' . $body64, $signature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
        respond(401, ['error' => 'bad_signature']);
    }

    return $claims;
}

/** Публичные сертификаты Firebase. При сбое сети отдаём просроченный кеш. */
function firebaseCerts(bool $force): array
{
    $file = sys_get_temp_dir() . '/budget_firebase_certs.json';
    $cached = is_file($file) ? json_decode((string)file_get_contents($file), true) : null;
    $fresh = is_array($cached) && $cached && time() - (int)filemtime($file) < 3600;

    if (!$force && $fresh) {
        return $cached;
    }

    $res = httpGet(FIREBASE_CERTS_URL, 10);
    $certs = $res['code'] === 200 ? json_decode($res['body'], true) : null;
    if (!is_array($certs) || !$certs) {
        if (is_array($cached) && $cached) {
            return $cached;
        }
        respond(503, ['error' => 'certs_unavailable']);
    }

    @file_put_contents($file, json_encode($certs));
    return $certs;
}

/**
 * Кадры чека из запроса. Новый формат — массив images,
 * старый (одна картинка) поддерживается для совместимости.
 */
function collectImages(array $req): array
{
    $raw = $req['images'] ?? null;
    if (!is_array($raw)) {
        $raw = [['media_type' => $req['media_type'] ?? '', 'data' => $req['image_base64'] ?? '']];
    }
    if (count($raw) < 1 || count($raw) > MAX_IMAGES) {
        respond(400, ['error' => 'image_count']);
    }

    $images = [];
    $totalBytes = 0;
    foreach ($raw as $item) {
        $media = is_array($item) ? (string)($item['media_type'] ?? '') : '';
        $data  = is_array($item) ? (string)($item['data'] ?? '') : '';

        if (!in_array($media, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            respond(400, ['error' => 'unsupported_media_type']);
        }
        if ($data === '' || strlen($data) > MAX_IMAGE_BYTES) {
            respond(400, ['error' => 'image_size']);
        }
        $totalBytes += strlen($data);
        if ($totalBytes > MAX_IMAGES_BYTES) {
            respond(400, ['error' => 'images_too_large']);
        }
        $images[] = ['media_type' => $media, 'data' => $data];
    }

    return $images;
}

function b64urlDecode(string $value): string
{
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    return $decoded === false ? '' : $decoded;
}

function enforceRateLimit(string $uid, int $perHour): void
{
    if ($perHour <= 0) {
        return;
    }
    $file = sys_get_temp_dir() . '/budget_rl_' . hash('sha256', $uid) . '.json';
    $now = time();
    $state = ['window' => $now, 'count' => 0];
    if (is_file($file)) {
        $prev = json_decode((string)file_get_contents($file), true);
        if (is_array($prev) && $now - (int)($prev['window'] ?? 0) < 3600) {
            $state = $prev;
        }
    }
    $state['count'] = (int)$state['count'] + 1;
    @file_put_contents($file, json_encode($state));
    if ($state['count'] > $perHour) {
        respond(429, ['error' => 'rate_limited']);
    }
}

function httpGet(string $url, int $timeout, array $headers = []): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_USERAGENT      => 'family-budget/2.0',
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string)(curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: '');
    $err  = curl_error($ch);
    if ($body === false) {
        return ['code' => 0, 'body' => '', 'type' => '', 'error' => $err];
    }
    return ['code' => $code, 'body' => (string)$body, 'type' => $type, 'error' => ''];
}

/** Курсы к EUR. Источник бесплатный и без ключа, поддерживает RSD и ILS. */
function fetchRates(): array
{
    $res = httpGet('https://open.er-api.com/v6/latest/EUR', 15);
    if ($res['code'] !== 200) {
        respond(502, ['error' => 'rates_unavailable']);
    }
    $data = json_decode($res['body'], true);
    if (!is_array($data) || ($data['result'] ?? '') !== 'success') {
        respond(502, ['error' => 'rates_bad_response']);
    }
    $wanted = ['EUR', 'RSD', 'ILS', 'USD'];
    $rates = [];
    foreach ($wanted as $code) {
        if (!isset($data['rates'][$code])) {
            respond(502, ['error' => 'rates_missing_currency', 'currency' => $code]);
        }
        $rates[$code] = (float)$data['rates'][$code];
    }
    return [
        'base'      => 'EUR',
        'rates'     => $rates,
        'fetchedAt' => date('c'),
        'source'    => 'open.er-api.com',
    ];
}

/**
 * Тянет страницу чека по ссылке из QR-кода.
 * Пускаем только https и только на публичные адреса — иначе прокси
 * превращается в инструмент для запросов во внутреннюю сеть хостинга.
 */
/**
 * Готовит содержимое страницы чека для модели.
 *
 * По ссылке из QR не всегда лежит HTML: часть сетей отдаёт сразу PDF-квитанцию.
 * Такой ответ нельзя чистить strip_tags — от бинарника остаётся мусор без товаров,
 * поэтому PDF уходит в Claude как есть, отдельным document-блоком.
 */
function fetchReceiptContent(string $url): array
{
    $parts = parse_url($url);
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
        respond(400, ['error' => 'url_must_be_https']);
    }
    $host = $parts['host'];
    $ips = @gethostbynamel($host) ?: [];
    if (!$ips) {
        respond(400, ['error' => 'url_host_unresolved']);
    }
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            respond(400, ['error' => 'url_private_address']);
        }
    }

    $res = httpGet($url, 20, ['Accept: text/html,application/xhtml+xml,application/pdf']);
    if ($res['code'] !== 200 || $res['body'] === '') {
        respond(502, ['error' => 'page_fetch_failed', 'status' => $res['code']]);
    }

    if (stripos($res['type'], 'application/pdf') !== false || str_starts_with($res['body'], '%PDF-')) {
        if (strlen($res['body']) > MAX_PDF_BYTES) {
            respond(413, ['error' => 'pdf_too_large']);
        }
        return [
            ['type' => 'document', 'source' => [
                'type'       => 'base64',
                'media_type' => 'application/pdf',
                'data'       => base64_encode($res['body']),
            ]],
            ['type' => 'text', 'text' => 'Извлеки данные из этой квитанции.'],
        ];
    }

    $html = substr($res['body'], 0, MAX_PAGE_BYTES);
    $html = preg_replace('#<(script|style|noscript)\b.*?</\1>#is', ' ', $html) ?? $html;
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = trim((string)preg_replace('/[ \t]*\R+[ \t]*/u', "\n", (string)preg_replace('/[ \t]+/u', ' ', $text)));

    if ($text === '') {
        respond(422, ['error' => 'page_empty']);
    }
    return [
        ['type' => 'text', 'text' => "Извлеки данные из текста страницы чека:\n\n" . mb_substr($text, 0, 20000)],
    ];
}

/** Один вызов Claude с жёсткой схемой ответа — на выходе всегда валидный JSON. */
function extractReceipt(array $config, array $content): array
{
    $schema = [
        'type' => 'object',
        'properties' => [
            // Вывеска, а не юрлицо: по «DELHAIZE SERBIA» не понять, был человек
            // в Maxi, в Tempo или в Shop&Go — это всё одна компания.
            'merchant'      => ['type' => 'string', 'description' => 'Название магазина как на вывеске (Maxi, Shop&Go, Lidl, Idea), а не юридическое лицо владельца (DELHAIZE SERBIA DOO, MERCATOR-S). Если в чеке есть и то и другое — бери вывеску. "" если не видно'],
            'address'       => ['type' => 'string', 'description' => 'Улица и номер дома или район точки — коротко, чтобы отличить один магазин сети от другого. "" если не видно'],
            'date'          => ['type' => 'string', 'description' => 'Дата чека в формате YYYY-MM-DD, "" если не видно'],
            'time'          => ['type' => 'string', 'description' => 'Время покупки в формате HH:MM (24 часа), "" если не видно'],
            'currency'      => ['type' => 'string', 'enum' => ['RSD', 'EUR', 'ILS', 'USD', '']],
            'total'         => ['type' => 'number', 'description' => 'Итоговая сумма, 0 если не видно'],
            'category_hint' => ['type' => 'string', 'description' => 'Категория расхода одним словом по-русски'],
            'items' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'name'  => ['type' => 'string'],
                        // Понятное название нужно для базы цен: в чеке пишут
                        // SLADOLED KING 100G, а искать человек будет «мороженое».
                        'norm'  => ['type' => 'string', 'description' => 'То же название по-русски, обычными словами: "SLADOLED KING 100G" → "Мороженое King 100 г". "" если непонятно, что это'],
                        'qty'   => ['type' => 'number'],
                        'price' => ['type' => 'number'],
                        'total' => ['type' => 'number'],
                    ],
                    'required' => ['name', 'norm', 'qty', 'price', 'total'],
                    'additionalProperties' => false,
                ],
            ],
        ],
        'required' => ['merchant', 'address', 'date', 'time', 'currency', 'total', 'category_hint', 'items'],
        'additionalProperties' => false,
    ];

    $system = <<<'TXT'
Ты разбираешь чеки из магазинов Сербии, Израиля и еврозоны.
Переноси названия товаров ровно так, как они напечатаны, ничего не додумывая.
В шапке чека обычно стоят и юрлицо, и название точки — в merchant пиши то,
что написано на вывеске и знакомо покупателю, служебные номера точки отбрасывай.
Валюту определяй по символу или коду: дин/RSD/РСД → RSD, ₪/ILS/ש"ח → ILS, €/EUR → EUR.
Если поле не читается — ставь "" для строк и 0 для чисел, не выдумывай значения.
Цены — числа без разделителей тысяч, десятичный разделитель — точка.
TXT;

    $payload = [
        'model'      => $config['model'],
        'max_tokens' => MAX_TOKENS,
        'system'     => $system,
        'messages'   => [['role' => 'user', 'content' => $content]],
        'output_config' => [
            'effort' => 'low',
            'format' => ['type' => 'json_schema', 'schema' => $schema],
        ],
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'x-api-key: ' . $config['anthropic_key'],
            'anthropic-version: 2023-06-01',
        ],
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);

    if ($body === false) {
        respond(502, ['error' => 'claude_unreachable', 'detail' => $err]);
    }
    $resp = json_decode((string)$body, true);
    if ($code !== 200 || !is_array($resp)) {
        error_log('claude error ' . $code . ': ' . substr((string)$body, 0, 500));
        respond(502, ['error' => 'claude_error', 'status' => $code]);
    }
    if (($resp['stop_reason'] ?? '') === 'refusal') {
        respond(422, ['error' => 'refused']);
    }

    $usage = costOf($resp['usage'] ?? []);

    foreach ($resp['content'] ?? [] as $block) {
        if (($block['type'] ?? '') === 'text') {
            $parsed = json_decode((string)$block['text'], true);
            if (is_array($parsed)) {
                return ['ok' => true, 'receipt' => $parsed, 'usage' => $usage];
            }
        }
    }
    respond(502, ['error' => 'claude_unparsable']);
}

/**
 * Во что обошёлся один разбор чека.
 *
 * Записываем в журнал сервера и отдаём клиенту: без реальных чисел нельзя
 * решить, окупается ли бесплатное пользование и сколько просить за подписку.
 */
function costOf(array $usage): array
{
    $in  = (int)($usage['input_tokens'] ?? 0);
    $out = (int)($usage['output_tokens'] ?? 0);
    // Кешированное чтение стоит дешевле, но у нас его нет — считаем как обычный вход.
    $in += (int)($usage['cache_read_input_tokens'] ?? 0)
         + (int)($usage['cache_creation_input_tokens'] ?? 0);

    $cost = $in / 1000000 * PRICE_IN_PER_MTOK + $out / 1000000 * PRICE_OUT_PER_MTOK;

    error_log(sprintf('budget receipt: in=%d out=%d cost=$%.4f', $in, $out, $cost));

    return ['input' => $in, 'output' => $out, 'cost_usd' => round($cost, 4)];
}
