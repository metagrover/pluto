import type { KnowledgeDoc } from '../api/knowledgeDocs';
import type {
  Entity,
  EntityMeeting,
  KnowledgeGraphStats,
} from '../api/knowledgeGraph';
import type { KnowledgeWorkspacePayload } from '../api/knowledgeWorkspace';

type IpcRendererLike = Window['ipcRenderer'];
type BrowserCaptureJournal = {
  activityEvidence?: unknown;
  schemaVersion: 3;
  generation: string;
  revision: number;
  supported: false;
};

const now = new Date().toISOString();

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
      case 'MLX_PREVIEW_HEALTH':
      case 'MLX_PREVIEW_CHECK_PYTHON':
        result = { status: 'ok' };
        break;
      case 'GET_MEETINGS':
      case 'GET_KNOWLEDGE_DOC_SOURCES':
      case 'GET_KNOWLEDGE_CORRECTIONS':
        result = [];
        break;
      case 'BOOT_PROBE_STATUS':
        result = true;
        break;
      case 'CHECK_MICROPHONE_PERMISSION':
        result = 'granted';
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
      case 'GET_ENTITIES_BY_TYPE':
        result = args[0] === 'person' ? previewPeople : [];
        break;
      case 'GET_ENTITY_MEETINGS':
        result = previewMeetings[String(args[0])] || [];
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
    on: () => {},
    off: () => {},
  };
};

export const installBrowserIpcFallback = () => {
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
