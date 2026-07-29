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
 */

ini_set('display_errors', '0');
error_reporting(E_ALL);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // 5 МБ на base64-картинку
const MAX_PAGE_BYTES  = 512 * 1024;        // 512 КБ с чужой страницы
const MAX_TOKENS      = 8000;

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
        $media = (string)($req['media_type'] ?? '');
        $data  = (string)($req['image_base64'] ?? '');
        if (!in_array($media, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            respond(400, ['error' => 'unsupported_media_type']);
        }
        if ($data === '' || strlen($data) > MAX_IMAGE_BYTES) {
            respond(400, ['error' => 'image_size']);
        }
        respond(200, extractReceipt($config, [
            ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $media, 'data' => $data]],
            ['type' => 'text',  'text' => 'Извлеки данные из этого чека.'],
        ]));

    case 'receipt_url':
        $url = (string)($req['url'] ?? '');
        $text = fetchReceiptPage($url);
        respond(200, extractReceipt($config, [
            ['type' => 'text', 'text' => "Извлеки данные из текста страницы чека:\n\n" . $text],
        ]));

    default:
        respond(400, ['error' => 'unknown_action']);
}

// ================================================================ функции

function respond(int $code, array $payload): never
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Проверяет Firebase ID-токен через Google и сверяет проект + белый список почт.
 * Результат кешируется до истечения токена, чтобы не ходить в Google на каждый запрос.
 */
function requireUser(array $config): array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(\S+)$/i', $header, $m)) {
        respond(401, ['error' => 'missing_token']);
    }
    $token = $m[1];

    $cacheFile = sys_get_temp_dir() . '/budget_tok_' . hash('sha256', $token) . '.json';
    $claims = null;
    if (is_file($cacheFile)) {
        $cached = json_decode((string)file_get_contents($cacheFile), true);
        if (is_array($cached) && (int)($cached['exp'] ?? 0) > time() + 30) {
            $claims = $cached;
        }
    }

    if ($claims === null) {
        $res = httpGet('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($token), 10);
        if ($res['code'] !== 200) {
            respond(401, ['error' => 'invalid_token']);
        }
        $claims = json_decode($res['body'], true);
        if (!is_array($claims)) {
            respond(401, ['error' => 'invalid_token']);
        }
        @file_put_contents($cacheFile, json_encode($claims));
    }

    if (($claims['aud'] ?? '') !== $config['firebase_project_id']) {
        respond(403, ['error' => 'wrong_project']);
    }
    if ((int)($claims['exp'] ?? 0) <= time()) {
        respond(401, ['error' => 'token_expired']);
    }
    $email = strtolower((string)($claims['email'] ?? ''));
    $allowed = array_map('strtolower', $config['allowed_emails']);
    if ($email === '' || !in_array($email, $allowed, true)) {
        respond(403, ['error' => 'not_allowed']);
    }

    return ['sub' => (string)($claims['sub'] ?? $email), 'email' => $email];
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
    $err  = curl_error($ch);
    if ($body === false) {
        return ['code' => 0, 'body' => '', 'error' => $err];
    }
    return ['code' => $code, 'body' => (string)$body, 'error' => ''];
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
    $wanted = ['EUR', 'RSD', 'ILS'];
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
function fetchReceiptPage(string $url): string
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

    $res = httpGet($url, 20, ['Accept: text/html,application/xhtml+xml']);
    if ($res['code'] !== 200 || $res['body'] === '') {
        respond(502, ['error' => 'page_fetch_failed', 'status' => $res['code']]);
    }

    $html = substr($res['body'], 0, MAX_PAGE_BYTES);
    $html = preg_replace('#<(script|style|noscript)\b.*?</\1>#is', ' ', $html) ?? $html;
    $text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $text = trim((string)preg_replace('/[ \t]*\R+[ \t]*/u', "\n", (string)preg_replace('/[ \t]+/u', ' ', $text)));

    if ($text === '') {
        respond(422, ['error' => 'page_empty']);
    }
    return mb_substr($text, 0, 20000);
}

/** Один вызов Claude с жёсткой схемой ответа — на выходе всегда валидный JSON. */
function extractReceipt(array $config, array $content): array
{
    $schema = [
        'type' => 'object',
        'properties' => [
            'merchant'      => ['type' => 'string', 'description' => 'Название магазина, "" если не видно'],
            'date'          => ['type' => 'string', 'description' => 'Дата чека в формате YYYY-MM-DD, "" если не видно'],
            'currency'      => ['type' => 'string', 'enum' => ['RSD', 'EUR', 'ILS', '']],
            'total'         => ['type' => 'number', 'description' => 'Итоговая сумма, 0 если не видно'],
            'category_hint' => ['type' => 'string', 'description' => 'Категория расхода одним словом по-русски'],
            'items' => [
                'type' => 'array',
                'items' => [
                    'type' => 'object',
                    'properties' => [
                        'name'  => ['type' => 'string'],
                        'qty'   => ['type' => 'number'],
                        'price' => ['type' => 'number'],
                        'total' => ['type' => 'number'],
                    ],
                    'required' => ['name', 'qty', 'price', 'total'],
                    'additionalProperties' => false,
                ],
            ],
        ],
        'required' => ['merchant', 'date', 'currency', 'total', 'category_hint', 'items'],
        'additionalProperties' => false,
    ];

    $system = <<<'TXT'
Ты разбираешь чеки из магазинов Сербии, Израиля и еврозоны.
Переноси названия товаров ровно так, как они напечатаны, ничего не додумывая.
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

    foreach ($resp['content'] ?? [] as $block) {
        if (($block['type'] ?? '') === 'text') {
            $parsed = json_decode((string)$block['text'], true);
            if (is_array($parsed)) {
                return ['ok' => true, 'receipt' => $parsed];
            }
        }
    }
    respond(502, ['error' => 'claude_unparsable']);
}
