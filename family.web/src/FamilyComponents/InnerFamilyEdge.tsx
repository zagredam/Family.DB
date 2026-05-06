import uniqBy from "lodash/uniqBy";
import { BaseEdge, type Edge, EdgeProps, getSmoothStepPath, Position, useStore } from "@xyflow/react";
import { EDGE_XGAP_MODIFIER, NODE_HEIGHT } from "../tree/constants";

export type InnerFamilyEdgeData = {
    offsetY: number;
    familyIndex: number;
};

type InnerFamilyEdgeType = Edge<InnerFamilyEdgeData>;
export type InnerFamilyEdgeProps = EdgeProps<InnerFamilyEdgeType>;
export const InnerFamilyTypeKey = "innerFamily";

export default function InnerFamilyEdge({
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style,
    data
}: InnerFamilyEdgeProps) {
    const edges = useStore((store) =>
        uniqBy(
            store.edges.filter((edge) => edge.source == source) as InnerFamilyEdgeType[],
            "data.familyIndex"
        )
    );
    const targetNode = useStore((store) => store.nodeLookup.get(target));

    const hiddenOffset = (targetNode?.data as { isHidden?: boolean } | undefined)?.isHidden ? NODE_HEIGHT / 2 : 0;

    const [edgePath] = getSmoothStepPath({
        sourceX: sourceX - edges.findIndex((edge) => edge.data?.familyIndex == data?.familyIndex) * EDGE_XGAP_MODIFIER,
        sourceY,
        sourcePosition: Position.Bottom,
        targetX,
        targetY,
        targetPosition: Position.Top,
        centerY: targetY - (data?.offsetY ?? 0) - hiddenOffset
    });

    return (
        <>
            <BaseEdge id={id} path={edgePath} style={style} />
        </>
    );
}
