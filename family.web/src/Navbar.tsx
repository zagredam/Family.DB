import { useState, useRef, useEffect } from 'react';
import './Navbar.css';

type FamilyOption = {
    FamilyGroupId: number;
    FamilyName: string;
    FamilyHeadId: number | null;
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
};

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
}: NavbarProps) {
    const [chyronOpen, setChyronOpen] = useState(false);
    const [addingGroup, setAddingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const chyronRef = useRef<HTMLDivElement>(null);

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

    const showChyron = isSqlite && (!!onSelectFamily || !!onAddFamilyGroup);
    const showEnableEditing = isSqlite && !isEditingEnabled && !writePermissionDenied;

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
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="navbar-right">
                {showEnableEditing && (
                    <button className="navbar-btn success" onClick={onEnableEditing}>
                        Enable Editing
                    </button>
                )}
                {isEditingEnabled && isSqlite && (
                    <button className="navbar-btn primary" onClick={onAddMember}>
                        + Add Member
                    </button>
                )}
                {isSqlite && hasChanges && (
                    <button className="navbar-btn secondary" onClick={onDownload}>
                        &#8659; Download
                    </button>
                )}
            </div>
        </nav>
    );
}
