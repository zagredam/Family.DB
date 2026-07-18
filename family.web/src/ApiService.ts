import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type {
    AccessTokenRow, AttachmentRow, CoupleRow, FamilyMemberRow, FamilyOption,
    MemberEditData, MemberFamily, NewMemberData, TimelineRow
} from './dataTypes';
import type { CoupleRelationshipType } from './tree/types';

export type ApiSession = {
    url: string;
    accessToken: string;
    refreshToken: string;
    tokenName: string;
    isAdmin: boolean;
    hasWriteRights: boolean;
    familyIdGroupRights: string;
};

type LoginResponse = {
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
    tokenName: string;
    isAdmin: boolean;
    hasWriteRights: boolean;
    familyIdGroupRights: string;
};

export type NewTokenRequest = {
    name: string;
    isAdmin: boolean;
    hasWriteRights: boolean;
    expires: string | null;
    familyIdGroupRights: string | null;
};

const SESSION_KEY = 'family_api_session';

function normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

function sessionFromLogin(url: string, data: LoginResponse): ApiSession {
    return {
        url,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenName: data.tokenName,
        isAdmin: data.isAdmin,
        hasWriteRights: data.hasWriteRights,
        familyIdGroupRights: data.familyIdGroupRights
    };
}

export class ApiClient {
    session: ApiSession;
    private http: AxiosInstance;
    private refreshing: Promise<void> | null = null;

    constructor(session: ApiSession) {
        this.session = session;
        this.http = axios.create({ baseURL: session.url });
        this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
            config.headers.Authorization = `Bearer ${this.session.accessToken}`;
            return config;
        });
        this.http.interceptors.response.use(undefined, async (error: AxiosError) => {
            const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
            if (error.response?.status === 401 && original && !original._retried && this.session.refreshToken) {
                original._retried = true;
                await this.refresh();
                return this.http(original);
            }
            throw error;
        });
    }

    static async login(url: string, tokenSecret: string): Promise<ApiClient> {
        const base = normalizeUrl(url);
        const resp = await axios.post<LoginResponse>(`${base}/auth/login`, { token: tokenSecret });
        const client = new ApiClient(sessionFromLogin(base, resp.data));
        client.persist();
        return client;
    }

    static restore(): ApiClient | null {
        try {
            const stored = localStorage.getItem(SESSION_KEY);
            if (!stored) return null;
            const session = JSON.parse(stored) as ApiSession;
            if (!session.url || !session.accessToken || !session.refreshToken) return null;
            return new ApiClient(session);
        } catch {
            return null;
        }
    }

    static clearStoredSession(): void {
        localStorage.removeItem(SESSION_KEY);
    }

    private persist(): void {
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
        } catch {
            // storage unavailable — session just won't survive a reload
        }
    }

    logout(): void {
        ApiClient.clearStoredSession();
    }

    private async refresh(): Promise<void> {
        // Collapse concurrent 401s into a single refresh request.
        if (!this.refreshing) {
            this.refreshing = axios
                .post<LoginResponse>(`${this.session.url}/auth/refresh`, { refreshToken: this.session.refreshToken })
                .then(resp => {
                    this.session = sessionFromLogin(this.session.url, resp.data);
                    this.persist();
                })
                .finally(() => { this.refreshing = null; });
        }
        return this.refreshing;
    }

    /** Round-trips to the server; also refreshes flags on a restored session. */
    async validate(): Promise<boolean> {
        try {
            const me = await this.http.get<{ tokenName: string; isAdmin: boolean; hasWriteRights: boolean; familyIdGroupRights: string }>('/auth/me');
            this.session = { ...this.session, ...me.data };
            this.persist();
            return true;
        } catch {
            return false;
        }
    }

    // ── Family data ──────────────────────────────────────────────────────────

    async getFamilyOptions(): Promise<{ options: FamilyOption[]; writePermission: boolean }> {
        const resp = await this.http.get<{ FamilyGroups: FamilyOption[]; WritePermission: boolean }>('/family/options');
        return { options: resp.data.FamilyGroups ?? [], writePermission: !!resp.data.WritePermission };
    }

    async getFamily(familyGroupId: number): Promise<{ members: FamilyMemberRow[]; writePermission: boolean }> {
        const resp = await this.http.get<{ FamilyMembers: FamilyMemberRow[]; WritePermission: boolean }>(`/family?familyGroupId=${familyGroupId}`);
        return { members: resp.data.FamilyMembers ?? [], writePermission: !!resp.data.WritePermission };
    }

    async getCouples(): Promise<CoupleRow[]> {
        return (await this.http.get<CoupleRow[]>('/couples')).data;
    }

    async addMember(data: NewMemberData, familyGroupId: number): Promise<number> {
        const resp = await this.http.post<{ FamilyMemberId: number }>('/members', { ...data, familyGroupId });
        return resp.data.FamilyMemberId;
    }

    async updateMember(id: number, data: MemberEditData): Promise<void> {
        await this.http.put(`/members/${id}`, data);
    }

    async addFamilyGroup(name: string): Promise<number> {
        const resp = await this.http.post<{ FamilyGroupId: number }>('/family/groups', { name });
        return resp.data.FamilyGroupId;
    }

    async updateFamilyGroup(id: number, name: string, headId: number | null): Promise<void> {
        await this.http.put(`/family/groups/${id}`, { name, headId });
    }

    async setCouple(memberId: number, partnerId: number, relationshipType: CoupleRelationshipType): Promise<void> {
        await this.http.post('/couples', { memberId, partnerId, relationshipType });
    }

    async removeCouple(memberId: number): Promise<void> {
        await this.http.delete(`/couples/member/${memberId}`);
    }

    async getMemberFamilyGroups(memberId: number): Promise<MemberFamily[]> {
        return (await this.http.get<MemberFamily[]>(`/members/${memberId}/groups`)).data;
    }

    async addMemberToFamilyGroup(memberId: number, familyGroupId: number): Promise<void> {
        await this.http.post(`/members/${memberId}/groups/${familyGroupId}`);
    }

    async removeMemberFromFamilyGroup(memberId: number, familyGroupId: number): Promise<void> {
        await this.http.delete(`/members/${memberId}/groups/${familyGroupId}`);
    }

    async getAttachments(memberId: number): Promise<AttachmentRow[]> {
        return (await this.http.get<AttachmentRow[]>(`/members/${memberId}/attachments`)).data;
    }

    async addAttachment(memberId: number, label: string, url: string): Promise<void> {
        await this.http.post(`/members/${memberId}/attachments`, { label, url });
    }

    async updateAttachment(attachmentId: number, label: string, url: string): Promise<void> {
        await this.http.put(`/attachments/${attachmentId}`, { label, url });
    }

    async deleteAttachment(attachmentId: number): Promise<void> {
        await this.http.delete(`/attachments/${attachmentId}`);
    }

    async getTimeline(memberId: number): Promise<TimelineRow[]> {
        return (await this.http.get<TimelineRow[]>(`/members/${memberId}/timeline`)).data;
    }

    async addTimelineEntry(memberId: number, dateOccurred: string, description: string): Promise<void> {
        await this.http.post(`/members/${memberId}/timeline`, { dateOccurred, description });
    }

    async updateTimelineEntry(timelineId: number, dateOccurred: string, description: string): Promise<void> {
        await this.http.put(`/timeline/${timelineId}`, { dateOccurred, description });
    }

    async deleteTimelineEntry(timelineId: number): Promise<void> {
        await this.http.delete(`/timeline/${timelineId}`);
    }

    // ── Access token management (admin only) ─────────────────────────────────

    async listTokens(includeDeleted = false): Promise<AccessTokenRow[]> {
        return (await this.http.get<AccessTokenRow[]>(`/tokens?includeDeleted=${includeDeleted}`)).data;
    }

    async createToken(request: NewTokenRequest): Promise<{ tokenId: number; tokenSecret: string }> {
        return (await this.http.post<{ tokenId: number; tokenSecret: string }>('/tokens', request)).data;
    }

    async updateToken(tokenId: number, changes: Partial<NewTokenRequest>): Promise<AccessTokenRow> {
        return (await this.http.put<AccessTokenRow>(`/tokens/${tokenId}`, changes)).data;
    }

    async rotateToken(tokenId: number): Promise<{ tokenId: number; tokenSecret: string }> {
        return (await this.http.post<{ tokenId: number; tokenSecret: string }>(`/tokens/${tokenId}/rotate`)).data;
    }

    async deleteToken(tokenId: number): Promise<void> {
        await this.http.delete(`/tokens/${tokenId}`);
    }
}

/** Builds the URL a QR code should encode so scanning it auto-logs-in. */
export function buildAutoLoginUrl(apiUrl: string, tokenSecret: string): string {
    const app = `${window.location.origin}${window.location.pathname}`;
    return `${app}#connect?url=${encodeURIComponent(normalizeUrl(apiUrl))}&token=${encodeURIComponent(tokenSecret)}`;
}

/** Parses (and consumes) an auto-login hash of the form #connect?url=…&token=… */
export function parseAutoLoginHash(): { url: string; token: string } | null {
    const hash = window.location.hash;
    if (!hash.startsWith('#connect?')) return null;
    const params = new URLSearchParams(hash.slice('#connect?'.length));
    const url = params.get('url');
    const token = params.get('token');
    if (!url || !token) return null;
    // Remove the secret from the address bar / history.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return { url, token };
}
