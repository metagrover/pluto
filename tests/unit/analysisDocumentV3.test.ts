import { describe, expect, it } from 'vitest';

import {
  analysisDocumentV3ToMarkdown,
  fallbackAnalysisDocumentV3,
  parseAnalysisDocumentV3,
} from '../../electron/llm/analysisDocumentV3';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';

const validV3: AnalysisDocumentV3 = {
  analysis_schema_version: 3,
  overview: 'We discussed hiring and API migration.',
  topics: [
    {
      title: 'Q2 Hiring Plan',
      summary: 'Need to backfill 2 senior eng roles.',
      key_points: [
        { text: 'Budget capped at $180k per role', speaker: 'Sarah' },
        { text: 'Contractor option on the table', from_user_notes: true },
      ],
      decisions: [
        {
          text: 'Post senior eng role by Friday',
          decided_by: 'Sarah',
        },
      ],
      action_items: [
        { text: 'Draft job description', assignee: 'Sarah', due: 'by EOW' },
      ],
      open_questions: ['Contractor vs FTE for infra?'],
      transcript_range: [0, 42],
    },
  ],
  all_action_items: [
    {
      text: 'Draft job description',
      assignee: 'Sarah',
      due: 'by EOW',
      topic: 'Q2 Hiring Plan',
    },
  ],
  all_decisions: [
    { text: 'Post senior eng role by Friday', decided_by: 'Sarah' },
  ],
  meeting_type: 'team_sync',
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
  generation_metadata: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    generation_path: 'single_pass',
    prompt_version: 'notes-v4',
    generated_at: '2026-04-21T12:00:00.000Z',
    error_categories: [],
  },
};

it('round-trips bounded hierarchy measurements and rejects malformed counters', () => {
  const hierarchy = { depth: 3, nodes: 15, max_depth: 8, max_nodes: 128 };
  const doc = {
    ...validV3,
    generation_metadata: { ...validV3.generation_metadata, hierarchy },
  };
  expect(
    parseAnalysisDocumentV3(JSON.stringify(doc))?.generation_metadata
      ?.hierarchy,
  ).toEqual(hierarchy);
  doc.generation_metadata.hierarchy.nodes = -1;
  expect(
    parseAnalysisDocumentV3(JSON.stringify(doc))?.generation_metadata
      ?.hierarchy,
  ).toBeUndefined();
});

it('round-trips warning status and versioned prose-review evidence', () => {
  const proseReview = {
    schema_version: 1 as const,
    items: [
      {
        id: 'p1',
        section_title: 'Next steps',
        original_text: 'I can kind of do it if if needed',
        evidence: 'I can kind of do it if if needed',
        reason: 'raw_transcript_like' as const,
        signals: [
          'first_person' as const,
          'repeated_word' as const,
          'speech_filler' as const,
        ],
        sources: [{ segment: 1, start: 0, end: 32 }],
      },
    ],
  };
  const result = parseAnalysisDocumentV3(
    JSON.stringify({
      ...validV3,
      generation_metadata: {
        ...validV3.generation_metadata,
        audit_status: 'complete_with_warnings',
        prose_review: proseReview,
      },
    }),
  );

  expect(result?.generation_metadata?.audit_status).toBe(
    'complete_with_warnings',
  );
  expect(result?.generation_metadata?.prose_review).toEqual(proseReview);
});

describe('parseAnalysisDocumentV3', () => {
  it('preserves a structured recent win with verbatim evidence', () => {
    const result = parseAnalysisDocumentV3(
      JSON.stringify({
        ...validV3,
        recent_win: {
          win: 'Closed the Acme renewal',
          why_it_counts: 'The renewal protects recurring revenue.',
          evidence: 'We closed the Acme renewal for $80,000.',
        },
      }),
    );

    expect(result?.recent_win).toEqual({
      win: 'Closed the Acme renewal',
      why_it_counts: 'The renewal protects recurring revenue.',
      evidence: 'We closed the Acme renewal for $80,000.',
    });
  });

  it.each([
    null,
    [],
    {},
    { win: 'Closed renewal', why_it_counts: 'Revenue', evidence: '   ' },
    { win: 42, why_it_counts: 'Revenue', evidence: 'Closed renewal' },
  ])(
    'omits a malformed recent win without rejecting the document',
    (recentWin) => {
      const result = parseAnalysisDocumentV3(
        JSON.stringify({ ...validV3, recent_win: recentWin }),
      );

      expect(result).not.toBeNull();
      expect(result?.recent_win).toBeUndefined();
    },
  );

  it('parses a valid v3 JSON string', () => {
    const result = parseAnalysisDocumentV3(JSON.stringify(validV3));
    expect(result).not.toBeNull();
    expect(result?.analysis_schema_version).toBe(3);
    expect(result?.topics).toHaveLength(1);
    expect(result?.topics[0].title).toBe('Q2 Hiring Plan');
    expect(result?.all_action_items).toHaveLength(1);
    expect(result?.meeting_type).toBe('team_sync');
  });

  it('returns null for empty/null input', () => {
    expect(parseAnalysisDocumentV3(null)).toBeNull();
    expect(parseAnalysisDocumentV3('')).toBeNull();
    expect(parseAnalysisDocumentV3('   ')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseAnalysisDocumentV3('{not json')).toBeNull();
  });

  it('returns null when missing required fields', () => {
    const incomplete = { analysis_schema_version: 3 };
    expect(parseAnalysisDocumentV3(JSON.stringify(incomplete))).toBeNull();
  });

  it('normalizes missing optional fields on topics', () => {
    const minimal = {
      ...validV3,
      topics: [
        {
          title: 'X',
          summary: 'Y',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        },
      ],
    };
    const result = parseAnalysisDocumentV3(JSON.stringify(minimal));
    expect(result).not.toBeNull();
    expect(result?.topics[0].transcript_range).toBeUndefined();
  });

  it('coerces unknown meeting_type to general', () => {
    const unknown = { ...validV3, meeting_type: 'standup' };
    const result = parseAnalysisDocumentV3(JSON.stringify(unknown));
    expect(result).not.toBeNull();
    expect(result?.meeting_type).toBe('general');
  });

  it('preserves generation metadata when present', () => {
    const result = parseAnalysisDocumentV3(JSON.stringify(validV3));
    expect(result).not.toBeNull();
    expect(result?.generation_metadata).toEqual(validV3.generation_metadata);
  });

  it('preserves bounded local generation options', () => {
    const result = parseAnalysisDocumentV3(
      JSON.stringify({
        ...validV3,
        generation_metadata: {
          ...validV3.generation_metadata,
          generation_options: { structured_thinking: false, seed: 42 },
        },
      }),
    );

    expect(result?.generation_metadata?.generation_options).toEqual({
      structured_thinking: false,
      seed: 42,
    });
  });

  it.each(['writer-audit-v1', 'writer-editor-v1', 'writer-editor-bounded-v1'])(
    'round-trips additive %s provenance metadata',
    (pipelineVersion) => {
      const source_provenance = {
        schema_version: 1 as const,
        source_revision: 'synthetic-revision',
        blocks: {
          overview: {
            id: 'overview',
            sources: [{ segment: 0, start: 0, end: 12 }],
          },
        },
      };
      const result = parseAnalysisDocumentV3(
        JSON.stringify({
          ...validV3,
          generation_metadata: {
            ...validV3.generation_metadata,
            pipeline_version: pipelineVersion,
            mode: 'direct',
            audit_status: 'complete',
            audit_change_count: 1,
            source_provenance,
          },
        }),
      );

      expect(result?.generation_metadata).toMatchObject({
        pipeline_version: pipelineVersion,
        mode: 'direct',
        audit_status: 'complete',
        audit_change_count: 1,
        source_provenance,
      });
    },
  );

  it('round-trips a valid meeting-scoped terminology artifact', () => {
    const terminology = {
      schemaVersion: 1 as const,
      generatedAt: '2026-08-26T00:00:00.000Z',
      provider: 'ollama',
      model: 'qwen3.5:9b',
      policyVersion: 'terminology-v1',
      proposals: [
        {
          rawForms: ['Raw form'],
          preferredTerm: 'Preferred Form',
          segmentIndexes: [2, 7],
          confidence: 'high' as const,
          signals: ['known_entity' as const],
          status: 'applied' as const,
        },
      ],
    };
    const result = parseAnalysisDocumentV3(
      JSON.stringify({
        ...validV3,
        generation_metadata: {
          ...validV3.generation_metadata,
          terminology,
        },
      }),
    );

    expect(result?.generation_metadata?.terminology).toEqual(terminology);
  });

  it('strips invalid topic points', () => {
    const withBadPoints = {
      ...validV3,
      topics: [
        {
          ...validV3.topics[0],
          key_points: [
            { text: 'Valid point' },
            { text: '' },
            null,
            42,
            { text: 'Also valid', speaker: 'Alex' },
          ],
        },
      ],
    };
    const result = parseAnalysisDocumentV3(JSON.stringify(withBadPoints));
    expect(result).not.toBeNull();
    expect(result?.topics[0].key_points).toHaveLength(2);
    expect(result?.topics[0].key_points[0].text).toBe('Valid point');
    expect(result?.topics[0].key_points[1].speaker).toBe('Alex');
  });

  it('strips topics with no title', () => {
    const withBadTopic = {
      ...validV3,
      topics: [
        {
          title: '',
          summary: 'no title topic',
          key_points: [],
          decisions: [],
          action_items: [],
          open_questions: [],
        },
        validV3.topics[0],
      ],
    };
    const result = parseAnalysisDocumentV3(JSON.stringify(withBadTopic));
    expect(result).not.toBeNull();
    expect(result?.topics).toHaveLength(1);
    expect(result?.topics[0].title).toBe('Q2 Hiring Plan');
  });
});

describe('fallbackAnalysisDocumentV3', () => {
  it('returns a valid v3 document', () => {
    const fb = fallbackAnalysisDocumentV3();
    expect(fb.analysis_schema_version).toBe(3);
    expect(fb.quality.fallback_used).toBe(true);
    expect(fb.topics).toHaveLength(0);
    expect(fb.overview).toBeTruthy();
  });

  it('includes custom issues', () => {
    const fb = fallbackAnalysisDocumentV3(2, ['Custom error']);
    expect(fb.quality.retry_count).toBe(2);
    expect(fb.quality.issues).toContain('Custom error');
  });
});

describe('analysisDocumentV3ToMarkdown', () => {
  it('renders topic sections with speakers', () => {
    const md = analysisDocumentV3ToMarkdown(validV3);
    expect(md).toContain('Q2 Hiring Plan');
    expect(md).toContain('Sarah:');
    expect(md).toContain('📝');
    expect(md).toContain('Decision');
    expect(md).toContain('?');
    expect(md).toContain('Draft job description');
  });

  it('renders fallback document without errors', () => {
    const md = analysisDocumentV3ToMarkdown(fallbackAnalysisDocumentV3());
    expect(md).toContain('Conversation captured');
  });

  it('renders action items with assignees', () => {
    const md = analysisDocumentV3ToMarkdown(validV3);
    expect(md).toContain('Sarah:');
    expect(md).toContain('Draft job description');
    expect(md).toContain('by EOW');
  });
});
