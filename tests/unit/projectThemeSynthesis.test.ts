import { describe, expect, it, vi } from 'vitest';
import {
  PROJECT_THEME_SYNTHESIS_VERSION,
  synthesizeProjectThemes,
} from '../../electron/projectThemeSynthesis';

const sources = [
  {
    id: 'm1',
    title: 'Archive planning',
    notes:
      'The archive program will make historical records searchable. The team chose staged indexing. Open question: which collections ship first?',
    startedAt: '2026-08-20T12:00:00Z',
    candidateProjects: [{ id: 'candidate-1', name: 'Archive indexing' }],
  },
  {
    id: 'm2',
    title: 'Archive follow-up',
    notes:
      'Historical search remains the focus. The first collection is now indexed. Next action: validate access rules before launch.',
    startedAt: '2026-08-27T12:00:00Z',
    candidateProjects: [{ id: 'candidate-2', name: 'Historical search' }],
  },
];

const response = {
  themes: [
    {
      name: 'Historical archive search',
      outcome: 'Make historical records searchable',
      currentFocus: 'Validate access rules before the first launch',
      candidateProjectIds: ['candidate-1', 'candidate-2'],
      evidence: [
        {
          sourceMeetingId: 'm1',
          evidenceQuote:
            'The archive program will make historical records searchable.',
        },
        {
          sourceMeetingId: 'm2',
          evidenceQuote: 'Historical search remains the focus.',
        },
      ],
      recentChanges: [
        {
          sourceMeetingId: 'm2',
          summary: 'The first collection is indexed.',
          evidenceQuote: 'The first collection is now indexed.',
        },
      ],
      openThreads: [
        {
          sourceMeetingId: 'm2',
          kind: 'action',
          text: 'Validate access rules before launch',
          evidenceQuote: 'Next action: validate access rules before launch.',
        },
      ],
    },
  ],
};

const makeDeps = () => {
  let state: any = null;
  const projects = new Map(
    ['candidate-1', 'candidate-2'].map((id) => [
      id,
      { id, type: 'project', name: id, metadata: null },
    ]),
  );
  return {
    get state() {
      return state;
    },
    deps: {
      listSources: () => sources,
      getSource: (id: string) => sources.find((source) => source.id === id),
      getState: () => state,
      saveState: vi.fn((next: any) => {
        state = next;
      }),
      getProject: (id: string) => projects.get(id),
      saveTheme: vi.fn(),
      generate: vi.fn(async () => JSON.stringify(response)),
      isBusy: () => false,
    },
  };
};

describe('cross-conversation project theme synthesis', () => {
  it('promotes a notes-grounded theme only when two conversations support it', async () => {
    const fixture = makeDeps();
    const result = await synthesizeProjectThemes(fixture.deps);

    expect(result).toMatchObject({ discovered: 1, remaining: 0, failed: 0 });
    expect(fixture.deps.generate.mock.calls[0][0]).toContain(
      'structured meeting notes',
    );
    expect(fixture.deps.generate.mock.calls[0][0]).not.toContain('transcript');
    expect(fixture.deps.saveTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^project-theme-[a-f0-9]{24}$/),
        name: 'Historical archive search',
        sourceMeetingIds: ['m1', 'm2'],
        sourceContexts: {
          m1: 'The archive program will make historical records searchable.',
          m2: 'Historical search remains the focus.',
        },
        metadata: expect.objectContaining({
          projectQualification: expect.objectContaining({
            state: 'qualified',
            source: 'review',
          }),
          projectThemeSynthesis: expect.objectContaining({
            version: PROJECT_THEME_SYNTHESIS_VERSION,
            currentFocus: 'Validate access rules before the first launch',
          }),
        }),
      }),
    );
  });

  it('keeps a one-conversation proposal out of the portfolio without stalling discovery', async () => {
    const fixture = makeDeps();
    fixture.deps.generate.mockResolvedValue(
      JSON.stringify({
        themes: [
          {
            ...response.themes[0],
            evidence: [response.themes[0].evidence[0]],
          },
        ],
      }),
    );

    expect(await synthesizeProjectThemes(fixture.deps)).toMatchObject({
      discovered: 0,
      remaining: 0,
      failed: 0,
    });
    expect(fixture.deps.saveTheme).not.toHaveBeenCalled();
    expect(fixture.state).toMatchObject({
      status: 'complete',
      projectIds: [],
    });
  });

  it('does not rerun unchanged portfolio evidence', async () => {
    const fixture = makeDeps();
    await synthesizeProjectThemes(fixture.deps);
    await synthesizeProjectThemes(fixture.deps);
    expect(fixture.deps.generate).toHaveBeenCalledOnce();
    expect(fixture.deps.saveTheme).toHaveBeenCalledOnce();
  });

  it('does not feed a saved review theme back into its own source fingerprint', async () => {
    const fixture = makeDeps();
    const changingSources = structuredClone(sources);
    const projects = new Map(
      ['candidate-1', 'candidate-2'].map((id) => [
        id,
        { id, type: 'project', name: id, metadata: null },
      ]),
    );
    let savedThemeId: string | null = null;
    fixture.deps.listSources = () => changingSources;
    fixture.deps.getSource = (id: string) =>
      changingSources.find((source) => source.id === id);
    fixture.deps.getProject = (id: string) => projects.get(id);
    fixture.deps.generate.mockImplementation(async () =>
      JSON.stringify({
        themes: [
          {
            ...response.themes[0],
            candidateProjectIds: savedThemeId
              ? [savedThemeId]
              : response.themes[0].candidateProjectIds,
          },
        ],
      }),
    );
    fixture.deps.saveTheme = vi.fn((theme: any) => {
      savedThemeId = theme.id;
      projects.set(theme.id, {
        id: theme.id,
        type: 'project',
        name: theme.name,
        metadata: JSON.stringify(theme.metadata),
      });
      for (const source of changingSources)
        source.candidateProjects.push({ id: theme.id, name: theme.name });
    });

    await synthesizeProjectThemes(fixture.deps);
    await synthesizeProjectThemes(fixture.deps);

    expect(fixture.deps.generate).toHaveBeenCalledOnce();
    expect(fixture.deps.saveTheme).toHaveBeenCalledOnce();
  });

  it('reuses a user-confirmed project identity instead of creating a duplicate theme', async () => {
    const fixture = makeDeps();
    fixture.deps.getProject = (id: string) => {
      if (id === 'candidate-2')
        return {
          id,
          type: 'project',
          name: 'My archive program',
          metadata: JSON.stringify({
            projectQualification: {
              version: 1,
              state: 'qualified',
              source: 'user',
              reason: 'Confirmed by the user.',
              assessedAt: '2026-08-28T12:00:00Z',
            },
          }),
        };
      return {
        id,
        type: 'project',
        name: id,
        metadata: null,
      };
    };

    await synthesizeProjectThemes(fixture.deps);

    expect(fixture.deps.saveTheme).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'candidate-2',
        name: 'My archive program',
        metadata: expect.objectContaining({
          projectQualification: expect.objectContaining({
            state: 'qualified',
            source: 'user',
          }),
          projectThemeSynthesis: expect.objectContaining({
            candidateProjectIds: ['candidate-1', 'candidate-2'],
          }),
        }),
      }),
    );
  });

  it('rejects invented notes evidence without persisting a theme', async () => {
    const fixture = makeDeps();
    fixture.deps.generate.mockResolvedValue(
      JSON.stringify({
        themes: [
          {
            ...response.themes[0],
            evidence: [
              response.themes[0].evidence[0],
              {
                sourceMeetingId: 'm2',
                evidenceQuote: 'An invented claim not found in the notes.',
              },
            ],
          },
        ],
      }),
    );
    expect(await synthesizeProjectThemes(fixture.deps)).toMatchObject({
      discovered: 0,
      failed: 0,
    });
    expect(fixture.deps.saveTheme).not.toHaveBeenCalled();
  });

  it('defers without model work during capture or foreground synthesis', async () => {
    const fixture = makeDeps();
    fixture.deps.isBusy = () => true;
    expect(await synthesizeProjectThemes(fixture.deps)).toMatchObject({
      deferred: true,
      remaining: 1,
    });
    expect(fixture.deps.generate).not.toHaveBeenCalled();
  });

  it('defers cleanly when preempted by foreground inference without saving failed state', async () => {
    const fixture = makeDeps();
    const preemptionError = new Error('The operation was aborted', {
      cause: new DOMException('foreground_preempted', 'AbortError'),
    });
    fixture.deps.generate.mockRejectedValue(preemptionError);

    const result = await synthesizeProjectThemes(fixture.deps);
    expect(result).toMatchObject({
      discovered: 0,
      remaining: 1,
      failed: 0,
      deferred: true,
    });
    expect(fixture.state).toBeNull();
  });
});

describe('stable project identities and grounded grouping', () => {
  const established = {
    id: 'archive',
    type: 'project',
    name: 'Archive program',
    status: 'active',
    metadata: JSON.stringify({
      projectQualification: {
        version: 1,
        state: 'qualified',
        source: 'review',
        reason: 'Two conversations',
        assessedAt: '2026-08-20',
      },
      projectThemeSynthesis: {
        candidateProjectIds: ['candidate-1'],
        outcome: 'Make historical records searchable',
      },
    }),
  };
  it('updates the established identity when a later discussion changes the candidate set', async () => {
    const { deps } = makeDeps();
    const original = deps.getProject;
    const withRegistry = {
      ...deps,
      listProjects: () => [established],
      getProject: (id: string) =>
        id === established.id ? established : original(id),
    };
    deps.generate.mockResolvedValue(
      JSON.stringify({
        themes: [
          {
            ...response.themes[0],
            existingProjectId: established.id,
            candidateProjectIds: ['candidate-2'],
          },
        ],
      }),
    );
    await synthesizeProjectThemes(withRegistry);
    expect(deps.saveTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'archive', name: 'Archive program' }),
    );
    expect(deps.generate.mock.calls[0][0]).toContain('KNOWN PROJECTS');
  });
  it('recovers an established identity from its recorded candidates without relying on wording', async () => {
    const { deps } = makeDeps();
    const original = deps.getProject;
    await synthesizeProjectThemes({
      ...deps,
      listProjects: () => [established],
      getProject: (id) => (id === 'archive' ? established : original(id)),
    });
    expect(deps.saveTheme).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'archive' }),
    );
  });
  it('groups only a candidate supported by the supplied source and quote', async () => {
    const { deps } = makeDeps();
    deps.generate.mockResolvedValue(
      JSON.stringify({
        themes: [
          {
            ...response.themes[0],
            memberships: [
              {
                projectId: 'candidate-1',
                relationship: 'workstream',
                ...response.themes[0].evidence[0],
              },
              {
                projectId: 'candidate-2',
                relationship: 'alias',
                sourceMeetingId: 'm1',
                evidenceQuote: response.themes[0].evidence[0].evidenceQuote,
              },
            ],
          },
        ],
      }),
    );
    await synthesizeProjectThemes(deps);
    expect(deps.saveTheme.mock.calls[0][0].memberships).toEqual([
      expect.objectContaining({
        projectId: 'candidate-1',
        relationship: 'workstream',
      }),
    ]);
  });
  it('keeps an ambiguous candidate separate when two themes claim it', async () => {
    const { deps } = makeDeps();
    const theme = {
      ...response.themes[0],
      memberships: [
        {
          projectId: 'candidate-1',
          relationship: 'workstream',
          ...response.themes[0].evidence[0],
        },
      ],
    };
    deps.generate.mockResolvedValue(
      JSON.stringify({
        themes: [
          theme,
          {
            ...theme,
            name: 'Separate outcome',
            candidateProjectIds: ['candidate-1'],
          },
        ],
      }),
    );
    await synthesizeProjectThemes(deps);
    expect(
      deps.saveTheme.mock.calls.every(
        ([saved]) => saved.memberships.length === 0,
      ),
    ).toBe(true);
  });
  it('ignores a stale registry target changed during generation', async () => {
    const { deps } = makeDeps();
    let current = established;
    const original = deps.getProject;
    deps.generate.mockImplementation(async () => {
      current = {
        ...established,
        metadata: JSON.stringify({ projectPortfolioDisposition: 'dismissed' }),
      };
      return JSON.stringify({
        themes: [{ ...response.themes[0], existingProjectId: 'archive' }],
      });
    });
    await synthesizeProjectThemes({
      ...deps,
      listProjects: () => [established],
      getProject: (id) => (id === 'archive' ? current : original(id)),
    });
    expect(deps.saveTheme).not.toHaveBeenCalled();
  });
  it('persists profile statements only with valid evidence from supporting meetings', async () => {
    const { deps } = makeDeps();
    deps.generate.mockResolvedValue(
      JSON.stringify({
        themes: [
          {
            ...response.themes[0],
            summary: {
              text: 'Searchable records are moving toward launch.',
              ...response.themes[0].evidence[0],
            },
            workstreams: [
              {
                name: 'Access controls',
                text: 'Validate before launch',
                sourceMeetingId: 'm2',
                evidenceQuote: response.themes[0].openThreads[0].evidenceQuote,
              },
            ],
            decisions: [
              {
                text: 'A fabricated decision',
                sourceMeetingId: 'm2',
                evidenceQuote: 'This passage does not exist.',
              },
            ],
          },
        ],
      }),
    );
    await synthesizeProjectThemes(deps);
    const theme =
      deps.saveTheme.mock.calls[0][0].metadata.projectThemeSynthesis;
    expect(theme).toMatchObject({
      summary: { text: 'Searchable records are moving toward launch.' },
      workstreams: [expect.objectContaining({ name: 'Access controls' })],
      decisions: [],
    });
  });
  it('reconsiders cached evidence when an existing project is pinned', async () => {
    const { deps } = makeDeps();
    let anchor = { ...established, metadata: established.metadata };
    const original = deps.getProject;
    const registry = {
      ...deps,
      listProjects: () => [anchor],
      getProject: (id: string) => (id === anchor.id ? anchor : original(id)),
    };
    await synthesizeProjectThemes(registry);
    await synthesizeProjectThemes(registry);
    expect(deps.generate).toHaveBeenCalledTimes(1);
    anchor = {
      ...anchor,
      metadata: JSON.stringify({
        ...JSON.parse(anchor.metadata),
        projectStarred: true,
      }),
    };
    await synthesizeProjectThemes(registry);
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(deps.generate.mock.calls[1][0]).toContain('"pinned":true');
  });
  it('keeps pinned targets in the registry ahead of eighty unpinned projects', async () => {
    const { deps } = makeDeps();
    const pinned = {
      ...established,
      id: 'pinned-root',
      metadata: JSON.stringify({
        ...JSON.parse(established.metadata),
        projectStarred: true,
      }),
    };
    const registry = Array.from({ length: 80 }, (_, index) => ({
      ...established,
      id: `older-${index}`,
    })).concat(pinned);
    const original = deps.getProject;
    await synthesizeProjectThemes({
      ...deps,
      listProjects: () => registry,
      getProject: (id: string) =>
        registry.find((project) => project.id === id) || original(id),
    });
    expect(deps.generate.mock.calls[0][0]).toContain('"id":"pinned-root"');
  });
});
