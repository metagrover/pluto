import { describe, expect, it } from 'vitest';
import {
  createNotesGuardrailChecker,
  findNotesGuardrailIssues,
  hasOmittedSubjectCondition,
  hasUnsupportedNotesCondition,
} from '../../electron/llm/meetingNotesGuardrails';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesItem,
  SourceSpan,
} from '../../electron/llm/meetingNotesTypes';

it.each([
  'Ari is unsure if the route is accessible.',
  'Ari does not know if the route is accessible.',
  'Ari wonders if the route is accessible.',
  'When will the route open?',
])('does not treat an information question as a prerequisite: %s', (text) => {
  expect(
    hasUnsupportedNotesCondition(
      text,
      'The accessibility and opening date are unknown.',
    ),
  ).toBe(false);
});

it.each([
  'Ari is unsure if the route will open after the inspection.',
  'When will the route open after the inspection?',
  'Ari will open the route only if the inspection passes.',
  'Ari will be unsure if the inspection fails.',
  'Ari is unsure only if the inspection fails.',
])('still checks genuine prerequisites inside question prose: %s', (text) => {
  expect(
    hasUnsupportedNotesCondition(
      text,
      'The accessibility and opening date are unknown.',
    ),
  ).toBe(true);
});

it('does not borrow an uncertainty question as an accepted prerequisite', () => {
  expect(
    hasUnsupportedNotesCondition(
      'Ari will open the route only if the inspection passes.',
      'Ari is unsure if the inspection passes.',
    ),
  ).toBe(true);
});

function fixture(...turns: string[]) {
  const source = createNotesSource(
    JSON.stringify(
      turns.map((text, index) => ({
        text,
        speaker: /^(?:yes|sure|okay)\b/i.test(text) ? 'Lee' : 'Rae',
      })),
    ),
  );
  const spans = source.segments.map(({ index, text }) => ({
    segment: index,
    start: 0,
    end: text.length,
  }));
  const item = (
    text: string,
    kind: NotesItem['kind'] = 'action',
    sources = [spans[0]!],
  ): NotesItem => ({
    id: 'item',
    text,
    kind,
    sources,
    owner: null,
    due: null,
  });
  const draft = (...items: NotesItem[]): NotesDraft => ({
    meetingType: 'general',
    overview: null,
    sections: [
      {
        id: 'section',
        title: { id: 'title', text: 'Work', sources: [spans[0]!] },
        items,
      },
    ],
  });
  return { source, spans, item, draft };
}

describe('source-grounded notes guardrails', () => {
  it.each([
    'I have sent the outline.',
    'I already sent the outline.',
    'I did send the outline.',
    'I have not sent the outline.',
  ])('leaves completion interpretation to synthesis: %s', (text) => {
    const f = fixture('I will send the outline.', text);
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([]);
  });

  it('reuses source preparation while checking edited drafts and individual actions independently', () => {
    const f = fixture(
      'I will send the outline after legal approves.',
      'I will review the budget.',
    );
    const unsafe = f.item('Send the outline', 'action', [f.spans[0]!]);
    const safe = {
      ...f.item('Review the budget', 'action', [f.spans[1]!]),
      id: 'safe',
    };
    const check = createNotesGuardrailChecker(f.source, f.spans);
    const draft = f.draft(unsafe, safe);
    expect(check(draft)).toEqual(
      findNotesGuardrailIssues(f.source, draft, f.spans),
    );
    expect(
      check(f.draft(unsafe), ['missing_condition', 'conflicting_action']),
    ).toEqual([expect.objectContaining({ code: 'missing_condition' })]);
    expect(
      check(f.draft(safe), ['missing_condition', 'conflicting_action']),
    ).toEqual([]);
    const edited = f.draft(
      { ...unsafe, text: 'Send the outline after legal approves' },
      safe,
    );
    expect(check(edited)).toEqual([]);
    expect(check(draft)).toEqual(
      findNotesGuardrailIssues(f.source, draft, f.spans),
    );
    const scoped = createNotesGuardrailChecker(f.source, [f.spans[1]!]);
    expect(scoped(f.draft(safe))).toEqual([]);
  });

  it('keeps the default diagnostic cap while selected unsafe kinds bypass unrelated omission diagnostics', () => {
    const f = fixture(
      ...Array.from({ length: 33 }, () => 'I will review the budget.'),
      'I will send the outline after legal approves.',
    );
    const draft = f.draft(
      f.item('Send the outline after approval', 'action', [f.spans[33]!]),
    );
    const defaults = findNotesGuardrailIssues(f.source, draft);
    expect(defaults).toHaveLength(32);
    expect(defaults.every((issue) => issue.code === 'missing_action')).toBe(
      true,
    );
    expect(
      findNotesGuardrailIssues(f.source, draft, undefined, [
        'missing_condition',
        'conflicting_action',
      ]),
    ).toEqual([{ code: 'missing_condition', sources: [f.spans[33]] }]);
  });

  it.each([0, 1])(
    'covers an exact repeated promise with one action citing occurrence %s',
    (occurrence) => {
      const f = fixture(
        'I will send the outline to Ben by Friday after legal approves.',
        'I will send the outline to Ben by Friday after legal approves.',
      );
      expect(
        findNotesGuardrailIssues(
          f.source,
          f.draft(
            f.item(
              'Send the outline to Ben by Friday after legal approves.',
              'action',
              [f.spans[occurrence]!],
            ),
          ),
        ),
      ).toEqual([]);
    },
  );

  it.each([
    [
      'deadline',
      'I will send the outline to Ben by Monday after legal approves.',
    ],
    [
      'condition',
      'I will send the outline to Ben by Friday after finance approves.',
    ],
    [
      'recipient',
      'I will send the outline to Lee by Friday after legal approves.',
    ],
  ])('does not merge repeated tasks with a different %s', (_field, other) => {
    const f = fixture(
      'I will send the outline to Ben by Friday after legal approves.',
      other,
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('Send the outline to Ben by Friday after legal approves.'),
        ),
      ),
    ).toEqual([{ code: 'missing_action', sources: [f.spans[1]] }]);
  });

  it.each(['Lee', null])(
    'does not combine repeated promises with a different or unknown speaker: %s',
    (speaker) => {
      const f = fixture('I will send the outline.', 'I will send the outline.');
      const source = {
        ...f.source,
        segments: f.source.segments.map((segment, index) => ({
          ...segment,
          speaker: index ? speaker : 'Rae',
        })),
      };
      expect(
        findNotesGuardrailIssues(source, f.draft(f.item('Send the outline.'))),
      ).toEqual([{ code: 'missing_action', sources: [f.spans[1]] }]);
    },
  );

  it('accepts narrated withdrawal context when its exact evidence is carried by the replacement action', () => {
    const f = fixture(
      'I will send the draft forecast on Friday.',
      'The inputs are wrong. Please do not circulate it.',
      'I withdraw the Friday commitment. Instead I will send a corrected forecast on Monday.',
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item(
            'The Friday commitment was withdrawn because the inputs were wrong.',
            'point',
            [f.spans[0]!, f.spans[1]!],
          ),
          f.item('Send a corrected forecast on Monday.', 'action', [
            f.spans[2]!,
          ]),
        ),
      ),
    ).toEqual([]);
  });

  it('does not borrow a repeated promise citation across a cancellation and renewal', () => {
    const f = fixture(
      'I will send the outline.',
      'I will not send the outline.',
      'I will send the outline.',
      'I will send the outline.',
    );
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([
      { code: 'missing_action', sources: [f.spans[2]] },
      { code: 'missing_action', sources: [f.spans[3]] },
    ]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline.', 'action', [f.spans[2]!])),
      ),
    ).toEqual([]);
  });

  it.each([
    'I am withdrawing my outline promise.',
    'I take back my earlier outline commitment.',
  ])(
    'separates repeated promises after a noun-only withdrawal: %s',
    (withdrawal) => {
      const f = fixture(
        'I will send the outline.',
        withdrawal,
        'I will send the outline.',
      );
      expect(
        findNotesGuardrailIssues(
          f.source,
          f.draft(f.item('Send the outline.')),
        ),
      ).toEqual([{ code: 'missing_action', sources: [f.spans[2]] }]);
      expect(
        findNotesGuardrailIssues(
          f.source,
          f.draft(f.item('Send the outline.', 'action', [f.spans[2]!])),
        ),
      ).toEqual([]);
    },
  );

  it.each([
    [
      'I will send the outline if legal approves, and I will update the dashboard.',
      ['Send the outline if legal approves.', 'Update the dashboard.'],
    ],
    [
      'Once legal approves, I will send the outline and update the dashboard.',
      ['Once legal approves, send the outline and update the dashboard.'],
    ],
    [
      'I will send the outline and update the dashboard once legal approves.',
      ['Send the outline and update the dashboard once legal approves.'],
    ],
  ])(
    'abstains when compound condition scope is ambiguous: %s',
    (source, actions) => {
      const f = fixture(source);
      expect(
        findNotesGuardrailIssues(
          f.source,
          f.draft(...actions.map((action) => f.item(action))),
        ),
      ).toEqual([]);
      expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([]);
    },
  );

  it('continues checking omissions in unconditional multi-task sentences', () => {
    const f = fixture('I will send the outline and update the dashboard.');
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([{ code: 'missing_action', sources: f.spans }]);
  });

  it.each([
    '; Lee will review the outline.',
    ', and Lee will review the outline.',
    ' and Lee will review the outline.',
    ', but Lee will review the outline.',
  ])('does not assemble a cancellation across clauses: %s', (tail) => {
    const f = fixture(
      'I will send the outline.',
      `I will not send the invoice${tail}`,
    );
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([]);
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([
      { code: 'missing_action', sources: [f.spans[0]] },
    ]);
  });

  it.each([
    ['unless legal approves', 'if legal does not approve'],
    ['unless legal approves', "if legal doesn't approve"],
    ['if legal does not approve', 'unless legal approves'],
    ['if legal approves', 'unless legal does not approve'],
  ])(
    'accepts equivalent effective prerequisite polarity: %s / %s',
    (original, paraphrase) => {
      const f = fixture(`I will publish the report ${original}.`);
      expect(
        findNotesGuardrailIssues(
          f.source,
          f.draft(f.item(`Publish the report ${paraphrase}.`)),
        ),
      ).toEqual([]);
    },
  );

  it('links an own-speaker do-not-send withdrawal to a conditional promise', () => {
    const f = fixture(
      'I will send the outline after legal approves it.',
      'Do not send the outline; legal rejected that plan.',
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline after legal approves it.')),
      ),
    ).toEqual([{ code: 'conflicting_action', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item(
            'Do not send the outline; legal rejected that plan.',
            'point',
            [f.spans[1]!],
          ),
        ),
      ),
    ).toEqual([]);
    const otherSpeaker = {
      ...f.source,
      segments: f.source.segments.map((segment, index) => ({
        ...segment,
        speaker: index ? 'Lee' : 'Rae',
      })),
    };
    expect(findNotesGuardrailIssues(otherSpeaker, f.draft())).toEqual([
      { code: 'missing_action', sources: [f.spans[0]] },
    ]);
  });

  it('links cancellation without repeating the earlier deadline', () => {
    const f = fixture(
      'I will send the checklist to Ben by Friday.',
      'I will not send the checklist to Ben.',
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the checklist to Ben by Friday.')),
      ),
    ).toEqual([{ code: 'conflicting_action', sources: f.spans }]);
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([]);
  });

  it('does not count a heading alone as visible cancellation context', () => {
    const f = fixture(
      'I will send the outline.',
      "I'm withdrawing my promise to send the outline; the review was cancelled.",
    );
    const draft = f.draft();
    draft.sections[0]!.title.sources = [f.spans[1]!];
    expect(findNotesGuardrailIssues(f.source, draft)).toEqual([
      { code: 'missing_cancellation_context', sources: f.spans },
    ]);
  });

  it('allows reviewed cancellation context in an overview without duplicating a point', () => {
    const f = fixture(
      'I will send the outline.',
      "I'm withdrawing my outline promise.",
    );
    const draft = f.draft();
    draft.overview = {
      id: 'overview',
      text: 'Rae withdrew the outline delivery.',
      sources: [f.spans[1]!],
    };
    expect(findNotesGuardrailIssues(f.source, draft)).toEqual([]);
  });

  it('allows a source-backed withdrawal decision without a duplicate discussion point', () => {
    const f = fixture(
      'I will send the outline.',
      "I'm withdrawing my promise to send the outline.",
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('Cancel the outline delivery.', 'decision', [f.spans[1]!]),
        ),
      ),
    ).toEqual([]);
  });

  it.each([
    'I will not send the report to Maya.',
    'I will not send the report without legal approval.',
    "I'm withdrawing my promise to send the report to Maya.",
  ])(
    'does not impose a new context requirement for ambiguous narrower cancellation: %s',
    (withdrawal) => {
      const f = fixture('I will send the report.', withdrawal);
      expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([]);
    },
  );

  it('recognizes renewal with a changed deadline as the same task', () => {
    const f = fixture(
      'I will send the checklist to Ben by Friday.',
      'I will not send the checklist to Ben.',
      'I will send the checklist to Ben by Monday.',
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('Send the checklist to Ben by Monday.', 'action', f.spans),
        ),
      ),
    ).toEqual([]);
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([
      { code: 'missing_action', sources: [f.spans[2]] },
    ]);
  });

  it.each([
    ['unless legal approves', 'if legal approves'],
    ['if legal approves', 'unless legal approves'],
    ['if legal approves', 'if legal does not approve'],
    ['if legal approves', "if legal doesn't approve"],
    ['if legal does not approve', 'if legal approves'],
  ])('preserves prerequisite polarity from %s to %s', (original, changed) => {
    const f = fixture(`I will publish the report ${original}.`);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item(`Publish the report ${changed}.`)),
      ),
    ).toEqual([{ code: 'missing_condition', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item(`Publish the report ${original}.`)),
      ),
    ).toEqual([]);
  });

  it('allows a distinctive two-word task identity to survive light compression', () => {
    const f = fixture('I will review the updated rollout checklist.');
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Review the rollout checklist.')),
      ),
    ).toEqual([]);
  });

  it('accepts a deadline stored in structured metadata', () => {
    const f = fixture('I will send the checklist to Ben by Friday.');
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft({ ...f.item('Send the checklist to Ben.'), due: 'Friday' }),
      ),
    ).toEqual([]);
  });

  it.each([
    [
      'I will send the integration checklist to Ben by Friday.',
      'I take back my earlier checklist commitment. The source data is incomplete, so no one should send it Friday.',
      'Send the integration checklist to Ben by Friday.',
    ],
    [
      "I'll replace the screenshots.",
      'I’m withdrawing my screenshot replacement promise; the images are still accurate.',
      'Replace the screenshots.',
    ],
    [
      'I will send the draft forecast on Friday.',
      'I withdraw the Friday commitment. Instead I will send a corrected forecast on Monday.',
      'Send the draft forecast on Friday.',
    ],
  ])(
    'links a same-speaker explicit withdrawal to its task: %s',
    (promise, withdrawal, action) => {
      const f = fixture(promise, withdrawal);
      expect(
        findNotesGuardrailIssues(f.source, f.draft(f.item(action)))[0]?.code,
      ).toBe('conflicting_action');
      expect(
        findNotesGuardrailIssues(
          f.source,
          f.draft(f.item(withdrawal, 'point', [f.spans[1]!])),
        ),
      ).toEqual([]);
    },
  );

  it('does not borrow a withdrawal of another task or ambiguously choose a shared object', () => {
    const f = fixture(
      "I'll send the checklist.",
      'I take back my earlier dashboard commitment.',
    );
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([
      { code: 'missing_action', sources: [f.spans[0]] },
    ]);
    const ambiguous = fixture(
      "I'll send the checklist and review the checklist.",
      'I take back my earlier checklist commitment.',
    );
    expect(
      findNotesGuardrailIssues(
        ambiguous.source,
        ambiguous.draft(
          ambiguous.item('Send the checklist and review the checklist.'),
        ),
      ),
    ).toEqual([]);
  });

  it.each([
    'provided the consent check passes',
    'conditional on finance approval',
    'contingent on finance approval',
  ])('retains the prerequisite %s', (condition) => {
    const f = fixture(`I'll publish the report ${condition}.`);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Publish the report.')),
      ),
    ).toEqual([{ code: 'missing_condition', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item(`Publish the report ${condition}.`)),
      ),
    ).toEqual([]);
  });

  it('does not let an earlier withdrawal invalidate a later renewed promise', () => {
    const f = fixture(
      "I'll send the outline.",
      "I won't send the outline.",
      "I'll send the outline.",
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline.', 'action', [f.spans[2]!])),
      ),
    ).toEqual([]);
  });

  it('allows renewed work citing both promises but does not revive unrelated work', () => {
    const f = fixture(
      "I'll send the outline.",
      "I won't send the outline.",
      "I'll send the outline.",
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline.', 'action', f.spans)),
      ),
    ).toEqual([]);
    const unrelated = fixture(
      "I'll send the outline.",
      "I won't send the outline.",
      "I'll update the dashboard.",
    );
    expect(
      findNotesGuardrailIssues(
        unrelated.source,
        unrelated.draft(
          unrelated.item('Send the outline.'),
          unrelated.item('Update the dashboard.', 'action', [
            unrelated.spans[2]!,
          ]),
        ),
      )[0]?.code,
    ).toBe('conflicting_action');
  });

  it('finds a promise independently of empty action output without mutation or private prose', () => {
    const f = fixture("I'll send the PRIVATE_OUTLINE tomorrow.");
    const draft = f.draft();
    const before = JSON.stringify({ source: f.source, draft });
    expect(findNotesGuardrailIssues(f.source, draft)).toEqual([
      { code: 'missing_action', sources: f.spans },
    ]);
    expect(JSON.stringify({ source: f.source, draft })).toBe(before);
    expect(
      JSON.stringify(findNotesGuardrailIssues(f.source, draft)),
    ).not.toContain('PRIVATE');
  });

  it('does not let points or unrelated actions citing everything cover a task', () => {
    const f = fixture("I'll send the outline.", 'We discussed release timing.');
    const output = f.draft(
      f.item('Send the outline.', 'point', f.spans),
      f.item('Review release timing.', 'action', f.spans),
    );
    expect(findNotesGuardrailIssues(f.source, output)).toEqual([
      { code: 'missing_action', sources: [f.spans[0]] },
    ]);
  });

  it('requires task content and overlapping evidence together', () => {
    const f = fixture("I'll send the outline.", 'The outline is ready.');
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline.', 'action', [f.spans[1]!])),
      ),
    ).toHaveLength(1);
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([]);
  });

  it.each([
    "I'll send the outline and I'll update the dashboard.",
    "I'll send the outline and update the dashboard.",
  ])('keeps tasks sharing one source independent: %s', (text) => {
    const f = fixture(text);
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([{ code: 'missing_action', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline and update the dashboard.')),
      ),
    ).toEqual([]);
  });

  it('recovers a briefly accepted request from its adjacent context', () => {
    const f = fixture(
      'Could you review the rollout checklist?',
      "Yes, I'll do that.",
    );
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([
      { code: 'missing_action', sources: f.spans },
    ]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Review the rollout checklist.', 'action', f.spans)),
      ),
    ).toEqual([]);
  });

  it.each([
    'Yes.',
    "Yes, I'll do that.",
    'Could you review the rollout checklist?',
    'I can review the rollout checklist.',
    'I could review the rollout checklist.',
    'I reviewed the rollout checklist yesterday.',
    'Yesterday I promised to review the rollout checklist.',
    'Lee said I will review the rollout checklist.',
    'Lee said, "I will review the rollout checklist."',
    '"I will review the rollout checklist," said Lee.',
    'I will not review the rollout checklist.',
    "I won't review the rollout checklist.",
    "I'll be using the table in the meeting.",
    "I'll go for a walk after dinner.",
    'We had a nice dinner with my mother.',
  ])(
    'abstains for unaccepted, reported, negated, state or personal speech: %s',
    (text) => {
      const f = fixture(text);
      expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([]);
    },
  );

  it.each([
    "I'll send the outline once legal approves.",
    "Once legal approves, I'll send the outline.",
  ])('requires the linked prerequisite on the action itself: %s', (text) => {
    const f = fixture(text);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('Send the outline.'),
          f.item('Legal approval is required.', 'point'),
        ),
      ),
    ).toEqual([{ code: 'missing_condition', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline once legal approves.')),
      ),
    ).toEqual([]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the outline once finance approves.')),
      ),
    ).toHaveLength(1);
  });

  it('rejects an active promise after a later task-linked cancellation', () => {
    const f = fixture(
      "I'll send the outline.",
      "Actually, I won't send the outline.",
    );
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([{ code: 'conflicting_action', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('The plan to send the outline was cancelled.', 'point', [
            f.spans[1]!,
          ]),
        ),
      ),
    ).toEqual([]);
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([]);
  });

  it('does not let a cancellation point hide an active conflicting action', () => {
    const f = fixture(
      "I'll send the outline.",
      "Actually, I won't send the outline.",
    );
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('Send the outline.'),
          f.item('Sending the outline was cancelled.', 'point', [f.spans[1]!]),
        ),
      ),
    ).toEqual([{ code: 'conflicting_action', sources: f.spans }]);
  });

  it('does not link unrelated, earlier, or unsupported cancellations', () => {
    const f = fixture("I'll send the outline.", "I won't send the invoice.");
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('Sending the outline was cancelled.', 'point', [f.spans[1]!]),
        ),
      ),
    ).toEqual([{ code: 'missing_action', sources: [f.spans[0]] }]);
    const earlier = fixture(
      "I won't send the outline.",
      "I'll send the outline.",
    );
    expect(
      findNotesGuardrailIssues(
        earlier.source,
        earlier.draft(
          earlier.item('Send the outline.', 'action', [earlier.spans[1]!]),
        ),
      ),
    ).toEqual([]);
  });

  it('uses exact sentence offsets and does not expand beyond an allowed window', () => {
    const f = fixture("The draft is ready. I'll send the outline.");
    const promise: SourceSpan = { segment: 0, start: 20, end: f.spans[0]!.end };
    expect(findNotesGuardrailIssues(f.source, f.draft(), [promise])).toEqual([
      { code: 'missing_action', sources: [promise] },
    ]);
    expect(
      findNotesGuardrailIssues(f.source, f.draft(), [
        { ...promise, start: 25 },
      ]),
    ).toEqual([]);
    expect(findNotesGuardrailIssues(f.source, f.draft(), [])).toEqual([]);
  });

  it('does not borrow cancellation or request context outside the allowed window', () => {
    const f = fixture("I'll send the outline.", "I won't send the outline.");
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.')), [
        f.spans[0]!,
      ]),
    ).toEqual([]);
    expect(
      findNotesGuardrailIssues(f.source, f.draft(), [f.spans[0]!]),
    ).toEqual([{ code: 'missing_action', sources: [f.spans[0]] }]);
    const accepted = fixture('Could you review the checklist?', 'Yes.');
    expect(
      findNotesGuardrailIssues(accepted.source, accepted.draft(), [
        accepted.spans[1]!,
      ]),
    ).toEqual([]);
  });

  it('does not confuse a different speaker declining their own work with cancellation', () => {
    const f = fixture("I'll send the outline.", "I won't send the outline.");
    const source = {
      ...f.source,
      segments: f.source.segments.map((segment, index) => ({
        ...segment,
        speaker: index ? 'Lee' : 'Rae',
      })),
    };
    expect(
      findNotesGuardrailIssues(source, f.draft(f.item('Send the outline.'))),
    ).toEqual([]);
  });

  it('recognizes explicit task cancellation, not just first-person withdrawal', () => {
    const f = fixture(
      "I'll send the outline.",
      'The plan to send the outline is cancelled.',
    );
    expect(
      findNotesGuardrailIssues(f.source, f.draft(f.item('Send the outline.'))),
    ).toEqual([{ code: 'conflicting_action', sources: f.spans }]);
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item('The plan to send the outline is cancelled.', 'point', [
            f.spans[1]!,
          ]),
        ),
      ),
    ).toEqual([]);
  });

  it('accepts small delivery and prerequisite paraphrases', () => {
    const f = fixture("I'll send the rollout checklist once legal approves.");
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Email the rollout list after legal approval.')),
      ),
    ).toEqual([]);
  });

  it('does not match different tasks on the same object or different objects', () => {
    const f = fixture("I'll review the outline and send the outline.");
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Review the outline.')),
      ),
    ).toEqual([{ code: 'missing_action', sources: f.spans }]);
    const separate = fixture("I'll send the outline.");
    expect(
      findNotesGuardrailIssues(
        separate.source,
        separate.draft(separate.item('Send the invoice.')),
      ),
    ).toHaveLength(1);
  });

  it('does not let an unrelated condition elsewhere in a combined action qualify this task', () => {
    const f = fixture("I'll send the outline once legal approves.");
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(
          f.item(
            'Send the outline and update the dashboard once legal approves.',
          ),
        ),
      ),
    ).toEqual([{ code: 'missing_condition', sources: f.spans }]);
  });

  it('bounds unique diagnostic output while retaining exact original references', () => {
    const f = fixture(
      ...Array.from(
        { length: 40 },
        (_, index) => `I'll review checklist ${index}.`,
      ),
    );
    const issues = findNotesGuardrailIssues(f.source, f.draft());
    expect(issues).toHaveLength(32);
    expect(new Set(issues.map((issue) => JSON.stringify(issue))).size).toBe(32);
    expect(
      issues.every((issue) =>
        issue.sources.every((span) =>
          f.spans.some(
            (original) => JSON.stringify(original) === JSON.stringify(span),
          ),
        ),
      ),
    ).toBe(true);
  });

  it('retains explicit personal tasks without requiring workplace vocabulary', () => {
    const f = fixture("I'll send my mother a birthday card.");
    expect(findNotesGuardrailIssues(f.source, f.draft())).toEqual([
      { code: 'missing_action', sources: f.spans },
    ]);
  });

  it('does not assemble task identity from unrelated clauses in an action', () => {
    const f = fixture("I'll send the outline.");
    expect(
      findNotesGuardrailIssues(
        f.source,
        f.draft(f.item('Send the invoice and review the outline.')),
      ),
    ).toEqual([{ code: 'missing_action', sources: f.spans }]);
  });
});

describe('exact-source prerequisite support', () => {
  it.each([
    ['3.5', '3.5', false],
    ['3.5', '4.5', true],
    ['3.5', 'not 3.5', true],
  ])(
    'preserves decimal prerequisite values: %s / %s',
    (rate, sourceRate, unsupported) => {
      expect(
        hasUnsupportedNotesCondition(
          `Send the budget only if the rate is ${rate} percent.`,
          `I will send the budget only if the rate is ${sourceRate} percent. This is not an unconditional send.`,
        ),
      ).toBe(unsupported);
    },
  );

  it.each([
    'conditional on finance approval',
    'contingent on finance approval',
    'contingent upon finance approval',
    'if finance approves',
  ])(
    'keeps prerequisite polarity local despite independent explanatory negation: %s',
    (condition) => {
      const evidence =
        'If finance approves, I will send the budget by Thursday. My promise still depends on finance approval; it is not an unconditional send.';
      expect(
        hasUnsupportedNotesCondition(
          `Send the budget by Thursday, ${condition}.`,
          evidence,
        ),
      ).toBe(false);
    },
  );
  it.each([
    [
      'Send the guide after security approves.',
      'I will send the guide after security does not approve. That is not an unconditional promise.',
      true,
    ],
    [
      'Send the guide after security does not approve.',
      'I will send the guide after security approves. That is not an unconditional promise.',
      true,
    ],
    [
      'Send the guide after legal approves.',
      'I will send the guide after security approves. Other work is not ready.',
      true,
    ],
    [
      'Send the guide until security approves.',
      'I will send the guide after security approves. Other work is not ready.',
      true,
    ],
  ])(
    'keeps actual prerequisite scope and polarity protected: %s / %s',
    (claim, evidence, unsupported) => {
      expect(hasUnsupportedNotesCondition(claim, evidence)).toBe(unsupported);
    },
  );

  it.each([
    [
      'Send the guide after security approval.',
      'I will send the guide by Friday.',
      true,
    ],
    [
      'Send the guide after security approval.',
      'I will send the guide after security approves.',
      false,
    ],
    [
      'Send the guide after legal approval.',
      'I will send the guide after security approves.',
      true,
    ],
    [
      'Publish the report if legal approves.',
      'I will publish the report unless legal approves.',
      true,
    ],
    [
      'Publish the report if legal does not approve.',
      'I will publish the report unless legal approves.',
      false,
    ],
    [
      'Send the guide until security approves.',
      'I will send the guide after security approves.',
      true,
    ],
    [
      'Send the guide after security approves.',
      'I will send the guide until security approves.',
      true,
    ],
    [
      'Send the guide when security approves.',
      'I will send the guide once security approves.',
      false,
    ],
    [
      'Send the guide after security approves.',
      'I will send the guide if security approves.',
      false,
    ],
    ['Send the guide.', 'I will send the guide by Friday.', false],
  ])(
    'checks %s against only its supplied source',
    (text, evidence, unsupported) => {
      expect(hasUnsupportedNotesCondition(text, evidence)).toBe(unsupported);
    },
  );
});

describe('known-owner commitment matching', () => {
  const ownerFixture = (speaker: string | null, owner: string | null) => {
    const source = createNotesSource(
      JSON.stringify([
        { speaker, text: 'I will send the release file.' },
        { speaker, text: 'I sent the release file.' },
      ]),
    );
    const sources = source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const draft: NotesDraft = {
      title: null,
      overview: null,
      meetingType: 'general',
      sections: [
        {
          id: 'section',
          title: { id: 'heading', text: 'Release', sources },
          items: [
            {
              id: 'task',
              kind: 'action',
              text: 'Send the release file.',
              owner,
              due: null,
              sources,
            },
          ],
        },
      ],
    };
    return findNotesGuardrailIssues(source, draft, undefined, [
      'missing_condition',
      'conflicting_action',
    ]);
  };
  it('does not associate another known owner with the completed promise', () => {
    expect(ownerFixture('Morgan', 'Casey')).toEqual([]);
  });
  it.each([
    ['Casey', 'Casey'],
    ['Casey', ' casey '],
    ['Me', 'Me'],
  ])(
    'leaves completed-work interpretation to synthesis for the same owner: %s / %s',
    (speaker, owner) => {
      expect(ownerFixture(speaker, owner)).toEqual([]);
    },
  );
  it.each([
    ['Casey', null],
    ['Casey', 'Unknown'],
    ['Them', 'Casey'],
    ['Unknown', 'Casey'],
    [null, 'Casey'],
  ])('preserves unknown-label behavior: %s / %s', (speaker, owner) => {
    const issues = ownerFixture(speaker, owner);
    expect(issues).toEqual([]);
  });
});

describe('conditional prerequisite scopes', () => {
  it.each([
    [
      'Once finance approval, which can cover accessibility.',
      'Once finance approval, which can cover privacy.',
      true,
    ],
    [
      'Publish the guide after finance approval, which can cover accessibility.',
      'I will publish the guide after finance approval, which can cover privacy.',
      true,
    ],
    [
      'Once finance, which can cover accessibility, approves, Rowan will publish the guide.',
      'Once finance, which can cover privacy, approves, I will publish the guide.',
      true,
    ],
    [
      'When the second loaf rose, Jun felt satisfied.',
      'When the second loaf rose, I felt satisfied.',
      false,
    ],
    [
      'When the second loaf rose, Jun felt satisfied.',
      'When the first loaf rose, I felt satisfied.',
      true,
    ],
    [
      'Once finance, which can review budgets, approves, Rowan will publish the guide.',
      'Once finance, which can review budgets, approves, I will publish the guide.',
      false,
    ],
    [
      'Once finance, which can review budgets, approves, Rowan will publish the guide.',
      'Once finance, which can audit budgets, approves, I will publish the guide.',
      true,
    ],
    [
      'Once review passes, and only if finance approves, Rowan will publish the guide.',
      'Once review passes, and only if finance approves, I will publish the guide.',
      false,
    ],
    [
      'Once review passes, and only if legal approves, Rowan will publish the guide.',
      'Once review passes, and only if finance approves, I will publish the guide.',
      true,
    ],
    [
      'Once the accessibility review passes, Rowan will publish the guide by Wednesday.',
      'Once the accessibility review passes, I will publish the guide by Wednesday.',
      false,
    ],
    [
      'The introduction stays static. Once the accessibility review passes, Rowan will publish the guide by Wednesday.',
      'The introduction stays static. Once the accessibility review passes, I will publish the guide by Wednesday.',
      false,
    ],
    [
      'Once the accessibility review passes, publish the guide.',
      'Once the accessibility review passes, I will publish the guide.',
      false,
    ],
    [
      'Once the review passes, Rowan will publish the guide. Send the email only if legal approves.',
      'Once the review passes, I will publish the guide. I will send the email only if finance approves.',
      true,
    ],
    [
      'Publish the guide after review approval. Send the email only if legal approves.',
      'I will publish the guide after review approval. I will send the email only if legal approves.',
      false,
    ],
    [
      'Once finance, legal and security approve, Rowan will publish the guide.',
      'Once finance, legal and security approve, I will publish the guide.',
      false,
    ],
    [
      'Once finance, legal and security approve, Rowan will publish the guide.',
      'Once finance, legal and research approve, I will publish the guide.',
      true,
    ],
    [
      'Once review passes, including accessibility, Rowan will publish the guide.',
      'Once review passes, including privacy, I will publish the guide.',
      true,
    ],
    [
      'Once review passes, Rowan will not publish the guide.',
      'Once review passes, I will publish the guide.',
      false,
    ],
    [
      'Once review does not pass, Rowan will publish the guide.',
      'Once review passes, I will publish the guide.',
      true,
    ],
    [
      'Publish the guide after review approval and only if legal approves.',
      'I will publish the guide after review approval and only if finance approves.',
      true,
    ],
    [
      'Publish the guide after review approval and only if legal approves.',
      'I will publish the guide after review approval and only if legal approves.',
      false,
    ],
  ])(
    'validates only prerequisite clauses: %s',
    (claim, evidence, unsupported) => {
      expect(hasUnsupportedNotesCondition(claim, evidence)).toBe(unsupported);
    },
  );
});

describe('source-qualified omitted responsibility conditions', () => {
  const subject = { text: 'Bind the booklets.', owner: 'Arden' };
  it.each([
    [
      'Binding the booklets must wait until Robin approves the cover.',
      'Bind the booklets.',
      'Arden',
      true,
    ],
    [
      'Binding the booklets must wait until Robin approves the cover.',
      'Bind the booklets, but wait until Robin approves the cover.',
      'Arden',
      false,
    ],
    [
      'Binding the booklets must wait until Robin approves the cover.',
      'Bind the booklets, but wait until Casey approves the paper.',
      'Arden',
      true,
    ],
    [
      'Sorting the booklets must wait until Robin approves the cover.',
      'Bind the booklets.',
      'Arden',
      false,
    ],
    [
      'I will bind the booklets only if Robin approves the cover.',
      'Bind the booklets.',
      'Bo',
      false,
    ],
    [
      'Arden will bind the booklets only if Robin approves the cover.',
      'Bind the booklets.',
      'Bo',
      true,
    ],
    [
      'Binding the booklets does not need to wait until Robin approves the cover.',
      'Bind the booklets.',
      'Arden',
      false,
    ],
    [
      'Binding the booklets and packing the boxes must wait until Robin approves the cover.',
      'Bind the booklets.',
      'Arden',
      false,
    ],
    [
      '“Binding the booklets must wait until Robin approves the cover.”',
      'Bind the booklets.',
      'Arden',
      false,
    ],
  ])(
    'checks only a positive exact subject-qualified condition: %s',
    (speech, text, speaker, omitted) => {
      expect(
        hasOmittedSubjectCondition(subject, text, [{ speaker, text: speech }]),
      ).toBe(omitted);
    },
  );
  it.each([
    'Binding the booklets no longer needs approval.',
    'Binding the booklets has its approval requirement removed.',
    'I removed the approval requirement for binding the booklets.',
    'Binding the booklets must wait until Casey approves the paper.',
  ])(
    'abstains when a later qualified statement changes or may waive the condition: %s',
    (later) => {
      expect(
        hasOmittedSubjectCondition(subject, 'Bind the booklets.', [
          {
            speaker: 'Arden',
            text: 'Binding the booklets must wait until Robin approves the cover.',
          },
          { speaker: 'Arden', text: later },
        ]),
      ).toBe(false);
    },
  );
  it('does not use another actor’s condition change to waive the original owner’s prerequisite', () => {
    expect(
      hasOmittedSubjectCondition(subject, 'Bind the booklets.', [
        {
          speaker: 'Arden',
          text: 'Binding the booklets must wait until Robin approves the cover.',
        },
        {
          speaker: 'Bo',
          text: 'I will bind the booklets without waiting for approval.',
        },
      ]),
    ).toBe(true);
  });
  it('abstains without a known responsibility owner', () => {
    expect(
      hasOmittedSubjectCondition(
        { ...subject, owner: null },
        'Bind the booklets.',
        [
          {
            speaker: 'Arden',
            text: 'Binding the booklets must wait until Robin approves the cover.',
          },
        ],
      ),
    ).toBe(false);
  });
});

it('does not treat a later mention of another subject as a waiver of this responsibility’s condition', () => {
  expect(
    hasOmittedSubjectCondition(
      { text: 'Bind the booklets.', owner: 'Arden' },
      'Bind the booklets.',
      [
        {
          speaker: 'Arden',
          text: 'Binding the booklets must wait until Robin approves the cover.',
        },
        {
          speaker: 'Arden',
          text: 'I removed the approval requirement for boxing the booklets.',
        },
      ],
    ),
  ).toBe(true);
});

describe('explicit prerequisite gating versus temporal until', () => {
  const subject = { text: 'Bind the booklets.', owner: 'Arden' };
  const passages = [
    {
      speaker: 'Arden',
      text: 'Binding the booklets must wait until Robin approves the cover.',
    },
  ];
  it.each([
    'Bind the booklets, requiring Robin’s approval of the cover.',
    'Bind the booklets contingent upon Robin approving the cover.',
    'Bind the booklets only after Robin approves the cover.',
  ])('retains a positive waiting prerequisite with %s', (text) => {
    expect(hasOmittedSubjectCondition(subject, text, passages)).toBe(false);
    expect(hasUnsupportedNotesCondition(text, passages[0]!.text)).toBe(false);
  });
  it.each([
    'Bind the booklets.',
    'Bind the booklets before Robin approves the cover.',
    'Bind the booklets requiring Robin not to approve the cover.',
    'Bind the booklets not requiring Robin’s approval of the cover.',
  ])('does not accept an omitted or inverted prerequisite: %s', (text) => {
    expect(hasOmittedSubjectCondition(subject, text, passages)).toBe(true);
  });
  it('keeps an ordinary temporal until distinct from after', () => {
    expect(
      hasUnsupportedNotesCondition('Read until Friday.', 'Read after Friday.'),
    ).toBe(true);
    expect(
      hasUnsupportedNotesCondition('Read after Friday.', 'Read until Friday.'),
    ).toBe(true);
  });
});

describe('completion prerequisite lexical family', () => {
  it.each([
    [
      'Publish after completion of the safety check.',
      'Publish after completing the safety check.',
    ],
    [
      'Publish after completing the safety check.',
      'Publish after completion of the safety check.',
    ],
    [
      'Publish after Robin’s completion of the safety check.',
      'Publish after Robin’s completing the safety check.',
    ],
  ])('accepts the same operation in noun/verb form: %s', (claim, source) => {
    expect(hasUnsupportedNotesCondition(claim, source)).toBe(false);
  });
  it.each([
    [
      'Publish after completion of the venue check.',
      'Publish after completing the safety check.',
    ],
    [
      'Publish after Tess’s completion of the safety check.',
      'Publish after Robin’s completing the safety check.',
    ],
    [
      'Publish after completion of the safety check and cover approval.',
      'Publish after completing the safety check.',
    ],
    [
      'Publish after completion of the safety check.',
      'Publish after not completing the safety check.',
    ],
    [
      'Publish after completion of three safety checks.',
      'Publish after completing two safety checks.',
    ],
    [
      'Publish after completion of the safety check.',
      'Publish until completing the safety check.',
    ],
    [
      'Publish after completion of the safety check and Robin approving the cover.',
      'Publish after completing the safety check and Tess approving the cover.',
    ],
  ])(
    'retains scope, actor, quantity and polarity protections: %s',
    (claim, source) => {
      expect(hasUnsupportedNotesCondition(claim, source)).toBe(true);
    },
  );
});

describe('prerequisites with a separate whole-list state assertion', () => {
  it.each([
    ['neither of which are complete', 'Neither condition is complete.'],
    ['both of which are complete', 'Both conditions are complete.'],
    ['either of which is pending', 'Either condition is pending.'],
  ])('keeps %s outside the prerequisite itself', (relative, state) => {
    expect(
      hasUnsupportedNotesCondition(
        `The opening is conditional on inspection approval and completing safety checks, ${relative}.`,
        `The opening is conditional on inspection approval and completing safety checks. ${state}`,
      ),
    ).toBe(false);
  });

  it.each([
    [
      'The opening is conditional on inspection approval and completing venue checks, neither of which are complete.',
      'The opening is conditional on inspection approval and completing safety checks. Neither condition is complete.',
    ],
    [
      'The opening is conditional on inspection approval and completing safety checks, neither of which are complete.',
      'The opening is conditional on inspection approval. Neither condition is complete.',
    ],
    [
      'Publish unless inspection approval arrives, neither of which is complete.',
      'Publish until inspection approval arrives. Neither condition is complete.',
    ],
    [
      'Publish after inspection approval arrives, neither of which is complete.',
      'Publish after inspection approval does not arrive. Neither condition is complete.',
    ],
    [
      'Publish after the permit, which includes insurance, is approved, neither of which is complete.',
      'Publish after the permit, which includes venue cover, is approved. Neither condition is complete.',
    ],
    [
      'Publish after inspection approval and safety checks, both of which require insurance.',
      'Publish after inspection approval and safety checks.',
    ],
  ])('does not discard prerequisite scope: %s', (claim, source) => {
    expect(hasUnsupportedNotesCondition(claim, source)).toBe(true);
  });

  it.each([
    [
      'I will publish the guide after inspection approval and completing safety checks.',
      'Publish the guide after inspection approval, neither of which is complete.',
    ],
    [
      'I will publish the guide after the permit, which includes insurance, is approved.',
      'Publish the guide after the permit is approved, neither of which is complete.',
    ],
  ])(
    'still catches a dropped prerequisite or noun qualification',
    (source, text) => {
      expect(
        hasOmittedSubjectCondition(
          { text: 'Publish the guide', owner: 'Rae' },
          text,
          [{ speaker: 'Rae', text: source }],
        ),
      ).toBe(true);
    },
  );
});

describe('citation-proven introduced owners keep the shared task protections', () => {
  const check = (later: string, text: string, owner = 'Ellis') => {
    const source = createNotesSource(
      JSON.stringify([
        { speaker: 'Remote Speaker 1', text: 'Hey, it’s Ellis.' },
        {
          speaker: 'Remote Speaker 1',
          text: 'I will send the invitation after approval.',
        },
        ...(later ? [{ speaker: 'Remote Speaker 1', text: later }] : []),
      ]),
    );
    const sources = source.segments.slice(0, 2).map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    }));
    const draft: NotesDraft = {
      meetingType: 'general',
      overview: null,
      sections: [
        {
          id: 's0',
          title: { id: 's0:title', text: 'Invitation', sources },
          items: [
            {
              id: 's0:item:0',
              kind: 'action',
              text,
              owner,
              due: null,
              sources,
            },
          ],
        },
      ],
    };
    return findNotesGuardrailIssues(source, draft);
  };
  it('does not let the introduced owner hide a missing prerequisite', () => {
    expect(check('', 'Send the invitation.')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_condition' }),
      ]),
    );
    expect(check('', 'Send the invitation after approval.')).toEqual([]);
  });
  it('leaves completion to synthesis while retaining cancellation evidence', () => {
    expect(
      check(
        'I have sent the invitation.',
        'Send the invitation after approval.',
      ),
    ).toEqual([]);
    expect(
      check(
        'I am withdrawing my promise to send the invitation.',
        'Send the invitation after approval.',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'conflicting_action' }),
      ]),
    );
  });
});
