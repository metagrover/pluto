import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useState } from 'react';
import { getKnowledgeDocSources } from '../../api/knowledgeDocs';
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
  onOpenProjectsTab: _onOpenProjectsTab,
}) => {
  const { clearSelection } = useKnowledgeStore();
  const [selectedDocId, setSelectedDocId] = useState<string | undefined>();

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
    queryKey: ['knowledgeWorkspace', selectedDocId],
    queryFn: () => getKnowledgeWorkspace({ docId: selectedDocId }),
  });

  const selectedDoc = workspace?.selected_doc || null;
  const selectedDocForSources = selectedDoc?.id;
  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ['knowledgeDocSources', selectedDocForSources],
    queryFn: () =>
      selectedDocForSources
        ? getKnowledgeDocSources(selectedDocForSources)
        : Promise.resolve([]),
    enabled: Boolean(selectedDocForSources),
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
  const timeline = workspace?.timeline || [];
  const edges = workspace?.graph.edges || [];
  const backlinks = workspace?.backlinks || [];
  const docs = workspace?.docs || [];
  const projectCards = workspace?.project_cards || [];

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-transparent">
      <MainStage
        docs={docs}
        selectedDoc={selectedDoc}
        nodes={nodes}
        timeline={timeline}
        backlinks={backlinks}
        projectCards={projectCards}
        sources={sources}
        sourcesLoading={sourcesLoading}
        onSelectDoc={setSelectedDocId}
      />

      <FocusSheet nodes={nodes} edges={edges} />
    </div>
  );
};
