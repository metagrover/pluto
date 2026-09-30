import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PersonBriefingDetail } from '../../src/api/knowledgeGraph';
import {
  PeopleBriefing,
  type PersonBriefingRow,
  PersonDossier,
  formatCommitmentChronology,
  isRegularCollaborator,
  sortPeopleRows,
} from '../../src/components/KnowledgeGraph/PeopleTab';

const rows: PersonBriefingRow[] = [
  {
    id: 'person-1',
    name: 'Avery Chen',
    role: 'Design lead',
    roleSourceMeetingId: 'meeting-1',
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
    expect(markup).toContain('Latest link: Product review');
    expect(markup).not.toContain('Avery is preparing the launch handoff.');
    expect(markup).toContain('2 open loops');
    expect(markup).toContain('1 to confirm');
    expect(markup).toContain('person-row__meeting');
    expect(markup).toContain(
      '<span class="person-copy"><span class="person-identity"><strong>Avery Chen</strong></span><span class="person-context"><span class="person-role">Design lead</span><span>Latest link: Product review</span></span></span>',
    );
    expect(markup).not.toContain('>Open <');
  });

  it('does not promote an old brief or uncited role into a directory fact', () => {
    const rowWithOldBrief: PersonBriefingRow = {
      ...rows[0],
      name: 'Sarah Chen',
      roleSourceMeetingId: null,
      briefHeadline:
        'Sarah Chen: The conversation centered around design principles.',
    };
    const markup = renderToStaticMarkup(
      <PeopleBriefing rows={[rowWithOldBrief]} onSelectPerson={() => {}} />,
    );
    expect(markup).toContain('Latest link: Product review');
    expect(markup).not.toContain('The conversation centered around');
    expect(markup).not.toContain('person-role');
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

  it('groups regular collaborators at the top and occasional conversations below', () => {
    const regularPerson: PersonBriefingRow = {
      ...rows[0],
      id: 'person-regular',
      name: 'Maya Lin',
      meetingCount: 5,
      latestMeetingAt: '2026-07-15T12:00:00.000Z',
    };
    const occasionalPerson: PersonBriefingRow = {
      ...rows[0],
      id: 'person-occasional',
      name: 'Devon Ray',
      meetingCount: 1,
      latestMeetingAt: '2026-07-14T12:00:00.000Z',
    };
    const unlinkedPerson: PersonBriefingRow = {
      ...rows[0],
      id: 'person-unlinked',
      name: 'Sam Taylor',
      meetingCount: 0,
      latestMeetingAt: null,
    };

    const markup = renderToStaticMarkup(
      <PeopleBriefing
        rows={[occasionalPerson, unlinkedPerson, regularPerson]}
        onSelectPerson={() => {}}
      />,
    );

    expect(markup).toContain('Regular collaborators');
    expect(markup).toContain('Other conversations');
    expect(markup).toContain('Unlinked contacts');

    // Regular collaborator appears before Other conversations section
    const regularIdx = markup.indexOf('data-person-id="person-regular"');
    const otherHeadingIdx = markup.indexOf('Other conversations');
    const occasionalIdx = markup.indexOf('data-person-id="person-occasional"');
    const unlinkedIdx = markup.indexOf('data-person-id="person-unlinked"');

    expect(regularIdx).toBeLessThan(otherHeadingIdx);
    expect(otherHeadingIdx).toBeLessThan(occasionalIdx);
    expect(occasionalIdx).toBeLessThan(unlinkedIdx);
  });

  it('sorts people primarily by recency of conversation rather than stale open commitments', () => {
    const recentPerson: PersonBriefingRow = {
      ...rows[0],
      id: 'person-recent',
      name: 'Elena Rostova',
      meetingCount: 3,
      openCommitmentCount: 0,
      latestMeetingAt: '2026-07-20T12:00:00.000Z',
    };
    const olderPersonWithTask: PersonBriefingRow = {
      ...rows[0],
      id: 'person-task',
      name: 'Marcus Vance',
      meetingCount: 3,
      openCommitmentCount: 5,
      latestMeetingAt: '2026-06-01T12:00:00.000Z',
    };

    const sorted = sortPeopleRows([olderPersonWithTask, recentPerson]);
    expect(sorted[0].id).toBe('person-recent');
    expect(sorted[1].id).toBe('person-task');
  });

  it('identifies regular collaborators based on frequency and recency', () => {
    const referenceNow = Date.parse('2026-07-15T12:00:00.000Z');

    // 3+ meetings is always regular
    expect(
      isRegularCollaborator(
        {
          ...rows[0],
          meetingCount: 3,
          latestMeetingAt: '2026-01-01T00:00:00.000Z',
        },
        referenceNow,
      ),
    ).toBe(true);

    // 2 meetings within 60 days is regular
    expect(
      isRegularCollaborator(
        {
          ...rows[0],
          meetingCount: 2,
          latestMeetingAt: '2026-07-01T00:00:00.000Z',
        },
        referenceNow,
      ),
    ).toBe(true);

    // 2 meetings older than 60 days is not regular
    expect(
      isRegularCollaborator(
        {
          ...rows[0],
          meetingCount: 2,
          latestMeetingAt: '2026-03-01T00:00:00.000Z',
        },
        referenceNow,
      ),
    ).toBe(false);

    // 1 meeting is not regular
    expect(
      isRegularCollaborator(
        {
          ...rows[0],
          meetingCount: 1,
          latestMeetingAt: '2026-07-15T00:00:00.000Z',
        },
        referenceNow,
      ),
    ).toBe(false);

    // 0 meetings is not regular
    expect(
      isRegularCollaborator(
        { ...rows[0], meetingCount: 0, latestMeetingAt: null },
        referenceNow,
      ),
    ).toBe(false);
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
  recentActivity: [
    {
      text: 'Avery Chen revised the launch handoff after the product review.',
      meetingId: 'meeting-1',
      meetingTitle: 'Product review',
      occurredAt: '2026-07-12T12:00:00.000Z',
      evidence: 'confirmed',
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
    last_synthesized_at: '2026-07-18T13:00:00.000Z',
    last_source_cursor: null,
    updated_at: '2026-07-18T13:00:00.000Z',
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
      active_streams: [
        {
          id: 'launch-work',
          title: 'Launch handoffs',
          domain: 'work',
          status: 'active',
          current_read:
            'Avery reviewed the written handoff with the team (208a5a10-c557-4624-bfcb-4480e22cb882).',
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
          quote: 'Avery reviewed the launch handoff.',
          stream_ids: ['launch-work'],
          item_ids: ['pattern-1'],
          mode: 'direct',
          confidence: 0.9,
        },
        {
          id: 'evidence-2',
          meeting_id: 'meeting-4',
          meeting_title: 'Design handoff',
          captured_at: '2026-07-10T12:00:00.000Z',
          quote: 'Avery worked on the written handoff.',
          stream_ids: ['launch-work'],
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
  it('leads with a sourced person summary after the new synthesis completes', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={{
          ...briefingDetail,
          knowledgeDoc: {
            ...briefingDetail.knowledgeDoc!,
            config: JSON.stringify({ synthesis_version: 6 }),
          },
        }}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup.indexOf('What they work on')).toBeLessThan(
      markup.indexOf('Recent developments'),
    );
    expect(markup).toContain(
      'Avery Chen has worked on launch handoffs across multiple conversations.',
    );
    expect(markup).toContain('Based on 2 cited conversations');
    expect(markup).toContain('through Jul 12');
    expect(markup).not.toContain('through Jul 18');
    expect(markup.indexOf('Discussed Jul 12')).toBeLessThan(
      markup.indexOf('Avery reviewed the launch handoff.'),
    );
    expect(markup.indexOf('Avery reviewed the launch handoff.')).toBeLessThan(
      markup.indexOf('Product review'),
    );
    expect(markup.indexOf('Discussed Jul 10')).toBeLessThan(
      markup.indexOf('Avery worked on the written handoff.'),
    );
    expect(markup.indexOf('Avery worked on the written handoff.')).toBeLessThan(
      markup.indexOf('Design handoff'),
    );
    expect(markup).not.toContain('One example:');
    expect(markup).not.toContain('Recurring work');
    expect(markup).not.toContain('208a5a10');
    expect(markup).not.toContain('Earlier context');
  });

  it('keeps the prior cited summary visible while a refresh is compiling', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={{
          ...briefingDetail,
          knowledgeDoc: {
            ...briefingDetail.knowledgeDoc!,
            status: 'synthesizing',
            config: JSON.stringify({ synthesis_version: 6 }),
          },
        }}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );
    expect(markup).not.toContain('Recurring work');
    expect(markup).toContain(
      'Avery Chen has worked on launch handoffs across multiple conversations.',
    );
    expect(markup).not.toContain('Avery is coordinating the launch handoff.');
  });

  it('uses the durable person snapshot while a saved draft is incomplete', () => {
    const completed = JSON.parse(briefingDetail.knowledgeDoc!.structured_json!);
    const marker = briefingDetail.knowledgeDoc!.last_synthesized_at;
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={{
          ...briefingDetail,
          knowledgeDoc: {
            ...briefingDetail.knowledgeDoc!,
            status: 'synthesizing',
            config: JSON.stringify({ synthesis_version: 7 }),
            structured_json: JSON.stringify({ headline: 'Incomplete draft' }),
          },
          workingMemorySnapshot: {
            id: 'snapshot-1',
            scope_type: 'person_context',
            scope_key: 'person-1',
            title: 'Conversations with Avery Chen',
            source_doc_id: 'person-context-1',
            source_doc_last_synthesized_at: marker,
            freshness: 'fresh',
            trust_status: 'grounded',
            source_count: 2,
            cited_meeting_count: 2,
            generated_at: marker!,
            updated_at: marker!,
            payload: {
              schema_version: 1,
              scope: {
                type: 'person_context',
                key: 'person-1',
                title: 'Conversations with Avery Chen',
              },
              source: {
                knowledge_doc_id: 'person-context-1',
                knowledge_doc_last_synthesized_at: marker,
              },
              current_read: {
                ...completed.current_read,
                trust_status: 'grounded',
              },
              active_streams: completed.active_streams,
              open_loops: completed.needs_attention,
              patterns: completed.patterns,
              risks_and_unknowns: completed.risks_and_unknowns,
              evidence_index: completed.evidence_index,
            },
          },
        }}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain(
      'Avery Chen has worked on launch handoffs across multiple conversations.',
    );
    expect(markup).not.toContain('Incomplete draft');
  });

  it('suppresses the earlier broad-meeting summary until person-specific synthesis replaces it', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={{
          ...briefingDetail,
          knowledgeDoc: {
            ...briefingDetail.knowledgeDoc!,
            config: JSON.stringify({ synthesis_version: 5 }),
          },
        }}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('Recent work we can verify');
    expect(markup).toContain('Avery Chen revised the launch handoff');
    expect(markup).not.toContain('Avery is coordinating the launch handoff.');
    expect(markup).not.toContain('Earlier context');
  });

  it('pairs work from distinct conversations with its source while a summary is pending', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={{
          ...briefingDetail,
          knowledgeDoc: null,
          recentActivity: [
            {
              text: 'Avery Chen noted the team might change the review process.',
              meetingId: 'meeting-1',
              meetingTitle: 'Product review',
              occurredAt: '2026-07-12T12:00:00.000Z',
              evidence: 'confirmed',
            },
            {
              text: 'Avery Chen will revise the launch handoff.',
              meetingId: 'meeting-1',
              meetingTitle: 'Product review',
              occurredAt: '2026-07-12T12:00:00.000Z',
              evidence: 'confirmed',
            },
            {
              text: 'Avery will coordinate the design review.',
              meetingId: 'meeting-4',
              meetingTitle: 'Design handoff',
              occurredAt: '2026-07-10T12:00:00.000Z',
              evidence: 'confirmed',
            },
          ],
        }}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup.indexOf('Avery Chen will revise')).toBeLessThan(
      markup.indexOf('Commitments'),
    );
    expect(markup.indexOf('Avery will coordinate')).toBeLessThan(
      markup.indexOf('Commitments'),
    );
    expect(markup.indexOf('Product review')).toBeGreaterThan(
      markup.indexOf('Avery Chen will revise'),
    );
    expect(markup.indexOf('Product review')).toBeLessThan(
      markup.indexOf('Avery will coordinate'),
    );
    expect(markup).not.toContain('Avery Chen noted');
    expect(markup).not.toContain('Recent developments');
    expect(markup.match(/>Discussed Jul 12</g)).toHaveLength(1);
  });

  it('shows a concise description, verified commitments, and meetings', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).not.toContain('Avery is coordinating the launch handoff.');
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
          recentActivity: [],
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

  it('does not present an older unverified brief as person context', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain('Product review');
    expect(markup).not.toContain('Brief evidence · Jul 12');
    expect(markup).not.toContain('Avery is coordinating the launch handoff.');
    expect(markup).not.toContain('Earlier context');
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
    expect(markup).toContain('Recent work we can verify');
    expect(markup).toContain('From person-specific meeting notes');
    expect(markup).not.toContain('Earlier context');
    // Shows Mark context as outdated button in More dropdown
    expect(markup).toContain('Mark context as outdated');
  });

  it('leads with sourced work and keeps history and commitments available', () => {
    const markup = renderToStaticMarkup(
      <PersonDossier
        detail={briefingDetail}
        onBack={() => {}}
        onOpenMeeting={() => {}}
      />,
    );

    expect(markup).toContain(
      'Avery Chen revised the launch handoff after the product review.',
    );
    expect(markup.indexOf('Recent work we can verify')).toBeLessThan(
      markup.indexOf('Avery Chen revised the launch handoff'),
    );
    expect(markup.match(/Avery Chen revised the launch handoff/g)).toHaveLength(
      1,
    );
    expect(markup).not.toContain('Avery is coordinating the launch handoff.');
    expect(markup).toContain('Product review');
    expect(markup).toContain('Design handoff');
    expect(markup).toContain('Shared the prototype walkthrough');
    expect(markup).toContain('Send the final launch review');
  });

  it('hides old workstream claims without leaking manual participant', () => {
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

    expect(markup).not.toContain('Previously discussed workstreams');
    expect(markup).not.toContain('API Performance &amp; Infrastructure');
    expect(markup).not.toContain('Infrastructure &amp; Monitoring');

    // Verifies comprehensive insight prose
    expect(markup).not.toContain(
      'is currently focused on performance optimization',
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
