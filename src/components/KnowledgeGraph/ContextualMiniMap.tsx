import { Background, Controls, ReactFlow } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import type React from 'react';
import { useMemo } from 'react';
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from '../../api/knowledgeWorkspace';

interface ContextualMiniMapProps {
  centerNode: KnowledgeGraphNode;
  allNodes: KnowledgeGraphNode[];
  allEdges: KnowledgeGraphEdge[];
}

const getDirectedLayout = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR' }); // Left to Right layout

  for (const node of nodes) {
    dagreGraph.setNode(node.id, { width: 150, height: 50 });
  }

  for (const edge of edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  for (const node of nodes) {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = {
      x: nodeWithPosition.x - 75,
      y: nodeWithPosition.y - 25,
    };
  }

  return { nodes, edges };
};

export const ContextualMiniMap: React.FC<ContextualMiniMapProps> = ({
  centerNode,
  allNodes,
  allEdges,
}) => {
  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(() => {
    // 1. Find 1st & 2nd degree connections for the center node
    const connectedEdgeIds = new Set<string>();
    const connectedNodeIds = new Set<string>([centerNode.id]);

    for (const e of allEdges) {
      if (
        e.source_entity_id === centerNode.id ||
        e.target_entity_id === centerNode.id
      ) {
        connectedEdgeIds.add(e.id);
        connectedNodeIds.add(e.source_entity_id);
        connectedNodeIds.add(e.target_entity_id);
      }
    }

    const allowedTypes = ['person', 'project', 'decision', 'action_item'];

    const filteredNodes = allNodes.filter(
      (n) => connectedNodeIds.has(n.id) && allowedTypes.includes(n.type),
    );
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

    const filteredEdges = allEdges.filter(
      (e) =>
        connectedEdgeIds.has(e.id) &&
        filteredNodeIds.has(e.source_entity_id) &&
        filteredNodeIds.has(e.target_entity_id),
    );

    // 3. Map to React Flow expected types
    const rfNodes: Node[] = filteredNodes.map((n) => ({
      id: n.id,
      position: { x: 0, y: 0 },
      data: { label: n.label },
      style: {
        background:
          n.id === centerNode.id ? 'var(--pro-accent)' : 'var(--pro-bg)',
        color: n.id === centerNode.id ? 'black' : 'var(--pro-text-primary)',
        borderColor: 'var(--pro-border)',
        borderRadius: '8px',
        padding: '10px',
        fontSize: '12px',
      },
    }));

    const rfEdges: Edge[] = filteredEdges.map((e) => ({
      id: e.id,
      source: e.source_entity_id,
      target: e.target_entity_id,
      label: e.relationship.replace(/_/g, ' '),
      type: 'smoothstep',
      animated: e.state === 'suggested',
      labelStyle: {
        fill: 'var(--pro-text-primary)',
        fontWeight: 500,
        fontSize: 10,
      },
      labelBgStyle: {
        fill: 'var(--pro-surface)',
        stroke: 'var(--pro-border)',
        rx: 4,
        ry: 4,
      },
      labelBgPadding: [4, 4],
      style: { stroke: 'var(--pro-border)', strokeWidth: 2 },
    }));

    return getDirectedLayout(rfNodes, rfEdges);
  }, [centerNode, allNodes, allEdges]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={layoutedNodes}
        edges={layoutedEdges}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="var(--pro-border)" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
};
