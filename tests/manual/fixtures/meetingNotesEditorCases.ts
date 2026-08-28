import { expect } from 'vitest';
import type { AnalysisDocumentV3 } from '../../../electron/llm/analysisTypes';

export interface MeetingNotesEditorCase {
  id: string;
  segments: Array<{ speaker: string; text: string }>;
  assertAnalysis: (analysis: AnalysisDocumentV3) => void;
}

// Deliberately independent of prompts, normalization, and production validators.
// These are bounded semantic probes, not a general natural-language entailment
// judge. Patterns name source facts and allow common paraphrases, not a golden
// sentence. Evidence quotes cannot substitute for actual narrative coverage.
const narrative = (analysis: AnalysisDocumentV3): string =>
  [
    analysis.overview,
    ...analysis.topics.flatMap((topic) => [
      topic.summary,
      ...topic.key_points.map((point) => point.text),
    ]),
  ].join('\n');

const covers = (analysis: AnalysisDocumentV3, facts: RegExp[]) => {
  const text = narrative(analysis);
  for (const fact of facts)
    expect(text, `Missing narrative fact: ${fact}`).toMatch(fact);
};

// Separate explicit contrast clauses so a fact attached to the other person
// cannot satisfy attribution merely by appearing in the same paragraph.
const narrativeClauses = (analysis: AnalysisDocumentV3): string[] =>
  narrative(analysis).split(
    /[.!?;\n]+|\b(?:while|whereas)\b|\b(?:and|but)\s+(?=(?:Mira|Leo)\b)/i,
  );

const attributedWeekend = (
  analysis: AnalysisDocumentV3,
  person: RegExp,
  otherPerson: RegExp,
  facts: RegExp[],
  otherExperience: RegExp,
) => {
  const clauses = narrativeClauses(analysis).filter(
    (clause) => person.test(clause) && !otherPerson.test(clause),
  );
  for (const fact of facts)
    expect(
      clauses.some((clause) => fact.test(clause)),
      `Missing ${person} attribution for ${fact}`,
    ).toBe(true);
  for (const clause of clauses)
    expect(clause, 'Experience assigned to the wrong person').not.toMatch(
      otherExperience,
    );
};

const requiresFinanceApproval = (text: string) => {
  // Bind the condition to approval, rather than independently matching "if"
  // or "after" somewhere else (for example, an unrelated lunch deadline).
  const approval =
    /\b(?:if|once|after|provided(?: that)?|only when)\s+(?:the\s+)?finance(?: team)?\s+(?:approves|has approved|signs? off)\b|\b(?:contingent (?:on|upon)|conditional on|subject to|pending|after|upon|following|only with)\s+(?:approval (?:from|by) finance|finance(?:['’]s)? (?:approval|sign.off))\b/i;
  const negativeGuard =
    /\b(?:do not|don't|must not)\s+(?:send|share|deliver|forward)\b[^.!?]*\bunless finance\s+(?:approves|has approved|signs? off)\b/i;
  expect(
    approval.test(text) || negativeGuard.test(text),
    'Finance approval must be a positive prerequisite',
  ).toBe(true);
};

const lists = (
  analysis: AnalysisDocumentV3,
  actions: number,
  decisions = 0,
) => {
  expect(
    analysis.all_action_items,
    'Aggregate action precision and recall',
  ).toHaveLength(actions);
  expect(
    analysis.topics.flatMap((topic) => topic.action_items),
    'Topic action precision and recall',
  ).toHaveLength(actions);
  expect(
    analysis.all_decisions,
    'Aggregate decision precision and recall',
  ).toHaveLength(decisions);
  expect(
    analysis.topics.flatMap((topic) => topic.decisions),
    'Topic decision precision and recall',
  ).toHaveLength(decisions);
};

const action = (
  analysis: AnalysisDocumentV3,
  owner: string,
  deadline: RegExp,
  facts: RegExp[],
) => {
  lists(analysis, 1);
  for (const item of [
    ...analysis.all_action_items,
    ...analysis.topics.flatMap((topic) => topic.action_items),
  ]) {
    expect(item.assignee?.trim().toLowerCase(), 'Source-grounded owner').toBe(
      owner.toLowerCase(),
    );
    expect(item.due ?? '', 'Source-grounded deadline').toMatch(deadline);
    const days =
      (item.due ?? '').match(
        /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
      ) ?? [];
    expect(
      new Set(days.map((day) => day.toLowerCase())).size,
      'Exactly one source-grounded weekday',
    ).toBe(1);
    expect(
      (item.due ?? '').replace(/\bno\s+later\s+than\b/gi, 'by'),
      'Deadline cannot be negated or made optional',
    ).not.toMatch(/\b(?:not|except|or|maybe|perhaps|later|after)\b/i);
    for (const fact of facts)
      expect(item.text, `Missing action fact: ${fact}`).toMatch(fact);
  }
};

export const meetingNotesEditorCases: MeetingNotesEditorCase[] = [
  {
    id: 'personal-no-tasks',
    segments: [
      {
        speaker: 'Mira',
        text: 'I spent Saturday walking along the coast. The quiet was the best part of my weekend.',
      },
      {
        speaker: 'Leo',
        text: 'I went to the museum on Sunday. It was so crowded that I left feeling tired.',
      },
      {
        speaker: 'Mira',
        text: 'That sounds exhausting. I liked being away from the crowds for once.',
      },
      {
        speaker: 'Leo',
        text: 'It is nice just to compare our weekends, with nothing to organize.',
      },
    ],
    assertAnalysis(analysis) {
      lists(analysis, 0);
      attributedWeekend(
        analysis,
        /\bMira\b/i,
        /\bLeo\b/i,
        [/coast|seaside|sea.?side|shore|beach/i, /quiet|peaceful|calm/i],
        /museum/i,
      );
      attributedWeekend(
        analysis,
        /\bLeo\b/i,
        /\bMira\b/i,
        [/museum/i, /crowd/i, /tir|exhaust|drain/i],
        /coast|seaside|sea.?side|shore|beach/i,
      );
    },
  },
  {
    id: 'interview-no-assignments',
    segments: [
      {
        speaker: 'Sam',
        text: 'Tell me about a project you completed in your previous role.',
      },
      {
        speaker: 'Inez',
        text: 'I paired each new hire with a mentor. That cut onboarding from ten days to four days at my former company.',
      },
      {
        speaker: 'Sam',
        text: 'Was that something you did yourself, or are you proposing it for us?',
      },
      {
        speaker: 'Inez',
        text: 'It is an example of my past work, not a proposal or an assignment for this team.',
      },
    ],
    assertAnalysis(analysis) {
      lists(analysis, 0);
      covers(analysis, [
        /Inez/i,
        /onboarding|orientation|new.hire/i,
        /mentor|buddy/i,
        /(?:from\s+)?(?:ten|10)(?:\s+days?)?\s+to\s+(?:four|4)|to\s+(?:four|4)(?:\s+days?)?\s+from\s+(?:ten|10)/i,
        /previous|past|former|recalled|had (?:cut|reduced|shortened)/i,
      ]);
    },
  },
  {
    id: 'brainstorm-not-commitments',
    segments: [
      {
        speaker: 'Tessa',
        text: 'Maybe a short tutorial video could make onboarding easier.',
      },
      {
        speaker: 'Raj',
        text: 'Another possibility is a guided tour inside the product.',
      },
      {
        speaker: 'Tessa',
        text: 'Those are two ideas to explore, not a decision about which one to build.',
      },
      {
        speaker: 'Raj',
        text: 'Agreed. We are brainstorming only; nobody is taking an assignment today.',
      },
    ],
    assertAnalysis(analysis) {
      lists(analysis, 0);
      covers(analysis, [
        /video/i,
        /guided tour|interactive (?:tour|walkthrough)|walk.?through/i,
        /onboarding/i,
        /possib|ideas?|explor|may|could|might/i,
        /neither|not (?:a decision|selected|chosen)|without (?:choosing|selecting)|no (?:decision|option.*chosen)/i,
      ]);
    },
  },
  {
    id: 'conditional-promise-and-willingness',
    segments: [
      {
        speaker: 'Ava',
        text: 'If finance approves, I will send the revised budget to Nora by Thursday.',
      },
      {
        speaker: 'Ben',
        text: 'I can draft the launch announcement if that would help.',
      },
      {
        speaker: 'Nora',
        text: 'Thanks, Ben, but let us leave the announcement unassigned for now.',
      },
      {
        speaker: 'Ava',
        text: 'My budget promise still depends on finance approval; it is not an unconditional send.',
      },
    ],
    assertAnalysis(analysis) {
      action(analysis, 'Ava', /\bThursday\b/i, [
        /send|share|deliver|forward/i,
        /(?:revised|updated|amended) budget/i,
        /Nora/i,
        /finance/i,
        /approv|sign.?off/i,
      ]);
      for (const item of [
        ...analysis.all_action_items,
        ...analysis.topics.flatMap((topic) => topic.action_items),
      ])
        requiresFinanceApproval(item.text);
      covers(analysis, [
        /budget/i,
        /finance/i,
        /approv|sign.?off/i,
        /Ben/i,
        /announcement/i,
        /offer|willing|unassigned|not accepted|no one took/i,
      ]);
    },
  },
  {
    id: 'accepted-request-owner',
    segments: [
      {
        speaker: 'Priya',
        text: 'Mateo, could you send the accessibility report to Jules by Tuesday?',
      },
      {
        speaker: 'Jules',
        text: 'Tuesday works for receiving it. I am the recipient, not the person preparing or sending it.',
      },
      {
        speaker: 'Mateo',
        text: 'Yes, I will take that on and send it by Tuesday.',
      },
      {
        speaker: 'Priya',
        text: 'Thanks, Mateo. That is the only follow-up from this discussion.',
      },
    ],
    assertAnalysis(analysis) {
      action(analysis, 'Mateo', /\bTuesday\b/i, [
        /send|share|deliver|forward/i,
        /accessibility/i,
        /report|findings/i,
        /Jules/i,
      ]);
      covers(analysis, [/Mateo/i, /accessibility/i, /Jules/i]);
    },
  },
  {
    id: 'withdrawal-replacement-deadline',
    segments: [
      { speaker: 'Owen', text: 'I will send the draft forecast on Friday.' },
      {
        speaker: 'Lila',
        text: 'The inputs in that draft are wrong. Please do not circulate it.',
      },
      {
        speaker: 'Owen',
        text: 'I withdraw the Friday commitment. Instead I will send a corrected forecast on Monday.',
      },
      {
        speaker: 'Lila',
        text: 'Understood. The corrected Monday version replaces the old draft, not an additional delivery.',
      },
    ],
    assertAnalysis(analysis) {
      action(analysis, 'Owen', /\bMonday\b/i, [
        /send|share|deliver|forward/i,
        /corrected|revised|updated|fixed/i,
        /forecast/i,
      ]);
      covers(analysis, [
        /forecast/i,
        /Friday/i,
        /withdr|cancel|replac|supersed|no longer/i,
        /wrong|incorrect|error/i,
        /Monday/i,
      ]);
      for (const clause of narrativeClauses(analysis).filter((text) =>
        /\bFriday\b/i.test(text),
      )) {
        expect(
          clause,
          'Friday must remain historical or withdrawn, never an additional current promise',
        ).toMatch(
          /withdr|cancel|replac|supersed|no longer|initial|original|previous|earlier|instead|not\b|won['’]t/i,
        );
        expect(
          clause,
          'A current Friday promise contradicts the withdrawal',
        ).not.toMatch(
          /\bwill\s+(?:(?:also|still)\s+)?(?:send|share|deliver|forward)\b[^.!?]*\bFriday\b/i,
        );
      }
    },
  },
  {
    id: 'decision-rejected-alternative',
    segments: [
      {
        speaker: 'Eli',
        text: 'We could release everything at once, or roll it out in stages.',
      },
      {
        speaker: 'Nadia',
        text: 'The decision is a staged rollout. We are rejecting the big-bang launch because stages limit the impact of failures.',
      },
      {
        speaker: 'Eli',
        text: 'That settles the release strategy, but we are not assigning rollout work in this conversation.',
      },
    ],
    assertAnalysis(analysis) {
      lists(analysis, 0, 1);
      covers(analysis, [/staged|phased|stages/i, /rollout|release|launch/i]);
      // A visible decision can carry its rejection and rationale without
      // duplicating those facts in the overview or discussion points.
      const visible = [
        narrative(analysis),
        ...analysis.topics.flatMap((topic) =>
          topic.decisions.flatMap((decision) => [
            decision.text,
            decision.rationale ?? '',
          ]),
        ),
      ].join('\n');
      for (const fact of [
        /big.bang|all.at.once/i,
        /rather than|instead of|\breject(?:ed|ing|s)?\b|\bnot an?\b|\bover\b|in favo[u]?r of/i,
        /fail/i,
        /limit|contain|reduc/i,
      ])
        expect(visible, `Missing visible decision fact: ${fact}`).toMatch(fact);
      for (const item of [
        ...analysis.all_decisions,
        ...analysis.topics.flatMap((topic) => topic.decisions),
      ]) {
        expect(item.text).toMatch(/staged|phased|stages/i);
        expect(item.decided_by?.trim().toLowerCase()).toBe('nadia');
      }
    },
  },
  {
    id: 'source-defined-acronym',
    segments: [
      {
        speaker: 'Harper',
        text: 'In this project RAG stands for Release Approval Gate.',
      },
      { speaker: 'Quinn', text: 'Not retrieval-augmented generation, then?' },
      {
        speaker: 'Harper',
        text: 'Correct, not that. Our RAG is the Release Approval Gate, which requires two reviewers before a release can proceed.',
      },
      {
        speaker: 'Quinn',
        text: 'Thanks, I only needed the definition. There is no task or new decision here.',
      },
    ],
    assertAnalysis(analysis) {
      lists(analysis, 0);
      covers(analysis, [
        /\bRAG\b/i,
        /Release Approval Gate/i,
        /(?:two|2|pair of) reviewers/i,
        /requires?|requiring|needs?|must/i,
      ]);
    },
  },
];
