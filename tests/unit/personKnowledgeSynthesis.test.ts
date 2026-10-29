import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  groundPersonKnowledgeV2Document,
  mergeKnowledgeV2Documents,
} from '../../electron/knowledgeV2';
import {
  compilePersonKnowledgeChunk,
  getPersonKnowledgeChunkPrompt,
  getPersonKnowledgeChunkResponseSchema,
  personProfilePreservesEvidence,
} from '../../electron/personKnowledgeSynthesis';

const sources = [
  {
    id: 'meeting-one',
    title: 'Interface review',
    occurred_at: '2026-07-10T12:00:00.000Z',
    evidence: 'Summary: Avery added the client tenure to the UI.',
  },
  {
    id: 'meeting-two',
    title: 'Field review',
    occurred_at: '2026-07-12T12:00:00.000Z',
    evidence: 'Summary: Avery reviewed the tenure field.',
  },
];

describe('compact person knowledge synthesis', () => {
  it('rejects consolidation that drops evidence or moves it to another section', () => {
    const profile = compilePersonKnowledgeChunk('Avery', 0, sources, {
      profile: sources.map((source) => ({
        section: 'responsibilities',
        summary: source.evidence.slice('Summary: '.length),
        citations: [
          {
            meeting_id: source.id,
            quote: source.evidence.slice('Summary: '.length),
          },
        ],
      })),
    }).person_profile!;
    expect(personProfilePreservesEvidence(profile, profile)).toBe(true);
    expect(personProfilePreservesEvidence(profile, profile.slice(0, 1))).toBe(
      false,
    );
    expect(
      personProfilePreservesEvidence(
        profile,
        profile.map((claim) => ({ ...claim, section: 'unknowns' })),
      ),
    ).toBe(false);
    expect(personProfilePreservesEvidence(profile, [])).toBe(false);
  });

  it('preserves a comprehensive profile through merge and grounding, including one-source context', () => {
    const chunk = compilePersonKnowledgeChunk('Avery', 0, sources, {
      profile: [
        {
          section: 'overview',
          summary: 'Avery added and reviewed the tenure field.',
          citations: [
            {
              meeting_id: 'meeting-one',
              quote: 'Avery added the client tenure to the UI.',
            },
            {
              meeting_id: 'meeting-two',
              quote: 'Avery reviewed the tenure field.',
            },
          ],
        },
        {
          section: 'responsibilities',
          title: 'Interface contribution',
          summary: 'Avery added the tenure field to the interface.',
          citations: [
            {
              meeting_id: 'meeting-one',
              quote: 'Avery added the client tenure to the UI.',
            },
          ],
        },
        {
          section: 'collaboration',
          summary: 'An invented preference.',
          citations: [
            {
              meeting_id: 'meeting-one',
              quote: 'Avery prefers written recommendations.',
            },
          ],
        },
        {
          section: 'priorities',
          summary: 'Unknown source.',
          citations: [
            {
              meeting_id: 'unknown',
              quote: 'Avery reviewed the tenure field.',
            },
          ],
        },
      ],
    });
    const merged = mergeKnowledgeV2Documents(
      { type: 'person_context', title: 'Avery' },
      [chunk],
    );
    const grounded = groundPersonKnowledgeV2Document(
      merged,
      new Map(
        sources.map((source) => [source.id, source.evidence.toLowerCase()]),
      ),
      'Avery',
    );
    expect(grounded.person_profile?.map((claim) => claim.section)).toEqual([
      'overview',
      'responsibilities',
    ]);
    expect(grounded.current_read.headline).toBe(
      'Avery added and reviewed the tenure field.',
    );
    expect(grounded.current_read.source_count).toBe(2);
    expect(grounded.evidence_index).toHaveLength(2);
  });

  it('accepts full-name evidence and rejects evidence about a different person', () => {
    const source = {
      ...sources[0],
      evidence:
        'Avery Chen requested a written recommendation. Jordan preferred a call.',
    };
    const chunk = compilePersonKnowledgeChunk('Avery Chen', 0, [source], {
      profile: [
        {
          section: 'collaboration',
          summary: 'Avery requested a written recommendation.',
          citations: [
            {
              meeting_id: source.id,
              quote: 'Avery Chen requested a written recommendation.',
            },
          ],
        },
        {
          section: 'collaboration',
          summary: 'Avery preferred a call.',
          citations: [
            { meeting_id: source.id, quote: 'Jordan preferred a call.' },
          ],
        },
      ],
    });
    expect(chunk.person_profile).toHaveLength(1);
  });
  it('asks for a small, corrected, source-linked response', () => {
    const prompt = getPersonKnowledgeChunkPrompt('Avery', sources, [
      {
        originalClaim: 'Avery owns the product',
        correctedText: 'No owner stated',
      },
    ]);
    expect(prompt).toContain('"topics"');
    expect(prompt).toContain('meeting-one');
    expect(prompt).toContain('No owner stated');
    expect(prompt).not.toContain('"needs_attention"');
  });

  it('compiles exact person observations into a grounded recurring read', () => {
    const chunk = compilePersonKnowledgeChunk('Avery', 0, sources, {
      topics: [
        {
          title: 'Interface and Data Validation',
          read: 'Avery added and reviewed the tenure field.',
          citations: [
            {
              meeting_id: 'meeting-one',
              quote: 'Avery added the client tenure to the UI.',
            },
            {
              meeting_id: 'meeting-two',
              quote: 'Avery reviewed the tenure field.',
            },
          ],
        },
        {
          title: 'Unsupported ownership',
          read: 'Avery owns the product.',
          citations: [
            { meeting_id: 'meeting-one', quote: 'Avery owns the product.' },
          ],
        },
      ],
    });
    const merged = mergeKnowledgeV2Documents(
      { type: 'person_context', title: 'Avery' },
      [chunk],
    );
    const grounded = groundPersonKnowledgeV2Document(
      merged,
      new Map(
        sources.map((source) => [source.id, source.evidence.toLowerCase()]),
      ),
      'Avery',
    );

    expect(chunk.active_streams).toHaveLength(1);
    expect(chunk.evidence_index).toHaveLength(2);
    expect(grounded.current_read.source_count).toBe(2);
    expect(grounded.current_read.headline).toBe(
      'Avery has worked on tenure-related changes.',
    );
    expect(grounded.evidence_index).toHaveLength(2);
  });
});

describe('person reference position', () => {
  it.each([
    'For the launch, Avery prepared the checklist.',
    "Avery's checklist was completed for the launch.",
    'The checklist was prepared by Avery.',
    'Avery’s checklist was completed.',
  ])(
    'retains attributable exact quotes regardless of name position: %s',
    (quote) => {
      const source = {
        id: 'm',
        title: 'Launch',
        occurred_at: null,
        evidence: quote,
      };
      const chunk = compilePersonKnowledgeChunk('Avery', 0, [source], {
        profile: [
          {
            section: 'responsibilities',
            summary: 'Avery contributed the launch checklist.',
            citations: [{ meeting_id: 'm', quote }],
          },
        ],
      });
      expect(chunk.person_profile).toHaveLength(1);
      const grounded = groundPersonKnowledgeV2Document(
        chunk,
        new Map([['m', quote.toLowerCase()]]),
        'Avery',
      );
      expect(grounded.person_profile).toHaveLength(1);
    },
  );
  it.each([
    'Averyson prepared the launch checklist.',
    'Jordan prepared the launch checklist.',
  ])('keeps wrong or partial person names excluded: %s', (quote) => {
    const chunk = compilePersonKnowledgeChunk(
      'Avery',
      0,
      [{ id: 'm', title: 'Launch', occurred_at: null, evidence: quote }],
      {
        profile: [
          {
            section: 'responsibilities',
            summary: 'Avery prepared the checklist.',
            citations: [{ meeting_id: 'm', quote }],
          },
        ],
      },
    );
    expect(chunk.person_profile).toHaveLength(0);
  });
});

it('tells profile synthesis to leave unclear timing and undefined acronyms unresolved', () => {
  const prompt = getPersonKnowledgeChunkPrompt('Avery', sources);
  expect(prompt).toContain('never a concrete deadline or urgent priority');
  expect(prompt).toContain(
    'without expansion unless the evidence defines them',
  );
});

it('constrains generated person citations to the supplied meeting ids', () => {
  const require = createRequire(import.meta.url);
  const Ajv = createRequire(require.resolve('electron-builder'))('ajv');
  const validator = new Ajv({ allErrors: true });
  const schema = getPersonKnowledgeChunkResponseSchema(sources);
  const response = {
    topics: [],
    profile: [
      {
        section: 'responsibilities',
        title: '',
        summary: 'Avery added the client tenure to the UI.',
        citations: [
          {
            meeting_id: 'meeting-one',
            quote: 'Avery added the client tenure to the UI.',
          },
        ],
      },
    ],
  };
  expect(validator.validate(schema, response)).toBe(true);
  for (const invalidId of [
    'meeting-one (July 10)',
    'meeting-on',
    'another-meeting',
  ]) {
    response.profile[0]!.citations[0]!.meeting_id = invalidId;
    expect(validator.validate(schema, response)).toBe(false);
  }
  expect(
    validator.validate(getPersonKnowledgeChunkResponseSchema([]), {
      topics: [],
      profile: [],
    }),
  ).toBe(true);
  expect(
    validator.validate(getPersonKnowledgeChunkResponseSchema([]), response),
  ).toBe(false);
});
