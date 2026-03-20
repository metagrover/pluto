import { create } from 'zustand';
import type { KnowledgeGraphNode } from '../api/knowledgeWorkspace';

export type UIMode = 'dashboard' | 'focus' | 'resolution';

interface KnowledgeState {
  uiMode: UIMode;
  selectedEntityId: string | null;
  selectedEntityNode: KnowledgeGraphNode | null;
  domainFilter: 'work' | 'personal';
  setDomainFilter: (filter: 'work' | 'personal') => void;
  setUIMode: (mode: UIMode) => void;
  setSelectedEntity: (
    id: string | null,
    node: KnowledgeGraphNode | null,
  ) => void;
  clearSelection: () => void;
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  uiMode: 'dashboard',
  domainFilter: 'work',
  selectedEntityId: null,
  selectedEntityNode: null,
  setDomainFilter: (filter) => set({ domainFilter: filter }),
  setUIMode: (mode) => set({ uiMode: mode }),
  setSelectedEntity: (id, node) =>
    set({
      selectedEntityId: id,
      selectedEntityNode: node,
      uiMode: id ? 'focus' : 'dashboard',
    }),
  clearSelection: () =>
    set({
      selectedEntityId: null,
      selectedEntityNode: null,
      uiMode: 'dashboard',
    }),
}));
