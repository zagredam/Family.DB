import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './Navbar.css';
import './EditMemberModal.css';

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
    canEdit: boolean;
    isAdmin?: boolean;
    isEditingEnabled: boolean;
    hasChanges: boolean;
    onBack: () => void;
    onDownload: () => void;
    onAddMember: () => void;
    onOpenTokens?: () => void;
    familyName?: string;
    familyOptions?: FamilyOption[];
    selectedFamilyId?: number;
    onSelectFamily?: (id: number) => void;
    onAddFamilyGroup?: (name: string) => void;
    onEnableEditing: () => void;
    memberOptions?: MemberOption[];
    currentHeadId?: number | null;
    onUpdateFamilyGroup?: (name: string, headId: number | null) => void;
};

export function Navbar({
    isSqlite,
    canEdit,
    isAdmin = false,
    isEditingEnabled,
    hasChanges,
    onBack,
    onDownload,
    onAddMember,
    onOpenTokens,
    familyName,
    familyOptions = [],
    selectedFamilyId,
    onSelectFamily,
    onAddFamilyGroup,
    onEnableEditing,
    memberOptions = [],
    currentHeadId,
    onUpdateFamilyGroup,
}: NavbarProps) {
    const [chyronOpen, setChyronOpen] = useState(false);
    const [addingGroup, setAddingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const chyronRef = useRef<HTMLDivElement>(null);

    const [cogOpen, setCogOpen] = useState(false);
    const [cogName, setCogName] = useState('');
    const [cogHeadId, setCogHeadId] = useState<number | null>(null);

    useEffect(() => {
        if (cogOpen) {
            setCogName(familyName ?? '');
            setCogHeadId(currentHeadId ?? null);
        }
    }, [cogOpen, familyName, currentHeadId]);

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

    const showChyron = !!onSelectFamily || !!onAddFamilyGroup || !!onUpdateFamilyGroup;
    const showEnableEditing = canEdit && !isEditingEnabled;

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
                            {/* {otherFamilies.length > 0 ? `+${otherFamilies.length}` : ''} */}
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
                {isAdmin && onOpenTokens && (
                    <button className="navbar-btn ghost" onClick={onOpenTokens}>
                        <span className="navbar-btn-label-long">&#128273; Tokens</span>
                        <span className="navbar-btn-label-short">&#128273;</span>
                    </button>
                )}
                {showEnableEditing && (
                    <button className="navbar-btn success" onClick={onEnableEditing}>
                        <span className="navbar-btn-label-long">Enable Editing</span>
                        <span className="navbar-btn-label-short">Edit</span>
                    </button>
                )}
                {isEditingEnabled && canEdit && (
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
            </div>
        </nav>
    );
}
