#!/usr/bin/env node
/**
 * Interactive first-run setup for the Family API.
 *
 * 1. Prompts for the initial family name (and optional file path / admin token name).
 * 2. Creates the SQLite file with the full schema and the first FamilyGroup.
 * 3. Creates an admin access token and prints its secret (shown only once).
 * 4. Points config.json's FamilyDBFile at the new file.
 *
 * Usage: npm run create-db   (from family.api/)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const { loadConfig, saveConfig, CONFIG_PATH } = require('../services/configService');
const { generateTokenSecret, hashTokenSecret } = require('../services/authService');
const { FAMILY_ACCESS_TOKENS_DDL } = require('../services/dbService');

// A plain rl.question() loses buffered lines when input is piped in
// (e.g. from a heredoc), so queue line events instead.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pendingLines = [];
const waiters = [];
let stdinClosed = false;
rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else pendingLines.push(line);
});
rl.on('close', () => {
    stdinClosed = true;
    while (waiters.length) waiters.shift()('');
});

function ask(question) {
    process.stdout.write(question);
    if (pendingLines.length) return Promise.resolve(pendingLines.shift().trim());
    if (stdinClosed) return Promise.resolve('');
    return new Promise((resolve) => waiters.push((line) => resolve(line.trim())));
}

const SCHEMA = [
    `CREATE TABLE FamilyMember (
        FamilyMemberId INTEGER UNIQUE,
        FirstName TEXT, MiddleName TEXT, LastName TEXT,
        BirthDate TEXT, DeceasedDate TEXT,
        Gender TEXT, OriginCoupleId INTEGER, Description TEXT,
        PRIMARY KEY(FamilyMemberId AUTOINCREMENT)
    )`,
    `CREATE TABLE FamilyGroup (
        FamilyGroupId INTEGER NOT NULL UNIQUE,
        FamilyName TEXT NOT NULL,
        FamilyHeadId INTEGER,
        PRIMARY KEY(FamilyGroupId AUTOINCREMENT)
    )`,
    `CREATE TABLE FamilyGroupAssociation (
        FamilyGroupId INTEGER NOT NULL,
        FamilyMemberId INTEGER NOT NULL
    )`,
    `CREATE TABLE FamilyCouple (
        CoupleId INTEGER PRIMARY KEY AUTOINCREMENT,
        ParterFamilyMemberId INTEGER,
        OtherPartnerFamilyMemberId INTEGER,
        StartDate TEXT, EndDate TEXT,
        RelationshipType TEXT NOT NULL DEFAULT 'Partner'
    )`,
    `CREATE TABLE FamilyMemberAttachment (
        AttachmentId   INTEGER PRIMARY KEY AUTOINCREMENT,
        FamilyMemberId INTEGER NOT NULL,
        Label          TEXT NOT NULL,
        Url            TEXT NOT NULL
    )`,
    `CREATE TABLE FamilyMemberTimeline (
        TimelineId     INTEGER PRIMARY KEY AUTOINCREMENT,
        FamilyMemberId INTEGER NOT NULL,
        DateOccurred   TEXT,
        Description    TEXT,
        IsDeleted      INTEGER NOT NULL DEFAULT 0,
        DateModified   TEXT
    )`,
    FAMILY_ACCESS_TOKENS_DDL
];

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ lastID: this.lastID });
        });
    });
}

async function main() {
    console.log('── Family DB setup ──────────────────────────────');

    let familyName = '';
    while (!familyName) {
        familyName = await ask('Initial family name (e.g. Smith): ');
        if (!familyName) console.log('A family name is required.');
    }

    const defaultPath = './familytree.db';
    const filePathInput = (await ask(`Database file path [${defaultPath}]: `)) || defaultPath;
    const absolutePath = path.isAbsolute(filePathInput)
        ? filePathInput
        : path.join(__dirname, '..', filePathInput);

    if (fs.existsSync(absolutePath)) {
        const overwrite = (await ask(`${absolutePath} already exists. Overwrite? [y/N]: `)).toLowerCase();
        if (overwrite !== 'y' && overwrite !== 'yes') {
            console.log('Aborted — existing file left untouched.');
            rl.close();
            return;
        }
        fs.unlinkSync(absolutePath);
    }

    const adminName = (await ask('Admin token name [Admin]: ')) || 'Admin';
    rl.close();

    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const db = new sqlite3.Database(absolutePath);

    for (const ddl of SCHEMA) {
        await run(db, ddl);
    }
    await run(db, 'INSERT INTO FamilyGroup (FamilyName) VALUES (?)', [familyName]);

    const adminSecret = generateTokenSecret();
    await run(db,
        `INSERT INTO FamilyAccessTokens (Name, TokenSecret, IsAdmin, HasWriteRights, Expires, FamilyIdGroupRights, IsDeleted)
         VALUES (?, ?, 1, 1, NULL, NULL, 0)`,
        [adminName, hashTokenSecret(adminSecret)]
    );

    await new Promise((resolve) => db.close(resolve));

    const config = loadConfig();
    config.FamilyDBFile = filePathInput;
    saveConfig(config);

    console.log('');
    console.log('─────────────────────────────────────────────────');
    console.log(`Database created:  ${absolutePath}`);
    console.log(`Family group:      ${familyName}`);
    console.log(`Config updated:    ${CONFIG_PATH} (FamilyDBFile -> ${filePathInput})`);
    console.log('');
    console.log(`Admin access token (${adminName}) — SAVE THIS NOW, it will not be shown again:`);
    console.log('');
    console.log(`    ${adminSecret}`);
    console.log('');
    console.log('Use it to log in from the web app in API mode, then create');
    console.log('additional tokens for other users from the Tokens page.');
    console.log('─────────────────────────────────────────────────');
}

main().catch((ex) => {
    console.error('Setup failed:', ex.message);
    process.exit(1);
});
