import type { Database } from 'sql.js';
import type { ApiClient } from './ApiService';
import type {
    AttachmentRow, CoupleRow, FamilyMemberRow, FamilyOption,
    MemberEditData, MemberFamily, NewMemberData, TimelineRow
} from './dataTypes';
import type { CoupleRelationshipType } from './tree/types';
import {
    queryFamily, queryFamilyOptions, queryCouples, updateFamilyMember, addFamilyMember,
    addFamilyGroup, updateFamilyGroup, setCoupleAssociation, removeCoupleAssociation,
    queryMemberFamilyGroups, addMemberToFamilyGroup, removeMemberFromFamilyGroup,
    queryAttachments, addAttachment, updateAttachment, deleteAttachment,
    queryTimeline, addTimelineEntry, updateTimelineEntry, deleteTimelineEntry,
    saveDbToLocalStorage
} from './SqliteService';

/**
 * One interface for every data operation the UI performs, implemented over
 * the local sql.js database and over the REST API, so components don't care
 * where the family lives.
 */
export interface FamilyDataClient {
    getFamilyOptions(): Promise<{ options: FamilyOption[]; writePermission: boolean }>;
    getFamily(familyGroupId: number): Promise<FamilyMemberRow[]>;
    getCouples(): Promise<CoupleRow[]>;
    addMember(data: NewMemberData, familyGroupId: number): Promise<number>;
    updateMember(id: number, data: MemberEditData): Promise<void>;
    addFamilyGroup(name: string): Promise<number>;
    updateFamilyGroup(id: number, name: string, headId: number | null): Promise<void>;
    setCouple(memberId: number, partnerId: number, relationshipType: CoupleRelationshipType): Promise<void>;
    removeCouple(memberId: number): Promise<void>;
    getMemberFamilyGroups(memberId: number): Promise<MemberFamily[]>;
    addMemberToFamilyGroup(memberId: number, familyGroupId: number): Promise<void>;
    removeMemberFromFamilyGroup(memberId: number, familyGroupId: number): Promise<void>;
    getAttachments(memberId: number): Promise<AttachmentRow[]>;
    addAttachment(memberId: number, label: string, url: string): Promise<void>;
    updateAttachment(attachmentId: number, label: string, url: string): Promise<void>;
    deleteAttachment(attachmentId: number): Promise<void>;
    getTimeline(memberId: number): Promise<TimelineRow[]>;
    addTimelineEntry(memberId: number, dateOccurred: string, description: string): Promise<void>;
    updateTimelineEntry(timelineId: number, dateOccurred: string, description: string): Promise<void>;
    deleteTimelineEntry(timelineId: number): Promise<void>;
}

export function createSqliteDataClient(db: Database): FamilyDataClient {
    const afterWrite = () => saveDbToLocalStorage(db);
    return {
        getFamilyOptions: async () => ({ options: queryFamilyOptions(db) as FamilyOption[], writePermission: true }),
        getFamily: async (familyGroupId) => queryFamily(db, familyGroupId) as FamilyMemberRow[],
        getCouples: async () => queryCouples(db) as CoupleRow[],
        addMember: async (data, familyGroupId) => {
            const id = addFamilyMember(db, data, familyGroupId);
            afterWrite();
            return id;
        },
        updateMember: async (id, data) => { updateFamilyMember(db, id, data); afterWrite(); },
        addFamilyGroup: async (name) => {
            const id = addFamilyGroup(db, name);
            afterWrite();
            return id;
        },
        updateFamilyGroup: async (id, name, headId) => { updateFamilyGroup(db, id, name, headId); afterWrite(); },
        setCouple: async (memberId, partnerId, relationshipType) => { setCoupleAssociation(db, memberId, partnerId, relationshipType); afterWrite(); },
        removeCouple: async (memberId) => { removeCoupleAssociation(db, memberId); afterWrite(); },
        getMemberFamilyGroups: async (memberId) => queryMemberFamilyGroups(db, memberId) as MemberFamily[],
        addMemberToFamilyGroup: async (memberId, familyGroupId) => { addMemberToFamilyGroup(db, memberId, familyGroupId); afterWrite(); },
        removeMemberFromFamilyGroup: async (memberId, familyGroupId) => { removeMemberFromFamilyGroup(db, memberId, familyGroupId); afterWrite(); },
        getAttachments: async (memberId) => queryAttachments(db, memberId) as AttachmentRow[],
        addAttachment: async (memberId, label, url) => { addAttachment(db, memberId, label, url); afterWrite(); },
        updateAttachment: async (attachmentId, label, url) => { updateAttachment(db, attachmentId, label, url); afterWrite(); },
        deleteAttachment: async (attachmentId) => { deleteAttachment(db, attachmentId); afterWrite(); },
        getTimeline: async (memberId) => queryTimeline(db, memberId) as TimelineRow[],
        addTimelineEntry: async (memberId, dateOccurred, description) => { addTimelineEntry(db, memberId, dateOccurred, description); afterWrite(); },
        updateTimelineEntry: async (timelineId, dateOccurred, description) => { updateTimelineEntry(db, timelineId, dateOccurred, description); afterWrite(); },
        deleteTimelineEntry: async (timelineId) => { deleteTimelineEntry(db, timelineId); afterWrite(); }
    };
}

export function createApiDataClient(api: ApiClient): FamilyDataClient {
    return {
        getFamilyOptions: () => api.getFamilyOptions(),
        getFamily: async (familyGroupId) => (await api.getFamily(familyGroupId)).members,
        getCouples: () => api.getCouples(),
        addMember: (data, familyGroupId) => api.addMember(data, familyGroupId),
        updateMember: (id, data) => api.updateMember(id, data),
        addFamilyGroup: (name) => api.addFamilyGroup(name),
        updateFamilyGroup: (id, name, headId) => api.updateFamilyGroup(id, name, headId),
        setCouple: (memberId, partnerId, relationshipType) => api.setCouple(memberId, partnerId, relationshipType),
        removeCouple: (memberId) => api.removeCouple(memberId),
        getMemberFamilyGroups: (memberId) => api.getMemberFamilyGroups(memberId),
        addMemberToFamilyGroup: (memberId, familyGroupId) => api.addMemberToFamilyGroup(memberId, familyGroupId),
        removeMemberFromFamilyGroup: (memberId, familyGroupId) => api.removeMemberFromFamilyGroup(memberId, familyGroupId),
        getAttachments: (memberId) => api.getAttachments(memberId),
        addAttachment: (memberId, label, url) => api.addAttachment(memberId, label, url),
        updateAttachment: (attachmentId, label, url) => api.updateAttachment(attachmentId, label, url),
        deleteAttachment: (attachmentId) => api.deleteAttachment(attachmentId),
        getTimeline: (memberId) => api.getTimeline(memberId),
        addTimelineEntry: (memberId, dateOccurred, description) => api.addTimelineEntry(memberId, dateOccurred, description),
        updateTimelineEntry: (timelineId, dateOccurred, description) => api.updateTimelineEntry(timelineId, dateOccurred, description),
        deleteTimelineEntry: (timelineId) => api.deleteTimelineEntry(timelineId)
    };
}
