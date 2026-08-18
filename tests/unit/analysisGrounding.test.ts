import { describe, expect, it } from 'vitest';

import {
  groundAnalysisDocument,
  normalizeTranscriptEvidence,
  resolveTranscriptEvidence,
} from '../../electron/llm/analysisGrounding';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';

const document = (): AnalysisDocumentV3 => ({
  analysis_schema_version: 3,
  overview: 'Synthetic planning discussion.',
  topics: [
    {
      title: 'Synthetic rollout',
      summary: 'Two options were discussed and one path was selected.',
      key_points: [],
      decisions: [
        {
          text: 'Use the staged path',
          decided_by: 'Nira',
          rationale: 'reduce migration risk',
          evidence:
            'Agreed — we will use the staged path to reduce migration risk.',
        },
        {
          text: 'Use the direct path',
          evidence: 'The direct path might be faster.',
        },
        { text: 'Ship without evidence' },
      ],
      action_items: [
        {
          text: 'Prepare the checklist',
          assignee: 'Milo',
          due: 'Friday',
          evidence: "I'll prepare the checklist by Friday.",
        },
        {
          text: 'Draft a hypothetical memo',
          evidence: 'A memo could be useful.',
        },
      ],
      open_questions: [],
    },
  ],
  all_action_items: [],
  all_decisions: [],
  meeting_type: 'team_sync',
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
});

describe('analysis grounding', () => {
  it('resolves exact evidence after bounded punctuation normalization', () => {
    expect(normalizeTranscriptEvidence('Agreed — staged!')).toBe(
      'agreed staged',
    );
    expect(
      resolveTranscriptEvidence(
        'Agreed, we will use the staged path.',
        'Nira: Agreed — we will use the staged path.\nMilo: Great.',
      )?.sourceLine,
    ).toContain('Nira');
  });

  it('resolves verbatim evidence split across adjacent transcript segments', () => {
    expect(
      resolveTranscriptEvidence(
        "I'll prepare the rollout checklist by Friday.",
        ["Milo: I'll prepare the rollout", 'Milo: checklist by Friday.'].join(
          '\n',
        ),
      ),
    ).toMatchObject({
      lineIndex: 0,
      sourceLine: "Milo: I'll prepare the rollout checklist by Friday.",
    });
  });

  it('expands adjacent evidence when the resolving turn omits the decision subject', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Filter out do-not-contact clients before computing lead score',
        evidence: 'Agreed, filter them out before computing the lead score.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Me: We need to filter out clients on the do-not-contact list first.',
        'Alain: Agreed, filter them out before computing the lead score.',
      ].join('\n'),
    );

    expect(result.analysis.all_decisions).toHaveLength(1);
    expect(result.analysis.all_decisions[0].evidence).toContain(
      'do-not-contact list first',
    );
    expect(result.analysis.all_decisions[0].evidence).toContain(
      'Agreed, filter them out',
    );
  });

  it('uses the following commitment turn to ground a concise decision paraphrase', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Proceed with staged migration path',
        evidence: 'Agreed, we will use the staged path.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Agreed, we will use the staged path.',
        'Milo: I will prepare the migration checklist by Friday.',
      ].join('\n'),
    );

    expect(result.analysis.all_decisions).toHaveLength(1);
    expect(result.analysis.all_decisions[0].evidence).toContain(
      'migration checklist',
    );
  });

  it('does not turn a proposal followed by a neutral acknowledgment into a decision', () => {
    const input = document();
    input.topics[0].decisions = [
      { text: 'Use REST for rollout', evidence: 'Right.' },
    ];

    const result = groundAnalysisDocument(
      input,
      ['Nira: We could use REST for rollout.', 'Milo: Right.'].join('\n'),
    );

    expect(result.analysis.all_decisions).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_decision');
  });

  it('rejects an affirmative decision supported only by negated evidence', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use REST for rollout',
        evidence: 'Do not use REST for rollout.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Do not use REST for rollout.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_decision');
  });

  it('rejects a positive decision negated with a contraction', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use REST for rollout',
        evidence: "We don't use REST for rollout.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      "Nira: We don't use REST for rollout.",
    );

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('keeps negation scoped to the option it modifies', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use REST for rollout',
        evidence: 'Do not use GraphQL; use REST for rollout.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Do not use GraphQL; use REST for rollout.',
    );

    expect(result.analysis.all_decisions).toHaveLength(1);
  });

  it('does not combine negation from one option with another option', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Do not use REST for rollout',
        evidence: 'We will not use GraphQL; we will use REST for rollout.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will not use GraphQL; we will use REST for rollout.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('rejects reversed before-and-after roles', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Run migration before validation',
        evidence: 'We will run validation before migration.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will run validation before migration.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('rejects reversed multiword before-and-after roles', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Run database migration before final schema validation',
        evidence: 'Run final schema validation before database migration.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Run final schema validation before database migration.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('rejects reversed relations with different framing verbs', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Fully complete database migration before carefully starting final schema validation',
        evidence:
          'Fully complete final schema validation before carefully starting database migration.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Fully complete final schema validation before carefully starting database migration.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('does not let an unrelated commitment settle a proposal', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use REST for rollout',
        evidence: 'We could use REST for rollout. I will investigate.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We could use REST for rollout. I will investigate.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it.each([
    'We should use REST for rollout.',
    'Can we use REST for rollout',
    'We may use REST for rollout.',
  ])('rejects unresolved modal language: %s', (evidence) => {
    const input = document();
    input.topics[0].decisions = [{ text: 'Use REST for rollout', evidence }];

    const result = groundAnalysisDocument(input, `Nira: ${evidence}`);

    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('retains an explicitly accepted first-person I can commitment', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the launch memo',
        assignee: 'Milo',
        due: 'Friday',
        evidence: 'Yes, I can prepare the launch memo by Friday.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Can you prepare the launch memo?',
        'Milo: Yes, I can prepare the launch memo by Friday.',
      ].join('\n'),
    );

    expect(result.analysis.all_action_items[0]).toMatchObject({
      assignee: 'Milo',
      due: 'Friday',
    });
  });

  it('does not mistake antonym substrings inside valid words', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Allow blockchain access',
        evidence: 'We will allow blockchain access.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will allow blockchain access.',
    );

    expect(result.analysis.all_decisions).toHaveLength(1);
  });

  it('rejects an affirmative action supported only by negated evidence', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Send the rollout email',
        evidence: 'Do not send the rollout email.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Do not send the rollout email.',
    );

    expect(result.analysis.all_action_items).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_action_item');
  });

  it('does not duplicate a technology choice as an action item', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use REST for rollout',
        evidence: 'We will use REST for rollout.',
      },
    ];
    input.topics[0].action_items = [
      {
        text: 'Use REST for rollout',
        evidence: 'We will use REST for rollout.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will use REST for rollout.',
    );

    expect(result.analysis.all_action_items).toEqual([]);
  });

  it.each(['Switch to REST', 'Migrate to PostgreSQL'])(
    'does not treat a technology choice as follow-through: %s',
    (text) => {
      const input = document();
      input.topics[0].decisions = [
        { text, evidence: `We will ${text.toLowerCase()}.` },
      ];
      input.topics[0].action_items = [
        { text, evidence: `We will ${text.toLowerCase()}.` },
      ];

      const result = groundAnalysisDocument(
        input,
        `Nira: We will ${text.toLowerCase()}.`,
      );

      expect(result.analysis.all_action_items).toEqual([]);
    },
  );

  it.each(['Go with REST', 'Default to REST', 'Settle on REST'])(
    'requires concrete follow-through rather than a preference: %s',
    (text) => {
      const input = document();
      input.topics[0].decisions = [
        { text, evidence: `We will ${text.toLowerCase()}.` },
      ];
      input.topics[0].action_items = [
        { text, evidence: `We will ${text.toLowerCase()}.` },
      ];

      const result = groundAnalysisDocument(
        input,
        `Nira: We will ${text.toLowerCase()}.`,
      );

      expect(result.analysis.all_action_items).toEqual([]);
    },
  );

  it.each([
    'Submit the expense report',
    'Pay the invoice',
    'Renew the certificate',
    'Sign the contract',
  ])('retains a directly supported concrete commitment: %s', (text) => {
    const input = document();
    input.topics[0].action_items = [
      { text, evidence: `I will ${text.toLowerCase()}.` },
    ];

    const result = groundAnalysisDocument(
      input,
      `Milo: I will ${text.toLowerCase()}.`,
    );

    expect(result.analysis.all_action_items).toHaveLength(1);
  });

  it('rejects a clipped request fragment as a settled item', () => {
    const input = document();
    input.topics[0].action_items = [
      { text: 'Prepare the launch memo', evidence: 'prepare the launch memo' },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Could someone prepare the launch memo?',
    );

    expect(result.analysis.all_action_items).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_action_item');
  });

  it('clears a key-point speaker not supported by a unique transcript line', () => {
    const input = document();
    input.topics[0].key_points = [
      { text: 'The rollout remains staged', speaker: 'Milo' },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: The rollout remains staged.',
    );

    expect(result.analysis.topics[0].key_points).toEqual([
      { text: 'The rollout remains staged' },
    ]);
    expect(result.errorCategories).toContain('unsupported_key_point_speaker');
  });

  it('clears a key-point speaker whose transcript turn states the opposite', () => {
    const input = document();
    input.topics[0].key_points = [
      { text: 'Enable API validation before rollout', speaker: 'Nira' },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: Disable API validation before rollout.',
    );

    expect(result.analysis.topics[0].key_points[0]).not.toHaveProperty(
      'speaker',
    );
  });

  it('clears a due date that the evidence explicitly supersedes', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the checklist',
        due: 'Friday',
        evidence: 'I will prepare the checklist, not Friday but Monday.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Milo: I will prepare the checklist, not Friday but Monday.',
    );

    expect(result.analysis.all_action_items).toHaveLength(1);
    expect(result.analysis.all_action_items[0]).not.toHaveProperty('due');
    expect(result.errorCategories).toContain('unsupported_action_item_due');
  });

  it("clears a due date that the evidence says won't work", () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the checklist',
        due: 'Friday',
        evidence:
          "I will prepare the checklist; Friday won't work, so Monday instead.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      "Milo: I will prepare the checklist; Friday won't work, so Monday instead.",
    );

    expect(result.analysis.all_action_items).toHaveLength(1);
    expect(result.analysis.all_action_items[0]).not.toHaveProperty('due');
  });

  it('does not resolve evidence across more than three transcript lines', () => {
    expect(
      resolveTranscriptEvidence(
        "I'll prepare the checklist.",
        ["Milo: I'll prepare", '', '', 'Milo: the checklist.'].join('\n'),
      ),
    ).toBeNull();
  });

  it('removes unsupported settled items and clears unsupported fields', () => {
    const result = groundAnalysisDocument(
      document(),
      [
        'Nira: Agreed — we will use the staged path to reduce migration risk.',
        "Milo: I'll prepare the checklist by Friday.",
        'Nira: The direct path might be faster.',
        'Milo: A memo could be useful.',
      ].join('\n'),
    );

    expect(result.analysis.all_decisions).toEqual([
      {
        text: 'Use the staged path',
        decided_by: 'Nira',
        rationale: 'reduce migration risk',
        evidence:
          'Agreed — we will use the staged path to reduce migration risk.',
      },
    ]);
    expect(result.analysis.all_action_items).toEqual([
      {
        text: 'Prepare the checklist',
        assignee: 'Milo',
        due: 'Friday',
        evidence: "I'll prepare the checklist by Friday.",
        topic: 'Synthetic rollout',
      },
    ]);
    expect(result.errorCategories).toEqual(
      expect.arrayContaining([
        'unsupported_decision',
        'unsupported_action_item',
      ]),
    );
  });

  it('clears owner, date, decider, and rationale not supported by the evidence line', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use the staged path',
        decided_by: 'Milo',
        rationale: 'save licensing cost',
        evidence: 'Agreed, we will use the staged path.',
      },
    ];
    input.topics[0].action_items = [
      {
        text: 'Prepare the checklist',
        assignee: 'Nira',
        due: 'Tuesday',
        evidence: "I'll prepare the checklist.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Agreed, we will use the staged path.',
        "Milo: I'll prepare the checklist.",
      ].join('\n'),
    );

    expect(result.analysis.all_decisions).toEqual([
      {
        text: 'Use the staged path',
        evidence: 'Agreed, we will use the staged path.',
      },
    ]);
    expect(result.analysis.all_action_items).toEqual([
      {
        text: 'Prepare the checklist',
        evidence: "I'll prepare the checklist.",
        topic: 'Synthetic rollout',
      },
    ]);
    expect(result.errorCategories).toEqual(
      expect.arrayContaining([
        'unsupported_decision_decider',
        'unsupported_decision_rationale',
        'unsupported_action_item_owner',
        'unsupported_action_item_due',
      ]),
    );
  });

  it('clears an explicitly unset due date even when adjacent evidence contains it', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the launch notes',
        assignee: 'Nira',
        due: 'not set yet',
        evidence: 'I will prepare the launch notes. The timing is not set yet.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: I will prepare the launch notes.',
        'Milo: The timing is not set yet.',
      ].join('\n'),
    );

    expect(result.analysis.all_action_items[0]).not.toHaveProperty('due');
    expect(result.errorCategories).toContain('unsupported_action_item_due');
  });

  it('rejects a request that nobody accepted as an action item', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare a launch memo',
        evidence: 'Could someone prepare a launch memo?',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Could someone prepare a launch memo?',
        'Milo: Let us leave that open until the plan is approved.',
      ].join('\n'),
    );

    expect(result.analysis.all_action_items).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_action_item');
  });

  it('keeps an explicitly open request out of settled decisions', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Leave the launch memo preparation open until approval',
        evidence:
          'Could someone prepare a launch memo? Let us leave that open until the plan is approved.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Could someone prepare a launch memo?',
        'Milo: Let us leave that open until the plan is approved.',
      ].join('\n'),
    );

    expect(result.analysis.all_decisions).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_decision');
  });

  it('retains an accepted request when the evidence contains the commitment', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the launch memo',
        assignee: 'Milo',
        evidence:
          "Could you prepare the launch memo? Sure, I'll prepare the launch memo.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Could you prepare the launch memo?',
        "Milo: Sure, I'll prepare the launch memo.",
      ].join('\n'),
    );

    expect(result.analysis.all_action_items).toHaveLength(1);
  });

  it('does not assign a commitment to the speaker who only made the request', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the launch memo',
        assignee: 'Nira',
        evidence:
          "Could someone prepare the launch memo? Sure, I'll prepare the launch memo.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: Could someone prepare the launch memo?',
        "Milo: Sure, I'll prepare the launch memo.",
      ].join('\n'),
    );

    expect(result.analysis.all_action_items).toHaveLength(1);
    expect(result.analysis.all_action_items[0]).not.toHaveProperty('assignee');
    expect(result.errorCategories).toContain('unsupported_action_item_owner');
  });

  it('does not assign the speaker when their turn names another owner', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Prepare the launch memo',
        assignee: 'Alice',
        evidence: 'Yes, Bob will prepare the launch memo.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Alice: Yes, Bob will prepare the launch memo.',
    );

    expect(result.analysis.all_action_items).toHaveLength(1);
    expect(result.analysis.all_action_items[0]).not.toHaveProperty('assignee');
  });

  it('does not promote passive needed work with no owner to a commitment', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Review the launch checklist before launch',
        evidence: 'The checklist needs to be reviewed before launch.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      [
        'Nira: The checklist needs to be reviewed before launch.',
        'Milo: We have not assigned an owner yet.',
      ].join('\n'),
    );

    expect(result.analysis.all_action_items).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_action_item');
  });

  it('does not accept token overlap without a resolvable evidence slice', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use the staged path for rollout',
        evidence: 'staged rollout path',
      },
    ];
    const result = groundAnalysisDocument(
      input,
      'Nira: We reviewed staged options and the rollout path remained open.',
    );
    expect(result.analysis.all_decisions).toEqual([]);
  });

  it('rejects a decision whose before relation reverses single-token subjects', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Deploy backend before testing frontend',
        evidence: 'We will test frontend before deploying backend.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will test frontend before deploying backend.',
    );

    expect(result.analysis.all_decisions).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_decision');
  });

  it('retains a supported relation when both sides repeat a shared subject', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Deploy backend service before testing backend API',
        evidence: 'We will deploy backend service before testing backend API.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will deploy backend service before testing backend API.',
    );

    expect(result.analysis.all_decisions).toHaveLength(1);
  });

  it('removes a decision-shaped action duplicated in another topic', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Go with REST',
        evidence: 'We will go with REST.',
      },
    ];
    input.topics[0].action_items = [];
    input.topics.push({
      title: 'Implementation follow-up',
      summary: 'The selected approach was recorded.',
      key_points: [],
      decisions: [],
      action_items: [
        {
          text: 'Go with REST',
          evidence: 'We will go with REST.',
        },
      ],
      open_questions: [],
    });

    const result = groundAnalysisDocument(input, 'Nira: We will go with REST.');

    expect(result.analysis.all_decisions).toHaveLength(1);
    expect(result.analysis.all_action_items).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_action_item');
  });
});
