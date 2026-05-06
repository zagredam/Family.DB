import { useState } from "react";
import { ReactFlow, MiniMap, type NodeMouseHandler } from "@xyflow/react";
import CoupleEdge, { CoupleEdgeTypeKey } from "./FamilyComponents/CoupleEdge";
import { FamilyMemberNodeComp } from "./FamilyComponents/FamilyMemberNode";
import InnerFamilyEdge, { InnerFamilyTypeKey } from "./FamilyComponents/InnerFamilyEdge";
import { buildDataStructure, buildGenerations, buildParentsChildrenStructs } from "./tree/buildDataStructure";
import { buildCouplesEdges, buildEdgesFromParentChildrenRelations } from "./tree/buildEdges";
import {
    addNodeSelection,
    addNodeVisibilityCallback,
    positionAndBuildFamilyTree,
    positionUnknownGeneration
} from "./tree/positionNodes";
import { FamilyMember, FamilyMembers, FamilyRelations, OTHERS_GENERATION } from "./tree/types";
import { nodeColorForMinimap } from "./utils";

const nodeTypes = { familyMember: FamilyMemberNodeComp };
const edgeTypes = {
    [InnerFamilyTypeKey]: InnerFamilyEdge,
    [CoupleEdgeTypeKey]: CoupleEdge
};

type FamilyTreeProps = {
    familyMembers: FamilyMembers;
    familyRelations: FamilyRelations;
    rootMember: FamilyMember;
    onDoubleClick?: (sfdcId: string) => void;
};

export const FamilyTree = ({
    familyMembers: rawFamilyMembers,
    familyRelations,
    rootMember,
    onDoubleClick
}: FamilyTreeProps) => {
    const [selectedNode, setSelectedNode] = useState<string | null>(rootMember.id);
    const [hiddenNodesIds, setHiddenNodesIds] = useState<string[]>([]);

    const familyMembersWithVisibility = Object.fromEntries(
        Object.entries(rawFamilyMembers).map(([key, value]) => {
            value.data.isHidden = hiddenNodesIds.includes(key);
            return [key, value] as const;
        })
    );

    const familyMembersValues = Object.values(familyMembersWithVisibility);
    const familyRelationsValues = Object.values(familyRelations);

    const familyGenerations = buildGenerations(familyMembersWithVisibility, familyRelations, rootMember.id);
    const innerFamiliesPerGeneration = buildDataStructure(familyGenerations, familyRelations);

    const familyNodes = positionAndBuildFamilyTree(innerFamiliesPerGeneration, familyMembersWithVisibility);

    const knownGenerations = Object.keys(familyGenerations).map(Number).filter(g => g !== OTHERS_GENERATION);
    const minGeneration = knownGenerations.length > 0 ? Math.min(...knownGenerations) : -2;
    const otherNodes = positionUnknownGeneration(familyGenerations[OTHERS_GENERATION], minGeneration);

    const allNodes = [...familyNodes, ...otherNodes];
    const nodesWithSelectedInfo = addNodeSelection(familyRelations, allNodes, selectedNode);
    const nodesWithVizCallback = addNodeVisibilityCallback(nodesWithSelectedInfo, hiddenNodesIds, setHiddenNodesIds);

    const parentChildrenFamilies = buildParentsChildrenStructs(familyMembersValues, familyRelationsValues);
    const parentChildEdges = buildEdgesFromParentChildrenRelations(parentChildrenFamilies, familyGenerations);

    const couplesEdges = buildCouplesEdges(familyRelationsValues, parentChildEdges, parentChildrenFamilies);

    const handleNodeClick: NodeMouseHandler = (_, node) => setSelectedNode(node.id);
    const handleNodeDoubleClick: NodeMouseHandler = (_, node) => { if (onDoubleClick) onDoubleClick(node.id); };

    return (
        <div style={{ height: "100%", width: "100%", direction: "ltr" }} className="family-chart">
            <ReactFlow
                nodes={nodesWithVizCallback}
                edges={[...parentChildEdges, ...couplesEdges]}
                fitView
                fitViewOptions={{
                    padding: 5,
                    nodes: allNodes.filter((node) => node.id == selectedNode)
                }}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={{ type: "smoothstep" }}
                proOptions={{
                    hideAttribution: true
                }}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
            >
                <MiniMap nodeStrokeWidth={3} pannable zoomable nodeColor={nodeColorForMinimap} />
            </ReactFlow>
        </div>
    );
};
