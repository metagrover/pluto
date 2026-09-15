import { describe, expect, it, vi } from 'vitest';
import { reviewProjectScopeBatch } from '../../electron/projectScopeReview';

const transcript =
  'Aurora will replace the legacy billing system. First migrate all customer records. Then rebuild the invoicing service.';
const proposal = {
  kind: 'initiative',
  reason: 'A migration with distinct work packages.',
  outcome: 'Replace legacy billing',
  outcomeEvidenceQuote: 'Aurora will replace the legacy billing system.',
  workItems: [
    {
      description: 'Migrate customers',
      evidenceQuote: 'First migrate all customer records.',
    },
    {
      description: 'Rebuild invoicing',
      evidenceQuote: 'Then rebuild the invoicing service.',
    },
  ],
};
const makeDeps = (count = 1) => {
  const entities = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: 'Aurora',
    metadata: JSON.stringify({ context: 'Existing context', custom: 'keep' }),
  }));
  return {
    listProjects: () => entities,
    getProject: (id: string) => entities.find((e) => e.id === id),
    getSources: () => [{ id: 'm1', text: transcript }],
    generate: vi.fn(async (prompt: string, _schema: Record<string, unknown>) =>
      JSON.stringify({
        projects: (
          JSON.parse(
            prompt.split('CANDIDATES (untrusted data):\n')[1],
          ) as Array<{ id: string }>
        ).map((e) => ({
          id: e.id,
          sourceMeetingId: 'm1',
          qualification: proposal,
        })),
      }),
    ),
    save: vi.fn((id: string, metadata: Record<string, unknown>) => {
      entities.find((e) => e.id === id)!.metadata = JSON.stringify(metadata);
    }),
    isBusy: () => false,
  };
};

describe('bounded project scope review', () => {
  it('reviews one candidate per local-model request and preserves existing metadata', async () => {
    const deps = makeDeps(6);
    const result = await reviewProjectScopeBatch(deps);
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      reviewed: 1,
      remaining: 5,
      deferred: false,
    });
    expect(JSON.parse(deps.listProjects()[0].metadata)).toMatchObject({
      custom: 'keep',
      projectQualification: { state: 'qualified', source: 'review' },
    });
  });
  it('records malformed output as a durable retryable attempt without a qualification', async () => {
    const deps = { ...makeDeps(), saveAttempt: vi.fn() };
    deps.generate.mockResolvedValue('{"projects":[]}');
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      failedProjectId: 'p0',
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.saveAttempt).toHaveBeenCalledWith(
      'p0',
      expect.objectContaining({
        version: 2,
        status: 'failed',
        reason: 'The project review response was incomplete.',
      }),
    );
  });
  it('does not record a malformed attempt over a concurrent user correction', async () => {
    const deps = { ...makeDeps(), saveAttempt: vi.fn() };
    deps.generate.mockImplementation(async () => {
      deps.listProjects()[0].metadata = JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed',
          assessedAt: '2026-08-28',
        },
      });
      return '{"projects":[]}';
    });
    await reviewProjectScopeBatch(deps);
    expect(deps.saveAttempt).not.toHaveBeenCalled();
  });
  it('does not record a malformed attempt after source correction', async () => {
    const deps = { ...makeDeps(), saveAttempt: vi.fn() };
    let text = transcript;
    deps.getSources = () => [{ id: 'm1', text, fullText: text }];
    deps.generate.mockImplementation(async () => {
      text = 'Corrected source with newly supplied scope evidence.';
      return '{"projects":[]}';
    });
    await reviewProjectScopeBatch(deps);
    expect(deps.saveAttempt).not.toHaveBeenCalled();
  });
  it('does not write any results after a provider failure', async () => {
    const deps = makeDeps();
    deps.generate.mockRejectedValue(new Error('offline'));
    await expect(reviewProjectScopeBatch(deps)).rejects.toThrow('offline');
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('does not mark malformed or missing batch output as reviewed', async () => {
    const deps = makeDeps();
    deps.generate.mockResolvedValue('{"projects":[]}');
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      reviewed: 0,
      remaining: 1,
      failedProjectId: 'p0',
    });
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('preserves a user correction made while the provider is running', async () => {
    const deps = makeDeps();
    deps.generate.mockImplementation(async () => {
      deps.listProjects()[0].metadata = JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed',
          assessedAt: '2026-08-28',
        },
      });
      return JSON.stringify({
        projects: [
          { id: 'p0', sourceMeetingId: 'm1', qualification: proposal },
        ],
      });
    });
    await reviewProjectScopeBatch(deps);
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('defers without invoking the provider during recording or foreground work', async () => {
    const deps = { ...makeDeps(), isBusy: () => true };
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      deferred: true,
      reviewed: 0,
      remaining: 1,
    });
    expect(deps.generate).not.toHaveBeenCalled();
  });
  it('does not qualify invented evidence', async () => {
    const deps = makeDeps();
    deps.generate.mockResolvedValue(
      JSON.stringify({
        projects: [
          {
            id: 'p0',
            sourceMeetingId: 'm1',
            qualification: {
              ...proposal,
              outcomeEvidenceQuote:
                'This sentence does not appear in the transcript.',
            },
          },
        ],
      }),
    );
    await reviewProjectScopeBatch(deps);
    expect(
      JSON.parse(deps.listProjects()[0].metadata).projectQualification.state,
    ).toBe('unassessed');
  });
  it('keeps missing sources accessible without inventing a scope', async () => {
    const deps = { ...makeDeps(), getSources: () => [] };
    await reviewProjectScopeBatch(deps);
    expect(deps.generate).not.toHaveBeenCalled();
    expect(
      JSON.parse(deps.listProjects()[0].metadata).projectQualification.state,
    ).toBe('unassessed');
  });
});

describe('review response and evidence safety', () => {
  it.each([
    {},
    [],
    { kind: 'unknown' },
    { kind: 'uncertain' },
    {
      kind: 'uncertain',
      reason: 123,
      outcome: '',
      outcomeEvidenceQuote: '',
      workItems: [],
    },
    {
      kind: 'uncertain',
      reason: 'Insufficient context',
      outcome: '',
      outcomeEvidenceQuote: '',
      workItems: null,
    },
    { kind: 'initiative' },
    {
      kind: 'initiative',
      outcome: 'Migrate billing',
      outcomeEvidenceQuote: 'A source quote',
      workItems: [{}],
    },
  ])(
    'rejects malformed qualification %j without writing',
    async (qualification) => {
      const deps = makeDeps();
      deps.generate.mockResolvedValue(
        JSON.stringify({
          projects: [{ id: 'p0', sourceMeetingId: 'm1', qualification }],
        }),
      );
      expect(await reviewProjectScopeBatch(deps)).toMatchObject({
        reviewed: 0,
        remaining: 1,
        failedProjectId: 'p0',
      });
      expect(deps.save).not.toHaveBeenCalled();
    },
  );
  it('does not persist evidence that changed during generation', async () => {
    const deps = makeDeps();
    let text = transcript;
    deps.getSources = () => [{ id: 'm1', text }];
    deps.generate.mockImplementation(async () => {
      text = 'Corrected source no longer supports the original proposal.';
      return JSON.stringify({
        projects: [
          { id: 'p0', sourceMeetingId: 'm1', qualification: proposal },
        ],
      });
    });
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      attemptedProjectId: 'p0',
      reviewed: 0,
      remaining: 1,
    });
    expect(deps.save).not.toHaveBeenCalled();
  });
  it('only assigns subordinate work to a known qualified parent with direct evidence', async () => {
    const deps = makeDeps();
    deps.listProjects().push({
      id: 'parent',
      name: 'Billing Platform',
      metadata: JSON.stringify({
        projectQualification: {
          version: 1,
          state: 'qualified',
          source: 'user',
          reason: 'Confirmed',
          assessedAt: '2026-08-28',
        },
      }),
    });
    const quote = 'Aurora is a configuration task within Billing Platform.';
    deps.getSources = () => [{ id: 'm1', text: quote }];
    deps.generate.mockResolvedValue(
      JSON.stringify({
        projects: [
          {
            id: 'p0',
            sourceMeetingId: 'm1',
            qualification: {
              kind: 'task',
              reason: 'Configuration task in the larger project.',
              outcome: '',
              workItems: [],
              outcomeEvidenceQuote: quote,
              parentProjectId: 'parent',
              parentEvidenceQuote: quote,
            },
          },
        ],
      }),
    );
    await reviewProjectScopeBatch(deps);
    expect(
      JSON.parse(deps.listProjects()[0].metadata).projectQualification,
    ).toMatchObject({
      state: 'subordinate',
      parentProjectId: 'parent',
      parentEvidenceQuote: quote,
    });
  });
});

it('defers to capture and foreground work but not queued background synthesis', async () => {
  const { isProjectScopeReviewBusy } = await import(
    '../../electron/projectScopeReview'
  );
  expect(isProjectScopeReviewBusy({ llm_active: 1 })).toBe(false);
  expect(isProjectScopeReviewBusy({ capture: 1 })).toBe(true);
  expect(isProjectScopeReviewBusy({ downstream: 1 })).toBe(true);
  expect(isProjectScopeReviewBusy({ ask_pluto_session: 1 })).toBe(true);
});

describe('failed candidate isolation', () => {
  it('continues past malformed output without marking it reviewed and permits a later retry', async () => {
    const deps = makeDeps(2);
    deps.generate.mockResolvedValueOnce('{"projects":[]}');
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      reviewed: 0,
      remaining: 2,
      failedProjectId: 'p0',
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(
      await reviewProjectScopeBatch(deps, { excludeProjectIds: ['p0'] }),
    ).toMatchObject({
      reviewed: 1,
      remaining: 1,
    });
    expect(deps.save.mock.calls[0][0]).toBe('p1');
    expect(
      await reviewProjectScopeBatch(deps, { excludeProjectIds: ['p0'] }),
    ).toMatchObject({
      reviewed: 0,
      remaining: 1,
    });
    expect(deps.generate).toHaveBeenCalledTimes(2);
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      reviewed: 1,
      remaining: 0,
    });
  });

  it.each(['{"projects":', 'null', '{"projects":[null]}'])(
    'isolates invalid JSON shape %s',
    async (raw) => {
      const deps = makeDeps();
      deps.generate.mockResolvedValue(raw);
      expect(await reviewProjectScopeBatch(deps)).toMatchObject({
        failedProjectId: 'p0',
        reviewed: 0,
      });
      expect(deps.save).not.toHaveBeenCalled();
    },
  );

  it('isolates incomplete provider output but not a provider outage', async () => {
    const deps = makeDeps();
    deps.generate.mockRejectedValueOnce(
      new Error('project_scope_response_incomplete'),
    );
    expect(await reviewProjectScopeBatch(deps)).toMatchObject({
      failedProjectId: 'p0',
    });
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('constrains generated candidate and source identifiers with a JSON schema', async () => {
    const deps = makeDeps();
    await reviewProjectScopeBatch(deps);
    const schema = deps.generate.mock.calls[0][1] as any;
    expect(schema.properties.projects).toMatchObject({
      minItems: 1,
      maxItems: 1,
    });
    expect(schema.properties.projects.items.properties.id).toEqual({
      type: 'string',
      enum: ['p0'],
    });
    expect(schema.properties.projects.items.properties.sourceMeetingId).toEqual(
      { type: 'string', enum: ['m1'] },
    );
  });
});

it('requires evidence for task and initiative schema branches while allowing explicit uncertainty', async () => {
  const deps = makeDeps();
  await reviewProjectScopeBatch(deps);
  const schema = deps.generate.mock.calls[0][1] as any;
  const branches =
    schema.properties.projects.items.properties.qualification.anyOf;
  expect(branches).toHaveLength(3);
  const task = branches.find((branch: any) =>
    branch.properties.kind.enum.includes('task'),
  );
  const initiative = branches.find((branch: any) =>
    branch.properties.kind.enum.includes('initiative'),
  );
  const uncertain = branches.find((branch: any) =>
    branch.properties.kind.enum.includes('uncertain'),
  );
  expect(task.properties.outcomeEvidenceQuote.minLength).toBe(12);
  expect(task.properties.workItems.maxItems).toBe(0);
  expect(initiative.properties.workItems.minItems).toBe(2);
  expect(uncertain.properties.reason.minLength).toBe(1);
  expect(uncertain.properties.outcomeEvidenceQuote.minLength).toBeUndefined();
});

it('reconsiders legacy unresolved results and retains them as retryable if still uncertain', async () => {
  const deps = makeDeps(2);
  deps.listProjects()[0].metadata = JSON.stringify({
    custom: 'keep',
    projectQualification: {
      version: 1,
      state: 'unassessed',
      source: 'review',
      reason: 'Insufficient grounded evidence for project scope.',
      assessedAt: '2026-08-28',
    },
  });
  deps.generate.mockResolvedValueOnce(
    JSON.stringify({
      projects: [
        {
          id: 'p0',
          sourceMeetingId: 'm1',
          qualification: {
            kind: 'uncertain',
            reason: 'The earlier project plan is not available.',
            outcome: '',
            outcomeEvidenceQuote: '',
            workItems: [],
          },
        },
      ],
    }),
  );
  expect(await reviewProjectScopeBatch(deps)).toMatchObject({
    reviewed: 1,
    remaining: 2,
    unresolvedProjectId: 'p0',
  });
  expect(JSON.parse(deps.listProjects()[0].metadata)).toMatchObject({
    custom: 'keep',
    projectQualification: {
      state: 'unassessed',
      reviewVersion: 2,
      reason: 'The earlier project plan is not available.',
      issue: 'model_uncertain',
    },
  });
  expect(
    await reviewProjectScopeBatch(deps, { excludeProjectIds: ['p0'] }),
  ).toMatchObject({ reviewed: 1, remaining: 1 });
  expect(deps.save.mock.calls[1][0]).toBe('p1');
  expect(await reviewProjectScopeBatch(deps)).toMatchObject({
    reviewed: 1,
    remaining: 0,
  });
});

it('does not reconsider a user-confirmed unresolved classification', async () => {
  const deps = makeDeps();
  deps.listProjects()[0].metadata = JSON.stringify({
    projectQualification: {
      version: 1,
      state: 'unassessed',
      source: 'user',
      reason: 'Keep this ungrouped.',
      assessedAt: '2026-08-28',
    },
  });
  expect(await reviewProjectScopeBatch(deps)).toMatchObject({
    reviewed: 0,
    remaining: 0,
  });
  expect(deps.generate).not.toHaveBeenCalled();
});

it('defers cleanly when preempted by higher priority inference', async () => {
  const deps = makeDeps(1);
  const preemptionError = new Error('The operation was aborted', {
    cause: new DOMException('foreground_preempted', 'AbortError'),
  });
  deps.generate.mockRejectedValue(preemptionError);

  const result = await reviewProjectScopeBatch(deps);
  expect(result).toMatchObject({
    reviewed: 0,
    remaining: 1,
    deferred: true,
  });
  expect(deps.save).not.toHaveBeenCalled();
});
