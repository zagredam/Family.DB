import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './Navbar.css';
import './EditMemberModal.css';
import type { S3Config } from './S3Service';

type FamilyOption = {
    FamilyGroupId: number;
    FamilyName: string;
    FamilyHeadId: number | null;
};

type MemberOption = {
    id: number;
    name: string;
};

type NavbarProps = {
    isSqlite: boolean;
    isEditingEnabled: boolean;
    hasChanges: boolean;
    writePermissionDenied: boolean;
    onBack: () => void;
    onDownload: () => void;
    onAddMember: () => void;
    familyName?: string;
    familyOptions?: FamilyOption[];
    selectedFamilyId?: number;
    onSelectFamily?: (id: number) => void;
    onAddFamilyGroup?: (name: string) => void;
    onEnableEditing: () => void;
    memberOptions?: MemberOption[];
    currentHeadId?: number | null;
    onUpdateFamilyGroup?: (name: string, headId: number | null) => void;
    s3Config?: S3Config | null;
    onSaveS3Config?: (config: S3Config) => void;
};

const EMPTY_S3: S3Config = { Endpoint: '', BucketName: '', AccessKey: '', SecretKey: '', Region: 'us-east-1' };

export function Navbar({
    isSqlite,
    isEditingEnabled,
    hasChanges,
    writePermissionDenied,
    onBack,
    onDownload,
    onAddMember,
    familyName,
    familyOptions = [],
    selectedFamilyId,
    onSelectFamily,
    onAddFamilyGroup,
    onEnableEditing,
    memberOptions = [],
    currentHeadId,
    onUpdateFamilyGroup,
    s3Config,
    onSaveS3Config,
}: NavbarProps) {
    const [chyronOpen, setChyronOpen] = useState(false);
    const [addingGroup, setAddingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const chyronRef = useRef<HTMLDivElement>(null);

    const [cogOpen, setCogOpen] = useState(false);
    const [cogName, setCogName] = useState('');
    const [cogHeadId, setCogHeadId] = useState<number | null>(null);

    const [s3Open, setS3Open] = useState(false);
    const [s3Fields, setS3Fields] = useState<S3Config>(EMPTY_S3);

    useEffect(() => {
        if (cogOpen) {
            setCogName(familyName ?? '');
            setCogHeadId(currentHeadId ?? null);
        }
    }, [cogOpen, familyName, currentHeadId]);

    useEffect(() => {
        if (s3Open) {
            setS3Fields(s3Config ?? EMPTY_S3);
        }
    }, [s3Open, s3Config]);

    useEffect(() => {
        if (!chyronOpen) return;
        const handler = (e: MouseEvent) => {
            if (chyronRef.current && !chyronRef.current.contains(e.target as Node)) {
                setChyronOpen(false);
                setAddingGroup(false);
                setNewGroupName('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [chyronOpen]);

    const otherFamilies = familyOptions.filter(f => f.FamilyGroupId !== selectedFamilyId);

    const handleCogSave = () => {
        const name = cogName.trim();
        if (!name || !onUpdateFamilyGroup) return;
        onUpdateFamilyGroup(name, cogHeadId);
        setCogOpen(false);
    };

    const handleCogKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleCogSave();
        if (e.key === 'Escape') setCogOpen(false);
    };

    const handleAddGroup = () => {
        const name = newGroupName.trim();
        if (!name || !onAddFamilyGroup) return;
        onAddFamilyGroup(name);
        setNewGroupName('');
        setAddingGroup(false);
        setChyronOpen(false);
    };

    const handleGroupKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleAddGroup();
        if (e.key === 'Escape') { setAddingGroup(false); setNewGroupName(''); }
    };

    const handleS3Save = () => {
        const cfg: S3Config = {
            Endpoint: s3Fields.Endpoint.trim(),
            BucketName: s3Fields.BucketName.trim(),
            AccessKey: s3Fields.AccessKey.trim(),
            SecretKey: s3Fields.SecretKey.trim(),
            Region: s3Fields.Region.trim() || 'us-east-1',
        };
        if (!cfg.Endpoint || !cfg.BucketName || !cfg.AccessKey || !cfg.SecretKey) return;
        onSaveS3Config?.(cfg);
        setS3Open(false);
    };

    const showChyron = isSqlite && (!!onSelectFamily || !!onAddFamilyGroup || !!onUpdateFamilyGroup);
    const showEnableEditing = isSqlite && !isEditingEnabled && !writePermissionDenied;
    const showS3Btn = isSqlite && !!onSaveS3Config;

    return (
        <nav className="navbar">
            <div className="navbar-left">
                <button className="navbar-btn ghost" onClick={onBack}>
                    &#8592; Home
                </button>
            </div>

            <div className="navbar-center">
                <span className="navbar-title">
                    {familyName ? `${familyName} Family` : 'Family Tree'}
                </span>

                {showChyron && (
                    <div className="navbar-chyron" ref={chyronRef}>
                        <button
                            className={`navbar-chyron-btn ${chyronOpen ? 'active' : ''}`}
                            onClick={() => { setChyronOpen(o => !o); setAddingGroup(false); setNewGroupName(''); }}
                            title="Switch or add family group"
                        >
                            <span className="navbar-chyron-caret">&#9662;</span>
                        </button>

                        {chyronOpen && (
                            <div className="navbar-chyron-dropdown">
                                {otherFamilies.length > 0 && (
                                    <>
                                        {otherFamilies.map(f => (
                                            <button
                                                key={f.FamilyGroupId}
                                                className="navbar-chyron-item"
                                                onClick={() => { onSelectFamily?.(f.FamilyGroupId); setChyronOpen(false); }}
                                            >
                                                {f.FamilyName} Family
                                            </button>
                                        ))}
                                        <div className="navbar-chyron-divider" />
                                    </>
                                )}

                                {addingGroup ? (
                                    <div className="navbar-chyron-add-form">
                                        <input
                                            className="navbar-chyron-input"
                                            placeholder="Family name…"
                                            value={newGroupName}
                                            onChange={e => setNewGroupName(e.target.value)}
                                            onKeyDown={handleGroupKeyDown}
                                            autoFocus
                                        />
                                        <button
                                            className="navbar-chyron-confirm"
                                            onClick={handleAddGroup}
                                            disabled={!newGroupName.trim()}
                                            title="Confirm"
                                        >
                                            &#10003;
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        className="navbar-chyron-item add"
                                        onClick={() => setAddingGroup(true)}
                                    >
                                        + Add family group
                                    </button>
                                )}

                                {onUpdateFamilyGroup && (
                                    <>
                                        <div className="navbar-chyron-divider" />
                                        <button
                                            className="navbar-chyron-item settings"
                                            onClick={() => { setChyronOpen(false); setCogOpen(true); }}
                                        >
                                            &#9881; Family settings
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="navbar-right">
                {showEnableEditing && (
                    <button className="navbar-btn success" onClick={onEnableEditing}>
                        <span className="navbar-btn-label-long">Enable Editing</span>
                        <span className="navbar-btn-label-short">Edit</span>
                    </button>
                )}
                {isEditingEnabled && isSqlite && (
                    <button className="navbar-btn primary" onClick={onAddMember}>
                        <span className="navbar-btn-label-long">+ Add Member</span>
                        <span className="navbar-btn-label-short">+ Add</span>
                    </button>
                )}
                {isSqlite && hasChanges && (
                    <button className="navbar-btn secondary" onClick={onDownload}>
                        <span className="navbar-btn-label-long">&#8659; Download</span>
                        <span className="navbar-btn-label-short">&#8659;</span>
                    </button>
                )}
                {showS3Btn && (
                    <button
                        className={`navbar-btn ghost navbar-s3-btn ${s3Config ? 'has-config' : ''}`}
                        onClick={() => setS3Open(true)}
                        title="S3 storage settings"
                    >
                        <span className="navbar-s3-icon">&#9729;</span>
                        <span className="navbar-btn-label-long">S3</span>
                    </button>
                )}

                {cogOpen && createPortal(
                    <div className="modal-overlay" onMouseDown={() => setCogOpen(false)}>
                        <div className="modal" onMouseDown={e => e.stopPropagation()} style={{ width: 360, maxWidth: '92vw' }}>
                            <div className="modal-header">
                                <h2>Family Settings</h2>
                                <button className="modal-close" onClick={() => setCogOpen(false)}>&#10005;</button>
                            </div>
                            <div className="modal-body">
                                <label className="modal-label">
                                    Family Name
                                    <input
                                        className="modal-input"
                                        value={cogName}
                                        onChange={e => setCogName(e.target.value)}
                                        onKeyDown={handleCogKeyDown}
                                        placeholder="Family name…"
                                        autoFocus
                                    />
                                </label>
                                <label className="modal-label">
                                    Family Head
                                    <select
                                        className="modal-input"
                                        value={cogHeadId ?? ''}
                                        onChange={e => setCogHeadId(e.target.value ? Number(e.target.value) : null)}
                                    >
                                        <option value="">— none —</option>
                                        {memberOptions.map(m => (
                                            <option key={m.id} value={m.id}>{m.name}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className="modal-footer">
                                <button className="modal-btn secondary" onClick={() => setCogOpen(false)}>Cancel</button>
                                <button className="modal-btn primary" onClick={handleCogSave} disabled={!cogName.trim()}>Save</button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {s3Open && createPortal(
                    <div className="modal-overlay" onMouseDown={() => setS3Open(false)}>
                        <div className="modal" onMouseDown={e => e.stopPropagation()} style={{ width: 440, maxWidth: '92vw' }}>
                            <div className="modal-header">
                                <h2>S3 Storage Settings</h2>
                                <button className="modal-close" onClick={() => setS3Open(false)}>&#10005;</button>
                            </div>
                            <div className="modal-body">
                                <p className="s3-modal-hint">
                                    Connect an S3-compatible bucket to upload attachments. Your bucket must have CORS configured to allow PUT and GET from this origin.
                                </p>
                                <label className="modal-label">
                                    Endpoint URL
                                    <input
                                        className="modal-input"
                                        value={s3Fields.Endpoint}
                                        onChange={e => setS3Fields(f => ({ ...f, Endpoint: e.target.value }))}
                                        placeholder="https://s3.us-east-1.amazonaws.com"
                                    />
                                </label>
                                <label className="modal-label">
                                    Bucket Name
                                    <input
                                        className="modal-input"
                                        value={s3Fields.BucketName}
                                        onChange={e => setS3Fields(f => ({ ...f, BucketName: e.target.value }))}
                                        placeholder="my-family-bucket"
                                    />
                                </label>
                                <label className="modal-label">
                                    Region
                                    <input
                                        className="modal-input"
                                        value={s3Fields.Region}
                                        onChange={e => setS3Fields(f => ({ ...f, Region: e.target.value }))}
                                        placeholder="us-east-1"
                                    />
                                </label>
                                <label className="modal-label">
                                    Access Key ID
                                    <input
                                        className="modal-input"
                                        value={s3Fields.AccessKey}
                                        onChange={e => setS3Fields(f => ({ ...f, AccessKey: e.target.value }))}
                                        placeholder="AKIAIOSFODNN7EXAMPLE"
                                    />
                                </label>
                                <label className="modal-label">
                                    Secret Access Key
                                    <input
                                        className="modal-input"
                                        type="password"
                                        value={s3Fields.SecretKey}
                                        onChange={e => setS3Fields(f => ({ ...f, SecretKey: e.target.value }))}
                                        placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                                    />
                                </label>
                            </div>
                            <div className="modal-footer">
                                <button className="modal-btn secondary" onClick={() => setS3Open(false)}>Cancel</button>
                                <button
                                    className="modal-btn primary"
                                    onClick={handleS3Save}
                                    disabled={!s3Fields.Endpoint.trim() || !s3Fields.BucketName.trim() || !s3Fields.AccessKey.trim() || !s3Fields.SecretKey.trim()}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        </nav>
    );
}
