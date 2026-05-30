import { describe, expect, it } from 'vitest';

import {
  applyKnowledgeCorrectionsToDocument,
  buildDeterministicKnowledgeV2Document,
  classifyKnowledgeV2Item,
  mergeKnowledgeV2Documents,
  repairKnowledgeV2Document,
  scoreKnowledgeV2Source,
  shouldHardResetKnowledgeDoc,
} from '../../electron/knowledgeV2';

const makeSource = (overrides = {}) => ({
  id: 'm1',
  title: 'Knowledge Dashboard Review',
  occurred_at: '2026-04-20T10:00:00.000Z',
  duration_seconds: 1800,
  evidence:
    'Summary: Knowledge needs better synthesis quality.\nAction items: Resolve pending API instrumentation approval.\nDecisions: Use cited evidence for current read.\nKey points: Multiple reviews mention weak prioritization.',
  analysis_format_pass: true,
  enhanced_notes: 'Detailed notes about the knowledge dashboard and evidence.',
  user_notes: '',
  entity_names: ['Knowledge Dashboard', 'API Instrumentation'],
  ...overrides,
});

const makeCorrection = (overrides = {}) => ({
  id: 'correction-1',
  doc_id: 'doc-1',
  target_kind: 'item',
  target_id: 'target-1',
  action: 'promote_item',
  payload_json: null,
  created_at: '2026-05-10T10:00:00.000Z',
  ...overrides,
});

describe('knowledge V2 utilities', () => {
  it('filters true throwaway recordings without blocking testing strategy meetings', () => {
    expect(
      scoreKnowledgeV2Source(
        makeSource({
          title: 'audio test',
          duration_seconds: 20,
          evidence: '',
          enhanced_notes: '',
        }),
      ).usable,
    ).toBe(false);

    const strategy = scoreKnowledgeV2Source(
      makeSource({
        title: 'Testing Strategy Review',
        duration_seconds: 240,
        evidence:
          'Summary: The team reviewed testing strategy for synthesis quality.',
        enhanced_notes:
          'Testing strategy notes with enough detail to be a real source.',
      }),
    );

    expect(strategy.usable).toBe(true);
    expect(strategy.domain).toBe('work');
  });

  it('preserves personal travel and research sources when they contain real signal', () => {
    expect(
      scoreKnowledgeV2Source(
        makeSource({
          id: 'travel',
          title: 'Berlin Trip Planning',
          evidence:
            'Summary: Berlin planning has bike routes and shopping follow-ups.\nAction items: Confirm travel dates.',
        }),
      ),
    ).toMatchObject({ usable: true, domain: 'travel' });

    expect(
      scoreKnowledgeV2Source(
        makeSource({
          id: 'research',
          title: 'YouTube Lecture Notes: RAG Evaluation',
          evidence:
            'Summary: The lecture explained retrieval evaluation and citation quality.\nKey points: Grounded QA needs citation precision.',
        }),
      ),
    ).toMatchObject({ usable: true, domain: 'research' });
  });

  it('keeps untitled captures when user notes provide meaningful signal', () => {
    const quality = scoreKnowledgeV2Source(
      makeSource({
        title: 'New Meeting',
        duration_seconds: 45,
        evidence: '',
        enhanced_notes: '',
        user_notes:
          'Personal note: Berlin trip dates are still uncertain, but the user wants bike-friendly routes and museum options.',
      }),
    );

    expect(quality.usable).toBe(true);
    expect(quality.reasons).toContain('default_title_with_notes');
  });

  it('classifies follow-ups separately from risks and blockers', () => {
    expect(classifyKnowledgeV2Item('Confirm Berlin travel dates.')).toBe(
      'follow_up',
    );
    expect(
      classifyKnowledgeV2Item(
        'API instrumentation approval is still pending and blocks demo readiness.',
      ),
    ).toBe('blocker');
    expect(
      classifyKnowledgeV2Item(
        'Missing owner for production rollout creates coordination risk.',
      ),
    ).toBe('risk');
  });

  it('builds a PRD-native deterministic V2 document from mixed sources', () => {
    const doc = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource(),
        makeSource({
          id: 'travel',
          title: 'Berlin Trip Planning',
          evidence:
            'Summary: Berlin planning has itinerary, biking, and shopping follow-ups.\nAction items: Confirm travel dates.',
          entity_names: ['Berlin Trip'],
        }),
      ],
    );

    expect(doc.schema_version).toBe(2);
    expect(doc.current_read.headline).toContain('Knowledge Dashboard');
    expect(doc.current_read.headline).toContain('Berlin Trip');
    expect(doc.active_streams.map((stream) => stream.title)).toEqual(
      expect.arrayContaining(['Knowledge Dashboard', 'Berlin Trip']),
    );
    expect(doc.needs_attention.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['blocker', 'follow_up']),
    );
    expect(doc.source_quality_summary.included_count).toBe(2);
    expect(doc.evidence_index.length).toBeGreaterThan(0);
  });

  it('synthesizes a cross-stream headline instead of echoing the first summary', () => {
    const doc = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'knowledge-1',
          title: 'Knowledge Dashboard Review',
          evidence:
            'Summary: The team discussed the knowledge dashboard.\nAction items: Resolve pending API instrumentation approval.',
          entity_names: ['Knowledge Dashboard'],
        }),
        makeSource({
          id: 'berlin-1',
          title: 'Berlin Trip Planning',
          evidence:
            'Summary: Berlin planning has itinerary and bike-route follow-ups.\nAction items: Confirm Berlin travel dates.',
          entity_names: ['Berlin Trip'],
        }),
      ],
    );

    expect(doc.current_read.headline).toContain('Knowledge Dashboard');
    expect(doc.current_read.headline).toContain('Berlin Trip');
    expect(doc.current_read.headline).not.toBe(
      'The team discussed the knowledge dashboard.',
    );
  });

  it('promotes repeated themes across sources instead of one-source summary piles', () => {
    const doc = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'review-1',
          evidence:
            'Summary: Knowledge needs stronger synthesis quality.\nKey points: Better citations would improve trust. | Source controls are useful.',
          entity_names: ['Knowledge Dashboard'],
        }),
        makeSource({
          id: 'review-2',
          evidence:
            'Summary: Knowledge needs stronger synthesis quality.\nKey points: Current read quality depends on better citations.',
          entity_names: ['Knowledge Dashboard'],
        }),
      ],
    );

    expect(doc.patterns).toHaveLength(1);
    expect(doc.patterns[0].title).toContain(
      'Knowledge needs stronger synthesis quality',
    );
    expect(doc.patterns[0].evidence_quality.cited_meeting_count).toBe(2);
  });

  it('accumulates stream evidence breadth and latest reinforcement across meetings', () => {
    const doc = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'older',
          occurred_at: '2026-04-01T10:00:00.000Z',
          evidence: 'Summary: Knowledge dashboard synthesis quality is active.',
          entity_names: ['Knowledge Dashboard'],
        }),
        makeSource({
          id: 'newer',
          occurred_at: '2026-04-20T10:00:00.000Z',
          evidence:
            'Summary: Knowledge dashboard synthesis quality is still active.\nAction items: Resolve pending API instrumentation approval.',
          entity_names: ['Knowledge Dashboard'],
        }),
      ],
    );

    expect(doc.active_streams).toHaveLength(1);
    expect(doc.active_streams[0]).toMatchObject({
      source_count: 2,
      last_touched_at: '2026-04-20T10:00:00.000Z',
    });
    expect(doc.active_streams[0].evidence_quality).toMatchObject({
      cited_meeting_count: 2,
      source_count: 2,
    });
  });

  it('ranks urgent active streams ahead of broader but quieter reference streams', () => {
    const doc = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'reference-1',
          title: 'Reference Library Review',
          occurred_at: '2026-04-18T10:00:00.000Z',
          evidence:
            'Summary: The reference library taxonomy still supports onboarding.\nKey points: Search labels need cleanup.',
          entity_names: ['Reference Library'],
        }),
        makeSource({
          id: 'reference-2',
          title: 'Reference Library Metadata',
          occurred_at: '2026-04-19T10:00:00.000Z',
          evidence:
            'Summary: The reference library needs better metadata consistency.\nKey points: Tags remain uneven across docs.',
          entity_names: ['Reference Library'],
        }),
        makeSource({
          id: 'reference-3',
          title: 'Reference Library Cleanup',
          occurred_at: '2026-04-20T10:00:00.000Z',
          evidence:
            'Summary: The reference library cleanup is steady.\nKey points: Search labels will be normalized later.',
          entity_names: ['Reference Library'],
        }),
        makeSource({
          id: 'urgent-1',
          title: 'Launch Approval Escalation',
          occurred_at: '2026-04-21T10:00:00.000Z',
          evidence:
            'Summary: Launch readiness is blocked on approval.\nAction items: Confirm executive approval owner.\nDecisions: Hold launch until approval clears.\nAccountability risks: Missing approval still blocks launch readiness.',
          entity_names: ['Launch Approval'],
        }),
      ],
    );

    expect(doc.active_streams[0]?.title).toBe('Launch Approval');
    expect(doc.current_read.supporting_bullets[0]).toContain('Launch Approval');
  });

  it('merges V2 chunk documents without losing evidence or stream classifications', () => {
    const first = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [makeSource({ id: 'm1', entity_names: ['Knowledge Dashboard'] })],
    );
    const second = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'm2',
          title: 'Advisor Agent Deployment',
          evidence:
            'Summary: Advisor deployment depends on UAT.\nAction items: Prepare deployment instrumentation.',
          entity_names: ['Advisor Agent Deployment'],
        }),
      ],
    );

    const merged = mergeKnowledgeV2Documents(
      { type: 'global', title: 'Global Knowledge' },
      [first, second],
    );

    expect(merged.active_streams.map((stream) => stream.title)).toEqual(
      expect.arrayContaining([
        'Knowledge Dashboard',
        'Advisor Agent Deployment',
      ]),
    );
    expect(
      merged.evidence_index.map((evidence) => evidence.meeting_id),
    ).toEqual(expect.arrayContaining(['m1', 'm2']));
  });

  it('applies durable correction overlays to synthesized streams and items', () => {
    const base = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource(),
        makeSource({
          id: 'review-2',
          occurred_at: '2026-04-22T10:00:00.000Z',
          evidence:
            'Summary: Knowledge needs better synthesis quality.\nKey points: Better citations would improve trust. | Prepare deployment instrumentation.',
          entity_names: ['Knowledge Dashboard'],
        }),
      ],
    );
    const doc = {
      ...base,
      needs_attention: [
        {
          ...base.needs_attention[0],
          id: 'follow-up-1',
          kind: 'follow_up' as const,
          severity: 'watch' as const,
        },
      ],
      patterns: [
        {
          ...base.needs_attention[0],
          id: 'pattern-1',
          kind: 'pattern' as const,
          severity: 'steady' as const,
          title: 'Repeated trust gap across reviews',
          summary: 'Repeated trust gap across reviews appears repeatedly.',
        },
      ],
      risks_and_unknowns: [],
    };

    const stream = doc.active_streams[0];
    const attentionItem = doc.needs_attention[0];
    const patternItem = doc.patterns[0];

    expect(stream).toBeDefined();
    expect(attentionItem).toBeDefined();
    expect(patternItem).toBeDefined();

    const corrected = applyKnowledgeCorrectionsToDocument(doc, [
      makeCorrection({
        target_kind: 'stream',
        target_id: stream!.id,
        action: 'rename_stream',
        payload_json: JSON.stringify({ title: 'Trusted Knowledge Dashboard' }),
        created_at: '2026-05-10T09:00:00.000Z',
      }),
      makeCorrection({
        target_kind: 'stream',
        target_id: stream!.id,
        action: 'rename_stream',
        payload_json: JSON.stringify({ title: 'Final Dashboard Name' }),
        created_at: '2026-05-10T11:00:00.000Z',
      }),
      makeCorrection({
        target_kind: 'stream',
        target_id: stream!.id,
        action: 'pin_stream',
      }),
      makeCorrection({
        target_id: attentionItem!.id,
        action: 'demote_item',
      }),
      makeCorrection({
        target_id: patternItem!.id,
        action: 'promote_item',
      }),
      makeCorrection({
        target_id: patternItem!.id,
        action: 'correct_classification',
        payload_json: JSON.stringify({ kind: 'blocker' }),
        created_at: '2026-05-10T12:00:00.000Z',
      }),
    ]);

    expect(corrected.active_streams[0]).toMatchObject({
      id: stream!.id,
      title: 'Final Dashboard Name',
      pinned: true,
    });
    expect(corrected.current_read.supporting_bullets[0]).toContain(
      'Final Dashboard Name',
    );
    expect(
      corrected.needs_attention.some((item) => item.id === attentionItem!.id),
    ).toBe(false);
    expect(corrected.needs_attention[0]).toMatchObject({
      id: patternItem!.id,
      kind: 'blocker',
    });
    expect(
      corrected.risks_and_unknowns.some((item) => item.id === patternItem!.id),
    ).toBe(true);
  });

  it('ignores invalid classification payloads when applying corrections', () => {
    const doc = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [makeSource()],
    );
    const target = doc.needs_attention[0];

    const corrected = applyKnowledgeCorrectionsToDocument(doc, [
      makeCorrection({
        target_id: target.id,
        action: 'correct_classification',
        payload_json: JSON.stringify({ kind: 'not-a-real-kind' }),
      }),
    ]);

    expect(corrected.needs_attention[0]).toMatchObject({
      id: target.id,
      kind: target.kind,
      severity: target.severity,
    });
  });

  it('repairs weak LLM headlines and person/pronoun streams before rendering', () => {
    const fallback = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'm1',
          title: 'Hyper-Persona Leads Review',
          evidence:
            'Summary: Hyper-Persona Leads is active.\nAction items: Confirm lead-routing assumptions.',
          entity_names: ['Hyper-Persona Leads'],
        }),
        makeSource({
          id: 'm2',
          title: 'AI Engineering Process Review',
          evidence:
            'Summary: Impact of AI on Software Engineering Process is active.\nAction items: Clarify evaluation plan.',
          entity_names: ['Impact of AI on Software Engineering Process'],
        }),
      ],
    );
    const repaired = repairKnowledgeV2Document(
      {
        ...fallback,
        current_read: {
          ...fallback.current_read,
          headline:
            "The team discusses transitioning user preferences and other data into the database for scaling purposes, with concerns about an advisor's container.",
        },
        active_streams: [
          {
            ...fallback.active_streams[0],
            id: 'adam',
            title: 'Adam',
            current_read: 'Hyper-Persona Leads',
          },
          {
            ...fallback.active_streams[1],
            id: 'you',
            title: 'You',
            current_read: 'Impact of AI on Software Engineering Process',
          },
          {
            ...fallback.active_streams[0],
            id: 'aldo',
            title: 'Aldo',
            current_read:
              'Conversation captured. Key themes and follow-ups are summarized below.',
          },
          {
            ...fallback.active_streams[0],
            id: 'language',
            title: 'Language',
            current_read: 'The conversation revolves around the concept of',
          },
        ],
      },
      fallback,
    );

    expect(repaired.current_read.headline).toContain('Hyper-Persona Leads');
    expect(repaired.current_read.headline).toContain(
      'Impact of AI on Software Engineering Process',
    );
    expect(repaired.active_streams.map((stream) => stream.title)).toEqual([
      'Hyper-Persona Leads',
      'Impact of AI on Software Engineering Process',
    ]);
    expect(
      repaired.active_streams.map((stream) => stream.current_read),
    ).toEqual([
      'Hyper-Persona Leads',
      'Impact of AI on Software Engineering Process',
    ]);
  });

  it('refuses to promote generic LLM output into a confident brief', () => {
    const fallback = buildDeterministicKnowledgeV2Document(
      { type: 'global', title: 'Global Knowledge' },
      [
        makeSource({
          id: 'm1',
          title: 'Knowledge Dashboard Review',
          evidence:
            'Summary: Knowledge Dashboard review is active.\nAction items: Confirm synthesis quality bar.',
          entity_names: ['Knowledge Dashboard'],
        }),
      ],
    );
    const repaired = repairKnowledgeV2Document({
      ...fallback,
      current_read: {
        ...fallback.current_read,
        headline: 'The team discusses several topics from the meeting.',
      },
      active_streams: [
        {
          ...fallback.active_streams[0],
          id: 'language',
          title: 'Language',
          current_read: 'The conversation revolves around the concept of',
        },
      ],
      patterns: [
        {
          id: 'one-off-pattern',
          title: 'A single capture mentions the dashboard.',
          summary: 'A single capture mentions the dashboard.',
          kind: 'pattern',
          severity: 'steady',
          why_now: 'Only one capture mentioned this.',
          stream_ids: ['knowledge-dashboard'],
          citations: [{ meeting_id: 'm1', quote: 'dashboard' }],
          evidence_quality: {
            ...fallback.current_read.evidence_quality,
            cited_meeting_count: 1,
          },
        },
      ],
    });

    expect(repaired.active_streams).toHaveLength(0);
    expect(repaired.patterns).toHaveLength(0);
    expect(repaired.current_read.headline).toBe(
      'Pluto has source material, but no trustworthy current read yet.',
    );
  });

  it('hard resets stale V1 generated docs while preserving current V2 docs', () => {
    expect(
      shouldHardResetKnowledgeDoc({
        structured_json: JSON.stringify({ schema_version: 1, chapters: [] }),
        config: JSON.stringify({ synthesis_version: 2 }),
      }),
    ).toBe(true);

    expect(
      shouldHardResetKnowledgeDoc({
        structured_json: JSON.stringify({
          schema_version: 2,
          current_read: { headline: 'Current read', supporting_bullets: [] },
        }),
        config: JSON.stringify({ synthesis_version: 4 }),
      }),
    ).toBe(false);
  });
});
