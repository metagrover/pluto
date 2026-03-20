import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useEffect } from 'react';
import { getKnowledgeWorkspace } from '../../api/knowledgeWorkspace';
import { useKnowledgeStore } from '../../store/knowledgeStore';
import { FocusSheet } from './FocusSheet.tsx';
import { MainStage } from './MainStage.tsx';

interface KnowledgeTabProps {
  onOpenMeeting?: (meetingId: string) => void;
  onOpenProjectsTab?: () => void;
}

export const KnowledgeTab: React.FC<KnowledgeTabProps> = ({
  onOpenMeeting: _onOpenMeeting,
  onOpenProjectsTab,
}) => {
  const { clearSelection } = useKnowledgeStore();

  // Handle ESC key to close the FocusSheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSelection]);

  // Fetch real data using React Query
  const { data: workspace, isLoading } = useQuery({
    queryKey: ['knowledgeWorkspace'],
    queryFn: () => getKnowledgeWorkspace({}),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <div className="animate-pulse flex flex-col items-center gap-4 text-pro-text-muted">
          <div className="w-8 h-8 rounded-full border-2 border-pro-accent border-t-transparent animate-spin" />
          <span className="text-xs uppercase tracking-widest font-black">
            Loading Knowledge Base...
          </span>
        </div>
      </div>
    );
  }

  const nodes = workspace?.graph.nodes || [];
  const edges = workspace?.graph.edges || [];
  const timeline = workspace?.timeline || [];
  const projectCards = workspace?.project_cards || [];

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-pro-bg rounded-2xl border border-pro-border shadow-soft">
      {/* 1. The Stage (Main Workspace) */}
      <MainStage
        nodes={nodes}
        edges={edges}
        timeline={timeline}
        projectCards={projectCards}
        onOpenProjectsTab={onOpenProjectsTab}
      />

      {/* 2. The Focus Sheet (The Anti-Sidebar Overlay) */}
      <FocusSheet
        nodes={nodes}
        edges={edges}
        onOpenProjectsTab={onOpenProjectsTab}
      />
    </div>
  );
};
