import { Check, FileText, Loader2, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import TextareaAutosize from 'react-textarea-autosize';
import remarkGfm from 'remark-gfm';
import type { Meeting, TranscriptSegment } from '../../types';
import type {
  MeetingNotesBlock,
  MeetingNotesDocumentModel,
  MeetingNotesSection,
  NativeMeetingNoteContinuation,
} from '../../utils/meetingNotesDocument';
import { nativeContinuationEditPath } from '../../utils/meetingNotesDocument';
import { meetingTimestamp } from '../../utils/meetingOrdering';
import { getTranscriptSegmentStartTime } from '../../utils/transcript';

interface MeetingNotesDocumentProps {
  meeting: Meeting;
  model: MeetingNotesDocumentModel;
  transcriptSegments: TranscriptSegment[];
  onDocumentChanged: () => void;
  onShowTranscript: () => void;
  header?: React.ReactNode;
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
    saved: null,
    dirty: 'Unsaved changes',
    saving: (
      <>
        <Loader2 aria-hidden="true" size={13} className="animate-spin" />
        Saving notes
      </>
    ),
    error: 'Notes were not saved. Keep this window open and try again.',
  }[state];
  if (!content) return null;

  return (
    <span className={`meeting-save-state meeting-save-state--${state}`}>
      {content}
    </span>
  );
};

const navigateToAdjacentTextarea = (
  current: HTMLTextAreaElement,
  direction: 'up' | 'down',
) => {
  const textareas = Array.from(
    document.querySelectorAll(
      '.meeting-notes-document textarea:not([disabled])',
    ),
  ) as HTMLTextAreaElement[];
  const index = textareas.indexOf(current);
  if (index === -1) return;
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (nextIndex >= 0 && nextIndex < textareas.length) {
    const nextTextarea = textareas[nextIndex];
    nextTextarea.focus();
    const len = nextTextarea.value.length;
    // Set timeout to allow focus to settle before moving cursor
    setTimeout(() => {
      nextTextarea.setSelectionRange(
        direction === 'up' ? len : 0,
        direction === 'up' ? len : 0,
      );
    }, 0);
  }
};

const toggleMarkdownTask = (text: string, taskIndex: number): string => {
  let currentTask = 0;
  return text.replace(
    /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/gm,
    (line, prefix: string, state: string, suffix: string) => {
      if (currentTask++ !== taskIndex) return line;
      return `${prefix}${state.toLocaleLowerCase() === 'x' ? ' ' : 'x'}${suffix}`;
    },
  );
};

const InlineEditableText = ({
  meetingId,
  path,
  originalText,
  text,
  asHeading = false,
  onCreateNativeContinuation,
  onSaveNativeContinuation,
  autoFocus = false,
  onSaved,
}: {
  meetingId: string | number;
  path?: string;
  originalText: string;
  text: string;
  asHeading?: boolean;
  onCreateNativeContinuation?: () => Promise<void>;
  onSaveNativeContinuation?: (text: string) => Promise<void>;
  autoFocus?: boolean;
  onSaved: () => void;
}) => {
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(asHeading);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(text);
    setEditing(asHeading);
  }, [asHeading, text]);

  useEffect(() => {
    if (editing && !asHeading) {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      if (pendingCaretRef.current !== null) {
        const pos = pendingCaretRef.current;
        pendingCaretRef.current = null;
        ta.setSelectionRange(pos, pos);
      }
    }
  }, [editing, asHeading]);

  useEffect(() => {
    if (autoFocus && !asHeading) setEditing(true);
  }, [autoFocus, asHeading]);

  const className = asHeading
    ? 'meeting-editable-heading w-full resize-none overflow-hidden bg-transparent outline-none block'
    : 'w-full resize-none overflow-hidden bg-transparent outline-none font-sans text-[16px] leading-[1.55] m-0 p-0 block';

  const save = async (newValue: string) => {
    const next = newValue.trim();
    if (onSaveNativeContinuation) {
      setSaving(true);
      setError(null);
      try {
        await onSaveNativeContinuation(next);
        onSaved();
      } catch (cause) {
        console.error('Failed to save native meeting note continuation', cause);
        setError('This edit was not saved. Try again.');
        setDraft(text);
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!next || next === text) {
      setDraft(text);
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
      onSaved();
    } catch (cause) {
      console.error('Failed to save meeting note edit', cause);
      setError('This edit was not saved. Try again.');
      setDraft(text);
    } finally {
      setSaving(false);
    }
  };

  const renderMarkdown = () => {
    let taskIndex = 0;
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          input: ({ type, checked, ...props }) => {
            if (type !== 'checkbox') return <input type={type} {...props} />;
            const index = taskIndex++;
            return (
              <input
                {...props}
                type="checkbox"
                checked={Boolean(checked)}
                aria-label={checked ? 'Mark incomplete' : 'Mark complete'}
                disabled={saving || !path}
                onClick={(event) => event.stopPropagation()}
                onChange={() => {
                  const next = toggleMarkdownTask(draft, index);
                  setDraft(next);
                  void save(next);
                }}
              />
            );
          },
        }}
      >
        {draft}
      </ReactMarkdown>
    );
  };

  if (!path && !onSaveNativeContinuation) {
    return asHeading ? (
      <h2 className={className}>{text}</h2>
    ) : (
      <div className="meeting-markdown-preview">{renderMarkdown()}</div>
    );
  }

  if (!asHeading && !editing) {
    return (
      <div
        className="meeting-markdown-preview"
        onMouseDown={(e) => {
          // Prevent the mousedown from blurring the currently-focused textarea
          // before we've had a chance to set editing=true. This way a single
          // click moves focus directly from one block to the next.
          e.preventDefault();

          // Resolve the click coordinates to a character offset in the
          // rendered HTML text, then map it into the raw markdown string.
          try {
            let clickedNode: Node | null = null;
            let offsetInNode = 0;

            // Standard (Firefox) API
            if ('caretPositionFromPoint' in document) {
              const pos = (
                document as Document & {
                  caretPositionFromPoint: (
                    x: number,
                    y: number,
                  ) => { offsetNode: Node; offset: number } | null;
                }
              ).caretPositionFromPoint(e.clientX, e.clientY);
              if (pos) {
                clickedNode = pos.offsetNode;
                offsetInNode = pos.offset;
              }
            } else if ('caretRangeFromPoint' in document) {
              // WebKit/Blink (Electron/Chrome) API
              const range = (
                document as Document & {
                  caretRangeFromPoint: (x: number, y: number) => Range | null;
                }
              ).caretRangeFromPoint(e.clientX, e.clientY);
              if (range) {
                clickedNode = range.startContainer;
                offsetInNode = range.startOffset;
              }
            }

            if (clickedNode) {
              // Walk all text nodes inside the preview to get an absolute
              // character offset within the element's full text content.
              const previewEl = e.currentTarget;
              const walker = document.createTreeWalker(
                previewEl,
                NodeFilter.SHOW_TEXT,
              );
              let absoluteOffset = 0;
              let found = false;
              let node: Node | null = walker.nextNode();
              while (node) {
                if (node === clickedNode) {
                  absoluteOffset += offsetInNode;
                  found = true;
                  break;
                }
                absoluteOffset += (node.textContent ?? '').length;
                node = walker.nextNode();
              }

              if (found) {
                // Map the visible-text offset into the raw markdown by finding
                // the first position in draft where the surrounding text matches.
                // We search for a snippet of visible text around the click.
                const visibleText = previewEl.textContent ?? '';
                const snippet = visibleText.slice(
                  Math.max(0, absoluteOffset - 12),
                  absoluteOffset + 12,
                );
                const snippetPre = visibleText.slice(
                  Math.max(0, absoluteOffset - 12),
                  absoluteOffset,
                );
                const mdIdx = draft.indexOf(snippet);
                if (mdIdx !== -1) {
                  pendingCaretRef.current = mdIdx + snippetPre.length;
                } else {
                  // Fallback: proportional mapping
                  const ratio =
                    visibleText.length > 0
                      ? absoluteOffset / visibleText.length
                      : 1;
                  pendingCaretRef.current = Math.round(ratio * draft.length);
                }
              }
            }
          } catch {
            // If anything goes wrong, just open at end
            pendingCaretRef.current = draft.length;
          }

          setEditing(true);
        }}
      >
        {renderMarkdown()}
      </div>
    );
  }

  return (
    <div className="meeting-inline-editable relative group w-full">
      <TextareaAutosize
        ref={textareaRef}
        className={`${className} overflow-hidden`}
        style={{ color: 'var(--notes-ink)' }}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setEditing(false);
          void save(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setDraft(text);
            event.currentTarget.blur();
          }
          if (event.key === 'ArrowUp') {
            const target = event.currentTarget;
            if (target.selectionStart === 0) {
              event.preventDefault();
              navigateToAdjacentTextarea(target, 'up');
            }
          }
          if (event.key === 'ArrowDown') {
            const target = event.currentTarget;
            if (target.selectionEnd === target.value.length) {
              event.preventDefault();
              navigateToAdjacentTextarea(target, 'down');
            }
          }
          if (event.key === 'Backspace') {
            const target = event.currentTarget;
            if (target.selectionStart === 0 && target.selectionEnd === 0) {
              event.preventDefault();
              navigateToAdjacentTextarea(target, 'up');
            }
          }
          if (event.key === 'Enter') {
            const target = event.currentTarget;
            const pos = target.selectionStart;
            const val = target.value;
            // Find the start of the current line
            const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
            const currentLine = val.slice(lineStart, pos);
            // Match list prefix: optional indent, then bullet (- * +) or numbered (1.) with optional checkbox
            const listMatch = currentLine.match(
              /^(\s*)([-*+]|\d+\.)\s+(\[[ x]\]\s+)?/,
            );
            if (listMatch) {
              event.preventDefault();
              const [fullPrefix, indent, marker] = listMatch;
              const lineContent = currentLine.slice(fullPrefix.length);
              if (lineContent.trim() === '') {
                // Empty list item → remove the prefix (exit the list or dedent)
                const newVal = `${val.slice(0, lineStart)}\n${val.slice(pos)}`;
                setDraft(newVal);
                const newPos = lineStart + 1;
                requestAnimationFrame(() => {
                  target.setSelectionRange(newPos, newPos);
                });
              } else {
                // Continue the list with same indent + same marker style
                const nextMarker = /^\d+\./.test(marker)
                  ? `${Number.parseInt(marker) + 1}.`
                  : marker;
                const insertion = `\n${indent}${nextMarker} `;
                const newVal = val.slice(0, pos) + insertion + val.slice(pos);
                setDraft(newVal);
                const newPos = pos + insertion.length;
                requestAnimationFrame(() => {
                  target.setSelectionRange(newPos, newPos);
                });
              }
              return;
            }
            const trailingText = val.slice(pos);
            const atBlockEnd =
              trailingText.length === 0 || /^\s*$/.test(trailingText);
            if (
              onCreateNativeContinuation &&
              pos === target.selectionEnd &&
              atBlockEnd
            ) {
              event.preventDefault();
              setSaving(true);
              setError(null);
              void onCreateNativeContinuation()
                .catch((cause) => {
                  console.error(
                    'Failed to create native meeting note continuation',
                    cause,
                  );
                  setError('A new item was not created. Try again.');
                })
                .finally(() => setSaving(false));
              return;
            }
          }
          if (event.key === 'Tab') {
            const target = event.currentTarget;
            const pos = target.selectionStart;
            const val = target.value;
            const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
            const currentLine = val.slice(lineStart, pos);
            const isList = /^(\s*)([-*+]|\d+\.)\s/.test(currentLine);
            if (isList) {
              event.preventDefault();
              if (event.shiftKey) {
                // Dedent: remove up to 2 leading spaces
                const dedented = currentLine.replace(/^ {1,2}/, '');
                const removed = currentLine.length - dedented.length;
                const newVal = `${val.slice(
                  0,
                  lineStart,
                )}${dedented}${val.slice(lineStart + currentLine.length)}`;
                setDraft(newVal);
                const newPos = Math.max(lineStart, pos - removed);
                requestAnimationFrame(() => {
                  target.setSelectionRange(newPos, newPos);
                });
              } else {
                // Indent: add 2 spaces
                const newVal = `${val.slice(0, lineStart)}  ${val.slice(lineStart)}`;
                setDraft(newVal);
                const newPos = pos + 2;
                requestAnimationFrame(() => {
                  target.setSelectionRange(newPos, newPos);
                });
              }
              return;
            }
          }
        }}
        disabled={saving}
        spellCheck={false}
      />
      {error && <p className="text-red-500 text-[13px] mt-1">{error}</p>}
    </div>
  );
};

const NoteBlock = ({
  block,
  section,
  meetingId,
  onSaved,
  onCreateNativeContinuation,
  onUpdateNativeContinuation,
  autoFocus,
  selected,
}: {
  block: MeetingNotesBlock;
  section: MeetingNotesSection;
  meetingId: string | number;
  onSaved: () => void;
  onCreateNativeContinuation?: () => Promise<void>;
  onUpdateNativeContinuation?: (
    update: Partial<NativeMeetingNoteContinuation>,
  ) => Promise<void>;
  autoFocus: boolean;
  selected: boolean;
}) => {
  const [completionPending, setCompletionPending] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const isAction = block.blockType === 'action';
  const isCheckable = isAction || block.blockType === 'decision';

  const toggleCompleted = async () => {
    if ((!block.path && !block.nativeContinuation) || completionPending) return;
    const next = !block.completed;
    setCompletionPending(true);
    setCompletionError(null);
    try {
      if (block.nativeContinuation && onUpdateNativeContinuation) {
        await onUpdateNativeContinuation({ completed: next });
      } else {
        await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
          meetingId,
          path: `completion:${block.path}`,
          original: 'false',
          edited: String(next),
        });
      }
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
      className={`meeting-note-block meeting-note-block--${section.kind} ${block.blockType === 'paragraph' ? 'meeting-note-block--paragraph' : ''} ${selected ? 'is-source-selected' : ''}`}
      data-authorship={block.authorship}
    >
      {isCheckable ? (
        <label className="meeting-action-check">
          <span className="sr-only">
            {block.completed ? 'Mark incomplete' : 'Mark complete'}:{' '}
            {block.text}
          </span>
          <input
            className="sr-only"
            type="checkbox"
            checked={Boolean(block.completed)}
            disabled={
              (!block.path && !block.nativeContinuation) || completionPending
            }
            aria-label={`${block.completed ? 'Mark incomplete' : 'Mark complete'}: ${block.text}`}
            onChange={() => void toggleCompleted()}
          />
          <span className="meeting-action-box" aria-hidden="true">
            <Check size={13} />
          </span>
        </label>
      ) : block.blockType !== 'paragraph' ? (
        <span className="meeting-note-block__marker" aria-hidden="true" />
      ) : null}
      <div className="meeting-note-block__body">
        <InlineEditableText
          meetingId={meetingId}
          path={block.path}
          originalText={block.originalText}
          text={block.text}
          onCreateNativeContinuation={onCreateNativeContinuation}
          onSaveNativeContinuation={
            block.nativeContinuation
              ? async (text) => onUpdateNativeContinuation?.({ text })
              : undefined
          }
          autoFocus={autoFocus}
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
      data-reading-surface="meeting-source"
      aria-labelledby="meeting-source-heading"
    >
      <div className="meeting-source-pane__header">
        <h2 id="meeting-source-heading">Source</h2>
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
                <time>
                  {formatTimestamp(getTranscriptSegmentStartTime(segment))}
                </time>
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
  header,
}: MeetingNotesDocumentProps) => {
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [pendingNativeContinuationId, setPendingNativeContinuationId] =
    useState<string | null>(null);
  const [sourceSelection, setSourceSelection] =
    useState<SourceSelection | null>(() => previewSourceSelection(model));
  const meetingRef = useRef(meeting);
  const onDocumentChangedRef = useRef(onDocumentChanged);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);
  useEffect(() => {
    onDocumentChangedRef.current = onDocumentChanged;
  }, [onDocumentChanged]);
  useEffect(() => {
    setSaveState('saved');
    setSourceSelection(previewSourceSelection(model));
  }, [meeting.id, meeting.user_notes, model]);

  const saveNativeContinuations = async (
    parentPath: string,
    continuations: NativeMeetingNoteContinuation[],
  ) => {
    await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
      meetingId: meeting.id,
      path: nativeContinuationEditPath(parentPath),
      original: '[]',
      edited: JSON.stringify(continuations),
    });
  };

  const createNativeContinuation = async (block: MeetingNotesBlock) => {
    const parentPath = block.nativeContinuation?.parentPath || block.path;
    if (!parentPath) return;
    const id =
      globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    await saveNativeContinuations(parentPath, [
      ...(block.nativeContinuations || []),
      { id, text: '' },
    ]);
    setPendingNativeContinuationId(id);
    onDocumentChanged();
  };

  const updateNativeContinuation = async (
    block: MeetingNotesBlock,
    update: Partial<NativeMeetingNoteContinuation>,
  ) => {
    const parentPath = block.nativeContinuation?.parentPath;
    if (!parentPath || !block.nativeContinuation) return;
    const continuations = (block.nativeContinuations || [])
      .map((continuation) =>
        continuation.id === block.nativeContinuation?.id
          ? { ...continuation, ...update }
          : continuation,
      )
      .filter((continuation) => continuation.text.trim());
    await saveNativeContinuations(parentPath, continuations);
  };

  const canContinueAsNativeRow = (block: MeetingNotesBlock) =>
    block.blockType === 'note' ||
    block.blockType === 'action' ||
    block.blockType === 'decision' ||
    (Boolean(block.path) && block.blockType !== 'paragraph');
  return (
    <div className="meeting-document-workspace">
      <article
        className="meeting-notes-document"
        data-reading-surface="meeting-notes"
        aria-label="Meeting notes"
      >
        {header}
        <output className="meeting-document-save-row" aria-live="polite">
          <SaveStatus state={saveState} />
        </output>
        {model.sections
          .filter((s) => s.kind !== 'scratchpad')
          .map((section) => (
            <section
              key={section.id}
              id={`meeting-section-${section.id}`}
              className={`meeting-notes-section meeting-notes-section--${section.kind}`}
              data-notes-section={section.kind}
            >
              {
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
                        onCreateNativeContinuation={
                          canContinueAsNativeRow(block)
                            ? () => createNativeContinuation(block)
                            : undefined
                        }
                        onUpdateNativeContinuation={
                          block.nativeContinuation
                            ? (update) =>
                                updateNativeContinuation(block, update)
                            : undefined
                        }
                        autoFocus={
                          block.nativeContinuation?.id ===
                          pendingNativeContinuationId
                        }
                        selected={sourceSelection?.label === block.text}
                      />
                    ))}
                  </div>
                </>
              }
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
                meetingDate={new Date(meetingTimestamp(meeting)).toISOString()}
              />
            );
            return createPortal(pane, document.body);
          })()
        : null}
    </div>
  );
};
