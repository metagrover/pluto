import { describe, expect, it } from 'vitest';
import {
  buildPersonDossierRead,
  isCurrentPersonDossier,
} from '../../src/utils/personDossierRead';

describe('person dossier read', () => {
  it('refreshes older completed reads and waits for the current one', () => {
    expect(isCurrentPersonDossier('up_to_date', 7)).toBe(false);
    expect(isCurrentPersonDossier('up_to_date', 8)).toBe(false);
    expect(isCurrentPersonDossier('up_to_date', 9)).toBe(false);
    expect(isCurrentPersonDossier('synthesizing', 10)).toBe(false);
    expect(isCurrentPersonDossier('up_to_date', 10)).toBe(true);
  });

  it('leads with recurring work and shows an attributable example', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [
        {
          id: 'launch',
          title: 'Launch and Partner Coordination',
          current_read: 'Avery is handling launches and on partner timing.',
        },
      ],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Launch review',
          captured_at: '2026-07-10T12:00:00.000Z',
          quote: 'Avery worked on the partner launch plan.',
          stream_ids: ['launch'],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Partner check-in',
          captured_at: '2026-07-12T12:00:00.000Z',
          quote: 'Avery worked through the partner handoff.',
          stream_ids: ['launch'],
        },
      ],
    );

    expect(result.headline).toBe(
      'Avery has worked on launch and partner coordination across multiple conversations.',
    );
    expect(result.workstreams[0]?.detail).toBe(
      'Avery worked through the partner handoff.',
    );
    expect(result.workstreams[0]?.sources[0]?.meeting_id).toBe('meeting-two');
  });

  it('does not merge unrelated one-off tasks into a recurring work area', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [
        {
          id: 'mixed',
          title: 'Testing and Content Preparation',
          current_read: 'Avery handled testing and wrote content.',
        },
      ],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Release review',
          quote: 'Avery worked through test coverage for the release.',
          stream_ids: ['mixed'],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Editorial review',
          quote: 'Avery drafted the customer email.',
          stream_ids: ['mixed'],
        },
      ],
    );

    expect(result.headline).toBeNull();
    expect(result.workstreams).toEqual([]);
  });

  it('reconnects recurring evidence when merged stream IDs differ', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [
        {
          id: 'merged-query-stream',
          title: 'Query and Pipeline Optimization',
          current_read: 'Avery improved query performance.',
        },
        {
          id: 'merged-uat-stream',
          title: 'UAT and Content Strategy',
          current_read: 'Avery worked across UAT and content.',
        },
      ],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Performance review',
          quote: 'Avery is improving query performance for the pipeline.',
          stream_ids: ['chunk-query-stream'],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Pipeline review',
          quote: 'Avery optimized queries to relieve the pipeline bottleneck.',
          stream_ids: ['chunk-query-stream'],
        },
        {
          meeting_id: 'meeting-three',
          meeting_title: 'Release review',
          quote: 'Avery reviewed the release checklist.',
          stream_ids: ['chunk-release-stream'],
        },
        {
          meeting_id: 'meeting-four',
          meeting_title: 'Testing review',
          quote: 'Avery is addressing missing personas in UAT.',
          stream_ids: ['chunk-uat-stream'],
        },
        {
          meeting_id: 'meeting-five',
          meeting_title: 'Performance testing',
          quote: 'Avery is reviewing test cases before UAT.',
          stream_ids: ['chunk-testing-stream'],
        },
      ],
    );

    expect(result.workstreams).toHaveLength(1);
    expect(
      result.workstreams[0]?.sources.map((source) => source.meeting_id),
    ).toEqual(['meeting-one', 'meeting-two']);
  });
});
