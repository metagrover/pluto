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
    expect(isCurrentPersonDossier('up_to_date', 10)).toBe(false);
    expect(isCurrentPersonDossier('up_to_date', 11)).toBe(false);
    expect(isCurrentPersonDossier('synthesizing', 12)).toBe(false);
    expect(isCurrentPersonDossier('up_to_date', 12)).toBe(false);
    expect(isCurrentPersonDossier('up_to_date', 13)).toBe(true);
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

  it('uses a concise model read only when every factual word appears in the cited sources', () => {
    const sources = [
      {
        meeting_id: 'meeting-one',
        meeting_title: 'Query review',
        quote: 'Avery is improving query performance for the pipeline.',
        stream_ids: ['query'],
      },
      {
        meeting_id: 'meeting-two',
        meeting_title: 'Pipeline review',
        quote: 'Avery is optimizing queries in the pipeline.',
        stream_ids: ['query'],
      },
    ];
    const stream = {
      id: 'query',
      title: 'Query and Pipeline Optimization',
      current_read:
        'Avery is improving query performance and optimizing the pipeline.',
    };

    expect(buildPersonDossierRead('Avery', [stream], sources).headline).toBe(
      stream.current_read,
    );
    expect(
      buildPersonDossierRead(
        'Avery',
        [{ ...stream, current_read: 'Avery leads query performance work.' }],
        sources,
      ).headline,
    ).toBe(
      'Avery has worked on query and pipeline optimization across multiple conversations.',
    );
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

  it('does not call unrelated reviews a recurring area of work', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [
        {
          id: 'review',
          title: 'ECI data review',
          current_read: 'Avery reviews ECI data.',
        },
      ],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Data check',
          quote:
            'Avery will review specific ECIs to check where data is missing.',
          stream_ids: ['review'],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Interface check',
          quote:
            'Avery will review the tenure field and the shared HTML code today.',
          stream_ids: ['review'],
        },
      ],
    );

    expect(result.headline).toBeNull();
    expect(result.workstreams).toEqual([]);
  });

  it('summarizes a narrow repeated activity from separate person-specific notes', () => {
    const activity = [
      {
        meeting_id: 'meeting-two',
        meeting_title: 'Technical check-in',
        captured_at: '2026-09-23T12:00:00.000Z',
        quote: 'Avery is preparing SQL queries for the report.',
        stream_ids: [],
      },
      {
        meeting_id: 'meeting-one',
        meeting_title: 'Data review',
        captured_at: '2026-09-22T12:00:00.000Z',
        quote: 'Avery is working to replace stale views with reliable queries.',
        stream_ids: [],
      },
    ];
    const result = buildPersonDossierRead('Avery', [], [], activity);

    expect(result.headline).toBe(
      'Recent conversations show Avery working on queries.',
    );
    expect(
      result.workstreams[0]?.sources.map((source) => source.meeting_id),
    ).toEqual(['meeting-two', 'meeting-one']);
  });

  it('does not infer a shared work area from a repeated collaborator name', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [],
      [],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Interface review',
          quote: 'Avery worked with Jordan on the onboarding layout.',
          stream_ids: [],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Launch review',
          quote: 'Avery worked with Jordan on the announcement email.',
          stream_ids: [],
        },
      ],
    );

    expect(result.headline).toBeNull();
  });

  it('keeps repeated direct evidence when a broad stream title omits its shared topic', () => {
    const result = buildPersonDossierRead(
      'Avery',
      [
        {
          id: 'interface',
          title: 'Interface and Data Validation',
          current_read: 'Avery is refining the tenure field in the UI.',
        },
      ],
      [
        {
          meeting_id: 'meeting-one',
          meeting_title: 'Interface review',
          quote: 'Avery added the client tenure to the UI.',
          stream_ids: ['interface'],
        },
        {
          meeting_id: 'meeting-two',
          meeting_title: 'Field review',
          quote: 'Avery will review the tenure field.',
          stream_ids: ['interface'],
        },
      ],
    );

    expect(result.workstreams).toHaveLength(1);
    expect(result.workstreams[0]?.sources).toHaveLength(2);
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
