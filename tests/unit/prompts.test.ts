import { describe, expect, it } from 'vitest';

import {
  getEntitiesPrompt,
  getFollowUpDraftsPrompt,
  getKnowledgeDocumentMergePrompt,
  getKnowledgeDocumentPrompt,
  getStructuredAnalysisPrompt,
  getSummaryPrompt,
  getSummaryRepairPrompt,
  getTitlePrompt,
  getTopicAnalysisPrompt,
  getValueSignalsPrompt,
} from '../../electron/llm/prompts';

const neutralCheckinThenWorkTranscript = [
  '0. Jordan: No worries.',
  "1. Jordan: How's it going, Taylor?",
  "2. Taylor: It's okay. A lot going on.",
  "3. Jordan: How's your spouse doing? How is recovery?",
  "4. Taylor: They're okay. We have fluids, and the kid is also under the weather, but we are managing fine.",
  '5. Jordan: Hopefully catching it early means everyone is through the worst of it.',
  '6. Jordan: Okay, switching gears, I wanted to discuss the context studio work for the API layer.',
  '7. Taylor: The main thing is connecting snippets to reasoning chains so downstream users can inspect why an answer was produced.',
  '8. Jordan: That should sit on top of the knowledge graph instead of being a separate document store.',
  '9. Taylor: Right, and the Neo4j UI should expose those relationships across domain services.',
  '10. Jordan: We also need the context studio to show provenance for each API response.',
  '11. Taylor: The work item is to validate the graph schema and make sure agents can retrieve the right snippets.',
  '12. Jordan: Let us keep the title focused on the knowledge graph and context studio work.',
].join('\n');

describe('getTitlePrompt', () => {
  it('uses representative transcript context instead of only the opening check-in', () => {
    const prompt = getTitlePrompt(neutralCheckinThenWorkTranscript);

    expect(prompt).toContain('How is recovery?');
    expect(prompt).toContain('context studio work for the API layer');
    expect(prompt).toContain('Neo4j UI');
    expect(prompt).toContain('Prefer sustained work topics');
    expect(prompt).toContain('brief rapport');
  });
});

describe('getSummaryPrompt', () => {
  it('enforces four sections and forbids internal label leakage', () => {
    const prompt = getSummaryPrompt(
      'Speaker A: We integrated VirusTotal checks.',
    );

    expect(prompt).toContain('Write exactly:');
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('## Key Points');
    expect(prompt).toContain('## Action Items');
    expect(prompt).toContain('## Decisions');
    expect(prompt).toContain(
      'forbidden: "Observation:", "Why it matters:", "Supporting detail:", "Evidence:", "Pluto use:"',
    );
    expect(prompt).toContain('Treat the transcript as the source of truth.');
    expect(prompt).toContain(
      'Do not convert brainstorming, questions, or suggestions into decisions.',
    );
    expect(prompt).toContain('Action Items');
    expect(prompt).toContain('Include only explicit committed next steps.');
    expect(prompt).toContain('Decisions');
    expect(prompt).toContain(
      'List explicit decisions and implemented choices only.',
    );
  });

  it('includes user notes block only when notes are provided', () => {
    const withoutNotes = getSummaryPrompt('Speaker A: update');
    const withNotes = getSummaryPrompt(
      'Speaker A: update',
      'Prioritize explicit decisions',
    );

    expect(withoutNotes).not.toContain('User Notes (high-priority context):');
    expect(withNotes).toContain('User Notes (high-priority context):');
    expect(withNotes).toContain('Prioritize explicit decisions');
  });
});

describe('getSummaryRepairPrompt', () => {
  it('requires corrected markdown only with strict section order', () => {
    const prompt = getSummaryRepairPrompt(
      'Speaker A: update',
      'Bad draft',
      'Prefer action/decision clarity',
    );

    expect(prompt).toContain(
      "Repair this draft analysis into Pluto's required structure.",
    );
    expect(prompt).toContain(
      'Return only the corrected markdown with the required sections.',
    );
    expect(prompt).toContain(
      'preserve the difference between decisions, proposals, and unresolved questions',
    );
    expect(prompt).toContain(
      'Keep only explicit committed next steps in Action Items.',
    );
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('## Key Points');
    expect(prompt).toContain('## Action Items');
    expect(prompt).toContain('## Decisions');
  });
});

describe('getValueSignalsPrompt', () => {
  it('enforces hybrid internal signal JSON with capped free-form tags', () => {
    const prompt = getValueSignalsPrompt(
      'Speaker A: We need better disclosure quality and ownership.',
      'Summary: Ownership is unclear.',
    );

    expect(prompt).toContain('hidden internal signals');
    expect(prompt).toContain('"continuity": ["string"]');
    expect(prompt).toContain('"accountability_risks": ["string"]');
    expect(prompt).toContain('"decision_impacts": ["string"]');
    expect(prompt).toContain(
      '"extra_tags": [{"tag": "string", "confidence": 0.0}]',
    );
    expect(prompt).toContain('normalize to lowercase kebab-case');
    expect(prompt).toContain('max 8');
  });
});

describe('v3 accuracy prompts', () => {
  it('treats brief personal check-ins as minor context when work discussion dominates', () => {
    const prompt = getStructuredAnalysisPrompt(
      neutralCheckinThenWorkTranscript,
    );

    expect(prompt).toContain('Brief rapport and personal check-ins');
    expect(prompt).toContain('minor context');
    expect(prompt).toContain('Do not make them major topics');
    expect(prompt).toContain('work-focused');
  });

  it('requires explicit resolution language before classifying decisions', () => {
    const prompt = getStructuredAnalysisPrompt(
      'Speaker A: We might use GraphQL. Speaker B: Let us do REST for now.',
    );

    expect(prompt).toContain('Only mark something as a decision');
    expect(prompt).toContain('explicit resolution language');
    expect(prompt).toContain('agreed');
    expect(prompt).toContain('approved');
    expect(prompt).toContain('decided');
  });

  it('requires explicit commitment language before classifying action items', () => {
    const prompt = getTopicAnalysisPrompt(
      'API migration',
      'Speaker A: I can take that. Speaker B: Maybe we should also test mobile.',
    );

    expect(prompt).toContain('Only include an action item');
    expect(prompt).toContain('explicit commitment');
    expect(prompt).toContain("I'll");
    expect(prompt).toContain("we'll");
    expect(prompt).toContain('do not turn suggestions');
  });
});

describe('getEntitiesPrompt', () => {
  it('embeds value signals and deterministic hints as auxiliary context only', () => {
    const prompt = getEntitiesPrompt('Speaker A: Sarah owns API migration', {
      summary: 'Sarah is driving the migration.',
      valueSignals: {
        analysis_schema_version: 2,
        continuity: ['API migration is ongoing'],
        accountability_risks: ['No explicit deadline'],
        decision_impacts: ['Using stronger models for production paths'],
        extra_tags: [{ tag: 'ownership-risk', confidence: 0.84 }],
      },
      priorityHints: {
        prioritized_terms: ['api migration', 'ownership'],
        relationship_bias: { works_on: 0.1, assigned_to: 0.12 },
      },
    });

    expect(prompt).toContain(
      'Summary context (auxiliary, do not treat as new facts):',
    );
    expect(prompt).toContain(
      'Value-gain signals (auxiliary prioritization hints, not standalone evidence):',
    );
    expect(prompt).toContain('Deterministic extraction hints:');
    expect(prompt).toContain(
      'prioritize what to extract from transcript text; never invent entities',
    );
  });
});

describe('knowledge document prompts', () => {
  it('asks knowledge synthesis for durable dashboard context instead of imperative tasks', () => {
    const prompt = getKnowledgeDocumentPrompt({
      scopeType: 'global',
      scopeTitle: 'Global Knowledge Context',
      sourceMeetings: [
        {
          id: 'm1',
          title: 'Career Opportunities',
          occurred_at: '2026-02-15T04:25:57.345Z',
          evidence:
            'Decisions: Implemented choice: Committing to exploring opportunities with major VCs.',
        },
      ],
      previousStructuredJson: null,
    });

    expect(prompt).toContain('durable dashboard context');
    expect(prompt).toContain('Do not rewrite action items as imperatives');
    expect(prompt).toContain('Avoid making a single narrow meeting');
    expect(prompt).toContain('"schema_version": 2');
    expect(prompt).toContain('"current_read"');
    expect(prompt).toContain('"active_streams"');
    expect(prompt).toContain('"needs_attention"');
    expect(prompt).toContain('"source_quality_summary"');
    expect(prompt).not.toContain('"open_risks"');
    expect(prompt).toContain(
      'Current Read headline must synthesize across the scope',
    );
    expect(prompt).toContain(
      'Promote patterns only when supported by repeated evidence',
    );
    expect(prompt).toContain('Never use a raw source summary as the headline');
  });

  it('builds a merge prompt from chunk documents instead of raw meeting evidence', () => {
    const prompt = getKnowledgeDocumentMergePrompt({
      scopeType: 'global',
      scopeTitle: 'Global Knowledge Context',
      chunkDocuments: [
        {
          label: 'Chunk 1 of 2',
          structuredJson: JSON.stringify({
            chapters: [
              {
                title: 'Infrastructure',
                open_risks: [
                  {
                    text: 'Worker strategy remains unresolved.',
                    citations: [
                      {
                        meeting_id: 'm1',
                        quote: 'worker strategy remains unresolved',
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        },
      ],
      previousStructuredJson: null,
    });

    expect(prompt).toContain('merge already-cited chunk documents');
    expect(prompt).toContain('Chunk 1 of 2');
    expect(prompt).toContain('Worker strategy remains unresolved');
    expect(prompt).toContain('Do not introduce new meeting_id values');
    expect(prompt).toContain('"schema_version": 2');
    expect(prompt).toContain('Preserve item classifications');
    expect(prompt).not.toContain('Available meeting evidence (newest first):');
  });
});

describe('getFollowUpDraftsPrompt', () => {
  it('includes participant context alongside decisions and action items', () => {
    const prompt = getFollowUpDraftsPrompt({
      meetingTitle: 'API Migration Review',
      participants: ['Sarah Chen', 'Alex Rivera'],
      decisions: ['Use REST for the rollout'],
      actionItems: ['Send rollout email (Owner: Sarah Chen | Due: Friday)'],
    });

    expect(prompt).toContain('Participants:');
    expect(prompt).toContain('- Sarah Chen');
    expect(prompt).toContain('- Alex Rivera');
    expect(prompt).toContain('Decisions:');
    expect(prompt).toContain('Action Items:');
    expect(prompt).toContain(
      'Use participant names only when they appear in the participant list or action/decision evidence.',
    );
  });

  it('passes topic-aware decision lines through without stripping the topic label', () => {
    const prompt = getFollowUpDraftsPrompt({
      meetingTitle: 'API Migration Review',
      participants: ['Sarah Chen'],
      decisions: ['Use REST for the rollout (Topic: API migration)'],
      actionItems: ['Send rollout email'],
    });

    expect(prompt).toContain(
      'Decisions:\n- Use REST for the rollout (Topic: API migration)',
    );
  });

  it('falls back to a safe no-participants block when none are available', () => {
    const prompt = getFollowUpDraftsPrompt({
      meetingTitle: 'Launch Review',
      actionItems: [],
      decisions: [],
    });

    expect(prompt).toContain('Participants:');
    expect(prompt).toContain('- None recorded');
  });
});
