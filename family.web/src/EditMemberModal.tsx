import { useState, useEffect, useCallback } from 'react';
import { Tabs } from '@base-ui-components/react/tabs';
import './EditMemberModal.css';
import type { CoupleRelationshipType } from './tree/types';
import type { Database } from 'sql.js';
import type { S3Config } from './S3Service';
import { isImageKey, getSignedUrl, uploadToS3 } from './S3Service';
import {
    queryAttachments, addAttachment, updateAttachment, deleteAttachment,
    setProfilePicture, clearProfilePicture,
    saveDbToLocalStorage, queryMemberFamilyGroups,
    queryTimeline, addTimelineEntry, updateTimelineEntry, deleteTimelineEntry,
    queryTimelineTagsForMember, addTimelineTag, removeTimelineTag,
} from './SqliteService';

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
    IsProfilePicture: number;
    TimelineId: number | null;
    IsS3: number;
};

type FamilyOption = {
    FamilyGroupId: number;
    FamilyName: string;
};

type MemberFamily = {
    FamilyGroupId: number;
    FamilyName: string;
};

type TimelineEntry = {
    TimelineId: number;
    DateOccurred: string | null;
    Description: string | null;
    DateModified: string | null;
};

type TimelineTag = {
    TagId: number;
    TimelineId: number;
    FamilyMemberId: number;
    MemberName: string;
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
    s3Config?: S3Config | null;
    onSave: (id: number, data: { firstName: string; middleName: string; lastName: string; birthDate: string; gender: string; deceasedDate: string; description: string; originCoupleId: number | null }) => void;
    onClose: () => void;
    onAssignCouple?: (memberId: number, partnerId: number, relationshipType: CoupleRelationshipType) => void;
    onRemoveCouple?: (memberId: number) => void;
    onAddToFamily?: (memberId: number, familyGroupId: number) => void;
    onRemoveFromFamily?: (memberId: number, familyGroupId: number) => void;
    onSwitchFamily?: (familyId: number) => void;
    onDataChange?: () => void;
};

// ── Image viewer sub-modal ──────────────────────────────────────────────────

function ImageViewer({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
    return (
        <div className="modal-overlay image-viewer-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
            <div className="image-viewer-modal" onClick={e => e.stopPropagation()}>
                <div className="image-viewer-header">
                    <span className="image-viewer-label">{label}</span>
                    <button className="modal-close" onClick={onClose}>&#10005;</button>
                </div>
                <div className="image-viewer-body">
                    <img src={url} alt={label} className="image-viewer-img" />
                </div>
            </div>
        </div>
    );
}

// ── Main component ──────────────────────────────────────────────────────────

export function EditMemberModal({
    member, allMembers, couples, familyOptions, db, readOnly = false,
    currentFamilyId, s3Config, onSave, onClose,
    onAssignCouple, onRemoveCouple, onAddToFamily, onRemoveFromFamily,
    onSwitchFamily, onDataChange,
}: EditMemberModalProps) {

    // ── Details state ──
    const [firstName, setFirstName] = useState(member.FirstName ?? '');
    const [middleName, setMiddleName] = useState(member.MiddleName ?? '');
    const [lastName, setLastName] = useState(member.LastName ?? '');
    const [gender, setGender] = useState(member.Gender ?? 'Male');
    const [birthDate, setBirthDate] = useState(member.BirthDate ?? '');
    const [deceasedDate, setDeceasedDate] = useState(member.DeceasedDate ?? '');
    const [description, setDescription] = useState(member.Description ?? '');
    const [originCoupleId, setOriginCoupleId] = useState<number | null>(member.OriginCoupleId ?? null);

    // ── Couple state ──
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

    // ── Attachments state ──
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [signedUrls, setSignedUrls] = useState<Map<number, string>>(new Map());
    const [newLabel, setNewLabel] = useState('');
    const [newUrl, setNewUrl] = useState('');
    const [newTimelineLink, setNewTimelineLink] = useState<string>('');
    const [addMode, setAddMode] = useState<'link' | 'upload'>('link');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [editUrl, setEditUrl] = useState('');
    const [editTimelineLink, setEditTimelineLink] = useState<string>('');
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [lightboxLabel, setLightboxLabel] = useState('');

    // ── Timeline state ──
    const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
    const [newEntryDate, setNewEntryDate] = useState('');
    const [newEntryDesc, setNewEntryDesc] = useState('');
    const [editingTimelineId, setEditingTimelineId] = useState<number | null>(null);
    const [editTimelineDate, setEditTimelineDate] = useState('');
    const [editTimelineDesc, setEditTimelineDesc] = useState('');
    const [timelineTags, setTimelineTags] = useState<Map<number, TimelineTag[]>>(new Map());
    const [tagSelects, setTagSelects] = useState<Map<number, string>>(new Map());

    // ── Families state ──
    const [memberFamilies, setMemberFamilies] = useState<MemberFamily[]>([]);
    const [removeWarningFamilyId, setRemoveWarningFamilyId] = useState<number | null>(null);
    const [selectedAddFamilyId, setSelectedAddFamilyId] = useState('');

    // ── Load data on mount ──
    const refreshAttachments = useCallback(() => {
        if (!db) return;
        try {
            setAttachments(queryAttachments(db, member.FamilyMemberId) as Attachment[]);
        } catch { /* older DB */ }
    }, [db, member.FamilyMemberId]);

    const refreshTimeline = useCallback(() => {
        if (!db) return;
        try {
            setTimeline(queryTimeline(db, member.FamilyMemberId) as TimelineEntry[]);
        } catch { /* older DB */ }
    }, [db, member.FamilyMemberId]);

    const refreshTimelineTags = useCallback(() => {
        if (!db) return;
        try {
            const rows = queryTimelineTagsForMember(db, member.FamilyMemberId) as TimelineTag[];
            const map = new Map<number, TimelineTag[]>();
            for (const r of rows) {
                if (!map.has(r.TimelineId)) map.set(r.TimelineId, []);
                map.get(r.TimelineId)!.push(r);
            }
            setTimelineTags(map);
        } catch { /* older DB */ }
    }, [db, member.FamilyMemberId]);

    useEffect(() => {
        if (!db) return;
        refreshAttachments();
        refreshTimeline();
        refreshTimelineTags();
        try {
            setMemberFamilies(queryMemberFamilyGroups(db, member.FamilyMemberId) as MemberFamily[]);
        } catch { /* */ }
    }, [db, member.FamilyMemberId, refreshAttachments, refreshTimeline, refreshTimelineTags]);

    // Fetch signed URLs whenever attachments or s3Config change
    useEffect(() => {
        if (!s3Config || attachments.length === 0) return;
        let cancelled = false;
        const s3Attachments = attachments.filter(a => a.IsS3);
        if (!s3Attachments.length) return;

        (async () => {
            const entries: [number, string][] = [];
            for (const a of s3Attachments) {
                try {
                    const url = await getSignedUrl(s3Config, a.Url);
                    entries.push([a.AttachmentId, url]);
                } catch { /* skip */ }
            }
            if (!cancelled) setSignedUrls(new Map(entries));
        })();

        return () => { cancelled = true; };
    }, [attachments, s3Config]);

    // ── Helpers ──
    const resolveUrl = (a: Attachment) => a.IsS3 ? (signedUrls.get(a.AttachmentId) ?? '') : a.Url;

    // ── Handlers: details ──
    const handleSave = () => {
        onSave(member.FamilyMemberId, { firstName, middleName, lastName, birthDate, gender, deceasedDate, description, originCoupleId });
    };

    // ── Handlers: couple ──
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

    // ── Handlers: attachments ──
    const handleAddLink = () => {
        if (!db || !newLabel.trim() || !newUrl.trim()) return;
        addAttachment(db, member.FamilyMemberId, newLabel.trim(), newUrl.trim(), {
            timelineId: newTimelineLink ? Number(newTimelineLink) : null,
        });
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshAttachments();
        setNewLabel(''); setNewUrl(''); setNewTimelineLink('');
    };

    const handleUploadAndAdd = async () => {
        if (!db || !s3Config || !uploadFile || !newLabel.trim()) return;
        setIsUploading(true);
        setUploadError(null);
        try {
            const key = await uploadToS3(s3Config, uploadFile);
            addAttachment(db, member.FamilyMemberId, newLabel.trim(), key, {
                isS3: true,
                timelineId: newTimelineLink ? Number(newTimelineLink) : null,
            });
            saveDbToLocalStorage(db);
            onDataChange?.();
            refreshAttachments();
            setNewLabel(''); setUploadFile(null); setNewTimelineLink('');
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setIsUploading(false);
        }
    };

    const handleStartEdit = (a: Attachment) => {
        setEditingId(a.AttachmentId);
        setEditLabel(a.Label);
        setEditUrl(a.Url);
        setEditTimelineLink(a.TimelineId != null ? String(a.TimelineId) : '');
    };

    const handleSaveEdit = () => {
        if (!db || editingId === null || !editLabel.trim()) return;
        const urlVal = editUrl.trim();
        if (!urlVal) return;
        updateAttachment(db, editingId, editLabel.trim(), urlVal, {
            timelineId: editTimelineLink ? Number(editTimelineLink) : null,
        });
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshAttachments();
        setEditingId(null);
    };

    const handleDeleteAttachment = (id: number) => {
        if (!db) return;
        deleteAttachment(db, id);
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshAttachments();
    };

    const handleSetProfilePicture = (a: Attachment) => {
        if (!db) return;
        if (a.IsProfilePicture) {
            clearProfilePicture(db, member.FamilyMemberId);
        } else {
            setProfilePicture(db, member.FamilyMemberId, a.AttachmentId);
        }
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshAttachments();
    };

    const handleOpenImage = (a: Attachment) => {
        const url = resolveUrl(a);
        if (!url) return;
        setLightboxLabel(a.Label);
        setLightboxUrl(url);
    };

    // ── Handlers: timeline ──
    const handleAddTimelineEntry = () => {
        if (!db || !newEntryDesc.trim()) return;
        addTimelineEntry(db, member.FamilyMemberId, newEntryDate, newEntryDesc.trim());
        saveDbToLocalStorage(db);
        onDataChange?.();
        refreshTimeline();
        setNewEntryDate(''); setNewEntryDesc('');
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
        refreshTimelineTags();
    };

    // ── Handlers: timeline tags ──
    const handleAddTag = (timelineId: number) => {
        if (!db) return;
        const memberId = tagSelects.get(timelineId);
        if (!memberId) return;
        addTimelineTag(db, timelineId, Number(memberId));
        saveDbToLocalStorage(db);
        refreshTimelineTags();
        setTagSelects(prev => { const m = new Map(prev); m.delete(timelineId); return m; });
    };

    const handleRemoveTag = (tagId: number) => {
        if (!db) return;
        removeTimelineTag(db, tagId);
        saveDbToLocalStorage(db);
        refreshTimelineTags();
    };

    // ── Visibility flags ──
    const availablePartners = allMembers?.filter(m => m.FamilyMemberId !== member.FamilyMemberId) ?? [];
    const showCoupleSection = !!allMembers && (!!onAssignCouple || !!onRemoveCouple);
    const isUpdatingExisting = !!currentPartner && selectedPartnerId === String(currentPartner.FamilyMemberId);
    const showCoupleTab = showCoupleSection && (!readOnly || !!currentPartner);
    const showFamiliesTab = !!(db && familyOptions) && (!readOnly || memberFamilies.length > 0);
    const showTimelineTab = !!db && (!readOnly || timeline.length > 0);
    const showAttachmentsTab = !!db && (!readOnly || attachments.length > 0);

    return (
        <>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>{readOnly ? `${member.FirstName} ${member.LastName}` : 'Edit Family Member'}</h2>
                        <button className="modal-close" onClick={onClose}>&#x2715;</button>
                    </div>

                    <Tabs.Root className="modal-tabs" defaultValue="details">
                        <Tabs.List className="modal-tab-list">
                            <Tabs.Tab className="modal-tab" value="details">Details</Tabs.Tab>
                            {showCoupleTab && <Tabs.Tab className="modal-tab" value="couple">Couple</Tabs.Tab>}
                            {showFamiliesTab && <Tabs.Tab className="modal-tab" value="families">Families</Tabs.Tab>}
                            {showTimelineTab && <Tabs.Tab className="modal-tab" value="timeline">Timeline</Tabs.Tab>}
                            {showAttachmentsTab && <Tabs.Tab className="modal-tab" value="attachments">Attachments</Tabs.Tab>}
                        </Tabs.List>

                        {/* ── Details Tab ── */}
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

                        {/* ── Couple Tab ── */}
                        {showCoupleTab && (
                            <Tabs.Panel className="modal-tab-panel" value="couple">
                                <div className="modal-body">
                                    <div className="modal-section-label">Current Partner</div>
                                    {currentPartner ? (
                                        <div className="modal-couple-current">
                                            <span className="modal-partner-name">{currentPartner.FirstName} {currentPartner.LastName}</span>
                                            {!readOnly && onRemoveCouple && (
                                                <button className="modal-btn danger modal-btn-sm" onClick={handleRemoveCouple}>Remove</button>
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
                                                <select className="modal-input" value={selectedPartnerId} onChange={e => setSelectedPartnerId(e.target.value)}>
                                                    <option value="">Select partner…</option>
                                                    {availablePartners.map(m => (
                                                        <option key={m.FamilyMemberId} value={String(m.FamilyMemberId)}>
                                                            {m.FirstName} {m.LastName}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="modal-couple-row">
                                                <select className="modal-input" value={selectedRelType} onChange={e => setSelectedRelType(e.target.value as CoupleRelationshipType)}>
                                                    {COUPLE_RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                                <button className="modal-btn primary modal-btn-sm" onClick={handleAssignCouple} disabled={!selectedPartnerId}>
                                                    {isUpdatingExisting ? 'Update' : 'Assign'}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </Tabs.Panel>
                        )}

                        {/* ── Timeline Tab ── */}
                        {showTimelineTab && (
                            <Tabs.Panel className="modal-tab-panel" value="timeline">
                                <div className="modal-body">
                                    {timeline.length === 0 && (
                                        <span className="modal-partner-none">No timeline entries yet</span>
                                    )}
                                    {timeline.map(e => {
                                        const tags = timelineTags.get(e.TimelineId) ?? [];
                                        const taggableMembers = allMembers?.filter(
                                            m => m.FamilyMemberId !== member.FamilyMemberId && !tags.some(t => t.FamilyMemberId === m.FamilyMemberId)
                                        ) ?? [];
                                        return (
                                            <div key={e.TimelineId} className="modal-timeline-row">
                                                {!readOnly && editingTimelineId === e.TimelineId ? (
                                                    <>
                                                        <div className="modal-attachment-fields">
                                                            <input type="date" className="modal-input" value={editTimelineDate} onChange={ev => setEditTimelineDate(ev.target.value)} />
                                                            <textarea className="modal-input" rows={2} value={editTimelineDesc} onChange={ev => setEditTimelineDesc(ev.target.value)} />
                                                        </div>
                                                        <div className="modal-attachment-actions">
                                                            <button className="modal-btn primary modal-btn-sm" onClick={handleSaveEditTimeline} disabled={!editTimelineDesc.trim()}>Save</button>
                                                            <button className="modal-btn secondary modal-btn-sm" onClick={() => setEditingTimelineId(null)}>Cancel</button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="modal-timeline-info">
                                                            {e.DateOccurred && <span className="modal-timeline-date">{e.DateOccurred}</span>}
                                                            <span className="modal-timeline-desc">{e.Description}</span>
                                                        </div>

                                                        {/* Tagged members */}
                                                        {(tags.length > 0 || (!readOnly && allMembers && allMembers.length > 1)) && (
                                                            <div className="modal-timeline-tags">
                                                                {tags.map(tag => (
                                                                    <span key={tag.TagId} className="modal-tag-chip">
                                                                        {tag.MemberName}
                                                                        {!readOnly && (
                                                                            <button className="modal-tag-remove" onClick={() => handleRemoveTag(tag.TagId)} title="Remove tag">&#x2715;</button>
                                                                        )}
                                                                    </span>
                                                                ))}
                                                                {!readOnly && taggableMembers.length > 0 && (
                                                                    <div className="modal-tag-add-row">
                                                                        <select
                                                                            className="modal-input modal-input-sm"
                                                                            value={tagSelects.get(e.TimelineId) ?? ''}
                                                                            onChange={ev => setTagSelects(prev => { const m = new Map(prev); m.set(e.TimelineId, ev.target.value); return m; })}
                                                                        >
                                                                            <option value="">Tag member…</option>
                                                                            {taggableMembers.map(m => (
                                                                                <option key={m.FamilyMemberId} value={String(m.FamilyMemberId)}>{m.FirstName} {m.LastName}</option>
                                                                            ))}
                                                                        </select>
                                                                        <button
                                                                            className="modal-btn secondary modal-btn-sm"
                                                                            onClick={() => handleAddTag(e.TimelineId)}
                                                                            disabled={!tagSelects.get(e.TimelineId)}
                                                                        >
                                                                            Tag
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {!readOnly && (
                                                            <div className="modal-attachment-actions">
                                                                <button className="modal-btn secondary modal-btn-sm" onClick={() => handleStartEditTimeline(e)}>Edit</button>
                                                                <button className="modal-btn danger modal-btn-sm" onClick={() => handleDeleteTimelineEntry(e.TimelineId)}>Delete</button>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {!readOnly && (
                                        <>
                                            <div className="modal-section-label" style={{ marginTop: timeline.length ? '1rem' : 0 }}>Add Entry</div>
                                            <label className="modal-label">
                                                Date
                                                <input type="date" className="modal-input" value={newEntryDate} onChange={e => setNewEntryDate(e.target.value)} />
                                            </label>
                                            <label className="modal-label">
                                                Description
                                                <textarea className="modal-input" rows={2} placeholder="What happened?" value={newEntryDesc} onChange={e => setNewEntryDesc(e.target.value)} />
                                            </label>
                                            <button className="modal-btn primary" onClick={handleAddTimelineEntry} disabled={!newEntryDesc.trim()} style={{ alignSelf: 'flex-start' }}>
                                                Add
                                            </button>
                                        </>
                                    )}
                                </div>
                            </Tabs.Panel>
                        )}

                        {/* ── Attachments Tab ── */}
                        {showAttachmentsTab && (
                            <Tabs.Panel className="modal-tab-panel" value="attachments">
                                <div className="modal-body">
                                    {attachments.length === 0 && (
                                        <span className="modal-partner-none">No attachments yet</span>
                                    )}
                                    {attachments.map(a => {
                                        const resolvedUrl = resolveUrl(a);
                                        const isImg = isImageKey(a.IsS3 ? a.Url : a.Url);
                                        const canShowImg = isImg && (!a.IsS3 || !!resolvedUrl);
                                        return (
                                            <div key={a.AttachmentId} className={`modal-attachment-row ${a.IsProfilePicture ? 'is-profile-pic' : ''}`}>
                                                {!readOnly && editingId === a.AttachmentId ? (
                                                    <>
                                                        <div className="modal-attachment-fields">
                                                            <input type="text" className="modal-input" placeholder="Label" value={editLabel} onChange={e => setEditLabel(e.target.value)} />
                                                            {!a.IsS3 && (
                                                                <input type="url" className="modal-input" placeholder="URL" value={editUrl} onChange={e => setEditUrl(e.target.value)} />
                                                            )}
                                                            {timeline.length > 0 && (
                                                                <select className="modal-input" value={editTimelineLink} onChange={e => setEditTimelineLink(e.target.value)}>
                                                                    <option value="">No timeline link</option>
                                                                    {timeline.map(t => (
                                                                        <option key={t.TimelineId} value={String(t.TimelineId)}>
                                                                            {t.DateOccurred ? `${t.DateOccurred} — ` : ''}{(t.Description ?? '').slice(0, 40)}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                        </div>
                                                        <div className="modal-attachment-actions">
                                                            <button className="modal-btn primary modal-btn-sm" onClick={handleSaveEdit} disabled={!editLabel.trim() || (!a.IsS3 && !editUrl.trim())}>Save</button>
                                                            <button className="modal-btn secondary modal-btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className="modal-attachment-info">
                                                            <div className="modal-attachment-label-row">
                                                                {a.IsProfilePicture ? (
                                                                    <span className="modal-profile-badge" title="Profile picture">&#9733;</span>
                                                                ) : null}
                                                                <span className="modal-attachment-label">{a.Label}</span>
                                                                {a.IsS3 && <span className="modal-s3-badge" title="Stored in S3">S3</span>}
                                                            </div>
                                                            {resolvedUrl ? (
                                                                <a className="modal-attachment-url" href={resolvedUrl} target="_blank" rel="noopener noreferrer">
                                                                    {a.IsS3 ? a.Url : a.Url}
                                                                </a>
                                                            ) : a.IsS3 ? (
                                                                <span className="modal-attachment-url" style={{ fontStyle: 'italic', color: '#5a617e' }}>Generating URL…</span>
                                                            ) : null}
                                                            {a.TimelineId != null && (() => {
                                                                const t = timeline.find(te => te.TimelineId === a.TimelineId);
                                                                return t ? (
                                                                    <span className="modal-attachment-timeline-link">
                                                                        &#128337; {t.DateOccurred ? `${t.DateOccurred} — ` : ''}{(t.Description ?? '').slice(0, 30)}
                                                                    </span>
                                                                ) : null;
                                                            })()}
                                                        </div>
                                                        <div className="modal-attachment-actions">
                                                            {canShowImg && (
                                                                <button
                                                                    className="modal-btn secondary modal-btn-sm modal-btn-icon"
                                                                    title="View image"
                                                                    onClick={() => handleOpenImage(a)}
                                                                    disabled={a.IsS3 && !resolvedUrl}
                                                                >
                                                                    &#128444;
                                                                </button>
                                                            )}
                                                            {!readOnly && (
                                                                <>
                                                                    <button
                                                                        className={`modal-btn modal-btn-sm modal-btn-icon ${a.IsProfilePicture ? 'primary' : 'secondary'}`}
                                                                        title={a.IsProfilePicture ? 'Remove as profile picture' : 'Set as profile picture'}
                                                                        onClick={() => handleSetProfilePicture(a)}
                                                                    >
                                                                        {a.IsProfilePicture ? '★' : '☆'}
                                                                    </button>
                                                                    <button className="modal-btn secondary modal-btn-sm" onClick={() => handleStartEdit(a)}>Edit</button>
                                                                    <button className="modal-btn danger modal-btn-sm" onClick={() => handleDeleteAttachment(a.AttachmentId)}>Delete</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {!readOnly && (
                                        <>
                                            <div className="modal-section-label" style={{ marginTop: attachments.length ? '1rem' : 0 }}>
                                                Add Attachment
                                                {s3Config && (
                                                    <span className="modal-add-mode-toggle">
                                                        <button
                                                            className={`modal-mode-btn ${addMode === 'link' ? 'active' : ''}`}
                                                            onClick={() => { setAddMode('link'); setUploadFile(null); setUploadError(null); }}
                                                        >Link</button>
                                                        <button
                                                            className={`modal-mode-btn ${addMode === 'upload' ? 'active' : ''}`}
                                                            onClick={() => { setAddMode('upload'); setNewUrl(''); }}
                                                        >Upload</button>
                                                    </span>
                                                )}
                                            </div>

                                            <label className="modal-label">
                                                Label
                                                <input type="text" className="modal-input" placeholder="e.g. Ancestry profile" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
                                            </label>

                                            {addMode === 'link' || !s3Config ? (
                                                <label className="modal-label">
                                                    URL
                                                    <input type="url" className="modal-input" placeholder="https://…" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
                                                </label>
                                            ) : (
                                                <label className="modal-label">
                                                    File
                                                    <input
                                                        type="file"
                                                        className="modal-input"
                                                        onChange={e => { setUploadFile(e.target.files?.[0] ?? null); setUploadError(null); }}
                                                    />
                                                </label>
                                            )}

                                            {timeline.length > 0 && (
                                                <label className="modal-label">
                                                    Link to Timeline Event (optional)
                                                    <select className="modal-input" value={newTimelineLink} onChange={e => setNewTimelineLink(e.target.value)}>
                                                        <option value="">None</option>
                                                        {timeline.map(t => (
                                                            <option key={t.TimelineId} value={String(t.TimelineId)}>
                                                                {t.DateOccurred ? `${t.DateOccurred} — ` : ''}{(t.Description ?? '').slice(0, 40)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>
                                            )}

                                            {uploadError && (
                                                <div className="modal-warning" style={{ padding: '0.5rem 0.75rem' }}>{uploadError}</div>
                                            )}

                                            {(addMode === 'link' || !s3Config) ? (
                                                <button
                                                    className="modal-btn primary"
                                                    onClick={handleAddLink}
                                                    disabled={!newLabel.trim() || !newUrl.trim()}
                                                    style={{ alignSelf: 'flex-start' }}
                                                >
                                                    Add
                                                </button>
                                            ) : (
                                                <button
                                                    className="modal-btn primary"
                                                    onClick={handleUploadAndAdd}
                                                    disabled={!newLabel.trim() || !uploadFile || isUploading}
                                                    style={{ alignSelf: 'flex-start' }}
                                                >
                                                    {isUploading ? 'Uploading…' : 'Upload & Save'}
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </Tabs.Panel>
                        )}

                        {/* ── Families Tab ── */}
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
                                                <button className="modal-btn danger modal-btn-sm" onClick={() => {
                                                    onRemoveFromFamily?.(member.FamilyMemberId, removeWarningFamilyId);
                                                    setMemberFamilies([]);
                                                    setRemoveWarningFamilyId(null);
                                                }}>Remove Anyway</button>
                                                <button className="modal-btn secondary modal-btn-sm" onClick={() => setRemoveWarningFamilyId(null)}>Cancel</button>
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
                                                    <select className="modal-input" value={selectedAddFamilyId} onChange={e => setSelectedAddFamilyId(e.target.value)}>
                                                        <option value="">Select family…</option>
                                                        {available.map(f => <option key={f.FamilyGroupId} value={String(f.FamilyGroupId)}>{f.FamilyName}</option>)}
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
                                                    >Add</button>
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

            {lightboxUrl && (
                <ImageViewer url={lightboxUrl} label={lightboxLabel} onClose={() => setLightboxUrl(null)} />
            )}
        </>
    );
}
