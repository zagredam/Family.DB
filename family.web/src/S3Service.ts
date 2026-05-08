export type S3Config = {
    Endpoint: string;
    BucketName: string;
    AccessKey: string;
    SecretKey: string;
    Region: string;
};

// ── Crypto helpers ──────────────────────────────────────────────────────────

async function sha256Hex(message: string): Promise<string> {
    const data = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return toHex(hash);
}

async function hmacSha256(keyData: ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
}

function toHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function getAmzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
}

function getDateStamp(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

async function deriveSigningKey(
    secretKey: string,
    dateStamp: string,
    region: string,
    service: string
): Promise<ArrayBuffer> {
    const kSecret = new TextEncoder().encode('AWS4' + secretKey);
    const kDate = await hmacSha256(kSecret, dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    return hmacSha256(kService, 'aws4_request');
}

function encodeS3Key(key: string): string {
    return key.split('/').map(part => encodeURIComponent(part)).join('/');
}

// ── Presigned URL builder ───────────────────────────────────────────────────

async function createPresignedUrl(
    config: S3Config,
    method: 'GET' | 'PUT',
    key: string,
    expiresIn: number
): Promise<string> {
    const { Endpoint, BucketName, AccessKey, SecretKey, Region } = config;
    const service = 's3';
    const now = new Date();
    const amzDate = getAmzDate(now);
    const dateStamp = getDateStamp(now);

    const endpointUrl = new URL(Endpoint.replace(/\/$/, ''));
    const host = endpointUrl.host;
    const pathPrefix = endpointUrl.pathname === '/' ? '' : endpointUrl.pathname.replace(/\/$/, '');
    const encodedKey = encodeS3Key(key);
    const canonicalPath = `${pathPrefix}/${BucketName}/${encodedKey}`;

    const credentialScope = `${dateStamp}/${Region}/${service}/aws4_request`;
    const credential = `${AccessKey}/${credentialScope}`;

    // Query params must be sorted alphabetically
    const rawParams: [string, string][] = [
        ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
        ['X-Amz-Credential', credential],
        ['X-Amz-Date', amzDate],
        ['X-Amz-Expires', String(expiresIn)],
        ['X-Amz-SignedHeaders', 'host'],
    ];
    rawParams.sort((a, b) => a[0].localeCompare(b[0]));

    const canonicalQueryString = rawParams
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const canonicalRequest = [
        method,
        canonicalPath,
        canonicalQueryString,
        `host:${host}\n`,
        'host',
        'UNSIGNED-PAYLOAD',
    ].join('\n');

    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        canonicalRequestHash,
    ].join('\n');

    const signingKey = await deriveSigningKey(SecretKey, dateStamp, Region, service);
    const signatureHex = toHex(await hmacSha256(signingKey, stringToSign));

    return `${endpointUrl.origin}${canonicalPath}?${canonicalQueryString}&X-Amz-Signature=${signatureHex}`;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function uploadToS3(
    config: S3Config,
    file: File,
    prefix = 'attachments'
): Promise<string> {
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}/${Date.now()}-${sanitized}`;
    const presignedUrl = await createPresignedUrl(config, 'PUT', key, 900);

    const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: file,
        headers: {
            'Content-Type': file.type || 'application/octet-stream',
        },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Upload failed (${response.status}): ${body || response.statusText}`);
    }

    return key;
}

export async function getSignedUrl(
    config: S3Config,
    key: string,
    expiresIn = 3600
): Promise<string> {
    return createPresignedUrl(config, 'GET', key, expiresIn);
}

export function isImageKey(urlOrKey: string): boolean {
    const lower = urlOrKey.toLowerCase().split('?')[0];
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/.test(lower);
}
