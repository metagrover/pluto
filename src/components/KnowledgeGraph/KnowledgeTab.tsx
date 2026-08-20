import { useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useEffect } from 'react';
import {
  getKnowledgeDocSources,
  refreshKnowledgeDoc,
  saveKnowledgeCorrection,
} from '../../api/knowledgeDocs';
import { getKnowledgeWorkspace } from '../../api/knowledgeWorkspace';
import { useKnowledgeStore } from '../../store/knowledgeStore';
import { FocusSheet } from './FocusSheet.tsx';
import { MainStage } from './MainStage.tsx';
import { knowledgeDocsNeedPolling } from './knowledgeDocument';

interface KnowledgeTabProps {
  onOpenMeeting?: (meetingId: string) => void;
  onOpenProjectsTab?: () => void;
}

export const KnowledgeTab: React.FC<KnowledgeTabProps> = ({
  onOpenMeeting: _onOpenMeeting,
  onOpenProjectsTab: _onOpenProjectsTab,
}) => {
  const { clearSelection } = useKnowledgeStore();
  const queryClient = useQueryClient();

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
    queryKey: ['knowledgeWorkspace', 'global'],
    queryFn: () => getKnowledgeWorkspace(),
    refetchInterval: (query) =>
      knowledgeDocsNeedPolling(query.state.data?.docs || []) ? 3000 : false,
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
          <span className="text-xs font-medium">Loading Knowledge Base...</span>
        </div>
      </div>
    );
  }

  const nodes = workspace?.graph.nodes || [];
  const edges = workspace?.graph.edges || [];
  const docs = workspace?.docs || [];
  const projectCards = workspace?.project_cards || [];

  const handleRetrySynthesis = async (docId: string) => {
    await refreshKnowledgeDoc(docId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['knowledgeWorkspace'] }),
      queryClient.invalidateQueries({ queryKey: ['knowledgeDocSources'] }),
    ]);
  };

  const handleSaveCorrection = async (params: {
    targetKind: 'source' | 'stream' | 'item';
    targetId: string;
    action:
      | 'exclude_source'
      | 'rename_stream'
      | 'merge_stream'
      | 'split_stream'
      | 'pin_stream'
      | 'promote_item'
      | 'demote_item'
      | 'correct_classification';
    payload?: Record<string, unknown> | null;
  }) => {
    if (!selectedDoc) return;
    await saveKnowledgeCorrection({
      docId: selectedDoc.id,
      targetKind: params.targetKind,
      targetId: params.targetId,
      action: params.action,
      payload: params.payload,
    });
    await queryClient.invalidateQueries({ queryKey: ['knowledgeWorkspace'] });
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-transparent">
      <MainStage
        docs={docs}
        selectedDoc={selectedDoc}
        projectCards={projectCards}
        sources={sources}
        sourcesLoading={sourcesLoading}
        onRetrySynthesis={handleRetrySynthesis}
        onSaveCorrection={handleSaveCorrection}
      />

      <FocusSheet nodes={nodes} edges={edges} />
    </div>
  );
};
