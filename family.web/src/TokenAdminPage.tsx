import { useState, useEffect, useCallback } from 'react';
import QRCode from 'qrcode';
import './TokenAdminPage.css';
import { ApiClient, buildAutoLoginUrl } from './ApiService';
import type { AccessTokenRow, FamilyOption } from './dataTypes';

type TokenAdminPageProps = {
    api: ApiClient;
    familyOptions: FamilyOption[];
    onClose: () => void;
};

type IssuedSecret = {
    tokenId: number;
    name: string;
    tokenSecret: string;
    qrDataUrl: string | null;
    loginUrl: string;
};

type TokenFormState = {
    name: string;
    isAdmin: boolean;
    hasWriteRights: boolean;
    expires: string;          // datetime-local value or ''
    allGroups: boolean;
    groupIds: number[];
};

const EMPTY_FORM: TokenFormState = { name: '', isAdmin: false, hasWriteRights: false, expires: '', allGroups: true, groupIds: [] };

function formToRequest(form: TokenFormState) {
    return {
        name: form.name.trim(),
        isAdmin: form.isAdmin,
        hasWriteRights: form.hasWriteRights,
        expires: form.expires ? new Date(form.expires).toISOString() : null,
        familyIdGroupRights: form.allGroups ? null : form.groupIds.join(',')
    };
}

function describeGroupRights(value: string | null, familyOptions: FamilyOption[]): string {
    if (!value || value.trim() === '' || value.trim() === '*') return 'All families';
    return value.split(',')
        .map(s => Number(s.trim()))
        .map(id => familyOptions.find(f => f.FamilyGroupId === id)?.FamilyName ?? `#${id}`)
        .join(', ');
}

export function TokenAdminPage({ api, familyOptions, onClose }: TokenAdminPageProps) {
    const [tokens, setTokens] = useState<AccessTokenRow[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [form, setForm] = useState<TokenFormState>(EMPTY_FORM);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [issued, setIssued] = useState<IssuedSecret | null>(null);
    const [copied, setCopied] = useState<'secret' | 'link' | null>(null);

    const reload = useCallback(() => {
        api.listTokens()
            .then(setTokens)
            .catch(() => setLoadError('Could not load tokens.'));
    }, [api]);

    useEffect(() => { reload(); }, [reload]);

    const showIssuedSecret = async (tokenId: number, name: string, tokenSecret: string) => {
        const loginUrl = buildAutoLoginUrl(api.session.url, tokenSecret);
        let qrDataUrl: string | null = null;
        try {
            qrDataUrl = await QRCode.toDataURL(loginUrl, { width: 260, margin: 1 });
        } catch {
            // QR generation failing shouldn't hide the secret
        }
        setCopied(null);
        setIssued({ tokenId, name, tokenSecret, qrDataUrl, loginUrl });
    };

    const handleCreate = async () => {
        if (!form.name.trim() || busy) return;
        setBusy(true);
        try {
            const created = await api.createToken(formToRequest(form));
            setForm(EMPTY_FORM);
            setShowCreate(false);
            reload();
            await showIssuedSecret(created.tokenId, form.name.trim(), created.tokenSecret);
        } catch {
            alert('Creating the token failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleStartEdit = (t: AccessTokenRow) => {
        setShowCreate(false);
        setEditingId(t.TokenId);
        const restricted = !!t.FamilyIdGroupRights && t.FamilyIdGroupRights.trim() !== '' && t.FamilyIdGroupRights.trim() !== '*';
        setForm({
            name: t.Name,
            isAdmin: t.IsAdmin,
            hasWriteRights: t.HasWriteRights,
            expires: t.Expires ? t.Expires.slice(0, 16) : '',
            allGroups: !restricted,
            groupIds: restricted ? t.FamilyIdGroupRights!.split(',').map(s => Number(s.trim())).filter(Number.isInteger) : []
        });
    };

    const handleSaveEdit = async () => {
        if (editingId === null || !form.name.trim() || busy) return;
        setBusy(true);
        try {
            await api.updateToken(editingId, formToRequest(form));
            setEditingId(null);
            setForm(EMPTY_FORM);
            reload();
        } catch {
            alert('Updating the token failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleRotate = async (t: AccessTokenRow) => {
        if (!window.confirm(`Generate a new secret for "${t.Name}"? The old secret will stop working immediately.`)) return;
        try {
            const rotated = await api.rotateToken(t.TokenId);
            await showIssuedSecret(t.TokenId, t.Name, rotated.tokenSecret);
        } catch {
            alert('Rotating the token failed.');
        }
    };

    const handleDelete = async (t: AccessTokenRow) => {
        if (!window.confirm(`Revoke "${t.Name}"? Anyone using this token will lose access.`)) return;
        try {
            await api.deleteToken(t.TokenId);
            reload();
        } catch {
            alert('Revoking the token failed.');
        }
    };

    const copyText = async (text: string, which: 'secret' | 'link') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(which);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            // clipboard unavailable (http origin) — user can select manually
        }
    };

    const toggleGroup = (id: number) => {
        setForm(f => ({
            ...f,
            groupIds: f.groupIds.includes(id) ? f.groupIds.filter(g => g !== id) : [...f.groupIds, id]
        }));
    };

    const formNode = (submitLabel: string, onSubmit: () => void, onCancel: () => void) => (
        <div className="token-form">
            <label className="modal-label">
                Name
                <input
                    className="modal-input"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Aunt Carol"
                    autoFocus
                />
            </label>
            <div className="token-form-flags">
                <label className="token-checkbox">
                    <input
                        type="checkbox"
                        checked={form.hasWriteRights}
                        onChange={e => setForm(f => ({ ...f, hasWriteRights: e.target.checked }))}
                    />
                    Can edit (write rights)
                </label>
                <label className="token-checkbox">
                    <input
                        type="checkbox"
                        checked={form.isAdmin}
                        onChange={e => setForm(f => ({ ...f, isAdmin: e.target.checked }))}
                    />
                    Admin (can manage tokens)
                </label>
            </div>
            <label className="modal-label">
                Expires (optional)
                <input
                    type="datetime-local"
                    className="modal-input"
                    value={form.expires}
                    onChange={e => setForm(f => ({ ...f, expires: e.target.value }))}
                />
            </label>
            <div className="modal-label">
                Family access
                <label className="token-checkbox" style={{ marginTop: '0.35rem' }}>
                    <input
                        type="checkbox"
                        checked={form.allGroups}
                        onChange={e => setForm(f => ({ ...f, allGroups: e.target.checked }))}
                    />
                    All family groups
                </label>
                {!form.allGroups && (
                    <div className="token-group-list">
                        {familyOptions.map(fo => (
                            <label key={fo.FamilyGroupId} className="token-checkbox">
                                <input
                                    type="checkbox"
                                    checked={form.groupIds.includes(fo.FamilyGroupId)}
                                    onChange={() => toggleGroup(fo.FamilyGroupId)}
                                />
                                {fo.FamilyName}
                            </label>
                        ))}
                        {familyOptions.length === 0 && <span className="token-muted">No family groups found</span>}
                    </div>
                )}
            </div>
            <div className="token-form-actions">
                <button className="modal-btn secondary" onClick={onCancel} disabled={busy}>Cancel</button>
                <button
                    className="modal-btn primary"
                    onClick={onSubmit}
                    disabled={busy || !form.name.trim() || (!form.allGroups && form.groupIds.length === 0)}
                >
                    {busy ? 'Saving…' : submitLabel}
                </button>
            </div>
        </div>
    );

    return (
        <div className="token-admin-overlay">
            <div className="token-admin">
                <div className="token-admin-header">
                    <h2>Access Tokens</h2>
                    <div className="token-admin-header-actions">
                        {!showCreate && editingId === null && (
                            <button
                                className="modal-btn primary"
                                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
                            >
                                + New Token
                            </button>
                        )}
                        <button className="modal-close" onClick={onClose}>&#x2715;</button>
                    </div>
                </div>

                <div className="token-admin-body">
                    {showCreate && (
                        <div className="token-panel">
                            <div className="token-panel-title">Create token</div>
                            {formNode('Create', handleCreate, () => { setShowCreate(false); setForm(EMPTY_FORM); })}
                        </div>
                    )}

                    {loadError && <p className="token-error">{loadError}</p>}
                    {!tokens && !loadError && <p className="token-muted">Loading…</p>}

                    {tokens && tokens.length === 0 && (
                        <p className="token-muted">No tokens yet — create one to give someone access.</p>
                    )}

                    {tokens && tokens.map(t => (
                        <div key={t.TokenId} className="token-row">
                            {editingId === t.TokenId ? (
                                formNode('Save', handleSaveEdit, () => { setEditingId(null); setForm(EMPTY_FORM); })
                            ) : (
                                <>
                                    <div className="token-row-info">
                                        <span className="token-row-name">{t.Name}</span>
                                        <span className="token-row-meta">
                                            {t.IsAdmin && <span className="token-badge admin">Admin</span>}
                                            {t.HasWriteRights && <span className="token-badge write">Write</span>}
                                            {!t.IsAdmin && !t.HasWriteRights && <span className="token-badge">Read-only</span>}
                                            <span className="token-meta-item">{describeGroupRights(t.FamilyIdGroupRights, familyOptions)}</span>
                                            {t.Expires && (
                                                <span className={`token-meta-item ${new Date(t.Expires) < new Date() ? 'token-expired' : ''}`}>
                                                    {new Date(t.Expires) < new Date() ? 'Expired ' : 'Expires '}
                                                    {new Date(t.Expires).toLocaleString()}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="token-row-actions">
                                        <button className="modal-btn secondary modal-btn-sm" onClick={() => handleStartEdit(t)}>Edit</button>
                                        <button className="modal-btn secondary modal-btn-sm" onClick={() => handleRotate(t)}>New secret</button>
                                        <button className="modal-btn danger modal-btn-sm" onClick={() => handleDelete(t)}>Revoke</button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {issued && (
                <div className="modal-overlay" onClick={() => setIssued(null)}>
                    <div className="modal token-secret-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Token for {issued.name}</h2>
                            <button className="modal-close" onClick={() => setIssued(null)}>&#x2715;</button>
                        </div>
                        <div className="modal-body token-secret-body">
                            <p className="token-secret-warning">
                                This secret is shown <strong>only once</strong>. Share it (or the QR code) with the person who should use it.
                            </p>
                            {issued.qrDataUrl && (
                                <div className="token-qr-wrap">
                                    <img className="token-qr" src={issued.qrDataUrl} alt="Scan to log in" />
                                    <span className="token-muted">Scan to open the app and log in automatically</span>
                                </div>
                            )}
                            <label className="modal-label">
                                Access token
                                <div className="token-copy-row">
                                    <input className="modal-input token-secret-input" readOnly value={issued.tokenSecret} onFocus={e => e.target.select()} />
                                    <button className="modal-btn secondary modal-btn-sm" onClick={() => copyText(issued.tokenSecret, 'secret')}>
                                        {copied === 'secret' ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                            </label>
                            <label className="modal-label">
                                Auto-login link
                                <div className="token-copy-row">
                                    <input className="modal-input token-secret-input" readOnly value={issued.loginUrl} onFocus={e => e.target.select()} />
                                    <button className="modal-btn secondary modal-btn-sm" onClick={() => copyText(issued.loginUrl, 'link')}>
                                        {copied === 'link' ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                            </label>
                        </div>
                        <div className="modal-footer">
                            <button className="modal-btn primary" onClick={() => setIssued(null)}>Done</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
