import type {
  CalendarEvent,
  CalendarIntegrationSnapshot,
} from '../../electron/calendar/types';
import type { KnowledgeDoc } from '../api/knowledgeDocs';
import type {
  Entity,
  EntityMeeting,
  KnowledgeGraphStats,
  PersonBriefingDetail,
} from '../api/knowledgeGraph';
import type { KnowledgeWorkspacePayload } from '../api/knowledgeWorkspace';
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
  const productReview = atToday(10, 30, 45);
  const weeklySync = atToday(13, 0, 30);
  const customerResearch = atToday(15, 30, 30);
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
  });
  return [
    build('preview-product-review', 'Product design review', productReview, [
      'Maya',
      'Jordan',
    ]),
    build('preview-weekly-sync', 'Weekly team sync', weeklySync, [
      'Avery',
      'Priya',
    ]),
    build('preview-customer-research', 'Customer research', customerResearch, [
      'Sam',
    ]),
  ];
};

const meetingPreviewEnabled = (): boolean =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === 'meeting';

const previewMeeting: Meeting = {
  id: 'preview-architecture-docs',
  title: 'Architecture docs review',
  meeting_type: 'Recording',
  created_at: '2025-05-14T10:02:00-07:00',
  started_at: '2025-05-14T10:02:00-07:00',
  duration_seconds: 54 * 60,
  finalization_status: 'finalized',
  transcript_status: 'validated',
  transcript_validated_at: '2025-05-14T10:56:00.000Z',
  user_notes:
    'Keep the documentation lightweight and make architectural decisions easy to find.',
  transcript_json: JSON.stringify({
    lifecycleStatus: 'validated',
    segments: [
      {
        speaker: 'Maya Chen',
        start: 300,
        end: 326,
        text: "I'd like us to adopt a docs-as-code approach using Markdown in the repo so that documentation lives alongside the code and can be versioned and reviewed the same way.",
      },
      {
        speaker: 'Daniel Lee',
        start: 360,
        end: 383,
        text: 'Agreed. Markdown keeps it lightweight, and we can use frontmatter for metadata. It will also make contributions easier.',
      },
      {
        speaker: 'Priya Nair',
        start: 420,
        end: 438,
        text: "Shipping docs with the repo will help us catch issues earlier in PRs. Let's do that.",
      },
    ],
  }),
  analysis_schema_version: 3,
  analysis_json: JSON.stringify({
    analysis_schema_version: 3,
    overview: 'System context diagrams now reflect the new data pipeline.',
    all_decisions: [
      {
        text: 'We will adopt a docs-as-code approach using Markdown in the repo.',
        decided_by: 'Maya Chen',
        evidence:
          "Maya Chen: I'd like us to adopt a docs-as-code approach using Markdown in the repo.",
      },
      {
        text: 'Architecture diagrams will be generated from code and reviewed in CI.',
        decided_by: 'Team',
      },
      {
        text: 'The docs site will remain on the existing Docusaurus setup.',
        decided_by: 'Team',
      },
    ],
    all_action_items: [
      {
        text: 'Add a “How decisions are made” section to the architecture overview.',
        assignee: 'Daniel Lee',
        due: 'Friday',
        topic: 'Documentation architecture',
      },
      {
        text: 'Schedule the next architecture review in two weeks.',
        assignee: 'Priya Nair',
        topic: 'Documentation architecture',
      },
    ],
    topics: [
      {
        title: 'Documentation architecture',
        summary: 'ADR-042 was accepted and its sequence diagram was added.',
        key_points: [
          { text: 'Terminology now uses “tenant” instead of “account”.' },
          {
            text: 'Performance constraints now include error-budget targets.',
          },
        ],
        decisions: [],
        action_items: [],
        open_questions: [
          'How will we version the OpenAPI docs alongside the service?',
          'Do we need a separate repository for decision records?',
          'What is the retention policy for diagrams generated in CI?',
          'Should automatic link checking run in the docs build?',
        ],
        transcript_range: [0, 2],
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
    id: 'preview-roadmap-sync',
    title: 'Q2 roadmap sync',
    created_at: '2025-05-13T15:30:00-07:00',
    started_at: '2025-05-13T15:30:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-design-critique',
    title: 'Design critique',
    created_at: '2025-05-13T11:00:00-07:00',
    started_at: '2025-05-13T11:00:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-api-review',
    title: 'API review',
    created_at: '2025-05-12T16:00:00-07:00',
    started_at: '2025-05-12T16:00:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-weekly-eng',
    title: 'Weekly eng sync',
    created_at: '2025-05-09T09:30:00-07:00',
    started_at: '2025-05-09T09:30:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-incident',
    title: 'Incident postmortem',
    created_at: '2025-05-07T14:00:00-07:00',
    started_at: '2025-05-07T14:00:00-07:00',
  },
  {
    ...previewMeeting,
    id: 'preview-hiring-plan',
    title: 'Hiring plan review',
    created_at: '2025-05-05T10:30:00-07:00',
    started_at: '2025-05-05T10:30:00-07:00',
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

const previewPeople: Entity[] = [
  {
    id: 'preview-avery',
    type: 'person',
    name: 'Avery Chen',
    normalized_name: 'avery chen',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Design lead' }),
    saliency_score: 0.92,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-maya',
    type: 'person',
    name: 'Maya Ortiz',
    normalized_name: 'maya ortiz',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Product partner' }),
    saliency_score: 0.86,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
  {
    id: 'preview-jordan',
    type: 'person',
    name: 'Jordan Lee',
    normalized_name: 'jordan lee',
    status: 'active',
    due_date: null,
    assigned_to: null,
    metadata: JSON.stringify({ role: 'Engineering' }),
    saliency_score: 0.81,
    domain_tag: 'work',
    created_at: now,
    updated_at: now,
  },
];

const previewMeetings: Record<string, EntityMeeting[]> = {
  'preview-avery': [
    {
      id: 'preview-product-review',
      title: 'Product review',
      meeting_type: 'work',
      started_at: '2026-07-12T17:00:00.000Z',
      ended_at: null,
      duration_seconds: 2700,
      created_at: '2026-07-12T17:00:00.000Z',
      mention_count: 6,
      context: 'Aligned on the rollout sequence and evidence requirements.',
    },
  ],
  'preview-maya': [
    {
      id: 'preview-weekly-sync',
      title: 'Weekly product sync',
      meeting_type: 'work',
      started_at: '2026-07-10T16:30:00.000Z',
      ended_at: null,
      duration_seconds: 1800,
      created_at: '2026-07-10T16:30:00.000Z',
      mention_count: 4,
      context: 'Pressure-tested the current read and attention hierarchy.',
    },
  ],
  'preview-jordan': [
    {
      id: 'preview-implementation-review',
      title: 'Implementation review',
      meeting_type: 'work',
      started_at: '2026-07-08T18:00:00.000Z',
      ended_at: null,
      duration_seconds: 2400,
      created_at: '2026-07-08T18:00:00.000Z',
      mention_count: 3,
      context: 'Reviewed delivery risks and the next implementation slice.',
    },
  ],
};

const previewPersonContextDoc: KnowledgeDoc = {
  id: 'preview-avery-context',
  scope_type: 'person_context',
  scope_key: 'preview-avery',
  title: 'Conversations with Avery Chen',
  rendered_content: null,
  config: null,
  status: 'up_to_date',
  last_synthesized_at: now,
  last_source_cursor: null,
  updated_at: now,
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
        last_reinforced_at: now,
        freshness: 'fresh',
      },
    },
    active_streams: [],
    needs_attention: [],
    patterns: [
      {
        id: 'preview-pattern',
        title: 'Prefers written review before handoff',
        summary:
          'A short written review helps Avery close handoffs with fewer open questions.',
        kind: 'pattern',
        severity: 'steady',
        why_now: 'Repeated across launch handoffs.',
        stream_ids: [],
        citations: [
          {
            meeting_id: 'preview-product-review',
            quote: 'Send the review first.',
          },
          {
            meeting_id: 'preview-launch-handoff',
            quote: 'The written review keeps the handoff clear.',
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
        id: 'preview-evidence-product-review',
        meeting_id: 'preview-product-review',
        meeting_title: 'Product review',
        captured_at: now,
        quote: 'Send the review first.',
        stream_ids: [],
        item_ids: ['preview-pattern'],
        mode: 'direct',
        confidence: 0.9,
      },
      {
        id: 'preview-evidence-launch-handoff',
        meeting_id: 'preview-launch-handoff',
        meeting_title: 'Launch handoff',
        captured_at: now,
        quote: 'The written review keeps the handoff clear.',
        stream_ids: [],
        item_ids: ['preview-pattern'],
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
      added_count: 1,
      removed_count: 0,
      updated_count: 0,
      notable_changes: [],
    },
  }),
};

const previewPersonBriefings: Record<string, PersonBriefingDetail> = {
  'preview-avery': {
    person: previewPeople[0],
    isSelf: false,
    meetings: [
      {
        id: 'preview-product-review',
        title: 'Product review',
        started_at: '2026-07-12T17:00:00.000Z',
        created_at: '2026-07-12T17:00:00.000Z',
        duration_seconds: 2700,
        context: 'Aligned on the rollout sequence and evidence requirements.',
        evidence: 'confirmed',
      },
      {
        id: 'preview-launch-handoff',
        title: 'Launch handoff',
        started_at: '2026-07-10T16:30:00.000Z',
        created_at: '2026-07-10T16:30:00.000Z',
        duration_seconds: 1800,
        context: 'Closed the written handoff review.',
        evidence: 'confirmed',
      },
      {
        id: 'preview-roadmap-planning',
        title: 'Roadmap planning',
        started_at: '2026-07-08T16:30:00.000Z',
        created_at: '2026-07-08T16:30:00.000Z',
        duration_seconds: 2400,
        context: 'Avery was mentioned in the rollout discussion.',
        evidence: 'mentioned',
      },
    ],
    commitments: {
      open: [
        {
          id: 'preview-avery-open',
          text: 'Send the final launch review',
          status: 'active',
          dueDate: '2026-09-03T17:00:00.000Z',
          evidence: 'I will send the final review on Thursday.',
          sourceMeetingId: 'preview-product-review',
          sourceMeetingTitle: 'Product review',
          updatedAt: now,
        },
      ],
      delivered: [
        {
          id: 'preview-avery-delivered',
          text: 'Shared the prototype walkthrough',
          status: 'completed',
          dueDate: null,
          evidence: 'I shared the walkthrough with the launch group.',
          sourceMeetingId: 'preview-launch-handoff',
          sourceMeetingTitle: 'Launch handoff',
          updatedAt: now,
        },
      ],
      candidates: [
        {
          id: 'preview-avery-candidate',
          text: 'Share final launch notes with the review group',
          status: 'active',
          dueDate: null,
          evidence: 'Avery can send the final notes after the review.',
          sourceMeetingId: 'preview-product-review',
          sourceMeetingTitle: 'Product review',
          updatedAt: now,
          suggestedOwnerName: 'Avery Chen',
        },
      ],
    },
    knowledgeDoc: previewPersonContextDoc,
    workingMemorySnapshot: null,
    mergedPeople: [],
  },
  ...Object.fromEntries(
    previewPeople.slice(1).map((person) => [
      person.id,
      {
        person,
        isSelf: false,
        meetings: (previewMeetings[person.id] ?? []).map((meeting) => ({
          id: meeting.id,
          title: meeting.title,
          started_at: meeting.started_at,
          created_at: meeting.created_at,
          duration_seconds: meeting.duration_seconds,
          context: meeting.context,
          evidence: 'mentioned' as const,
        })),
        commitments: { open: [], delivered: [], candidates: [] },
        knowledgeDoc: null,
        workingMemorySnapshot: null,
        mergedPeople: [],
      },
    ]),
  ),
};

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
      case 'GET_ACTION_ITEMS_BY_STATUS':
        result = [];
        break;
      case 'GET_KNOWLEDGE_GRAPH_STATS':
        result = emptyGraphStats;
        break;
      case 'GET_PROJECT_PORTFOLIO':
        result = [];
        break;
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
