import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PersonBriefingDetail } from '../../src/api/knowledgeGraph';
import {
  PeopleBriefing,
  type PersonBriefingRow,
  PersonDossier,
  formatCommitmentChronology,
} from '../../src/components/KnowledgeGraph/PeopleTab';

const rows: PersonBriefingRow[] = [
  {
    id: 'person-1',
    name: 'Avery Chen',
    role: 'Design lead',
    meetingCount: 4,
    mentionCount: 9,
    latestMeetingId: 'meeting-1',
    latestMeetingTitle: 'Product review',
    latestMeetingAt: '2026-07-12T12:00:00.000Z',
    context: 'Reviewed the rollout sequence and evidence requirements.',
    openCommitmentCount: 2,
    candidateCommitmentCount: 1,
    briefHeadline: 'Avery is preparing the launch handoff.',
    briefStatus: 'up_to_date',
    briefUpdatedAt: '2026-07-12T13:00:00.000Z',
    possibleDuplicateCount: 0,
  },
];

describe('PeopleBriefing', () => {
  it('presents people as compact meeting-style rows', () => {
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={rows} onSelectPerson={() => {}} />,
    );
    expect(markup).not.toContain('Needs you now');
    expect(markup).toContain('Avery is preparing the launch handoff.');
    expect(markup).toContain('2 open loops');
    expect(markup).toContain('1 to confirm');
    expect(markup).toContain('person-row__meeting');
    expect(markup).toContain(
      '<span class="person-copy"><span class="person-identity"><strong>Avery Chen</strong></span><span class="person-context"><span class="person-role">Design lead</span><span>Avery is preparing the launch handoff.</span></span></span>',
    );
    expect(markup).not.toContain('>Open <');
  });

  it('strips redundant person name prefix from the row cue', () => {
    const rowWithPrefix: PersonBriefingRow = {
      ...rows[0],
      name: 'Sarah Chen',
      briefHeadline:
        'Sarah Chen: The conversation centered around design principles.',
    };
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={[rowWithPrefix]} onSelectPerson={() => {}} />,
    );
    expect(markup).toContain(
      'The conversation centered around design principles.',
    );
    expect(markup).not.toContain(
      'Sarah Chen: The conversation centered around design principles.',
    );
  });

  it('renders every linked person in ranked order without a loader', () => {
    const manyRows = Array.from({ length: 12 }, (_, index) => ({
      ...rows[0],
      id: `person-${index}`,
      name: `Person ${index}`,
      openCommitmentCount: index === 9 ? 3 : 0,
      latestMeetingAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={manyRows} onSelectPerson={() => {}} />,
    );

    expect(markup).not.toContain('Needs you now');
    expect(markup).toContain('3 open loops');
    expect(markup).toContain('data-person-id="person-0"');
    expect(markup).toContain('data-person-id="person-11"');
    expect(markup).not.toContain('Show all');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('undefined');
  });

  it('keeps the selected person in the ranked list', () => {
    const manyRows = Array.from({ length: 8 }, (_, index) => ({
      ...rows[0],
      id: `person-${index}`,
      name: `Person ${index}`,
      openCommitmentCount: 0,
      latestMeetingAt: `2026-07-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const markup = renderToStaticMarkup(
      <PeopleBriefing
        rows={manyRows}
        selectedPersonId="person-7"
        onSelectPerson={() => {}}
      />,
    );

    expect(markup).toContain('data-person-id="person-7"');
    expect(markup).toContain('data-selected="true"');
  });

  it('buckets people without linked conversations after active relationships', () => {
    const unlinkedPerson = {
      ...rows[0],
      id: 'person-unlinked',
      name: 'Jordan Lee',
      latestMeetingId: null,
      latestMeetingTitle: null,
      latestMeetingAt: null,
      meetingCount: 0,
    };
    const markup = renderToStaticMarkup(
      <PeopleBriefing
        rows={[rows[0], unlinkedPerson]}
        onSelectPerson={() => {}}
      />,
    );

    expect(markup).toContain('No linked conversations');
    expect(markup.indexOf('data-person-id="person-1"')).toBeLessThan(
      markup.indexOf('No linked conversations'),
    );
    expect(markup.indexOf('data-person-id="person-unlinked"')).toBeGreaterThan(
      markup.indexOf('No linked conversations'),
    );
  });

  it('teaches the surface when no relationship context exists', () => {
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={[]} onSelectPerson={() => {}} />,
    );
    expect(markup).toContain(
      'People will appear as Pluto connects them to conversations.',
    );
  });
});

const briefingDetail: PersonBriefingDetail = {
  person: {
    id: 'person-1',
    type: 'person',
    name: 'Avery Chen',
    normalized_name: 'avery chen',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Design lead' }),
    saliency_score: 0.8,
    domain_tag: 'work',
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-07-12T12:00:00.000Z',
  },
  meetings: [
    {
      id: 'meeting-1',
      title: 'Product review',
      started_at: '2026-07-12T12:00:00.000Z',
      created_at: '2026-07-12T12:00:00.000Z',
      duration_seconds: 3600,
      context: 'Reviewed launch evidence.',
      evidence: 'confirmed',
    },
    {
      id: 'meeting-2',
      title: 'Launch handoff',
      started_at: '2026-07-18T12:00:00.000Z',
      created_at: '2026-07-10T12:00:00.000Z',
      duration_seconds: 1800,
      context: null,
      evidence: 'scheduled',
    },
    {
      id: 'meeting-4',
      title: 'Design handoff',
      started_at: '2026-07-10T12:00:00.000Z',
      created_at: '2026-07-10T12:00:00.000Z',
      duration_seconds: 2700,
      context: 'Reviewed the written handoff.',
      evidence: 'confirmed',
    },
    {
      id: 'meeting-3',
      title: 'Roadmap planning',
      started_at: '2026-07-08T12:00:00.000Z',
      created_at: '2026-07-08T12:00:00.000Z',
      duration_seconds: 2400,
      context: 'Avery was mentioned in the handoff discussion.',
      evidence: 'mentioned',
    },
  ],
  commitments: {
    open: [
      {
        id: 'task-1',
        text: 'Send the final launch review',
        status: 'overdue',
        dueDate: '2026-07-14T12:00:00.000Z',
        evidence: 'Avery: I will send it Monday.',
        sourceMeetingId: 'meeting-1',
        sourceMeetingTitle: 'Product review',
        updatedAt: '2026-07-12T12:00:00.000Z',
      },
    ],
    delivered: [
      {
        id: 'task-2',
        text: 'Shared the prototype walkthrough',
        status: 'completed',
        dueDate: null,
        evidence: 'Avery shared the walkthrough.',
        sourceMeetingId: 'meeting-1',
        sourceMeetingTitle: 'Product review',
        updatedAt: '2026-07-11T12:00:00.000Z',
      },
    ],
    candidates: [
      {
        id: 'candidate-1',
        text: 'Prepare the customer handoff',
        status: 'active',
        dueDate: null,
        evidence: 'Avery can prepare the customer handoff.',
        sourceMeetingId: 'meeting-1',
        sourceMeetingTitle: 'Product review',
        updatedAt: '2026-07-12T12:00:00.000Z',
        suggestedOwnerName: 'Avery Chen',
      },
    ],
  },
  isSelf: false,
  knowledgeDoc: {
    id: 'person-context-1',
    scope_type: 'person_context',
    scope_key: 'person-1',
    title: 'Conversations with Avery Chen',
    rendered_content: null,
    config: null,
    status: 'up_to_date',
    last_synthesized_at: '2026-07-12T13:00:00.000Z',
    last_source_cursor: null,
    updated_at: '2026-07-12T13:00:00.000Z',
    structured_json: JSON.stringify({
      schema_version: 2,
      scope: { type: 'person_context', title: 'Avery Chen' },
      current_read: {
        headline: 'Avery is coordinating the launch handoff.',
        supporting_bullets: [],
        freshness: 'fresh',
        source_count: 2,
        cited_item_count: 1,
        cited_meeting_count: 2,
        trust_message: 'Grounded in two confirmed conversations.',
        evidence_quality: {
          mode: 'direct',
          confidence: 0.9,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: '2026-07-12T12:00:00.000Z',
          freshness: 'fresh',
        },
      },
      active_streams: [],
      needs_attention: [],
      patterns: [
        {
          id: 'pattern-1',
          title: 'Prefers written review before handoff',
          summary: 'A written review helps Avery close the handoff cleanly.',
          kind: 'pattern',
          severity: 'steady',
          why_now: 'Repeated across handoffs.',
          stream_ids: [],
          citations: [
            {
              meeting_id: 'meeting-1',
              quote: 'Send the review first.',
            },
            {
              meeting_id: 'meeting-4',
              quote: 'The written review keeps the handoff clear.',
            },
          ],
          evidence_quality: {
            mode: 'direct',
            confidence: 0.9,
            cited_meeting_count: 2,
            source_count: 2,
            last_reinforced_at: '2026-07-12T12:00:00.000Z',
            freshness: 'fresh',
          },
        },
      ],
      risks_and_unknowns: [],
      evidence_index: [
        {
          id: 'evidence-1',
          meeting_id: 'meeting-1',
          meeting_title: 'Product review',
          captured_at: '2026-07-12T12:00:00.000Z',
          quote: 'Send the review first.',
          stream_ids: [],
          item_ids: ['pattern-1'],
          mode: 'direct',
          confidence: 0.9,
        },
        {
          id: 'evidence-2',
          meeting_id: 'meeting-4',
          meeting_title: 'Design handoff',
          captured_at: '2026-07-10T12:00:00.000Z',
          quote: 'The written review keeps the handoff clear.',
          stream_ids: [],
          item_ids: ['pattern-1'],
          mode: 'direct',
          confidence: 0.9,
        },
      ],
      source_quality_summary: {
        included_count: 2,
        excluded_count: 0,
        weak_count: 0,
        records: [],
      },
      change_summary: {
        generated_at: '2026-07-12T13:00:00.000Z',
        added_count: 1,
        removed_count: 0,
        updated_count: 0,
        notable_changes: [],
      },
    }),
  },
  workingMemorySnapshot: null,
};

describe('PersonDossier', () => {
  it('shows a concise description, verified commitments, and meetings', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('Avery is coordinating the launch handoff.');
    expect(markup).toContain('Commitments');
    expect(markup).toContain('Send the final launch review');
    expect(markup).toContain('Meetings');
    expect(markup).toContain('Product review');
    expect(markup).not.toContain('Current read');
    expect(markup).not.toContain('Recent patterns');
    expect(markup).not.toContain('Prefers written review before handoff');
    expect(markup).toContain('More commitments');
    expect(markup).toContain('Needs confirmation');
    expect(markup).toContain('Confirm owner');
    expect(markup).toContain('Not theirs');
    expect(markup).toContain('Delivered');
    expect(markup).not.toContain('Conversations');
    expect(markup).not.toContain('Evidence and participation are labeled');
    expect(markup).toContain('Participation not confirmed');
  });

  it('explains missing context without implying meeting participation', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={{
          ...briefingDetail,
          meetings: briefingDetail.meetings.filter(
            (meeting) => meeting.evidence !== 'confirmed',
          ),
          commitments: { open: [], delivered: [], candidates: [] },
          knowledgeDoc: null,
        }}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain(
      'There is not enough verified context to describe this person yet.',
    );
    expect(markup).toContain('No verified commitments.');
    expect(markup).toContain('No confirmed meetings yet.');
    expect(markup).toContain('Other meeting links');
    expect(markup).not.toContain('No confirmed conversations yet');
    expect(markup).not.toContain('No scheduled conversations');
    expect(markup).not.toContain('No mention-only conversations');
  });

  it('renders temporal provenance and meeting link for working context', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('Product review');
    expect(markup).toContain('From');
    expect(markup).toContain('Captured during past conversations');
  });

  it('renders custom back label when returning from meeting context', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        backLabel="Back to Product review"
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('Back to Product review');
  });

  it('renders temporal section heading and outdated option in PersonDossier', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    // Shows temporal heading
    expect(markup).toMatch(/(?:Recent Focus|Historical Context|Active Focus)/);
    // Shows Mark context as outdated button in More dropdown
    expect(markup).toContain('Mark context as outdated');
  });

  it('renders "What this person has been up to" activity insight and touchpoints', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('What Avery has been up to');
    expect(markup).toContain('Recent Activity Insight');
    expect(markup).toContain('Avery is coordinating the launch handoff.');
    expect(markup).toContain('Product review');
    expect(markup).toContain('Design handoff');
    expect(markup).toContain('Shared the prototype walkthrough');
    expect(markup).toContain('Send the final launch review');
  });

  it('renders comprehensive insight and structured workstream cards without leaking manual participant', () => {
    const ayushDetail: PersonBriefingDetail = {
      ...briefingDetail,
      person: {
        ...briefingDetail.person,
        id: 'person-ayush',
        name: 'Ayush',
      },
      knowledgeDoc: {
        ...briefingDetail.knowledgeDoc!,
        structured_json: JSON.stringify({
          schema_version: 2,
          current_read: {
            headline: 'Focus on Performance Optimization',
            supporting_bullets: [
              'API Performance & Infrastructure: Working on API performance and S3 migration.',
              'Infrastructure & Monitoring: Transitioning to new monitoring tools.',
            ],
            freshness: 'fresh',
            source_count: 2,
            cited_item_count: 1,
            cited_meeting_count: 2,
            trust_message: 'Verified',
            evidence_quality: {
              mode: 'direct',
              confidence: 0.9,
              cited_meeting_count: 2,
              source_count: 2,
              last_reinforced_at: '2026-07-12T12:00:00.000Z',
              freshness: 'fresh',
            },
          },
          active_streams: [
            {
              id: 's1',
              title: 'API Performance & Infrastructure',
              current_read: 'Working on API performance and S3 migration.',
              domain: 'eng',
              status: 'active',
              last_touched_at: '2026-07-12T12:00:00.000Z',
              source_count: 2,
              open_follow_up_count: 0,
              decision_count: 0,
              unresolved_question_count: 0,
              pinned: false,
              evidence_quality: {
                mode: 'direct',
                confidence: 0.9,
                cited_meeting_count: 2,
                source_count: 2,
                last_reinforced_at: '2026-07-12T12:00:00.000Z',
                freshness: 'fresh',
              },
            },
            {
              id: 's2',
              title: 'Infrastructure & Monitoring',
              current_read: 'Transitioning to new monitoring tools.',
              domain: 'eng',
              status: 'active',
              last_touched_at: '2026-07-12T12:00:00.000Z',
              source_count: 2,
              open_follow_up_count: 0,
              decision_count: 0,
              unresolved_question_count: 0,
              pinned: false,
              evidence_quality: {
                mode: 'direct',
                confidence: 0.9,
                cited_meeting_count: 2,
                source_count: 2,
                last_reinforced_at: '2026-07-12T12:00:00.000Z',
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
        }),
      },
      meetings: [
        {
          id: 'meeting-nct',
          title: 'NCT Daily Check-in',
          started_at: '2026-07-12T12:00:00.000Z',
          created_at: '2026-07-12T12:00:00.000Z',
          duration_seconds: 1800,
          context: 'Manual participant',
          evidence: 'confirmed',
        },
        {
          id: 'meeting-uat',
          title: 'UAT Development and Production Release Strategy',
          started_at: '2026-07-10T12:00:00.000Z',
          created_at: '2026-07-10T12:00:00.000Z',
          duration_seconds: 2700,
          context: null,
          evidence: 'confirmed',
        },
      ],
      commitments: {
        open: [
          {
            id: 'commit-1',
            text: 'Clean up and push the backend configuration PR',
            status: 'active',
            dueDate: null,
            evidence: null,
            sourceMeetingId: 'meeting-uat',
            sourceMeetingTitle: 'UAT Development',
            updatedAt: '2026-07-12T12:00:00.000Z',
          },
        ],
        delivered: [],
        candidates: [],
      },
    };

    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={ayushDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    // Verifies workstream cards
    expect(markup).toContain('Active Workstreams &amp; Initiatives');
    expect(markup).toContain('API Performance &amp; Infrastructure');
    expect(markup).toContain('Infrastructure &amp; Monitoring');

    // Verifies comprehensive insight prose
    expect(markup).toContain('What Ayush has been up to');
    expect(markup).toContain(
      'Ayush is currently focused on performance optimization.',
    );
    expect(markup).toContain(
      'Key initiatives include API Performance &amp; Infrastructure and Infrastructure &amp; Monitoring.',
    );
    expect(markup).toContain('Clean up and push the backend configuration PR');

    // Verifies that administrative "manual participant" is completely filtered out of the UI
    expect(markup).not.toContain('manual participant');
    expect(markup).not.toContain('(manual participant)');
  });
});

describe('formatCommitmentChronology', () => {
  it('formats overdue, lingering, and completed commitments with clear chronology', () => {
    const now = Date.parse('2026-09-15T12:00:00Z');

    // Overdue item
    const overdueItem = {
      id: 'c1',
      text: 'Send API docs',
      status: 'active' as const,
      dueDate: '2026-08-01T00:00:00Z', // 45d overdue (~6 weeks)
      evidence: null,
      sourceMeetingId: 'm1',
      sourceMeetingTitle: 'API Sync',
      updatedAt: '2026-07-20T00:00:00Z',
    };
    const overdueResult = formatCommitmentChronology(overdueItem, now);
    expect(overdueResult.isOverdue).toBe(true);
    expect(overdueResult.label).toContain('6w overdue');

    // Lingering loop without due date (>45 days)
    const lingeringItem = {
      id: 'c2',
      text: 'Align with design',
      status: 'active' as const,
      dueDate: null,
      evidence: null,
      sourceMeetingId: 'm1',
      sourceMeetingTitle: 'Design review',
      updatedAt: '2026-07-15T00:00:00Z', // 62d ago (~2 months)
    };
    const lingeringResult = formatCommitmentChronology(lingeringItem, now);
    expect(lingeringResult.isLingering).toBe(true);
    expect(lingeringResult.label).toContain('Lingering loop · Agreed 2mo ago');

    // Recent open item (2 weeks ago)
    const recentItem = {
      id: 'c3',
      text: 'Update staging',
      status: 'active' as const,
      dueDate: null,
      evidence: null,
      sourceMeetingId: 'm1',
      sourceMeetingTitle: 'Dev Sync',
      updatedAt: '2026-09-01T00:00:00Z', // 14d ago (~2 weeks)
    };
    const recentResult = formatCommitmentChronology(recentItem, now);
    expect(recentResult.label).toBe('Agreed 2w ago');

    // Completed item with duration
    const completedItem = {
      id: 'c4',
      text: 'Deploy hotfix',
      status: 'completed' as const,
      dueDate: null,
      evidence: null,
      sourceMeetingId: 'm1',
      sourceMeetingTitle: 'Incident postmortem',
      updatedAt: '2026-08-25T00:00:00Z', // 21d ago (3 weeks)
    };
    const completedResult = formatCommitmentChronology(completedItem, now);
    expect(completedResult.label).toBe('Completed 3w ago');
  });
});
