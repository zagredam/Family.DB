const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
    FamilyDBFile: './familytree.db',
    Port: 3001,
    Auth: {
        JwtSecret: '',
        AccessTokenMinutes: 30,
        RefreshTokenDays: 14
    },
    S3: {
        Enabled: false,
        Bucket: '',
        Region: 'us-east-1',
        Key: 'familytree.db',
        Endpoint: '',
        AccessKeyId: '',
        SecretAccessKey: '',
        UploadDebounceMs: 5000
    }
};

let cached = null;

function loadConfig() {
    if (cached) return cached;
    let fromDisk = {};
    if (fs.existsSync(CONFIG_PATH)) {
        fromDisk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
    cached = {
        ...DEFAULTS,
        ...fromDisk,
        Auth: { ...DEFAULTS.Auth, ...(fromDisk.Auth || {}) },
        S3: { ...DEFAULTS.S3, ...(fromDisk.S3 || {}) }
    };

    // A JWT secret is required to sign tokens. Generate one on first boot and
    // persist it so restarts don't invalidate every session.
    if (!cached.Auth.JwtSecret) {
        cached.Auth.JwtSecret = crypto.randomBytes(48).toString('base64url');
        saveConfig(cached);
    }
    return cached;
}

function saveConfig(config) {
    cached = config;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4) + '\n');
}

function resolveDbPath(config) {
    const p = (config || loadConfig()).FamilyDBFile;
    return path.isAbsolute(p) ? p : path.join(__dirname, '..', p);
}

module.exports = { loadConfig, saveConfig, resolveDbPath, CONFIG_PATH };
