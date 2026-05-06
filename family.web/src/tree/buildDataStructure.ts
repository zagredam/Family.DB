import { buildEdgeId } from "./buildEdges";
import {
    FamilyMember,
    FamilyMembers,
    FamilyRelations,
    Generation,
    InnerFamily,
    OTHERS_GENERATION,
    ParentsChildrens,
    FamilyRelation
} from "./types";
import { getGenerationFromRelation, isRelationAChild, isRelationSharingKids } from "./utils";

function tryInferGenerationForOthers(
    familyMemberByGeneration: [Generation, FamilyMember][],
    familyRelations: FamilyRelations
): [Generation, FamilyMember][] {
    const others: FamilyMember[] = familyMemberByGeneration
        .filter(([gen]) => gen == OTHERS_GENERATION)
        .map(([, member]) => member);
    const zeroGen: FamilyMember[] = familyMemberByGeneration.filter(([gen]) => gen == 0).map(([, member]) => member);

    // Mutable map so that members inferred earlier can help infer later ones
    const knownGenMap = new Map<string, Generation>(
        familyMemberByGeneration
            .filter(([gen]) => gen !== OTHERS_GENERATION)
            .map(([gen, member]) => [member.id, gen])
    );

    const allRelationValues = Object.values(familyRelations);

    return others.map((othersMember) => {
        // Primary: direct relation to the root (gen-0)
        const relationsFromZeroGeneration = zeroGen.map(
            (relative) => familyRelations[buildEdgeId(othersMember.id, relative.id)]?.relationType
        );
        const generationsFromZeroGeneration = relationsFromZeroGeneration.map((relation) =>
            getGenerationFromRelation(relation)
        );
        const nonOthersGenerationsPossible = generationsFromZeroGeneration.filter(
            (generation) => generation !== null && generation != OTHERS_GENERATION
        );

        if (
            nonOthersGenerationsPossible.length > 0 &&
            nonOthersGenerationsPossible.every((gen) => gen == nonOthersGenerationsPossible[0])
        ) {
            const inferredGen = nonOthersGenerationsPossible[0];
            knownGenMap.set(othersMember.id, inferredGen);
            return [inferredGen, othersMember] as [Generation, FamilyMember];
        }

        // Spouse fallback: couple relations (Partner, Common-Law Partner, etc.) have
        // generation offset 0 — both spouses share the same generation row. If this
        // member's spouse has a known generation, use it directly.
        // knownGenMap is updated incrementally so a spouse inferred earlier in this
        // loop can unlock their partner on the next iteration.
        for (const relation of allRelationValues) {
            if (!isRelationSharingKids(relation.relationType)) continue;

            const spouseId =
                relation.to === othersMember.id ? relation.from :
                relation.from === othersMember.id ? relation.to :
                undefined;

            if (!spouseId) continue;

            const spouseGen = knownGenMap.get(spouseId);
            if (spouseGen !== undefined) {
                knownGenMap.set(othersMember.id, spouseGen);
                return [spouseGen, othersMember] as [Generation, FamilyMember];
            }
        }

        return [OTHERS_GENERATION, othersMember] as [Generation, FamilyMember];
    });
}

export function buildGenerations(
    familyMembers: FamilyMembers,
    familyRelations: FamilyRelations,
    rootId: string
): Record<Generation, FamilyMember[]> {
    const familyMembersByGeneration: [Generation, FamilyMember][] = Object.values(familyMembers).map((member) => {
        if (member.id == rootId) return [0, member];

        const relationToRootId = `${member.id}-${rootId}`;
        const relationToRoot = familyRelations[relationToRootId]?.relationType;

        if (relationToRoot) {
            const generation: Generation = getGenerationFromRelation(relationToRoot);

            return [generation, member];
        }

        return [OTHERS_GENERATION, member];
    });

    const inferredOtherGen = tryInferGenerationForOthers(familyMembersByGeneration, familyRelations);
    const membersByGenFull = [
        ...familyMembersByGeneration.filter(([gen]) => gen != OTHERS_GENERATION),
        ...inferredOtherGen
    ];

    const reducedFamilyMembersByGeneration = membersByGenFull.reduce(
        (obj, member) => {
            const [generation, memberData] = member;

            if (!obj[generation]) obj[generation] = [memberData];
            else obj[generation] = [...obj[generation], memberData];
            return obj;
        },
        {} as Record<Generation, FamilyMember[]>
    );

    return reducedFamilyMembersByGeneration;
}

function buildCouplesPerGeneration(
    familyGenerations: ReturnType<typeof buildGenerations>,
    familyRelations: FamilyRelations
) {
    const couplesPerGeneration = Object.fromEntries(
        Object.entries(familyGenerations).map(([rawGeneration, nodesInGeneration]) => {
            const generation: Generation = parseInt(rawGeneration);
            const couples: InnerFamily[] = [];
            let availableNodesInGeneration = [...nodesInGeneration];

            while (availableNodesInGeneration.length > 0) {
                const node = availableNodesInGeneration.pop();
                if (!node) {
                    break;
                }

                const partnersIds = Object.values(familyRelations)
                    .filter((relation) => isRelationSharingKids(relation.relationType) &&
                        (relation.from === node.id || relation.to === node.id))
                    .map((relation) => relation.from === node.id ? relation.to : relation.from);
                if (partnersIds.length === 0) {
                    couples.push({ parents: [node.id], children: [], generation });
                    continue;
                }

                const partnersNodes: FamilyMember[] = partnersIds
                    .map((partnerId) => {
                        return availableNodesInGeneration.find((node) => node.id === partnerId);
                    })
                    .filter((node): node is FamilyMember => !!node);

                couples.push({
                    parents: [node.id, ...partnersNodes.map((node) => node.id)],
                    children: [],
                    generation
                });
                availableNodesInGeneration = availableNodesInGeneration.filter((node) => !partnersNodes.includes(node));
            }

            return [generation, couples] as const;
        })
    );

    return couplesPerGeneration;
}

// NOTE: this function edits couplesPerGeneration in place
function buildInnerFamilyPerCouple(
    couplesPerGeneration: ReturnType<typeof buildCouplesPerGeneration>,
    familyRelations: FamilyRelations
) {
    const sortedGenerations = Object.keys(couplesPerGeneration)
        .map(Number)
        .filter(g => g !== OTHERS_GENERATION)
        .sort((a, b) => a - b);

    sortedGenerations.forEach((generation) => {
        const couplesInCurrentGeneration = couplesPerGeneration[generation];
        if (!couplesInCurrentGeneration || couplesInCurrentGeneration.length === 0) {
            return;
        }

        const couplesInNextGeneration = couplesPerGeneration[generation + 1];
        if (!couplesInNextGeneration || couplesInNextGeneration.length === 0) {
            return;
        }

        couplesInCurrentGeneration.forEach((couple) => {
            const currentParents = couple.parents;

            const childrenRelations = Object.values(familyRelations).filter(
                (relation) => isRelationAChild(relation.relationType) && currentParents.includes(relation.to)
            );
            const childrenIds = childrenRelations.map((relation) => relation.from);

            if (childrenIds.length === 0) {
                return;
            }

            const childrenWithTheirCouples = couplesInNextGeneration
                .filter((nextGenFamilies) => {
                    return nextGenFamilies.parents.some((nextGenParent) =>
                        childrenIds.some((child) => child == nextGenParent)
                    );
                })
                .flat();

            const uniqueChildren = childrenWithTheirCouples.filter((child) => {
                return !couplesInCurrentGeneration.some((couple) => {
                    return couple.children.includes(child);
                });
            });

            couple.children = uniqueChildren
                .map((childWithFamily) => ({
                    child: childWithFamily,
                    parents: childrenRelations.filter((rel) => childWithFamily.parents.includes(rel.from)).join()
                }))
                .sort((childWithFamilyA, childWithFamilyB) =>
                    childWithFamilyA.parents.localeCompare(childWithFamilyB.parents)
                )
                .map((childWithFamily) => childWithFamily.child);
        });
    });

    return couplesPerGeneration;
}

export function buildDataStructure(
    familyGenerations: Record<Generation, FamilyMember[]>,
    familyRelations: FamilyRelations
) {
    const couplesPerGeneration = buildCouplesPerGeneration(familyGenerations, familyRelations);
    const innerFamiliesPerGeneration = buildInnerFamilyPerCouple(couplesPerGeneration, familyRelations);

    return innerFamiliesPerGeneration;
}

export function buildParentsChildrenStructs(familyMembers: FamilyMember[], familyRelations: FamilyRelation[]) {
    const parentChildrenFamilies = familyMembers
        .map((member) => {
            const parents = familyRelations
                .filter((relation) => relation.to == member.id && relation.relationType == "Parent")
                .sort();
            if (parents.length > 2) console.error(`Too many parents for ${member.id}`);

            const parentA = parents[0]?.from;
            const parentB = parents[1]?.from;
            const id = [parentA, parentB]
                .filter((parent) => !!parent)
                .sort()
                .join("-");
            return { id, child: member.id, parentA, parentB };
        })
        .filter((childWithParents) => !!childWithParents.id)
        .reduce(
            (parentsWithAllChildren, childWithParents) => {
                if (parentsWithAllChildren[childWithParents.id]) {
                    parentsWithAllChildren[childWithParents.id].children.push(childWithParents.child);
                } else {
                    parentsWithAllChildren[childWithParents.id] = {
                        parentA: childWithParents.parentA,
                        parentB: childWithParents.parentB,
                        children: [childWithParents.child]
                    };
                }

                return parentsWithAllChildren;
            },
            {} as Record<string, ParentsChildrens>
        );

    return Object.values(parentChildrenFamilies);
}
