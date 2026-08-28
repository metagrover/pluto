import { describe, expect, it } from 'vitest';
import type {
  ActionItemV3,
  AnalysisDocumentV3,
  DecisionV3,
} from '../../electron/llm/analysisTypes';
import { meetingNotesEditorCases } from '../manual/fixtures/meetingNotesEditorCases';

const document = (
  summary: string,
  actions: ActionItemV3[] = [],
  decisions: DecisionV3[] = [],
): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview: summary,
  meeting_type: 'general',
  topics: [
    {
      title: 'Conversation',
      summary,
      key_points: [],
      action_items: structuredClone(actions),
      decisions: structuredClone(decisions),
      open_questions: [],
    },
  ],
  all_action_items: structuredClone(actions),
  all_decisions: structuredClone(decisions),
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
});

const faithful: Record<string, AnalysisDocumentV3[]> = {
  'personal-no-tasks': [
    document(
      'Mira enjoyed the quiet coastal walk. Leo found the crowded museum tiring; the conversation was about their weekends.',
    ),
    document(
      'Their weekend outings contrasted: Mira liked a peaceful seaside stroll, while Leo was exhausted by crowds at the museum.',
    ),
  ],
  'interview-no-assignments': [
    document(
      'In a previous job, Inez reduced onboarding from ten days to four by pairing new hires with mentors. She described a past project, not future work.',
    ),
    document(
      'Inez recalled shortening new-hire orientation from 10 days to 4 using a buddy system in her former role.',
    ),
  ],
  'brainstorm-not-commitments': [
    document(
      'A tutorial video and a guided tour were possible onboarding experiments. Neither option was selected; both remain ideas.',
    ),
    document(
      'The team explored video instruction versus an interactive walkthrough for onboarding, without choosing either alternative.',
    ),
  ],
  'conditional-promise-and-willingness': [
    document(
      'Ava committed to send the budget only if finance approves. Ben offered to draft a launch announcement, but that offer was not accepted.',
      [
        {
          text: 'If finance approves, send the revised budget to Nora.',
          assignee: 'Ava',
          due: 'Thursday',
        },
      ],
    ),
    document(
      'The revised budget depends on finance approval. Ben was willing to prepare an announcement; no one took him up on it.',
      [
        {
          text: 'Share the updated budget with Nora, contingent on approval from finance.',
          assignee: 'Ava',
          due: 'By Thursday',
        },
      ],
    ),
  ],
  'accepted-request-owner': [
    document(
      'Priya asked Mateo to send the accessibility report to Jules by Tuesday, and Mateo accepted. Jules is the recipient, not the owner.',
      [
        {
          text: 'Send the accessibility report to Jules.',
          assignee: 'Mateo',
          due: 'Tuesday',
        },
      ],
    ),
    document(
      'Mateo agreed to Priya’s request: deliver the accessibility findings to Jules on Tuesday.',
      [
        {
          text: 'Share the accessibility findings with Jules.',
          assignee: 'Mateo',
          due: 'By Tuesday',
        },
      ],
    ),
  ],
  'withdrawal-replacement-deadline': [
    document(
      'Owen withdrew his promise to send the draft forecast on Friday because its inputs were wrong. He will send the corrected forecast Monday instead.',
      [
        {
          text: 'Send the corrected forecast.',
          assignee: 'Owen',
          due: 'Monday',
        },
      ],
    ),
    document(
      'The Friday draft-forecast commitment was cancelled after incorrect inputs emerged. Owen replaced it with delivery of a revised forecast on Monday.',
      [
        {
          text: 'Deliver the revised forecast.',
          assignee: 'Owen',
          due: 'By Monday',
        },
      ],
    ),
  ],
  'decision-rejected-alternative': [
    document(
      'The team selected a staged rollout rather than a big-bang launch because a phased release limits the impact of failures.',
      [],
      [
        {
          text: 'Use a staged rollout.',
          decided_by: 'Nadia',
          rationale: 'Limit the impact of failures.',
        },
      ],
    ),
    document(
      'A phased release was chosen to contain failures; the all-at-once launch was rejected.',
      [],
      [
        {
          text: 'Proceed with a phased release, not an all-at-once launch.',
          decided_by: 'Nadia',
          rationale: 'Contain the impact if something fails.',
        },
      ],
    ),
  ],
  'source-defined-acronym': [
    document(
      'Here, RAG means Release Approval Gate, not retrieval-augmented generation. The gate requires two reviewers before a release can proceed.',
    ),
    document(
      'Release Approval Gate (RAG) is the local name for the release check requiring a pair of reviewers. It is unrelated to retrieval-augmented generation.',
    ),
  ],
};

const scorer = (id: string) => {
  const item = meetingNotesEditorCases.find((candidate) => candidate.id === id);
  expect(item, `Missing semantic acceptance case: ${id}`).toBeDefined();
  return item!.assertAnalysis;
};

const replaceActions = (
  analysis: AnalysisDocumentV3,
  actions: ActionItemV3[],
) => {
  analysis.all_action_items = structuredClone(actions);
  analysis.topics[0]!.action_items = structuredClone(actions);
};

describe('independent meeting-notes editor semantic acceptance cases', () => {
  it('contains exactly the eight independently specified conversation shapes', () => {
    expect(meetingNotesEditorCases.map((item) => item.id).sort()).toEqual(
      Object.keys(faithful).sort(),
    );
    for (const item of meetingNotesEditorCases) {
      expect(item.segments.length).toBeGreaterThanOrEqual(3);
      expect(
        new Set(item.segments.map((segment) => segment.speaker)).size,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  for (const [id, variants] of Object.entries(faithful)) {
    it(`${id}: accepts two independently worded faithful summaries`, () => {
      for (const variant of variants)
        expect(() => scorer(id)(variant)).not.toThrow();
    });

    it(`${id}: rejects a generic overview that omits the conversation`, () => {
      const analysis = structuredClone(variants[0]!);
      analysis.overview = 'The participants discussed several topics.';
      analysis.topics[0]!.summary = 'There was a useful conversation.';
      analysis.topics[0]!.key_points = [];
      expect(() => scorer(id)(analysis)).toThrow();
    });

    it(`${id}: rejects an invented task even when the narrative is faithful`, () => {
      const analysis = structuredClone(variants[0]!);
      replaceActions(analysis, [
        ...analysis.all_action_items,
        {
          text: 'Write a follow-up report.',
          assignee: 'Someone',
          due: 'Tomorrow',
        },
      ]);
      expect(() => scorer(id)(analysis)).toThrow();
    });

    it(`${id}: rejects an invented decision in either presentation`, () => {
      for (const target of ['all_decisions', 'topic'] as const) {
        const analysis = structuredClone(variants[0]!);
        const decisions =
          target === 'topic'
            ? analysis.topics[0]!.decisions
            : analysis.all_decisions;
        decisions.push({ text: 'Cancel the project.' });
        expect(() => scorer(id)(analysis)).toThrow();
      }
    });

    if (variants[0]!.all_action_items.length) {
      for (const mutation of [
        'omit',
        'duplicate',
        'owner',
        'deadline',
      ] as const) {
        it(`${id}: rejects action ${mutation}`, () => {
          const analysis = structuredClone(variants[0]!);
          const action = structuredClone(analysis.all_action_items[0]!);
          if (mutation === 'owner') action.assignee = 'Jules';
          if (mutation === 'deadline') action.due = 'Sunday';
          replaceActions(
            analysis,
            mutation === 'omit'
              ? []
              : mutation === 'duplicate'
                ? [action, action]
                : [action],
          );
          expect(() => scorer(id)(analysis)).toThrow();
        });
      }
    }
  }

  it('rejects a conditional promise flattened into an unconditional action', () => {
    const analysis = structuredClone(
      faithful['conditional-promise-and-willingness']![0]!,
    );
    replaceActions(analysis, [
      {
        text: 'Send the revised budget to Nora.',
        assignee: 'Ava',
        due: 'Thursday',
      },
    ]);
    expect(() =>
      scorer('conditional-promise-and-willingness')(analysis),
    ).toThrow();
  });

  it('rejects an unaccepted offer promoted to the one action', () => {
    const analysis = structuredClone(
      faithful['conditional-promise-and-willingness']![0]!,
    );
    replaceActions(analysis, [
      {
        text: 'If finance approves, draft the announcement.',
        assignee: 'Ben',
        due: 'Thursday',
      },
    ]);
    expect(() =>
      scorer('conditional-promise-and-willingness')(analysis),
    ).toThrow();
  });

  it('rejects the withdrawn draft even with the replacement owner and deadline', () => {
    const analysis = structuredClone(
      faithful['withdrawal-replacement-deadline']![0]!,
    );
    replaceActions(analysis, [
      { text: 'Send the draft forecast.', assignee: 'Owen', due: 'Monday' },
    ]);
    expect(() => scorer('withdrawal-replacement-deadline')(analysis)).toThrow();
  });

  it('rejects the rejected alternative recorded as the decision', () => {
    const analysis = structuredClone(
      faithful['decision-rejected-alternative']![0]!,
    );
    analysis.all_decisions = [
      { text: 'Use a big-bang launch.', decided_by: 'Nadia' },
    ];
    analysis.topics[0]!.decisions = structuredClone(analysis.all_decisions);
    expect(() => scorer('decision-rejected-alternative')(analysis)).toThrow();
  });

  it('rejects an external acronym expansion replacing the spoken definition', () => {
    const analysis = document(
      'RAG means retrieval-augmented generation. Two reviewers check each release.',
    );
    expect(() => scorer('source-defined-acronym')(analysis)).toThrow();
  });

  it('accepts coverage split across topic summaries and key points', () => {
    const analysis = document('A conversation about weekends.');
    analysis.topics[0]!.summary =
      'Mira enjoyed a peaceful stroll on the coast.';
    analysis.topics[0]!.key_points = [
      { text: 'Leo was tired after the crowded museum visit.' },
    ];
    expect(() => scorer('personal-no-tasks')(analysis)).not.toThrow();
  });

  it('accepts source numbers without requiring a particular sentence order', () => {
    const analysis = document(
      'In her former role, Inez used mentors for new hires, reducing onboarding to four days from ten.',
    );
    expect(() => scorer('interview-no-assignments')(analysis)).not.toThrow();
  });

  it('accepts a compact accepted request narrative without repeating acceptance language', () => {
    const analysis = structuredClone(faithful['accepted-request-owner']![0]!);
    analysis.overview =
      'Mateo is sending the accessibility report to Jules on Tuesday.';
    analysis.topics[0]!.summary = analysis.overview;
    expect(() => scorer('accepted-request-owner')(analysis)).not.toThrow();
  });

  it('rejects a changed interview result while preserving all other facts', () => {
    const analysis = document(
      'In her previous role, Inez paired new hires with mentors and cut onboarding from ten days to eight.',
    );
    expect(() => scorer('interview-no-assignments')(analysis)).toThrow();
  });

  it('rejects missing or duplicated explicit decisions', () => {
    for (const count of [0, 2]) {
      const analysis = structuredClone(
        faithful['decision-rejected-alternative']![0]!,
      );
      analysis.all_decisions = Array.from({ length: count }, () =>
        structuredClone(analysis.all_decisions[0]!),
      );
      analysis.topics[0]!.decisions = structuredClone(analysis.all_decisions);
      expect(() => scorer('decision-rejected-alternative')(analysis)).toThrow();
    }
  });

  it('rejects a topic-only duplicate even when the aggregate list is correct', () => {
    const analysis = structuredClone(faithful['accepted-request-owner']![0]!);
    analysis.topics.push(structuredClone(analysis.topics[0]!));
    expect(() => scorer('accepted-request-owner')(analysis)).toThrow();
  });

  it('does not treat source quotes attached to actions as narrative coverage', () => {
    const analysis = structuredClone(faithful['accepted-request-owner']![0]!);
    analysis.overview = 'A team discussion.';
    analysis.topics[0]!.summary = 'The group talked.';
    analysis.all_action_items[0]!.evidence =
      'Mateo accepted Priya’s request to send the accessibility report to Jules by Tuesday.';
    expect(() => scorer('accepted-request-owner')(analysis)).toThrow();
  });

  it('rejects reversed people even when every weekend keyword is present', () => {
    const analysis = document(
      'Leo enjoyed the quiet coast; Mira was tired after the crowded museum.',
    );
    expect(() => scorer('personal-no-tasks')(analysis)).toThrow();
  });

  it('rejects a reversed-person claim appended to otherwise faithful narrative', () => {
    const analysis = structuredClone(faithful['personal-no-tasks']![0]!);
    analysis.topics[0]!.key_points.push({
      text: 'Leo enjoyed the quiet coastal walk.',
    });
    expect(() => scorer('personal-no-tasks')(analysis)).toThrow();
  });

  it('accepts person attribution with the person following the experience', () => {
    const analysis = document(
      'A quiet seaside walk delighted Mira; the crowded museum left Leo exhausted.',
    );
    expect(() => scorer('personal-no-tasks')(analysis)).not.toThrow();
  });

  it('rejects absent approval disguised by an unrelated time condition', () => {
    const analysis = structuredClone(
      faithful['conditional-promise-and-willingness']![0]!,
    );
    replaceActions(analysis, [
      {
        text: 'Without finance approval, send the revised budget to Nora after lunch.',
        assignee: 'Ava',
        due: 'Thursday',
      },
    ]);
    expect(() =>
      scorer('conditional-promise-and-willingness')(analysis),
    ).toThrow();
  });

  it('rejects denied approval disguised by the word if', () => {
    const analysis = structuredClone(
      faithful['conditional-promise-and-willingness']![0]!,
    );
    replaceActions(analysis, [
      {
        text: 'If finance does not approve, send the revised budget to Nora.',
        assignee: 'Ava',
        due: 'Thursday',
      },
    ]);
    expect(() =>
      scorer('conditional-promise-and-willingness')(analysis),
    ).toThrow();
  });

  it.each([
    'Send the revised budget to Nora only after approval from finance.',
    'Send the revised budget to Nora, subject to finance approval.',
    'Do not send the revised budget to Nora unless finance approves.',
  ])('accepts an equivalent positive approval prerequisite: %s', (text) => {
    const analysis = structuredClone(
      faithful['conditional-promise-and-willingness']![0]!,
    );
    replaceActions(analysis, [{ text, assignee: 'Ava', due: 'Thursday' }]);
    expect(() =>
      scorer('conditional-promise-and-willingness')(analysis),
    ).not.toThrow();
  });

  it.each([
    'Thursday or Friday',
    'Thursday–Friday',
    'Not Thursday',
    'Thursday, or later',
  ])('rejects an ambiguous or negated deadline: %s', (due) => {
    const analysis = structuredClone(
      faithful['conditional-promise-and-willingness']![0]!,
    );
    replaceActions(analysis, [{ ...analysis.all_action_items[0]!, due }]);
    expect(() =>
      scorer('conditional-promise-and-willingness')(analysis),
    ).toThrow();
  });

  it('rejects a false current Friday promise alongside the true withdrawal', () => {
    const analysis = structuredClone(
      faithful['withdrawal-replacement-deadline']![0]!,
    );
    analysis.topics[0]!.key_points.push({
      text: 'Owen will also send the draft forecast on Friday.',
    });
    expect(() => scorer('withdrawal-replacement-deadline')(analysis)).toThrow();
  });

  it('accepts a historical Friday promise followed by its withdrawal', () => {
    const analysis = structuredClone(
      faithful['withdrawal-replacement-deadline']![0]!,
    );
    analysis.topics[0]!.summary =
      'Owen initially promised a Friday forecast. He withdrew that commitment because the inputs were wrong, replacing it with a corrected Monday delivery.';
    analysis.overview = analysis.topics[0]!.summary;
    expect(() =>
      scorer('withdrawal-replacement-deadline')(analysis),
    ).not.toThrow();
  });

  it.each(['No later than Tuesday', 'no later than Tuesday.'])(
    'accepts an equivalent firm deadline: %s',
    (due) => {
      const analysis = structuredClone(faithful['accepted-request-owner']![0]!);
      replaceActions(analysis, [{ ...analysis.all_action_items[0]!, due }]);
      expect(() => scorer('accepted-request-owner')(analysis)).not.toThrow();
    },
  );

  it.each([
    'No later than Tuesday or Wednesday',
    'No later than Tuesday, or later',
  ])('does not let a firm-deadline prefix hide an alternative: %s', (due) => {
    const analysis = structuredClone(faithful['accepted-request-owner']![0]!);
    replaceActions(analysis, [{ ...analysis.all_action_items[0]!, due }]);
    expect(() => scorer('accepted-request-owner')(analysis)).toThrow();
  });

  it.each(['and', 'but'])(
    'accepts an unpunctuated subject-changing conjunction: %s',
    (conjunction) => {
      const analysis = document(
        `Mira enjoyed the quiet coast ${conjunction} Leo was tired after the crowded museum.`,
      );
      expect(() => scorer('personal-no-tasks')(analysis)).not.toThrow();
    },
  );

  it('rejects reversed owners joined by an unpunctuated conjunction', () => {
    const analysis = document(
      'Leo enjoyed the quiet coast and Mira was tired after the crowded museum.',
    );
    expect(() => scorer('personal-no-tasks')(analysis)).toThrow();
  });

  it('accepts rejection and rationale stated once in the visible decision', () => {
    const analysis = document(
      'Nadia chose a staged rollout. No rollout assignments were made.',
      [],
      [
        {
          text: 'Reject big-bang launch in favor of staged rollout to limit failure impact.',
          decided_by: 'Nadia',
        },
      ],
    );
    expect(() =>
      scorer('decision-rejected-alternative')(analysis),
    ).not.toThrow();
  });

  it('accepts narrative rationale without requiring it again inside the decision', () => {
    const analysis = document(
      'A staged rollout was selected instead of a big-bang launch to limit failure impact.',
      [],
      [{ text: 'Use a staged rollout.', decided_by: 'Nadia' }],
    );
    expect(() =>
      scorer('decision-rejected-alternative')(analysis),
    ).not.toThrow();
  });

  it('rejects a missing rejection across all visible content even when evidence includes it', () => {
    const analysis = document(
      'Nadia chose a staged rollout. A big-bang launch was discussed.',
      [],
      [
        {
          text: 'Use a staged rollout to limit failure impact.',
          decided_by: 'Nadia',
          evidence:
            'We are rejecting the big-bang launch because stages limit the impact of failures.',
        },
      ],
    );
    expect(() => scorer('decision-rejected-alternative')(analysis)).toThrow();
  });

  it('rejects a missing rationale across all visible content even when evidence includes it', () => {
    const analysis = document(
      'Nadia chose a staged rollout. No rollout assignments were made.',
      [],
      [
        {
          text: 'Reject the big-bang launch in favor of a staged rollout.',
          decided_by: 'Nadia',
          evidence:
            'We are rejecting the big-bang launch because stages limit the impact of failures.',
        },
      ],
    );
    expect(() => scorer('decision-rejected-alternative')(analysis)).toThrow();
  });
});
