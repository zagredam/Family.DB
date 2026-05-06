import type { Database, SqlJsStatic } from 'sql.js';
import type { CoupleRelationshipType } from './tree/types';

type SqlValue = number | string | Uint8Array | null;
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let SQL: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
    if (!SQL) {
        const initSqlJs = (await import('sql.js')).default;
        SQL = await initSqlJs({
            locateFile: () => sqlWasmUrl
        });
    }
    return SQL;
}

export async function loadDatabase(file: File): Promise<Database> {
    const sql = await getSql();
    const buffer = await file.arrayBuffer();
    return new sql.Database(new Uint8Array(buffer));
}

export function exportDatabase(db: Database): Uint8Array {
    return db.export();
}

type Row = Record<string, unknown>;

function execToRows(db: Database, sql: string): Row[] {
    const result = db.exec(sql);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row: SqlValue[]) =>
        Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]]))
    );
}

export function queryFamilyOptions(db: Database): Row[] {
    return execToRows(db, 'SELECT FamilyGroupId, FamilyName, FamilyHeadId FROM FamilyGroup');
}

export function queryFamily(db: Database, familyGroupId: number): Row[] {
    return execToRows(db, `
        SELECT fm.FamilyMemberId, fm.FirstName, fm.MiddleName, fm.LastName,
               fm.BirthDate, fm.DeceasedDate, fm.Gender, fm.OriginCoupleId, fm.Description,
               fg2.FamilyGroupId as SecondFamilyId, fg2.FamilyName as SecondFamilyName
        FROM FamilyMember fm
        JOIN familygroupassociation fga ON fga.familymemberid=fm.familymemberid AND fga.familygroupid=${familyGroupId}
        LEFT JOIN familygroupassociation fga2 ON fga2.familymemberid=fm.familymemberid AND fga2.familygroupid<>${familyGroupId}
        LEFT JOIN familygroup fg2 ON fg2.familygroupid=fga2.familygroupid
    `);
}

export function updateFamilyMember(
    db: Database,
    id: number,
    data: { firstName: string; middleName: string; lastName: string; birthDate: string; gender: string; deceasedDate: string; description: string; originCoupleId: number | null }
): void {
    db.run(
        'UPDATE FamilyMember SET FirstName=?, MiddleName=?, LastName=?, BirthDate=?, Gender=?, DeceasedDate=?, Description=?, OriginCoupleId=? WHERE FamilyMemberId=?',
        [data.firstName, data.middleName || null, data.lastName, data.birthDate || null, data.gender, data.deceasedDate || null, data.description || null, data.originCoupleId ?? null, id]
    );
}

export function queryCouples(db: Database): Row[] {
    return execToRows(db, `
        SELECT fc.CoupleId,
               fc.ParterFamilyMemberId,
               fc.OtherPartnerFamilyMemberId,
               fc.RelationshipType,
               fm1.FirstName || ' ' || fm1.LastName AS PartnerName,
               fm2.FirstName || ' ' || fm2.LastName AS OtherPartnerName
        FROM FamilyCouple fc
        JOIN FamilyMember fm1 ON fm1.FamilyMemberId = fc.ParterFamilyMemberId
        JOIN FamilyMember fm2 ON fm2.FamilyMemberId = fc.OtherPartnerFamilyMemberId
        ORDER BY fc.CoupleId
    `);
}

const LS_KEY = 'family_tree_db';

export function saveDbToLocalStorage(db: Database): void {
    try {
        const data = db.export();
        let binary = '';
        for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
        localStorage.setItem(LS_KEY, btoa(binary));
    } catch {
        // quota exceeded or unavailable
    }
}

export function addFamilyMember(
    db: Database,
    data: { firstName: string; lastName: string; birthDate?: string | null; gender: string; originCoupleId?: number | null },
    familyGroupId: number
): number {
    db.run('INSERT INTO FamilyMember (FirstName, LastName, BirthDate, Gender, OriginCoupleId) VALUES (?, ?, ?, ?, ?)', [
        data.firstName, data.lastName, data.birthDate || null, data.gender, data.originCoupleId ?? null
    ]);
    const result = db.exec('SELECT last_insert_rowid()');
    const newId = result[0].values[0][0] as number;
    db.run('INSERT INTO FamilyGroupAssociation (FamilyMemberId, FamilyGroupId) VALUES (?, ?)', [newId, familyGroupId]);
    const headCheck = db.exec(`SELECT FamilyHeadId FROM FamilyGroup WHERE FamilyGroupId=${familyGroupId}`);
    if (headCheck.length > 0 && headCheck[0].values[0]?.[0] == null) {
        db.run('UPDATE FamilyGroup SET FamilyHeadId=? WHERE FamilyGroupId=?', [newId, familyGroupId]);
    }
    return newId;
}

export function queryMemberFamilyGroups(db: Database, memberId: number): Row[] {
    return execToRows(db, `
        SELECT fg.FamilyGroupId, fg.FamilyName
        FROM FamilyGroup fg
        JOIN FamilyGroupAssociation fga ON fga.FamilyGroupId = fg.FamilyGroupId
        WHERE fga.FamilyMemberId = ${memberId}
        ORDER BY fg.FamilyName
    `);
}

export function addMemberToFamilyGroup(db: Database, memberId: number, familyGroupId: number): void {
    const existing = db.exec(`SELECT 1 FROM FamilyGroupAssociation WHERE FamilyMemberId=${memberId} AND FamilyGroupId=${familyGroupId}`);
    if (!existing.length || !existing[0].values.length) {
        db.run('INSERT INTO FamilyGroupAssociation (FamilyMemberId, FamilyGroupId) VALUES (?, ?)', [memberId, familyGroupId]);
    }
}

export function removeMemberFromFamilyGroup(db: Database, memberId: number, familyGroupId: number): void {
    db.run('DELETE FROM FamilyGroupAssociation WHERE FamilyMemberId=? AND FamilyGroupId=?', [memberId, familyGroupId]);
}

export function addFamilyGroup(db: Database, name: string): number {
    db.run('INSERT INTO FamilyGroup (FamilyName) VALUES (?)', [name]);
    const result = db.exec('SELECT last_insert_rowid()');
    return result[0].values[0][0] as number;
}

export async function createNewDatabase(familyName: string): Promise<Database> {
    const sql = await getSql();
    const db = new sql.Database();
    db.run(`CREATE TABLE FamilyMember (
        FamilyMemberId INTEGER UNIQUE,
        FirstName TEXT, MiddleName TEXT, LastName TEXT,
        BirthDate TEXT, DeceasedDate TEXT,
        Gender TEXT, OriginCoupleId INTEGER, Description TEXT,
        PRIMARY KEY(FamilyMemberId AUTOINCREMENT)
    )`);
    db.run(`CREATE TABLE FamilyGroup (
        FamilyGroupId INTEGER NOT NULL UNIQUE,
        FamilyName TEXT NOT NULL,
        FamilyHeadId INTEGER,
        PRIMARY KEY(FamilyGroupId AUTOINCREMENT)
    )`);
    db.run(`CREATE TABLE FamilyGroupAssociation (
        FamilyGroupId INTEGER NOT NULL,
        FamilyMemberId INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE FamilyCouple (
        CoupleId INTEGER PRIMARY KEY AUTOINCREMENT,
        ParterFamilyMemberId INTEGER,
        OtherPartnerFamilyMemberId INTEGER,
        StartDate TEXT, EndDate TEXT,
        RelationshipType TEXT NOT NULL DEFAULT 'Partner'
    )`);
    db.run(`CREATE TABLE FamilyMemberAttachment (
        AttachmentId   INTEGER PRIMARY KEY AUTOINCREMENT,
        FamilyMemberId INTEGER NOT NULL,
        Label          TEXT NOT NULL,
        Url            TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE FamilyMemberTimeline (
        TimelineId     INTEGER PRIMARY KEY AUTOINCREMENT,
        FamilyMemberId INTEGER NOT NULL,
        DateOccurred   TEXT,
        Description    TEXT,
        IsDeleted      INTEGER NOT NULL DEFAULT 0,
        DateModified   TEXT
    )`);
    db.run('INSERT INTO FamilyGroup (FamilyName) VALUES (?)', [familyName]);
    return db;
}

export function setCoupleAssociation(db: Database, memberId: number, partnerId: number, relationshipType: CoupleRelationshipType = 'Partner'): void {
    // If this exact couple already exists (either ordering), just update the relationship type in place
    // so children's OriginCoupleId references stay valid.
    const exact = db.exec(`
        SELECT CoupleId FROM FamilyCouple
        WHERE (ParterFamilyMemberId = ${memberId} AND OtherPartnerFamilyMemberId = ${partnerId})
           OR (ParterFamilyMemberId = ${partnerId} AND OtherPartnerFamilyMemberId = ${memberId})
        LIMIT 1
    `);
    if (exact.length > 0 && exact[0].values.length > 0) {
        const coupleId = exact[0].values[0][0] as number;
        db.run('UPDATE FamilyCouple SET RelationshipType=? WHERE CoupleId=?', [relationshipType, coupleId]);
        return;
    }

    // Wipe any stale couple records for both members so no ghost associations remain.
    db.run(
        'DELETE FROM FamilyCouple WHERE ParterFamilyMemberId IN (?, ?) OR OtherPartnerFamilyMemberId IN (?, ?)',
        [memberId, partnerId, memberId, partnerId]
    );
    db.run(
        'INSERT INTO FamilyCouple (ParterFamilyMemberId, OtherPartnerFamilyMemberId, RelationshipType) VALUES (?,?,?)',
        [memberId, partnerId, relationshipType]
    );
}

export function removeCoupleAssociation(db: Database, memberId: number): void {
    db.run(
        'DELETE FROM FamilyCouple WHERE ParterFamilyMemberId=? OR OtherPartnerFamilyMemberId=?',
        [memberId, memberId]
    );
}

export function queryAttachments(db: Database, memberId: number): Row[] {
    return execToRows(db, `SELECT AttachmentId, Label, Url FROM FamilyMemberAttachment WHERE FamilyMemberId=${memberId} ORDER BY AttachmentId`);
}

export function addAttachment(db: Database, memberId: number, label: string, url: string): void {
    db.run('INSERT INTO FamilyMemberAttachment (FamilyMemberId, Label, Url) VALUES (?, ?, ?)', [memberId, label, url]);
}

export function updateAttachment(db: Database, id: number, label: string, url: string): void {
    db.run('UPDATE FamilyMemberAttachment SET Label=?, Url=? WHERE AttachmentId=?', [label, url, id]);
}

export function deleteAttachment(db: Database, id: number): void {
    db.run('DELETE FROM FamilyMemberAttachment WHERE AttachmentId=?', [id]);
}

export function queryTimeline(db: Database, memberId: number): Row[] {
    return execToRows(db, `
        SELECT TimelineId, DateOccurred, Description, DateModified
        FROM FamilyMemberTimeline
        WHERE FamilyMemberId=${memberId} AND IsDeleted=0
        ORDER BY DateOccurred ASC, TimelineId ASC
    `);
}

export function addTimelineEntry(db: Database, memberId: number, dateOccurred: string, description: string): void {
    const now = new Date().toISOString();
    db.run(
        'INSERT INTO FamilyMemberTimeline (FamilyMemberId, DateOccurred, Description, IsDeleted, DateModified) VALUES (?,?,?,0,?)',
        [memberId, dateOccurred || null, description, now]
    );
}

export function updateTimelineEntry(db: Database, id: number, dateOccurred: string, description: string): void {
    const now = new Date().toISOString();
    db.run(
        'UPDATE FamilyMemberTimeline SET DateOccurred=?, Description=?, DateModified=? WHERE TimelineId=?',
        [dateOccurred || null, description, now, id]
    );
}

export function deleteTimelineEntry(db: Database, id: number): void {
    const now = new Date().toISOString();
    db.run(
        'UPDATE FamilyMemberTimeline SET IsDeleted=1, DateModified=? WHERE TimelineId=?',
        [now, id]
    );
}

export async function loadDbFromLocalStorage(): Promise<Database | null> {
    const stored = localStorage.getItem(LS_KEY);
    if (!stored) return null;
    try {
        const sql = await getSql();
        const binary = atob(stored);
        const data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
        return new sql.Database(data);
    } catch {
        return null;
    }
}
