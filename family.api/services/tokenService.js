const dbService = require('./dbService');
const { generateTokenSecret, hashTokenSecret } = require('./authService');

function toPublicToken(row) {
    // TokenSecret (salted hash) is never returned.
    return {
        TokenId: row.TokenId,
        Name: row.Name,
        IsAdmin: !!row.IsAdmin,
        HasWriteRights: !!row.HasWriteRights,
        Expires: row.Expires,
        FamilyIdGroupRights: row.FamilyIdGroupRights,
        IsDeleted: !!row.IsDeleted
    };
}

async function listTokens(includeDeleted = false) {
    const rows = await dbService.all(
        includeDeleted
            ? 'SELECT * FROM FamilyAccessTokens ORDER BY TokenId'
            : 'SELECT * FROM FamilyAccessTokens WHERE IsDeleted = 0 ORDER BY TokenId'
    );
    return rows.map(toPublicToken);
}

async function createToken({ name, isAdmin = false, hasWriteRights = false, expires = null, familyIdGroupRights = null }) {
    const secret = generateTokenSecret();
    const result = await dbService.run(
        `INSERT INTO FamilyAccessTokens (Name, TokenSecret, IsAdmin, HasWriteRights, Expires, FamilyIdGroupRights, IsDeleted)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [name, hashTokenSecret(secret), isAdmin ? 1 : 0, hasWriteRights ? 1 : 0, expires || null, familyIdGroupRights || null]
    );
    return { tokenId: result.lastID, tokenSecret: secret };
}

async function updateToken(tokenId, { name, isAdmin, hasWriteRights, expires, familyIdGroupRights }) {
    const existing = await dbService.get('SELECT * FROM FamilyAccessTokens WHERE TokenId = ? AND IsDeleted = 0', [tokenId]);
    if (!existing) return null;
    await dbService.run(
        `UPDATE FamilyAccessTokens
         SET Name = ?, IsAdmin = ?, HasWriteRights = ?, Expires = ?, FamilyIdGroupRights = ?
         WHERE TokenId = ?`,
        [
            name ?? existing.Name,
            (isAdmin ?? !!existing.IsAdmin) ? 1 : 0,
            (hasWriteRights ?? !!existing.HasWriteRights) ? 1 : 0,
            expires === undefined ? existing.Expires : (expires || null),
            familyIdGroupRights === undefined ? existing.FamilyIdGroupRights : (familyIdGroupRights || null),
            tokenId
        ]
    );
    const updated = await dbService.get('SELECT * FROM FamilyAccessTokens WHERE TokenId = ?', [tokenId]);
    return toPublicToken(updated);
}

// Regenerates the secret for an existing token (old secret stops working).
async function rotateTokenSecret(tokenId) {
    const existing = await dbService.get('SELECT * FROM FamilyAccessTokens WHERE TokenId = ? AND IsDeleted = 0', [tokenId]);
    if (!existing) return null;
    const secret = generateTokenSecret();
    await dbService.run('UPDATE FamilyAccessTokens SET TokenSecret = ? WHERE TokenId = ?', [hashTokenSecret(secret), tokenId]);
    return { tokenId, tokenSecret: secret };
}

async function deleteToken(tokenId) {
    const result = await dbService.run('UPDATE FamilyAccessTokens SET IsDeleted = 1 WHERE TokenId = ? AND IsDeleted = 0', [tokenId]);
    return result.changes > 0;
}

module.exports = { listTokens, createToken, updateToken, rotateTokenSecret, deleteToken };
