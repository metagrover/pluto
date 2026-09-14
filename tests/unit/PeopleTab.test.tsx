import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PersonBriefingDetail } from '../../src/api/knowledgeGraph';
import {
  PeopleBriefing,
  type PersonBriefingRow,
  PersonDossier,
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
});
