import { describe, expect, it, vi } from 'vitest';
import {
  type ProjectRoutingState,
  routeProjectCandidate,
} from '../../electron/projectRouting';

function fixture() {
  const projects = [
    {
      id: 'root',
      name: 'Beacon',
      status: 'active',
      metadata: JSON.stringify({
        projectStarred: true,
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'extraction',
          reason: 'A program',
          assessedAt: '2026-08-01',
          outcome: 'Make historical records searchable for pilot partners.',
        },
      }),
    },
    {
      id: 'new',
      name: 'Permissions hardening',
      status: 'active',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'extraction',
          reason: 'Several checks',
          assessedAt: '2026-09-30',
        },
      }),
    },
  ];
  const sources = [
    {
      id: 'old',
      title: 'Planning',
      notes:
        'The searchable archive pilot needs access rules and permission validation for partner collections.',
      startedAt: '2026-08-01',
      candidateProjects: [{ id: 'root', name: 'Beacon' }],
    },
    {
      id: 'recent',
      title: 'Access review',
      notes:
        'Permissions hardening will validate access rules for partner collections before the searchable archive pilot launches.',
      startedAt: '2026-09-30',
      candidateProjects: [{ id: 'new', name: 'Permissions hardening' }],
    },
  ];
  let state: ProjectRoutingState | null = null;
  const response = {
    relationship: 'workstream',
    parentProjectId: 'root',
    sourceMeetingId: 'recent',
    evidenceQuote: sources[1].notes,
    parentSourceMeetingId: 'old',
    parentEvidenceQuote: sources[0].notes,
  };
  const deps = {
    listProjects: () => projects,
    getProject: (id: string) => projects.find((project) => project.id === id),
    listSources: () => sources,
    getSource: (id: string) => sources.find((source) => source.id === id),
    getState: () => state,
    saveState: (next: ProjectRoutingState) => {
      state = next;
    },
    generate: vi.fn(async () => JSON.stringify(response)),
    saveMembership: vi.fn(() => true),
    isBusy: () => false,
  };
  return { deps, projects, sources, response };
}

describe('filing new work under established projects', () => {
  it('reviews visible project suggestions before newer unassessed topics', async () => {
    const { deps, projects, sources } = fixture();
    projects.push({ ...projects[1], id: 'unassessed', metadata: '{}' });
    sources.push({
      ...sources[1],
      id: 'newest',
      startedAt: '2026-10-01',
      candidateProjects: [{ id: 'unassessed', name: 'New topic' }],
    });
    await routeProjectCandidate(deps);
    expect(deps.saveMembership).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'new' }),
    );
  });

  it('includes alternate names and the candidate outcome to disambiguate shared conversations', async () => {
    const { deps, projects, sources } = fixture();
    sources[0].candidateProjects[0].name = 'Historical collections pilot';
    const meta = JSON.parse(projects[1].metadata);
    meta.projectQualification.outcome =
      'Validate partner access before the archive pilot launches.';
    projects[1].metadata = JSON.stringify(meta);
    await routeProjectCandidate(deps);
    const prompt = deps.generate.mock.calls[0][0];
    expect(prompt).toContain('Historical collections pilot');
    expect(prompt).toContain(meta.projectQualification.outcome);
  });

  it('reconciles an existing synthesized suggestion supported across meetings', async () => {
    const { deps, projects, sources } = fixture();
    const meta = JSON.parse(projects[1].metadata);
    meta.projectThemeSynthesis = { version: 3 };
    projects[1].metadata = JSON.stringify(meta);
    sources.push({ ...sources[1], id: 'second-candidate-source' });
    expect(await routeProjectCandidate(deps)).toMatchObject({ grouped: 1 });
    const prompt = deps.generate.mock.calls[0][0];
    const roots = JSON.parse(
      prompt.split('KNOWN PROJECTS:\n')[1].split('\nCANDIDATE:')[0],
    );
    expect(roots.map((root: { id: string }) => root.id)).toEqual(['root']);
  });

  it('uses already filed work as parent evidence even without a direct parent mention', async () => {
    const { deps, projects, sources } = fixture();
    projects.push({
      ...projects[1],
      id: 'filed',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'subordinate',
          source: 'review',
          reason: 'Filed',
          assessedAt: '2026-09-01',
          parentProjectId: 'root',
        },
      }),
    });
    sources[0].candidateProjects = [{ id: 'filed', name: 'Access policies' }];
    expect(await routeProjectCandidate(deps)).toMatchObject({
      grouped: 1,
      failed: 0,
    });
    expect(deps.generate.mock.calls[0][0]).toContain(sources[0].notes);
  });

  it('uses an unpinned qualified project supported across conversations as an existing home', async () => {
    const { deps, projects, sources } = fixture();
    const meta = JSON.parse(projects[0].metadata);
    meta.projectStarred = false;
    projects[0].metadata = JSON.stringify(meta);
    sources.push({
      ...sources[0],
      id: 'second-root-source',
      startedAt: '2026-08-02',
    });
    expect(await routeProjectCandidate(deps)).toMatchObject({ grouped: 1 });
    expect(deps.saveMembership).toHaveBeenCalledWith(
      expect.objectContaining({ parentProjectId: 'root' }),
    );
  });

  it('retrieves older parent evidence and relevant passages beyond the opening of notes', async () => {
    const { deps, sources, response } = fixture();
    sources[0].notes = `${'Routine unrelated context. '.repeat(300)}${response.parentEvidenceQuote}`;
    sources.push(
      ...Array.from({ length: 3 }, (_, index) => ({
        ...sources[0],
        id: `newer-root-${index}`,
        startedAt: `2026-09-2${index}`,
        notes: 'Routine scheduling discussion without continuity of work.',
      })),
    );
    expect(await routeProjectCandidate(deps)).toMatchObject({
      grouped: 1,
      failed: 0,
    });
    expect(deps.generate.mock.calls[0][0]).toContain(
      response.parentEvidenceQuote,
    );
  });

  it('retries when older root evidence changes, even outside previously selected notes', async () => {
    const { deps, sources } = fixture();
    sources.push(
      ...Array.from({ length: 3 }, (_, index) => ({
        ...sources[0],
        id: `root-${index}`,
        startedAt: `2026-09-2${index}`,
      })),
    );
    deps.generate.mockResolvedValue(JSON.stringify({ relationship: 'none' }));
    await routeProjectCandidate(deps);
    sources[0].notes += ' Access validation is now part of the pilot scope.';
    await routeProjectCandidate(deps);
    expect(deps.generate).toHaveBeenCalledTimes(2);
  });

  it('defers new-theme synthesis until the remaining candidates have been reconciled', async () => {
    const { deps, projects, sources } = fixture();
    projects.push({
      ...projects[1],
      id: 'other',
      name: 'Archive import checks',
    });
    sources.push({
      ...sources[1],
      id: 'other-source',
      startedAt: '2026-09-01',
      candidateProjects: [{ id: 'other', name: 'Archive import checks' }],
    });
    expect(await routeProjectCandidate(deps)).toMatchObject({
      grouped: 1,
      remaining: 1,
      deferred: true,
    });
    deps.generate.mockResolvedValue(JSON.stringify({ relationship: 'none' }));
    expect(await routeProjectCandidate(deps)).toMatchObject({
      remaining: 0,
      deferred: false,
    });
  });

  it('keeps reconciliation queued when one candidate fails before the queue is drained', async () => {
    const { deps, projects, sources } = fixture();
    projects.push({ ...projects[1], id: 'other' });
    sources.push({
      ...sources[1],
      id: 'other-source',
      candidateProjects: [{ id: 'other', name: 'Other work' }],
    });
    deps.generate.mockResolvedValue('invalid');
    expect(await routeProjectCandidate(deps)).toMatchObject({
      remaining: 1,
      failed: 1,
      deferred: true,
    });
  });

  it('files a single-source extracted initiative under a pinned root without its literal name in the notes', async () => {
    const { deps } = fixture();
    expect(await routeProjectCandidate(deps)).toMatchObject({
      grouped: 1,
      remaining: 0,
      failed: 0,
    });
    expect(deps.saveMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'new',
        parentProjectId: 'root',
        relationship: 'workstream',
        parentSourceMeetingId: 'old',
      }),
    );
    expect(deps.generate.mock.calls[0]).toBeDefined();
  });
  it('does not re-run unchanged attempts and reconsiders them when an anchor is renamed', async () => {
    const { deps, projects } = fixture();
    deps.generate.mockResolvedValue(JSON.stringify({ relationship: 'none' }));
    await routeProjectCandidate(deps);
    await routeProjectCandidate(deps);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    projects[0].name = 'Historical archive';
    await routeProjectCandidate(deps);
    expect(deps.generate).toHaveBeenCalledTimes(2);
  });
  it.each(['candidate', 'parent'])(
    'rejects fabricated %s evidence',
    async (which) => {
      const { deps, response } = fixture();
      deps.generate.mockResolvedValue(
        JSON.stringify({
          ...response,
          [which === 'parent' ? 'parentEvidenceQuote' : 'evidenceQuote']:
            'This quote was invented by the model.',
        }),
      );
      expect(await routeProjectCandidate(deps)).toMatchObject({
        grouped: 0,
        failed: 1,
      });
      expect(deps.saveMembership).not.toHaveBeenCalled();
    },
  );
  it('rejects an unknown parent and evidence from another root', async () => {
    const { deps, response } = fixture();
    deps.generate.mockResolvedValue(
      JSON.stringify({ ...response, parentProjectId: 'unknown' }),
    );
    await routeProjectCandidate(deps);
    expect(deps.saveMembership).not.toHaveBeenCalled();
  });
  it.each(['pinned', 'confirmed', 'optout', 'completed', 'dismissed'])(
    'preserves %s candidates',
    async (kind) => {
      const { deps, projects } = fixture();
      const meta = JSON.parse(projects[1].metadata);
      if (kind === 'pinned') meta.projectStarred = true;
      if (kind === 'confirmed') meta.projectQualification.source = 'user';
      if (kind === 'optout') meta.projectAutoGroupingOptOut = true;
      if (kind === 'completed') projects[1].status = 'completed';
      if (kind === 'dismissed') meta.projectPortfolioDisposition = 'dismissed';
      projects[1].metadata = JSON.stringify(meta);
      await routeProjectCandidate(deps);
      expect(deps.saveMembership).not.toHaveBeenCalled();
    },
  );
  it('lets a concurrent user correction win', async () => {
    const { deps, projects, response } = fixture();
    deps.generate.mockImplementation(async () => {
      projects[1].metadata = JSON.stringify({
        projectAutoGroupingOptOut: true,
      });
      return JSON.stringify(response);
    });
    expect(await routeProjectCandidate(deps)).toMatchObject({
      grouped: 0,
      remaining: 1,
    });
    expect(deps.saveMembership).not.toHaveBeenCalled();
  });
  it('lets a concurrent source edit win', async () => {
    const { deps, sources, response } = fixture();
    deps.generate.mockImplementation(async () => {
      sources[1] = { ...sources[1], notes: 'Corrected notes from the user.' };
      return JSON.stringify(response);
    });
    expect(await routeProjectCandidate(deps)).toMatchObject({
      grouped: 0,
      remaining: 1,
    });
  });
  it('defers inference while recording is busy', async () => {
    const { deps } = fixture();
    deps.isBusy = () => true;
    expect(await routeProjectCandidate(deps)).toMatchObject({ deferred: true });
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('retains failures for explicit retry while allowing the queue to progress', async () => {
    const { deps } = fixture();
    deps.generate.mockResolvedValue('invalid');
    expect(await routeProjectCandidate(deps)).toMatchObject({ failed: 1 });
    await routeProjectCandidate(deps);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    await routeProjectCandidate(deps, { retryFailed: true });
    expect(deps.generate).toHaveBeenCalledTimes(2);
  });
});
