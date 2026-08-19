import {
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Meeting, TranscriptSegment } from '../../types';
import type {
  MeetingNotesBlock,
  MeetingNotesDocumentModel,
  MeetingNotesSection,
} from '../../utils/meetingNotesDocument';

interface MeetingNotesDocumentProps {
  meeting: Meeting;
  model: MeetingNotesDocumentModel;
  transcriptSegments: TranscriptSegment[];
  onDocumentChanged: () => void;
  onShowTranscript: () => void;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

type SourceSelection = {
  label: string;
  evidence?: string;
  transcriptRange?: [number, number];
};

const previewSourceSelection = (
  model: MeetingNotesDocumentModel,
): SourceSelection | null => {
  if (
    typeof window === 'undefined' ||
    new URLSearchParams(window.location.search).get('source') !== '1' ||
    !window.__PLUTO_BROWSER_PREVIEW__
  ) {
    return null;
  }
  const block = model.sections
    .flatMap((section) => section.blocks)
    .find((candidate) => candidate.evidence || candidate.transcriptRange);
  return block
    ? {
        label: block.text,
        evidence: block.evidence,
        transcriptRange: block.transcriptRange,
      }
    : null;
};

const sourceUsesOverlay = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 1179px)').matches;

const formatTimestamp = (seconds?: number): string => {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds || 0) : 0;
  const minutes = Math.floor(value / 60);
  const remainder = Math.floor(value % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

const normalizeEvidence = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/^[^:]{1,40}:\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const EvidenceText = ({
  text,
  claim,
}: {
  text: string;
  claim: string;
}) => {
  const claimTokens = claim.toLocaleLowerCase().match(/[a-z0-9]+/g) || [];
  let match: RegExpExecArray | null = null;
  for (
    let size = Math.min(8, claimTokens.length);
    size >= 2 && !match;
    size -= 1
  ) {
    for (let start = 0; start <= claimTokens.length - size; start += 1) {
      const phrase = claimTokens
        .slice(start, start + size)
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\W+');
      const candidate = new RegExp(phrase, 'i').exec(text);
      if (candidate) {
        match = candidate;
        break;
      }
    }
  }
  if (!match) return <>{text}</>;
  const before = text.slice(0, match.index);
  const selected = text.slice(match.index, match.index + match[0].length);
  const after = text.slice(match.index + match[0].length);
  return (
    <>
      {before}
      <mark>{selected}</mark>
      {after}
    </>
  );
};

const resolveSourceSegments = (
  selection: SourceSelection,
  transcriptSegments: TranscriptSegment[],
): TranscriptSegment[] => {
  if (selection.transcriptRange) {
    const [start, end] = selection.transcriptRange;
    return transcriptSegments.slice(
      Math.max(0, start),
      Math.min(transcriptSegments.length, end + 1),
    );
  }
  if (!selection.evidence) return [];
  const evidence = normalizeEvidence(selection.evidence);
  if (!evidence) return [];
  const match = transcriptSegments.find((segment) => {
    const text = normalizeEvidence(segment.text);
    return text.includes(evidence) || evidence.includes(text);
  });
  if (!match) return [];
  const matchIndex = transcriptSegments.indexOf(match);
  return transcriptSegments.slice(matchIndex, matchIndex + 3);
};

const SaveStatus = ({ state }: { state: SaveState }) => {
  const content = {
    saved: (
      <>
        <CheckCircle2 aria-hidden="true" size={13} /> Saved locally
      </>
    ),
    dirty: 'Unsaved changes',
    saving: (
      <>
        <Loader2 aria-hidden="true" size={13} className="animate-spin" />
        Saving notes
      </>
    ),
    error: 'Notes were not saved. Keep this window open and try again.',
  }[state];
  return (
    <span className={`meeting-save-state meeting-save-state--${state}`}>
      {content}
    </span>
  );
};

const InlineEditableText = ({
  meetingId,
  path,
  originalText,
  text,
  asHeading = false,
  onSaved,
}: {
  meetingId: string | number;
  path?: string;
  originalText: string;
  text: string;
  asHeading?: boolean;
  onSaved: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(text), [text]);
  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  if (!path) {
    return asHeading ? <h2>{text}</h2> : <p>{text}</p>;
  }

  const save = async () => {
    const next = draft.trim();
    if (!next || next === text) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (next === originalText) {
        await window.ipcRenderer.invoke('REVERT_USER_EDIT', {
          meetingId,
          path,
        });
      } else {
        await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
          meetingId,
          path,
          original: originalText,
          edited: next,
        });
      }
      setEditing(false);
      onSaved();
    } catch (cause) {
      console.error('Failed to save meeting note edit', cause);
      setError('This edit was not saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="meeting-inline-editor">
        <textarea
          ref={textareaRef}
          aria-label={asHeading ? 'Edit section heading' : 'Edit note'}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(text);
              setEditing(false);
            }
            if (event.key === 'Enter' && !event.shiftKey && !asHeading) {
              event.preventDefault();
              void save();
            }
          }}
          disabled={saving}
          rows={
            asHeading ? 1 : Math.min(8, Math.max(2, draft.split('\n').length))
          }
        />
        <div className="meeting-inline-editor__actions">
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? (
              <Loader2 aria-hidden="true" size={15} className="animate-spin" />
            ) : (
              <Check aria-hidden="true" size={15} />
            )}
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(text);
              setEditing(false);
            }}
            disabled={saving}
          >
            <X aria-hidden="true" size={15} /> Keep original
          </button>
        </div>
        {error ? <p className="meeting-edit-error">{error}</p> : null}
      </div>
    );
  }

  const content = asHeading ? <h2>{text}</h2> : <p>{text}</p>;
  return (
    <div className="meeting-editable-copy">
      {content}
      <button
        type="button"
        aria-label={`Edit ${asHeading ? 'section heading' : text}`}
        onClick={() => setEditing(true)}
      >
        <Pencil aria-hidden="true" size={14} />
      </button>
    </div>
  );
};

const NoteBlock = ({
  block,
  section,
  meetingId,
  onSaved,
  onSelectSource,
  selected,
}: {
  block: MeetingNotesBlock;
  section: MeetingNotesSection;
  meetingId: string | number;
  onSaved: () => void;
  onSelectSource: (selection: SourceSelection) => void;
  selected: boolean;
}) => {
  const [completionPending, setCompletionPending] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const sourceRange = block.transcriptRange || section.transcriptRange;
  const hasSource = Boolean(block.evidence || sourceRange);
  const isAction = block.blockType === 'action';
  const isDecision = block.blockType === 'decision';

  const toggleCompleted = async () => {
    if (!block.path || completionPending) return;
    const next = !block.completed;
    setCompletionPending(true);
    setCompletionError(null);
    try {
      await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
        meetingId,
        path: `completion:${block.path}`,
        original: 'false',
        edited: String(next),
      });
      onSaved();
    } catch (cause) {
      console.error('Failed to update next step', cause);
      setCompletionError('This next step was not updated. Try again.');
    } finally {
      setCompletionPending(false);
    }
  };

  return (
    <div
      className={`meeting-note-block meeting-note-block--${section.kind} ${selected ? 'is-source-selected' : ''}`}
      data-authorship={block.authorship}
    >
      {isAction ? (
        <label className="meeting-action-check">
          <span className="sr-only">
            {block.completed ? 'Mark incomplete' : 'Mark complete'}:{' '}
            {block.text}
          </span>
          <input
            className="sr-only"
            type="checkbox"
            checked={Boolean(block.completed)}
            disabled={!block.path || completionPending}
            aria-label={`${block.completed ? 'Mark incomplete' : 'Mark complete'}: ${block.text}`}
            onChange={() => void toggleCompleted()}
          />
          <span className="meeting-action-box" aria-hidden="true">
            <Check size={13} />
          </span>
        </label>
      ) : isDecision ? (
        <span className="meeting-decision-mark" aria-label="Decision">
          <Check aria-hidden="true" size={14} />
        </span>
      ) : (
        <span className="meeting-note-block__marker" aria-hidden="true" />
      )}
      <div className="meeting-note-block__body">
        <InlineEditableText
          meetingId={meetingId}
          path={block.path}
          originalText={block.originalText}
          text={block.text}
          onSaved={onSaved}
        />
        <div className="meeting-note-block__meta">
          {block.authorship === 'human' ? (
            <span className="meeting-authorship meeting-authorship--human">
              Written by you
            </span>
          ) : (
            <span className="meeting-authorship" title="Drafted by Pluto">
              Pluto draft
            </span>
          )}
          {block.speaker ? <span>{block.speaker}</span> : null}
          {block.assignee ? <span>Owner: {block.assignee}</span> : null}
          {block.due ? <span>Due {block.due}</span> : null}
          {block.edited ? (
            <span>
              <Pencil aria-hidden="true" size={10} /> Edited
            </span>
          ) : null}
          {hasSource ? (
            <button
              type="button"
              aria-label={`Show source for ${block.text}`}
              onClick={() =>
                onSelectSource({
                  label: block.text,
                  evidence: block.evidence,
                  transcriptRange: sourceRange,
                })
              }
            >
              <span className="meeting-source-indicator" aria-hidden="true">
                {selected ? '1' : ''}
              </span>
            </button>
          ) : null}
        </div>
        {completionError ? (
          <p className="meeting-edit-error">{completionError}</p>
        ) : null}
      </div>
    </div>
  );
};

const SourcePane = ({
  selection,
  transcriptSegments,
  onClose,
  onShowTranscript,
  meetingDate,
}: {
  selection: SourceSelection;
  transcriptSegments: TranscriptSegment[];
  onClose: () => void;
  onShowTranscript: () => void;
  meetingDate: string;
}) => {
  const segments = resolveSourceSegments(selection, transcriptSegments);
  return (
    <aside
      className="meeting-document meeting-source-pane"
      data-notes-source
      aria-label="Source"
    >
      <div className="meeting-source-pane__header">
        <strong>
          <span aria-hidden="true">←</span> Source
        </strong>
        <button type="button" onClick={onClose} aria-label="Back to note">
          <span aria-hidden="true">←</span> Back to note
        </button>
      </div>
      <div className="meeting-source-pane__body">
        <p className="meeting-source-pane__claim">
          <span>Showing evidence for:</span>“{selection.label}”
        </p>
        {segments.length > 0 ? (
          segments.map((segment, index) => (
            <blockquote
              key={`${String(segment.speaker)}-${segment.start}-${segment.text}-${index}`}
            >
              <header>
                <strong>{segment.speaker || 'Unknown speaker'}</strong>
                <time>{formatTimestamp(segment.start)}</time>
              </header>
              <p>
                <EvidenceText text={segment.text} claim={selection.label} />
              </p>
            </blockquote>
          ))
        ) : selection.evidence ? (
          <blockquote>
            <p>{selection.evidence}</p>
          </blockquote>
        ) : (
          <p className="meeting-source-pane__empty">
            This note points to the transcript range, but no matching text is
            available.
          </p>
        )}
      </div>
      <button
        type="button"
        className="meeting-source-pane__transcript"
        onClick={onShowTranscript}
      >
        <FileText aria-hidden="true" size={15} /> Open full transcript
      </button>
      <footer className="meeting-source-pane__footer">
        <span>Source: meeting transcript</span>
        <time>
          {new Date(meetingDate).toLocaleString([], {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </time>
      </footer>
    </aside>
  );
};

export const MeetingNotesDocument = ({
  meeting,
  model,
  transcriptSegments,
  onDocumentChanged,
  onShowTranscript,
}: MeetingNotesDocumentProps) => {
  const [draftNotes, setDraftNotes] = useState(meeting.user_notes || '');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [sourceSelection, setSourceSelection] =
    useState<SourceSelection | null>(() => previewSourceSelection(model));
  const [sourceAsOverlay, setSourceAsOverlay] = useState(sourceUsesOverlay);
  const meetingRef = useRef(meeting);
  const savedNotesRef = useRef(meeting.user_notes || '');
  const onDocumentChangedRef = useRef(onDocumentChanged);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);
  useEffect(() => {
    onDocumentChangedRef.current = onDocumentChanged;
  }, [onDocumentChanged]);
  useEffect(() => {
    setDraftNotes(meeting.user_notes || '');
    savedNotesRef.current = meeting.user_notes || '';
    setSaveState('saved');
    setSourceSelection(previewSourceSelection(model));
  }, [meeting.id, meeting.user_notes, model]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 1179px)');
    const update = () => setSourceAsOverlay(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (draftNotes === savedNotesRef.current) return;
    setSaveState('dirty');
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        await window.ipcRenderer.invoke('SAVE_MEETING', {
          ...meetingRef.current,
          user_notes: draftNotes,
        });
        meetingRef.current = {
          ...meetingRef.current,
          user_notes: draftNotes,
        };
        savedNotesRef.current = draftNotes;
        setSaveState('saved');
        onDocumentChangedRef.current();
      } catch (cause) {
        console.error('Failed to save meeting notes', cause);
        setSaveState('error');
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draftNotes]);

  const outline = useMemo(
    () => model.sections.filter((section) => section.kind !== 'scratchpad'),
    [model.sections],
  );

  return (
    <div
      className={`meeting-document-workspace ${sourceSelection ? 'meeting-document-workspace--source-open' : ''}`}
    >
      {outline.length >= 5 ? (
        <nav className="meeting-document-outline" aria-label="Note outline">
          <span>In this note</span>
          {outline.map((section) => (
            <a key={section.id} href={`#meeting-section-${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>
      ) : null}

      <article className="meeting-notes-document" aria-label="Meeting notes">
        <output className="meeting-document-save-row" aria-live="polite">
          <SaveStatus state={saveState} />
        </output>
        {model.sections.map((section) => (
          <section
            key={section.id}
            id={`meeting-section-${section.id}`}
            className={`meeting-notes-section meeting-notes-section--${section.kind}`}
            data-notes-section={section.kind}
          >
            {section.kind === 'scratchpad' ? (
              <>
                <h2>{section.title}</h2>
                <p className="meeting-scratchpad-caption">
                  <span className="meeting-authorship meeting-authorship--human">
                    Written by you
                  </span>
                  These are yours. Pluto never replaces them.
                </p>
                <textarea
                  aria-label="Your meeting notes"
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                  placeholder="Add context, questions, or anything you want Pluto to preserve."
                  rows={Math.min(
                    14,
                    Math.max(4, draftNotes.split('\n').length + 1),
                  )}
                />
              </>
            ) : (
              <>
                <InlineEditableText
                  meetingId={meeting.id}
                  path={section.titlePath}
                  originalText={section.titleOriginal || section.title}
                  text={section.title}
                  asHeading
                  onSaved={onDocumentChanged}
                />
                <div className="meeting-notes-section__content">
                  {section.blocks.map((block) => (
                    <NoteBlock
                      key={block.id}
                      block={block}
                      section={section}
                      meetingId={meeting.id}
                      onSaved={onDocumentChanged}
                      onSelectSource={setSourceSelection}
                      selected={sourceSelection?.label === block.text}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        ))}
      </article>

      {sourceSelection
        ? (() => {
            const pane = (
              <SourcePane
                selection={sourceSelection}
                transcriptSegments={transcriptSegments}
                onClose={() => setSourceSelection(null)}
                onShowTranscript={onShowTranscript}
                meetingDate={meeting.created_at || meeting.started_at}
              />
            );
            return sourceAsOverlay ? createPortal(pane, document.body) : pane;
          })()
        : null}
    </div>
  );
};
