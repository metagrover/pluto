import { describe, expect, it } from 'vitest';

import {
  groundAnalysisDocument,
  groundSourceReviewedItem,
  normalizeTranscriptEvidence,
  resolveTranscriptEvidence,
} from '../../electron/llm/analysisGrounding';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';

describe('source-reviewed explicit negative decisions', () => {
  const review = (
    text: string,
    evidence: string,
    owner: string | null = 'Rina',
  ) => {
    const resolved = {
      evidence,
      quotedEvidence: evidence,
      sourceLine: `Rina: ${evidence}`,
      sourceLines: [`Rina: ${evidence}`],
      lineIndex: 0,
    };
    const snapshot = structuredClone(resolved);
    const result = groundSourceReviewedItem(
      { text, kind: 'decision', owner, due: null },
      resolved,
    );
    expect(resolved).toEqual(snapshot);
    return result;
  };
  it('grounds the speaking owner of the target clause and keeps full original evidence untouched', () => {
    expect(
      review(
        'No summary is needed.',
        'No need for that summary. Could you instead email the raw responses to Amara on Monday?',
      ),
    ).toEqual({ text: 'No summary is needed.', owner: 'Rina', due: null });
    expect(
      review('No summary is needed.', 'No need for that summary.', 'Amara')
        ?.owner,
    ).toBeNull();
  });
  it('preserves a condition on the explicit choice', () => {
    expect(
      review(
        'No summary is needed if legal approves.',
        'No need for that summary if legal approves.',
      ),
    ).not.toBeNull();
    expect(
      review(
        'No summary is needed.',
        'No need for that summary if legal approves.',
      ),
    ).toBeNull();
  });
  it('cannot borrow a neighboring settled choice for a different negative target', () => {
    expect(
      review(
        'No launch is needed.',
        'No need for that summary. We decided to review the launch.',
      ),
    ).toBeNull();
    expect(
      review(
        'Leave the report unassigned.',
        'Let us leave the announcement unassigned. We decided to review the report.',
      ),
    ).toBeNull();
  });
  it('does not poison an existing positive imperative with a neighboring negative fact', () => {
    expect(
      review(
        'Use the source-grounded flow.',
        'Use the source-grounded flow. The report is not ready.',
        null,
      ),
    ).not.toBeNull();
  });
  it.each([
    ['The summary is needed.', 'No need for that summary.'],
    [
      'Leave the announcement assigned.',
      'Let us leave the announcement unassigned.',
    ],
  ])(
    'does not invert an explicit negative disposition: %s',
    (text, evidence) => {
      expect(review(text, evidence, null)).toBeNull();
    },
  );
  it('does not make a declined offer into an action', () => {
    const evidence =
      'If legal approves, I can draft the announcement. Let us leave the announcement unassigned for now.';
    expect(
      groundSourceReviewedItem(
        {
          text: 'Draft the announcement if legal approves.',
          kind: 'action',
          owner: 'Rina',
          due: null,
        },
        {
          evidence,
          quotedEvidence: evidence,
          sourceLine: `Rina: ${evidence}`,
          sourceLines: [`Rina: ${evidence}`],
          lineIndex: 0,
        },
      ),
    ).toBeNull();
  });

  it('preserves a full source-copy explicit policy decision containing may without changing qualifiers', () => {
    const evidence =
      "The decision is not to publish individual responses. Only aggregate counts may be published, to protect participants' confidentiality.";
    const text =
      "The decision is not to publish individual responses; only aggregate counts may be published to protect participants' confidentiality.";
    expect(review(text, evidence, null)).toEqual({
      text,
      owner: null,
      due: null,
    });
  });

  it.each([
    'The decision is not final; aggregate counts may be published.',
    'The decision is pending approval; aggregate counts may be published.',
    'The decision is that aggregate counts may be published, but it is not finalized.',
  ])(
    'does not treat an explicitly unfinished decision status as settled: %s',
    (text) => {
      expect(review(text, text, null)).toBeNull();
    },
  );

  it.each([
    'The decision is that aggregate counts may be published once legal approves.',
    'The decision is that aggregate counts may be published pending legal approval.',
  ])(
    'retains a settled policy with its publication prerequisite: %s',
    (text) => {
      expect(review(text, text, null)).toEqual({
        text,
        owner: null,
        due: null,
      });
    },
  );

  it.each([
    [
      'Individual responses may not be published.',
      'Individual responses may not be published.',
    ],
    [
      'The decision is not to publish individual responses; aggregate counts will be published.',
      'The decision is not to publish individual responses; aggregate counts may be published.',
    ],
    [
      'The decision is to publish aggregate counts.',
      'The decision is not to publish individual responses. Aggregate counts may be published.',
    ],
    [
      '"The decision is not to publish individual responses; aggregate counts may be published."',
      '"The decision is not to publish individual responses; aggregate counts may be published."',
    ],
    [
      'Tariq said the decision is not to publish individual responses; aggregate counts may be published.',
      'Tariq said the decision is not to publish individual responses; aggregate counts may be published.',
    ],
    [
      'The tentative decision is not to publish individual responses; aggregate counts may be published.',
      'The tentative decision is not to publish individual responses; aggregate counts may be published.',
    ],
    [
      'The decision is perhaps not to publish individual responses; aggregate counts may be published.',
      'The decision is perhaps not to publish individual responses; aggregate counts may be published.',
    ],
    [
      'The decision is tentatively not to publish individual responses; aggregate counts may be published.',
      'The decision is tentatively not to publish individual responses; aggregate counts may be published.',
    ],
  ])(
    'does not relax modal guards for an unsupported or qualified decision: %s',
    (text, evidence) => {
      expect(review(text, evidence, null)).toBeNull();
    },
  );

  it('does not use the explicit policy-copy allowance for actions', () => {
    const evidence =
      'The decision is not to publish individual responses; aggregate counts may be published.';
    expect(
      groundSourceReviewedItem(
        { text: evidence, kind: 'action', owner: null, due: null },
        {
          evidence,
          quotedEvidence: evidence,
          sourceLine: `Tariq: ${evidence}`,
          sourceLines: [`Tariq: ${evidence}`],
          lineIndex: 0,
        },
      ),
    ).toBeNull();
  });
});

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
  it('does not parse a leading discourse phrase as a named action owner', () => {
    const evidence =
      'Yeah, I can generate a snapshot. So I will create a single HTML and send it.';

    expect(
      groundSourceReviewedItem(
        {
          text: 'Create and send a single HTML snapshot',
          kind: 'action',
          owner: 'Them',
          due: null,
        },
        {
          evidence,
          quotedEvidence: evidence,
          sourceLine: `Me: ${evidence}`,
          sourceLines: [
            'Me: Yeah, I can generate a snapshot.',
            'Them: So I will create a single HTML and send it.',
          ],
          lineIndex: 0,
        },
      )?.owner,
    ).toBeNull();
  });

  it('derives a first-person action owner from the evidence speaker and removes team framing', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'The team will set up those filters',
        evidence: "I'll set up those filters.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      "Ayush: I'll set up those filters.",
    );

    expect(result.analysis.all_action_items).toEqual([
      {
        text: 'Set up those filters',
        assignee: 'Ayush',
        evidence: "I'll set up those filters.",
        topic: 'Synthetic rollout',
      },
    ]);
  });

  it('keeps a named third-person assignment while removing the owner from action text', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'Nira will prepare the launch checklist',
        assignee: 'Nira',
        evidence: 'Nira will prepare the launch checklist.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Milo: Nira will prepare the launch checklist.',
    );

    expect(result.analysis.all_action_items).toEqual([
      {
        text: 'Prepare the launch checklist',
        assignee: 'Nira',
        evidence: 'Nira will prepare the launch checklist.',
        topic: 'Synthetic rollout',
      },
    ]);
  });

  it('retains collective ownership only for an explicit group commitment', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'The team will publish the rollout notes',
        assignee: 'Team',
        evidence: 'We will publish the rollout notes.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Milo: We will publish the rollout notes.',
    );

    expect(result.analysis.all_action_items).toEqual([
      {
        text: 'Publish the rollout notes',
        assignee: 'Group',
        evidence: 'We will publish the rollout notes.',
        topic: 'Synthetic rollout',
      },
    ]);
  });

  it('canonicalizes contracted first-person action framing', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: "I'll speak with Adam",
        evidence: "I'll speak with Adam.",
      },
    ];

    const result = groundAnalysisDocument(
      input,
      "Deepak: I'll speak with Adam.",
    );

    expect(result.analysis.all_action_items[0]).toMatchObject({
      text: 'Speak with Adam',
      assignee: 'Deepak',
      evidence: "I'll speak with Adam.",
    });
  });

  it('replaces a claimed individual owner when the evidence commits collectively', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: "We'll publish the rollout notes",
        assignee: 'Milo',
        evidence: 'We will publish the rollout notes.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Milo: We will publish the rollout notes.',
    );

    expect(result.analysis.all_action_items[0]).toMatchObject({
      text: 'Publish the rollout notes',
      assignee: 'Group',
    });
    expect(result.errorCategories).toContain('unsupported_action_item_owner');
  });

  it('rejects generic team action prose backed only by a suggestion', () => {
    const input = document();
    input.topics[0].action_items = [
      {
        text: 'The team will publish the rollout notes',
        evidence: 'We should publish the rollout notes.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Milo: We should publish the rollout notes.',
    );

    expect(result.analysis.all_action_items).toEqual([]);
    expect(result.errorCategories).toContain('unsupported_action_item');
  });

  it('keeps a positive recent win only when its evidence is in the transcript', () => {
    const input = document();
    input.recent_win = {
      win: 'Closed the Acme renewal',
      why_it_counts: 'Closed an $80,000 renewal.',
      evidence: 'We closed the Acme renewal for $80,000.',
    };

    const result = groundAnalysisDocument(
      input,
      'Me: We closed the Acme renewal for $80,000.',
    );

    expect(result.analysis.recent_win).toEqual(input.recent_win);
  });

  it('drops a supported win when its stated impact is unsupported', () => {
    const input = document();
    input.recent_win = {
      win: 'Closed the Acme renewal',
      why_it_counts: 'Protected $10 million in annual revenue.',
      evidence: 'We closed the Acme renewal for $80,000.',
    };

    const result = groundAnalysisDocument(
      input,
      'Me: We closed the Acme renewal for $80,000.',
    );

    expect(result.analysis.recent_win).toBeUndefined();
    expect(result.errorCategories).toContain('unsupported_recent_win');
  });

  it('drops a recent win that is merely a meeting-count milestone', () => {
    const input = document();
    input.recent_win = {
      win: 'Recorded five meetings',
      why_it_counts: 'The user has used Pluto five times.',
      evidence: 'This is our fifth recorded meeting.',
    };

    const result = groundAnalysisDocument(
      input,
      'Me: This is our fifth recorded meeting.',
    );

    expect(result.analysis.recent_win).toBeUndefined();
    expect(result.errorCategories).toContain('unsupported_recent_win');
  });

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

  it('uses applied term aliases for claim support while keeping raw evidence verbatim', () => {
    const input = document();
    input.topics[0].decisions = [
      {
        text: 'Use Ogletree',
        evidence: 'We will use Ovaltree.',
      },
    ];

    const result = groundAnalysisDocument(
      input,
      'Nira: We will use Ovaltree.',
      { terminologyAliases: { Ogletree: ['Ovaltree'] } },
    );

    expect(result.analysis.all_decisions).toEqual([
      expect.objectContaining({
        text: 'Use Ogletree',
        evidence: 'We will use Ovaltree.',
      }),
    ]);
  });

  it('uses applied term aliases when validating a key-point speaker', () => {
    const input = document();
    input.topics[0].key_points = [{ text: 'Use Ogletree', speaker: 'Nira' }];

    const result = groundAnalysisDocument(input, 'Nira: Use Ovaltree.', {
      terminologyAliases: { Ogletree: ['Ovaltree'] },
    });

    expect(result.analysis.topics[0].key_points[0].speaker).toBe('Nira');
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
        assignee: 'Milo',
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

  it('assigns an accepted request to the speaker who explicitly commits', () => {
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
    expect(result.analysis.all_action_items[0].assignee).toBe('Milo');
    expect(result.errorCategories).toContain('unsupported_action_item_owner');
  });

  it('derives the named third-person owner instead of assigning the speaker', () => {
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
    expect(result.analysis.all_action_items[0].assignee).toBe('Bob');
    expect(result.errorCategories).toContain('unsupported_action_item_owner');
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

describe('ordinary source-reviewed promise wording', () => {
  const check = (evidence: string, due: string | null = null) =>
    groundSourceReviewedItem(
      {
        kind: 'action',
        text: 'Prepare the launch checklist',
        owner: 'Alex',
        due,
      },
      {
        evidence,
        quotedEvidence: evidence,
        sourceLine: `Alex: ${evidence}`,
        sourceLines: [`Alex: ${evidence}`],
        lineIndex: 0,
      },
    );
  it.each([
    'Um, I will prepare the launch checklist.',
    'I promise to prepare the launch checklist.',
    'Alex promised to prepare the launch checklist.',
    'Alex committed to preparing the launch checklist.',
  ])('retains the supported owner: %s', (evidence) => {
    expect(check(evidence)?.owner).toBe('Alex');
  });
  it.each([
    "I'll prepare the launch checklist Friday.",
    'Alex promised to prepare the launch checklist Friday.',
  ])(
    'retains a bare deadline attached to the promised task: %s',
    (evidence) => {
      expect(check(evidence, 'Friday')?.due).toBe('Friday');
    },
  );
  it('does not borrow a date from unrelated discussion', () => {
    expect(
      check(
        'I will prepare the launch checklist. The office closes Friday.',
        'Friday',
      )?.due,
    ).toBeNull();
  });
  it('keeps a conditional promise from becoming an unconditional action', () => {
    expect(
      check('If legal approves, I promise to prepare the launch checklist.'),
    ).toBeNull();
  });
});

describe('filler-only settled claim evidence', () => {
  it.each(['action', 'decision'] as const)(
    'rejects a %s supported only by a filler utterance',
    (kind) => {
      for (const evidence of ['Um.', 'Uh, so...', '   ']) {
        expect(
          groundSourceReviewedItem(
            {
              text: 'Use parallel processing',
              kind,
              owner: 'Casey',
              due: null,
            },
            {
              evidence,
              quotedEvidence: evidence,
              sourceLine: `Casey: ${evidence}`,
              sourceLines: [`Casey: ${evidence}`],
              lineIndex: 0,
            },
          ),
        ).toBeNull();
      }
    },
  );
});

describe('source-reviewed basic count spelling', () => {
  const check = (text: string, evidence: string) =>
    groundSourceReviewedItem(
      { kind: 'action', text, owner: 'Milo', due: null },
      {
        evidence,
        quotedEvidence: evidence,
        sourceLine: `Milo: ${evidence}`,
        sourceLines: [`Milo: ${evidence}`],
        lineIndex: 0,
      },
    );
  it('retains the same basic count and unit across digit/word spelling', () => {
    expect(check('Send 7 reports', "I'll send seven reports.")?.owner).toBe(
      'Milo',
    );
    expect(
      check(
        'Send 7 reports and 7 files',
        "I'll send seven reports and seven files.",
      ),
    ).not.toBeNull();
  });
  it.each([
    ['Send 8 reports', "I'll send seven reports."],
    ['Send 7 files', "I'll send seven reports."],
    ['Send 7 reports and 7 files', "I'll send seven reports."],
    ['Send 7 reports and pay $7', "I'll send seven reports."],
    ['Send -7 reports', "I'll send seven reports."],
    ['Send 7 reports', "I'll send minus seven reports."],
    ['Send 7 reports', "I'll send seventy-seven reports."],
    ['Send 7 reports', "I'll send seventy seven reports."],
    ['Send 7 reports', "I'll send one hundred and seven reports."],
    ['Pay $7', "I'll pay seven dollars."],
    ['Pay 7 dollars', "I'll pay seven dollars."],
    ['Send 7 reports', 'If approved, I will send seven reports.'],
    ['Send 7 reports', 'I can send seven reports if approved.'],
    ['Send 7 reports', 'Can you send seven reports?'],
  ])('rejects unsupported reinterpretation: %s / %s', (text, evidence) => {
    expect(check(text, evidence)).toBeNull();
  });
});

describe('filler-prefixed first-person owner phrases', () => {
  const check = (lines: string[], owner: string) => {
    const resolved = {
      evidence: lines
        .map((line) => line.slice(line.indexOf(': ') + 2))
        .join(' '),
      quotedEvidence: lines.join(' '),
      sourceLine: lines.join(' '),
      sourceLines: lines,
      lineIndex: 0,
    };
    const snapshot = structuredClone(resolved);
    const result = groundSourceReviewedItem(
      {
        kind: 'action',
        text: 'Prepare the deployment checklist',
        owner,
        due: null,
      },
      resolved,
    );
    expect(resolved).toEqual(snapshot);
    return result;
  };
  it.each(['Uh I', 'Oh I', 'Well I', 'So I', 'Okay I', 'Um So I'])(
    'does not invent an owner from %s',
    (phrase) => {
      expect(
        check(
          [
            "Milo: I'll prepare the deployment checklist.",
            `Nira: ${phrase} can go next.`,
          ],
          'Milo',
        )?.owner,
      ).toBe('Milo');
    },
  );
  it('still recognizes an explicitly assigned named person', () => {
    expect(
      check(
        [
          "Milo: I'll prepare a draft.",
          'Nira: Uh I can go next.',
          'Rina: Nora will prepare the deployment checklist.',
        ],
        'Nora',
      )?.owner,
    ).toBe('Nora');
  });
});
