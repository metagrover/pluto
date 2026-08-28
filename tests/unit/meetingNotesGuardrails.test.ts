import { describe, expect, it } from 'vitest';
import { findNotesGuardrailIssues } from '../../electron/llm/meetingNotesGuardrails';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesDraft,
  NotesItem,
  SourceSpan,
} from '../../electron/llm/meetingNotesTypes';

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
