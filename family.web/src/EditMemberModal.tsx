import { useState, useEffect } from 'react';
import { Tabs } from '@base-ui-components/react/tabs';
import './EditMemberModal.css';
import type { CoupleRelationshipType } from './tree/types';
import type { Database } from 'sql.js';
import { queryAttachments, addAttachment, updateAttachment, deleteAttachment, saveDbToLocalStorage, queryMemberFamilyGroups, queryTimeline, addTimelineEntry, updateTimelineEntry, deleteTimelineEntry } from './SqliteService';

const COUPLE_RELATIONSHIP_TYPES: CoupleRelationshipType[] = [
    'Partner',
    'Common-Law Partner',
    'Have shared kids',
    'Divorcee',
];

type MemberSummary = {
    FamilyMemberId: number;
    FirstName: string;
    LastName: string;
};

type CoupleOption = {
    CoupleId: number;
    ParterFamilyMemberId: number;
    OtherPartnerFamilyMemberId: number;
    RelationshipType: CoupleRelationshipType;
    PartnerName: string;
    OtherPartnerName: string;
};

type Attachment = {
    AttachmentId: number;
    Label: string;
    Url: string;
};

type FamilyOption = {
    FamilyGroupId: number;
    FamilyName: string;
};

type MemberFamily = {
    FamilyGroupId: number;
    FamilyName: string;
};

type EditMemberModalProps = {
    member: {
        FamilyMemberId: number;
        FirstName: string;
        MiddleName: string | null;
        LastName: string;
        BirthDate: string | null;
        Gender: string;
        DeceasedDate: string | null;
        Description: string | null;
        OriginCoupleId: number | null;
        SecondFamilyId: number | null;
        SecondFamilyName: string | null;
    };
    allMembers?: MemberSummary[];
    couples?: CoupleOption[];
    familyOptions?: FamilyOption[];
    db?: Database;
    readOnly?: boolean;
    currentFamilyId?: number;
    onSave: (id: number, data: { firstName: string; middleName: string; lastName: string; birthDate: string; gender: string; deceasedDate: string; description: string; originCoupleId: number | null }) => void;
    onClose: () => void;
    onAssignCouple?: (memberId: number, partnerId: number, relationshipType: CoupleRelationshipType) => void;
    onRemoveCouple?: (memberId: number) => void;
    onAddToFamily?: (memberId: number, familyGroupId: number) => void;
    onRemoveFromFamily?: (memberId: number, familyGroupId: number) => void;
    onSwitchFamily?: (familyId: number) => void;
    onDataChange?: () => void;
};

export function EditMemberModal({ member, allMembers, couples, familyOptions, db, readOnly = false, currentFamilyId, onSave, onClose, onAssignCouple, onRemoveCouple, onAddToFamily, onRemoveFromFamily, onSwitchFamily, onDataChange }: EditMemberModalProps) {
    // Details tab state
    const [firstName, setFirstName] = useState(member.FirstName ?? '');
    const [middleName, setMiddleName] = useState(member.MiddleName ?? '');
    const [lastName, setLastName] = useState(member.LastName ?? '');
    const [gender, setGender] = useState(member.Gender ?? 'Male');
    const [birthDate, setBirthDate] = useState(member.BirthDate ?? '');
    const [deceasedDate, setDeceasedDate] = useState(member.DeceasedDate ?? '');
    const [description, setDescription] = useState(member.Description ?? '');
    const [originCoupleId, setOriginCoupleId] = useState<number | null>(member.OriginCoupleId ?? null);

    // Couple tab state
    const currentCouple = couples?.find(
        c => c.ParterFamilyMemberId === member.FamilyMemberId || c.OtherPartnerFamilyMemberId === member.FamilyMemberId
    );
    const currentPartnerId = currentCouple
        ? (currentCouple.ParterFamilyMemberId === member.FamilyMemberId
            ? currentCouple.OtherPartnerFamilyMemberId
            : currentCouple.ParterFamilyMemberId)
        : null;
    const currentPartner = allMembers?.find(m => m.FamilyMemberId === currentPartnerId) ?? null;
    const [selectedPartnerId, setSelectedPartnerId] = useState(
        currentPartner ? String(currentPartner.FamilyMemberId) : ''
    );
    const [selectedRelType, setSelectedRelType] = useState<CoupleRelationshipType>(
        currentCouple?.RelationshipType ?? 'Partner'
    );

    // Attachments tab state
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [newLabel, setNewLabel] = useState('');
    const [newUrl, setNewUrl] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [editUrl, setEditUrl] = useState('');

    // Timeline tab state
    type TimelineEntry = { TimelineId: number; DateOccurred: string | null; Description: string | null; DateModified: string | null };
    const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
    const [newEntryDate, setNewEntryDate] = useState('');
    const [newEntryDesc, setNewEntryDesc] = useState('');
    const [editingTimelineId, setEditingTimelineId] = useState<number | null>(null);
    const [editTimelineDate, setEditTimelineDate] = useState('');
    const [editTimelineDesc, setEditTimelineDesc] = useState('');

    // Families tab state
    const [memberFamilies, setMemberFamilies] = useState<MemberFamily[]>([]);
    const [removeWarningFamilyId, setRemoveWarningFamilyId] = useState<number | null>(null);
    const [selectedAddFamilyId, setSelectedAddFamilyId] = useState('');

    useEffect(() => {
        if (db) {
            try {
                setAttachments(queryAttachments(db, member.FamilyMemberId) as Attachment[]);
            } catch {
                // table may not exist in older DBs
            }
            try {
                setMemberFamilies(queryMemberFamilyGroups(db, member.FamilyMemberId) as MemberFamily[]);
            } catch {
                // table may not exist in older DBs
            }
            try {
                setTimeline(queryTimeline(db, member.FamilyMemberId) as TimelineEntry[]);
            } catch {
                // table may not exist in older DBs — run migration 004
            }
        }
    }, [db, member.FamilyMemberId]);

    const refreshTimeline = () => {
        if (!db) return;
        try { setTimeline(queryTimeline(db, member.FamilyMemberId) as TimelineEntry[]); } catch { /* */ }
    };

    const handleAddTimelineEntry = () => {
        if (!db || !newEntryDesc.trim()) return;
        addTimelineEntry(db, member.FamilyMemberId, newEntryDate, newEntryDesc.trim());
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshTimeline();
        setNewEntryDate('');
        setNewEntryDesc('');
    };

    const handleStartEditTimeline = (e: TimelineEntry) => {
        setEditingTimelineId(e.TimelineId);
        setEditTimelineDate(e.DateOccurred ?? '');
        setEditTimelineDesc(e.Description ?? '');
    };

    const handleSaveEditTimeline = () => {
        if (!db || editingTimelineId === null || !editTimelineDesc.trim()) return;
        updateTimelineEntry(db, editingTimelineId, editTimelineDate, editTimelineDesc.trim());
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshTimeline();
        setEditingTimelineId(null);
    };

    const handleDeleteTimelineEntry = (id: number) => {
        if (!db) return;
        deleteTimelineEntry(db, id);
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshTimeline();
    };

    const availablePartners = allMembers?.filter(m => m.FamilyMemberId !== member.FamilyMemberId) ?? [];
    const showCoupleSection = !!allMembers && (!!onAssignCouple || !!onRemoveCouple);
    const isUpdatingExisting = !!currentPartner && selectedPartnerId === String(currentPartner.FamilyMemberId);

    const handleSave = () => {
        onSave(member.FamilyMemberId, { firstName, middleName, lastName, birthDate, gender, deceasedDate, description, originCoupleId });
    };

    const handleAssignCouple = () => {
        if (!selectedPartnerId || !onAssignCouple) return;
        onAssignCouple(member.FamilyMemberId, Number(selectedPartnerId), selectedRelType);
    };

    const handleRemoveCouple = () => {
        if (!onRemoveCouple) return;
        onRemoveCouple(member.FamilyMemberId);
        setSelectedPartnerId('');
        setSelectedRelType('Partner');
    };

    const handleAddAttachment = () => {
        if (!db || !newLabel.trim() || !newUrl.trim()) return;
        addAttachment(db, member.FamilyMemberId, newLabel.trim(), newUrl.trim());
        saveDbToLocalStorage(db);
        onDataChange?.();
        setAttachments(queryAttachments(db, member.FamilyMemberId) as Attachment[]);
        setNewLabel('');
        setNewUrl('');
    };

    const handleStartEdit = (a: Attachment) => {
        setEditingId(a.AttachmentId);
        setEditLabel(a.Label);
        setEditUrl(a.Url);
    };

    const handleSaveEdit = () => {
        if (!db || editingId === null || !editLabel.trim() || !editUrl.trim()) return;
        updateAttachment(db, editingId, editLabel.trim(), editUrl.trim());
        saveDbToLocalStorage(db);
        onDataChange?.();
        setAttachments(queryAttachments(db, member.FamilyMemberId) as Attachment[]);
        setEditingId(null);
    };

    const handleDeleteAttachment = (id: number) => {
        if (!db) return;
        deleteAttachment(db, id);
        saveDbToLocalStorage(db);
        onDataChange?.();
        setAttachments(queryAttachments(db, member.FamilyMemberId) as Attachment[]);
    };

    const showCoupleTab = showCoupleSection && (!readOnly || !!currentPartner);
    const showFamiliesTab = !!(db && familyOptions) && (!readOnly || memberFamilies.length > 0);
    const showTimelineTab = !!db && (!readOnly || timeline.length > 0);
    const showAttachmentsTab = !!db && (!readOnly || attachments.length > 0);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{readOnly ? `${member.FirstName} ${member.LastName}` : 'Edit Family Member'}</h2>
                    <button className="modal-close" onClick={onClose}>&#x2715;</button>
                </div>

                <Tabs.Root className="modal-tabs" defaultValue="details">
                    <Tabs.List className="modal-tab-list">
                        <Tabs.Tab className="modal-tab" value="details">Details</Tabs.Tab>
                        {showCoupleTab && (
                            <Tabs.Tab className="modal-tab" value="couple">Couple</Tabs.Tab>
                        )}
                        {showFamiliesTab && (
                            <Tabs.Tab className="modal-tab" value="families">Families</Tabs.Tab>
                        )}
                        {showTimelineTab && (
                            <Tabs.Tab className="modal-tab" value="timeline">Timeline</Tabs.Tab>
                        )}
                        {showAttachmentsTab && (
                            <Tabs.Tab className="modal-tab" value="attachments">Attachments</Tabs.Tab>
                        )}
                    </Tabs.List>

                    {/* Details Tab */}
                    <Tabs.Panel className="modal-tab-panel" value="details">
                        {readOnly ? (
                            <div className="modal-body">
                                {(firstName || lastName) && (
                                    <div className="modal-field-row">
                                        <span className="modal-field-label">Name</span>
                                        <span className="modal-field-value">{[firstName, middleName, lastName].filter(Boolean).join(' ')}</span>
                                    </div>
                                )}
                                {gender && (
                                    <div className="modal-field-row">
                                        <span className="modal-field-label">Gender</span>
                                        <span className="modal-field-value">{gender}</span>
                                    </div>
                                )}
                                {birthDate && (
                                    <div className="modal-field-row">
                                        <span className="modal-field-label">Birth Date</span>
                                        <span className="modal-field-value">{birthDate}</span>
                                    </div>
                                )}
                                {deceasedDate && (
                                    <div className="modal-field-row">
                                        <span className="modal-field-label">Deceased Date</span>
                                        <span className="modal-field-value">{deceasedDate}</span>
                                    </div>
                                )}
                                {originCoupleId && couples && (() => {
                                    const c = couples.find(cp => cp.CoupleId === originCoupleId);
                                    return c ? (
                                        <div className="modal-field-row">
                                            <span className="modal-field-label">Parents</span>
                                            <span className="modal-field-value">{c.PartnerName} &amp; {c.OtherPartnerName}</span>
                                        </div>
                                    ) : null;
                                })()}
                                {description && (
                                    <div className="modal-field-row">
                                        <span className="modal-field-label">Description</span>
                                        <span className="modal-field-value modal-field-value--multiline">{description}</span>
                                    </div>
                                )}
                                {onSwitchFamily && memberFamilies.filter(f => f.FamilyGroupId !== currentFamilyId).map(f => (
                                    <div key={f.FamilyGroupId} className="modal-family-switch">
                                        Also in&nbsp;<strong>{f.FamilyName}</strong>&nbsp;family&nbsp;&mdash;&nbsp;
                                        <button className="modal-link-btn" onClick={() => { onSwitchFamily(f.FamilyGroupId); onClose(); }}>Switch</button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="modal-body">
                                <label className="modal-label">
                                    First Name
                                    <input type="text" className="modal-input" value={firstName} onChange={e => setFirstName(e.target.value)} />
                                </label>
                                <label className="modal-label">
                                    Middle Name
                                    <input type="text" className="modal-input" value={middleName} onChange={e => setMiddleName(e.target.value)} />
                                </label>
                                <label className="modal-label">
                                    Last Name
                                    <input type="text" className="modal-input" value={lastName} onChange={e => setLastName(e.target.value)} />
                                </label>
                                <label className="modal-label">
                                    Gender
                                    <select className="modal-input" value={gender} onChange={e => setGender(e.target.value)}>
                                        <option value="Male">Male</option>
                                        <option value="Female">Female</option>
                                    </select>
                                </label>
                                <label className="modal-label">
                                    Birth Date
                                    <input type="date" className="modal-input" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
                                </label>
                                <label className="modal-label">
                                    Deceased Date
                                    <input type="date" className="modal-input" value={deceasedDate} onChange={e => setDeceasedDate(e.target.value)} />
                                </label>
                                {couples && couples.length > 0 && (
                                    <label className="modal-label">
                                        Parents
                                        <select
                                            className="modal-input"
                                            value={originCoupleId ?? ''}
                                            onChange={e => setOriginCoupleId(e.target.value ? Number(e.target.value) : null)}
                                        >
                                            <option value="">None</option>
                                            {couples.map(c => (
                                                <option key={c.CoupleId} value={c.CoupleId}>
                                                    {c.PartnerName} &amp; {c.OtherPartnerName}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                <label className="modal-label">
                                    Description
                                    <textarea className="modal-input" value={description} rows={4} onChange={e => setDescription(e.target.value)} />
                                </label>

                                {onSwitchFamily && memberFamilies.filter(f => f.FamilyGroupId !== currentFamilyId).map(f => (
                                    <div key={f.FamilyGroupId} className="modal-family-switch">
                                        Also in&nbsp;<strong>{f.FamilyName}</strong>&nbsp;family&nbsp;&mdash;&nbsp;
                                        <button className="modal-link-btn" onClick={() => { onSwitchFamily(f.FamilyGroupId); onClose(); }}>Switch</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="modal-footer">
                            {readOnly ? (
                                <button className="modal-btn secondary" onClick={onClose}>Close</button>
                            ) : (
                                <>
                                    <button className="modal-btn secondary" onClick={onClose}>Cancel</button>
                                    <button className="modal-btn primary" onClick={handleSave}>Save</button>
                                </>
                            )}
                        </div>
                    </Tabs.Panel>

                    {/* Couple Tab */}
                    {showCoupleTab && (
                        <Tabs.Panel className="modal-tab-panel" value="couple">
                            <div className="modal-body">
                                <div className="modal-section-label">Current Partner</div>

                                {currentPartner ? (
                                    <div className="modal-couple-current">
                                        <span className="modal-partner-name">
                                            {currentPartner.FirstName} {currentPartner.LastName}
                                        </span>
                                        {!readOnly && onRemoveCouple && (
                                            <button className="modal-btn danger modal-btn-sm" onClick={handleRemoveCouple}>
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <span className="modal-partner-none">No partner assigned</span>
                                )}

                                {!readOnly && onAssignCouple && (
                                    <>
                                        <div className="modal-section-label" style={{ marginTop: '1rem' }}>
                                            {currentPartner ? 'Change Partner' : 'Assign Partner'}
                                        </div>
                                        <div className="modal-couple-row">
                                            <select
                                                className="modal-input"
                                                value={selectedPartnerId}
                                                onChange={e => setSelectedPartnerId(e.target.value)}
                                            >
                                                <option value="">Select partner…</option>
                                                {availablePartners.map(m => (
                                                    <option key={m.FamilyMemberId} value={String(m.FamilyMemberId)}>
                                                        {m.FirstName} {m.LastName}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="modal-couple-row">
                                            <select
                                                className="modal-input"
                                                value={selectedRelType}
                                                onChange={e => setSelectedRelType(e.target.value as CoupleRelationshipType)}
                                            >
                                                {COUPLE_RELATIONSHIP_TYPES.map(t => (
                                                    <option key={t} value={t}>{t}</option>
                                                ))}
                                            </select>
                                            <button
                                                className="modal-btn primary modal-btn-sm"
                                                onClick={handleAssignCouple}
                                                disabled={!selectedPartnerId}
                                            >
                                                {isUpdatingExisting ? 'Update' : 'Assign'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </Tabs.Panel>
                    )}

                    {/* Timeline Tab */}
                    {showTimelineTab && (
                        <Tabs.Panel className="modal-tab-panel" value="timeline">
                            <div className="modal-body">
                                {timeline.length === 0 && (
                                    <span className="modal-partner-none">No timeline entries yet</span>
                                )}
                                {timeline.map(e => (
                                    <div key={e.TimelineId} className="modal-timeline-row">
                                        {!readOnly && editingTimelineId === e.TimelineId ? (
                                            <>
                                                <div className="modal-attachment-fields">
                                                    <input
                                                        type="date"
                                                        className="modal-input"
                                                        value={editTimelineDate}
                                                        onChange={ev => setEditTimelineDate(ev.target.value)}
                                                    />
                                                    <textarea
                                                        className="modal-input"
                                                        rows={2}
                                                        value={editTimelineDesc}
                                                        onChange={ev => setEditTimelineDesc(ev.target.value)}
                                                    />
                                                </div>
                                                <div className="modal-attachment-actions">
                                                    <button className="modal-btn primary modal-btn-sm" onClick={handleSaveEditTimeline} disabled={!editTimelineDesc.trim()}>Save</button>
                                                    <button className="modal-btn secondary modal-btn-sm" onClick={() => setEditingTimelineId(null)}>Cancel</button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="modal-timeline-info">
                                                    {e.DateOccurred && (
                                                        <span className="modal-timeline-date">{e.DateOccurred}</span>
                                                    )}
                                                    <span className="modal-timeline-desc">{e.Description}</span>
                                                </div>
                                                {!readOnly && (
                                                    <div className="modal-attachment-actions">
                                                        <button className="modal-btn secondary modal-btn-sm" onClick={() => handleStartEditTimeline(e)}>Edit</button>
                                                        <button className="modal-btn danger modal-btn-sm" onClick={() => handleDeleteTimelineEntry(e.TimelineId)}>Delete</button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}

                                {!readOnly && (
                                    <>
                                        <div className="modal-section-label" style={{ marginTop: timeline.length ? '1rem' : 0 }}>Add Entry</div>
                                        <label className="modal-label">
                                            Date
                                            <input
                                                type="date"
                                                className="modal-input"
                                                value={newEntryDate}
                                                onChange={e => setNewEntryDate(e.target.value)}
                                            />
                                        </label>
                                        <label className="modal-label">
                                            Description
                                            <textarea
                                                className="modal-input"
                                                rows={2}
                                                placeholder="What happened?"
                                                value={newEntryDesc}
                                                onChange={e => setNewEntryDesc(e.target.value)}
                                            />
                                        </label>
                                        <button
                                            className="modal-btn primary"
                                            onClick={handleAddTimelineEntry}
                                            disabled={!newEntryDesc.trim()}
                                            style={{ alignSelf: 'flex-start' }}
                                        >
                                            Add
                                        </button>
                                    </>
                                )}
                            </div>
                        </Tabs.Panel>
                    )}

                    {/* Attachments Tab */}
                    {showAttachmentsTab && (
                        <Tabs.Panel className="modal-tab-panel" value="attachments">
                            <div className="modal-body">
                                {attachments.length === 0 && (
                                    <span className="modal-partner-none">No attachments yet</span>
                                )}
                                {attachments.map(a => (
                                    <div key={a.AttachmentId} className="modal-attachment-row">
                                        {!readOnly && editingId === a.AttachmentId ? (
                                            <>
                                                <div className="modal-attachment-fields">
                                                    <input
                                                        type="text"
                                                        className="modal-input"
                                                        placeholder="Label"
                                                        value={editLabel}
                                                        onChange={e => setEditLabel(e.target.value)}
                                                    />
                                                    <input
                                                        type="url"
                                                        className="modal-input"
                                                        placeholder="URL"
                                                        value={editUrl}
                                                        onChange={e => setEditUrl(e.target.value)}
                                                    />
                                                </div>
                                                <div className="modal-attachment-actions">
                                                    <button className="modal-btn primary modal-btn-sm" onClick={handleSaveEdit}>Save</button>
                                                    <button className="modal-btn secondary modal-btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="modal-attachment-info">
                                                    <span className="modal-attachment-label">{a.Label}</span>
                                                    <a className="modal-attachment-url" href={a.Url} target="_blank" rel="noopener noreferrer">
                                                        {a.Url}
                                                    </a>
                                                </div>
                                                {!readOnly && (
                                                    <div className="modal-attachment-actions">
                                                        <button className="modal-btn secondary modal-btn-sm" onClick={() => handleStartEdit(a)}>Edit</button>
                                                        <button className="modal-btn danger modal-btn-sm" onClick={() => handleDeleteAttachment(a.AttachmentId)}>Delete</button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}

                                {!readOnly && (
                                    <>
                                        <div className="modal-section-label" style={{ marginTop: attachments.length ? '1rem' : 0 }}>Add Attachment</div>
                                        <label className="modal-label">
                                            Label
                                            <input
                                                type="text"
                                                className="modal-input"
                                                placeholder="e.g. Ancestry profile"
                                                value={newLabel}
                                                onChange={e => setNewLabel(e.target.value)}
                                            />
                                        </label>
                                        <label className="modal-label">
                                            URL
                                            <input
                                                type="url"
                                                className="modal-input"
                                                placeholder="https://..."
                                                value={newUrl}
                                                onChange={e => setNewUrl(e.target.value)}
                                            />
                                        </label>
                                        <button
                                            className="modal-btn primary"
                                            onClick={handleAddAttachment}
                                            disabled={!newLabel.trim() || !newUrl.trim()}
                                            style={{ alignSelf: 'flex-start' }}
                                        >
                                            Add
                                        </button>
                                    </>
                                )}
                            </div>
                        </Tabs.Panel>
                    )}

                    {/* Families Tab */}
                    {showFamiliesTab && (
                        <Tabs.Panel className="modal-tab-panel" value="families">
                            <div className="modal-body">
                                <div className="modal-section-label">Current Families</div>
                                {memberFamilies.length === 0 && (
                                    <span className="modal-partner-none">Not assigned to any family</span>
                                )}
                                {memberFamilies.map(f => (
                                    <div key={f.FamilyGroupId} className="modal-couple-current">
                                        <span className="modal-partner-name">{f.FamilyName}</span>
                                        {!readOnly && onRemoveFromFamily && (
                                            <button
                                                className="modal-btn danger modal-btn-sm"
                                                onClick={() => {
                                                    if (memberFamilies.length === 1) {
                                                        setRemoveWarningFamilyId(f.FamilyGroupId);
                                                    } else {
                                                        onRemoveFromFamily(member.FamilyMemberId, f.FamilyGroupId);
                                                        setMemberFamilies(prev => prev.filter(x => x.FamilyGroupId !== f.FamilyGroupId));
                                                    }
                                                }}
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {!readOnly && removeWarningFamilyId !== null && (
                                    <div className="modal-warning">
                                        This is the only family this member belongs to. Removing them will leave them unassigned. Continue?
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                            <button
                                                className="modal-btn danger modal-btn-sm"
                                                onClick={() => {
                                                    onRemoveFromFamily?.(member.FamilyMemberId, removeWarningFamilyId);
                                                    setMemberFamilies([]);
                                                    setRemoveWarningFamilyId(null);
                                                }}
                                            >
                                                Remove Anyway
                                            </button>
                                            <button className="modal-btn secondary modal-btn-sm" onClick={() => setRemoveWarningFamilyId(null)}>
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {!readOnly && onAddToFamily && (() => {
                                    const currentIds = new Set(memberFamilies.map(f => f.FamilyGroupId));
                                    const available = familyOptions!.filter(f => !currentIds.has(f.FamilyGroupId));
                                    if (available.length === 0) return null;
                                    return (
                                        <>
                                            <div className="modal-section-label" style={{ marginTop: '1rem' }}>Add to Family</div>
                                            <div className="modal-couple-row">
                                                <select
                                                    className="modal-input"
                                                    value={selectedAddFamilyId}
                                                    onChange={e => setSelectedAddFamilyId(e.target.value)}
                                                >
                                                    <option value="">Select family…</option>
                                                    {available.map(f => (
                                                        <option key={f.FamilyGroupId} value={String(f.FamilyGroupId)}>{f.FamilyName}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    className="modal-btn primary modal-btn-sm"
                                                    disabled={!selectedAddFamilyId}
                                                    onClick={() => {
                                                        const fid = Number(selectedAddFamilyId);
                                                        onAddToFamily(member.FamilyMemberId, fid);
                                                        const added = familyOptions!.find(f => f.FamilyGroupId === fid);
                                                        if (added) setMemberFamilies(prev => [...prev, added]);
                                                        setSelectedAddFamilyId('');
                                                    }}
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </Tabs.Panel>
                    )}
                </Tabs.Root>
            </div>
        </div>
    );
}
