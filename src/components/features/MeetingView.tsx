import {
  Check,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  FileText,
  Loader2,
  MoreHorizontal,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import type { MeetingCalendarContext as MeetingCalendarContextValue } from '../../../electron/calendar/types';
import type { Meeting, TranscriptSegment } from '../../types';
import {
  analysisDocumentToMarkdown,
  analysisDocumentV3ToMarkdown,
  parseAnalysisEditConflictsJson,
  parseUserEditsJson,
  resolveMeetingAnalysis,
} from '../../utils/analysisDocument';
import { buildMeetingNotesDocument } from '../../utils/meetingNotesDocument';
import {
  ANALYSIS_SNAPSHOT_PATH,
  restoreAnalysisSnapshot,
} from '../../utils/meetingNotesHistory';
import { meetingTimestamp } from '../../utils/meetingOrdering';
import {
  buildTranscriptSegmentsForPresentation,
  parseTranscriptSegments,
} from '../../utils/transcript';
import {
  buildTranscriptTrustCapabilities,
  canUseTranscriptTrustState,
  resolveTranscriptTrustState,
} from '../../utils/transcriptTrustState';
import { MeetingCalendarContext } from './MeetingCalendarContext';
import { MeetingIdentityControls } from './MeetingIdentityControls';
import { MeetingNotesDocument } from './MeetingNotesDocument';
import { getDownstreamProcessingPresentation } from './downstreamProcessingPresentation';
import type { MeetingActionItemCard } from './meetingActionItems';
import {
  type MeetingRegenerationFailurePresentation,
  resolveMeetingFailurePresentation,
  resolveMeetingRegenerationFailurePresentation,
} from './meetingFailurePresentation';
import { buildMeetingTranscriptTurns } from './meetingTranscriptPresentation';

const SavedEditConflicts = ({
  conflicts,
  onCopy,
}: {
  conflicts: ReturnType<typeof parseAnalysisEditConflictsJson>;
  onCopy: (text: string) => void;
}) => {
  if (conflicts.length === 0) return null;
  return (
    <details
      data-meeting-edit-conflicts
      className="mx-auto mb-5 w-full max-w-[760px] px-6 text-sm text-pro-text-muted md:px-8"
    >
      <summary className="cursor-pointer select-none py-2 text-xs font-medium text-pro-text-muted hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent">
        Saved edits from previous notes
      </summary>
      <div className="mt-1 space-y-4 border-t border-pro-border/60 py-4">
        <p className="max-w-[65ch] text-xs leading-5">
          The current notes remain in place. These saved edits can be copied if
          you want to reapply them.
        </p>
        {conflicts.map((conflict, index) => (
          <section key={`${conflict.path}-${conflict.edited_at}-${index}`}>
            <p className="text-xs font-medium text-pro-text-main">
              Previous generated text
            </p>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-5 text-pro-text-muted">
              {conflict.original}
            </pre>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-pro-text-main">
                Saved edit
              </p>
              <button
                type="button"
                onClick={() => onCopy(conflict.edited)}
                className="rounded px-1.5 py-1 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent"
                aria-label="Copy saved edit"
              >
                Copy
              </button>
            </div>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-5 text-pro-text-main">
              {conflict.edited}
            </pre>
          </section>
        ))}
      </div>
    </details>
  );
};

interface MeetingViewProps {
  selectedMeeting: Meeting | undefined;
  editingTitle: boolean;
  setEditingTitle: (val: boolean) => void;
  titleValue: string;
  setTitleValue: (val: string) => void;
  fetchMeetings: () => void;
  handleCopySummary: (text: string) => void;
  copySuccess: boolean;
  handleDeleteMeeting: (id: string | number) => void;
  highlightEntities: (text: string) => ReactNode;
  transcriptVisible: boolean;
  setTranscriptVisible: (val: boolean) => void;
  onRetryTranscriptValidation?: () => void;
  transcriptValidationRetrying?: boolean;
  calendarContext?: MeetingCalendarContextValue | null;
}

type MeetingNotesTemplate =
  | 'auto'
  | 'one_on_one'
  | 'team_sync'
  | 'customer_call'
  | 'interview'
  | 'project_kickoff';

export const TranscriptIntegrityPanel = ({
  status,
  finalizationStatus,
  integrityJson,
  transcriptJson,
  transcriptValidatedAt,
  audioPath,
  systemAudioPath,
  mixedAudioPath,
  activityEvidenceAvailable = false,
  hasExistingAnalysis = false,
  downstreamFailed = false,
  onRetry,
  retrying = false,
}: {
  status: Meeting['transcript_status'];
  finalizationStatus?: Meeting['finalization_status'];
  integrityJson?: string;
  transcriptJson?: string;
  transcriptValidatedAt?: string;
  audioPath?: string;
  systemAudioPath?: string;
  mixedAudioPath?: string;
  activityEvidenceAvailable?: boolean;
  hasExistingAnalysis?: boolean;
  downstreamFailed?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
}) => {
  let micActivitySeconds = 0;
  let systemActivitySeconds = 0;
  try {
    const integrity = JSON.parse(integrityJson || '{}') as {
      activityEvidence?: {
        windows?: Array<{
          speaker?: unknown;
          startTime?: unknown;
          endTime?: unknown;
        }>;
      };
    };
    for (const window of integrity.activityEvidence?.windows || []) {
      if (
        typeof window.startTime !== 'number' ||
        typeof window.endTime !== 'number'
      ) {
        continue;
      }
      const duration = Math.max(0, window.endTime - window.startTime);
      if (window.speaker === 'Me') micActivitySeconds += duration;
      if (window.speaker === 'Them') systemActivitySeconds += duration;
    }
  } catch {
    // The resolver maps invalid content-free metadata to an honest safe state.
  }
  const capabilities = buildTranscriptTrustCapabilities({
    hasUsableMicArtifact: Boolean(audioPath),
    hasUsableSystemArtifact: Boolean(systemAudioPath),
    hasUsableMixArtifact: Boolean(mixedAudioPath),
    hasSupportedActivityEvidence:
      activityEvidenceAvailable ||
      micActivitySeconds + systemActivitySeconds > 0,
    micActivitySeconds,
    systemActivitySeconds,
    recoverySource: integrityJson?.includes('"source":"capture_journal"')
      ? 'capture_journal'
      : null,
    hasCaptureRecoveryHandler: false,
    canRestoreCaptureGap: false,
    hasExistingTranscript: Boolean(transcriptJson),
    hasExistingDerivedArtifacts: false,
  });
  const trust = resolveTranscriptTrustState(
    {
      transcript_status: status,
      transcript_integrity_json: integrityJson,
      transcript_validated_at: transcriptValidatedAt,
      transcript_json: transcriptJson,
      finalization_status: finalizationStatus,
    },
    capabilities,
  );
  if (hasExistingAnalysis && trust.kind !== 'capture_gap') return null;

  let canRetryFinalTranscription = false;
  try {
    const integrity = JSON.parse(integrityJson || '{}') as {
      finalTranscription?: { policy?: unknown; state?: unknown };
    };
    canRetryFinalTranscription =
      integrity.finalTranscription?.policy === 'parakeet_final_v1' &&
      integrity.finalTranscription.state === 'needs_attention';
  } catch {
    canRetryFinalTranscription = false;
  }

  const panelCopy = resolveMeetingFailurePresentation({
    retryableFinalTranscription: canRetryFinalTranscription,
    captureRecoveryRequired: trust.kind === 'capture_recovery_required',
    captureGap: trust.kind === 'capture_gap',
    hasExistingAnalysis,
    downstreamFailed,
  });

  if (!panelCopy) return null;

  return (
    <section aria-live="polite" className="meeting-failure-notice">
      <span className="meeting-failure-notice__marker" aria-hidden="true">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="meeting-failure-notice__copy">
        <strong>{panelCopy.title}</strong>
        <p>{panelCopy.detail}</p>
      </div>
      {panelCopy.actionLabel && onRetry ? (
        <button
          type="button"
          className="meeting-failure-notice__action"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? (
            <>
              <Loader2
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin"
              />
              Retrying analysis
            </>
          ) : (
            panelCopy.actionLabel
          )}
        </button>
      ) : null}
    </section>
  );
};

export const MeetingAnalysisSkeleton = ({
  title = 'Preparing notes',
  detail,
}: {
  title?: string;
  detail?: string;
}) => (
  <section
    aria-label="Preparing meeting analysis"
    data-meeting-artifact="analysis"
    data-state="loading"
    data-meeting-skeleton="analysis"
    className="meeting-analysis-skeleton max-w-[760px] animate-pulse motion-reduce:animate-none"
  >
    <p className="meeting-analysis-skeleton__label">{title}</p>
    {detail ? <p className="text-sm text-pro-text-muted">{detail}</p> : null}
    <div className="meeting-analysis-skeleton__lines">
      <div className="h-3.5 w-5/6 rounded bg-pro-text-muted/10" />
      <div className="h-3.5 w-3/5 rounded bg-pro-text-muted/10" />
      <div className="h-3.5 w-4/5 rounded bg-pro-text-muted/10" />
    </div>
  </section>
);

export const MeetingAnalysisQueueStatus = ({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) => (
  <output
    aria-atomic="true"
    data-meeting-artifact="analysis"
    data-state="queued"
    className="meeting-analysis-queue max-w-[760px]"
  >
    <p className="meeting-analysis-queue__label">{title}</p>
    <p className="meeting-analysis-queue__detail">{detail}</p>
  </output>
);

export const MeetingAnalysisUnavailable = () => (
  <section
    aria-label="Notes are unavailable"
    data-meeting-analysis-placeholder
    className="meeting-analysis-placeholder"
  >
    <span>Notes</span>
    <p>They will appear here when analysis completes.</p>
  </section>
);

export const MeetingTranscriptSkeleton = () => (
  <div
    aria-label="Preparing transcript"
    data-meeting-skeleton="transcript"
    className="mx-auto max-w-xl space-y-8 pt-4 animate-pulse motion-reduce:animate-none"
  >
    {[
      ['w-12', 'w-full'],
      ['w-16', 'w-10/12'],
      ['w-10', 'w-11/12'],
    ].map(([speakerWidth, textWidth], index) => (
      <div key={index} className="flex gap-12">
        <div
          className={`mt-1 h-3 ${speakerWidth} shrink-0 rounded bg-pro-text-muted/10`}
        />
        <div className="flex-1 space-y-3">
          <div className={`h-4 ${textWidth} rounded bg-pro-text-muted/10`} />
          <div className="h-4 w-3/4 rounded bg-pro-text-muted/10" />
        </div>
      </div>
    ))}
  </div>
);

export const canGenerateMeetingIntelligence = (meeting: Partial<Meeting>) => {
  const trust = resolveTranscriptTrustState(
    {
      transcript_status: meeting.transcript_status,
      transcript_integrity_json: meeting.transcript_integrity_json,
      transcript_validated_at: meeting.transcript_validated_at,
      transcript_json: meeting.transcript_json,
      finalization_status: meeting.finalization_status,
    },
    buildTranscriptTrustCapabilities({
      hasUsableMicArtifact: Boolean(meeting.audio_path),
      hasUsableSystemArtifact: Boolean(meeting.system_audio_path),
      hasUsableMixArtifact: Boolean(meeting.mixed_audio_path),
      hasSupportedActivityEvidence: false,
      micActivitySeconds: 0,
      systemActivitySeconds: 0,
      recoverySource: null,
      hasCaptureRecoveryHandler: false,
      canRestoreCaptureGap: false,
      hasExistingTranscript: Boolean(meeting.transcript_json),
      hasExistingDerivedArtifacts: Boolean(meeting.analysis_json),
    }),
  );
  return canUseTranscriptTrustState(trust, 'generate_new');
};

interface MeetingActionCardsProps {
  items: MeetingActionItemCard[];
  highlightEntities: (text: string) => ReactNode;
  meetingEntitiesLoading: boolean;
  pendingActionId: string | null;
  pendingAttentionId: string | null;
  onToggleAction: (id: string, reopen: boolean) => void;
  onToggleDismissal: (
    attentionItemId: string,
    status: 'active' | 'dismissed' | 'snoozed',
  ) => void;
}

export const MeetingActionCards = ({
  items,
  highlightEntities,
  meetingEntitiesLoading,
  pendingActionId,
  pendingAttentionId,
  onToggleAction,
  onToggleDismissal,
}: MeetingActionCardsProps) => (
  <>
    {items.map((item) => (
      <div
        key={item.id}
        className={`p-6 rounded-md border shadow-sm flex gap-4 transition-all card-hover-effect ${
          item.attentionStatus === 'dismissed'
            ? 'bg-amber-500/5 border-amber-500/20'
            : item.attentionStatus === 'snoozed'
              ? 'bg-sky-500/5 border-sky-500/20'
              : 'bg-pro-surface border-pro-border'
        }`}
      >
        <button
          type="button"
          disabled={
            !item.actionable ||
            pendingActionId === item.id ||
            pendingAttentionId === item.attentionItemId ||
            meetingEntitiesLoading
          }
          onClick={() =>
            item.actionable
              ? onToggleAction(item.id, item.status === 'completed')
              : undefined
          }
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all ${
            item.status === 'completed'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
              : 'border-pro-border text-pro-accent hover:border-pro-accent hover:bg-pro-accent/5'
          } ${
            !item.actionable ||
            pendingActionId === item.id ||
            pendingAttentionId === item.attentionItemId
              ? 'cursor-not-allowed opacity-70'
              : ''
          }`}
          aria-label={item.toggleLabel ?? 'Meeting follow-up'}
          title={item.toggleLabel ?? undefined}
        >
          {pendingActionId === item.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </button>
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-2.5 py-1 text-[10px] font-medium ${
                item.status === 'completed'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : item.status === 'overdue'
                    ? 'bg-red-500/10 text-red-500'
                    : item.status === 'stale'
                      ? 'bg-amber-500/10 text-amber-600'
                      : item.status === 'fallback'
                        ? 'bg-pro-bg text-pro-text-muted'
                        : 'bg-pro-accent/10 text-pro-accent'
              }`}
            >
              {item.status === 'fallback' ? 'Summary' : item.status}
            </span>
            {item.topicLabel ? (
              <span className="text-[11px] font-bold font-medium text-pro-text-muted/65">
                Topic: {item.topicLabel}
              </span>
            ) : null}
            {item.assignee ? (
              <span className="text-[11px] font-bold font-medium text-pro-text-muted/65">
                Owner: {item.assignee}
              </span>
            ) : null}
            {item.statusLabel ? (
              <span className="text-[11px] font-bold font-medium text-pro-text-muted/65">
                Status: {item.statusLabel}
              </span>
            ) : null}
            {item.attentionKindLabel ? (
              <span className="text-[11px] font-bold font-medium text-pro-text-muted/65">
                {item.attentionKindLabel}
              </span>
            ) : null}
            {item.isBlocked ? (
              <span className="text-[11px] font-bold font-medium text-red-600">
                Blocked
              </span>
            ) : null}
            {item.attentionStatus === 'dismissed' ? (
              <span className="text-[11px] font-bold font-medium text-amber-700 dark:text-amber-300">
                Dismissed
              </span>
            ) : item.attentionStatus === 'snoozed' ? (
              <span className="text-[11px] font-bold font-medium text-sky-700 dark:text-sky-300">
                Snoozed
              </span>
            ) : null}
            {item.dueLabel ? (
              <span className="text-[11px] font-bold font-medium text-pro-text-muted/65">
                {item.dueLabel}
              </span>
            ) : null}
          </div>
          <p className="text-[15px] font-medium leading-relaxed text-pro-text-main/80">
            {highlightEntities(item.title)}
          </p>
          {item.context ? (
            <p className="text-[12px] font-medium leading-relaxed text-pro-text-muted">
              {highlightEntities(item.context)}
            </p>
          ) : null}
          {item.blockerReason ? (
            <p className="text-[12px] font-semibold leading-relaxed text-red-600">
              Blocked: {highlightEntities(item.blockerReason)}
            </p>
          ) : null}
          {item.attentionItemId && (item.dismissLabel || item.snoozeLabel) ? (
            <div className="flex flex-wrap gap-3">
              {item.dismissLabel ? (
                <button
                  type="button"
                  disabled={
                    pendingAttentionId === item.attentionItemId ||
                    meetingEntitiesLoading
                  }
                  onClick={() =>
                    onToggleDismissal(
                      item.attentionItemId as string,
                      item.attentionStatus === 'dismissed'
                        ? 'active'
                        : 'dismissed',
                    )
                  }
                  className={`text-[11px] font-medium transition-colors ${
                    pendingAttentionId === item.attentionItemId
                      ? 'cursor-not-allowed text-pro-text-muted/50'
                      : item.attentionStatus === 'dismissed'
                        ? 'text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200'
                        : 'text-pro-text-muted/70 hover:text-pro-accent'
                  }`}
                >
                  {pendingAttentionId === item.attentionItemId
                    ? 'Updating...'
                    : item.dismissLabel}
                </button>
              ) : null}
              {item.snoozeLabel ? (
                <button
                  type="button"
                  disabled={
                    pendingAttentionId === item.attentionItemId ||
                    meetingEntitiesLoading
                  }
                  onClick={() =>
                    onToggleDismissal(
                      item.attentionItemId as string,
                      item.attentionStatus === 'snoozed' ? 'active' : 'snoozed',
                    )
                  }
                  className={`text-[11px] font-medium transition-colors ${
                    pendingAttentionId === item.attentionItemId
                      ? 'cursor-not-allowed text-pro-text-muted/50'
                      : item.attentionStatus === 'snoozed'
                        ? 'text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200'
                        : 'text-pro-text-muted/70 hover:text-sky-600 dark:hover:text-sky-300'
                  }`}
                >
                  {pendingAttentionId === item.attentionItemId
                    ? 'Updating...'
                    : item.snoozeLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    ))}
  </>
);

export const MeetingView = ({
  selectedMeeting,
  editingTitle,
  setEditingTitle,
  titleValue,
  setTitleValue,
  fetchMeetings,
  handleCopySummary,
  handleDeleteMeeting,
  transcriptVisible,
  setTranscriptVisible,
  onRetryTranscriptValidation,
  transcriptValidationRetrying = false,
  calendarContext = null,
}: MeetingViewProps) => {
  if (!selectedMeeting) return null;
  const [isRegeneratingNotes, setIsRegeneratingNotes] = useState(false);
  const [isRestoringNotes, setIsRestoringNotes] = useState(false);
  const [notesTemplate, setNotesTemplate] =
    useState<MeetingNotesTemplate>('auto');
  const [regenerateNotesError, setRegenerateNotesError] =
    useState<MeetingRegenerationFailurePresentation | null>(null);
  const [latestTitle, setLatestTitle] = useState(selectedMeeting.title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveError, setTitleSaveError] = useState<
    'conflict' | 'missing' | 'failed' | null
  >(null);
  const titleEdit = useRef({
    meetingId: selectedMeeting.id,
    expectedTitle: selectedMeeting.title,
    cancelled: false,
    saving: false,
  });

  useEffect(() => {
    setLatestTitle(selectedMeeting.title);
  }, [selectedMeeting.id, selectedMeeting.title]);

  useEffect(() => {
    // Mirror cleanup during Strict Mode replay without discarding a draft
    // supplied on initial mount. A real remount receives the cleared parent.
    setEditingTitle(editingTitle);
    setTitleValue(titleValue);
    return () => {
      titleEdit.current = { ...titleEdit.current };
      setEditingTitle(false);
      setTitleValue('');
    };
  }, []);

  useEffect(() => {
    setIsRegeneratingNotes(false);
    setIsRestoringNotes(false);
    setRegenerateNotesError(null);
    setTitleSaveError(null);
    setIsSavingTitle(false);
    if (titleEdit.current.meetingId !== selectedMeeting.id) {
      setEditingTitle(false);
      setTitleValue(selectedMeeting.title || 'Untitled Session');
    }
    titleEdit.current = {
      meetingId: selectedMeeting.id,
      expectedTitle: selectedMeeting.title,
      cancelled: false,
      saving: false,
    };
  }, [selectedMeeting.id]);

  const saveTitle = async (
    expectedTitle = titleEdit.current.expectedTitle,
    nextTitle = titleValue,
  ) => {
    // Returning to the same meeting is a new visit, not the old pending edit.
    const editSession = titleEdit.current;
    if (editSession.saving) return;
    const title = nextTitle.trim();
    if (!title || title === latestTitle) {
      setTitleValue(latestTitle || 'Untitled Session');
      setTitleSaveError(null);
      setEditingTitle(false);
      return;
    }
    const meetingId = selectedMeeting.id;
    setTitleValue(title);
    editSession.saving = true;
    setIsSavingTitle(true);
    try {
      // Only update the title, never a stale notes/edit snapshot. Keep the
      // edit's original title as the comparison until the user chooses retry.
      const outcome = await window.ipcRenderer.invoke(
        'UPDATE_MEETING_TITLE_IF_CURRENT',
        { meetingId, expectedTitle, title },
      );
      if (titleEdit.current !== editSession) return;
      if (outcome === 'updated' || outcome === 'already_current') {
        setLatestTitle(title);
        setTitleSaveError(null);
        setEditingTitle(false);
        await fetchMeetings();
      } else if (outcome === 'conflict') {
        const current = await window.ipcRenderer.invoke(
          'GET_MEETING',
          meetingId,
        );
        if (titleEdit.current !== editSession) return;
        if (current && typeof current.title === 'string') {
          setLatestTitle(current.title);
          setTitleSaveError('conflict');
          await fetchMeetings();
        } else {
          setTitleSaveError('missing');
        }
      } else {
        setTitleSaveError(outcome === 'missing' ? 'missing' : 'failed');
      }
    } catch {
      if (titleEdit.current === editSession) setTitleSaveError('failed');
    } finally {
      if (titleEdit.current === editSession) {
        editSession.saving = false;
        setIsSavingTitle(false);
      }
    }
  };

  const { v2, v3 } = resolveMeetingAnalysis(selectedMeeting);
  const downstreamPresentation =
    getDownstreamProcessingPresentation(selectedMeeting);
  const canRegenerateMeetingIntelligence =
    canGenerateMeetingIntelligence(selectedMeeting);
  const editsMap = parseUserEditsJson(selectedMeeting.user_edits_json);
  const editConflicts = parseAnalysisEditConflictsJson(
    selectedMeeting.analysis_edit_conflicts_json,
  );
  let transcriptSegments: TranscriptSegment[] = [];
  try {
    transcriptSegments = parseTranscriptSegments(
      selectedMeeting.transcript_json,
    ) as TranscriptSegment[];
  } catch (error) {
    console.error('Failed to parse transcript', error);
  }
  const readableTranscriptSegments = buildTranscriptSegmentsForPresentation(
    selectedMeeting.transcript_json,
    transcriptSegments,
  );
  const transcriptTurns = buildMeetingTranscriptTurns(
    readableTranscriptSegments,
  );
  const hasTranscriptContent = transcriptTurns.length > 0;
  const participantCount = new Set(
    transcriptSegments
      .map((segment) => String(segment.speaker || '').trim())
      .filter(Boolean),
  ).size;

  const canonicalAnalysisMarkdown = v3
    ? analysisDocumentV3ToMarkdown(v3)
    : v2
      ? analysisDocumentToMarkdown(v2)
      : selectedMeeting.enhanced_notes || selectedMeeting.user_notes || '';

  const notesDocument = buildMeetingNotesDocument({
    v2,
    v3,
    userNotes: selectedMeeting.user_notes || '',
    editsMap,
  });
  const pendingUserNotes = !notesDocument.hasAnalysis
    ? selectedMeeting.user_notes?.trim()
    : '';
  const isMeetingProcessing =
    (downstreamPresentation.state === 'loading' ||
      downstreamPresentation.state === 'queued') &&
    !notesDocument.hasAnalysis;

  useEffect(() => {
    if (!isMeetingProcessing) return;
    const interval = window.setInterval(() => fetchMeetings(), 2_000);
    return () => window.clearInterval(interval);
  }, [fetchMeetings, isMeetingProcessing]);

  const regenerateEnhancedNotes = async (
    reason: 'manual' | 'secondary' = 'manual',
  ) => {
    if (isRegeneratingNotes) return;
    if (!canGenerateMeetingIntelligence(selectedMeeting)) {
      setRegenerateNotesError(
        resolveMeetingRegenerationFailurePresentation({
          kind: 'transcript_not_ready',
          hasExistingNotes: notesDocument.hasAnalysis,
        }),
      );
      return;
    }

    setRegenerateNotesError(null);
    setIsRegeneratingNotes(true);
    try {
      await window.ipcRenderer.invoke('GENERATE_MEETING_NOTES', {
        meetingId: selectedMeeting.id,
        requestId: crypto.randomUUID(),
        template: notesTemplate,
        reason,
      });
      await window.ipcRenderer.invoke('GET_MEETING', selectedMeeting.id);
      await fetchMeetings();
    } catch (error) {
      console.error('Failed to regenerate enhanced notes:', error);
      setRegenerateNotesError(
        resolveMeetingRegenerationFailurePresentation({
          kind: 'request_failed',
          error,
          hasExistingNotes: notesDocument.hasAnalysis,
        }),
      );
    } finally {
      setIsRegeneratingNotes(false);
    }
  };

  const restorePreviousGeneratedNotes = async () => {
    if (isRestoringNotes) return;
    if (!restoreAnalysisSnapshot(selectedMeeting)) return;

    setIsRestoringNotes(true);
    setRegenerateNotesError(null);
    try {
      await window.ipcRenderer.invoke('RESTORE_MEETING_NOTES', {
        meetingId: selectedMeeting.id,
      });
      await fetchMeetings();
    } catch (error) {
      console.error('Failed to restore previous generated notes:', error);
      setRegenerateNotesError({
        title: "Previous notes weren't restored",
        detail: 'Your current notes are unchanged.',
        canRetry: false,
      });
    } finally {
      setIsRestoringNotes(false);
    }
  };

  return (
    <div
      key={selectedMeeting.id}
      data-meeting-page
      className={`meeting-document w-full ${
        transcriptVisible ? '' : 'meeting-document--transcript-collapsed'
      } ${isMeetingProcessing ? 'meeting-document--processing' : ''}`}
    >
      <div className="meeting-notes-surface" aria-label="Notes">
        <header className="meeting-document-header">
          <TextareaAutosize
            value={
              editingTitle || titleSaveError || isSavingTitle
                ? titleValue
                : latestTitle || 'Untitled Session'
            }
            onFocus={() => {
              titleEdit.current.cancelled = false;
              if (editingTitle || titleSaveError) return;
              titleEdit.current.expectedTitle = latestTitle;
              setEditingTitle(true);
              setTitleValue(latestTitle || 'Untitled Session');
            }}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={() => {
              if (titleEdit.current.cancelled) {
                titleEdit.current.cancelled = false;
                return;
              }
              if (!titleSaveError) void saveTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                if (titleEdit.current.saving) return;
                titleEdit.current.cancelled = true;
                setTitleValue(latestTitle || 'Untitled Session');
                setTitleSaveError(null);
                setEditingTitle(false);
                e.currentTarget.blur();
              }
            }}
            className="meeting-document-title w-full bg-transparent outline-none resize-none mb-0 p-0 block overflow-hidden"
            spellCheck={false}
            aria-label="Meeting title"
            aria-describedby={
              titleSaveError ? 'meeting-title-save-error' : undefined
            }
            aria-busy={isSavingTitle}
            readOnly={isSavingTitle}
          />
          {titleSaveError ? (
            <output
              id="meeting-title-save-error"
              data-meeting-title-save-error
              className="mb-3 block text-xs leading-5 text-pro-text-muted"
            >
              <span className="block">
                {titleSaveError === 'conflict'
                  ? `Title not saved. The current title is “${latestTitle}”. Your edit is still here.`
                  : titleSaveError === 'missing'
                    ? 'Title not saved. This meeting is no longer available. Your edit is still here to copy.'
                    : 'Title not saved. Your edit is still here.'}
              </span>
              {titleSaveError !== 'missing' ? (
                <button
                  type="button"
                  disabled={isSavingTitle}
                  onClick={() =>
                    void saveTitle(
                      titleSaveError === 'conflict'
                        ? latestTitle
                        : titleEdit.current.expectedTitle,
                    )
                  }
                  className="rounded px-1.5 py-1 text-xs font-medium text-pro-text-muted hover:bg-pro-hover hover:text-pro-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pro-accent disabled:opacity-50"
                >
                  {isSavingTitle
                    ? 'Saving…'
                    : titleSaveError === 'conflict'
                      ? 'Save my title instead'
                      : 'Try again'}
                </button>
              ) : null}
            </output>
          ) : null}
          <div className="meeting-document-meta-row">
            <div className="meeting-document-meta min-w-0">
              <span>
                {new Date(
                  selectedMeeting
                    ? meetingTimestamp(selectedMeeting)
                    : Date.now(),
                ).toLocaleString([], {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              {participantCount > 0 ? (
                <span>
                  {participantCount}{' '}
                  {participantCount === 1 ? 'participant' : 'participants'}
                </span>
              ) : selectedMeeting.duration_seconds ? (
                <span>
                  {selectedMeeting.duration_seconds < 60
                    ? '< 1 min'
                    : `${Math.floor(selectedMeeting.duration_seconds / 60)} min`}
                </span>
              ) : null}
            </div>
            <div className="meeting-document-actions">
              {editsMap[ANALYSIS_SNAPSHOT_PATH] ? (
                <button
                  type="button"
                  onClick={() => void restorePreviousGeneratedNotes()}
                  disabled={isRestoringNotes}
                  className="meeting-toolbar-button meeting-toolbar-button--undo"
                  aria-label="Restore previous generated notes"
                >
                  {isRestoringNotes ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Undo2 className="h-4 w-4 opacity-70 mr-1.5" />
                  )}
                  <span>
                    {isRestoringNotes ? 'Restoring…' : 'Undo rewrite'}
                  </span>
                </button>
              ) : null}
              {downstreamPresentation.state === 'ready' &&
              canRegenerateMeetingIntelligence ? (
                <button
                  type="button"
                  onClick={() => void regenerateEnhancedNotes()}
                  disabled={isRegeneratingNotes}
                  className={`meeting-toolbar-button ${
                    isRegeneratingNotes
                      ? 'opacity-50 cursor-not-allowed'
                      : 'meeting-toolbar-button--primary'
                  } px-3 mr-1 h-9`}
                  aria-label={
                    isRegeneratingNotes
                      ? 'Generating Enhanced Notes...'
                      : 'Regenerate Enhanced Notes'
                  }
                >
                  {isRegeneratingNotes ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <Sparkles className="w-4 h-4 opacity-70 mr-1.5" />
                  )}
                  <span className="font-medium text-sm">
                    {isRegeneratingNotes ? 'Writing…' : 'Regenerate'}
                  </span>
                </button>
              ) : null}
              <details className="meeting-document-menu">
                <summary aria-label="Meeting note actions">
                  <MoreHorizontal aria-hidden="true" size={18} />
                </summary>
                <div className="meeting-document-menu__panel">
                  <div className="meeting-document-menu__section">
                    <label className="meeting-template-picker">
                      <span className="meeting-template-picker__label">
                        Notes template
                      </span>
                      <select
                        value={notesTemplate}
                        onChange={(event) =>
                          setNotesTemplate(
                            event.target.value as MeetingNotesTemplate,
                          )
                        }
                        aria-label="Notes template"
                      >
                        <option value="auto">Auto</option>
                        <option value="one_on_one">1:1</option>
                        <option value="team_sync">Team sync</option>
                        <option value="customer_call">Customer call</option>
                        <option value="interview">Interview</option>
                        <option value="project_kickoff">Project kickoff</option>
                      </select>
                    </label>
                  </div>
                  <div className="meeting-document-menu__section">
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedMeeting) {
                          const summaryText = canonicalAnalysisMarkdown;
                          const content = `Session: ${selectedMeeting.title}\nDate: ${selectedMeeting.created_at}\n\nSummary:\n${summaryText}\n\nTranscript:\n${selectedMeeting.transcript_json}`;
                          const blob = new Blob([content], {
                            type: 'text/plain',
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `pluto-session-${selectedMeeting.id}.txt`;
                          a.click();
                        }
                      }}
                      className="meeting-toolbar-button"
                      aria-label="Export meeting"
                    >
                      <svg
                        aria-hidden="true"
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      <span>Export meeting</span>
                    </button>
                  </div>
                  {selectedMeeting.finalization_status !==
                  'recovery_required' ? (
                    <div className="meeting-document-menu__section meeting-document-menu__section--danger">
                      <button
                        type="button"
                        onClick={() => handleDeleteMeeting(selectedMeeting.id)}
                        className="meeting-toolbar-button meeting-toolbar-button--danger"
                        aria-label="Delete meeting"
                      >
                        <svg
                          aria-hidden="true"
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                        <span>Delete meeting</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
          {calendarContext ? (
            <MeetingCalendarContext
              context={calendarContext}
              canSuggestTitle={
                /^(meeting(?: \d+)?|new meeting|untitled (?:meeting|session))$/i.test(
                  latestTitle.trim(),
                ) && calendarContext.event.title.trim() !== latestTitle.trim()
              }
              onUseTitle={(title) =>
                void saveTitle(titleEdit.current.expectedTitle, title)
              }
            />
          ) : null}
        </header>
        <TranscriptIntegrityPanel
          status={selectedMeeting.transcript_status}
          finalizationStatus={selectedMeeting.finalization_status}
          integrityJson={selectedMeeting.transcript_integrity_json}
          transcriptJson={selectedMeeting.transcript_json}
          transcriptValidatedAt={selectedMeeting.transcript_validated_at}
          audioPath={selectedMeeting.audio_path}
          systemAudioPath={selectedMeeting.system_audio_path}
          mixedAudioPath={selectedMeeting.mixed_audio_path}
          activityEvidenceAvailable={Boolean(
            selectedMeeting.transcript_integrity_json?.includes(
              '"activityEvidence"',
            ),
          )}
          hasExistingAnalysis={Boolean(
            selectedMeeting.analysis_json || selectedMeeting.enhanced_notes,
          )}
          downstreamFailed={downstreamPresentation.state === 'failed'}
          onRetry={onRetryTranscriptValidation}
          retrying={transcriptValidationRetrying}
        />
        {regenerateNotesError ? (
          <section
            className="meeting-failure-notice meeting-failure-notice--regeneration"
            role="alert"
            aria-live="polite"
          >
            <span className="meeting-failure-notice__marker" aria-hidden="true">
              <CircleAlert className="h-3.5 w-3.5" />
            </span>
            <div className="meeting-failure-notice__copy">
              <strong>{regenerateNotesError.title}</strong>
              <p>{regenerateNotesError.detail}</p>
            </div>
            {regenerateNotesError.canRetry ? (
              <button
                type="button"
                className="meeting-failure-notice__action"
                onClick={() => void regenerateEnhancedNotes()}
                disabled={isRegeneratingNotes}
              >
                {isRegeneratingNotes ? 'Trying again…' : 'Try again'}
              </button>
            ) : null}
            <button
              type="button"
              className="meeting-failure-notice__dismiss"
              aria-label="Dismiss regeneration error"
              onClick={() => setRegenerateNotesError(null)}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </section>
        ) : null}

        {pendingUserNotes ? (
          <section
            className="meeting-pending-notes"
            data-meeting-artifact="user-notes"
            data-state="processing"
            aria-label="Your notes"
          >
            <div className="meeting-pending-notes__content">
              <p className="meeting-pending-notes__label">Your notes</p>
              <p className="meeting-pending-notes__body">{pendingUserNotes}</p>
            </div>
          </section>
        ) : null}

        {isMeetingProcessing && downstreamPresentation.state === 'loading' ? (
          <MeetingAnalysisSkeleton
            title={downstreamPresentation.title}
            detail={downstreamPresentation.detail}
          />
        ) : null}
        {isMeetingProcessing && downstreamPresentation.state === 'queued' ? (
          <MeetingAnalysisQueueStatus
            title={downstreamPresentation.title}
            detail={downstreamPresentation.detail}
          />
        ) : null}
        {downstreamPresentation.state === 'failed' &&
        !notesDocument.hasAnalysis ? (
          <MeetingAnalysisUnavailable />
        ) : null}
        {notesDocument.hasAnalysis ? (
          <div data-meeting-artifact="analysis" data-state="ready">
            {downstreamPresentation.state === 'ready' &&
            downstreamPresentation.notesUpdateQueuePosition ? (
              <output
                aria-atomic="true"
                className="mx-auto mb-4 block w-full max-w-[760px] px-5 text-sm text-pro-text-muted md:px-8"
              >
                {downstreamPresentation.notesUpdateQueuePosition === 1
                  ? 'Notes update is next in the local queue.'
                  : `Notes update is position ${downstreamPresentation.notesUpdateQueuePosition} in the local queue.`}
              </output>
            ) : null}
            {downstreamPresentation.state === 'ready' &&
            downstreamPresentation.notesUpdateFailed &&
            !regenerateNotesError &&
            !isRegeneratingNotes ? (
              <output className="mx-auto mb-4 block w-full max-w-[760px] px-5 text-sm text-pro-text-muted md:px-8">
                Couldn’t update notes. Your previous notes are still here.
              </output>
            ) : null}
            {downstreamPresentation.state === 'ready' &&
            downstreamPresentation.secondaryStatus ? (
              <output className="mx-auto mb-4 flex w-full max-w-[760px] items-center gap-3 px-5 text-sm text-pro-text-muted md:px-8">
                <span>
                  {downstreamPresentation.secondaryStatus === 'failed'
                    ? 'Notes are ready. Related insights could not finish.'
                    : 'Notes are ready. Updating related insights…'}
                </span>
                {downstreamPresentation.secondaryStatus === 'failed' ? (
                  <button
                    type="button"
                    className="underline underline-offset-2 disabled:opacity-50"
                    disabled={isRegeneratingNotes}
                    onClick={() => void regenerateEnhancedNotes('secondary')}
                  >
                    {isRegeneratingNotes ? 'Retrying…' : 'Retry insights'}
                  </button>
                ) : null}
              </output>
            ) : null}
            <SavedEditConflicts
              conflicts={editConflicts}
              onCopy={handleCopySummary}
            />
            <MeetingNotesDocument
              meeting={selectedMeeting}
              model={notesDocument}
              transcriptSegments={transcriptSegments}
              onDocumentChanged={fetchMeetings}
              onShowTranscript={() => setTranscriptVisible(true)}
            />
          </div>
        ) : null}
      </div>

      {!transcriptVisible ? (
        <div className="meeting-transcript-toggle-wrap">
          <button
            type="button"
            data-meeting-transcript-toggle
            className="meeting-transcript-toggle"
            onClick={() => setTranscriptVisible(true)}
          >
            <FileText aria-hidden="true" size={17} />
            <span>Transcript</span>
            <span className="meeting-transcript-toggle__action">
              View
              <ChevronRight aria-hidden="true" size={16} />
            </span>
          </button>
        </div>
      ) : null}

      {transcriptVisible && (
        <section
          data-meeting-artifact="transcript"
          data-reading-surface="meeting-transcript"
          data-state={hasTranscriptContent ? 'ready' : 'loading'}
          className="meeting-transcript-surface"
          aria-labelledby="meeting-transcript-heading"
        >
          <header className="meeting-transcript-header">
            <div className="meeting-transcript-header__title">
              <p>Source record</p>
              <h2 id="meeting-transcript-heading">Transcript</h2>
            </div>
            <button
              type="button"
              onClick={() => setTranscriptVisible(false)}
              aria-label="Close transcript"
            >
              <span>Hide</span>
              <ChevronUp aria-hidden="true" size={15} />
            </button>
          </header>
          <div className="meeting-transcript-record">
            <MeetingIdentityControls meetingId={String(selectedMeeting.id)} />
            {hasTranscriptContent ? (
              transcriptTurns.map((turn) => {
                const text = turn.segments
                  .map((segment) => segment.text)
                  .join(' ');
                const seconds = turn.startSeconds;
                const timestamp = `${Math.floor(seconds / 60)}:${Math.floor(
                  seconds % 60,
                )
                  .toString()
                  .padStart(2, '0')}`;
                return (
                  <div key={turn.id} className="meeting-transcript-row">
                    <div>
                      <strong>{turn.speaker || 'Unknown speaker'}</strong>
                      <time>{timestamp}</time>
                    </div>
                    <p>{text}</p>
                  </div>
                );
              })
            ) : (
              <MeetingTranscriptSkeleton />
            )}
          </div>
        </section>
      )}
    </div>
  );
};
