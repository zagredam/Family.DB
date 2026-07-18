const dbService = require('./dbService');

// Mirrors family.web/src/SqliteService.ts so the API supports every operation
// the file-based web UI does.

// ── Family groups ────────────────────────────────────────────────────────────

function getFamilyOptions() {
    return dbService.all('SELECT FamilyGroupId, FamilyName, FamilyHeadId FROM FamilyGroup');
}

async function addFamilyGroup(name) {
    const result = await dbService.run('INSERT INTO FamilyGroup (FamilyName) VALUES (?)', [name]);
    return result.lastID;
}

function updateFamilyGroup(familyGroupId, name, headId) {
    return dbService.run('UPDATE FamilyGroup SET FamilyName=?, FamilyHeadId=? WHERE FamilyGroupId=?', [
        name, headId ?? null, familyGroupId
    ]);
}

// ── Family members ───────────────────────────────────────────────────────────

function getFamily(familyGroupId) {
    return dbService.all(`
        SELECT fm.FamilyMemberId, fm.FirstName, fm.MiddleName, fm.LastName,
               fm.BirthDate, fm.DeceasedDate, fm.Gender, fm.OriginCoupleId, fm.Description,
               fg2.FamilyGroupId as SecondFamilyId, fg2.FamilyName as SecondFamilyName
        FROM FamilyMember fm
        JOIN FamilyGroupAssociation fga ON fga.FamilyMemberId = fm.FamilyMemberId AND fga.FamilyGroupId = ?
        LEFT JOIN FamilyGroupAssociation fga2 ON fga2.FamilyMemberId = fm.FamilyMemberId AND fga2.FamilyGroupId <> ?
        LEFT JOIN FamilyGroup fg2 ON fg2.FamilyGroupId = fga2.FamilyGroupId
    `, [familyGroupId, familyGroupId]);
}

async function addFamilyMember(data, familyGroupId) {
    const result = await dbService.run(
        'INSERT INTO FamilyMember (FirstName, LastName, BirthDate, Gender, OriginCoupleId) VALUES (?, ?, ?, ?, ?)',
        [data.firstName, data.lastName, data.birthDate || null, data.gender, data.originCoupleId ?? null]
    );
    const newId = result.lastID;
    await dbService.run('INSERT INTO FamilyGroupAssociation (FamilyMemberId, FamilyGroupId) VALUES (?, ?)', [newId, familyGroupId]);
    const head = await dbService.get('SELECT FamilyHeadId FROM FamilyGroup WHERE FamilyGroupId = ?', [familyGroupId]);
    if (head && head.FamilyHeadId == null) {
        await dbService.run('UPDATE FamilyGroup SET FamilyHeadId=? WHERE FamilyGroupId=?', [newId, familyGroupId]);
    }
    return newId;
}

function updateFamilyMember(id, data) {
    return dbService.run(
        'UPDATE FamilyMember SET FirstName=?, MiddleName=?, LastName=?, BirthDate=?, Gender=?, DeceasedDate=?, Description=?, OriginCoupleId=? WHERE FamilyMemberId=?',
        [
            data.firstName, data.middleName || null, data.lastName, data.birthDate || null,
            data.gender, data.deceasedDate || null, data.description || null, data.originCoupleId ?? null, id
        ]
    );
}

function getMemberFamilyGroups(memberId) {
    return dbService.all(`
        SELECT fg.FamilyGroupId, fg.FamilyName
        FROM FamilyGroup fg
        JOIN FamilyGroupAssociation fga ON fga.FamilyGroupId = fg.FamilyGroupId
        WHERE fga.FamilyMemberId = ?
        ORDER BY fg.FamilyName
    `, [memberId]);
}

async function addMemberToFamilyGroup(memberId, familyGroupId) {
    const existing = await dbService.get(
        'SELECT 1 FROM FamilyGroupAssociation WHERE FamilyMemberId=? AND FamilyGroupId=?',
        [memberId, familyGroupId]
    );
    if (!existing) {
        await dbService.run('INSERT INTO FamilyGroupAssociation (FamilyMemberId, FamilyGroupId) VALUES (?, ?)', [memberId, familyGroupId]);
    }
}

function removeMemberFromFamilyGroup(memberId, familyGroupId) {
    return dbService.run('DELETE FROM FamilyGroupAssociation WHERE FamilyMemberId=? AND FamilyGroupId=?', [memberId, familyGroupId]);
}

// ── Couples ──────────────────────────────────────────────────────────────────

function getCouples() {
    return dbService.all(`
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

async function setCoupleAssociation(memberId, partnerId, relationshipType = 'Partner') {
    // Same couple (either ordering): update relationship type in place so
    // children's OriginCoupleId references stay valid.
    const exact = await dbService.get(`
        SELECT CoupleId FROM FamilyCouple
        WHERE (ParterFamilyMemberId = ? AND OtherPartnerFamilyMemberId = ?)
           OR (ParterFamilyMemberId = ? AND OtherPartnerFamilyMemberId = ?)
        LIMIT 1
    `, [memberId, partnerId, partnerId, memberId]);
    if (exact) {
        await dbService.run('UPDATE FamilyCouple SET RelationshipType=? WHERE CoupleId=?', [relationshipType, exact.CoupleId]);
        return exact.CoupleId;
    }
    await dbService.run(
        'DELETE FROM FamilyCouple WHERE ParterFamilyMemberId IN (?, ?) OR OtherPartnerFamilyMemberId IN (?, ?)',
        [memberId, partnerId, memberId, partnerId]
    );
    const result = await dbService.run(
        'INSERT INTO FamilyCouple (ParterFamilyMemberId, OtherPartnerFamilyMemberId, RelationshipType) VALUES (?,?,?)',
        [memberId, partnerId, relationshipType]
    );
    return result.lastID;
}

function removeCoupleAssociation(memberId) {
    return dbService.run(
        'DELETE FROM FamilyCouple WHERE ParterFamilyMemberId=? OR OtherPartnerFamilyMemberId=?',
        [memberId, memberId]
    );
}

// ── Attachments ──────────────────────────────────────────────────────────────

function getAttachments(memberId) {
    return dbService.all(
        'SELECT AttachmentId, Label, Url FROM FamilyMemberAttachment WHERE FamilyMemberId=? ORDER BY AttachmentId',
        [memberId]
    );
}

function getAttachment(attachmentId) {
    return dbService.get('SELECT AttachmentId, FamilyMemberId, Label, Url FROM FamilyMemberAttachment WHERE AttachmentId=?', [attachmentId]);
}

async function addAttachment(memberId, label, url) {
    const result = await dbService.run(
        'INSERT INTO FamilyMemberAttachment (FamilyMemberId, Label, Url) VALUES (?, ?, ?)',
        [memberId, label, url]
    );
    return result.lastID;
}

function updateAttachment(attachmentId, label, url) {
    return dbService.run('UPDATE FamilyMemberAttachment SET Label=?, Url=? WHERE AttachmentId=?', [label, url, attachmentId]);
}

function deleteAttachment(attachmentId) {
    return dbService.run('DELETE FROM FamilyMemberAttachment WHERE AttachmentId=?', [attachmentId]);
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function getTimeline(memberId) {
    return dbService.all(`
        SELECT TimelineId, DateOccurred, Description, DateModified
        FROM FamilyMemberTimeline
        WHERE FamilyMemberId=? AND IsDeleted=0
        ORDER BY DateOccurred ASC, TimelineId ASC
    `, [memberId]);
}

function getTimelineEntry(timelineId) {
    return dbService.get('SELECT TimelineId, FamilyMemberId, DateOccurred, Description FROM FamilyMemberTimeline WHERE TimelineId=? AND IsDeleted=0', [timelineId]);
}

async function addTimelineEntry(memberId, dateOccurred, description) {
    const result = await dbService.run(
        'INSERT INTO FamilyMemberTimeline (FamilyMemberId, DateOccurred, Description, IsDeleted, DateModified) VALUES (?,?,?,0,?)',
        [memberId, dateOccurred || null, description, new Date().toISOString()]
    );
    return result.lastID;
}

function updateTimelineEntry(timelineId, dateOccurred, description) {
    return dbService.run(
        'UPDATE FamilyMemberTimeline SET DateOccurred=?, Description=?, DateModified=? WHERE TimelineId=?',
        [dateOccurred || null, description, new Date().toISOString(), timelineId]
    );
}

function deleteTimelineEntry(timelineId) {
    return dbService.run(
        'UPDATE FamilyMemberTimeline SET IsDeleted=1, DateModified=? WHERE TimelineId=?',
        [new Date().toISOString(), timelineId]
    );
}

module.exports = {
    getFamilyOptions,
    addFamilyGroup,
    updateFamilyGroup,
    getFamily,
    addFamilyMember,
    updateFamilyMember,
    getMemberFamilyGroups,
    addMemberToFamilyGroup,
    removeMemberFromFamilyGroup,
    getCouples,
    setCoupleAssociation,
    removeCoupleAssociation,
    getAttachments,
    getAttachment,
    addAttachment,
    updateAttachment,
    deleteAttachment,
    getTimeline,
    getTimelineEntry,
    addTimelineEntry,
    updateTimelineEntry,
    deleteTimelineEntry
};
