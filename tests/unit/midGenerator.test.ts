import { describe, expect, it } from 'vitest';
import type { Entity } from '../../electron/db';
import {
  type MidGeneratorInput,
  generateMid,
} from '../../electron/intelligence/midGenerator';
import type {
  AnalysisDocument,
  InternalSignalDocument,
} from '../../electron/llm/provider';

// =============================================
// Helpers
// =============================================

const mockAnalysis = (
  overrides: Partial<AnalysisDocument> = {},
): AnalysisDocument => ({
  analysis_schema_version: 2,
  summary: ['Sprint planning focused on the API migration timeline.'],
  key_points: [
    'Sarah confirmed the migration target is end of Q2.',
    'The team decided on GraphQL over REST.',
  ],
  action_items: ['Send API spec to team by Friday'],
  decisions: ['Use GraphQL for new endpoints'],
  quality: {
    format_pass: true,
    retry_count: 0,
    fallback_used: false,
    issues: [],
  },
  ...overrides,
});

const mockSignals = (
  overrides: Partial<InternalSignalDocument> = {},
): InternalSignalDocument => ({
  analysis_schema_version: 2,
  continuity: ['API migration timeline is Q2-critical'],
  accountability_risks: ['No owner assigned for staging deployment'],
  decision_impacts: ['GraphQL choice affects mobile team'],
  extra_tags: [],
  ...overrides,
});

const mockEntity = (
  overrides: Partial<Entity> & {
    mention_count?: number;
    context?: string | null;
  } = {},
): Entity & { mention_count: number; context: string | null } => ({
  id: `ent-${Math.random().toString(36).slice(2, 8)}`,
  type: 'person',
  name: 'Test Entity',
  normalized_name: 'test entity',
  status: 'active',
  due_date: null,
  assigned_to: null,
  metadata: null,
  saliency_score: 1.0,
  domain_tag: 'work',
  created_at: '2026-03-29T10:00:00Z',
  updated_at: '2026-03-29T10:00:00Z',
  mention_count: 1,
  context: null,
  ...overrides,
});

const mockInput = (
  overrides: Partial<MidGeneratorInput> = {},
): MidGeneratorInput => ({
  meeting_id: 'meeting-abc-123',
  title: 'Sprint Planning Q2',
  occurred_at: '2026-03-29T10:00:00-07:00',
  duration_seconds: 3600,
  analysis: mockAnalysis(),
  signals: mockSignals(),
  meeting_entities: [
    mockEntity({
      id: 'ent-sarah',
      type: 'person',
      name: 'Sarah Chen',
      metadata: JSON.stringify({ role: 'Engineering Lead' }),
      mention_count: 5,
    }),
    mockEntity({
      id: 'ent-alex',
      type: 'person',
      name: 'Alex Rivera',
      mention_count: 3,
    }),
    mockEntity({
      id: 'ent-api-migration',
      type: 'project',
      name: 'API Migration',
      mention_count: 4,
    }),
    mockEntity({
      id: 'ent-timeline',
      type: 'topic',
      name: 'Timeline Planning',
      metadata: JSON.stringify({ importance: 'high' }),
      mention_count: 2,
    }),
    mockEntity({
      id: 'ent-ai-1',
      type: 'action_item',
      name: 'Send API spec to team',
      metadata: JSON.stringify({
        full_description: 'Send API spec to team by Friday',
        assignee_name: 'Sarah Chen',
      }),
      due_date: '2026-04-04T00:00:00Z',
      mention_count: 1,
    }),
    mockEntity({
      id: 'ent-dec-1',
      type: 'decision',
      name: 'Use GraphQL for new endpoints',
      metadata: JSON.stringify({
        full_description: 'Use GraphQL for new endpoints',
        rationale: 'Better type safety and query flexibility',
      }),
      mention_count: 1,
    }),
  ],
  transcript_segments: [
    { text: 'Good morning everyone.' },
    { text: 'Sarah confirmed the migration target is end of Q2.' },
    { text: 'We should send the API spec to the team.' },
    {
      text: 'We decided on GraphQL for the new endpoints because of type safety.',
    },
    { text: 'Alex will set up the playground.' },
  ],
  ...overrides,
});

// =============================================
// Tests
// =============================================

describe('MID Generator', () => {
  describe('Schema conformance', () => {
    it('produces valid MidFrontmatter with all required fields', () => {
      const mid = generateMid(mockInput());

      expect(mid.mid_version).toBe(1);
      expect(mid.meeting_id).toBe('meeting-abc-123');
      expect(mid.title).toBe('Sprint Planning Q2');
      expect(mid.occurred_at).toBe('2026-03-29T10:00:00-07:00');
      expect(mid.duration_seconds).toBe(3600);
      expect(Array.isArray(mid.participants)).toBe(true);
      expect(Array.isArray(mid.projects)).toBe(true);
      expect(Array.isArray(mid.topics)).toBe(true);
      expect(Array.isArray(mid.action_items)).toBe(true);
      expect(Array.isArray(mid.decisions)).toBe(true);
      expect(mid.signals).toBeDefined();
      expect(Array.isArray(mid.evidence_spans)).toBe(true);
    });
  });

  describe('Entity resolution', () => {
    it('populates participants from person entities', () => {
      const mid = generateMid(mockInput());

      expect(mid.participants).toHaveLength(2);
      expect(mid.participants[0].entity_id).toBe('ent-sarah');
      expect(mid.participants[0].name).toBe('Sarah Chen');
      expect(mid.participants[0].role).toBe('Engineering Lead');
      expect(mid.participants[1].entity_id).toBe('ent-alex');
      expect(mid.participants[1].name).toBe('Alex Rivera');
      expect(mid.participants[1].role).toBeUndefined();
    });

    it('sorts participants by mention count descending', () => {
      const mid = generateMid(mockInput());
      // Sarah has mention_count 5, Alex has 3
      expect(mid.participants[0].name).toBe('Sarah Chen');
      expect(mid.participants[1].name).toBe('Alex Rivera');
    });

    it('populates projects from project entities', () => {
      const mid = generateMid(mockInput());

      expect(mid.projects).toHaveLength(1);
      expect(mid.projects[0].name).toBe('API Migration');
    });

    it('populates topics with importance from metadata', () => {
      const mid = generateMid(mockInput());

      expect(mid.topics).toHaveLength(1);
      expect(mid.topics[0].name).toBe('Timeline Planning');
      expect(mid.topics[0].importance).toBe('high');
    });

    it('defaults topic importance to medium when not set', () => {
      const input = mockInput({
        meeting_entities: [
          mockEntity({
            type: 'topic',
            name: 'Some Topic',
            metadata: null,
          }),
        ],
      });
      const mid = generateMid(input);

      expect(mid.topics[0].importance).toBe('medium');
    });

    it('populates action items with assignee and due date', () => {
      const mid = generateMid(mockInput());

      expect(mid.action_items).toHaveLength(1);
      const ai = mid.action_items[0];
      expect(ai.description).toBe('Send API spec to team by Friday');
      expect(ai.assignee).toBe('Sarah Chen');
      expect(ai.due_date).toBe('2026-04-04T00:00:00Z');
      expect(ai.status).toBe('active');
    });

    it('populates decisions with rationale', () => {
      const mid = generateMid(mockInput());

      expect(mid.decisions).toHaveLength(1);
      const dec = mid.decisions[0];
      expect(dec.description).toBe('Use GraphQL for new endpoints');
      expect(dec.rationale).toBe('Better type safety and query flexibility');
    });
  });

  describe('Signals', () => {
    it('copies signals from InternalSignalDocument', () => {
      const mid = generateMid(mockInput());

      expect(mid.signals.continuity).toEqual([
        'API migration timeline is Q2-critical',
      ]);
      expect(mid.signals.accountability_risks).toEqual([
        'No owner assigned for staging deployment',
      ]);
      expect(mid.signals.decision_impacts).toEqual([
        'GraphQL choice affects mobile team',
      ]);
    });
  });

  describe('Evidence spans', () => {
    it('maps analysis claims to transcript segment ranges', () => {
      const mid = generateMid(mockInput());

      // Should have at least some evidence spans
      expect(mid.evidence_spans.length).toBeGreaterThan(0);
      for (const span of mid.evidence_spans) {
        expect(span.span_id).toBeTruthy();
        expect(['summary', 'decision', 'key_point', 'action_item']).toContain(
          span.claim_type,
        );
        expect(span.transcript_range).toHaveLength(2);
        expect(span.transcript_range[0]).toBeGreaterThanOrEqual(0);
        expect(span.transcript_range[1]).toBeGreaterThanOrEqual(
          span.transcript_range[0],
        );
        expect(span.quote).toBeTruthy();
        expect(span.quote.length).toBeLessThanOrEqual(300);
      }
    });

    it('returns empty evidence spans when no transcript segments provided', () => {
      const input = mockInput({ transcript_segments: [] });
      const mid = generateMid(input);

      expect(mid.evidence_spans).toHaveLength(0);
    });
  });

  describe('Idempotency', () => {
    it('produces identical output for identical inputs', () => {
      const input = mockInput();
      const mid1 = generateMid(input);
      const mid2 = generateMid(input);

      expect(JSON.stringify(mid1)).toBe(JSON.stringify(mid2));
    });
  });

  describe('Edge cases', () => {
    it('handles empty analysis gracefully', () => {
      const input = mockInput({
        analysis: mockAnalysis({
          summary: [],
          key_points: [],
          action_items: [],
          decisions: [],
        }),
        meeting_entities: [],
      });
      const mid = generateMid(input);

      expect(mid.mid_version).toBe(1);
      expect(mid.participants).toHaveLength(0);
      expect(mid.projects).toHaveLength(0);
      expect(mid.topics).toHaveLength(0);
      expect(mid.action_items).toHaveLength(0);
      expect(mid.decisions).toHaveLength(0);
      expect(mid.evidence_spans).toHaveLength(0);
    });

    it('handles null occurred_at', () => {
      const input = mockInput({ occurred_at: null });
      const mid = generateMid(input);

      expect(mid.occurred_at).toBeNull();
    });

    it('handles entities with malformed metadata JSON', () => {
      const input = mockInput({
        meeting_entities: [
          mockEntity({
            type: 'person',
            name: 'Bad Metadata',
            metadata: 'not-json',
          }),
        ],
      });
      const mid = generateMid(input);

      expect(mid.participants).toHaveLength(1);
      expect(mid.participants[0].role).toBeUndefined();
    });
  });

  describe('Speaker label fallback', () => {
    it('derives participants from transcript speakers when no person entities exist', () => {
      const input = mockInput({
        meeting_entities: [mockEntity({ type: 'topic', name: 'Some Topic' })],
        transcript_segments: [
          { text: 'Hello', speaker: 'Me' },
          { text: 'Hi there', speaker: 'Them' },
          { text: 'How are you?', speaker: 'Me' },
          { text: 'Good.', speaker: 'Them' },
          { text: 'Ready?', speaker: 'Me' },
        ],
      });
      const mid = generateMid(input);

      // "Me" 3 segments, "Them" 2 — sorted by count desc
      expect(mid.participants).toHaveLength(2);
      expect(mid.participants[0].name).toBe('Me');
      expect(mid.participants[0].entity_id).toBe('speaker:me');
      expect(mid.participants[1].name).toBe('Them');
      expect(mid.participants[1].entity_id).toBe('speaker:them');
    });

    it('does not apply speaker fallback when person entities already exist', () => {
      const input = mockInput({
        meeting_entities: [
          mockEntity({ type: 'person', name: 'Sarah Chen', mention_count: 5 }),
        ],
        transcript_segments: [
          { text: 'Hi', speaker: 'Me' },
          { text: 'Hey', speaker: 'Them' },
        ],
      });
      const mid = generateMid(input);

      expect(mid.participants).toHaveLength(1);
      expect(mid.participants[0].name).toBe('Sarah Chen');
    });

    it('produces empty participants when segments have no speaker field', () => {
      const input = mockInput({
        meeting_entities: [],
        transcript_segments: [{ text: 'Hello' }, { text: 'World' }],
      });
      const mid = generateMid(input);

      expect(mid.participants).toHaveLength(0);
    });
  });
});
