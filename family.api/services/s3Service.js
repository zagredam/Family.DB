const fs = require('fs');
const { loadConfig, resolveDbPath } = require('./configService');

// Keeps the SQLite file mirrored in S3 so the data lives somewhere durable:
//  - on startup, pull the latest copy down (if one exists)
//  - after any write, push the file back up (debounced so bursts of writes
//    produce a single upload)

let client = null;
let uploadTimer = null;
let uploading = false;
let pendingUpload = false;

function s3Config() {
    return loadConfig().S3 || {};
}

function isEnabled() {
    const cfg = s3Config();
    return !!cfg.Enabled && !!cfg.Bucket;
}

function getClient() {
    if (!client) {
        const { S3Client } = require('@aws-sdk/client-s3');
        const cfg = s3Config();
        client = new S3Client({
            region: cfg.Region || 'us-east-1',
            ...(cfg.Endpoint ? { endpoint: cfg.Endpoint, forcePathStyle: true } : {}),
            ...(cfg.AccessKeyId && cfg.SecretAccessKey
                ? { credentials: { accessKeyId: cfg.AccessKeyId, secretAccessKey: cfg.SecretAccessKey } }
                : {}) // otherwise fall back to the default AWS credential chain
        });
    }
    return client;
}

async function downloadDbIfAvailable() {
    if (!isEnabled()) return false;
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const cfg = s3Config();
    const dbPath = resolveDbPath();
    try {
        const response = await getClient().send(new GetObjectCommand({ Bucket: cfg.Bucket, Key: cfg.Key }));
        const bytes = Buffer.from(await response.Body.transformToByteArray());
        fs.writeFileSync(dbPath, bytes);
        console.log(`[s3] downloaded s3://${cfg.Bucket}/${cfg.Key} -> ${dbPath} (${bytes.length} bytes)`);
        return true;
    } catch (ex) {
        if (ex.name === 'NoSuchKey' || ex.$metadata?.httpStatusCode === 404) {
            console.log(`[s3] no object at s3://${cfg.Bucket}/${cfg.Key} yet — using local file`);
            return false;
        }
        throw ex;
    }
}

async function uploadDb() {
    if (!isEnabled()) return;
    if (uploading) {
        pendingUpload = true;
        return;
    }
    uploading = true;
    try {
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const cfg = s3Config();
        const dbPath = resolveDbPath();
        const bytes = fs.readFileSync(dbPath);
        await getClient().send(new PutObjectCommand({
            Bucket: cfg.Bucket,
            Key: cfg.Key,
            Body: bytes,
            ContentType: 'application/x-sqlite3'
        }));
        console.log(`[s3] uploaded ${dbPath} -> s3://${cfg.Bucket}/${cfg.Key} (${bytes.length} bytes)`);
    } catch (ex) {
        console.error('[s3] upload failed:', ex.message);
    } finally {
        uploading = false;
        if (pendingUpload) {
            pendingUpload = false;
            scheduleUpload();
        }
    }
}

function scheduleUpload() {
    if (!isEnabled()) return;
    const debounce = s3Config().UploadDebounceMs ?? 5000;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(uploadDb, debounce);
}

module.exports = { isEnabled, downloadDbIfAvailable, scheduleUpload, uploadDb };
