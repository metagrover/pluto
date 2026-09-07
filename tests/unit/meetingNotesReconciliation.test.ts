import { describe, expect, it, vi } from 'vitest';
import * as guardrails from '../../electron/llm/meetingNotesGuardrails';
import {
  buildSourceReconciliationPrompt,
  parseReconciledSource,
  reconciliationDraft,
} from '../../electron/llm/meetingNotesReconciliation';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';

const fixture = () => {
  const source = createNotesSource(
    JSON.stringify([
      { speaker: 'Mira', text: 'I moved here in 2020 to be near my family.' },
      {
        speaker: 'Tao',
        text: 'I will send the report by Friday if legal approves.',
      },
      { speaker: 'Mira', text: 'The decision is a staged rollout.' },
      { speaker: 'Tao', text: 'How will we measure adoption?' },
    ]),
  );
  const spans = source.segments.map((segment) => ({
    segment: segment.index,
    start: 0,
    end: segment.text.length,
  }));
  const raw = {
    facts: [
      { text: 'Mira moved in 2020 to be near family.', sources: [spans[0]!] },
    ],
    actions: [
      {
        text: 'Tao will send the report by Friday if legal approves.',
        owner: 'Tao',
        due: 'Friday',
        sources: [spans[1]!],
      },
    ],
    decisions: [
      {
        text: 'The decision is a staged rollout.',
        owner: 'Mira',
        sources: [spans[2]!],
      },
    ],
    questions: [
      { text: 'How will we measure adoption?', sources: [spans[3]!] },
    ],
  };
  return { source, spans, raw };
};

const empty = () => ({ facts: [], actions: [], decisions: [], questions: [] });

describe('source reconciliation contract', () => {
  it('scopes omission guards to a canonical leaf and rejects cross-leaf citations', () => {
    const source = createNotesSource(
      JSON.stringify({
        segments: [
          { speaker: 'Mira', text: 'I will send the report by Friday.' },
          { speaker: 'Tao', text: 'The launch color is blue.' },
        ],
      }),
    );
    const spans = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const action = {
      text: source.segments[0]!.text,
      sources: [spans[0]!],
      owner: 'Mira',
      due: 'Friday',
    };
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...empty(), actions: [action] }),
        source,
        [spans[0]!],
        'leaf:0',
      ),
    ).not.toThrow();
    expect(() =>
      parseReconciledSource(JSON.stringify(empty()), source, [spans[0]!]),
    ).toThrow('missing_action');
    expect(() =>
      parseReconciledSource(
        JSON.stringify({
          ...empty(),
          facts: [{ text: 'The launch color is blue.', sources: [spans[1]!] }],
        }),
        source,
        [spans[0]!],
      ),
    ).toThrow('notes_reconciliation_source_out_of_scope');
  });

  it('preserves each category, original content, explicit metadata and exact spans', () => {
    const { source, raw } = fixture();
    const result = parseReconciledSource(JSON.stringify(raw), source);
    expect(result).toMatchObject(raw);
    expect(result.actions[0]!.text).toBe(raw.actions[0]!.text);
    expect(Object.keys(result)).toEqual(Object.keys(raw));
    expect(Object.keys(result.facts[0]!)).not.toContain('owner');
    expect(Object.keys(result.decisions[0]!)).not.toContain('due');
  });

  it('assigns unique deterministic ids without trusting model ids', () => {
    const { source, raw } = fixture();
    const withIds = Object.fromEntries(
      Object.entries(raw).map(([key, items]) => [
        key,
        items.map((item) => ({ ...item, id: '__proto__' })),
      ]),
    );
    const first = parseReconciledSource(JSON.stringify(withIds), source);
    const second = parseReconciledSource(JSON.stringify(withIds), source);
    const ids = Object.values(first)
      .flat()
      .map((item) => item.id);
    expect(first).toEqual(second);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('__proto__');
  });

  it('does not infer metadata or rewrite the returned action prose', () => {
    const { source, raw } = fixture();
    const action = {
      ...raw.actions[0]!,
      text: '  I will send the report by Friday if legal approves.  ',
      owner: null,
      due: null,
    };
    const result = parseReconciledSource(
      JSON.stringify({ ...empty(), actions: [action] }),
      source,
    );
    expect(result.actions[0]).toMatchObject(action);
  });

  it('checks the raw mechanical draft before any prose or metadata normalization', () => {
    const { source, raw } = fixture();
    const action = {
      ...raw.actions[0]!,
      text: '  I will send the report by Friday if legal approves.  ',
      owner: null,
      due: null,
    };
    const check = vi.spyOn(guardrails, 'findNotesGuardrailIssues');
    try {
      parseReconciledSource(
        JSON.stringify({ ...empty(), actions: [action] }),
        source,
      );
      expect(check.mock.calls[0]![1].sections[0]!.items[0]).toMatchObject(
        action,
      );
    } finally {
      check.mockRestore();
    }
  });

  it('freezes returned evidence and never modifies the original source', () => {
    const { source, raw } = fixture();
    const original = JSON.stringify(source);
    const result = parseReconciledSource(JSON.stringify(raw), source);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.actions)).toBe(true);
    expect(Object.isFrozen(result.actions[0])).toBe(true);
    expect(Object.isFrozen(result.actions[0]!.sources)).toBe(true);
    expect(Object.isFrozen(result.actions[0]!.sources[0])).toBe(true);
    expect(JSON.stringify(source)).toBe(original);
  });

  it('creates only a mechanical section with the union of citations and no overview', () => {
    const { source, raw, spans } = fixture();
    raw.questions[0]!.sources.push(spans[0]!);
    const result = parseReconciledSource(JSON.stringify(raw), source);
    const draft = reconciliationDraft(result);
    expect(draft.meetingType).toBe('general');
    expect(draft.overview).toBeNull();
    expect(draft.sections).toHaveLength(1);
    expect(draft.sections[0]!.title).toMatchObject({
      text: 'Conversation',
      sources: spans,
    });
    expect(draft.sections[0]!.items.map((item) => item.kind)).toEqual([
      'point',
      'action',
      'decision',
      'question',
    ]);
    expect(draft.sections[0]!.items.map((item) => item.id)).toEqual(
      Object.values(result)
        .flat()
        .map((item) => item.id),
    );
    expect(draft.sections[0]!.items[1]).toMatchObject(result.actions[0]!);
    draft.sections[0]!.items[1]!.sources[0]!.start = 4;
    expect(result.actions[0]!.sources[0]!.start).toBe(0);
  });

  it('allows no substantive content without manufacturing a section or prose', () => {
    const source = createNotesSource(
      JSON.stringify([{ speaker: 'Mira', text: 'Nice weather today.' }]),
    );
    const result = parseReconciledSource(JSON.stringify(empty()), source);
    expect(result).toEqual(empty());
    expect(reconciliationDraft(result)).toEqual({
      meetingType: 'general',
      overview: null,
      sections: [],
    });
  });

  it('rejects empty reconciliation when original source contains a clear promise', () => {
    expect(() =>
      parseReconciledSource(JSON.stringify(empty()), fixture().source),
    ).toThrow(/missing_action/);
  });

  it.each([
    [
      'Rina',
      'No need for that summary. Could you instead email the raw responses to Amara on Monday?',
      'No summary is needed.',
    ],
    [
      'Nora',
      'Thanks, Ben, but let us leave the announcement unassigned for now.',
      'Leave the announcement unassigned for now.',
    ],
    [
      'Nora',
      'If legal approves, I can draft the announcement. Let us leave the announcement unassigned for now.',
      'Leave the announcement unassigned for now.',
    ],
  ])(
    'accepts %s explicit negative decision without borrowing a neighboring request or offer',
    (speaker, text, decision) => {
      const source = createNotesSource(JSON.stringify([{ speaker, text }]));
      const item = {
        text: decision,
        owner: speaker,
        sources: [{ segment: 0, start: 0, end: text.length }],
      };
      const result = parseReconciledSource(
        JSON.stringify({ ...empty(), decisions: [item] }),
        source,
      );
      expect(result.decisions[0]).toMatchObject(item);
      expect(result.actions).toEqual([]);
      expect(() =>
        parseReconciledSource(
          JSON.stringify({
            ...empty(),
            decisions: [{ ...item, owner: 'Ben' }],
          }),
          source,
        ),
      ).toThrow(/invalid_commitment/);
    },
  );

  it.each([
    ['Maybe no need for that summary.', 'No summary is needed.'],
    [
      'Should we leave the announcement unassigned?',
      'Leave the announcement unassigned.',
    ],
    ['Could we skip the summary?', 'Skip the summary.'],
    [
      "Let's consider leaving the announcement unassigned.",
      'Leave the announcement unassigned.',
    ],
    ['No summary assignment.', 'No summary assignment.'],
    ['The report is not ready.', 'The report is not ready.'],
    [
      'The program is not being proposed.',
      'The program is not being proposed.',
    ],
    [
      'No need for that summary. Could we cancel the launch?',
      'The launch is cancelled.',
    ],
    ['No need for that summary if legal approves.', 'No summary is needed.'],
  ])(
    'rejects non-decisions, unrelated choices, and lost conditions: %s',
    (text, decision) => {
      const source = createNotesSource(
        JSON.stringify([{ speaker: 'Rina', text }]),
      );
      expect(() =>
        parseReconciledSource(
          JSON.stringify({
            ...empty(),
            decisions: [
              {
                text: decision,
                owner: null,
                sources: [{ segment: 0, start: 0, end: text.length }],
              },
            ],
          }),
          source,
        ),
      ).toThrow(/invalid_commitment/);
    },
  );

  it.each([
    [
      'No need to cancel the report. Could you instead email the raw responses to Amara on Monday?',
      'No report is needed.',
    ],
    ['No need to leave the report unassigned.', 'No report is needed.'],
    [
      'No need to send the report to us. Could you send it to Amara?',
      'No need to send the report.',
    ],
    ['No need for that summary for us.', 'No summary is needed.'],
    ['No need to send the report to us.', 'No need to send the report for us.'],
    [
      'No need for the summary if legal approves and Amara signs off.',
      'No summary is needed if legal approves.',
    ],
    [
      'No need for the summary if legal approves and Amara signs off.',
      'No summary is needed if legal approves or Amara signs off.',
    ],
  ])(
    'rejects a negative decision that loses its predicate or part of its prerequisite: %s',
    (text, decision) => {
      const source = createNotesSource(
        JSON.stringify([{ speaker: 'Rina', text }]),
      );
      expect(() =>
        parseReconciledSource(
          JSON.stringify({
            ...empty(),
            decisions: [
              {
                text: decision,
                owner: 'Rina',
                sources: [{ segment: 0, start: 0, end: text.length }],
              },
            ],
          }),
          source,
        ),
      ).toThrow(/invalid_commitment/);
    },
  );

  it.each([
    [
      'No need to cancel the report. Could you instead email the raw responses to Amara on Monday?',
      'No need to cancel the report.',
    ],
    [
      'No need to leave the report unassigned.',
      'No need to leave the report unassigned.',
    ],
    [
      'No need to send the report to us. Could you send it to Amara?',
      'No need to send the report to us.',
    ],
    ['No need for that summary for us.', 'No summary is needed for us.'],
    [
      'No need for the summary if legal approves and Amara signs off.',
      'No summary is needed if legal approves and Amara signs off.',
    ],
  ])(
    'preserves a complete negative-decision predicate and prerequisite: %s',
    (text, decision) => {
      const source = createNotesSource(
        JSON.stringify([{ speaker: 'Rina', text }]),
      );
      const item = {
        text: decision,
        owner: 'Rina',
        sources: [{ segment: 0, start: 0, end: text.length }],
      };
      expect(
        parseReconciledSource(
          JSON.stringify({ ...empty(), decisions: [item] }),
          source,
        ).decisions[0],
      ).toMatchObject(item);
    },
  );

  it.each([false, true])(
    'preserves the saved launch-announcement choice with offer-context citation=%s',
    (includeOffer) => {
      const source = createNotesSource(
        JSON.stringify([
          {
            speaker: 'Ben',
            text: 'If legal approves, I can draft the launch announcement.',
          },
          {
            speaker: 'Nora',
            text: 'Thanks, Ben, but let us leave the announcement unassigned for now.',
          },
        ]),
      );
      const sources = source.segments
        .filter((segment) => includeOffer || segment.index === 1)
        .map((segment) => ({
          segment: segment.index,
          start: 0,
          end: segment.text.length,
        }));
      const item = {
        text: 'The launch announcement is to remain unassigned for now.',
        owner: 'Nora',
        sources,
      };
      const parseQualified = () =>
        parseReconciledSource(
          JSON.stringify({ ...empty(), decisions: [item] }),
          source,
        );
      if (includeOffer)
        expect(parseQualified().decisions[0]).toMatchObject(item);
      else expect(parseQualified).toThrow(/invalid_commitment/);
      const pastTense = {
        ...item,
        text: 'The announcement is left unassigned for now.',
        owner: null,
      };
      expect(
        parseReconciledSource(
          JSON.stringify({ ...empty(), decisions: [pastTense] }),
          source,
        ).decisions[0],
      ).toMatchObject(pastTense);
      for (const text of [
        'The launch report is to remain unassigned for now.',
        'The launch announcement and report are to remain unassigned for now.',
        'Leave another announcement unassigned for now.',
        'Leave other announcement unassigned for now.',
        'The cancellation announcement is left unassigned for now.',
      ]) {
        expect(() =>
          parseReconciledSource(
            JSON.stringify({ ...empty(), decisions: [{ ...item, text }] }),
            source,
          ),
        ).toThrow(/invalid_commitment/);
      }
    },
  );

  it('does not use a qualifier from an unrelated cited phrase or a target-changing determiner', () => {
    const source = createNotesSource(
      JSON.stringify([
        {
          speaker: 'Ben',
          text: 'The cancellation was discussed. I can draft another announcement.',
        },
        {
          speaker: 'Nora',
          text: 'Let us leave the announcement unassigned for now.',
        },
      ]),
    );
    const sources = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    for (const text of [
      'Leave the cancellation announcement unassigned for now.',
      'Leave another announcement unassigned for now.',
    ]) {
      expect(() =>
        parseReconciledSource(
          JSON.stringify({
            ...empty(),
            decisions: [{ text, owner: 'Nora', sources }],
          }),
          source,
        ),
      ).toThrow(/invalid_commitment/);
    }
  });

  it.each(['facts', 'actions', 'decisions', 'questions'])(
    'requires the %s array',
    (field) => {
      const { source, raw } = fixture();
      const value: Record<string, unknown> = { ...raw };
      delete value[field];
      expect(() =>
        parseReconciledSource(JSON.stringify(value), source),
      ).toThrow();
      value[field] = {};
      expect(() =>
        parseReconciledSource(JSON.stringify(value), source),
      ).toThrow();
    },
  );

  it.each([
    'null',
    '[]',
    'broken json',
    '{"facts":[],"actions":[],"decisions":[],"questions":[],"overview":"invented"}',
  ])('rejects a non-contract payload %s', (raw) => {
    expect(() => parseReconciledSource(raw, fixture().source)).toThrow();
  });

  it.each([
    null,
    {},
    { text: '', sources: [] },
    { text: 12, sources: [] },
    { text: 'Fact', sources: 'R0' },
  ])('rejects a malformed item without deleting it: %j', (item) => {
    const { source, raw } = fixture();
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...raw, facts: [...raw.facts, item] }),
        source,
      ),
    ).toThrow();
  });

  it.each(['owner', 'due'])('requires explicit nullable action %s', (field) => {
    const { source, raw } = fixture();
    const action: Record<string, unknown> = { ...raw.actions[0] };
    delete action[field];
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...raw, actions: [action] }),
        source,
      ),
    ).toThrow();
    action[field] = 42;
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...raw, actions: [action] }),
        source,
      ),
    ).toThrow();
  });

  it('requires explicit nullable decision owner but not due', () => {
    const { source, raw } = fixture();
    const decision: Record<string, unknown> = { ...raw.decisions[0] };
    decision.owner = undefined;
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...raw, decisions: [decision] }),
        source,
      ),
    ).toThrow();
    decision.owner = null;
    expect(
      parseReconciledSource(
        JSON.stringify({ ...raw, decisions: [decision] }),
        source,
      ).decisions[0]!.owner,
    ).toBeNull();
    decision.owner = [];
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...raw, decisions: [decision] }),
        source,
      ),
    ).toThrow();
  });

  it.each([
    [],
    ['R99'],
    [{ segment: 99, start: 0, end: 1 }],
    [{ segment: 0, start: -1, end: 1 }],
    [{ segment: 0, start: 0, end: 9999 }],
    [{ segment: 0, start: 1, end: 1 }],
    [{ segment: '0', start: 0, end: 1 }],
    [{ segment: 0, start: 0.5, end: 1 }],
  ])('rejects invalid original-source spans %j', (sources) => {
    const { source, raw } = fixture();
    expect(() =>
      parseReconciledSource(
        JSON.stringify({ ...raw, facts: [{ ...raw.facts[0], sources }] }),
        source,
      ),
    ).toThrow();
  });

  it('rejects whitespace-only evidence and split Unicode characters', () => {
    const source = createNotesSource(JSON.stringify([{ text: '  😀' }]));
    for (const [start, end] of [
      [0, 2],
      [2, 3],
    ]) {
      expect(() =>
        parseReconciledSource(
          JSON.stringify({
            ...empty(),
            facts: [{ text: 'A face', sources: [{ segment: 0, start, end }] }],
          }),
          source,
        ),
      ).toThrow();
    }
  });

  it('rejects non-descriptor fields instead of returning unvalidated source payloads', () => {
    const { source, raw, spans } = fixture();
    expect(() =>
      parseReconciledSource(
        JSON.stringify({
          ...raw,
          facts: [
            {
              ...raw.facts[0],
              sources: [{ ...spans[0], text: 'Invented source' }],
            },
          ],
        }),
        source,
      ),
    ).toThrow('notes_reconciliation_invalid');
  });

  it('rejects wrong action ownership instead of silently reassigning it', () => {
    const { source, raw } = fixture();
    raw.actions[0]!.owner = 'Mira';
    expect(() => parseReconciledSource(JSON.stringify(raw), source)).toThrow(
      /invalid_commitment/,
    );
  });

  it('rejects an unsupported due date instead of silently clearing it', () => {
    const { source, raw } = fixture();
    raw.actions[0]!.due = 'Monday';
    expect(() => parseReconciledSource(JSON.stringify(raw), source)).toThrow(
      /invalid_commitment/,
    );
  });

  it('rejects losing a prerequisite from the accepted action text', () => {
    const { source, raw } = fixture();
    raw.actions[0]!.text = 'Tao will send the report by Friday.';
    expect(() => parseReconciledSource(JSON.stringify(raw), source)).toThrow(
      /invalid_commitment/,
    );
  });

  describe('equivalent conditional promises', () => {
    const conditionalPromise = (text: string) => {
      const source = createNotesSource(
        JSON.stringify([
          {
            speaker: 'Ava',
            text: 'If finance approves, I will send the revised budget to Nora by Thursday.',
          },
          {
            speaker: 'Ava',
            text: 'My budget promise still depends on finance approval; it is not an unconditional send.',
          },
        ]),
      );
      const action = {
        text,
        owner: 'Ava',
        due: 'Thursday',
        sources: source.segments.map((segment) => ({
          segment: segment.index,
          start: 0,
          end: segment.text.length,
        })),
      };
      return { source, action };
    };

    it.each([
      'conditional on finance approval',
      'contingent on finance approval',
      'contingent upon finance approval',
      'if finance approves',
    ])('preserves a promise phrased as %s', (condition) => {
      const { source, action } = conditionalPromise(
        `Ava will send the revised budget to Nora by Thursday, ${condition}.`,
      );
      const original = JSON.stringify(source);
      const result = parseReconciledSource(
        JSON.stringify({ ...empty(), actions: [action] }),
        source,
      );
      expect(result.actions[0]).toMatchObject(action);
      expect(result.actions[0]!.text).toBe(action.text);
      expect(JSON.stringify(source)).toBe(original);
    });

    it.each([
      'Ava will send the revised budget to Nora by Thursday.',
      'Ava will send the revised budget to Nora by Thursday if finance does not approve.',
      'Ava will send the revised budget to Nora by Thursday, conditional on finance not approving.',
    ])('rejects a dropped or negated prerequisite: %s', (text) => {
      const { source, action } = conditionalPromise(text);
      expect(() =>
        parseReconciledSource(
          JSON.stringify({ ...empty(), actions: [action] }),
          source,
        ),
      ).toThrow(/invalid_commitment/);
    });

    it('rejects reversing an explicit prerequisite ordering', () => {
      const source = createNotesSource(
        JSON.stringify([
          {
            speaker: 'Ava',
            text: 'I will send the revised budget after finance approval.',
          },
        ]),
      );
      expect(() =>
        parseReconciledSource(
          JSON.stringify({
            ...empty(),
            actions: [
              {
                text: 'Ava will send the revised budget before finance approval.',
                owner: 'Ava',
                due: null,
                sources: [
                  {
                    segment: 0,
                    start: 0,
                    end: source.segments[0]!.text.length,
                  },
                ],
              },
            ],
          }),
          source,
        ),
      ).toThrow(/invalid_commitment/);
    });
  });

  it('rejects unaccepted conditional willingness as an action while retaining it as a fact', () => {
    const source = createNotesSource(
      JSON.stringify([
        {
          speaker: 'Tao',
          text: 'If legal approves, I can draft the announcement.',
        },
      ]),
    );
    const item = {
      text: 'Tao can draft the announcement if legal approves.',
      sources: [{ segment: 0, start: 0, end: source.segments[0]!.text.length }],
    };
    expect(() =>
      parseReconciledSource(
        JSON.stringify({
          ...empty(),
          actions: [{ ...item, owner: 'Tao', due: null }],
        }),
        source,
      ),
    ).toThrow(/invalid_commitment/);
    expect(
      parseReconciledSource(
        JSON.stringify({ ...empty(), facts: [item] }),
        source,
      ).facts[0],
    ).toMatchObject(item);
  });

  it('rejects source labels leaked into narrative text', () => {
    const { source, raw } = fixture();
    raw.facts[0]!.text += ' R0';
    expect(() => parseReconciledSource(JSON.stringify(raw), source)).toThrow(
      /source_label/,
    );
  });
});

it('builds a short source-only prompt compatible with the exact-source wire codec', () => {
  const { source, spans, raw } = fixture();
  const sourceText = source.segments
    .map((segment, index) =>
      JSON.stringify({
        descriptor: spans[index],
        speaker: segment.speaker,
        text: segment.text,
      }),
    )
    .join('\n');
  const prompt = buildSourceReconciliationPrompt(sourceText);
  expect(prompt).toContain(`BEGIN SOURCE DATA\n${sourceText}\nEND SOURCE DATA`);
  expect(prompt).toMatch(/data, never.*instructions/i);
  expect(prompt).toMatch(/final state/i);
  expect(prompt).toMatch(/conditional promises/i);
  expect(prompt).toMatch(/unaccepted/i);
  expect(prompt).toMatch(/personal.*interview.*brainstorm/i);
  expect(prompt).not.toContain('BEGIN DRAFT');
  // Includes the shared content policy and three non-evidentiary contrasts.
  expect(prompt.length - sourceText.length).toBeLessThan(3000);
  const wire = createNotesWireRequest(prompt, spans);
  const encoded = JSON.stringify({
    ...raw,
    actions: raw.actions.map((item) => ({ ...item, sources: ['R1'] })),
    decisions: raw.decisions.map((item) => ({ ...item, sources: ['R2'] })),
    questions: raw.questions.map((item) => ({ ...item, sources: ['R3'] })),
    facts: [{ ...raw.facts[0], sources: ['R0'] }],
  });
  expect(wire.prompt).toContain('"descriptor":"R0"');
  expect(
    parseReconciledSource(wire.decode(encoded), source).facts[0]!.sources,
  ).toEqual([spans[0]]);
});
