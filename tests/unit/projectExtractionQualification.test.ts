import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  existing: [] as any[],
  upsertEntity: vi.fn(),
  linkEntities: vi.fn(),
  addMeetingEntity: vi.fn(),
  retireMeetingDerivedCommitments: vi.fn(),
  withCommitmentTransaction: vi.fn((operation: () => unknown) => operation()),
}));
vi.mock('../../electron/db', () => ({
  getEntitiesByType: (type: string) =>
    mock.existing.filter((e) => e.type === type),
  upsertEntity: mock.upsertEntity,
  linkEntities: mock.linkEntities,
  addMeetingEntity: mock.addMeetingEntity,
  retireMeetingDerivedCommitments: mock.retireMeetingDerivedCommitments,
  withCommitmentTransaction: mock.withCommitmentTransaction,
  db: {
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => undefined),
      run: vi.fn(),
    })),
    transaction: vi.fn((fn: () => unknown) => fn()),
  },
}));
import { processExtractedEntities } from '../../electron/entityPipeline';
import { readProjectQualification } from '../../src/utils/projectQualification';
beforeEach(() => {
  vi.clearAllMocks();
  mock.existing = [];
  mock.upsertEntity.mockImplementation((e) => ({
    ...e,
    id: e.id || e.name,
    metadata: JSON.stringify(e.metadata || {}),
  }));
});
describe('project extraction qualification', () => {
  it('retains name-only candidates without fabricating topic membership', async () => {
    const result = await processExtractedEntities(
      {
        people: [],
        topics: [{ name: 'Search', importance: 'high' }],
        action_items: [],
        decisions: [],
        projects: [{ name: 'Archive' }],
      },
      'm1',
      undefined,
      'We discussed the Archive.',
    );
    const project = result.entities.find((e) => e.type === 'project');
    expect(readProjectQualification(project?.metadata)?.state).toBe(
      'unassessed',
    );
    expect(mock.linkEntities).not.toHaveBeenCalled();
  });
  it('preserves a user override and unrelated metadata', async () => {
    const qualification = {
      version: 1,
      state: 'qualified',
      reason: 'User confirmed',
      source: 'user',
      assessedAt: '2026-08-28T12:00:00Z',
    };
    mock.existing = [
      {
        id: 'p',
        name: 'Archive',
        type: 'project',
        metadata: JSON.stringify({
          color: 'blue',
          projectQualification: qualification,
        }),
      },
    ];
    await processExtractedEntities(
      {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: [{ name: 'Archive', context: 'New context' }],
      },
      'm1',
      undefined,
      'Archive is a single fix.',
    );
    expect(mock.upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          color: 'blue',
          projectQualification: qualification,
        }),
      }),
    );
  });
});

it('does not merge a routine candidate into its larger namesake project', async () => {
  mock.existing = [
    { id: 'parent', name: 'Archive', type: 'project', metadata: '{}' },
  ];
  const result = await processExtractedEntities(
    {
      people: [],
      topics: [],
      action_items: [],
      decisions: [],
      projects: [{ name: 'Archive Configuration' }],
    },
    'm1',
    undefined,
    'Archive Configuration was discussed.',
  );
  expect(result.entities[0].id).not.toBe('parent');
});

it('supports only grounded explicit membership with a qualified project target', async () => {
  const qualification = {
    version: 1,
    state: 'qualified',
    reason: 'Confirmed',
    source: 'user',
    assessedAt: '2026-08-28T12:00:00Z',
  };
  mock.existing = [
    {
      id: 'parent',
      name: 'Archive',
      type: 'project',
      metadata: JSON.stringify({ projectQualification: qualification }),
    },
  ];
  await processExtractedEntities(
    {
      people: [],
      topics: [{ name: 'Search', importance: 'high' }],
      action_items: [],
      decisions: [],
      projects: [],
      relationships: [
        {
          source: 'Search',
          target: 'Archive',
          relationship: 'belongs_to',
          context: 'Search is part of Archive.',
        },
      ],
    },
    'm1',
    undefined,
    'Search is part of Archive.',
  );
  expect(mock.linkEntities).toHaveBeenCalledWith(
    expect.objectContaining({
      relationship: 'belongs_to',
      evidence_quote: 'Search is part of Archive.',
    }),
  );
  mock.linkEntities.mockClear();
  await processExtractedEntities(
    {
      people: [],
      topics: [{ name: 'Search', importance: 'high' }],
      action_items: [],
      decisions: [],
      projects: [],
      relationships: [
        {
          source: 'Search',
          target: 'Archive',
          relationship: 'belongs_to',
          context: 'Invented relationship evidence.',
        },
      ],
    },
    'm1',
    undefined,
    'Search is part of Archive.',
  );
  expect(mock.linkEntities).not.toHaveBeenCalled();
});

it.each(['qualified', 'subordinate'] as const)(
  'uses the current assessment (%s) for membership',
  async (state) => {
    const oldState = state === 'qualified' ? 'unassessed' : 'qualified';
    mock.existing = [
      {
        id: 'parent',
        name: 'Archive',
        type: 'project',
        metadata: JSON.stringify({
          projectQualification: {
            version: 1,
            state: oldState,
            reason: 'Earlier',
            source: 'extraction',
            assessedAt: '2026-08-28T12:00:00Z',
          },
        }),
      },
    ];
    const transcript =
      'Deliver a searchable archive. Index the historical records. Build the search interface. Search is part of Archive.';
    await processExtractedEntities(
      {
        people: [],
        topics: [{ name: 'Search', importance: 'high' }],
        action_items: [],
        decisions: [],
        projects: [
          {
            name: 'Archive',
            qualification: {
              kind: state === 'qualified' ? 'initiative' : 'task',
              outcome: 'Searchable archive',
              outcomeEvidenceQuote: 'Deliver a searchable archive.',
              workItems: [
                {
                  description: 'Index records',
                  evidenceQuote: 'Index the historical records.',
                },
                {
                  description: 'Build search',
                  evidenceQuote: 'Build the search interface.',
                },
              ],
            },
          },
        ],
        relationships: [
          {
            source: 'Search',
            target: 'Archive',
            relationship: 'belongs_to',
            context: 'Search is part of Archive.',
          },
        ],
      },
      'm1',
      undefined,
      transcript,
    );
    expect(mock.linkEntities).toHaveBeenCalledTimes(
      state === 'qualified' ? 1 : 0,
    );
  },
);

it.each([{}, 12])('ignores malformed membership quote %j', async (context) => {
  await expect(
    processExtractedEntities(
      {
        people: [],
        topics: [],
        action_items: [],
        decisions: [],
        projects: [],
        relationships: [
          {
            source: 'Search',
            target: 'Archive',
            relationship: 'belongs_to',
            context,
          },
        ],
      } as unknown as import('../../electron/llm/provider').ExtractedEntities,
      'm1',
      undefined,
      'Search is part of Archive.',
    ),
  ).resolves.toBeDefined();
  expect(mock.linkEntities).not.toHaveBeenCalled();
});
