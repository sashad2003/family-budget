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

const MAX_IMAGE_BYTES  = 5 * 1024 * 1024;   // 5 МБ на base64-картинку
const MAX_IMAGES       = 6;                 // длинный чек разрешаем снять частями
const MAX_IMAGES_BYTES = 12 * 1024 * 1024;  // суммарный потолок на все кадры
const MAX_PAGE_BYTES   = 512 * 1024;        // 512 КБ с чужой страницы
const MAX_PDF_BYTES    = 4 * 1024 * 1024;   // если по ссылке отдают PDF — шлём его целиком
const MAX_SMS_CHARS    = 2000;              // банковская SMS во много раз короче
const MAX_TOKENS      = 8000;

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
