import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptDreamingProposal,
  getPendingDreamingProposals,
  rejectDreamingProposal,
} from '../../src/api/knowledgeGraph';

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('manual dreaming public API', () => {
  const invoke = vi.fn(async () => ({}));

  beforeEach(() => {
    invoke.mockClear();
    Object.assign(globalThis, {
      window: { ipcRenderer: { invoke } },
    });
  });

  it('requires a concrete entity id and exposes no force option', () => {
    const source = readSource('../../src/api/knowledgeGraph.ts');
    const start = source.indexOf('export const triggerDreamingNow');
    const declaration = source.slice(start, start + 220);
    expect(declaration).toContain('options: {');
    expect(declaration).toContain('entityId: string;');
    expect(declaration).not.toContain('entityId?:');
    expect(declaration).not.toContain('force');
  });

  it('does not render entity-less overview triggers', () => {
    expect(
      readSource('../../src/components/features/projects/ProjectsOverview.tsx'),
    ).not.toContain('✨ Dream Now');
    const peopleSource = readSource(
      '../../src/components/KnowledgeGraph/PeopleTab.tsx',
    );
    expect(peopleSource.match(/triggerDreamingNow\(/g)).toHaveLength(1);
  });

  it('uses explicit entity scope for proposal reads and decisions', async () => {
    const scope = { entityId: 'project-1', entityType: 'project' as const };
    await getPendingDreamingProposals(scope);
    await acceptDreamingProposal({ ...scope, proposalId: 'proposal-1' });
    await rejectDreamingProposal({ ...scope, proposalId: 'proposal-2' });

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'GET_PENDING_DREAMING_PROPOSALS',
      scope,
    );
    expect(invoke).toHaveBeenNthCalledWith(2, 'ACCEPT_DREAMING_PROPOSAL', {
      ...scope,
      proposalId: 'proposal-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'REJECT_DREAMING_PROPOSAL', {
      ...scope,
      proposalId: 'proposal-2',
    });
  });
});
