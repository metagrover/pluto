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
});
