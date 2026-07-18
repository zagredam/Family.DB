const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./services/configService');
const dbService = require('./services/dbService');
const authService = require('./services/authService');
const familyService = require('./services/familyService');
const tokenService = require('./services/tokenService');
const s3Service = require('./services/s3Service');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// Wraps async route handlers so rejections become 500s instead of hanging.
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const badRequest = (res, message) => res.status(400).json({ error: message, code: 'BAD_REQUEST' });
const forbiddenGroup = (res) => res.status(403).json({ error: 'No access to this family group', code: 'NO_GROUP_ACCESS' });
const forbiddenMember = (res) => res.status(403).json({ error: 'No access to this family member', code: 'NO_MEMBER_ACCESS' });

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post('/auth/login', wrap(async (req, res) => {
    const tokenSecret = req.body?.token ?? req.body?.tokenSecret;
    if (!tokenSecret) return badRequest(res, 'Missing "token" in body');
    const session = await authService.login(tokenSecret);
    if (!session) return res.status(401).json({ error: 'Invalid or expired access token', code: 'LOGIN_FAILED' });
    res.json(session);
}));

app.post('/auth/refresh', wrap(async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) return badRequest(res, 'Missing "refreshToken" in body');
    const session = await authService.refresh(refreshToken);
    if (!session) return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'REFRESH_FAILED' });
    res.json(session);
}));

// Everything below requires a valid access token.
app.use(authService.authenticate);

app.get('/auth/me', (req, res) => {
    res.json({
        tokenId: req.auth.tokenId,
        tokenName: req.auth.name,
        isAdmin: req.auth.isAdmin,
        hasWriteRights: req.auth.hasWriteRights,
        familyIdGroupRights: req.auth.groupRights === null ? '*' : req.auth.groupRights.join(',')
    });
});

// ── Family groups ────────────────────────────────────────────────────────────

app.get('/family/options', wrap(async (req, res) => {
    const options = await familyService.getFamilyOptions();
    const visible = options.filter(o => authService.canAccessGroup(req.auth, o.FamilyGroupId));
    res.json({ FamilyGroups: visible, WritePermission: req.auth.hasWriteRights });
}));

app.post('/family/groups', authService.requireWrite, wrap(async (req, res) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) return badRequest(res, 'Missing "name"');
    if (req.auth.groupRights !== null && !req.auth.isAdmin) {
        return res.status(403).json({ error: 'Only tokens with unrestricted group rights can create family groups', code: 'NO_GROUP_ACCESS' });
    }
    const familyGroupId = await familyService.addFamilyGroup(name);
    res.status(201).json({ FamilyGroupId: familyGroupId });
}));

app.put('/family/groups/:id', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!authService.canAccessGroup(req.auth, id)) return forbiddenGroup(res);
    const name = (req.body?.name ?? '').trim();
    if (!name) return badRequest(res, 'Missing "name"');
    await familyService.updateFamilyGroup(id, name, req.body?.headId ?? null);
    res.json({ ok: true });
}));

// ── Family members ───────────────────────────────────────────────────────────

app.get('/family', wrap(async (req, res) => {
    const familyGroupId = Number(req.query.familyGroupId) || 1;
    if (!authService.canAccessGroup(req.auth, familyGroupId)) return forbiddenGroup(res);
    const members = await familyService.getFamily(familyGroupId);
    res.json({ FamilyMembers: members, WritePermission: req.auth.hasWriteRights });
}));

app.post('/members', authService.requireWrite, wrap(async (req, res) => {
    const { firstName, lastName, birthDate, gender, originCoupleId, familyGroupId } = req.body ?? {};
    const groupId = Number(familyGroupId);
    if (!groupId) return badRequest(res, 'Missing "familyGroupId"');
    if (!(firstName ?? '').trim() && !(lastName ?? '').trim()) return badRequest(res, 'A first or last name is required');
    if (!authService.canAccessGroup(req.auth, groupId)) return forbiddenGroup(res);
    const memberId = await familyService.addFamilyMember({ firstName, lastName, birthDate, gender, originCoupleId }, groupId);
    res.status(201).json({ FamilyMemberId: memberId });
}));

app.put('/members/:id', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    await familyService.updateFamilyMember(id, req.body ?? {});
    res.json({ ok: true });
}));

app.get('/members/:id/groups', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    res.json(await familyService.getMemberFamilyGroups(id));
}));

app.post('/members/:id/groups/:groupId', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const groupId = Number(req.params.groupId);
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    if (!authService.canAccessGroup(req.auth, groupId)) return forbiddenGroup(res);
    await familyService.addMemberToFamilyGroup(id, groupId);
    res.status(201).json({ ok: true });
}));

app.delete('/members/:id/groups/:groupId', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const groupId = Number(req.params.groupId);
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    if (!authService.canAccessGroup(req.auth, groupId)) return forbiddenGroup(res);
    await familyService.removeMemberFromFamilyGroup(id, groupId);
    res.json({ ok: true });
}));

// ── Couples ──────────────────────────────────────────────────────────────────

app.get('/couples', wrap(async (req, res) => {
    res.json(await familyService.getCouples());
}));

app.post('/couples', authService.requireWrite, wrap(async (req, res) => {
    const { memberId, partnerId, relationshipType } = req.body ?? {};
    if (!Number(memberId) || !Number(partnerId)) return badRequest(res, 'Missing "memberId" or "partnerId"');
    if (!(await authService.canAccessMember(req.auth, Number(memberId)))) return forbiddenMember(res);
    const coupleId = await familyService.setCoupleAssociation(Number(memberId), Number(partnerId), relationshipType || 'Partner');
    res.status(201).json({ CoupleId: coupleId });
}));

app.delete('/couples/member/:memberId', authService.requireWrite, wrap(async (req, res) => {
    const memberId = Number(req.params.memberId);
    if (!(await authService.canAccessMember(req.auth, memberId))) return forbiddenMember(res);
    await familyService.removeCoupleAssociation(memberId);
    res.json({ ok: true });
}));

// ── Attachments ──────────────────────────────────────────────────────────────

app.get('/members/:id/attachments', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    res.json(await familyService.getAttachments(id));
}));

app.post('/members/:id/attachments', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { label, url } = req.body ?? {};
    if (!(label ?? '').trim() || !(url ?? '').trim()) return badRequest(res, 'Missing "label" or "url"');
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    const attachmentId = await familyService.addAttachment(id, label.trim(), url.trim());
    res.status(201).json({ AttachmentId: attachmentId });
}));

app.put('/attachments/:id', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await familyService.getAttachment(id);
    if (!existing) return res.status(404).json({ error: 'Attachment not found' });
    if (!(await authService.canAccessMember(req.auth, existing.FamilyMemberId))) return forbiddenMember(res);
    const { label, url } = req.body ?? {};
    if (!(label ?? '').trim() || !(url ?? '').trim()) return badRequest(res, 'Missing "label" or "url"');
    await familyService.updateAttachment(id, label.trim(), url.trim());
    res.json({ ok: true });
}));

app.delete('/attachments/:id', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await familyService.getAttachment(id);
    if (!existing) return res.status(404).json({ error: 'Attachment not found' });
    if (!(await authService.canAccessMember(req.auth, existing.FamilyMemberId))) return forbiddenMember(res);
    await familyService.deleteAttachment(id);
    res.json({ ok: true });
}));

// ── Timeline ─────────────────────────────────────────────────────────────────

app.get('/members/:id/timeline', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    res.json(await familyService.getTimeline(id));
}));

app.post('/members/:id/timeline', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { dateOccurred, description } = req.body ?? {};
    if (!(description ?? '').trim()) return badRequest(res, 'Missing "description"');
    if (!(await authService.canAccessMember(req.auth, id))) return forbiddenMember(res);
    const timelineId = await familyService.addTimelineEntry(id, dateOccurred, description.trim());
    res.status(201).json({ TimelineId: timelineId });
}));

app.put('/timeline/:id', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await familyService.getTimelineEntry(id);
    if (!existing) return res.status(404).json({ error: 'Timeline entry not found' });
    if (!(await authService.canAccessMember(req.auth, existing.FamilyMemberId))) return forbiddenMember(res);
    const { dateOccurred, description } = req.body ?? {};
    if (!(description ?? '').trim()) return badRequest(res, 'Missing "description"');
    await familyService.updateTimelineEntry(id, dateOccurred, description.trim());
    res.json({ ok: true });
}));

app.delete('/timeline/:id', authService.requireWrite, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await familyService.getTimelineEntry(id);
    if (!existing) return res.status(404).json({ error: 'Timeline entry not found' });
    if (!(await authService.canAccessMember(req.auth, existing.FamilyMemberId))) return forbiddenMember(res);
    await familyService.deleteTimelineEntry(id);
    res.json({ ok: true });
}));

// ── Access token management (admin only) ─────────────────────────────────────

app.get('/tokens', authService.requireAdmin, wrap(async (req, res) => {
    res.json(await tokenService.listTokens(req.query.includeDeleted === 'true'));
}));

app.post('/tokens', authService.requireAdmin, wrap(async (req, res) => {
    const { name, isAdmin, hasWriteRights, expires, familyIdGroupRights } = req.body ?? {};
    if (!(name ?? '').trim()) return badRequest(res, 'Missing "name"');
    const created = await tokenService.createToken({
        name: name.trim(),
        isAdmin: !!isAdmin,
        hasWriteRights: !!hasWriteRights,
        expires: expires || null,
        familyIdGroupRights: familyIdGroupRights || null
    });
    // The plaintext secret is only ever returned here — store it safely.
    res.status(201).json(created);
}));

app.put('/tokens/:id', authService.requireAdmin, wrap(async (req, res) => {
    const updated = await tokenService.updateToken(Number(req.params.id), req.body ?? {});
    if (!updated) return res.status(404).json({ error: 'Token not found' });
    res.json(updated);
}));

app.post('/tokens/:id/rotate', authService.requireAdmin, wrap(async (req, res) => {
    const rotated = await tokenService.rotateTokenSecret(Number(req.params.id));
    if (!rotated) return res.status(404).json({ error: 'Token not found' });
    res.json(rotated);
}));

app.delete('/tokens/:id', authService.requireAdmin, wrap(async (req, res) => {
    const deleted = await tokenService.deleteToken(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
}));

// ── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ──────────────────────────────────────────────────────────────────

async function start() {
    const config = loadConfig();
    if (s3Service.isEnabled()) {
        await s3Service.downloadDbIfAvailable();
    }
    await dbService.ensureSchema();
    if (s3Service.isEnabled()) {
        dbService.onWrite(() => s3Service.scheduleUpload());
    }
    app.listen(config.Port, () => {
        console.log(`familyDb.API listening on port ${config.Port}`);
    });
}

start().catch((ex) => {
    console.error(ex.message);
    process.exit(1);
});
