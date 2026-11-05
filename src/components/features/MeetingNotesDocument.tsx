import { Check, FileText, Loader2, Pencil, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import TextareaAutosize from 'react-textarea-autosize';
import remarkGfm from 'remark-gfm';
import { type Entity, getEntity } from '../../api/knowledgeGraph';
import type { Meeting, TranscriptSegment } from '../../types';
import { parseUserEditsJson } from '../../utils/analysisDocument';
import type {
  MeetingNotesBlock,
  MeetingNotesDocumentModel,
  MeetingNotesSection,
  NativeMeetingNoteContinuation,
} from '../../utils/meetingNotesDocument';
import {
  findReminderNoteBlock,
  nativeContinuationEditPath,
} from '../../utils/meetingNotesDocument';
import {
  MEETING_USER_NOTES_EDIT_PATH,
  meetingUserNotesWithEdits,
} from '../../utils/meetingNotesEditRebase';
import { meetingTimestamp } from '../../utils/meetingOrdering';
import { getTranscriptSegmentStartTime } from '../../utils/transcript';
import './notes/notes.css';
import {
  type EntityOption,
  INITIAL_SLASH_MENU,
  NotionBlockGutter,
  NotionSlashMenu,
  type SlashMenuState,
  caretVisualEdges,
  filterSlashMenuItems,
} from './notes/editor';
import { ProjectCommitments } from './projects/ProjectCommitments';

interface MeetingNotesDocumentProps {
  reminderEntityId?: string;
  onDismissReminder?: () => void;
  meeting: Meeting;
  model: MeetingNotesDocumentModel;
  transcriptSegments: TranscriptSegment[];
  onDocumentChanged: () => void;
  onShowTranscript: () => void;
  header?: React.ReactNode;
  workspaceStatus?: React.ReactNode;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

type SourceSelection = {
  label: string;
  evidence?: string;
  transcriptRange?: [number, number];
};

type DeletedContinuation = {
  parentPath: string;
  continuation: NativeMeetingNoteContinuation;
};

const applyNativeContinuationOverrides = (
  sections: MeetingNotesSection[],
  overrides: Map<string, NativeMeetingNoteContinuation[]>,
): MeetingNotesSection[] => {
  if (overrides.size === 0) return sections;
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.flatMap((block) => {
      const continuationParentPath = block.nativeContinuation?.parentPath;
      if (continuationParentPath && overrides.has(continuationParentPath)) {
        return [];
      }
      if (!block.path || !overrides.has(block.path)) return [block];

      const continuations = overrides.get(block.path) || [];
      const parent = { ...block, nativeContinuations: continuations };
      return [
        parent,
        ...continuations.map((continuation) => ({
          ...parent,
          id: `${block.id}:continuation:${continuation.id}`,
          path: undefined,
          text: continuation.text,
          originalText: continuation.text,
          authorship: 'human' as const,
          edited: true,
          completed: continuation.completed,
          nativeContinuation: {
            parentPath: block.path!,
            id: continuation.id,
          },
        })),
      ];
    }),
  }));
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

const SaveStatus = ({
  state,
  onRetry,
}: {
  state: SaveState;
  onRetry?: () => void;
}) => {
  if (state === 'saved') return null;

  const content = {
    dirty: 'Unsaved changes',
    saving: (
      <>
        <Loader2 aria-hidden="true" size={13} className="animate-spin" />
        Saving notes
      </>
    ),
    error: (
      <>
        Notes were not saved.
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            Retry save
          </button>
        ) : null}
      </>
    ),
  }[state];

  return (
    <span className={`meeting-save-state meeting-save-state--${state}`}>
      {content}
    </span>
  );
};

const navigateToAdjacentEditor = (
  current: HTMLTextAreaElement,
  direction: 'up' | 'down',
): boolean => {
  const editors = Array.from(
    document.querySelectorAll('[data-meeting-note-editor]'),
  );
  const currentEditor = current.closest('[data-meeting-note-editor]');
  const index = currentEditor ? editors.indexOf(currentEditor) : -1;
  if (index === -1) return false;
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  const nextEditor = editors[nextIndex];
  if (!nextEditor) return false;
  const nextTextarea =
    nextEditor.querySelector<HTMLTextAreaElement>('textarea');
  if (nextTextarea) {
    nextTextarea.focus();
    const position = direction === 'up' ? nextTextarea.value.length : 0;
    nextTextarea.setSelectionRange(position, position);
    return true;
  }
  const editTrigger =
    nextEditor.querySelector<HTMLButtonElement>('[data-edit-item]');
  if (!editTrigger) return false;
  editTrigger.click();
  return true;
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

/** A generated line the user cleared is deleted from view; its original stays in the edit history. */
const isShownBlock = (block: MeetingNotesBlock): boolean =>
  !(
    block.path &&
    !block.nativeContinuation &&
    block.blockType !== 'action' &&
    !block.text.trim() &&
    block.originalText.trim()
  );

const savedUserNotes = (meeting: Meeting): string =>
  meetingUserNotesWithEdits(
    meeting.user_notes,
    parseUserEditsJson(meeting.user_edits_json),
  );

const InlineEditableText = ({
  meetingId,
  path,
  originalText,
  text,
  asHeading = false,
  onCreateNativeContinuation,
  onSaveNativeContinuation,
  onDeleteNativeContinuation,
  onSaveStateChange,
  autoFocus = false,
  onSaved,
  entities = [],
  placeholder,
  allowEmpty = false,
}: {
  meetingId: string | number;
  path?: string;
  originalText: string;
  text: string;
  /** Shown, faintly, when the block is empty. */
  placeholder?: string;
  /**
   * Whether clearing the text saves it as empty (removing the line). When
   * false, an empty block gets its text back only once the user leaves it,
   * never while they are still typing.
   */
  allowEmpty?: boolean;
  asHeading?: boolean;
  onCreateNativeContinuation?: () => Promise<void>;
  onSaveNativeContinuation?: (text: string) => Promise<void>;
  onDeleteNativeContinuation?: () => Promise<void>;
  onSaveStateChange?: (state: SaveState, retry?: () => void) => void;
  autoFocus?: boolean;
  onSaved: () => void;
  entities?: EntityOption[];
}) => {
  const [draft, setDraft] = useState(text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(asHeading);
  const [slashMenu, setSlashMenu] =
    useState<SlashMenuState>(INITIAL_SLASH_MENU);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveGenerationRef = useRef(0);
  const lastSavedValueRef = useRef(text.trim());
  const draftRef = useRef(text);
  const editingRef = useRef(editing);
  const editSessionStartRef = useRef(text);
  const suppressNextBlurSaveRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshAfterEditingRef = useRef(false);
  const flushPendingSaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    lastSavedValueRef.current = text.trim();
    if (!editingRef.current) {
      setDraft(text);
      draftRef.current = text;
      setEditing(asHeading);
    }
  }, [asHeading, text]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      const hadPendingSave = saveTimerRef.current !== null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      mountedRef.current = false;
      if (hadPendingSave) flushPendingSaveRef.current();
    };
  }, []);

  useEffect(() => {
    if (editing && !asHeading) {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      // Without a click position, start at the end, as in any document.
      const pos = pendingCaretRef.current ?? ta.value.length;
      pendingCaretRef.current = null;
      ta.setSelectionRange(pos, pos);
    }
  }, [editing, asHeading]);

  useEffect(() => {
    if (autoFocus && !asHeading) {
      editSessionStartRef.current = draftRef.current;
      setEditing(true);
    }
  }, [autoFocus, asHeading]);

  const className = asHeading
    ? 'meeting-editable-heading w-full resize-none overflow-hidden bg-transparent outline-none block'
    : 'w-full resize-none overflow-hidden bg-transparent outline-none font-sans text-[16px] leading-[1.55] m-0 p-0 block';

  const clearSaveTimer = () => {
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  };

  const reportSaveState = (state: SaveState, retry?: () => void) => {
    onSaveStateChange?.(state, retry);
  };

  const save = (newValue: string): Promise<void> => {
    const next = newValue.trim();
    clearSaveTimer();
    if (!next && !onSaveNativeContinuation && !allowEmpty) {
      setDraft(text);
      draftRef.current = text;
      reportSaveState('saved');
      return Promise.resolve();
    }
    if (
      next === lastSavedValueRef.current &&
      !(onSaveNativeContinuation && !next)
    ) {
      reportSaveState('saved');
      return Promise.resolve();
    }

    const generation = ++saveGenerationRef.current;
    if (mountedRef.current) {
      setSaving(true);
      setError(null);
      reportSaveState('saving');
    }

    const operation = saveChainRef.current.then(async () => {
      if (
        next === lastSavedValueRef.current &&
        !(onSaveNativeContinuation && !next)
      ) {
        if (generation === saveGenerationRef.current) {
          reportSaveState('saved');
        }
        return;
      }
      try {
        if (onSaveNativeContinuation && !next && onDeleteNativeContinuation) {
          await onDeleteNativeContinuation();
        } else if (onSaveNativeContinuation) {
          await onSaveNativeContinuation(next);
        } else if (next === originalText) {
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
        lastSavedValueRef.current = next;
        if (editingRef.current) {
          refreshAfterEditingRef.current = true;
        } else {
          refreshAfterEditingRef.current = false;
          onSaved();
        }
        if (mountedRef.current && generation === saveGenerationRef.current) {
          setError(null);
          reportSaveState('saved');
        }
      } catch (cause) {
        const label = onSaveNativeContinuation
          ? 'native meeting note continuation'
          : 'meeting note edit';
        console.error(`Failed to save ${label}`, cause);
        if (mountedRef.current && generation === saveGenerationRef.current) {
          setError("This edit wasn't saved. Keep Pluto open and retry.");
          reportSaveState('error', () => {
            void save(next);
          });
        }
      } finally {
        if (mountedRef.current && generation === saveGenerationRef.current) {
          setSaving(false);
        }
      }
    });
    saveChainRef.current = operation.catch(() => {});
    return operation;
  };
  flushPendingSaveRef.current = () => {
    void save(draftRef.current);
  };

  useEffect(() => {
    if (!editing) return;
    const next = draft.trim();
    if (next === lastSavedValueRef.current) return;
    // An emptied block waits until the user leaves it, so clearing a line
    // and retyping it never has the old text spring back mid-edit.
    if (!next && !allowEmpty) return;
    reportSaveState('dirty');
    clearSaveTimer();
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void save(draftRef.current);
    }, 650);
    return clearSaveTimer;
  }, [draft, editing, allowEmpty]);

  const beginEditing = () => {
    editSessionStartRef.current = draftRef.current;
    setEditing(true);
  };

  const cancelEditing = (target: HTMLTextAreaElement) => {
    const baseline = editSessionStartRef.current;
    suppressNextBlurSaveRef.current = true;
    clearSaveTimer();
    setDraft(baseline);
    draftRef.current = baseline;
    setError(null);
    if (baseline.trim() !== lastSavedValueRef.current) {
      void save(baseline);
    } else {
      reportSaveState('saved');
    }
    target.blur();
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
      <div className="meeting-inline-preview" data-meeting-note-editor>
        <div
          className="meeting-markdown-preview"
          onMouseDown={(e) => {
            // Prevent the mousedown from blurring the currently-focused textarea
            // before we've had a chance to set editing=true. This way a single
            // click moves focus directly from one block to the next.
            e.preventDefault();
            const previewEl = e.currentTarget;
            const { clientX, clientY } = e;
            let clickedNode: Node | null = null;
            let offsetInNode = 0;

            try {
              if ('caretPositionFromPoint' in document) {
                const pos = (
                  document as Document & {
                    caretPositionFromPoint: (
                      x: number,
                      y: number,
                    ) => { offsetNode: Node; offset: number } | null;
                  }
                ).caretPositionFromPoint(clientX, clientY);
                if (pos) {
                  clickedNode = pos.offsetNode;
                  offsetInNode = pos.offset;
                }
              } else if ('caretRangeFromPoint' in document) {
                const range = (
                  document as Document & {
                    caretRangeFromPoint: (x: number, y: number) => Range | null;
                  }
                ).caretRangeFromPoint(clientX, clientY);
                if (range) {
                  clickedNode = range.startContainer;
                  offsetInNode = range.startOffset;
                }
              }
            } catch {
              pendingCaretRef.current = draft.length;
            }

            // Resolve the click coordinates to a character offset in the
            // rendered HTML text, then map it into the raw markdown string.
            // Hit-test before replacing the preview, but defer its potentially
            // expensive text traversal so edit mode opens first.
            beginEditing();
            requestAnimationFrame(() => {
              try {
                if (clickedNode) {
                  // Walk all text nodes inside the preview to get an absolute
                  // character offset within the element's full text content.
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
                      pendingCaretRef.current = Math.round(
                        ratio * draft.length,
                      );
                    }
                  }
                }
              } catch {
                // If anything goes wrong, just open at end
                pendingCaretRef.current = draft.length;
              }

              if (pendingCaretRef.current !== null) {
                const position = pendingCaretRef.current;
                pendingCaretRef.current = null;
                textareaRef.current?.setSelectionRange(position, position);
              }
            });
          }}
        >
          {placeholder && !draft.trim() ? (
            <p className="meeting-note-placeholder">{placeholder}</p>
          ) : (
            renderMarkdown()
          )}
        </div>
        <button
          type="button"
          className="meeting-note-edit-trigger"
          data-edit-item
          aria-label={`Edit item: ${text}`}
          title="Edit item"
          onClick={beginEditing}
        >
          <Pencil aria-hidden="true" size={13} />
        </button>
        {error ? <p className="meeting-edit-error">{error}</p> : null}
      </div>
    );
  }

  const executeSlashCommand = (cmdId: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const val = draftRef.current;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = val.indexOf('\n', pos);
    const endOfLine = lineEnd === -1 ? val.length : lineEnd;
    const before = val.slice(0, lineStart);
    const after = val.slice(endOfLine);

    if (cmdId === 'person' || cmdId === 'project') {
      // Swap "/person" for "@" (or "#") so further typing filters the list.
      const sigil = cmdId === 'person' ? '@' : '#';
      const nextVal = `${before}${sigil}${after}`;
      setDraft(nextVal);
      draftRef.current = nextVal;
      setSlashMenu((prev) => ({
        ...prev,
        mode: cmdId,
        query: '',
        selectedIndex: 0,
      }));
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(lineStart + 1, lineStart + 1);
      });
      return;
    }

    let replacement = '';
    if (cmdId === 'todo') replacement = '- [ ] ';
    else if (cmdId === 'task') replacement = '[task: ]';
    else if (cmdId === 'bullet') replacement = '- ';
    else if (cmdId === 'quote') replacement = '> ';
    else if (cmdId === 'h1') replacement = '# ';
    else if (cmdId === 'h2') replacement = '## ';
    else if (cmdId === 'h3') replacement = '### ';
    else if (cmdId === 'numbered') replacement = '1. ';
    else if (cmdId === 'divider') replacement = '---\n';

    const nextVal = `${before}${replacement}${after}`;
    setDraft(nextVal);
    draftRef.current = nextVal;
    setSlashMenu(INITIAL_SLASH_MENU);
    requestAnimationFrame(() => {
      // A task's title goes inside "[task: ]", before the "]".
      const newPos =
        lineStart + replacement.length - (cmdId === 'task' ? 1 : 0);
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const selectPersonFromSlash = (person: EntityOption) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const val = draftRef.current;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    const before = val.slice(0, lineStart);
    const after = val.slice(pos).replace(/^\s+/, '');
    const nextVal = `${before}@${person.name} ${after}`;
    setDraft(nextVal);
    draftRef.current = nextVal;
    setSlashMenu(INITIAL_SLASH_MENU);
    requestAnimationFrame(() => {
      const newPos = lineStart + person.name.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  };

  const selectProjectFromSlash = (project: EntityOption) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const val = draftRef.current;
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    const before = val.slice(0, lineStart);
    const after = val.slice(pos).replace(/^\s+/, '');
    const nextVal = `${before}#${project.name} ${after}`;
    setDraft(nextVal);
    draftRef.current = nextVal;
    setSlashMenu(INITIAL_SLASH_MENU);
    requestAnimationFrame(() => {
      const newPos = lineStart + project.name.length + 2;
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  };

  return (
    <div
      className="meeting-inline-editable relative group w-full"
      data-meeting-note-editor={asHeading ? undefined : ''}
    >
      <TextareaAutosize
        ref={textareaRef}
        className={`${className} overflow-hidden`}
        style={{ color: 'var(--notes-ink)' }}
        aria-label={
          asHeading
            ? 'Edit section heading'
            : text
              ? `Edit item: ${text}`
              : placeholder || 'Edit new item'
        }
        placeholder={placeholder}
        value={draft}
        onChange={(event) => {
          let nextVal = event.target.value;
          const pos = event.target.selectionStart;
          const lineStart = nextVal.lastIndexOf('\n', pos - 1) + 1;
          const currentLine = nextVal.slice(lineStart, pos);

          // Real-time markdown shortcuts at start of line
          if (
            currentLine === '- [ ] ' ||
            currentLine === '[] ' ||
            currentLine === '[ ] '
          ) {
            const before = nextVal.slice(0, lineStart);
            const after = nextVal.slice(pos);
            nextVal = `${before}- [ ] ${after}`;
          }

          const entityMode =
            slashMenu.isOpen &&
            (slashMenu.mode === 'person' || slashMenu.mode === 'project');
          const sigil = slashMenu.mode === 'person' ? '@' : '#';
          if (entityMode && currentLine.startsWith(sigil)) {
            setSlashMenu((prev) => ({
              ...prev,
              query: currentLine.slice(1),
              selectedIndex: 0,
            }));
          } else if (currentLine.startsWith('/')) {
            setSlashMenu({
              isOpen: true,
              blockIndex: 0,
              query: currentLine.slice(1),
              selectedIndex: 0,
              mode: 'root',
            });
          } else if (slashMenu.isOpen) {
            setSlashMenu(INITIAL_SLASH_MENU);
          }

          setDraft(nextVal);
          draftRef.current = nextVal;
        }}
        onBlur={(event) => {
          editingRef.current = false;
          setEditing(false);
          if (suppressNextBlurSaveRef.current) {
            suppressNextBlurSaveRef.current = false;
            return;
          }
          draftRef.current = event.target.value;
          void save(event.target.value);
          if (refreshAfterEditingRef.current) {
            refreshAfterEditingRef.current = false;
            onSaved();
          }
        }}
        onKeyDown={(event) => {
          if (slashMenu.isOpen) {
            if (event.key === 'Escape') {
              event.preventDefault();
              setSlashMenu(INITIAL_SLASH_MENU);
              return;
            }
            const items = filterSlashMenuItems(slashMenu, entities);
            const options =
              slashMenu.mode === 'person'
                ? items.people
                : slashMenu.mode === 'project'
                  ? items.projects
                  : items.commands;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              if (options.length > 0) {
                setSlashMenu((prev) => ({
                  ...prev,
                  selectedIndex:
                    (prev.selectedIndex + delta + options.length) %
                    options.length,
                }));
              }
              return;
            }
            if (
              (event.key === 'Enter' || event.key === 'Tab') &&
              !event.shiftKey
            ) {
              const chosen = options[slashMenu.selectedIndex];
              if (chosen) {
                event.preventDefault();
                if (slashMenu.mode === 'person') {
                  selectPersonFromSlash(chosen as EntityOption);
                } else if (slashMenu.mode === 'project') {
                  selectProjectFromSlash(chosen as EntityOption);
                } else {
                  executeSlashCommand(chosen.id);
                }
                return;
              }
              setSlashMenu(INITIAL_SLASH_MENU);
            }
          }
          // Cmd+Enter toggles the checkbox on the current line
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            const target = event.currentTarget;
            const pos = target.selectionStart;
            const val = target.value;
            const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
            const lineEndRaw = val.indexOf('\n', pos);
            const lineEnd = lineEndRaw === -1 ? val.length : lineEndRaw;
            const line = val.slice(lineStart, lineEnd);
            const toggled = line.replace(
              /^(\s*[-*+]\s+\[)([ xX])(\])/,
              (_m, open: string, state: string, close: string) =>
                `${open}${state.trim() ? ' ' : 'x'}${close}`,
            );
            if (toggled !== line) {
              event.preventDefault();
              const nextVal = `${val.slice(0, lineStart)}${toggled}${val.slice(lineEnd)}`;
              setDraft(nextVal);
              draftRef.current = nextVal;
              requestAnimationFrame(() => target.setSelectionRange(pos, pos));
              return;
            }
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'b'
          ) {
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const val = target.value;
            const sel = val.substring(start, end);
            const nextVal = `${val.substring(0, start)}**${sel}**${val.substring(end)}`;
            setDraft(nextVal);
            draftRef.current = nextVal;
            requestAnimationFrame(() => {
              target.setSelectionRange(start + 2, end + 2);
            });
            return;
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'i'
          ) {
            event.preventDefault();
            const target = event.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const val = target.value;
            const sel = val.substring(start, end);
            const nextVal = `${val.substring(0, start)}*${sel}*${val.substring(end)}`;
            setDraft(nextVal);
            draftRef.current = nextVal;
            requestAnimationFrame(() => {
              target.setSelectionRange(start + 1, end + 1);
            });
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelEditing(event.currentTarget);
            return;
          }
          if (
            (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            const target = event.currentTarget;
            const { onFirstLine, onLastLine } = caretVisualEdges(target);
            const direction = event.key === 'ArrowUp' ? 'up' : 'down';
            if (
              (direction === 'up' ? onFirstLine : onLastLine) &&
              navigateToAdjacentEditor(target, direction)
            ) {
              event.preventDefault();
            }
          }
          if (event.key === 'Backspace') {
            const target = event.currentTarget;
            if (target.selectionStart === 0 && target.selectionEnd === 0) {
              if (onSaveNativeContinuation && !target.value.trim()) {
                event.preventDefault();
                target.blur();
                return;
              }
              if (navigateToAdjacentEditor(target, 'up')) {
                event.preventDefault();
              }
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
        aria-busy={saving}
        spellCheck
      />
      {slashMenu.isOpen && (
        <NotionSlashMenu
          state={slashMenu}
          entities={entities}
          onExecuteCommand={executeSlashCommand}
          onSelectPerson={selectPersonFromSlash}
          onSelectProject={selectProjectFromSlash}
          onClose={() => setSlashMenu(INITIAL_SLASH_MENU)}
        />
      )}
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
  onDeleteNativeContinuation,
  onSaveStateChange,
  onSelectSource,
  autoFocus,
  selected,
  reminderControls,
  entities = [],
}: {
  block: MeetingNotesBlock;
  section: MeetingNotesSection;
  meetingId: string | number;
  onSaved: () => void;
  onCreateNativeContinuation?: () => Promise<void>;
  onUpdateNativeContinuation?: (
    update: Partial<NativeMeetingNoteContinuation>,
  ) => Promise<void>;
  onDeleteNativeContinuation?: () => Promise<void>;
  onSaveStateChange: (state: SaveState, retry?: () => void) => void;
  onSelectSource?: () => void;
  autoFocus: boolean;
  selected: boolean;
  reminderControls?: React.ReactNode;
  entities?: EntityOption[];
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
      className={`meeting-note-block group meeting-note-block--${section.kind} ${block.blockType === 'paragraph' ? 'meeting-note-block--paragraph' : ''} ${selected ? 'is-source-selected' : ''}`}
      data-authorship={block.authorship}
      data-reminder-target={reminderControls ? 'true' : undefined}
    >
      <div className="meeting-note-gutter opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity select-none -ml-8 mr-1 mt-0.5 shrink-0 flex items-center">
        <NotionBlockGutter
          blockType={block.blockType}
          onAddBlock={onCreateNativeContinuation}
          onGripClick={() => {
            const btn = document.querySelector<HTMLButtonElement>(
              `[aria-label="Edit item: ${block.text}"]`,
            );
            btn?.click();
          }}
        />
      </div>
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
        {block.blockType === 'review' ? (
          <button
            type="button"
            className="meeting-note-review-link"
            onClick={onSelectSource}
          >
            <FileText aria-hidden="true" size={14} />
            {block.text}
          </button>
        ) : (
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
            onDeleteNativeContinuation={onDeleteNativeContinuation}
            onSaveStateChange={onSaveStateChange}
            autoFocus={autoFocus}
            onSaved={onSaved}
            entities={entities}
            allowEmpty={
              Boolean(block.path) &&
              !block.nativeContinuation &&
              block.blockType !== 'action'
            }
          />
        )}
        {block.assignee || (block.due && !reminderControls) ? (
          <div className="meeting-note-assignment">
            {block.assignee ? <span>Owner: {block.assignee}</span> : null}
            {block.due && !reminderControls ? (
              <span>Due {block.due}</span>
            ) : null}
          </div>
        ) : null}
        <div className="meeting-note-block__meta">
          {block.blockType === 'review' ? (
            <span>Not included in finished notes</span>
          ) : block.authorship === 'human' ? (
            <span className="meeting-authorship meeting-authorship--human">
              Written by you
            </span>
          ) : (
            <span className="meeting-authorship" title="Drafted by Pluto">
              Pluto draft
            </span>
          )}
          {block.speaker ? <span>{block.speaker}</span> : null}
          {block.edited ? (
            <span>
              <Pencil aria-hidden="true" size={10} /> Edited
            </span>
          ) : null}
        </div>
        {completionError ? (
          <p className="meeting-edit-error">{completionError}</p>
        ) : null}
        {reminderControls}
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
  reminderEntityId,
  onDismissReminder,
  meeting,
  model,
  transcriptSegments,
  onDocumentChanged,
  onShowTranscript,
  header,
  workspaceStatus,
}: MeetingNotesDocumentProps) => {
  const reminderRoot = useRef<HTMLDivElement>(null);
  const [reminderLookup, setReminderLookup] = useState<{
    id: string;
    entity: Entity | null;
  } | null>(null);
  useEffect(() => {
    if (!reminderEntityId) return;
    let active = true;
    void getEntity(reminderEntityId)
      .then((entity) => {
        if (active)
          setReminderLookup({
            id: reminderEntityId,
            entity: entity?.type === 'action_item' ? entity : null,
          });
      })
      .catch(() => {
        if (active) setReminderLookup({ id: reminderEntityId, entity: null });
      });
    return () => {
      active = false;
    };
  }, [reminderEntityId, meeting.id]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [retrySave, setRetrySave] = useState<(() => void) | null>(null);
  const [pendingNativeContinuationId, setPendingNativeContinuationId] =
    useState<string | null>(null);
  const [creatingContinuationPath, setCreatingContinuationPath] = useState<
    string | null
  >(null);
  const [deletedContinuation, setDeletedContinuation] =
    useState<DeletedContinuation | null>(null);
  const [nativeContinuationOverrides, setNativeContinuationOverrides] =
    useState<Map<string, NativeMeetingNoteContinuation[]>>(() => new Map());
  const [sourceSelection, setSourceSelection] =
    useState<SourceSelection | null>(() => previewSourceSelection(model));
  const [entities] = useState<EntityOption[]>([]);
  const meetingRef = useRef(meeting);
  const onDocumentChangedRef = useRef(onDocumentChanged);
  const nativeContinuationStateRef = useRef(
    new Map<string, NativeMeetingNoteContinuation[]>(),
  );
  const nativeContinuationSaveChainsRef = useRef(
    new Map<string, Promise<void>>(),
  );
  const unsavedContinuationIdsRef = useRef(new Set<string>());

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);
  useEffect(() => {
    onDocumentChangedRef.current = onDocumentChanged;
  }, [onDocumentChanged]);
  useEffect(() => {
    setSaveState('saved');
    setRetrySave(null);
    setSourceSelection(previewSourceSelection(model));
  }, [meeting.id, meeting.user_notes, model]);
  useEffect(() => {
    setDeletedContinuation(null);
    setNativeContinuationOverrides(new Map());
    nativeContinuationStateRef.current.clear();
    nativeContinuationSaveChainsRef.current.clear();
    unsavedContinuationIdsRef.current.clear();
  }, [meeting.id]);
  useEffect(() => {
    if (!deletedContinuation) return;
    const timeout = setTimeout(() => setDeletedContinuation(null), 5000);
    return () => clearTimeout(timeout);
  }, [deletedContinuation]);

  const handleSaveStateChange = (state: SaveState, retry?: () => void) => {
    setSaveState(state);
    setRetrySave(retry ? () => retry : null);
  };

  const getNativeContinuations = (
    parentPath: string,
    fallback: NativeMeetingNoteContinuation[],
  ) => nativeContinuationStateRef.current.get(parentPath) || fallback;

  const setNativeContinuationState = (
    parentPath: string,
    continuations: NativeMeetingNoteContinuation[],
  ) => {
    nativeContinuationStateRef.current.set(parentPath, continuations);
    setNativeContinuationOverrides((current) => {
      const next = new Map(current);
      next.set(parentPath, continuations);
      return next;
    });
  };

  const saveNativeContinuations = (
    parentPath: string,
    continuations: NativeMeetingNoteContinuation[],
  ): Promise<void> => {
    setNativeContinuationState(parentPath, continuations);
    const previous =
      nativeContinuationSaveChainsRef.current.get(parentPath) ||
      Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        await window.ipcRenderer.invoke('SAVE_USER_EDIT', {
          meetingId: meetingRef.current.id,
          path: nativeContinuationEditPath(parentPath),
          original: '[]',
          edited: JSON.stringify(continuations),
        });
      });
    nativeContinuationSaveChainsRef.current.set(
      parentPath,
      operation.catch(() => {}),
    );
    return operation;
  };

  const createNativeContinuation = async (block: MeetingNotesBlock) => {
    const parentPath = block.nativeContinuation?.parentPath || block.path;
    if (!parentPath || creatingContinuationPath === parentPath) return;
    setCreatingContinuationPath(parentPath);
    const id =
      globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const latest = getNativeContinuations(
      parentPath,
      block.nativeContinuations || [],
    );
    unsavedContinuationIdsRef.current.add(id);
    setPendingNativeContinuationId(id);
    setNativeContinuationState(parentPath, [
      ...latest,
      {
        id,
        text: '',
        kind: block.blockType ?? 'note',
        ...(block.blockType === 'action'
          ? { assignee: block.assignee ?? null }
          : {}),
      },
    ]);
    setCreatingContinuationPath(null);
  };

  const updateNativeContinuation = async (
    block: MeetingNotesBlock,
    update: Partial<NativeMeetingNoteContinuation>,
  ) => {
    const parentPath = block.nativeContinuation?.parentPath;
    if (!parentPath || !block.nativeContinuation) return;
    const continuations = getNativeContinuations(
      parentPath,
      block.nativeContinuations || [],
    )
      .map((continuation) =>
        continuation.id === block.nativeContinuation?.id
          ? { ...continuation, ...update }
          : continuation,
      )
      .filter((continuation) => continuation.text.trim());
    await saveNativeContinuations(parentPath, continuations);
    unsavedContinuationIdsRef.current.delete(block.nativeContinuation.id);
  };

  const deleteNativeContinuation = async (block: MeetingNotesBlock) => {
    const parentPath = block.nativeContinuation?.parentPath;
    const continuationId = block.nativeContinuation?.id;
    if (!parentPath || !continuationId) return;
    const latest = getNativeContinuations(
      parentPath,
      block.nativeContinuations || [],
    );
    const continuation = latest.find(
      (candidate) => candidate.id === continuationId,
    ) || {
      id: continuationId,
      text: block.text,
      completed: block.completed,
    };
    const remaining = latest.filter(
      (candidate) => candidate.id !== continuationId,
    );
    if (unsavedContinuationIdsRef.current.delete(continuationId)) {
      setNativeContinuationState(parentPath, remaining);
      handleSaveStateChange('saved');
      return;
    }
    try {
      await saveNativeContinuations(parentPath, remaining);
      setDeletedContinuation({ parentPath, continuation });
      handleSaveStateChange('saved');
    } catch (cause) {
      setNativeContinuationState(parentPath, latest);
      handleSaveStateChange('error', () => {
        handleSaveStateChange('saving');
        void deleteNativeContinuation(block)
          .then(() => onDocumentChangedRef.current())
          .catch(() => {});
      });
      throw cause;
    }
  };

  const undoNativeContinuationDeletion = async () => {
    if (!deletedContinuation) return;
    const { parentPath, continuation } = deletedContinuation;
    const parentBlock = model.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.path === parentPath);
    const latest = getNativeContinuations(
      parentPath,
      parentBlock?.nativeContinuations || [],
    );
    const restored = latest.some(
      (candidate) => candidate.id === continuation.id,
    )
      ? latest
      : [...latest, continuation];
    handleSaveStateChange('saving');
    try {
      await saveNativeContinuations(parentPath, restored);
      setDeletedContinuation(null);
      handleSaveStateChange('saved');
      onDocumentChanged();
    } catch (cause) {
      console.error('Failed to undo meeting note deletion', cause);
      handleSaveStateChange('error', () => {
        void undoNativeContinuationDeletion();
      });
    }
  };

  const canContinueAsNativeRow = (block: MeetingNotesBlock) =>
    block.blockType === 'note' ||
    block.blockType === 'action' ||
    block.blockType === 'decision' ||
    (Boolean(block.path) && block.blockType !== 'paragraph');
  const visibleSections = applyNativeContinuationOverrides(
    model.sections,
    nativeContinuationOverrides,
  );
  const reminderEntity =
    reminderLookup && reminderLookup.id === reminderEntityId
      ? reminderLookup.entity
      : null;
  const reminderBlock = reminderEntity
    ? findReminderNoteBlock(visibleSections, reminderEntity, meeting.id)
    : null;
  useEffect(() => {
    if (reminderBlock)
      reminderRoot.current
        ?.querySelector('[data-reminder-target="true"]')
        ?.scrollIntoView?.({ block: 'center' });
  }, [reminderEntityId, reminderBlock?.id]);
  return (
    <div ref={reminderRoot} className="meeting-document-workspace">
      {workspaceStatus}
      <article
        className="meeting-notes-document"
        data-reading-surface="meeting-notes"
        aria-label="Meeting notes"
      >
        {header}
        {reminderEntityId &&
          reminderLookup?.id === reminderEntityId &&
          !reminderBlock && (
            <div className="meeting-reminder-region">
              <p className="mb-3 text-sm text-pro-text-muted">
                This reminder couldn’t be matched to an item in these notes.
              </p>
              <ProjectCommitments
                focusEntityId={reminderEntityId}
                defaultOpen
                onDismiss={onDismissReminder}
                onChanged={onDocumentChanged}
              />
            </div>
          )}
        <output className="meeting-document-save-row" aria-live="polite">
          <SaveStatus state={saveState} onRetry={retrySave || undefined} />
        </output>
        {visibleSections
          .filter((s) => s.kind !== 'scratchpad')
          .map((section) => {
            const continuationAnchor = [...section.blocks]
              .reverse()
              .find(canContinueAsNativeRow);
            const anchorPath =
              continuationAnchor?.nativeContinuation?.parentPath ||
              continuationAnchor?.path;
            return (
              <section
                key={section.id}
                id={`meeting-section-${section.id}`}
                className={`meeting-notes-section meeting-notes-section--${section.kind}`}
                data-notes-section={section.kind}
              >
                <InlineEditableText
                  meetingId={meeting.id}
                  path={section.titlePath}
                  originalText={section.titleOriginal || section.title}
                  text={section.title}
                  asHeading
                  onSaveStateChange={handleSaveStateChange}
                  onSaved={onDocumentChanged}
                />
                <div className="meeting-notes-section__content">
                  {section.blocks.filter(isShownBlock).map((block) => (
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
                          ? (update) => updateNativeContinuation(block, update)
                          : undefined
                      }
                      onDeleteNativeContinuation={
                        block.nativeContinuation
                          ? () => deleteNativeContinuation(block)
                          : undefined
                      }
                      onSaveStateChange={handleSaveStateChange}
                      onSelectSource={
                        block.blockType === 'review'
                          ? () =>
                              setSourceSelection({
                                label: block.text,
                                evidence: block.evidence,
                                transcriptRange: block.transcriptRange,
                              })
                          : undefined
                      }
                      autoFocus={
                        block.nativeContinuation?.id ===
                        pendingNativeContinuationId
                      }
                      selected={sourceSelection?.label === block.text}
                      reminderControls={
                        reminderBlock?.id === block.id ? (
                          <ProjectCommitments
                            focusEntityId={reminderEntityId}
                            embedded
                            defaultOpen
                            revision={meeting.user_edits_json}
                            onDismiss={onDismissReminder}
                            onChanged={onDocumentChanged}
                          />
                        ) : undefined
                      }
                      entities={entities}
                    />
                  ))}
                </div>
                {continuationAnchor && anchorPath ? (
                  <button
                    type="button"
                    className="meeting-notes-add-item"
                    disabled={creatingContinuationPath === anchorPath}
                    onClick={() => {
                      void createNativeContinuation(continuationAnchor).catch(
                        (cause) => {
                          console.error(
                            'Failed to add native meeting note item',
                            cause,
                          );
                        },
                      );
                    }}
                  >
                    {creatingContinuationPath === anchorPath ? (
                      <Loader2
                        aria-hidden="true"
                        size={13}
                        className="animate-spin"
                      />
                    ) : (
                      <Plus aria-hidden="true" size={13} />
                    )}
                    Add item
                  </button>
                ) : null}
              </section>
            );
          })}
        {/* Your own notes continue the document as ordinary text, with no
            heading of their own. Saved as an edit over the notes typed
            during the meeting, so the summary's inputs never change. */}
        <section
          className="meeting-notes-section meeting-notes-section--scratchpad"
          data-notes-section="scratchpad"
          aria-label="Your notes"
          onMouseDown={(event) => {
            // Clicking the blank space below the summary starts writing at
            // the end of your notes, as in any document.
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            const section = event.currentTarget;
            const textarea = section.querySelector('textarea');
            if (textarea) textarea.focus();
            else
              section
                .querySelector<HTMLButtonElement>('[data-edit-item]')
                ?.click();
          }}
        >
          <InlineEditableText
            key={meeting.id}
            meetingId={meeting.id}
            path={MEETING_USER_NOTES_EDIT_PATH}
            originalText={meeting.user_notes ?? ''}
            text={savedUserNotes(meeting)}
            placeholder="Write anything…"
            allowEmpty
            onSaveStateChange={handleSaveStateChange}
            onSaved={onDocumentChanged}
            entities={entities}
          />
        </section>
        {deletedContinuation ? (
          <output className="meeting-note-undo" aria-live="polite">
            <span>Item deleted</span>
            <button
              type="button"
              onClick={() => void undoNativeContinuationDeletion()}
            >
              Undo
            </button>
          </output>
        ) : null}
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
