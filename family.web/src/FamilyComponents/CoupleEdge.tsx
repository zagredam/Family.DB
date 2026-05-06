import { BaseEdge, EdgeProps, Node, getStraightPath, useEdges, useNodes, useStore } from "@xyflow/react";
import { calcCoupleEdgeYOffset } from "../tree/utils";

export type CoupleEdgeProps = EdgeProps;
export const CoupleEdgeTypeKey = "couple";

function getNodeDimensions(node: Node) {
    // ReactFlow v12: auto-sized nodes store real dims in node.measured, not node.width/height
    const w = (node as Node & { measured?: { width?: number; height?: number } }).measured?.width
        ?? node.width
        ?? 0;
    const h = (node as Node & { measured?: { width?: number; height?: number } }).measured?.height
        ?? node.height
        ?? 0;
    return { w, h };
}

function getNodeCenter(node: Node) {
    const { w, h } = getNodeDimensions(node);
    const x = (node.position?.x ?? 0) + w / 2;
    const y = (node.position?.y ?? 0) + h / 2;
    return { x, y };
}

export default function CoupleEdge({ id, source, target, style }: CoupleEdgeProps) {
    const sourceNode = useStore((store) => store.nodeLookup.get(source));
    const targetNode = useStore((store) => store.nodeLookup.get(target));
    const edges = useEdges();
    const nodes = useNodes();

    if (!sourceNode || !targetNode) return null;

    const sourceCenter = getNodeCenter(sourceNode);
    const targetCenter = getNodeCenter(targetNode);
    const { w: srcW } = getNodeDimensions(sourceNode);
    const { w: tgtW } = getNodeDimensions(targetNode);

    const sameGenEdges = edges
        .filter((edge) => {
            if (edge.type !== CoupleEdgeTypeKey) return false;
            const srcPos = nodes.find((n) => n.id === edge.source)?.position;
            const tgtPos = nodes.find((n) => n.id === edge.target)?.position;
            if (!srcPos || !tgtPos) return false;
            return srcPos.y === sourceNode.position.y;
        })
        .map((edge) => edge.id)
        .sort();

    const offsetY = calcCoupleEdgeYOffset(sameGenEdges.indexOf(id)) * 10;

    // Connect from the inner facing edges, not the centers, so the line sits in the gap
    const leftIsSource = sourceCenter.x < targetCenter.x;
    const leftX  = leftIsSource  ? sourceCenter.x + srcW / 2 : targetCenter.x + tgtW / 2;
    const rightX = !leftIsSource ? sourceCenter.x - srcW / 2 : targetCenter.x - tgtW / 2;

    // Midpoint Y between both node centers keeps the line horizontally centered
    const midY = (sourceCenter.y + targetCenter.y) / 2 + offsetY;

    const [edgePath] = getStraightPath({
        sourceX: leftX,
        sourceY: midY,
        targetX: rightX,
        targetY: midY,
    });

    return <BaseEdge id={id} path={edgePath} style={style} />;
}
