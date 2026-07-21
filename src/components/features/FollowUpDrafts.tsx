import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Meeting } from '../../types';
import {
  type FollowUpFormat,
  type FollowUpVariants,
  type SavedFollowUpDraftsV2,
  composeFollowUp,
  createSavedFollowUpDrafts,
  mergeRefinedVariants,
  parseSavedFollowUpDrafts,
} from './followUpComposition';

interface FollowUpDraftsProps {
  meeting: Meeting;
  overview: string[];
  actionItems: string[];
  decisions: string[];
  entityContext: string[];
  discussionPoints: string[];
  participants: string[];
  openQuestions: string[];
  topicSummaries: string[];
  fetchMeetings: () => void;
}

const FORMAT_OPTIONS: Array<{ id: FollowUpFormat; label: string }> = [
  { id: 'email', label: 'Email' },
  { id: 'internal', label: 'Internal' },
  { id: 'slack', label: 'Slack' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type CopyState = 'idle' | 'copied' | 'error';

const getInitialDocument = (
  savedValue: string | undefined,
  composition: ReturnType<typeof composeFollowUp>,
): SavedFollowUpDraftsV2 =>
  parseSavedFollowUpDrafts(savedValue, composition) ||
  createSavedFollowUpDrafts(composition);

const getRefinedVariants = (value: unknown): FollowUpVariants | null => {
  if (!value || typeof value !== 'object') return null;
  const drafts = (value as { drafts?: unknown }).drafts;
  if (!Array.isArray(drafts) || drafts.length < 3) return null;
  const contents = drafts.slice(0, 3).map((draft) => {
    if (!draft || typeof draft !== 'object') return '';
    const content = (draft as { content?: unknown }).content;
    return typeof content === 'string' ? content.trim() : '';
  });
  if (contents.some((content) => !content)) return null;
  return {
    email: contents[0],
    internal: contents[1],
    slack: contents[2],
  };
};

export const FollowUpDrafts: React.FC<FollowUpDraftsProps> = ({
  meeting,
  overview,
  actionItems,
  decisions,
  entityContext,
  discussionPoints,
  participants,
  openQuestions,
  topicSummaries,
}) => {
  const composition = useMemo(
    () =>
      composeFollowUp({
        meetingTitle: meeting.title,
        overview,
        actionItems,
        decisions,
        entityContext,
        discussionPoints,
        participants,
        openQuestions,
        topicSummaries,
      }),
    [
      meeting.title,
      overview,
      actionItems,
      decisions,
      entityContext,
      discussionPoints,
      participants,
      openQuestions,
      topicSummaries,
    ],
  );
  const [document, setDocument] = useState<SavedFollowUpDraftsV2>(() =>
    getInitialDocument(meeting.follow_up_drafts_json, composition),
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [loading, setLoading] = useState(false);
  const [refineError, setRefineError] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isRefineExpanded, setIsRefineExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDocument = useRef(document);

  useEffect(() => {
    latestDocument.current = document;
  }, [document]);

  useEffect(() => {
    const next = getInitialDocument(meeting.follow_up_drafts_json, composition);
    setDocument(next);
    setRevision(0);
    setSaveState('idle');
  }, [meeting.id, meeting.follow_up_drafts_json, composition]);

  const persist = useCallback(
    async (nextDocument: SavedFollowUpDraftsV2) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      setSaveState('saving');
      try {
        await window.ipcRenderer.invoke('SAVE_MEETING', {
          ...meeting,
          follow_up_drafts_json: JSON.stringify(nextDocument),
        });
        setSaveState('saved');
      } catch (error) {
        console.error('Failed to save follow-up draft:', error);
        setSaveState('error');
      }
    },
    [meeting],
  );

  useEffect(() => {
    if (revision === 0) return;
    saveTimer.current = setTimeout(() => {
      void persist(latestDocument.current);
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [persist, revision]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const updateDocument = (
    updater: (current: SavedFollowUpDraftsV2) => SavedFollowUpDraftsV2,
  ) => {
    setDocument((current) => {
      const next = updater(current);
      latestDocument.current = next;
      return next;
    });
    setRevision((current) => current + 1);
  };

  const handleFormatChange = (selectedFormat: FollowUpFormat) => {
    updateDocument((current) => ({
      ...current,
      selectedFormat,
    }));
  };

  const handleEdit = (value: string) => {
    updateDocument((current) => ({
      ...current,
      variants: { ...current.variants, [current.selectedFormat]: value },
      editedFormats: current.editedFormats.includes(current.selectedFormat)
        ? current.editedFormats
        : [...current.editedFormats, current.selectedFormat],
    }));
  };

  const handleCopy = async () => {
    setCopyState('idle');
    try {
      await navigator.clipboard.writeText(
        document.variants[document.selectedFormat],
      );
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy follow-up draft:', error);
      setCopyState('error');
    }
  };

  const resetToCurrentEvidence = () => {
    const reset = createSavedFollowUpDrafts(composition);
    latestDocument.current = reset;
    setDocument(reset);
    setRevision((current) => current + 1);
    setRefineError('');
  };

  const handleRefine = async () => {
    setLoading(true);
    setRefineError('');
    try {
      const response = await window.ipcRenderer.invoke('GENERATE_FOLLOW_UPS', {
        meetingTitle: meeting.title,
        overview,
        participants,
        entityContext,
        topicSummaries,
        actionItems,
        decisions,
        openQuestions,
        discussionPoints,
        customPrompt: customPrompt.trim() || undefined,
      });
      const refined = getRefinedVariants(response);
      if (!refined) throw new Error('Refinement returned incomplete drafts');
      updateDocument((current) => mergeRefinedVariants(current, refined));
    } catch (error) {
      console.error('Failed to refine follow-up draft:', error);
      setRefineError('Couldn’t refine. Your current draft is unchanged.');
    } finally {
      setLoading(false);
    }
  };

  if (composition.availability === 'weak_evidence') {
    return (
      <section className="rounded-[1.75rem] border border-pro-border/40 bg-pro-surface/30 px-6 py-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-text-muted/50">
          Follow-up
        </p>
        <h2 className="mt-2 text-base font-bold text-pro-text-main/75">
          Not enough evidence yet
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-pro-text-muted/70">
          {composition.reason}
        </p>
      </section>
    );
  }

  const contextChanged =
    document.evidenceFingerprint !== composition.evidenceFingerprint;
  const activeDraft = document.variants[document.selectedFormat];
  const statusLabel = contextChanged
    ? 'Meeting context changed'
    : saveState === 'saving'
      ? 'Saving'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'error'
          ? 'Couldn’t save'
          : '';

  return (
    <section className="rounded-[2rem] border border-pro-border/50 bg-pro-surface/50 p-5 shadow-sm md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-accent/70">
            Follow-up
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-pro-text-main">
              Ready to send
            </h2>
            {statusLabel ? (
              <span
                className={`text-[10px] font-bold uppercase tracking-wider ${saveState === 'error' ? 'text-red-500' : 'text-pro-text-muted/60'}`}
                aria-live="polite"
              >
                {statusLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div
          className="inline-flex rounded-xl border border-pro-border/50 bg-pro-bg/70 p-1"
          aria-label="Follow-up format"
        >
          {FORMAT_OPTIONS.map((format) => (
            <button
              key={format.id}
              type="button"
              aria-pressed={document.selectedFormat === format.id}
              onClick={() => handleFormatChange(format.id)}
              className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${
                document.selectedFormat === format.id
                  ? 'bg-pro-accent text-[#1A2340] shadow-sm'
                  : 'text-pro-text-muted hover:text-pro-text-main'
              }`}
            >
              {format.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <textarea
          aria-label={`${document.selectedFormat} follow-up draft`}
          value={activeDraft}
          onChange={(event) => handleEdit(event.target.value)}
          onBlur={() => revision > 0 && void persist(latestDocument.current)}
          className="min-h-[240px] w-full resize-y rounded-2xl border border-pro-border/50 bg-pro-bg/75 px-5 py-4 text-sm leading-7 text-pro-text-main outline-none transition-colors focus:border-pro-accent/50"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-2 rounded-xl bg-pro-text-main px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white transition-transform hover:-translate-y-0.5 dark:bg-pro-accent dark:text-[#1A2340]"
          >
            {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'error'
                ? 'Couldn’t copy'
                : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setIsRefineExpanded((current) => !current)}
            className="inline-flex items-center gap-2 px-2 py-2 text-[10px] font-black uppercase tracking-widest text-pro-text-muted hover:text-pro-text-main"
          >
            <Sparkles size={13} />
            Refine or reset
            {isRefineExpanded ? (
              <ChevronUp size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
          </button>
        </div>
      </div>

      {saveState === 'error' ? (
        <button
          type="button"
          onClick={() => void persist(latestDocument.current)}
          className="mt-3 text-xs font-bold text-red-500 underline underline-offset-4"
        >
          Retry save
        </button>
      ) : null}

      {isRefineExpanded ? (
        <div className="mt-5 rounded-2xl border border-pro-accent/10 bg-pro-accent/5 p-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              aria-label="Refinement instruction"
              placeholder="Make it warmer, shorter, or more direct…"
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              className="flex-1 rounded-xl border border-pro-border/40 bg-pro-bg px-4 py-2.5 text-xs text-pro-text-main outline-none focus:border-pro-accent/40"
            />
            <button
              type="button"
              onClick={() => void handleRefine()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-pro-accent px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#1A2340] disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {loading ? 'Refining' : 'Refine'}
            </button>
            <button
              type="button"
              onClick={resetToCurrentEvidence}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-pro-text-muted hover:text-pro-text-main"
            >
              <RotateCcw size={13} /> Reset
            </button>
          </div>
          {refineError ? (
            <p className="mt-3 text-xs font-semibold text-red-500" role="alert">
              {refineError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
