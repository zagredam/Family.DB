const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { loadConfig, resolveDbPath } = require('./configService');

let db = null;
const writeListeners = [];

function onWrite(listener) {
    writeListeners.push(listener);
}

function notifyWrite() {
    for (const listener of writeListeners) {
        try { listener(); } catch (ex) { console.error('write listener failed', ex); }
    }
}

function getDb() {
    if (!db) {
        const dbPath = resolveDbPath(loadConfig());
        if (!fs.existsSync(dbPath)) {
            throw new Error(
                `Database file not found: ${dbPath}. ` +
                'Run "npm run create-db" to create one, or fix FamilyDBFile in config.json.'
            );
        }
        db = new sqlite3.Database(dbPath);
    }
    return db;
}

function closeDb() {
    return new Promise((resolve) => {
        if (!db) return resolve();
        const toClose = db;
        db = null;
        toClose.close(() => resolve());
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, function (err) {
            if (err) return reject(err);
            notifyWrite();
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

const FAMILY_ACCESS_TOKENS_DDL = `
CREATE TABLE IF NOT EXISTS FamilyAccessTokens (
    TokenId              INTEGER PRIMARY KEY AUTOINCREMENT,
    Name                 TEXT NOT NULL,
    TokenSecret          TEXT NOT NULL,
    IsAdmin              INTEGER NOT NULL DEFAULT 0,
    HasWriteRights       INTEGER NOT NULL DEFAULT 0,
    Expires              TEXT,
    FamilyIdGroupRights  TEXT,
    IsDeleted            INTEGER NOT NULL DEFAULT 0
)`;

async function ensureSchema() {
    // Older DB files created by the web UI won't have the auth table yet.
    await run(FAMILY_ACCESS_TOKENS_DDL);
}

module.exports = { getDb, closeDb, all, get, run, onWrite, ensureSchema, FAMILY_ACCESS_TOKENS_DDL };
