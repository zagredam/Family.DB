import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { FamilyTree } from "./FamilyTree.tsx";
import { FamilyMember, FamilyMembers, FamilyRelations, RelationTypes, CoupleRelationshipType } from "./tree/types";
import { DataSource } from './dataTypes';
import { queryFamily, queryFamilyOptions, updateFamilyMember, addFamilyMember, addFamilyGroup, exportDatabase, saveDbToLocalStorage, setCoupleAssociation, removeCoupleAssociation, queryCouples, addMemberToFamilyGroup, removeMemberFromFamilyGroup } from './SqliteService';
import { EditMemberModal } from './EditMemberModal';
import { AddMemberModal } from './AddMemberModal';
import { Navbar } from './Navbar';

type FamilyMemberRow = {
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

type CoupleRow = {
    CoupleId: number;
    ParterFamilyMemberId: number;
    OtherPartnerFamilyMemberId: number;
    RelationshipType: CoupleRelationshipType;
    PartnerName: string;
    OtherPartnerName: string;
};

type FamilyOption = {
    FamilyGroupId: number;
    FamilyHeadId: number;
    FamilyName: string;
};

type RawFamilyMember = {
    id: string;
    data: {
        badges: { bgColor: string; label: string; textColor: string }[];
        sex: "M" | "F";
        subtitles: string[];
        title: string;
        titleBgColor: string;
        titleTextColor: string;
        imageUrl?: string | null;
    };
};

type RawFamilyRelation = {
    fromId: string;
    toId: string;
    relationType: RelationTypes;
    prettyType: string;
    isInnerFamily: boolean;
};

function buildFamilyAndRelations(rawFamily: RawFamilyMember[], rawRelation: RawFamilyRelation[]) {
    const familyMembers: FamilyMembers = Object.fromEntries(
        rawFamily.map((rawMember) => {
            return [
                rawMember.id,
                {
                    id: rawMember.id,
                    data: {
                        badges: rawMember.data.badges,
                        sex: rawMember.data.sex,
                        imageUrl: rawMember.data.imageUrl,
                        subtitles: rawMember.data.subtitles,
                        title: rawMember.data.title,
                        titleBgColor: rawMember.data.titleBgColor,
                        titleTextColor: rawMember.data.titleTextColor,
                        isHidden: false
                    }
                }
            ] as [string, FamilyMember];
        })
    );

    const familyRelations: FamilyRelations = Object.fromEntries(
        rawRelation.map((rawMember) => {
            const id = `${rawMember.fromId}-${rawMember.toId}`;
            return [
                id,
                {
                    id,
                    to: rawMember.fromId,
                    from: rawMember.toId,
                    relationType: rawMember.relationType,
                    prettyType: rawMember.prettyType,
                    isInnerFamily: rawMember.isInnerFamily
                }
            ];
        })
    );

    return [familyMembers, familyRelations] as const;
}

const ANCESTOR_REL_TYPES: RelationTypes[] = ["Parent", "Grandparent", "Great Grandparent", "Great Great Grandparent", "3x Great Grandparent" as RelationTypes, "4x Great Grandparent" as RelationTypes];
const COLLATERAL_PRETTY = ["Uncle/Aunt", "Great Uncle/Aunt", "2x Great Uncle/Aunt", "3x Great Uncle/Aunt"];

function cousinLabel(cousinNumber: number, removedCount: number): string {
    const ordinals = ['1st', '2nd', '3rd', '4th', '5th'];
    const removed = ['', ' Once Removed', ' Twice Removed', ' Thrice Removed'];
    const n = ordinals[cousinNumber - 1] ?? `${cousinNumber}th`;
    const r = removed[removedCount] ?? ` ${removedCount}x Removed`;
    return `${n} Cousin${r}`;
}

function grandChildType(depth: number): RelationTypes {
    if (depth === 0) return "Grandchild";
    if (depth === 1) return "Great Grandchild";
    if (depth === 2) return "Great Great Grandchild";
    return `${depth - 1}x Great Grandchild` as RelationTypes;
}
function grandParentType(depth: number): RelationTypes {
    if (depth === 0) return "Grandparent";
    if (depth === 1) return "Great Grandparent";
    if (depth === 2) return "Great Great Grandparent";
    return `${depth - 1}x Great Grandparent` as RelationTypes;
}

function buildRawFromApiData(family: FamilyMemberRow[], couples: CoupleRow[]): [RawFamilyMember[], RawFamilyRelation[]] {
    const familyMembers: RawFamilyMember[] = [];
    const familyRelations: RawFamilyRelation[] = [];

    const coupleById = new Map<number, CoupleRow>(couples.map(c => [c.CoupleId, c]));
    const memberCoupleIds = new Map<number, number[]>();
    for (const c of couples) {
        for (const pid of [c.ParterFamilyMemberId, c.OtherPartnerFamilyMemberId]) {
            if (!memberCoupleIds.has(pid)) memberCoupleIds.set(pid, []);
            memberCoupleIds.get(pid)!.push(c.CoupleId);
        }
    }
    const memberById = new Map<number, FamilyMemberRow>(family.map(m => [m.FamilyMemberId, m]));
    const emittedCoupleEdges = new Set<number>();

    const childrenOfCouple = (coupleId: number) => family.filter(f => f.OriginCoupleId === coupleId);
    const partnerOf = (coupleId: number, memberId: number): FamilyMemberRow | null => {
        const c = coupleById.get(coupleId);
        if (!c) return null;
        const pid = c.ParterFamilyMemberId === memberId ? c.OtherPartnerFamilyMemberId : c.ParterFamilyMemberId;
        return memberById.get(pid) ?? null;
    };

    family.forEach(fm => {
        familyMembers.push({
            id: String(fm.FamilyMemberId),
            data: {
                badges: fm.SecondFamilyId ? [{ bgColor: "rgb(100,120,150)", label: "More", textColor: "#000000" }] : [],
                subtitles: (() => {
                    const fmt = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : null;
                    const b = fmt(fm.BirthDate);
                    const d = fmt(fm.DeceasedDate);
                    if (b && d) return [`${b} – ${d}`];
                    if (b) return [`Born ${b}`];
                    if (d) return [`d. ${d}`];
                    return [];
                })(),
                sex: fm.Gender === "Male" ? "M" : "F",
                title: `${fm.FirstName} ${fm.LastName}`,
                titleBgColor: fm.Gender === "Male" ? "rgb(63, 108, 191)" : "rgb(185, 121, 121)",
                titleTextColor: "rgb(240,240,240)"
            },
        });

        const used = new Set<number>([fm.FamilyMemberId]);
        const fmCoupleIds = memberCoupleIds.get(fm.FamilyMemberId) ?? [];
        const fmPartners: FamilyMemberRow[] = [];

        // Couple edges (emit once per couple)
        for (const coupleId of fmCoupleIds) {
            if (!emittedCoupleEdges.has(coupleId)) {
                emittedCoupleEdges.add(coupleId);
                const c = coupleById.get(coupleId)!;
                const relType = c.RelationshipType ?? 'Partner';
                familyRelations.push({ fromId: String(c.OtherPartnerFamilyMemberId), toId: String(c.ParterFamilyMemberId), relationType: relType, prettyType: relType, isInnerFamily: false });
                familyRelations.push({ fromId: String(c.ParterFamilyMemberId), toId: String(c.OtherPartnerFamilyMemberId), relationType: relType, prettyType: relType, isInnerFamily: false });
            }
            const partner = partnerOf(coupleId, fm.FamilyMemberId);
            if (partner) { used.add(partner.FamilyMemberId); fmPartners.push(partner); }
        }

        // Siblings
        if (fm.OriginCoupleId) {
            family.filter(f => !used.has(f.FamilyMemberId) && f.OriginCoupleId === fm.OriginCoupleId).forEach(sib => {
                used.add(sib.FamilyMemberId);
                familyRelations.push({ fromId: String(fm.FamilyMemberId), toId: String(sib.FamilyMemberId), relationType: "Sibling", prettyType: "Sibling", isInnerFamily: false });
                for (const p of fmPartners) {
                    familyRelations.push({ fromId: String(p.FamilyMemberId), toId: String(sib.FamilyMemberId), relationType: "Sibling in law", prettyType: "Sibling in law", isInnerFamily: false });
                    familyRelations.push({ fromId: String(sib.FamilyMemberId), toId: String(p.FamilyMemberId), relationType: "Sibling in law", prettyType: "Sibling in law", isInnerFamily: false });
                }
            });
        }

        // Walk ancestor levels: [0]=parent couple, [1]=grandparent couples, [2]=great-grandparent, ...
        const ancestorLevels: number[][] = [];
        let levelCoupleIds = fm.OriginCoupleId ? [fm.OriginCoupleId] : [];
        while (levelCoupleIds.length > 0 && ancestorLevels.length < 5) {
            ancestorLevels.push(levelCoupleIds);
            const next: number[] = [];
            for (const cid of levelCoupleIds) {
                const c = coupleById.get(cid);
                if (!c) continue;
                for (const pid of [c.ParterFamilyMemberId, c.OtherPartnerFamilyMemberId]) {
                    const m = memberById.get(pid);
                    if (m?.OriginCoupleId && !next.includes(m.OriginCoupleId)) next.push(m.OriginCoupleId);
                }
            }
            levelCoupleIds = next;
        }

        ancestorLevels.forEach((coupleIds, level) => {
            for (const cid of coupleIds) {
                const couple = coupleById.get(cid);
                if (!couple) continue;
                const relType: RelationTypes = ANCESTOR_REL_TYPES[level] ?? "Relative" as RelationTypes;

                // Ancestors
                for (const pid of [couple.ParterFamilyMemberId, couple.OtherPartnerFamilyMemberId]) {
                    if (!used.has(pid)) {
                        used.add(pid);
                        familyRelations.push({ fromId: String(fm.FamilyMemberId), toId: String(pid), relationType: relType, prettyType: relType, isInnerFamily: false });
                        if (level === 0) {
                            for (const p of fmPartners) {
                                familyRelations.push({ fromId: String(pid), toId: String(p.FamilyMemberId), relationType: "Child in law", prettyType: "Child in law", isInnerFamily: false });
                                familyRelations.push({ fromId: String(p.FamilyMemberId), toId: String(pid), relationType: "Parent in law", prettyType: "Parent in law", isInnerFamily: false });
                            }
                        }
                    }
                }

                // Collateral lines: other children of this ancestor couple = uncles/aunts/great-uncles/etc.
                // level 0 = parents' couple → their other children are siblings (already handled)
                // level 1 = grandparent couple → other children are uncles/aunts
                // level 2 = great-grandparent couple → other children are great-uncles/aunts
                if (level >= 1) {
                    const cousinNumber = level; // level 1 → 1st cousin, level 2 → 2nd cousin, etc.
                    childrenOfCouple(cid).forEach(collateral => {
                        if (used.has(collateral.FamilyMemberId)) return;
                        used.add(collateral.FamilyMemberId);
                        const collPretty = COLLATERAL_PRETTY[level - 1] ?? "Relative";
                        familyRelations.push({ fromId: String(fm.FamilyMemberId), toId: String(collateral.FamilyMemberId), relationType: "Uncle/aunt", prettyType: collPretty, isInnerFamily: false });

                        // Descend through cousin generations: removedCount tracks how many generations
                        // below the Nth cousin (0 = Nth cousin, 1 = once removed, 2 = twice removed, …)
                        let cousinQueue: Array<{ member: FamilyMemberRow; removedCount: number }> = [{ member: collateral, removedCount: 0 }];
                        while (cousinQueue.length > 0) {
                            const next: typeof cousinQueue = [];
                            for (const { member, removedCount } of cousinQueue) {
                                const mCoupleIds = memberCoupleIds.get(member.FamilyMemberId) ?? [];
                                for (const ccId of mCoupleIds) {
                                    childrenOfCouple(ccId).forEach(cousin => {
                                        if (used.has(cousin.FamilyMemberId)) return;
                                        used.add(cousin.FamilyMemberId);
                                        const label = cousinLabel(cousinNumber, removedCount);
                                        familyRelations.push({ fromId: String(fm.FamilyMemberId), toId: String(cousin.FamilyMemberId), relationType: "Cousin", prettyType: label, isInnerFamily: false });
                                        next.push({ member: cousin, removedCount: removedCount + 1 });
                                    });
                                }
                            }
                            cousinQueue = next;
                        }
                    });
                }
            }
        });

        // Children and descendants (all couples)
        for (const coupleId of fmCoupleIds) {
            childrenOfCouple(coupleId).forEach(child => {
                if (used.has(child.FamilyMemberId)) return;
                used.add(child.FamilyMemberId);
                familyRelations.push({ fromId: String(fm.FamilyMemberId), toId: String(child.FamilyMemberId), relationType: "Child", prettyType: "Child", isInnerFamily: false });

                let descLevelCoupleIds = memberCoupleIds.get(child.FamilyMemberId) ?? [];
                let depth = 0;
                while (descLevelCoupleIds.length > 0) {
                    const nextDescIds: number[] = [];
                    for (const dcId of descLevelCoupleIds) {
                        childrenOfCouple(dcId).forEach(desc => {
                            if (used.has(desc.FamilyMemberId)) return;
                            used.add(desc.FamilyMemberId);
                            nextDescIds.push(...(memberCoupleIds.get(desc.FamilyMemberId) ?? []));
                            familyRelations.push({ fromId: String(fm.FamilyMemberId), toId: String(desc.FamilyMemberId), relationType: grandChildType(depth), prettyType: grandChildType(depth), isInnerFamily: false });
                            familyRelations.push({ fromId: String(desc.FamilyMemberId), toId: String(fm.FamilyMemberId), relationType: grandParentType(depth), prettyType: grandParentType(depth), isInnerFamily: false });
                        });
                    }
                    descLevelCoupleIds = nextDescIds;
                    depth++;
                }
            });
        }
    });

    return [familyMembers, familyRelations];
}

type TreeWrapperProps = {
    dataSource: DataSource;
    onBack: () => void;
};

const TreeWrapper = ({ dataSource, onBack }: TreeWrapperProps) => {
    const [family, setFamily] = useState<FamilyMemberRow[] | null>(null);
    const [familyOptions, setFamilyOptions] = useState<FamilyOption[] | null>(null);
    const [selectedFamily, setSelectedFamily] = useState<number | null>(null);
    const [editingMember, setEditingMember] = useState<FamilyMemberRow | null>(null);
    const [addingMember, setAddingMember] = useState(false);
    const [couples, setCouples] = useState<CoupleRow[]>([]);
    const [editingEnabled, setEditingEnabled] = useState(false);
    const [writePermission, setWritePermission] = useState<boolean | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [showToast, setShowToast] = useState(false);

    const apiHeaders = useMemo(() =>
        dataSource.type === 'api' && dataSource.accessKey
            ? { 'x-access-key': dataSource.accessKey }
            : {},
        [dataSource]
    );

    const loadFamilyOptions = useCallback(() => {
        if (dataSource.type === 'api') {
            axios.get<FamilyOption[] | { WritePermission?: boolean; [key: string]: unknown }>(
                `${dataSource.url}/family/options`,
                { headers: apiHeaders }
            ).then(resp => {
                if (Array.isArray(resp.data)) {
                    setFamilyOptions(resp.data);
                } else {
                    if (typeof resp.data.WritePermission === 'boolean') {
                        setWritePermission(resp.data.WritePermission);
                    }
                    const optionsArr = Object.values(resp.data).find(v => Array.isArray(v)) as FamilyOption[] | undefined;
                    setFamilyOptions(optionsArr ?? []);
                }
            });
        } else {
            setFamilyOptions(queryFamilyOptions(dataSource.db) as FamilyOption[]);
        }
    }, [dataSource, apiHeaders]);

    const loadFamily = useCallback(() => {
        if (selectedFamily === null) return;
        if (dataSource.type === 'api') {
            axios.get<{ FamilyMembers: FamilyMemberRow[]; WritePermission?: boolean }>(
                `${dataSource.url}/family?familyGroupId=${selectedFamily}`,
                { headers: apiHeaders }
            ).then(resp => {
                setFamily(resp.data.FamilyMembers);
                if (typeof resp.data.WritePermission === 'boolean') {
                    setWritePermission(resp.data.WritePermission);
                }
            });
        } else {
            setFamily(queryFamily(dataSource.db, selectedFamily) as FamilyMemberRow[]);
        }
    }, [dataSource, selectedFamily, apiHeaders]);

    // Keep selectedFamily in sync with available options
    useEffect(() => {
        if (familyOptions && familyOptions.length > 0) {
            setSelectedFamily(prev => {
                const ids = familyOptions.map(f => f.FamilyGroupId);
                return prev !== null && ids.includes(prev) ? prev : ids[0];
            });
        }
    }, [familyOptions]);

    useEffect(() => { loadFamilyOptions(); }, [loadFamilyOptions]);
    useEffect(() => { loadFamily(); }, [loadFamily]);

    // Keep the open modal in sync whenever family reloads (e.g. after couple assignment)
    useEffect(() => {
        if (!family) return;
        setEditingMember(prev => {
            if (!prev) return prev;
            return family.find(m => m.FamilyMemberId === prev.FamilyMemberId) ?? prev;
        });
        if (dataSource.type === 'sqlite') {
            setCouples(queryCouples(dataSource.db) as CoupleRow[]);
        }
    }, [family, dataSource]);

    // ── Handlers (defined before any conditional returns so they're always stable) ──

    const handleEnableEditing = () => {
        setEditingEnabled(true);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
    };

    const handleBack = () => {
        if (dataSource.type === 'sqlite' && hasChanges) {
            const confirmed = window.confirm(
                'You have unsaved edits. Download the file before leaving to keep your changes permanently.\n\nGo back anyway?'
            );
            if (!confirmed) return;
        }
        onBack();
    };

    const handleDoubleClick = (nodeId: string) => {
        if (dataSource.type !== 'sqlite' || !editingEnabled) return;
        const member = family?.find((fm) => String(fm.FamilyMemberId) === nodeId);
        if (member) setEditingMember(member);
    };

    const handleSaveEdit = (id: number, data: { firstName: string; middleName: string; lastName: string; birthDate: string; gender: string; deceasedDate: string; description: string; originCoupleId: number | null }) => {
        if (dataSource.type !== 'sqlite') return;
        updateFamilyMember(dataSource.db, id, data);
        saveDbToLocalStorage(dataSource.db);
        setHasChanges(true);
        loadFamily();
        setEditingMember(null);
    };

    const handleDownload = () => {
        if (dataSource.type !== 'sqlite') return;
        const data = exportDatabase(dataSource.db);
        const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'familytree.sqlite';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleAddMember = (data: { firstName: string; lastName: string; birthDate: string; gender: string; originCoupleId: number | null }) => {
        if (dataSource.type !== 'sqlite' || selectedFamily === null) return;
        addFamilyMember(dataSource.db, data, selectedFamily);
        saveDbToLocalStorage(dataSource.db);
        setHasChanges(true);
        loadFamily();
        setAddingMember(false);
    };

    const handleAssignCouple = (memberId: number, partnerId: number, relationshipType: CoupleRelationshipType) => {
        if (dataSource.type !== 'sqlite') return;
        setCoupleAssociation(dataSource.db, memberId, partnerId, relationshipType);
        saveDbToLocalStorage(dataSource.db);
        setHasChanges(true);
        loadFamily();
    };

    const handleRemoveCouple = (memberId: number) => {
        if (dataSource.type !== 'sqlite') return;
        removeCoupleAssociation(dataSource.db, memberId);
        saveDbToLocalStorage(dataSource.db);
        setHasChanges(true);
        loadFamily();
    };

    const handleAddToFamily = (memberId: number, familyGroupId: number) => {
        if (dataSource.type !== 'sqlite') return;
        addMemberToFamilyGroup(dataSource.db, memberId, familyGroupId);
        saveDbToLocalStorage(dataSource.db);
        setHasChanges(true);
        loadFamily();
    };

    const handleRemoveFromFamily = (memberId: number, familyGroupId: number) => {
        if (dataSource.type !== 'sqlite') return;
        removeMemberFromFamilyGroup(dataSource.db, memberId, familyGroupId);
        saveDbToLocalStorage(dataSource.db);
        setHasChanges(true);
        loadFamily();
    };

    const handleSelectFamily = (id: number) => {
        setSelectedFamily(id);
        setFamily(null);
    };

    const handleAddFamilyGroup = (name: string) => {
        if (dataSource.type !== 'sqlite') return;
        const newId = addFamilyGroup(dataSource.db, name);
        saveDbToLocalStorage(dataSource.db);
        loadFamilyOptions();
        setSelectedFamily(newId);
        setFamily(null);
    };

    // ── Computed ──
    const currentFamilyName = familyOptions?.find(f => f.FamilyGroupId === selectedFamily)?.FamilyName;
    const isSqlite = dataSource.type === 'sqlite';

    const navbarNode = (
        <Navbar
            isSqlite={isSqlite}
                isEditingEnabled={editingEnabled}
                hasChanges={hasChanges}
                writePermissionDenied={writePermission === false}
            onBack={handleBack}
            onDownload={handleDownload}
            onAddMember={() => setAddingMember(true)}
                onEnableEditing={handleEnableEditing}
            familyName={currentFamilyName}
            familyOptions={familyOptions ?? []}
            selectedFamilyId={selectedFamily ?? undefined}
            onSelectFamily={isSqlite ? handleSelectFamily : undefined}
            onAddFamilyGroup={isSqlite ? handleAddFamilyGroup : undefined}
        />
    );

    if (!familyOptions || selectedFamily === null) {
        return (
            <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
                {navbarNode}
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#8b92b8", fontFamily: "system-ui" }}>
                    Loading...
                </div>
            </div>
        );
    }

    // ── Tree data ──
    let treeContent: React.ReactNode;

    if (!family) {
        treeContent = (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#8b92b8", fontFamily: "system-ui" }}>
                Loading...
            </div>
        );
    } else {
        const [familyMembersRaw, familyRelationsRaw] = buildRawFromApiData(family, couples);
        const [familyMembersRecord, familyRelationsRecord] = buildFamilyAndRelations(familyMembersRaw, familyRelationsRaw);
        const headId = familyOptions.find((fo) => fo.FamilyGroupId === selectedFamily)?.FamilyHeadId;
        const rootMember = headId != null ? familyMembersRecord[headId] : undefined;

        if (!rootMember) {
            treeContent = (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", color: "#8b92b8", fontFamily: "system-ui" }}>
                    <span style={{ fontSize: "1.1rem" }}>No members yet — add the first person to get started.</span>
                    {isSqlite && (
                        <button
                            onClick={() => setAddingMember(true)}
                            style={{ padding: "0.6rem 1.4rem", background: "#5c6bc0", color: "#fff", border: "none", borderRadius: "8px", fontSize: "0.95rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                        >
                            + Add Member
                        </button>
                    )}
                </div>
            );
        } else {
            treeContent = (
                <div style={{ flex: 1, overflow: "hidden" }}>
                    <FamilyTree
                        familyMembers={familyMembersRecord}
                        familyRelations={familyRelationsRecord}
                        rootMember={rootMember}
                        onDoubleClick={isSqlite && editingEnabled ? handleDoubleClick : undefined}
                    />
                </div>
            );
        }
    }

    return (
        <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
            {navbarNode}
            {treeContent}
            {editingMember && (
                <EditMemberModal
                    member={editingMember}
                    allMembers={family ?? []}
                    couples={couples}
                    familyOptions={familyOptions ?? []}
                    db={dataSource.type === 'sqlite' ? dataSource.db : undefined}
                    onSave={handleSaveEdit}
                    onClose={() => setEditingMember(null)}
                    onAssignCouple={handleAssignCouple}
                    onRemoveCouple={handleRemoveCouple}
                    onAddToFamily={handleAddToFamily}
                    onRemoveFromFamily={handleRemoveFromFamily}
                    onSwitchFamily={editingMember.SecondFamilyId ? (id) => { handleSelectFamily(id); setEditingMember(null); } : undefined}
                    onDataChange={() => setHasChanges(true)}
                />
            )}
            {addingMember && (
                <AddMemberModal
                    couples={couples}
                    onSave={handleAddMember}
                    onClose={() => setAddingMember(false)}
                />
            )}
            {showToast && (
                <div className="editing-toast">
                    Editing is enabled
                </div>
            )}
        </div>
    );
};

export default TreeWrapper;
