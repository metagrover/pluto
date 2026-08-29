import {
  Background,
  Controls,
  type Edge as FlowEdge,
  type Node as FlowNode,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import React, { useMemo } from 'react';
import '@xyflow/react/dist/style.css';
import { ChevronRight, Home } from 'lucide-react';
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from '../../api/knowledgeWorkspace';

interface WorkspaceCanvasProps {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  selectedEntityId: string | null;
  onSelectEntity: (id: string) => void;
}

const EDGE_COLORS: Record<string, string> = {
  depends_on: '#3b82f6',
  blocked_by: '#ef4444',
  owns: '#10b981',
  impacts: '#f59e0b',
};

const NODE_STYLE = {
  project: { bg: '#0f172a', border: '#1e293b', text: '#f8fafc' },
  topic: { bg: '#0ea5e9', border: '#0284c7', text: '#ffffff' },
  decision: { bg: '#14b8a6', border: '#0f766e', text: '#ffffff' },
  action_item: { bg: '#f59e0b', border: '#d97706', text: '#ffffff' },
  person: { bg: '#6366f1', border: '#4f46e5', text: '#ffffff' },
};

export const WorkspaceCanvas: React.FC<WorkspaceCanvasProps> = ({
  nodes,
  edges,
  selectedEntityId,
  onSelectEntity,
}) => {
  // Generate initial Flow nodes
  const initialNodes: FlowNode[] = useMemo(() => {
    return nodes.map((node, index) => {
      const isSelected = selectedEntityId === node.id;
      const theme =
        NODE_STYLE[node.type as keyof typeof NODE_STYLE] || NODE_STYLE.topic;

      return {
        id: node.id,
        // Simple grid layout for now. Dagre layout could be added later for complex graphs.
        position: { x: (index % 5) * 220, y: Math.floor(index / 5) * 120 },
        data: {
          label: (
            <div className="flex flex-col items-start text-left w-full gap-1">
              <span
                className="text-[10px] font-medium opacity-80"
                style={{ color: theme.text }}
              >
                {node.type.replace('_', ' ')}
              </span>
              <span
                className="text-sm font-bold truncate w-full"
                style={{ color: theme.text }}
              >
                {node.label}
              </span>
            </div>
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          width: 200,
          padding: '16px 20px',
          borderRadius: '16px',
          backgroundColor: theme.bg,
          borderColor: isSelected ? '#ffffff' : theme.border,
          borderWidth: isSelected ? '3px' : '1px',
          boxShadow: isSelected
            ? '0 0 0 4px rgba(14, 165, 233, 0.2), 0 20px 40px -10px rgba(0,0,0,0.15)'
            : '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
          cursor: 'pointer',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        },
      };
    });
  }, [nodes, selectedEntityId]);

  // Generate initial Flow edges
  const initialEdges: FlowEdge[] = useMemo(() => {
    return edges.map((edge) => {
      const isSelected =
        selectedEntityId === edge.source_entity_id ||
        selectedEntityId === edge.target_entity_id;
      const color = EDGE_COLORS[edge.relationship] || '#94a3b8';

      return {
        id: edge.id,
        source: edge.source_entity_id,
        target: edge.target_entity_id,
        label: edge.relationship.replace('_', ' '),
        animated: edge.relationship === 'blocked_by',
        style: {
          stroke: color,
          strokeWidth: isSelected ? 3 : 1.5,
          opacity: isSelected ? 1 : 0.6,
        },
        labelStyle: { fill: '#64748b', fontWeight: 700, fontSize: 10 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.8 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
        },
      };
    });
  }, [edges, selectedEntityId]);

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(initialNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when props change (e.g., selection)
  React.useEffect(() => {
    setFlowNodes(initialNodes);
    setFlowEdges(initialEdges);
  }, [initialNodes, initialEdges, setFlowNodes, setFlowEdges]);

  return (
    <div className="flex-1 relative bg-pro-surface overflow-hidden ">
      <div className="absolute inset-0 w-full h-full">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => onSelectEntity(node.id)}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.1}
          maxZoom={1.5}
          className="w-full h-full"
        >
          <Background
            gap={24}
            size={2}
            color="#94a3b8"
            className="opacity-20"
          />
          <Controls
            showInteractive={false}
            className="bg-pro-surface border-pro-border shadow-soft rounded-lg overflow-hidden"
          />
          <MiniMap
            nodeColor={(n) => {
              const node = nodes.find((x) => x.id === n.id);
              if (!node) return '#e2e8f0';
              return (
                NODE_STYLE[node.type as keyof typeof NODE_STYLE]?.bg ||
                '#0ea5e9'
              );
            }}
            maskColor="rgba(248, 250, 252, 0.7)"
            className="bg-pro-surface rounded-md shadow-sm border border-pro-border"
          />
        </ReactFlow>
      </div>

      {/* Floating Toolbar / Title / Breadcrumbs */}
      <div className="absolute top-6 left-8 z-20 pointer-events-none flex flex-col gap-3">
        {/* Breadcrumb Traversal */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-md bg-pro-surface border border-pro-border-subtle shadow-sm pointer-events-auto">
          <button
            type="button"
            className="flex items-center text-[12px] font-medium text-pro-text-muted hover:text-pro-accent transition-colors cursor-pointer group"
            onClick={() => onSelectEntity('')}
          >
            <Home className="w-4 h-4 mr-2 text-pro-text-muted/60 group-hover:text-pro-accent transition-colors" />
            Knowledge Base
          </button>

          {selectedEntityId && nodes.find((n) => n.id === selectedEntityId) && (
            <>
              <ChevronRight className="w-4 h-4 text-pro-text-muted/30" />
              <div className="text-[12px] font-bold text-pro-text-muted capitalize">
                {nodes
                  .find((n) => n.id === selectedEntityId)
                  ?.type.replace('_', ' ')}
                s
              </div>
              <ChevronRight className="w-4 h-4 text-pro-text-muted/30" />
              <div className="text-[12px] font-medium text-white bg-pro-accent shadow-md shadow-pro-accent/20 px-2.5 py-1 rounded-lg">
                {nodes.find((n) => n.id === selectedEntityId)?.label}
              </div>
            </>
          )}
        </div>

        <div className="bg-pro-surface p-5 rounded-md border border-pro-border-subtle shadow-sm max-w-sm">
          <h2 className="text-2xl font-semibold text-pro-text-main flex items-center gap-3">
            Knowledge Canvas
            <span className="px-2.5 py-1 rounded-lg bg-pro-accent text-[11px] font-semibold text-white font-medium shadow-sm shadow-pro-accent/30">
              {nodes.length} Nodes
            </span>
          </h2>
          <p className="text-[13px] font-medium text-pro-text-muted mt-2 leading-relaxed">
            Drag cards to cluster them manually. Select any entity card to
            inspect its context, blockers, and dependencies.
          </p>
        </div>
      </div>
    </div>
  );
};
