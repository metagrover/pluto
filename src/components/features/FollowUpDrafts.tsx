import { Check, Copy, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Meeting } from '../../types';
import {
  type FollowUpFormat,
  type FollowUpVariants,
  type SavedFollowUpDraftsV2,
  buildFollowUpComposition,
  createSavedFollowUpDrafts,
  mergeRefinedVariants,
  parseSavedFollowUpDrafts,
  resolveFollowUpDrafts,
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

const FORMAT_LABELS: Array<{ id: FollowUpFormat; label: string }> = [
  { id: 'email', label: 'Email' },
  { id: 'internal', label: 'Internal' },
  { id: 'slack', label: 'Slack' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type CopyState = 'idle' | 'copied' | 'error';

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
  fetchMeetings,
}) => {
  const composition = useMemo(
    () =>
      buildFollowUpComposition({
        meetingTitle: meeting.title,
        overview,
        actionItems,
        decisions,
        discussionPoints,
        openQuestions,
        topicSummaries,
        participants,
        entityContext,
      }),
    [
      meeting.title,
      overview,
      actionItems,
      decisions,
      discussionPoints,
      openQuestions,
      topicSummaries,
      participants,
      entityContext,
    ],
  );

  const initialResolution = useMemo(() => {
    if (composition.availability !== 'ready') return null;
    const parsed = parseSavedFollowUpDrafts(
      meeting.follow_up_drafts_json,
      composition.evidenceFingerprint,
    );
    return resolveFollowUpDrafts(composition, parsed.document);
  }, [composition, meeting.follow_up_drafts_json]);

  const [document, setDocument] = useState<SavedFollowUpDraftsV2 | null>(
    initialResolution?.document || null,
  );
  const [contextChanged, setContextChanged] = useState(
    initialResolution?.contextChanged || false,
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setDocument(initialResolution?.document || null);
    setContextChanged(initialResolution?.contextChanged || false);
    setSaveState('idle');
  }, [initialResolution]);

  const persistDocument = useCallback(
    async (nextDocument: SavedFollowUpDraftsV2) => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setSaveState('saving');
      try {
        await window.ipcRenderer.invoke('SAVE_MEETING', {
          ...meeting,
          follow_up_drafts_json: JSON.stringify(nextDocument),
        });
        setSaveState('saved');
        fetchMeetings();
      } catch (error) {
        console.error('Failed to save follow-up draft:', error);
        setSaveState('error');
      }
    },
    [fetchMeetings, meeting],
  );

  useEffect(() => {
    if (!document || saveState !== 'saving') return;
    saveTimeoutRef.current = window.setTimeout(
      () => persistDocument(document),
      500,
    );
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [document, persistDocument, saveState]);

  if (composition.availability === 'weak_evidence') {
    return (
      <section className="rounded-[2rem] border border-pro-border/40 bg-pro-surface/30 p-7">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-text-muted/50">
          Follow-up
        </p>
        <h2 className="mt-2 text-lg font-bold text-pro-text-main/80">
          Not enough evidence yet
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-pro-text-muted">
          {composition.reason}
        </p>
      </section>
    );
  }

  const activeDocument =
    document ||
    createSavedFollowUpDrafts(
      composition.recommendedFormat,
      composition.evidenceFingerprint,
      composition.variants,
      [],
    );
  const activeFormat = activeDocument.selectedFormat;
  const activeText = activeDocument.variants[activeFormat];

  const updateDocument = (nextDocument: SavedFollowUpDraftsV2) => {
    setDocument(nextDocument);
    setSaveState('saving');
  };

  const handleEdit = (value: string) => {
    updateDocument({
      ...activeDocument,
      variants: { ...activeDocument.variants, [activeFormat]: value },
      editedFormats: activeDocument.editedFormats.includes(activeFormat)
        ? activeDocument.editedFormats
        : [...activeDocument.editedFormats, activeFormat],
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeText);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy follow-up draft:', error);
      setCopyState('error');
    }
  };

  const resetToCurrentEvidence = () => {
    setContextChanged(false);
    updateDocument(
      createSavedFollowUpDrafts(
        activeFormat,
        composition.evidenceFingerprint,
        composition.variants,
        [],
      ),
    );
  };

  const handleRefine = async () => {
    setRefining(true);
    setRefineError(false);
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
      const values = response?.drafts?.map(
        (draft: { content?: string }) => draft.content?.trim() || '',
      );
      if (
        !values ||
        values.length < 3 ||
        values.some((value: string) => !value)
      ) {
        throw new Error('Refinement returned incomplete drafts');
      }
      const refined: FollowUpVariants = {
        email: values[0],
        internal: values[1],
        slack: values[2],
      };
      updateDocument(mergeRefinedVariants(activeDocument, refined));
    } catch (error) {
      console.error('Failed to refine follow-up draft:', error);
      setRefineError(true);
    } finally {
      setRefining(false);
    }
  };

  return (
    <section className="rounded-[2rem] border border-pro-border/50 bg-pro-surface/70 p-5 shadow-sm md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pro-accent">
            Follow-up
          </p>
          <h2 className="mt-1 text-xl font-bold text-pro-text-main">
            Ready to send
          </h2>
          <p className="mt-1 text-xs text-pro-text-muted">
            {contextChanged
              ? 'Meeting context changed'
              : saveState === 'saving'
                ? 'Saving'
                : saveState === 'saved'
                  ? 'Saved'
                  : saveState === 'error'
                    ? 'Couldn’t save'
                    : 'Review, edit, and copy when ready'}
          </p>
        </div>
        <div
          className="inline-flex rounded-xl border border-pro-border/50 bg-pro-bg/70 p-1"
          aria-label="Follow-up format"
        >
          {FORMAT_LABELS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={activeFormat === id}
              onClick={() =>
                updateDocument({ ...activeDocument, selectedFormat: id })
              }
              className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors ${
                activeFormat === id
                  ? 'bg-pro-accent text-[#1A2340] shadow-sm'
                  : 'text-pro-text-muted hover:text-pro-text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {contextChanged && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-pro-text-muted">
          <span>
            Your edits are preserved. Reset only when you want fresh context.
          </span>
          <button
            type="button"
            onClick={resetToCurrentEvidence}
            className="font-bold text-pro-text-main"
          >
            Use current context
          </button>
        </div>
      )}

      <textarea
        aria-label={`${FORMAT_LABELS.find(({ id }) => id === activeFormat)?.label} follow-up draft`}
        value={activeText}
        onChange={(event) => handleEdit(event.target.value)}
        onBlur={() => {
          if (saveState === 'saving') void persistDocument(activeDocument);
        }}
        className="mt-5 min-h-[240px] w-full resize-y rounded-2xl border border-pro-border/50 bg-pro-bg/60 p-5 text-sm leading-7 text-pro-text-main outline-none transition focus:border-pro-accent/50 focus:ring-2 focus:ring-pro-accent/10"
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRefine((current) => !current)}
            className="rounded-xl px-3 py-2 text-xs font-bold text-pro-text-muted hover:bg-pro-bg hover:text-pro-text-main"
          >
            Refine
          </button>
          <button
            type="button"
            onClick={resetToCurrentEvidence}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-pro-text-muted hover:bg-pro-bg hover:text-pro-text-main"
          >
            <RotateCcw size={13} /> Reset
          </button>
          {saveState === 'error' && (
            <button
              type="button"
              onClick={() => void persistDocument(activeDocument)}
              className="rounded-xl px-3 py-2 text-xs font-bold text-red-500"
            >
              Retry save
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-2 rounded-xl bg-pro-text-main px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white shadow-sm transition hover:opacity-90 dark:bg-pro-accent dark:text-[#1A2340]"
        >
          {copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
          {copyState === 'copied'
            ? 'Copied'
            : copyState === 'error'
              ? 'Couldn’t copy'
              : 'Copy'}
        </button>
      </div>

      {showRefine && (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-pro-accent/10 bg-pro-accent/5 p-4 sm:flex-row">
          <input
            aria-label="Refinement instruction"
            placeholder="Make it warmer or more concise"
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            className="flex-1 rounded-xl border border-pro-border/40 bg-pro-bg px-4 py-2 text-xs text-pro-text-main outline-none focus:border-pro-accent/40"
          />
          <button
            type="button"
            onClick={handleRefine}
            disabled={refining}
            className="flex items-center justify-center gap-2 rounded-xl bg-pro-text-main px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50 dark:bg-pro-accent dark:text-[#1A2340]"
          >
            {refining ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            {refining ? 'Refining' : 'Refine variants'}
          </button>
          {refineError && (
            <span className="self-center text-xs text-red-500">
              Couldn’t refine
            </span>
          )}
        </div>
      )}
    </section>
  );
};
