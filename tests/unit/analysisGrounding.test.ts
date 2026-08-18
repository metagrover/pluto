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
});
