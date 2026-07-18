import type { Database } from 'sql.js';
import type { ApiClient } from './ApiService';
import type { CoupleRelationshipType } from './tree/types';

export type ApiSource = { type: 'api'; client: ApiClient };
export type SqliteSource = { type: 'sqlite'; db: Database };
export type DataSource = ApiSource | SqliteSource;

// ── Shared row shapes (SqliteService and the API return the same columns) ──

export type FamilyMemberRow = {
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

export type CoupleRow = {
    CoupleId: number;
    ParterFamilyMemberId: number;
    OtherPartnerFamilyMemberId: number;
    RelationshipType: CoupleRelationshipType;
    PartnerName: string;
    OtherPartnerName: string;
};

export type FamilyOption = {
    FamilyGroupId: number;
    FamilyHeadId: number | null;
    FamilyName: string;
};

export type MemberFamily = {
    FamilyGroupId: number;
    FamilyName: string;
};

export type AttachmentRow = {
    AttachmentId: number;
    Label: string;
    Url: string;
};

export type TimelineRow = {
    TimelineId: number;
    DateOccurred: string | null;
    Description: string | null;
    DateModified: string | null;
};

export type MemberEditData = {
    firstName: string;
    middleName: string;
    lastName: string;
    birthDate: string;
    gender: string;
    deceasedDate: string;
    description: string;
    originCoupleId: number | null;
};

export type NewMemberData = {
    firstName: string;
    lastName: string;
    birthDate: string;
    gender: string;
    originCoupleId: number | null;
};

export type AccessTokenRow = {
    TokenId: number;
    Name: string;
    IsAdmin: boolean;
    HasWriteRights: boolean;
    Expires: string | null;
    FamilyIdGroupRights: string | null;
    IsDeleted: boolean;
};
