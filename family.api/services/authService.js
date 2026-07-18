const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { loadConfig } = require('./configService');
const dbService = require('./dbService');

// ── Token secret hashing ─────────────────────────────────────────────────────
// Stored TokenSecret format: "<salt>$<sha256(salt + secret) hex>"

function generateTokenSecret() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashTokenSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.createHash('sha256').update(salt + secret).digest('hex');
    return `${salt}$${hash}`;
}

function verifyTokenSecret(secret, stored) {
    const [salt, hash] = String(stored).split('$');
    if (!salt || !hash) return false;
    const candidate = crypto.createHash('sha256').update(salt + secret).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

// ── Access token rows ────────────────────────────────────────────────────────

function isExpired(row) {
    return !!row.Expires && new Date(row.Expires).getTime() <= Date.now();
}

async function findActiveTokenBySecret(secret) {
    const rows = await dbService.all('SELECT * FROM FamilyAccessTokens WHERE IsDeleted = 0');
    return rows.find(r => !isExpired(r) && verifyTokenSecret(secret, r.TokenSecret)) || null;
}

async function findActiveTokenById(tokenId) {
    const row = await dbService.get('SELECT * FROM FamilyAccessTokens WHERE TokenId = ? AND IsDeleted = 0', [tokenId]);
    return row && !isExpired(row) ? row : null;
}

// ── Group rights ─────────────────────────────────────────────────────────────
// FamilyIdGroupRights is a comma separated list of FamilyGroupIds.
// Empty / null / "*" means access to every family group.

function parseGroupRights(value) {
    const raw = (value ?? '').trim();
    if (!raw || raw === '*') return null; // null = unrestricted
    return raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n));
}

function canAccessGroup(auth, familyGroupId) {
    if (auth.isAdmin || auth.groupRights === null) return true;
    return auth.groupRights.includes(Number(familyGroupId));
}

// ── JWT issue / verify ───────────────────────────────────────────────────────

function buildAuthContext(row) {
    return {
        tokenId: row.TokenId,
        name: row.Name,
        isAdmin: !!row.IsAdmin,
        hasWriteRights: !!row.HasWriteRights || !!row.IsAdmin,
        groupRights: parseGroupRights(row.FamilyIdGroupRights)
    };
}

function issueTokenPair(row) {
    const config = loadConfig();
    const auth = buildAuthContext(row);
    const accessExpiresSeconds = config.Auth.AccessTokenMinutes * 60;
    const accessToken = jwt.sign(
        {
            typ: 'access',
            name: auth.name,
            adm: auth.isAdmin,
            wrt: auth.hasWriteRights,
            grp: auth.groupRights === null ? '*' : auth.groupRights.join(',')
        },
        config.Auth.JwtSecret,
        { subject: String(row.TokenId), expiresIn: accessExpiresSeconds }
    );
    const refreshToken = jwt.sign(
        { typ: 'refresh' },
        config.Auth.JwtSecret,
        { subject: String(row.TokenId), expiresIn: `${config.Auth.RefreshTokenDays}d` }
    );
    return {
        accessToken,
        refreshToken,
        expiresInSeconds: accessExpiresSeconds,
        tokenName: auth.name,
        isAdmin: auth.isAdmin,
        hasWriteRights: auth.hasWriteRights,
        familyIdGroupRights: auth.groupRights === null ? '*' : auth.groupRights.join(',')
    };
}

async function login(tokenSecret) {
    if (!tokenSecret) return null;
    const row = await findActiveTokenBySecret(tokenSecret);
    return row ? issueTokenPair(row) : null;
}

async function refresh(refreshToken) {
    const config = loadConfig();
    let payload;
    try {
        payload = jwt.verify(refreshToken, config.Auth.JwtSecret);
    } catch {
        return null;
    }
    if (payload.typ !== 'refresh') return null;
    // Re-load the token row so revocation (IsDeleted) and expiry are honored
    // and flag changes take effect on the next refresh.
    const row = await findActiveTokenById(Number(payload.sub));
    return row ? issueTokenPair(row) : null;
}

// ── Express middleware ───────────────────────────────────────────────────────

function authenticate(req, res, next) {
    const config = loadConfig();
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Missing bearer token', code: 'NO_TOKEN' });
    }
    let payload;
    try {
        payload = jwt.verify(token, config.Auth.JwtSecret);
    } catch (ex) {
        const code = ex.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
        return res.status(401).json({ error: 'Invalid or expired token', code });
    }
    if (payload.typ !== 'access') {
        return res.status(401).json({ error: 'Not an access token', code: 'TOKEN_INVALID' });
    }
    req.auth = {
        tokenId: Number(payload.sub),
        name: payload.name,
        isAdmin: !!payload.adm,
        hasWriteRights: !!payload.wrt,
        groupRights: parseGroupRights(payload.grp)
    };
    next();
}

function requireWrite(req, res, next) {
    if (!req.auth?.hasWriteRights) {
        return res.status(403).json({ error: 'Write access required', code: 'NO_WRITE_RIGHTS' });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.auth?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required', code: 'NOT_ADMIN' });
    }
    next();
}

// Verifies the member is reachable through at least one family group the
// caller is allowed to see. Unrestricted tokens skip the DB check.
async function canAccessMember(auth, memberId) {
    if (auth.isAdmin || auth.groupRights === null) return true;
    if (!auth.groupRights.length) return false;
    const placeholders = auth.groupRights.map(() => '?').join(',');
    const row = await dbService.get(
        `SELECT 1 FROM FamilyGroupAssociation WHERE FamilyMemberId = ? AND FamilyGroupId IN (${placeholders})`,
        [memberId, ...auth.groupRights]
    );
    return !!row;
}

module.exports = {
    generateTokenSecret,
    hashTokenSecret,
    verifyTokenSecret,
    parseGroupRights,
    canAccessGroup,
    canAccessMember,
    login,
    refresh,
    authenticate,
    requireWrite,
    requireAdmin
};
