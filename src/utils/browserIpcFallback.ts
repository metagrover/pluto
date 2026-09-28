import type {
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from '../../electron/calendar/types';
import {
  applyMeetingNotesTemplateSettingsUpdate,
  createMeetingNotesTemplateSettingsSnapshot,
} from '../../electron/llm/meetingNotesTemplates';
import type { MeetingPrep } from '../../electron/meetingPrep';
import { prepRoster } from '../../electron/prepAttendees';
import type { PrepAttendee } from '../../electron/prepAttendees';
import type { KnowledgeDoc } from '../api/knowledgeDocs';
import type {
  Entity,
  EntityMeeting,
  KnowledgeGraphStats,
  PersonBriefingDetail,
} from '../api/knowledgeGraph';
import type { KnowledgeWorkspacePayload } from '../api/knowledgeWorkspace';
import type { LocalArtifact } from '../api/localArtifacts';
import type { Meeting } from '../types';
import { hasVerifiedSpeakerAttribution } from './speakerAttributionTrust';

type IpcRendererLike = Window['ipcRenderer'];
type BrowserCaptureJournal = {
  activityEvidence?: unknown;
  schemaVersion: 3;
  generation: string;
  revision: number;
  supported: false;
};

const now = new Date().toISOString();
const previewLocalArtifacts: LocalArtifact[] = [
  {
    id: 'preview-local-source',
    type: 'markdown',
    title: 'Launch research notes',
    captured_at: '2026-09-18T17:30:00.000Z',
    imported_at: '2026-09-19T09:15:00.000Z',
    original_path: '/Users/you/Documents/Launch research notes.md',
    content_hash: 'preview-source-revision',
    extracted_text:
      'Customer research supports a staged launch and a support-owned announcement.',
    metadata_json: '{"extension":".md"}',
    source_quality: 'usable',
    trust_status: 'grounded',
    status: 'active',
    created_at: '2026-09-19T09:15:00.000Z',
    updated_at: '2026-09-19T09:15:00.000Z',
  },
];
let meetingNotesTemplateSettings = createMeetingNotesTemplateSettingsSnapshot(
  'auto',
  {},
);

const previewCalendar = {
  identifier: 'preview-work',
  title: 'Work',
  sourceTitle: 'iCloud',
  sourceType: 'calDAV',
  colorHex: '#6478D3',
};

const previewCalendarSnapshot: CalendarIntegrationSnapshot = {
  state: 'ready',
  authorization: 'full_access',
  enabled: true,
  selectedCalendar: previewCalendar,
  selectedCalendars: [previewCalendar],
  calendars: [previewCalendar],
  lastAttemptAt: now,
  lastReadAt: now,
  cacheStart: now,
  cacheEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  stale: false,
};

const previewCalendarEvents = (): CalendarEvent[] => {
  const atToday = (hour: number, minute: number, durationMinutes: number) => {
    const start = new Date();
    start.setHours(hour, minute, 0, 0);
    if (start.getTime() < Date.now() - 30 * 60_000) {
      start.setTime(Date.now() + (hour === 10 ? 45 : 150) * 60_000);
    }
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return { start: start.toISOString(), end: end.toISOString() };
  };
  const pricingReview = atToday(10, 30, 45);
  const acmeSync = atToday(13, 0, 30);
  const setupReview = atToday(15, 30, 30);
  const build = (
    key: string,
    title: string,
    interval: { start: string; end: string },
    attendees: string[],
  ): CalendarEvent => ({
    occurrenceKey: key,
    eventIdentifier: key,
    calendarIdentifier: 'preview-work',
    title,
    start: interval.start,
    end: interval.end,
    isAllDay: false,
    isCancelled: false,
    availability: 'busy',
    organizer: { name: 'You', email: null },
    attendees: attendees.map((name) => ({ name, email: null })),
    lastModified: now,
    calendarItemExternalIdentifier: key,
    hasRecurrenceRules: key.includes('weekly'),
    recurrenceRules: key.includes('weekly')
      ? [
          {
            frequency: 'weekly',
            interval: 1,
            daysOfWeek: [2],
            endDate: null,
            occurrenceCount: null,
          },
        ]
      : [],
    seriesKey: key.includes('weekly') ? `preview-work|${key}` : null,
    agenda:
      key === 'preview-pricing-review'
        ? 'Agree on team pricing\nConfirm launch dates and customer trials'
        : null,
  });
  return [
    build(
      'preview-pricing-review',
      'Q4 Launch & Customer Pricing',
      pricingReview,
      ['Maya', 'David', 'Alex'],
    ),
    build('preview-acme-sync', 'Acme Corp Customer Sync', acmeSync, [
      'David',
      'Sarah',
    ]),
    build('preview-setup-review', 'Simple Team Setup Review', setupReview, [
      'Avery',
    ]),
  ];
};

const meetingPreviewEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const p = new URLSearchParams(window?.location?.search || '').get('preview');
  return (
    p === 'meeting' ||
    p === 'dashboard' ||
    p === 'chat' ||
    p === 'people' ||
    p === 'projects'
  );
};

export const previewMeeting: Meeting = {
  id: 'preview-pricing-review',
  title: 'Q4 Launch & Customer Pricing',
  meeting_type: 'Recording',
  created_at: now,
  started_at: now,
  duration_seconds: 42 * 60,
  finalization_status: 'finalized',
  transcript_status: 'validated',
  transcript_validated_at: now,
  user_notes:
    'Agree on team pricing, confirm the launch date, and check customer trial plans.',
  transcript_json: JSON.stringify({
    lifecycleStatus: 'validated',
    segments: [
      {
        speaker: 'Maya Chen',
        start: 120,
        end: 145,
        text: "Based on customer feedback, let's set the team price at $45 per seat and keep the basic plan at $20 so new teams can try it easily.",
      },
      {
        speaker: 'David Kim',
        start: 160,
        end: 182,
        text: 'That fits what customers are asking for. Acme Corp is ready to start their 30-day trial next week.',
      },
      {
        speaker: 'Alex Rivera',
        start: 210,
        end: 230,
        text: 'The setup for team accounts is ready in testing. We can launch it on October 1st.',
      },
      {
        speaker: 'Avery Taylor',
        start: 250,
        end: 272,
        text: 'We also made inviting team members much simpler. It now takes less than two minutes.',
      },
    ],
  }),
  analysis_schema_version: 3,
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview:
      'The team agreed on pricing and launch dates. Team plans will cost $45 per seat, and the basic plan will stay at $20. Acme Corp will start their trial next week, and the new setup will go live on October 1st.',
    all_decisions: [
      {
        text: 'Set team plan price at $45 per seat with simple setup included.',
        decided_by: 'Maya Chen',
        evidence:
          "Maya Chen: Based on customer feedback, let's set the team price at $45 per seat and keep the basic plan at $20 so new teams can try it easily.",
      },
      {
        text: 'Keep basic plan at $20 so small teams can start quickly.',
        decided_by: 'Maya Chen',
        evidence:
          'Maya Chen: ...and keep the basic plan at $20 so new teams can try it easily.',
      },
      {
        text: 'Launch the new team setup on October 1st.',
        decided_by: 'Alex Rivera',
        evidence:
          'Alex Rivera: The setup for team accounts is ready in testing. We can launch it on October 1st.',
      },
    ],
    all_action_items: [
      {
        text: 'Send the new pricing sheet to Sarah in sales',
        assignee: 'You',
        due: 'Thursday',
        topic: 'Customer Pricing',
      },
      {
        text: 'Finish testing the team invite steps',
        assignee: 'Avery Taylor',
        due: 'Today',
        topic: 'Team Setup',
      },
      {
        text: 'Confirm launch date with the Acme Corp team',
        assignee: 'David Kim',
        due: 'Friday',
        topic: 'Customer Trials',
      },
    ],
    recent_win: {
      win: 'New team setup time cut by half',
      why_it_counts:
        'New teams can now set up their accounts and invite members in under three minutes.',
      evidence: 'Tested with eight customer teams with no drop-offs.',
      source: 'Q4 Launch & Customer Pricing',
      owner: 'Product & Design',
      ownership: 'shared',
    },
    topics: [
      {
        title: 'Team Pricing & Plans',
        summary:
          'The team agreed to set the team plan at $45 per seat and keep the basic plan at $20.',
        key_points: [
          { text: 'Team plan includes fast support and member invites.' },
          { text: 'Basic plan stays at $20 for single users.' },
        ],
        decisions: [],
        action_items: [],
        open_questions: [
          'Should we offer an annual discount for small businesses?',
        ],
        transcript_range: [0, 2],
      },
      {
        title: 'Customer Trial & Launch Date',
        summary:
          'Acme Corp starts testing next week, and public launch is set for October 1st.',
        key_points: [
          { text: 'Acme Corp will test with 120 team members.' },
          { text: 'Engineering confirmed the system is ready for launch.' },
        ],
        decisions: [],
        action_items: [],
        open_questions: [],
        transcript_range: [2, 4],
      },
    ],
    meeting_type: 'team_sync',
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  }),
};

const previewMeetingSummary = (meeting: Meeting) => ({
  id: meeting.id,
  title: meeting.title,
  meeting_type: meeting.meeting_type ?? null,
  created_at: meeting.created_at,
  started_at: meeting.started_at,
  duration_seconds: meeting.duration_seconds ?? null,
  transcript_status: meeting.transcript_status ?? null,
  transcript_validated_at: meeting.transcript_validated_at ?? null,
  finalization_status: meeting.finalization_status ?? null,
  downstream_processing_json: meeting.downstream_processing_json ?? null,
  capture_journal_generation: meeting.capture_journal_generation ?? null,
  analysis_run_json: meeting.analysis_run_json ?? null,
  has_transcript: Boolean(meeting.transcript_json),
  has_transcript_text: Boolean(meeting.transcript_json),
  has_audio: Boolean(meeting.audio_path || meeting.system_audio_path),
  has_analysis: Boolean(meeting.analysis_json || meeting.enhanced_notes),
});

const previewMeetingProcessingStatus = (meeting: Meeting) => ({
  id: meeting.id,
  has_capture_gap: meeting.has_capture_gap ?? false,
  final_transcription_policy: meeting.final_transcription_policy ?? null,
  final_transcription_state: meeting.final_transcription_state ?? null,
  final_transcription_engine: meeting.final_transcription_engine ?? null,
  speaker_attribution_verified:
    meeting.speaker_attribution_verified ??
    (meeting.final_transcription_policy === 'parakeet_final_v1' &&
    meeting.final_transcription_state === 'complete'
      ? hasVerifiedSpeakerAttribution(meeting.transcript_json)
      : null),
  automatic_attempts_exhausted: meeting.automatic_attempts_exhausted ?? false,
});

const previewMeetingDashboard = (meeting: Meeting) => {
  let analysis: Record<string, unknown> = {};
  try {
    analysis = JSON.parse(meeting.analysis_json || '{}') as Record<
      string,
      unknown
    >;
  } catch {
    analysis = {};
  }
  const recentWin =
    analysis.recent_win && typeof analysis.recent_win === 'object'
      ? (analysis.recent_win as Record<string, unknown>)
      : {};
  const bounded = (value: unknown, limit: number) =>
    typeof value === 'string' ? value.slice(0, limit) : null;
  return {
    id: meeting.id,
    dashboard_detail:
      bounded(analysis.overview, 280) ?? bounded(meeting.enhanced_notes, 280),
    recent_win_title: bounded(recentWin.win, 160),
    recent_win_why: bounded(recentWin.why_it_counts, 240),
    recent_win_evidence: bounded(recentWin.evidence, 240),
    recent_win_source: bounded(recentWin.source, 160),
    recent_win_ownership: bounded(recentWin.ownership, 16),
    recent_win_owner: bounded(recentWin.owner, 160),
  };
};

const previewTimelineMeetings: Meeting[] = [
  previewMeeting,
  {
    ...previewMeeting,
    id: 'preview-acme-sync',
    title: 'Acme Corp Customer Sync',
    created_at: '2026-09-22T13:00:00-07:00',
    started_at: '2026-09-22T13:00:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-setup-review',
    title: 'Simple Team Setup Review',
    created_at: '2026-09-21T15:30:00-07:00',
    started_at: '2026-09-21T15:30:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-sales-sync',
    title: 'Weekly Sales & Product Sync',
    created_at: '2026-09-20T10:00:00-07:00',
    started_at: '2026-09-20T10:00:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-customer-feedback',
    title: 'Customer Feedback Catch-up',
    created_at: '2026-09-18T14:00:00-07:00',
    started_at: '2026-09-18T14:00:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-hiring-plan',
    title: 'Q4 Team Growth Review',
    created_at: '2026-09-15T11:00:00-07:00',
    started_at: '2026-09-15T11:00:00-07:00',
  },
];

const createDoc = (
  id: string,
  title: string,
  scope_type: KnowledgeDoc['scope_type'],
  status: KnowledgeDoc['status'],
): KnowledgeDoc => ({
  id,
  scope_type,
  scope_key: id,
  title,
  rendered_content:
    '# Preview Memory\n\nThe browser preview does not have access to Electron memory data. Open Pluto in Electron to see live compiled intelligence.',
  structured_json: null,
  config: null,
  status,
  last_synthesized_at: null,
  last_source_cursor: null,
  updated_at: now,
});

const docs = [
  createDoc(
    'global-preview-memory',
    'Global Knowledge Context',
    'global',
    'inactive',
  ),
  createDoc('project-preview-memory', 'Project Memory', 'project', 'inactive'),
  createDoc(
    'person-preview-memory',
    'People Memory',
    'person_context',
    'inactive',
  ),
];

const emptyGraphStats: KnowledgeGraphStats = {
  total_entities: 0,
  by_type: { person: 0, topic: 0, action_item: 0, decision: 0, project: 0 },
  total_links: 0,
  total_meeting_connections: 0,
};

const previewPrepLinks = new Map<string, string | null>();
const previewPeople: Entity[] = [
  {
    id: 'preview-maya',
    type: 'person',
    name: 'Maya Chen',
    normalized_name: 'maya chen',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Head of Product' }),
    saliency_score: 0.98,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-david',
    type: 'person',
    name: 'David Kim',
    normalized_name: 'david kim',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Account Executive' }),
    saliency_score: 0.91,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-alex',
    type: 'person',
    name: 'Alex Rivera',
    normalized_name: 'alex rivera',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Engineering Lead' }),
    saliency_score: 0.88,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-avery',
    type: 'person',
    name: 'Avery Taylor',
    normalized_name: 'avery taylor',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Product Design Lead' }),
    saliency_score: 0.85,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
];

const previewMeetings: Record<string, EntityMeeting[]> = {
  'preview-maya': [
    {
      id: 'preview-pricing-review',
      title: 'Q4 Launch & Customer Pricing',
      meeting_type: 'work',
      started_at: '2026-09-21T10:00:00.000Z',
      ended_at: null,
      duration_seconds: 2520,
      created_at: '2026-09-21T10:00:00.000Z',
      mention_count: 8,
      context: 'Agreed on $45 team plan and confirmed launch dates.',
    },
    {
      id: 'preview-acme-sync',
      title: 'Acme Corp Customer Sync',
      meeting_type: 'work',
      started_at: '2026-09-18T13:00:00.000Z',
      ended_at: null,
      duration_seconds: 2100,
      created_at: '2026-09-18T13:00:00.000Z',
      mention_count: 6,
      context: 'Reviewed customer trial requirements and onboarding steps.',
    },
  ],
  'preview-david': [
    {
      id: 'preview-pricing-review',
      title: 'Q4 Launch & Customer Pricing',
      meeting_type: 'work',
      started_at: '2026-09-21T10:00:00.000Z',
      ended_at: null,
      duration_seconds: 2520,
      created_at: '2026-09-21T10:00:00.000Z',
      mention_count: 5,
      context: 'Confirmed Acme Corp trial interest and seat count.',
    },
    {
      id: 'preview-acme-sync',
      title: 'Acme Corp Customer Sync',
      meeting_type: 'work',
      started_at: '2026-09-18T13:00:00.000Z',
      ended_at: null,
      duration_seconds: 2100,
      created_at: '2026-09-18T13:00:00.000Z',
      mention_count: 7,
      context: 'Coordinated trial kickoff schedule and security questions.',
    },
  ],
  'preview-alex': [
    {
      id: 'preview-pricing-review',
      title: 'Q4 Launch & Customer Pricing',
      meeting_type: 'work',
      started_at: '2026-09-21T10:00:00.000Z',
      ended_at: null,
      duration_seconds: 2520,
      created_at: '2026-09-21T10:00:00.000Z',
      mention_count: 4,
      context: 'Confirmed team account features ready in testing.',
    },
  ],
  'preview-avery': [
    {
      id: 'preview-pricing-review',
      title: 'Q4 Launch & Customer Pricing',
      meeting_type: 'work',
      started_at: '2026-09-21T10:00:00.000Z',
      ended_at: null,
      duration_seconds: 2520,
      created_at: '2026-09-21T10:00:00.000Z',
      mention_count: 4,
      context:
        'Presented simplified team invite flow taking under two minutes.',
    },
  ],
};

const previewMayaPersonContextDoc: KnowledgeDoc = {
  id: 'preview-maya-context',
  scope_type: 'person_context',
  scope_key: 'preview-maya',
  title: 'Conversations with Maya Chen',
  rendered_content: null,
  config: null,
  status: 'up_to_date',
  last_synthesized_at: now,
  last_source_cursor: null,
  updated_at: now,
  structured_json: JSON.stringify({
    schema_version: 2,
    scope: { type: 'person_context', title: 'Maya Chen' },
    current_read: {
      headline: 'Maya is leading the Q4 product launch and team pricing.',
      supporting_bullets: [
        'Agreed on $45 team plan and basic $20 pricing with sales.',
        'Working with design to make team setup take under two minutes.',
      ],
      freshness: 'fresh',
      source_count: 2,
      cited_item_count: 2,
      cited_meeting_count: 2,
      trust_message: 'Grounded in two confirmed conversations.',
      evidence_quality: {
        mode: 'direct',
        confidence: 0.95,
        cited_meeting_count: 2,
        source_count: 2,
        last_reinforced_at: now,
        freshness: 'fresh',
      },
    },
    active_streams: [],
    needs_attention: [],
    patterns: [
      {
        id: 'preview-pattern-maya',
        title: 'Prefers sharing summaries before customer calls',
        summary:
          'Maya likes to review one-page summaries before meeting with customer leads.',
        kind: 'pattern',
        severity: 'steady',
        why_now: 'Repeated across customer reviews.',
        stream_ids: [],
        citations: [
          {
            meeting_id: 'preview-pricing-review',
            quote: 'Let us review the customer summary before the call.',
          },
          {
            meeting_id: 'preview-acme-sync',
            quote: 'The one-page summary helped us stay on track.',
          },
        ],
        evidence_quality: {
          mode: 'direct',
          confidence: 0.9,
          cited_meeting_count: 2,
          source_count: 2,
          last_reinforced_at: now,
          freshness: 'fresh',
        },
      },
    ],
    risks_and_unknowns: [],
    evidence_index: [
      {
        id: 'preview-evidence-pricing-review',
        meeting_id: 'preview-pricing-review',
        meeting_title: 'Q4 Launch & Customer Pricing',
        captured_at: now,
        quote: 'Let us review the customer summary before the call.',
        stream_ids: [],
        item_ids: ['preview-pattern-maya'],
        mode: 'direct',
        confidence: 0.9,
      },
      {
        id: 'preview-evidence-acme-sync',
        meeting_id: 'preview-acme-sync',
        meeting_title: 'Acme Corp Customer Sync',
        captured_at: now,
        quote: 'The one-page summary helped us stay on track.',
        stream_ids: [],
        item_ids: ['preview-pattern-maya'],
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
      generated_at: now,
      added_count: 2,
      removed_count: 0,
      updated_count: 0,
      notable_changes: [],
    },
  }),
};

const previewPersonContextDoc: KnowledgeDoc = {
  id: 'preview-avery-context',
  scope_type: 'person_context',
  scope_key: 'preview-avery',
  title: 'Conversations with Avery Taylor',
  rendered_content: null,
  config: null,
  status: 'up_to_date',
  last_synthesized_at: now,
  last_source_cursor: null,
  updated_at: now,
  structured_json: JSON.stringify({
    schema_version: 2,
    scope: { type: 'person_context', title: 'Avery Taylor' },
    current_read: {
      headline: 'Avery is simplifying the team onboarding experience.',
      supporting_bullets: [
        'Designed invite flow that takes under two minutes.',
      ],
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
        last_reinforced_at: now,
        freshness: 'fresh',
      },
    },
    active_streams: [],
    needs_attention: [],
    patterns: [
      {
        id: 'preview-pattern-avery',
        title: 'Prefers simple click-through flows',
        summary: 'A simple flow helps teams complete setup without drop-offs.',
        kind: 'pattern',
        severity: 'steady',
        why_now: 'Validated in customer testing.',
        stream_ids: [],
        citations: [
          {
            meeting_id: 'preview-pricing-review',
            quote: 'It now takes less than two minutes.',
          },
        ],
        evidence_quality: {
          mode: 'direct',
          confidence: 0.9,
          cited_meeting_count: 1,
          source_count: 1,
          last_reinforced_at: now,
          freshness: 'fresh',
        },
      },
    ],
    risks_and_unknowns: [],
    evidence_index: [
      {
        id: 'preview-evidence-avery-review',
        meeting_id: 'preview-pricing-review',
        meeting_title: 'Q4 Launch & Customer Pricing',
        captured_at: now,
        quote: 'It now takes less than two minutes.',
        stream_ids: [],
        item_ids: ['preview-pattern-avery'],
        mode: 'direct',
        confidence: 0.9,
      },
    ],
    source_quality_summary: {
      included_count: 1,
      excluded_count: 0,
      weak_count: 0,
      records: [],
    },
    change_summary: {
      generated_at: now,
      added_count: 1,
      removed_count: 0,
      updated_count: 0,
      notable_changes: [],
    },
  }),
};

const previewPersonBriefings: Record<string, PersonBriefingDetail> = {
  'preview-maya': {
    person: previewPeople[0],
    isSelf: false,
    meetings: [
      {
        id: 'preview-pricing-review',
        title: 'Q4 Launch & Customer Pricing',
        started_at: '2026-09-21T10:00:00.000Z',
        created_at: '2026-09-21T10:00:00.000Z',
        duration_seconds: 2520,
        context: 'Agreed on $45 team plan and confirmed launch dates.',
        evidence: 'confirmed',
      },
      {
        id: 'preview-acme-sync',
        title: 'Acme Corp Customer Sync',
        started_at: '2026-09-18T13:00:00.000Z',
        created_at: '2026-09-18T13:00:00.000Z',
        duration_seconds: 2100,
        context: 'Reviewed customer trial requirements and onboarding steps.',
        evidence: 'confirmed',
      },
    ],
    commitments: {
      open: [
        {
          id: 'preview-maya-open-1',
          text: 'Send the new pricing sheet to Sarah in sales',
          status: 'active',
          dueDate: '2026-10-02T17:00:00.000Z',
          evidence:
            "Let's make sure Sarah has the new pricing sheet before the Acme call.",
          sourceMeetingId: 'preview-pricing-review',
          sourceMeetingTitle: 'Q4 Launch & Customer Pricing',
          updatedAt: now,
        },
        {
          id: 'preview-maya-open-2',
          text: 'Check customer feedback from the first Acme trial',
          status: 'active',
          dueDate: '2026-10-04T17:00:00.000Z',
          evidence:
            'Maya will review customer feedback after the first week of trial.',
          sourceMeetingId: 'preview-acme-sync',
          sourceMeetingTitle: 'Acme Corp Customer Sync',
          updatedAt: now,
        },
      ],
      delivered: [
        {
          id: 'preview-maya-delivered-1',
          text: 'Finished Q4 pricing guide and launch checklist',
          status: 'completed',
          dueDate: null,
          evidence: 'Pricing guide and checklist shared with leadership.',
          sourceMeetingId: 'preview-pricing-review',
          sourceMeetingTitle: 'Q4 Launch & Customer Pricing',
          updatedAt: now,
        },
      ],
      candidates: [],
    },
    knowledgeDoc: previewMayaPersonContextDoc,
    workingMemorySnapshot: null,
    mergedPeople: [],
  },
  'preview-david': {
    person: previewPeople[1],
    isSelf: false,
    meetings: [
      {
        id: 'preview-pricing-review',
        title: 'Q4 Launch & Customer Pricing',
        started_at: '2026-09-21T10:00:00.000Z',
        created_at: '2026-09-21T10:00:00.000Z',
        duration_seconds: 2520,
        context: 'Confirmed Acme Corp trial interest and seat count.',
        evidence: 'confirmed',
      },
      {
        id: 'preview-acme-sync',
        title: 'Acme Corp Customer Sync',
        started_at: '2026-09-18T13:00:00.000Z',
        created_at: '2026-09-18T13:00:00.000Z',
        duration_seconds: 2100,
        context: 'Coordinated trial kickoff schedule and security questions.',
        evidence: 'confirmed',
      },
    ],
    commitments: {
      open: [
        {
          id: 'preview-david-open-1',
          text: 'Confirm launch date with the Acme Corp team',
          status: 'active',
          dueDate: '2026-10-03T17:00:00.000Z',
          evidence: 'Acme Corp is ready to start their 30-day trial next week.',
          sourceMeetingId: 'preview-pricing-review',
          sourceMeetingTitle: 'Q4 Launch & Customer Pricing',
          updatedAt: now,
        },
      ],
      delivered: [],
      candidates: [],
    },
    knowledgeDoc: null,
    workingMemorySnapshot: null,
    mergedPeople: [],
  },
  'preview-alex': {
    person: previewPeople[2],
    isSelf: false,
    meetings: [
      {
        id: 'preview-pricing-review',
        title: 'Q4 Launch & Customer Pricing',
        started_at: '2026-09-21T10:00:00.000Z',
        created_at: '2026-09-21T10:00:00.000Z',
        duration_seconds: 2520,
        context: 'Confirmed team account features ready in testing.',
        evidence: 'confirmed',
      },
    ],
    commitments: { open: [], delivered: [], candidates: [] },
    knowledgeDoc: null,
    workingMemorySnapshot: null,
    mergedPeople: [],
  },
  'preview-avery': {
    person: previewPeople[3],
    isSelf: false,
    meetings: [
      {
        id: 'preview-pricing-review',
        title: 'Q4 Launch & Customer Pricing',
        started_at: '2026-09-21T10:00:00.000Z',
        created_at: '2026-09-21T10:00:00.000Z',
        duration_seconds: 2520,
        context:
          'Presented simplified team invite flow taking under two minutes.',
        evidence: 'confirmed',
      },
    ],
    commitments: {
      open: [
        {
          id: 'preview-avery-open-1',
          text: 'Finish testing the team invite steps',
          status: 'active',
          dueDate: '2026-10-01T17:00:00.000Z',
          evidence: 'Avery will finish testing invite steps before launch.',
          sourceMeetingId: 'preview-pricing-review',
          sourceMeetingTitle: 'Q4 Launch & Customer Pricing',
          updatedAt: now,
        },
      ],
      delivered: [],
      candidates: [],
    },
    knowledgeDoc: previewPersonContextDoc,
    workingMemorySnapshot: null,
    mergedPeople: [],
  },
};

const previewActionItems: Entity[] = [
  {
    id: 'preview-action-suggested',
    type: 'action_item',
    name: 'Send the new pricing sheet to Sarah in sales',
    normalized_name: 'send the new pricing sheet to sarah in sales',
    status: 'active',
    due_date: new Date(Date.now() + 2 * 86400000).toISOString(),
    assigned_to: 'preview-avery',
    domain_tag: 'work',
    metadata: JSON.stringify({
      commitment_state: 'possible',
      assignee_name: 'You',
      source_meeting_id: 'preview-pricing-review',
      source_meeting_title: 'Q4 Launch & Customer Pricing',
      attention_label: 'Suggested Follow-up',
      priority: 'high',
    }),
    saliency_score: 0.95,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-action-1',
    type: 'action_item',
    name: 'Share the 30-day trial plan with Acme Corp',
    normalized_name: 'share the 30-day trial plan with acme corp',
    status: 'active',
    due_date: new Date(Date.now() + 6 * 3600000).toISOString(),
    assigned_to: 'preview-avery',
    domain_tag: 'work',
    metadata: JSON.stringify({
      commitment_state: 'confirmed',
      assignee_name: 'You',
      priority: 'high',
    }),
    saliency_score: 0.9,
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-action-2',
    type: 'action_item',
    name: 'Review the new team invite steps with Avery',
    normalized_name: 'review the new team invite steps with avery',
    status: 'active',
    due_date: new Date(Date.now() + 48 * 3600000).toISOString(),
    assigned_to: 'preview-avery',
    domain_tag: 'work',
    metadata: JSON.stringify({
      commitment_state: 'confirmed',
      assignee_name: 'You',
      priority: 'medium',
    }),
    saliency_score: 0.85,
    created_at: now,
    updated_at: now,
  },
];

const previewProjectPortfolio = [
  {
    id: 'preview-project-launch-pricing',
    type: 'project' as const,
    name: 'Q4 Team Launch & Pricing',
    normalized_name: 'q4 team launch & pricing',
    display_title: 'Q4 Team Launch & Pricing',
    status: 'active' as const,
    due_date: new Date(Date.now() + 8 * 86400000).toISOString(),
    assigned_to: 'Product & Sales Team',
    metadata: JSON.stringify({
      projectCadence: 'weekly',
      projectStarred: true,
      projectPortfolioDisposition: 'confirmed',
      projectQualification: {
        version: 1,
        state: 'qualified',
        reason: 'Q4 launch confirmed as primary team goal.',
        source: 'user',
        assessedAt: new Date().toISOString(),
      },
    }),
    saliency_score: 0.98,
    domain_tag: 'work',
    meeting_count: 5,
    last_mentioned_at: new Date().toISOString(),
    latest_context:
      'Pricing set at $45 per seat; Acme Corp starts 30-day trial next week.',
    cadence: 'weekly' as const,
    health_state: 'on_track' as const,
    health_headline: 'Pricing approved and customer trials ready to start',
    health_summary:
      'Notes across the last 5 calls show pricing is agreed upon and the setup is tested. Sales and engineering are ready for the October 1st launch.',
    typical_participant_count: 4,
    next_milestone: 'Public Launch (Oct 1)',
    current_focus: 'Pricing sheet handoff & customer trial kickoff',
    activity_state: 'active' as const,
    activity_label: 'Active today',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-project-team-setup',
    type: 'project' as const,
    name: 'Simple Team Setup & Invites',
    normalized_name: 'simple team setup & invites',
    display_title: 'Simple Team Setup & Invites',
    status: 'active' as const,
    due_date: new Date(Date.now() + 15 * 86400000).toISOString(),
    assigned_to: 'Design & Eng Team',
    metadata: JSON.stringify({
      projectCadence: 'biweekly',
      projectStarred: true,
      projectPortfolioDisposition: 'confirmed',
      projectQualification: {
        version: 1,
        state: 'qualified',
        reason: 'Improve team invite and account setup experience.',
        source: 'user',
        assessedAt: new Date().toISOString(),
      },
    }),
    saliency_score: 0.88,
    domain_tag: 'work',
    meeting_count: 4,
    last_mentioned_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    latest_context:
      'Account setup time cut by half; new teams set up in under three minutes.',
    cadence: 'biweekly' as const,
    health_state: 'on_track' as const,
    health_headline: 'Setup steps cut from five steps down to two',
    health_summary:
      'Eight customer teams tested the invite steps with zero drop-offs. Design and engineering finished the final updates.',
    typical_participant_count: 3,
    next_milestone: 'Final Review (Oct 5)',
    current_focus: 'Two-minute invite flow testing',
    activity_state: 'active' as const,
    activity_label: 'Active 2d ago',
    created_at: now,
    updated_at: now,
  },
];

const workspaceFor = (docId?: string): KnowledgeWorkspacePayload => {
  const selected_doc = docs.find((doc) => doc.id === docId) || docs[0];

  return {
    docs,
    selected_doc,
    notes: null,
    graph: {
      nodes: [],
      edges: [],
    },
    timeline: [],
    backlinks: [],
    project_cards: [],
  };
};

const getSetting = (key: unknown) => {
  switch (key) {
    case 'setup_complete':
      return 'true';
    case 'llm_provider':
      return 'ollama';
    case 'theme':
      return 'system';
    case 'auto_end_enabled':
      return 'true';
    case 'export_include_transcript':
      return 'false';
    case 'transcription_language':
      return '';
    default:
      return null;
  }
};

const createInvokeFallback =
  (
    captureJournals: Map<string, BrowserCaptureJournal>,
  ): IpcRendererLike['invoke'] =>
  async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    let result: unknown;

    switch (channel) {
      case 'MEETING_PREP_OPEN': {
        const event = args[0] as CalendarEvent;
        const saved = localStorage.getItem(
          `preview.prep:${event.occurrenceKey}`,
        );
        const prep: MeetingPrep = saved
          ? { ...JSON.parse(saved), event }
          : {
              occurrenceKey: event.occurrenceKey,
              event,
              notes: '',
              topics: [],
              meetingId: null,
              recordingStarted: false,
              revision: 0,
              updatedAt: new Date().toISOString(),
            };
        localStorage.setItem(
          `preview.prep:${event.occurrenceKey}`,
          JSON.stringify(prep),
        );
        result = prep;
        break;
      }
      case 'MEETING_PREP_GET':
        result = JSON.parse(
          localStorage.getItem(`preview.prep:${args[0]}`) || 'null',
        );
        break;
      case 'MEETING_PREP_FOR_MEETING':
        result = null;
        break;
      case 'MEETING_PREP_BRIEF_BUILD':
      case 'MEETING_PREP_BRIEF_SYNTHESIZE': {
        const prep = JSON.parse(
          localStorage.getItem(`preview.prep:${args[0]}`) || 'null',
        ) as MeetingPrep | null;
        if (!prep) throw new Error('Preparation unavailable');
        const { buildMeetingPrepBrief } = await import(
          '../../electron/meetingPrepBrief'
        );
        result = buildMeetingPrepBrief(prep, {
          entities: () => [],
          blockers: () => [],
        });
        break;
      }
      case 'MEETING_PREP_MEETINGS': {
        const query = String(
          (args[0] as { query?: string })?.query || '',
        ).toLowerCase();
        result = [
          {
            id: 'preview-q4-launch',
            title: 'Q4 Launch & Customer Pricing',
            date: '2026-09-20T10:00:00Z',
            participants: 'Maya, David',
            preview:
              'Confirm launch dates, checklist ownership, and customer trial pricing.',
          },
          {
            id: 'preview-team-review',
            title: 'Team Setup Review',
            date: '2026-09-22T10:00:00Z',
            participants: 'Alex',
            preview: 'Review onboarding and invitation steps.',
          },
        ].filter((m) =>
          `${m.title} ${m.preview} ${m.participants}`
            .toLowerCase()
            .includes(query),
        );
        break;
      }
      case 'MEETING_PREP_SAVE': {
        const request = args[0] as {
          occurrenceKey: string;
          revision: number;
          patch: Record<string, any>;
        };
        const prep = JSON.parse(
          localStorage.getItem(`preview.prep:${request.occurrenceKey}`) ||
            'null',
        ) as MeetingPrep | null;
        if (!prep || prep.revision !== request.revision)
          throw new Error('Prep changed elsewhere. Reload before saving.');
        const patch = request.patch;
        if ('notes' in patch) prep.notes = patch.notes;
        if (Array.isArray(patch.meetingIds)) {
          prep.meetings = patch.meetingIds.map(
            (id: string) =>
              (prep.meetings || []).find((m) => m.id === id) || {
                id,
                title:
                  id === 'preview-q4-launch'
                    ? 'Q4 Launch & Customer Pricing'
                    : 'Team Setup Review',
                date: '2026-09-20T10:00:00Z',
                participants: 'Maya, David',
                preview: 'Launch checklist and pricing',
                context:
                  'Confirm launch dates, checklist ownership, and customer trial pricing.',
                trustStatus: 'grounded',
                capturedAt: new Date().toISOString(),
              },
          );
        }
        if (patch.removeMeetingId)
          prep.meetings = (prep.meetings || []).filter(
            (m) => m.id !== patch.removeMeetingId,
          );
        const meetingId = patch.addMeetingId || patch.refreshMeetingId;
        if (meetingId) {
          const meeting = {
            id: meetingId,
            title:
              meetingId === 'preview-q4-launch'
                ? 'Q4 Launch & Customer Pricing'
                : 'Team Setup Review',
            date: '2026-09-20T10:00:00Z',
            participants: 'Maya, David',
            preview: 'Confirm launch dates and customer trial pricing.',
            context:
              'Confirm launch dates, checklist ownership, and customer trial pricing.',
            trustStatus: 'grounded' as const,
            capturedAt: new Date().toISOString(),
          };
          prep.meetings = patch.refreshMeetingId
            ? (prep.meetings || []).map((m) =>
                m.id === meetingId ? meeting : m,
              )
            : [...(prep.meetings || []), meeting];
        }
        prep.revision++;
        prep.updatedAt = new Date().toISOString();
        localStorage.setItem(
          `preview.prep:${prep.occurrenceKey}`,
          JSON.stringify(prep),
        );
        result = prep;
        break;
      }
      case 'AUDIO_CAPTURE_JOURNAL_START': {
        const request = args[0] as { meetingId?: unknown } | undefined;
        if (typeof request?.meetingId === 'string') {
          const journal: BrowserCaptureJournal = {
            schemaVersion: 3,
            generation: `browser-preview-${request.meetingId}`,
            revision: 0,
            supported: false,
          };
          captureJournals.set(request.meetingId, journal);
          result = journal;
        } else {
          result = null;
        }
        break;
      }
      case 'AUDIO_CAPTURE_JOURNAL_READ': {
        const request = args[0] as { meetingId?: unknown } | undefined;
        result =
          typeof request?.meetingId === 'string'
            ? (captureJournals.get(request.meetingId) ?? null)
            : null;
        break;
      }
      case 'AUDIO_CAPTURE_JOURNAL_INTERVAL_AUTHORIZE':
      case 'AUDIO_CAPTURE_JOURNAL_RAW_APPEND':
      case 'AUDIO_CAPTURE_JOURNAL_CAPTURE_COMPLETE':
      case 'AUDIO_CAPTURE_JOURNAL_CHECKPOINT_APPEND':
      case 'AUDIO_CAPTURE_JOURNAL_ACCEPTANCE_APPEND':
      case 'AUDIO_CAPTURE_JOURNAL_VERIFY_TRANSCRIPT':
      case 'AUDIO_CAPTURE_JOURNAL_STOP': {
        const request = args[0] as { meetingId?: unknown } | undefined;
        const journal =
          typeof request?.meetingId === 'string'
            ? captureJournals.get(request.meetingId)
            : undefined;
        result = journal
          ? {
              ...journal,
              reason: 'electron_capture_journal_required',
            }
          : null;
        break;
      }
      case 'AUDIO_CAPTURE_JOURNAL_ACTIVITY_UPDATE': {
        const request = args[0] as
          | { meetingId?: unknown; activityEvidence?: unknown }
          | undefined;
        if (
          typeof request?.meetingId === 'string' &&
          captureJournals.has(request.meetingId)
        ) {
          const journal = captureJournals.get(request.meetingId)!;
          captureJournals.set(request.meetingId, {
            ...journal,
            activityEvidence: request.activityEvidence,
          });
        }
        result = args[0];
        break;
      }
      case 'AUDIO_CAPTURE_JOURNAL_SEAL': {
        const request = args[0] as { meetingId?: unknown } | undefined;
        const meetingId =
          typeof request?.meetingId === 'string' ? request.meetingId : null;
        const journal = meetingId ? captureJournals.get(meetingId) : undefined;
        if (meetingId) captureJournals.delete(meetingId);
        result = journal?.activityEvidence
          ? { ...journal, activityEvidence: journal.activityEvidence }
          : null;
        break;
      }
      case 'GET_SETTING':
        result = getSetting(args[0]);
        break;
      case 'GET_MEETING_NOTES_TEMPLATE_SETTINGS':
        result = meetingNotesTemplateSettings;
        break;
      case 'UPDATE_MEETING_NOTES_TEMPLATE_SETTINGS':
        meetingNotesTemplateSettings = applyMeetingNotesTemplateSettingsUpdate(
          meetingNotesTemplateSettings,
          args[0],
        );
        result = meetingNotesTemplateSettings;
        break;
      case 'PROVIDER_CREDENTIAL_STATUS':
        result = {
          provider: args[0],
          configured: false,
          available: false,
          error: 'secure_storage_unavailable',
        };
        break;
      case 'PROVIDER_CREDENTIAL_SET':
        throw new Error('secure_storage_unavailable');
      case 'PROVIDER_CREDENTIAL_DELETE':
        result = {
          provider: args[0],
          configured: false,
          available: false,
          error: 'secure_storage_unavailable',
        };
        break;
      case 'TRANSCRIPTION_PREPARE_FINAL':
        result = { ready: true, engine: 'parakeet_coreml' };
        break;
      case 'RECORDING_READINESS_STATUS':
      case 'RECORDING_READINESS_PREPARE':
        result = {
          details: {
            parakeetClient: true,
            parakeetModel: true,
            parakeetEouReady: true,
            audiocapExists: true,
            audiocapExecutable: true,
          },
        };
        break;
      case 'GET_MEETINGS':
        result = meetingPreviewEnabled()
          ? previewTimelineMeetings.map(previewMeetingSummary)
          : [];
        break;
      case 'GET_MEETING_PROCESSING_STATUSES':
        result = meetingPreviewEnabled()
          ? previewTimelineMeetings
              .filter(
                (meeting) =>
                  meeting.transcript_status === 'needs_attention' ||
                  (meeting.transcript_status === 'validated' &&
                    !meeting.analysis_json &&
                    !meeting.enhanced_notes),
              )
              .map(previewMeetingProcessingStatus)
          : [];
        break;
      case 'GET_MEETING':
        result =
          previewTimelineMeetings.find(
            (meeting) => String(meeting.id) === String(args[0]),
          ) ?? null;
        break;
      case 'GET_MEETING_STATUS':
        {
          const meeting = previewTimelineMeetings.find(
            (candidate) => String(candidate.id) === String(args[0]),
          );
          result = meeting
            ? {
                ...previewMeetingSummary(meeting),
                ...previewMeetingProcessingStatus(meeting),
              }
            : null;
        }
        break;
      case 'SEARCH_MEETING_SUMMARIES': {
        const query = String(args[0] ?? '')
          .trim()
          .toLocaleLowerCase();
        result = query
          ? previewTimelineMeetings
              .filter((meeting) =>
                [
                  meeting.title,
                  meeting.enhanced_notes,
                  meeting.user_notes,
                  meeting.analysis_json,
                ].some((value) =>
                  String(value ?? '')
                    .toLocaleLowerCase()
                    .includes(query),
                ),
              )
              .slice(0, 5)
              .map((meeting) => ({
                id: meeting.id,
                title: meeting.title,
                started_at: meeting.started_at,
                created_at: meeting.created_at,
              }))
          : [];
        break;
      }
      case 'GET_DASHBOARD_MEETING_PREVIEWS':
        result = meetingPreviewEnabled()
          ? previewTimelineMeetings.map(previewMeetingDashboard)
          : [];
        break;
      case 'CALENDAR_GET_STATE':
      case 'CALENDAR_CONNECT':
      case 'CALENDAR_SELECT':
      case 'CALENDAR_REFRESH':
        result = previewCalendarSnapshot;
        break;
      case 'CALENDAR_LIST_DAY':
        result = previewCalendarEvents();
        break;
      case 'CALENDAR_GET_MEETING_CONTEXT':
        result = null;
        break;
      case 'PRE_MEETING_ATTENDEE_CHANGE':
      case 'PRE_MEETING_BRIEF_SYNTHESIZE':
      case 'PRE_MEETING_BRIEF_BUILD': {
        const change =
          channel === 'PRE_MEETING_ATTENDEE_CHANGE'
            ? (args[0] as {
                request: { kind: 'calendar'; event: CalendarEvent };
                key: string;
                selection: { personId?: string | null; newName?: string };
              })
            : null;
        const request = (change?.request || args[0]) as
          | { kind: 'calendar'; event: CalendarEvent }
          | { kind: 'query'; query: string };
        if (change) {
          let id = change.selection.personId ?? null;
          if (change.selection.newName) {
            id = `preview-prep-${previewPeople.length}`;
            previewPeople.push({
              ...previewPeople[0],
              id,
              name: change.selection.newName,
              normalized_name: change.selection.newName.toLowerCase(),
            });
          }
          previewPrepLinks.set(change.key, id);
        }
        const attendees: PrepAttendee[] =
          request.kind === 'calendar'
            ? prepRoster(request.event)
                .filter((person) => person.name !== 'You')
                .map((person) => {
                  const candidates = previewPeople.filter(
                    (p) => p.name.toLowerCase() === person.name?.toLowerCase(),
                  );
                  const stored = previewPrepLinks.has(person.key);
                  const id = stored
                    ? previewPrepLinks.get(person.key)
                    : candidates.length === 1
                      ? candidates[0].id
                      : null;
                  const match = previewPeople.find((p) => p.id === id);
                  return {
                    ...person,
                    personId: match?.id ?? null,
                    personName: match?.name ?? null,
                    status: match
                      ? 'identified'
                      : stored
                        ? 'unlinked'
                        : 'unresolved',
                    basis: match ? (stored ? 'user' : 'name') : 'none',
                    suggestions: candidates.map(({ id, name }) => ({
                      id,
                      name,
                    })),
                  };
                })
            : [];
        const title =
          request.kind === 'calendar' ? request.event.title : request.query;
        result = {
          title: title || 'Conversation brief',
          startsAt: request.kind === 'calendar' ? request.event.start : null,
          agenda:
            request.kind === 'calendar' ? request.event.agenda || null : null,
          relationship: 'related',
          priorMeeting: {
            id: previewMeeting.id,
            title: previewMeeting.title,
            startedAt: previewMeeting.started_at,
          },
          lastTime: [
            {
              id: 'preview-decision',
              text: 'Keep the beta focused on the smaller onboarding flow.',
              trustStatus: 'grounded',
              sourceMeetingId: String(previewMeeting.id),
              sourceLabel: previewMeeting.title,
              sourceDate: previewMeeting.started_at,
            },
          ],
          stillOpen: [
            {
              id: 'preview-open',
              text: 'Confirm the launch checklist owner.',
              trustStatus: 'grounded',
              sourceMeetingId: String(previewMeeting.id),
              sourceLabel: previewMeeting.title,
              sourceDate: previewMeeting.started_at,
            },
          ],
          relevantContext: [],
          attendees,
          personOptions: previewPeople.map(({ id, name }) => ({ id, name })),
          overview: [
            {
              id: 'preview-overview',
              text: 'Keep the beta focused on the smaller onboarding flow.',
              trustStatus: 'grounded',
              sourceMeetingId: String(previewMeeting.id),
              sourceLabel: previewMeeting.title,
              sourceDate: previewMeeting.started_at,
            },
          ],
          talkingPoints: [
            {
              id: 'preview-talk',
              text: 'What is the latest update on “Confirm the launch checklist owner”?',
              trustStatus: 'inferred',
              sourceMeetingId: String(previewMeeting.id),
              sourceLabel: previewMeeting.title,
              sourceDate: previewMeeting.started_at,
            },
          ],
          sourceMeetings: [
            {
              id: String(previewMeeting.id),
              title: previewMeeting.title,
              startedAt: previewMeeting.started_at,
              evidence: 'invited',
            },
          ],
          synthesisStatus: 'fallback',
          emptyMessage: null,
        };
        break;
      }
      case 'OPEN_CALENDAR_SYSTEM_SETTINGS':
        result = true;
        break;
      case 'GET_KNOWLEDGE_DOC_SOURCES':
      case 'GET_KNOWLEDGE_CORRECTIONS':
        result = [];
        break;
      case 'BOOT_PROBE_STATUS':
        result = true;
        break;
      case 'CHECK_MICROPHONE_PERMISSION':
      case 'CHECK_SYSTEM_AUDIO_PERMISSION':
        result = 'granted';
        break;
      case 'REQUEST_MICROPHONE_PERMISSION':
        result = true;
        break;
      case 'SYSTEM_AUDIO_PROBE':
        result = true;
        break;
      case 'DETECT_ACTIVE_CALL':
        result = { active: false };
        break;
      case 'GET_KNOWLEDGE_WORKSPACE': {
        const params = args[0] as { docId?: string } | undefined;
        result = workspaceFor(params?.docId);
        break;
      }
      case 'GET_KNOWLEDGE_DOCS':
        result = docs;
        break;
      case 'GET_KNOWLEDGE_DOC': {
        const id = String(args[0] || '');
        result = docs.find((doc) => doc.id === id);
        break;
      }
      case 'LOCAL_ARTIFACTS_LIST':
        result = previewLocalArtifacts;
        break;
      case 'LOCAL_ARTIFACTS_IMPORT':
      case 'LOCAL_ARTIFACTS_IMPORT_PATHS':
        result = [];
        break;
      case 'LOCAL_ARTIFACTS_SET_STATUS': {
        const input = args[0] as {
          id?: string;
          status?: LocalArtifact['status'];
        };
        const index = previewLocalArtifacts.findIndex(
          (artifact) => artifact.id === input.id,
        );
        if (index < 0 || !input.status) {
          throw new Error('local_artifact_not_found');
        }
        previewLocalArtifacts[index] = {
          ...previewLocalArtifacts[index],
          status: input.status,
          source_quality:
            input.status === 'noisy'
              ? 'noisy'
              : previewLocalArtifacts[index].source_quality === 'noisy'
                ? 'usable'
                : previewLocalArtifacts[index].source_quality,
          trust_status:
            input.status === 'noisy'
              ? 'weak_evidence'
              : previewLocalArtifacts[index].trust_status === 'weak_evidence'
                ? 'grounded'
                : previewLocalArtifacts[index].trust_status,
          updated_at: new Date().toISOString(),
        };
        result = previewLocalArtifacts[index];
        break;
      }
      case 'LOCAL_ARTIFACTS_DELETE': {
        const id = String(args[0] || '');
        const idx = previewLocalArtifacts.findIndex((a) => a.id === id);
        if (idx >= 0) {
          previewLocalArtifacts.splice(idx, 1);
          result = true;
        } else {
          result = false;
        }
        break;
      }
      case 'REFRESH_KNOWLEDGE_DOC': {
        const id = String(args[0] || '');
        result = docs.find((doc) => doc.id === id);
        break;
      }
      case 'GET_KNOWLEDGE_GRAPH':
        result = workspaceFor().graph;
        break;
      case 'GET_OVERDUE_ACTION_ITEMS':
      case 'GET_STALE_ACTION_ITEMS':
        result = [];
        break;
      case 'GET_ACTION_ITEMS_BY_STATUS': {
        const status = args[0];
        result =
          status === 'active' || !status
            ? previewActionItems.filter((item) => item.status === 'active')
            : previewActionItems.filter((item) => item.status === status);
        break;
      }
      case 'UPDATE_ACTION_COMMITMENT_STATE': {
        const payload = args[0] as
          | { id?: string; commitmentState?: 'confirmed' | 'rejected' }
          | undefined;
        const found = previewActionItems.find(
          (item) => item.id === payload?.id,
        );
        if (found) {
          if (payload?.commitmentState === 'rejected') {
            const idx = previewActionItems.indexOf(found);
            previewActionItems.splice(idx, 1);
          } else {
            const meta = JSON.parse(found.metadata || '{}');
            found.metadata = JSON.stringify({
              ...meta,
              commitment_state: 'confirmed',
              reviewed_at: new Date().toISOString(),
            });
          }
          result = found;
        } else {
          result = null;
        }
        break;
      }
      case 'UPDATE_ENTITY_STATUS': {
        const id = args[0];
        const status = args[1] as string;
        const found = previewActionItems.find((item) => item.id === id);
        if (found) {
          found.status = status as Entity['status'];
          result = found;
        } else {
          result = null;
        }
        break;
      }
      case 'GET_KNOWLEDGE_GRAPH_STATS':
        result = emptyGraphStats;
        break;
      case 'GET_PROJECT_PORTFOLIO':
        result =
          typeof window !== 'undefined' &&
          new URLSearchParams(window?.location?.search || '').get('preview') ===
            'projects'
            ? previewProjectPortfolio
            : [];
        break;
      case 'DISCOVER_PROJECT_INITIATIVE':
        result = {
          discovered: 0,
          remaining: 0,
          failed: 0,
          deferred: false,
        };
        break;
      case 'intelligence:alerts': {
        result = [
          {
            id: 'preview-attention-pricing-sheet',
            dedupe_key: 'preview-attention-pricing-sheet',
            kind: 'follow_up',
            severity: 'critical',
            score: 95,
            status: 'active',
            title: 'Send the new pricing sheet to Sarah in sales',
            reason: 'From Q4 Launch & Customer Pricing · Promise made to team',
            source: 'proactive_engine',
            evidence: [
              {
                meeting_id: 'preview-pricing-review',
                quote:
                  "Maya Chen: Let's make sure Sarah has the new pricing sheet before the Acme call.",
              },
            ],
            related_entity_ids: ['preview-maya', 'preview-action-suggested'],
            related_stream_ids: [],
            related_meeting_ids: ['preview-pricing-review'],
            created_at: now,
            updated_at: now,
            last_seen_at: now,
            resolved_at: null,
          },
        ];
        break;
      }
      case 'intelligence:alerts:update-status': {
        result = { id: args[0], status: args[1] };
        break;
      }
      case 'intelligence:query': {
        result = {
          status: 'answered',
          answer: `Across your meetings with **Acme Corp** and the **Q4 Launch Review**:

1. **Pricing:** The team approved a **$45 per seat** team plan and kept the basic plan at **$20**.
2. **Trial Date:** Acme Corp starts their 30-day trial on **October 3rd** with 120 team members.
3. **Next Step:** Maya promised to share the new pricing sheet with sales by **Thursday at 5:00 PM**.`,
          citations: [
            {
              meeting_id: 'preview-pricing-review',
              meeting_title: 'Q4 Launch & Customer Pricing',
              text_quote:
                "Based on customer feedback, let's set the team price at $45 per seat and keep the basic plan at $20 so new teams can try it easily.",
              speaker: 'Maya Chen',
              timestamp_ms: 135000,
              source_type: 'meeting',
            },
            {
              meeting_id: 'preview-acme-sync',
              meeting_title: 'Acme Corp Customer Sync',
              text_quote:
                'Acme Corp is ready to start their 30-day trial next week on October 3rd.',
              speaker: 'David Kim',
              timestamp_ms: 980000,
              source_type: 'meeting',
            },
          ],
          trustStatus: 'grounded',
          outcome: 'answered',
          resolvedScope: {
            kind: 'meeting_ids',
            meetingIds: ['preview-pricing-review', 'preview-acme-sync'],
            resolvedAt: new Date().toISOString(),
            source: 'explicit',
          },
          retrievalSummary: {
            matchedMeetingCount: 2,
            includedMeetingCount: 2,
            preparedEvidenceCount: 4,
            transcriptOnlyCount: 0,
            omittedMeetingCount: 0,
          },
        };
        break;
      }
      case 'GET_IDENTITY_STATE':
        result = {
          selfPersonId: 'preview-avery',
          people: previewPeople.map(({ id, name }) => ({ id, name })),
          revision: 1,
          profile: {
            preferredName: 'Avery Chen',
            aliases: [],
            useCases: ['work'],
          },
        };
        break;
      case 'UPSERT_ENTITY': {
        const payload = (args[0] ?? {}) as Partial<Entity>;
        const existing = payload.id
          ? previewPeople.find((p) => p.id === payload.id)
          : payload.name
            ? previewPeople.find(
                (p) => p.normalized_name === payload.name?.trim().toLowerCase(),
              )
            : undefined;
        if (existing) {
          result = existing;
          break;
        }
        const createdName = payload.name?.trim() || 'Person';
        const created: Entity = {
          id: payload.id || `preview-${Date.now()}`,
          type: payload.type || 'person',
          name: createdName,
          normalized_name: createdName.toLowerCase(),
          status: payload.status ?? 'active',
          due_date: payload.due_date ?? null,
          assigned_to: payload.assigned_to ?? null,
          metadata: payload.metadata
            ? typeof payload.metadata === 'string'
              ? payload.metadata
              : JSON.stringify(payload.metadata)
            : null,
          saliency_score: 1,
          domain_tag: 'work',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (created.type === 'person') {
          previewPeople.push(created);
        }
        result = created;
        break;
      }
      case 'GET_ENTITIES_BY_TYPE':
        result = args[0] === 'person' ? previewPeople : [];
        break;
      case 'GET_PEOPLE_BRIEFING_SUMMARIES':
        result = previewPeople.map((person) => {
          const meetings = previewMeetings[person.id] ?? [];
          const latest = meetings[0] ?? null;
          let role = 'Known from conversations';
          try {
            const metadata = JSON.parse(person.metadata || '{}') as {
              role?: unknown;
            };
            if (typeof metadata.role === 'string' && metadata.role.trim()) {
              role = metadata.role.trim();
            }
          } catch {
            // Preview data without valid metadata keeps the neutral role label.
          }
          return {
            id: person.id,
            name: person.name,
            role,
            meetingCount: meetings.length,
            mentionCount: meetings.reduce(
              (total, meeting) => total + meeting.mention_count,
              0,
            ),
            latestMeetingId: latest?.id ?? null,
            latestMeetingTitle: latest?.title ?? null,
            latestMeetingAt: latest?.started_at ?? latest?.created_at ?? null,
            context: latest?.context ?? null,
            openCommitmentCount:
              previewPersonBriefings[person.id]?.commitments.open.length ?? 0,
            candidateCommitmentCount:
              previewPersonBriefings[person.id]?.commitments.candidates
                .length ?? 0,
            briefHeadline:
              previewPersonBriefings[person.id]?.knowledgeDoc?.scope_key ===
              person.id
                ? 'Avery is coordinating the launch handoff.'
                : null,
            briefStatus:
              previewPersonBriefings[person.id]?.knowledgeDoc?.status ?? null,
            briefUpdatedAt:
              previewPersonBriefings[person.id]?.knowledgeDoc?.updated_at ??
              null,
            possibleDuplicateCount: 0,
          };
        });
        break;
      case 'UPDATE_PERSON_NAME': {
        const payload = args[0] as { personId?: string; name?: string };
        result = previewPeople.find((person) => person.id === payload.personId);
        if (result && payload.name) result = { ...result, name: payload.name };
        break;
      }
      case 'MERGE_PERSON':
      case 'RESTORE_PERSON_MERGE':
      case 'RESOLVE_PERSON_COMMITMENT_OWNER':
        result = undefined;
        break;
      case 'SEARCH_ENTITIES': {
        const query = String(args[0] || '')
          .trim()
          .toLowerCase();
        result = previewPeople.filter((person) =>
          `${person.name} ${person.metadata || ''}`
            .toLowerCase()
            .includes(query),
        );
        break;
      }
      case 'GET_ENTITY_MEETINGS':
        result = previewMeetings[String(args[0])] || [];
        break;
      case 'GET_PERSON_BRIEFING':
        result = previewPersonBriefings[String(args[0])];
        break;
      case 'intelligence:person-chat:capability':
        result = { enabled: true };
        break;
      case 'intelligence:person-chat:list-threads': {
        const request = args[0] as { personId?: string } | undefined;
        const personId = request?.personId ?? 'preview-avery';
        result = [
          {
            id: 'preview-person-chat-current',
            personId,
            title: 'What is Avery focused on?',
            createdAt: '2026-09-12T16:00:00.000Z',
            updatedAt: '2026-09-13T18:30:00.000Z',
            archivedAt: null,
          },
          {
            id: 'preview-person-chat-launch',
            personId,
            title: 'Launch handoff follow-ups',
            createdAt: '2026-09-08T16:00:00.000Z',
            updatedAt: '2026-09-09T18:30:00.000Z',
            archivedAt: '2026-09-10T12:00:00.000Z',
          },
        ];
        break;
      }
      case 'intelligence:person-chat:list-messages':
      case 'GET_PENDING_DREAMING_PROPOSALS':
        result = [];
        break;
      case 'GET_KNOWLEDGE_TIMELINE':
        result = workspaceFor().timeline;
        break;
      case 'GET_KNOWLEDGE_BACKLINKS':
        result = workspaceFor().backlinks;
        break;
      case 'GET_KNOWLEDGE_DOC_NOTES':
        result = null;
        break;
      case 'MEETING_ARTIFACTS_LIST':
        result = [];
        break;
      case 'SAVE_KNOWLEDGE_CORRECTION':
        result = {
          id: 'preview-correction',
          doc_id: 'preview',
          target_kind: 'item',
          target_id: 'preview',
          action: 'promote_item',
          payload_json: null,
          created_at: new Date().toISOString(),
        };
        break;
      default:
        result = null;
        break;
    }

    return result as T;
  };

export const createBrowserIpcFallback = (): IpcRendererLike => {
  const captureJournals = new Map<string, BrowserCaptureJournal>();
  return {
    invoke: createInvokeFallback(captureJournals),
    send: () => {},
    on: () => () => {},
    off: () => {},
  };
};

export const installBrowserIpcFallback = () => {
  if (!window.ipcRenderer && /\bElectron\//.test(navigator.userAgent)) {
    throw new Error(
      'Pluto desktop connection is unavailable: preload did not load.',
    );
  }
  if (!window.plutoRuntimePlatform) {
    const browserPlatform = navigator.platform.toLowerCase();
    window.plutoRuntimePlatform = Object.freeze({
      platform: browserPlatform.includes('mac')
        ? 'darwin'
        : browserPlatform.includes('win')
          ? 'win32'
          : browserPlatform.includes('linux')
            ? 'linux'
            : 'unknown',
      arch: 'unknown',
    });
  }
  if (window.ipcRenderer) return;
  window.__PLUTO_BROWSER_PREVIEW__ = true;
  window.ipcRenderer = createBrowserIpcFallback();
};
