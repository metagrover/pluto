import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { KnowledgeDoc } from '../../src/api/knowledgeDocs';
import {
  MainStage,
  buildCurrentReadWhyItem,
} from '../../src/components/KnowledgeGraph/MainStage';

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

describe('Knowledge MainStage', () => {
  it('does not repeat a promoted risk in both Needs Attention and Risks and Unknowns', () => {
    const duplicatedRisk =
      'Advisor Agent Deployment may miss demo readiness without UAT and API instrumentation.';
    const selectedDoc = makeDoc({
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
                text: duplicatedRisk,
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

    const markup = renderToStaticMarkup(
      <MainStage
        docs={[selectedDoc]}
        selectedDoc={selectedDoc}
        projectCards={[]}
        sources={[]}
        sourcesLoading={false}
        onRetrySynthesis={async () => {}}
        onSaveCorrection={async () => {}}
      />,
    );

    expect(markup).toContain('Needs Attention');
    expect(markup).not.toContain(
      'Failure modes, unresolved commitments, and cross-context dependencies worth keeping visible.',
    );
  });

  it('keeps distinct V2 risks visible when they were not promoted into Needs Attention', () => {
    const promotedTitle = 'Approval path is still blocked.';
    const distinctRisk = 'Budget confidence is still low for the next phase.';
    const selectedDoc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        current_read: {
          headline: 'Launch planning remains the main operating thread.',
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
        active_streams: [],
        needs_attention: [
          {
            id: 'attention-1',
            title: promotedTitle,
            summary: 'Approval is still pending for the launch path.',
            kind: 'risk',
            severity: 'needs_attention',
            why_now: 'The launch path is blocked on approval.',
            stream_ids: ['launch'],
            citations: [
              {
                meeting_id: 'm-approval',
                quote: 'Approval is still pending.',
              },
            ],
            evidence_quality: {
              mode: 'direct',
              confidence: 0.88,
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
            id: 'risk-duplicate',
            title: promotedTitle,
            summary: 'Approval is still pending for the launch path.',
            kind: 'risk',
            severity: 'needs_attention',
            why_now: 'The launch path is blocked on approval.',
            stream_ids: ['launch'],
            citations: [
              {
                meeting_id: 'm-approval',
                quote: 'Approval is still pending.',
              },
            ],
            evidence_quality: {
              mode: 'direct',
              confidence: 0.88,
              cited_meeting_count: 1,
              source_count: 1,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
          {
            id: 'risk-distinct',
            title: distinctRisk,
            summary: 'Budget remains uncertain beyond the current quarter.',
            kind: 'risk',
            severity: 'watch',
            why_now: 'Finance has not confirmed the next-phase budget yet.',
            stream_ids: ['launch'],
            citations: [
              {
                meeting_id: 'm-budget',
                quote: 'Budget remains uncertain for next phase.',
              },
            ],
            evidence_quality: {
              mode: 'inferred',
              confidence: 0.73,
              cited_meeting_count: 1,
              source_count: 1,
              last_reinforced_at: '2026-04-25T10:00:00.000Z',
              freshness: 'fresh',
            },
          },
        ],
        evidence_index: [],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
      }),
    });

    const markup = renderToStaticMarkup(
      <MainStage
        docs={[selectedDoc]}
        selectedDoc={selectedDoc}
        projectCards={[]}
        sources={[]}
        sourcesLoading={false}
        onRetrySynthesis={async () => {}}
        onSaveCorrection={async () => {}}
      />,
    );

    expect(markup.split(promotedTitle)).toHaveLength(2);
    expect(markup.split(distinctRisk)).toHaveLength(2);
  });

  it('renders a why action for Current Read supporting bullets', () => {
    const selectedDoc = makeDoc({
      structured_json: JSON.stringify({
        schema_version: 2,
        scope: { type: 'global', title: 'Workspace Intelligence' },
        current_read: {
          headline: 'Launch planning remains the main operating thread.',
          supporting_bullets: [],
          freshness: 'fresh',
          source_count: 2,
          cited_item_count: 1,
          cited_meeting_count: 1,
          trust_message: 'Grounded in cited operating reviews.',
          evidence_quality: {
            mode: 'direct',
            confidence: 0.84,
            cited_meeting_count: 1,
            source_count: 2,
            last_reinforced_at: '2026-04-25T10:00:00.000Z',
            freshness: 'fresh',
          },
        },
        active_streams: [],
        needs_attention: [],
        patterns: [],
        risks_and_unknowns: [
          {
            id: 'risk-1',
            title: 'Operations launch review is still active.',
            summary: 'The launch plan still depends on operations review.',
            kind: 'risk',
            severity: 'watch',
            why_now: 'The supporting evidence still points at launch review.',
            stream_ids: ['launch'],
            citations: [
              {
                meeting_id: 'm-launch',
                quote: 'Operations launch review is still active.',
              },
            ],
            evidence_quality: {
              mode: 'direct',
              confidence: 0.75,
              cited_meeting_count: 1,
              source_count: 1,
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
            captured_at: '2026-04-25T09:30:00.000Z',
            quote: 'Operations launch review is still active.',
            stream_ids: ['launch'],
            item_ids: ['risk-1'],
            mode: 'direct',
            confidence: 0.86,
          },
        ],
        source_quality_summary: {
          included_count: 2,
          excluded_count: 0,
          weak_count: 0,
          records: [],
        },
      }),
    });

    const markup = renderToStaticMarkup(
      <MainStage
        docs={[selectedDoc]}
        selectedDoc={selectedDoc}
        projectCards={[]}
        sources={[]}
        sourcesLoading={false}
        onRetrySynthesis={async () => {}}
        onSaveCorrection={async () => {}}
      />,
    );

    expect(markup).toContain('Operations launch review is still active.');
    expect(markup).toContain('Why?');
  });

  it('builds Current Read why items from matching evidence entries before bare citations', () => {
    const whyItem = buildCurrentReadWhyItem({
      item: {
        id: 'risk-1',
        text: 'Operations launch review is still active.',
        why_it_matters:
          'This is still the clearest evidence behind the headline.',
        citations: [
          {
            meeting_id: 'm-launch',
            quote: 'Operations launch review is still active.',
          },
        ],
      },
      evidenceIndex: [
        {
          id: 'evidence-1',
          meeting_id: 'm-launch',
          meeting_title: 'Launch Review',
          captured_at: '2026-04-25T09:30:00.000Z',
          quote: 'Operations launch review is still active.',
          stream_ids: ['launch'],
          item_ids: ['risk-1'],
          mode: 'direct',
          confidence: 0.86,
        },
        {
          id: 'evidence-2',
          meeting_id: 'm-other',
          meeting_title: 'Other Review',
          captured_at: '2026-04-25T08:30:00.000Z',
          quote: 'Unrelated evidence.',
          stream_ids: ['other'],
          item_ids: ['other-item'],
          mode: 'direct',
          confidence: 0.42,
        },
      ],
    });

    expect(whyItem.title).toBe('Operations launch review is still active.');
    expect(whyItem.reasons).toEqual([
      'This is still the clearest evidence behind the headline.',
      'Surfaced under Current Read because it supports the compiled headline.',
    ]);
    expect(whyItem.evidenceEntries).toEqual([
      expect.objectContaining({
        id: 'evidence-1',
        meeting_id: 'm-launch',
        quote: 'Operations launch review is still active.',
      }),
    ]);
  });
});
