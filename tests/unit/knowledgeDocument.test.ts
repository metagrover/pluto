import { describe, expect, it } from 'vitest';

import type { WorkingMemorySnapshot } from '../../electron/db';
import type { AttentionItem } from '../../electron/intelligence/intelligenceTypes';
import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import type { KnowledgeProjectHealthCard } from '../../src/api/knowledgeWorkspace';
import {
  compileKnowledgeBrief,
  compileNeedsAttention,
  deriveKnowledgeDigest,
  groupKnowledgeDocs,
  knowledgeDocsNeedPolling,
  parseStructuredKnowledgeDoc,
  parseStructuredKnowledgeV2Doc,
  supportsWorkingMemorySnapshotScope,
} from '../../src/components/KnowledgeGraph/knowledgeDocument';

const makeDoc = (overrides: Partial<KnowledgeDoc>): KnowledgeDoc => ({
  id: 'doc-1',
  scope_type: 'global',
  scope_key: 'global',
  title: 'Global Knowledge Context',
  rendered_content: null,
  structured_json: null,
  config: null,
  status: 'up_to_date',
  last_synthesized_at: '2026-04-25T10:00:00.000Z',
  last_source_cursor: null,
  updated_at: '2026-04-25T10:00:00.000Z',
  ...overrides,
});

const makeProjectCard = (
  overrides: Partial<KnowledgeProjectHealthCard>,
): KnowledgeProjectHealthCard => ({
  doc_id: 'doc-project',
  project_id: 'project-1',
  title: 'Project One',
  open_blockers: 0,
  dependency_count: 0,
  recent_changes: 0,
  staleness_days: 0,
  ...overrides,
});

const makeWorkingMemorySnapshot = (
  overrides: Partial<WorkingMemorySnapshot> = {},
): WorkingMemorySnapshot => ({
  id: 'snapshot-1',
  scope_type: 'global',
  scope_key: 'global',
  title: 'Global Knowledge Context',
  source_doc_id: 'doc-1',
  source_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
  freshness: 'fresh',
  trust_status: 'grounded',
  source_count: 3,
  cited_meeting_count: 2,
  payload: {
    schema_version: 1,
    scope: {
      type: 'global',
      key: 'global',
      title: 'Global Knowledge Context',
    },
    source: {
      knowledge_doc_id: 'doc-1',
      knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
    },
    current_read: {
      headline: 'Snapshot-backed current read is now the durable source.',
      supporting_bullets: [
        'The durable snapshot preserves the main thread.',
        'Fallback still exists for missing snapshots.',
      ],
      freshness: 'fresh',
      trust_status: 'grounded',
      trust_message: 'Backed by the persisted global snapshot.',
      source_count: 3,
      cited_item_count: 4,
      cited_meeting_count: 2,
      evidence_quality: {
        mode: 'direct',
        confidence: 0.86,
        cited_meeting_count: 2,
        source_count: 3,
        last_reinforced_at: '2026-04-25T10:00:00.000Z',
        freshness: 'fresh',
      },
    },
    active_streams: [
      {
        id: 'stream-launch',
        title: 'Launch',
        domain: 'work',
        status: 'active',
        current_read: 'Launch work remains active in the durable snapshot.',
        last_touched_at: '2026-04-25T10:00:00.000Z',
        source_count: 2,
        open_follow_up_count: 1,
        decision_count: 1,
        unresolved_question_count: 0,
        pinned: true,
        evidence_quality: {
          mode: 'direct',
          confidence: 0.86,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-04-25T10:00:00.000Z',
          freshness: 'fresh',
        },
      },
    ],
    open_loops: [
      {
        id: 'loop-1',
        title: 'Assign launch owner',
        summary: 'Launch owner is still missing.',
        kind: 'follow_up',
        severity: 'watch',
        why_now: 'The current launch plan still lacks an owner.',
        stream_ids: ['stream-launch'],
        citations: [
          {
            meeting_id: 'm-launch',
            quote: 'We still need to assign a launch owner.',
          },
        ],
        evidence_quality: {
          mode: 'direct',
          confidence: 0.81,
          cited_meeting_count: 1,
          source_count: 1,
          last_reinforced_at: '2026-04-25T10:00:00.000Z',
          freshness: 'fresh',
        },
      },
    ],
    patterns: [],
    risks_and_unknowns: [
      {
        id: 'risk-1',
        title: 'Approval path still risks launch timing.',
        summary: 'Approval path still risks launch timing.',
        kind: 'risk',
        severity: 'needs_attention',
        why_now: 'Approval remains unresolved across current meetings.',
        stream_ids: ['stream-launch'],
        citations: [
          {
            meeting_id: 'm-risk',
            quote: 'Approval is still unresolved.',
          },
        ],
        evidence_quality: {
          mode: 'inferred',
          confidence: 0.77,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-04-25T10:00:00.000Z',
          freshness: 'fresh',
        },
      },
    ],
    evidence_index: [
      {
        id: 'evidence-1',
        meeting_id: 'm-launch',
        meeting_title: 'Launch Review',
        captured_at: '2026-04-25T10:00:00.000Z',
        quote: 'We still need to assign a launch owner.',
        stream_ids: ['stream-launch'],
        item_ids: ['loop-1'],
        mode: 'direct',
        confidence: 0.91,
      },
    ],
    change_summary: {
      generated_at: '2026-04-25T10:00:00.000Z',
      added_count: 2,
      removed_count: 0,
      updated_count: 1,
      notable_changes: ['Launch', 'Assign launch owner'],
    },
  },
  generated_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  ...overrides,
});

const makeAttentionItem = (
  overrides: Partial<AttentionItem> = {},
): AttentionItem => ({
  id: 'attention-1',
  dedupe_key: 'knowledge_v2:attention-1',
  kind: 'blocker',
  severity: 'critical',
  score: 0.95,
  status: 'active',
  title: 'API instrumentation approval is still pending.',
  reason: 'Approval still blocks the active launch stream.',
  source: 'knowledge_v2',
  score_breakdown: null,
  evidence: [
    {
      meeting_id: 'm-approval',
      quote: 'Approval is still pending for instrumentation.',
      source_kind: 'knowledge_v2',
    },
  ],
  related_entity_ids: [],
  related_stream_ids: ['stream-launch'],
  related_meeting_ids: ['m-approval'],
  created_at: '2026-04-25T10:00:00.000Z',
  updated_at: '2026-04-25T10:00:00.000Z',
  last_seen_at: '2026-04-25T10:00:00.000Z',
  resolved_at: null,
  ...overrides,
});

describe('knowledge document utilities', () => {
  it('parses V2 knowledge docs and compiles PRD-native sections first', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline:
            'Knowledge quality is moving from archive browsing to a living brief.',
          supporting_bullets: [
            'Knowledge Dashboard: synthesis quality is active.',
          ],
          freshness: 'fresh',
          source_count: 3,
          cited_item_count: 4,
          cited_meeting_count: 3,
          trust_message: 'Grounded in multiple cited sources.',
          evidence_quality: {
            mode: 'inferred',
            confidence: 0.86,
            cited_meeting_count: 3,
            source_count: 3,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [
          {
            id: 'knowledge-dashboard',
            title: 'Knowledge Dashboard',
            domain: 'work',
            status: 'active',
            current_read: 'Synthesis quality is the active stream.',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 3,
            open_follow_up_count: 1,
            decision_count: 1,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: {
              mode: 'inferred',
              confidence: 0.82,
              cited_meeting_count: 3,
              source_count: 3,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
        ],
        needs_attention: [
          {
            id: 'a1',
            title: 'API instrumentation approval is still pending.',
            summary: 'Approval blocks demo readiness.',
            kind: 'blocker',
            severity: 'needs_attention',
            why_now: 'It blocks an active stream.',
            stream_ids: ['knowledge-dashboard'],
            citations: [
              { meeting_id: 'm1', quote: 'approval is still pending' },
            ],
            evidence_quality: {
              mode: 'direct',
              confidence: 0.9,
              cited_meeting_count: 1,
              source_count: 1,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
        ],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [
          {
            id: 'e1',
            meeting_id: 'm1',
            meeting_title: 'Knowledge Review',
            captured_at: '2026-04-25T10:00:00.000Z',
            quote: 'approval is still pending',
            stream_ids: ['knowledge-dashboard'],
            item_ids: ['a1'],
            mode: 'direct',
            confidence: 0.9,
          },
        ],
        source_quality_summary: {
          included_count: 3,
          excluded_count: 1,
          weak_count: 1,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 2,
          removed_count: 0,
          updated_count: 0,
          notable_changes: ['Knowledge Dashboard'],
        },
      }),
    });

    const brief = compileKnowledgeBrief(doc);
    const attention = compileNeedsAttention(doc, [], []);

    expect(brief.isCompiled).toBe(true);
    expect(brief.headline).toBe(
      'Knowledge quality is moving from archive browsing to a living brief.',
    );
    expect(brief.supportingBullets).toEqual([
      'Knowledge Dashboard: synthesis quality is active.',
    ]);
    expect(brief.activeStreams[0].title).toBe('Knowledge Dashboard');
    expect(brief.sourceQuality).toMatchObject({
      included_count: 3,
      excluded_count: 1,
    });
    expect(brief.trustStatus).toBe('inferred');
    expect(brief.trustDescription).toBe(
      'Supported by evidence, but synthesized across sources.',
    );
    expect(attention[0]).toMatchObject({
      title: 'API instrumentation approval is still pending.',
      severity: 'critical',
      kind: 'blocker',
    });
  });

  it('preserves V2 change summaries for snapshot-backed consumers', () => {
    const parsed = parseStructuredKnowledgeV2Doc(
      makeDoc({
        structured_json: JSON.stringify({
          schema_version: 2,
          scope: { type: 'global', title: 'Global Knowledge' },
          current_read: {
            headline: 'Global current read',
            supporting_bullets: [],
            freshness: 'fresh',
            source_count: 2,
            cited_item_count: 1,
            cited_meeting_count: 1,
            trust_message: 'Backed by evidence.',
            evidence_quality: {
              mode: 'direct',
              confidence: 0.88,
              cited_meeting_count: 1,
              source_count: 2,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
          active_streams: [],
          needs_attention: [],
          patterns: [],
          risks_and_unknowns: [],
          evidence_index: [],
          source_quality_summary: {
            included_count: 2,
            excluded_count: 0,
            weak_count: 0,
            records: [],
          },
          change_summary: {
            generated_at: '2026-04-25T10:00:00.000Z',
            added_count: 2,
            removed_count: 1,
            updated_count: 3,
            notable_changes: ['Launch', 'Approval path'],
          },
        }),
      }),
    );

    expect(parsed?.change_summary).toEqual({
      generated_at: '2026-04-25T10:00:00.000Z',
      added_count: 2,
      removed_count: 1,
      updated_count: 3,
      notable_changes: ['Launch', 'Approval path'],
    });
  });

  it('repairs weak V2 headlines and bad global stream titles at render time', () => {
    const baseQuality = {
      mode: 'direct',
      confidence: 0.8,
      cited_meeting_count: 1,
      source_count: 1,
      last_reinforced_at: '2026-04-25T10:00:00.000Z',
      freshness: 'fresh',
    };
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline:
            "The team discusses transitioning user preferences and other data into the database for scaling purposes, with concerns about an advisor's container.",
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 4,
          cited_item_count: 2,
          cited_meeting_count: 2,
          trust_message: 'Grounded in multiple cited sources.',
          evidence_quality: baseQuality,
        },
        active_streams: [
          {
            id: 'adam',
            title: 'Adam',
            domain: 'work',
            status: 'active',
            current_read: 'Hyper-Persona Leads',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 3,
            open_follow_up_count: 1,
            decision_count: 1,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: baseQuality,
          },
          {
            id: 'you',
            title: 'You',
            domain: 'work',
            status: 'active',
            current_read: 'Impact of AI on Software Engineering Process',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 3,
            open_follow_up_count: 0,
            decision_count: 0,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: baseQuality,
          },
          {
            id: 'language',
            title: 'Language',
            domain: 'work',
            status: 'steady',
            current_read: 'The conversation revolves around the concept of',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 2,
            open_follow_up_count: 0,
            decision_count: 0,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: baseQuality,
          },
        ],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 4,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.headline).toContain('Hyper-Persona Leads');
    expect(brief.headline).toContain(
      'Impact of AI on Software Engineering Process',
    );
    expect(brief.activeStreams.map((stream) => stream.title)).toEqual([
      'Hyper-Persona Leads',
      'Impact of AI on Software Engineering Process',
    ]);
    expect(brief.activeStreams.map((stream) => stream.current_read)).toEqual([
      'Hyper-Persona Leads',
      'Impact of AI on Software Engineering Process',
    ]);
  });

  it('derives stale trust state for stale V2 docs', () => {
    const doc = makeDoc({
      status: 'stale',
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'The rollout context has not been refreshed recently.',
          supporting_bullets: [],
          freshness: 'stale',
          source_count: 2,
          cited_item_count: 2,
          cited_meeting_count: 2,
          trust_message: 'This read may be stale.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.75,
            cited_meeting_count: 2,
            source_count: 2,
            last_reinforced_at: '2026-04-01T10:00:00.000Z',
            freshness: 'stale',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.trustStatus).toBe('stale');
    expect(brief.trustDescription).toBe(
      'The evidence has aged and should be refreshed before relying on it.',
    );
  });

  it('marks generic V2 briefs as uncompiled instead of presenting them as insight', () => {
    const baseQuality = {
      mode: 'direct',
      confidence: 0.4,
      cited_meeting_count: 1,
      source_count: 1,
      last_reinforced_at: '2026-04-25T10:00:00.000Z',
      freshness: 'fresh',
    };
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'The team discusses several topics from the meeting.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Evidence is thin.',
          evidence_quality: baseQuality,
        },
        active_streams: [
          {
            id: 'language',
            title: 'Language',
            domain: 'unknown',
            status: 'steady',
            current_read: 'The conversation revolves around the concept of',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 1,
            open_follow_up_count: 0,
            decision_count: 0,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: baseQuality,
          },
        ],
        needs_attention: [],
        patterns: [
          {
            id: 'p1',
            title: 'A single capture mentions the dashboard.',
            summary: 'A single capture mentions the dashboard.',
            kind: 'pattern',
            severity: 'steady',
            why_now: 'Only one capture mentioned this.',
            stream_ids: ['language'],
            citations: [{ meeting_id: 'm1', quote: 'dashboard' }],
            evidence_quality: baseQuality,
          },
        ],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 1,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.isCompiled).toBe(false);
    expect(brief.headline).toBe('No reliable compiled brief yet.');
    expect(brief.activeStreams).toHaveLength(0);
    expect(brief.patterns).toHaveLength(0);
  });

  it('prefers a valid global working-memory snapshot over transient doc JSON', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Transient doc JSON should not win when a snapshot exists.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Doc fallback only.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.5,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      payload: {
        ...baseSnapshot.payload,
        source_quality_summary: {
          included_count: 3,
          excluded_count: 1,
          weak_count: 1,
          records: [],
        },
      } as WorkingMemorySnapshot['payload'],
    });

    expect(brief.headline).toBe(
      'Snapshot-backed current read is now the durable source.',
    );
    expect(brief.supportingBullets).toEqual([
      'The durable snapshot preserves the main thread.',
      'Fallback still exists for missing snapshots.',
    ]);
    expect(brief.activeStreams[0].title).toBe('Launch');
    expect(brief.trustMessage).toBe('Backed by the persisted global snapshot.');
    expect(brief.sourceQuality).toMatchObject({
      included_count: 3,
      excluded_count: 1,
      weak_count: 1,
    });
    expect(brief.freshnessAt).toBe('2026-04-25T10:00:00.000Z');
    expect(brief.coverage).toMatchObject({
      sourceCount: 3,
      statementCount: 4,
      citedMeetingCount: 2,
    });
    expect(brief.evidenceQuality).toMatchObject({
      mode: 'direct',
      confidence: 0.86,
      cited_meeting_count: 2,
      source_count: 3,
      last_reinforced_at: '2026-04-25T10:00:00.000Z',
      freshness: 'fresh',
    });
  });

  it('degrades snapshot-backed trust when rendered evidence freshness is aging', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Transient doc JSON should not win when a snapshot exists.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Doc fallback only.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.5,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      freshness: 'aging',
      payload: {
        ...baseSnapshot.payload,
        current_read: {
          ...baseSnapshot.payload.current_read,
          freshness: 'aging',
          evidence_quality: {
            ...baseSnapshot.payload.current_read.evidence_quality,
            freshness: 'aging',
          },
        },
      } as WorkingMemorySnapshot['payload'],
    });

    expect(brief.trustStatus).toBe('inferred');
  });

  it('degrades snapshot-backed trust to weak evidence when rendered freshness is unknown', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Transient doc JSON should not win when a snapshot exists.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Doc fallback only.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.5,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      freshness: 'unknown',
      payload: {
        ...baseSnapshot.payload,
        current_read: {
          ...baseSnapshot.payload.current_read,
          freshness: 'unknown',
          evidence_quality: {
            ...baseSnapshot.payload.current_read.evidence_quality,
            freshness: 'unknown',
          },
        },
      } as WorkingMemorySnapshot['payload'],
    });

    expect(brief.trustStatus).toBe('weak_evidence');
  });

  it('prefers a matching project working-memory snapshot for a project knowledge doc', () => {
    const doc = makeDoc({
      id: 'doc-project',
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project Atlas',
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'project', title: 'Project Atlas' },
        current_read: {
          headline: 'Doc JSON fallback should not win when snapshot matches.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Doc fallback only.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.5,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project Atlas',
      source_doc_id: 'doc-project',
      payload: {
        ...baseSnapshot.payload,
        scope: {
          type: 'project',
          key: 'project-1',
          title: 'Project Atlas',
        },
        source: {
          knowledge_doc_id: 'doc-project',
          knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
        },
        current_read: {
          ...baseSnapshot.payload.current_read,
          headline: 'Project snapshot-backed current read should win.',
        },
      },
    });

    expect(brief.headline).toBe(
      'Project snapshot-backed current read should win.',
    );
    expect(brief.trustMessage).toBe('Backed by the persisted global snapshot.');
    expect(brief.freshnessAt).toBe('2026-04-25T10:00:00.000Z');
  });

  it('treats person and team knowledge docs as snapshot-eligible scopes', () => {
    expect(supportsWorkingMemorySnapshotScope('person_context')).toBe(true);
    expect(supportsWorkingMemorySnapshotScope('team_tracker')).toBe(true);
  });

  it('prefers a matching person-context working-memory snapshot for a people knowledge doc', () => {
    const doc = makeDoc({
      id: 'doc-person',
      scope_type: 'person_context',
      scope_key: 'person-1',
      title: 'Conversations with Alex Rivera',
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: {
          type: 'person_context',
          title: 'Conversations with Alex Rivera',
        },
        current_read: {
          headline: 'Doc JSON fallback should not win for people docs.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Doc fallback only.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.5,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      scope_type: 'person_context',
      scope_key: 'person-1',
      title: 'Conversations with Alex Rivera',
      source_doc_id: 'doc-person',
      payload: {
        ...baseSnapshot.payload,
        scope: {
          type: 'person_context',
          key: 'person-1',
          title: 'Conversations with Alex Rivera',
        },
        source: {
          knowledge_doc_id: 'doc-person',
          knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
        },
        current_read: {
          ...baseSnapshot.payload.current_read,
          headline: 'Person snapshot-backed current read should win.',
        },
      },
    });

    expect(brief.headline).toBe(
      'Person snapshot-backed current read should win.',
    );
    expect(brief.trustMessage).toBe('Backed by the persisted global snapshot.');
    expect(brief.freshnessAt).toBe('2026-04-25T10:00:00.000Z');
  });

  it('prefers a matching team-tracker working-memory snapshot for a team knowledge doc', () => {
    const doc = makeDoc({
      id: 'doc-team',
      scope_type: 'team_tracker',
      scope_key: 'team-1',
      title: 'Leadership Team',
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: {
          type: 'team_tracker',
          title: 'Leadership Team',
        },
        current_read: {
          headline: 'Doc JSON fallback should not win for team docs.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Doc fallback only.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.5,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      scope_type: 'team_tracker',
      scope_key: 'team-1',
      title: 'Leadership Team',
      source_doc_id: 'doc-team',
      payload: {
        ...baseSnapshot.payload,
        scope: {
          type: 'team_tracker',
          key: 'team-1',
          title: 'Leadership Team',
        },
        source: {
          knowledge_doc_id: 'doc-team',
          knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
        },
        current_read: {
          ...baseSnapshot.payload.current_read,
          headline: 'Team snapshot-backed current read should win.',
        },
      },
    });

    expect(brief.headline).toBe(
      'Team snapshot-backed current read should win.',
    );
    expect(brief.trustMessage).toBe('Backed by the persisted global snapshot.');
    expect(brief.freshnessAt).toBe('2026-04-25T10:00:00.000Z');
  });

  it('prefers the V2 evidence reinforcement time for Current Read freshness', () => {
    const doc = makeDoc({
      last_synthesized_at: '2026-04-27T10:00:00.000Z',
      updated_at: '2026-04-27T10:00:00.000Z',
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Freshness should follow the cited reinforcement time.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 2,
          cited_item_count: 2,
          cited_meeting_count: 2,
          trust_message: 'Grounded in cited operating reviews.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.84,
            cited_meeting_count: 2,
            source_count: 2,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [
          {
            id: 'stream-1',
            title: 'Launch',
            domain: 'work',
            status: 'active',
            current_read: 'Launch work remains active.',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 2,
            open_follow_up_count: 1,
            decision_count: 1,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: {
              mode: 'direct',
              confidence: 0.84,
              cited_meeting_count: 2,
              source_count: 2,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
        ],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-27T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.freshnessAt).toBe('2026-04-25T10:00:00.000Z');
  });

  it('falls back to doc JSON when the global working-memory snapshot is stale', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Fresh doc fallback should remain available.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 2,
          cited_item_count: 2,
          cited_meeting_count: 2,
          trust_message: 'Doc fallback stays intact.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.82,
            cited_meeting_count: 2,
            source_count: 2,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [
          {
            id: 'doc-stream',
            title: 'Fallback Stream',
            domain: 'work',
            status: 'active',
            current_read: 'Fallback stream stays visible.',
            last_touched_at: '2026-04-25T10:00:00.000Z',
            source_count: 2,
            open_follow_up_count: 0,
            decision_count: 1,
            unresolved_question_count: 0,
            pinned: false,
            evidence_quality: {
              mode: 'direct',
              confidence: 0.82,
              cited_meeting_count: 2,
              source_count: 2,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
        ],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(
      doc,
      makeWorkingMemorySnapshot({ freshness: 'stale' }),
    );

    expect(brief.headline).toBe('Fresh doc fallback should remain available.');
    expect(brief.activeStreams[0].title).toBe('Fallback Stream');
    expect(brief.trustMessage).toBe('Doc fallback stays intact.');
  });

  it('keeps a matching stale working-memory snapshot as explicit fallback when the doc failed', () => {
    const doc = makeDoc({
      status: 'failed',
      structured_json: null,
      rendered_content: null,
    });

    const baseSnapshot = makeWorkingMemorySnapshot();
    const brief = compileKnowledgeBrief(doc, {
      ...baseSnapshot,
      freshness: 'stale',
      trust_status: 'stale',
      payload: {
        ...baseSnapshot.payload,
        current_read: {
          ...baseSnapshot.payload.current_read,
          freshness: 'stale',
          trust_status: 'stale',
          headline: 'Stale but durable snapshot fallback remains visible.',
          trust_message: 'This fallback is aging and should be refreshed.',
          evidence_quality: {
            ...baseSnapshot.payload.current_read.evidence_quality,
            freshness: 'stale',
          },
        },
      },
    });

    expect(brief.headline).toBe(
      'Stale but durable snapshot fallback remains visible.',
    );
    expect(brief.trustStatus).toBe('stale');
    expect(brief.trustDescription).toBe(
      'The evidence has aged and should be refreshed before relying on it.',
    );
    expect(brief.isCompiled).toBe(true);
  });

  it('falls back to doc JSON when the working-memory snapshot predates the latest synthesis', () => {
    const doc = makeDoc({
      last_synthesized_at: '2026-04-26T10:00:00.000Z',
      updated_at: '2026-04-26T10:00:00.000Z',
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Doc JSON should win after a newer synthesis pass.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 2,
          cited_item_count: 2,
          cited_meeting_count: 2,
          trust_message: 'Fresh doc synthesis is newer than the snapshot.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.82,
            cited_meeting_count: 2,
            source_count: 2,
            last_reinforced_at: '2026-04-26T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-26T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(
      doc,
      makeWorkingMemorySnapshot({
        source_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
        generated_at: '2026-04-25T10:00:00.000Z',
        updated_at: '2026-04-25T10:00:00.000Z',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          source: {
            knowledge_doc_id: 'doc-1',
            knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
          },
        },
      }),
    );

    expect(brief.headline).toBe(
      'Doc JSON should win after a newer synthesis pass.',
    );
    expect(brief.trustMessage).toBe(
      'Fresh doc synthesis is newer than the snapshot.',
    );
  });

  it('falls back to doc JSON when the global working-memory snapshot payload is invalid', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline: 'Doc fallback should survive invalid snapshot payloads.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 2,
          cited_item_count: 2,
          cited_meeting_count: 2,
          trust_message: 'Snapshot payload validation failed.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.8,
            cited_meeting_count: 2,
            source_count: 2,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
        change_summary: {
          generated_at: '2026-04-25T10:00:00.000Z',
          added_count: 0,
          removed_count: 0,
          updated_count: 0,
          notable_changes: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(
      doc,
      makeWorkingMemorySnapshot({
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          active_streams: null as unknown as [],
        },
      }),
    );

    expect(brief.headline).toBe(
      'Doc fallback should survive invalid snapshot payloads.',
    );
    expect(brief.trustMessage).toBe('Snapshot payload validation failed.');
  });

  it('keeps rendering legacy snapshots that do not yet preserve current read evidence quality', () => {
    const brief = compileKnowledgeBrief(
      makeDoc({
        structured_json: JSON.stringify({
          schema_version: 2,
          scope: { type: 'global', title: 'Global Knowledge' },
          current_read: {
            headline: 'Doc fallback should remain available.',
            supporting_bullets: [],
            freshness: 'fresh',
            source_count: 2,
            cited_item_count: 2,
            cited_meeting_count: 2,
            trust_message: 'Doc fallback only.',
            evidence_quality: {
              mode: 'direct',
              confidence: 0.61,
              cited_meeting_count: 2,
              source_count: 2,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
          active_streams: [],
          needs_attention: [],
          patterns: [],
          risks_and_unknowns: [],
          evidence_index: [],
          source_quality_summary: {
            included_count: 2,
            excluded_count: 0,
            weak_count: 0,
            records: [],
          },
        }),
      }),
      makeWorkingMemorySnapshot({
        trust_status: 'inferred',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          current_read: {
            ...makeWorkingMemorySnapshot().payload.current_read,
            trust_status: 'inferred',
            evidence_quality: undefined as never,
          },
        },
      }),
    );

    expect(brief.headline).toBe(
      'Snapshot-backed current read is now the durable source.',
    );
    expect(brief.evidenceQuality).toMatchObject({
      mode: 'inferred',
      confidence: 0.72,
      cited_meeting_count: 2,
      source_count: 3,
      last_reinforced_at: '2026-04-25T10:00:00.000Z',
      freshness: 'fresh',
    });
  });

  it('parses structured knowledge chapters and citations', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Use the citation-backed knowledge document as the main memory surface.',
                why_it_matters:
                  'It keeps browsing grounded in meeting evidence.',
                citations: [
                  {
                    meeting_id: 'm1',
                    quote: 'make the knowledge docs the main surface',
                  },
                ],
              },
            ],
            topic_evolution: [],
            open_risks: [],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const parsed = parseStructuredKnowledgeDoc(doc);

    expect(parsed?.chapters[0].decisions[0]).toMatchObject({
      id: 'd1',
      text: 'Use the citation-backed knowledge document as the main memory surface.',
      citations: [
        {
          meeting_id: 'm1',
          quote: 'make the knowledge docs the main surface',
        },
      ],
    });
  });

  it('filters dependency suggestions that expose raw ids instead of names', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [],
        dependency_suggestions: [
          {
            source_name: 'b302af40-809e-4139-8a85-36a9624c58f6',
            target_name: 'Context Studio',
            relationship: 'depends_on',
            why: 'Raw IDs should not become user-facing knowledge.',
            citations: [{ meeting_id: 'm1', quote: 'Context Studio' }],
          },
          {
            source_name: 'Infrastructure Scaling',
            target_name: 'Context Studio',
            relationship: 'impacts',
            why: 'This is a readable dependency.',
            citations: [{ meeting_id: 'm2', quote: 'scaling decisions' }],
          },
        ],
      }),
    });

    expect(parseStructuredKnowledgeDoc(doc)?.dependency_suggestions).toEqual([
      {
        source_name: 'Infrastructure Scaling',
        target_name: 'Context Studio',
        relationship: 'impacts',
        why: 'This is a readable dependency.',
        citations: [{ meeting_id: 'm2', quote: 'scaling decisions' }],
      },
    ]);
  });

  it('returns null for missing or malformed structured JSON', () => {
    expect(
      parseStructuredKnowledgeDoc(makeDoc({ structured_json: null })),
    ).toBe(null);
    expect(
      parseStructuredKnowledgeDoc(makeDoc({ structured_json: '{not json' })),
    ).toBe(null);
  });

  it('derives digest items from structured sections before rendered fallback', () => {
    const doc = makeDoc({
      rendered_content: 'Rendered fallback should not be first.',
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Decision one is important.',
                why_it_matters: 'It changes the product direction.',
                citations: [],
              },
            ],
            topic_evolution: [
              {
                id: 't1',
                text: 'The knowledge surface is shifting toward synthesized docs.',
                why_it_matters:
                  'The old dashboard over-emphasized graph entities.',
                citations: [],
              },
            ],
            open_risks: [],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    expect(deriveKnowledgeDigest(doc)).toEqual([
      'Decision one is important.',
      'The knowledge surface is shifting toward synthesized docs.',
    ]);
  });

  it('falls back to rendered content when structured data is unavailable', () => {
    const doc = makeDoc({
      rendered_content:
        '# Global Knowledge Context\n\nAuto-synthesized yesterday.\n\n- First useful memory.\n- Second useful memory.',
    });

    expect(deriveKnowledgeDigest(doc)).toEqual([
      'First useful memory.',
      'Second useful memory.',
    ]);
  });

  it('groups docs by scope for the browser', () => {
    const groups = groupKnowledgeDocs([
      makeDoc({ id: 'global', scope_type: 'global', title: 'Global' }),
      makeDoc({ id: 'project', scope_type: 'project', title: 'Project' }),
      makeDoc({
        id: 'person',
        scope_type: 'person_context',
        title: 'Person',
      }),
      makeDoc({ id: 'team', scope_type: 'team_tracker', title: 'Team' }),
    ]);

    expect(groups.map((group) => [group.scopeType, group.docs.length])).toEqual(
      [
        ['global', 1],
        ['project', 1],
        ['person_context', 1],
        ['team_tracker', 1],
      ],
    );
  });

  it('polls while background knowledge synthesis can change workspace state', () => {
    expect(
      knowledgeDocsNeedPolling([
        makeDoc({ status: 'up_to_date' }),
        makeDoc({ id: 'doc-2', status: 'synthesizing' }),
      ]),
    ).toBe(true);
    expect(
      knowledgeDocsNeedPolling([
        makeDoc({ status: 'up_to_date' }),
        makeDoc({ id: 'doc-2', status: 'stale' }),
      ]),
    ).toBe(true);
    expect(knowledgeDocsNeedPolling([makeDoc({ status: 'up_to_date' })])).toBe(
      false,
    );
  });

  it('compiles a brief with priority, risk, pattern, and dependency lanes', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Prioritize the active project intelligence surface.',
                why_it_matters: 'It turns memory into a daily planning input.',
                citations: [
                  {
                    meeting_id: 'm1',
                    quote: 'prioritize the active project intelligence surface',
                  },
                ],
              },
            ],
            topic_evolution: [
              {
                id: 't1',
                text: 'Knowledge moved from archive browsing to signal synthesis.',
                why_it_matters: 'The interface should feel compiled.',
                citations: [
                  {
                    meeting_id: 'm2',
                    quote: 'move from archive browsing to signal synthesis',
                  },
                ],
              },
            ],
            open_risks: [
              {
                id: 'r1',
                text: 'A document-first view can bury urgent project risks.',
                why_it_matters:
                  'Risk should be visible before evidence drilldown.',
                citations: [
                  {
                    meeting_id: 'm3',
                    quote: 'document-first views can bury project risks',
                  },
                ],
              },
            ],
            signals: [
              {
                id: 's1',
                text: 'Repeated reviews mention overwhelm and weak prioritization.',
                why_it_matters: 'Pluto should reduce interpretation work.',
                citations: [
                  {
                    meeting_id: 'm4',
                    quote: 'reviews mention overwhelm',
                  },
                ],
              },
            ],
          },
        ],
        dependency_suggestions: [
          {
            source_name: 'Knowledge Home',
            target_name: 'Projects',
            relationship: 'impacts',
            why: 'Project context should feed the compiled brief.',
            citations: [
              {
                meeting_id: 'm5',
                quote: 'project context should feed knowledge',
              },
            ],
          },
        ],
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.isCompiled).toBe(true);
    expect(brief.headline).toBe(
      'Repeated reviews mention overwhelm and weak prioritization.',
    );
    expect(brief.lanes.map((lane) => lane.id)).toEqual([
      'priorities',
      'risks',
      'patterns',
      'dependencies',
    ]);
    expect(brief.lanes[0].items[0].text).toBe(
      'Repeated reviews mention overwhelm and weak prioritization.',
    );
    expect(brief.lanes[1].items[0].text).toBe(
      'A document-first view can bury urgent project risks.',
    );
    expect(brief.lanes[3].items[0].text).toBe(
      'Knowledge Home impacts Projects',
    );
  });

  it('does not treat a single narrow extracted statement as a compiled brief', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'single-meeting',
            title: 'Exploration of Career Opportunities',
            decisions: [
              {
                id: 'd1',
                text: 'Commit to exploring opportunities with major VCs.',
                why_it_matters:
                  'Takes advantage of increased visibility and career growth.',
                citations: [
                  {
                    meeting_id: 'm1',
                    quote:
                      'Committing to exploring opportunities with major VCs.',
                  },
                ],
              },
            ],
            topic_evolution: [],
            open_risks: [],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.isCompiled).toBe(false);
    expect(brief.headline).toBe(
      'Commit to exploring opportunities with major VCs.',
    );
    expect(brief.coverage).toMatchObject({
      statementCount: 1,
      citedMeetingCount: 1,
    });
    expect(brief.lanes[0].items[0].text).toBe(
      'Commit to exploring opportunities with major VCs.',
    );
  });

  it('keeps a reliable V2 headline visible during weak synthesis', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Global Knowledge' },
        current_read: {
          headline:
            'API context work is moving from architecture into validation.',
          supporting_bullets: [
            'Demo readiness still depends on instrumentation and approval.',
          ],
          freshness: 'fresh',
          source_count: 1,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Evidence is thin but cited.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.61,
            cited_meeting_count: 1,
            source_count: 1,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [],
        evidence_index: [],
        source_quality_summary: {
          included_count: 1,
          excluded_count: 0,
          weak_count: 1,
          records: [],
        },
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.isCompiled).toBe(false);
    expect(brief.headline).toBe(
      'API context work is moving from architecture into validation.',
    );
  });

  it('selects a multi-source, high-context item as the compiled headline', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Commit to exploring opportunities with major VCs.',
                why_it_matters:
                  'This came from one career exploration meeting.',
                citations: [
                  {
                    meeting_id: 'm1',
                    quote:
                      'Committing to exploring opportunities with major VCs.',
                  },
                ],
              },
            ],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: 'Advisor Agent Deployment may miss demo readiness without UAT and API instrumentation.',
                why_it_matters:
                  'The same blocker appears across planning and deployment conversations.',
                citations: [
                  {
                    meeting_id: 'm2',
                    quote: 'UAT setup is still active.',
                  },
                  {
                    meeting_id: 'm3',
                    quote: 'API instrumentation remains unresolved.',
                  },
                ],
              },
            ],
            signals: [
              {
                id: 's1',
                text: 'Repeated product reviews point toward a denser operating dashboard.',
                why_it_matters:
                  'This gives the workspace a current product direction.',
                citations: [
                  {
                    meeting_id: 'm2',
                    quote: 'The dashboard needs to feel dense.',
                  },
                  {
                    meeting_id: 'm4',
                    quote: 'The operating picture should be richer.',
                  },
                ],
              },
            ],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.isCompiled).toBe(true);
    expect(brief.headline).toBe(
      'Repeated product reviews point toward a denser operating dashboard.',
    );
    expect(brief.coverage).toMatchObject({
      statementCount: 3,
      citedMeetingCount: 4,
    });
  });

  it('prefers concise strategic statements over verbose meeting-summary headlines', () => {
    const doc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Global Knowledge Context' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [
              {
                id: 'd1',
                text: 'Transition persistent state into the database for initial scalability.',
                why_it_matters:
                  'This is the clearest durable direction from the source meetings.',
                citations: [{ meeting_id: 'm1', quote: 'persistent state' }],
              },
            ],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: 'Advisor container ownership remains unresolved.',
                why_it_matters:
                  'This can block progress if ownership is not clarified.',
                citations: [{ meeting_id: 'm2', quote: 'container' }],
              },
            ],
            signals: [
              {
                id: 's1',
                text: "The team discusses transitioning user preferences and other data into the database for scaling purposes, with concerns about an advisor's container possibly hindering progress.",
                why_it_matters:
                  'This is a broad meeting summary rather than a crisp current read.',
                citations: [{ meeting_id: 'm1', quote: 'team discusses' }],
              },
            ],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const brief = compileKnowledgeBrief(doc);

    expect(brief.headline).toBe(
      'Transition persistent state into the database for initial scalability.',
    );
  });

  it('marks unstructured documents as not compiled instead of inventing claims', () => {
    const brief = compileKnowledgeBrief(
      makeDoc({
        title: 'Preview Memory',
        rendered_content:
          '# Preview Memory\n\nSignals will appear after Electron provides real knowledge data.',
        structured_json: null,
      }),
    );

    expect(brief.isCompiled).toBe(false);
    expect(brief.headline).toBe('No reliable compiled brief yet.');
    expect(brief.lanes.every((lane) => lane.items.length === 0)).toBe(true);
  });

  it('compiles needs-attention items from risks and active project health', () => {
    const sourceDoc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: 'Advisor Agent Deployment may miss demo readiness without UAT and API instrumentation.',
                why_it_matters:
                  'The follow-up work is spread across setup, instrumentation, and deployment.',
                citations: [
                  {
                    meeting_id: 'm1',
                    quote:
                      'UAT setup and API instrumentation are still active.',
                  },
                ],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [
        makeDoc({
          id: 'doc-blocked',
          scope_type: 'project',
          title: 'Blocked Launch',
          status: 'up_to_date',
        }),
        makeDoc({
          id: 'doc-stale',
          scope_type: 'project',
          title: 'Stale Migration',
          status: 'stale',
        }),
      ],
      [
        makeProjectCard({
          doc_id: 'doc-blocked',
          title: 'Blocked Launch',
          open_blockers: 2,
          dependency_count: 1,
          recent_changes: 3,
          staleness_days: 1,
        }),
        makeProjectCard({
          doc_id: 'doc-stale',
          title: 'Stale Migration',
          open_blockers: 0,
          dependency_count: 0,
          recent_changes: 0,
          staleness_days: 12,
        }),
      ],
    );

    expect(attention.map((item) => item.title)).toEqual([
      'Advisor Agent Deployment may miss demo readiness without UAT and API instrumentation.',
      'Blocked Launch',
      'Stale Migration',
    ]);
    expect(attention[0]).toMatchObject({
      severity: 'critical',
      kind: 'risk',
      reasons: [
        'The follow-up work is spread across setup, instrumentation, and deployment.',
      ],
    });
    expect(attention[0].citations).toHaveLength(1);
    expect(attention[1]).toMatchObject({
      severity: 'critical',
      kind: 'project',
    });
    expect(attention[1].reasons).toContain('2 blockers');
    expect(attention[2]).toMatchObject({
      severity: 'watch',
      kind: 'project',
    });
  });

  it('prefers active durable attention items for the global Knowledge doc', () => {
    const sourceDoc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: 'Legacy fallback risk item',
                why_it_matters:
                  'This should be ignored when queue items exist.',
                citations: [],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [],
      [],
      [
        makeAttentionItem(),
        makeAttentionItem({
          id: 'attention-2',
          dedupe_key: 'action_tracker:attention-2',
          kind: 'follow_up',
          severity: 'watch',
          score: 0.64,
          title: 'Confirm launch owner',
          reason: 'The current launch plan still lacks an owner.',
          evidence: [
            {
              meeting_id: 'm-launch',
              quote: 'We still need to assign a launch owner.',
              source_kind: 'action_tracker',
            },
          ],
        }),
      ],
    );

    expect(attention).toEqual([
      {
        id: 'attention-1',
        title: 'API instrumentation approval is still pending.',
        summary: 'Approval still blocks the active launch stream.',
        severity: 'critical',
        kind: 'blocker',
        reasons: ['Approval still blocks the active launch stream.'],
        citations: [
          {
            meeting_id: 'm-approval',
            quote: 'Approval is still pending for instrumentation.',
          },
        ],
      },
      {
        id: 'attention-2',
        title: 'Confirm launch owner',
        summary: 'The current launch plan still lacks an owner.',
        severity: 'watch',
        kind: 'follow_up',
        reasons: ['The current launch plan still lacks an owner.'],
        citations: [
          {
            meeting_id: 'm-launch',
            quote: 'We still need to assign a launch owner.',
          },
        ],
      },
    ]);
  });

  it('prefers matching active attention items for a person-context Knowledge doc', () => {
    const sourceDoc = makeDoc({
      id: 'doc-person',
      scope_type: 'person_context',
      scope_key: 'person-1',
      title: 'Alex Rivera',
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'person_context', title: 'Alex Rivera' },
        chapters: [
          {
            chapter_id: 'person',
            title: 'Alex Rivera',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'risk-fallback',
                text: 'Legacy person-context fallback item',
                why_it_matters:
                  'This should be ignored when a matching queue item exists.',
                citations: [],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(sourceDoc, [], [], [
      makeAttentionItem({
        id: 'attention-person',
        kind: 'follow_up',
        severity: 'watch',
        title: 'Send Alex the renewal summary',
        reason: 'Alex is still waiting on the renewal summary from the latest meeting.',
        related_entity_ids: ['person-1'],
        evidence: [
          {
            meeting_id: 'm-person',
            quote: 'Alex is still waiting on the renewal summary.',
            source_kind: 'knowledge_v2',
          },
        ],
      }),
    ]);

    expect(attention).toEqual([
      {
        id: 'attention-person',
        title: 'Send Alex the renewal summary',
        summary:
          'Alex is still waiting on the renewal summary from the latest meeting.',
        severity: 'watch',
        kind: 'follow_up',
        reasons: [
          'Alex is still waiting on the renewal summary from the latest meeting.',
        ],
        citations: [
          {
            meeting_id: 'm-person',
            quote: 'Alex is still waiting on the renewal summary.',
          },
        ],
      },
    ]);
  });

  it('preserves blocker classification from a matching working-memory snapshot', () => {
    const sourceDoc = makeDoc({
      id: 'doc-project',
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project One',
      structured_json: null,
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [],
      [],
      [],
      makeWorkingMemorySnapshot({
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project One',
        source_doc_id: 'doc-project',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          scope: {
            type: 'project',
            key: 'project-1',
            title: 'Project One',
          },
          source: {
            knowledge_doc_id: 'doc-project',
            knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
          },
          open_loops: [
            {
              id: 'loop-blocker',
              title: 'Legal approval is still blocking launch',
              summary:
                'The durable snapshot still shows an unresolved blocker.',
              kind: 'blocker',
              severity: 'needs_attention',
              why_now: 'Launch cannot proceed until legal approval lands.',
              stream_ids: ['stream-launch'],
              citations: [
                {
                  meeting_id: 'm-legal',
                  quote: 'Legal approval is still blocking the launch path.',
                },
              ],
              evidence_quality: {
                mode: 'direct',
                confidence: 0.91,
                cited_meeting_count: 1,
                source_count: 1,
                last_reinforced_at: '2026-04-25T10:00:00.000Z',
                freshness: 'fresh',
              },
            },
          ],
          patterns: [],
          risks_and_unknowns: [],
          evidence_index: [],
        },
      }),
    );

    expect(attention).toEqual([
      {
        id: 'loop-blocker',
        title: 'Legal approval is still blocking launch',
        summary: 'The durable snapshot still shows an unresolved blocker.',
        severity: 'critical',
        kind: 'blocker',
        reasons: ['Launch cannot proceed until legal approval lands.'],
        citations: [
          {
            meeting_id: 'm-legal',
            quote: 'Legal approval is still blocking the launch path.',
          },
        ],
      },
    ]);
  });

  it('keeps fallback needs-attention logic for non-global docs even when queue items exist', () => {
    const sourceDoc = makeDoc({
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project One',
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'project', title: 'Project One' },
        chapters: [
          {
            chapter_id: 'project',
            title: 'Project One',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: 'Project synthesis needs a dependency review.',
                why_it_matters:
                  'A blocker is unresolved in the current project.',
                citations: [],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [],
      [],
      [makeAttentionItem()],
    );

    expect(attention).toMatchObject([
      {
        title: 'Project synthesis needs a dependency review.',
        severity: 'critical',
        kind: 'risk',
      },
    ]);
  });

  it('prefers a matching project working-memory snapshot for project needs attention', () => {
    const sourceDoc = makeDoc({
      id: 'doc-project',
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project One',
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'project', title: 'Project One' },
        chapters: [
          {
            chapter_id: 'project',
            title: 'Project One',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: 'Legacy project risk fallback',
                why_it_matters:
                  'This should be ignored when a matching snapshot exists.',
                citations: [],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [],
      [
        makeProjectCard({
          doc_id: 'doc-project',
          title: 'Project One',
          open_blockers: 3,
        }),
      ],
      [],
      makeWorkingMemorySnapshot({
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project One',
        source_doc_id: 'doc-project',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          scope: {
            type: 'project',
            key: 'project-1',
            title: 'Project One',
          },
          source: {
            knowledge_doc_id: 'doc-project',
            knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
          },
          open_loops: [
            {
              id: 'loop-project',
              title: 'Confirm launch dependency owner',
              summary: 'The launch dependency still has no owner.',
              kind: 'dependency',
              severity: 'needs_attention',
              why_now: 'This is still blocking the active project.',
              stream_ids: ['stream-launch'],
              citations: [
                {
                  meeting_id: 'm-project',
                  quote: 'The launch dependency still needs an owner.',
                },
              ],
              evidence_quality: {
                mode: 'direct',
                confidence: 0.84,
                cited_meeting_count: 1,
                source_count: 1,
                last_reinforced_at: '2026-04-25T10:00:00.000Z',
                freshness: 'fresh',
              },
            },
          ],
          patterns: [],
          risks_and_unknowns: [],
          evidence_index: [],
        },
      }),
    );

    expect(attention).toEqual([
      {
        id: 'loop-project',
        title: 'Confirm launch dependency owner',
        summary: 'The launch dependency still has no owner.',
        severity: 'critical',
        kind: 'dependency',
        reasons: ['This is still blocking the active project.'],
        citations: [
          {
            meeting_id: 'm-project',
            quote: 'The launch dependency still needs an owner.',
          },
        ],
      },
    ]);
  });

  it.each([
    [
      'person_context',
      'person-1',
      'Alex Rivera',
      'm-person',
      'Prepare renewal notes',
    ],
    [
      'team_tracker',
      'team-1',
      'Revenue Team',
      'm-team',
      'Escalate launch blocker',
    ],
  ] as const)(
    'prefers a matching %s working-memory snapshot for needs attention',
    (scopeType, scopeKey, title, meetingId, loopTitle) => {
      const sourceDoc = makeDoc({
        id: `doc-${scopeKey}`,
        scope_type: scopeType,
        scope_key: scopeKey,
        title,
        structured_json: JSON.stringify({
          schema_version: 1,
          scope: { type: scopeType, title },
          chapters: [
            {
              chapter_id: scopeType,
              title,
              decisions: [],
              topic_evolution: [],
              open_risks: [
                {
                  id: 'risk-fallback',
                  text: 'Legacy fallback risk',
                  why_it_matters:
                    'This should be ignored when a matching snapshot exists.',
                  citations: [],
                },
              ],
              signals: [],
            },
          ],
          dependency_suggestions: [],
        }),
      });

      const attention = compileNeedsAttention(
        sourceDoc,
        [],
        [],
        [],
        makeWorkingMemorySnapshot({
          scope_type: scopeType,
          scope_key: scopeKey,
          title,
          source_doc_id: `doc-${scopeKey}`,
          payload: {
            ...makeWorkingMemorySnapshot().payload,
            scope: {
              type: scopeType,
              key: scopeKey,
              title,
            },
            source: {
              knowledge_doc_id: `doc-${scopeKey}`,
              knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
            },
            open_loops: [
              {
                id: `loop-${scopeKey}`,
                title: loopTitle,
                summary:
                  'The durable snapshot still has an unresolved blocker.',
                kind: 'follow_up',
                severity: 'watch',
                why_now: 'This is still active in the latest snapshot.',
                stream_ids: ['stream-1'],
                citations: [
                  {
                    meeting_id: meetingId,
                    quote: 'The unresolved blocker is still active.',
                  },
                ],
                evidence_quality: {
                  mode: 'direct',
                  confidence: 0.72,
                  cited_meeting_count: 1,
                  source_count: 1,
                  last_reinforced_at: '2026-04-25T10:00:00.000Z',
                  freshness: 'fresh',
                },
              },
            ],
            patterns: [],
            risks_and_unknowns: [],
            evidence_index: [],
          },
        }),
      );

      expect(attention).toEqual([
        {
          id: `loop-${scopeKey}`,
          title: loopTitle,
          summary: 'The durable snapshot still has an unresolved blocker.',
          severity: 'watch',
          kind: 'follow_up',
          reasons: ['This is still active in the latest snapshot.'],
          citations: [
            {
              meeting_id: meetingId,
              quote: 'The unresolved blocker is still active.',
            },
          ],
        },
      ]);
    },
  );

  it('falls back to project-card heuristics when the project snapshot is stale', () => {
    const sourceDoc = makeDoc({
      id: 'doc-project',
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project One',
      structured_json: null,
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [sourceDoc],
      [
        makeProjectCard({
          doc_id: 'doc-project',
          title: 'Project One',
          open_blockers: 2,
          dependency_count: 1,
        }),
      ],
      [],
      makeWorkingMemorySnapshot({
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project One',
        source_doc_id: 'doc-project',
        freshness: 'stale',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          scope: {
            type: 'project',
            key: 'project-1',
            title: 'Project One',
          },
          source: {
            knowledge_doc_id: 'doc-project',
            knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
          },
        },
      }),
    );

    expect(attention).toMatchObject([
      {
        title: 'Project One',
        severity: 'critical',
        kind: 'project',
        reasons: ['2 blockers', '1 dependency'],
      },
    ]);
  });

  it('falls back to fresher project doc data when the matching snapshot predates the latest synthesis', () => {
    const sourceDoc = makeDoc({
      id: 'doc-project',
      scope_type: 'project',
      scope_key: 'project-1',
      title: 'Project One',
      last_synthesized_at: '2026-04-26T10:00:00.000Z',
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'project', title: 'Project One' },
        chapters: [
          {
            chapter_id: 'project',
            title: 'Project One',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'risk-fresh-doc',
                text: 'Fresh project synthesis says launch coordination is unresolved.',
                why_it_matters:
                  'The latest project synthesis is newer than the stored snapshot.',
                citations: [],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(
      sourceDoc,
      [],
      [],
      [],
      makeWorkingMemorySnapshot({
        scope_type: 'project',
        scope_key: 'project-1',
        title: 'Project One',
        source_doc_id: 'doc-project',
        source_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
        payload: {
          ...makeWorkingMemorySnapshot().payload,
          scope: {
            type: 'project',
            key: 'project-1',
            title: 'Project One',
          },
          source: {
            knowledge_doc_id: 'doc-project',
            knowledge_doc_last_synthesized_at: '2026-04-25T10:00:00.000Z',
          },
          open_loops: [
            {
              id: 'loop-project',
              title: 'Stale snapshot follow-up',
              summary: 'This should be ignored because the doc is newer.',
              kind: 'follow_up',
              severity: 'watch',
              why_now:
                'The snapshot is older than the latest project synthesis.',
              stream_ids: ['stream-launch'],
              citations: [
                {
                  meeting_id: 'm-project',
                  quote: 'This snapshot item is now stale.',
                },
              ],
              evidence_quality: {
                mode: 'direct',
                confidence: 0.84,
                cited_meeting_count: 1,
                source_count: 1,
                last_reinforced_at: '2026-04-25T10:00:00.000Z',
                freshness: 'fresh',
              },
            },
          ],
          patterns: [],
          risks_and_unknowns: [],
          evidence_index: [],
        },
      }),
    );

    expect(attention).toEqual([
      {
        id: 'risk-risk-fresh-doc',
        title:
          'Fresh project synthesis says launch coordination is unresolved.',
        summary:
          'The latest project synthesis is newer than the stored snapshot.',
        severity: 'critical',
        kind: 'risk',
        reasons: [
          'The latest project synthesis is newer than the stored snapshot.',
        ],
        citations: [],
      },
    ]);
  });

  it('classifies extracted follow-ups as watch items instead of critical risks', () => {
    const sourceDoc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 1,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        chapters: [
          {
            chapter_id: 'global',
            title: 'Workspace',
            decisions: [],
            topic_evolution: [],
            open_risks: [
              {
                id: 'r1',
                text: "Review the user's travel dates and itinerary.",
                why_it_matters:
                  'Captured from Travel Plans for Berlin Trip as follow-up or unresolved work.',
                citations: [
                  {
                    meeting_id: 'travel',
                    quote: "Review the user's travel dates and itinerary.",
                  },
                ],
              },
              {
                id: 'r2',
                text: 'Approval is still pending for API instrumentation.',
                why_it_matters:
                  'Captured from Advisor Agent Deployment as follow-up or unresolved work.',
                citations: [
                  {
                    meeting_id: 'deployment',
                    quote: 'Approval is still pending for API instrumentation.',
                  },
                ],
              },
            ],
            signals: [],
          },
        ],
        dependency_suggestions: [],
      }),
    });

    const attention = compileNeedsAttention(sourceDoc, [], []);

    expect(attention).toMatchObject([
      {
        title: 'Approval is still pending for API instrumentation.',
        severity: 'watch',
        kind: 'follow_up',
      },
      {
        title: "Review the user's travel dates and itinerary.",
        severity: 'watch',
        kind: 'follow_up',
      },
    ]);
  });
});
