import { OLLAMA_GENERAL_MODEL } from '../../src/utils/ollamaModels';
import type { AnalysisProvider, MeetingType } from './analysisTypes';

// Shared by generation metadata and persistent run/cache identity.
export const NOTES_PROMPT_VERSION = 'notes-v29';
export const NOTES_OLLAMA_MODEL = OLLAMA_GENERAL_MODEL;
export const NOTES_EDITOR_PROMPT_VERSION = NOTES_PROMPT_VERSION;

export type SourceSpan = {
  segment: number;
  start: number;
  end: number;
};

export type SourceSegment = {
  index: number;
  speaker: string | null;
  text: string;
};

export type NotesSource = {
  revision: string;
  segments: readonly SourceSegment[];
};

export type SupportedText = {
  id: string;
  text: string;
  sources: SourceSpan[];
};

export type NotesItem = SupportedText & {
  kind: 'point' | 'action' | 'decision' | 'question';
  owner: string | null;
  due: string | null;
};

export type NotesSection = {
  id: string;
  title: SupportedText;
  items: NotesItem[];
};

export type NotesDraft = {
  meetingType: MeetingType;
  overview: SupportedText | null;
  sections: NotesSection[];
  recentWin?: { win: SupportedText; impact: SupportedText };
};

export type AuditChange =
  | { op: 'replace'; target: string; value: SupportedText | NotesItem }
  | { op: 'remove'; target: string }
  | { op: 'insert'; section: string; value: NotesItem }
  | { op: 'insert_section'; value: NotesSection };

export type AuditVerdict = {
  target: string;
  status: 'supported' | 'uncertain' | 'unsupported';
  sources: SourceSpan[];
};

export type NotesAudit = {
  changes: AuditChange[];
  verdicts: AuditVerdict[];
  dispositions: Array<{
    target: string;
    kind: 'deduplicated' | 'cancelled' | 'superseded';
    replacementId: string | null;
    sources: SourceSpan[];
  }>;
  terminology: Array<{
    rawForms: string[];
    preferredTerm: string | null;
    segmentIndexes: number[];
    confidence: 'high' | 'medium' | 'low';
    signals: string[];
  }>;
};

export type NotesTask = 'notesWriter' | 'notesAudit' | 'notesMerge';
export type NotesResponseContract =
  | 'draft'
  | 'compact_draft'
  | 'audit'
  | 'editor';

export type NotesRequest = {
  task: NotesTask;
  responseContract: NotesResponseContract;
  prompt: string;
  outputTokens: number;
  contextTokens: number;
  signal?: AbortSignal;
  sourceSpans?: SourceSpan[];
};

export type GenerateNotesText = (request: NotesRequest) => Promise<string>;

export type NotesContext = {
  userNotes: string;
  template: import('./prompts').MeetingNotesTemplate;
  trustedUserTerms: string[];
  entityHints: string[];
};

export type GenerateMeetingNotesInput = {
  /** Complete-document review used by the compact direct pipeline. */
  reviewProtocol?: 'editor';
  /** Benchmark-only experiment. Product callers must retain the default. */
  hierarchyAuditStrategy?: 'every_node' | 'final_only' | 'deterministic_only';
  /** Compact direct writer; deterministic-only remains a benchmark route. */
  compactWriterContract?: boolean;
  source: NotesSource;
  context: NotesContext;
  generate: GenerateNotesText;
  provider: AnalysisProvider;
  model: string;
  contextTokens: number;
  signal?: AbortSignal;
  onRepair?: (task: NotesTask) => void;
  /** Benchmark-only experiment. Product callers must retain the default. */
  recoverWriterDraft?: (raw: string) => string | null;
  onDeterministicWriterRecovery?: () => void;
  onStage?: (task: NotesTask) => void;
  onPlan?: (plan: { plannedLeafCount: number }) => void;
  onRepartition?: () => void;
  /** Product deadline for optional model review; writers remain fail-closed. */
  optionalReviewDeadlineAtMs?: number;
  /** Minimum remaining wall time required before starting optional review. */
  optionalReviewMinStartMs?: number;
  stageCache?: import('./meetingNotesStageCache').NotesStageCache;
  cacheKey?: string;
};

export type NotesValidationCategory =
  | 'schema'
  | 'source_reference'
  | 'guardrail'
  | 'inherited_commitment'
  | 'validation';

export class MeetingNotesError extends Error {
  constructor(
    public readonly code: string,
    public readonly validationCategory?: NotesValidationCategory,
  ) {
    super(code);
    this.name = 'MeetingNotesError';
  }
}
