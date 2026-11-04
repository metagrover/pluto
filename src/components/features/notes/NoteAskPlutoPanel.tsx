import {
  AlignLeft,
  ArrowUp,
  Check,
  CircleDashed,
  Copy,
  CornerDownLeft,
  ListTodo,
  Mail,
  Square,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import TextareaAutosize from 'react-textarea-autosize';
import remarkGfm from 'remark-gfm';
import {
  askPlutoAboutNote,
  cancelNoteAskPluto,
  subscribeNoteAskPlutoDelta,
} from '../../../api/notes';
import type {
  NoteAskPlutoIntent,
  NoteAskPlutoTurn,
} from '../../../types/notes';
import { Logo } from '../../Brand/Logo';

export interface NoteAskPlutoSelection {
  text: string;
  /** Where answers are inserted: after this block. */
  blockIndex: number;
  /** Set when whole blocks were selected rather than text in one block. */
  blockCount?: number;
}

interface NoteAskPlutoPanelProps {
  noteId: string;
  selection: NoteAskPlutoSelection | null;
  onClearSelection: () => void;
  onClose: () => void;
  /** Inserts an answer into the note as blocks. */
  onInsertMarkdown: (markdown: string) => void;
  /** Adds approved suggestions to the note as synced tasks. */
  onAddTasks: (titles: string[]) => void;
}

interface PanelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent: NoteAskPlutoIntent;
  suggestedTasks?: string[];
  addedTasks?: boolean;
  inserted?: boolean;
  stopped?: boolean;
  fallbackModel?: string;
}

const STARTERS: Array<{
  intent: Exclude<NoteAskPlutoIntent, 'ask'>;
  label: string;
  icon: typeof AlignLeft;
}> = [
  { intent: 'summarize', label: 'Summarize', icon: AlignLeft },
  { intent: 'tasks', label: 'Pull out tasks', icon: ListTodo },
  { intent: 'open_items', label: 'What’s still open?', icon: CircleDashed },
  { intent: 'follow_up', label: 'Draft a follow-up', icon: Mail },
];

const STARTER_LABEL: Record<NoteAskPlutoIntent, string> = {
  ask: '',
  summarize: 'Summarize this note',
  tasks: 'Pull out tasks',
  open_items: 'What’s still open?',
  follow_up: 'Draft a follow-up',
};

const newRequestId = () =>
  `note-ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const NoteAskPlutoPanel: React.FC<NoteAskPlutoPanelProps> = ({
  noteId,
  selection,
  onClearSelection,
  onClose,
  onInsertMarkdown,
  onAddTasks,
}) => {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const [query, setQuery] = useState('');
  const [streaming, setStreaming] = useState('');
  const [pending, setPending] = useState<NoteAskPlutoIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [taskChoices, setTaskChoices] = useState<Record<string, string[]>>({});
  const activeRequestRef = useRef<string | null>(null);
  const lastRequestRef = useRef<{
    intent: NoteAskPlutoIntent;
    query: string;
  } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeNoteAskPlutoDelta((packet) => {
      if (packet.requestId !== activeRequestRef.current || !packet.delta) {
        return;
      }
      setStreaming((current) => current + packet.delta);
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
      if (activeRequestRef.current) {
        cancelNoteAskPluto(activeRequestRef.current);
        activeRequestRef.current = null;
      }
    };
  }, []);

  // Keep the newest turn in view.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, streaming, pending]);

  const ask = useCallback(
    async (intent: NoteAskPlutoIntent, rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (pending || (intent === 'ask' && !trimmed)) return;
      const requestId = newRequestId();
      const turns: NoteAskPlutoTurn[] = messages
        .filter((message) => !message.stopped)
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.content.slice(0, 2_000),
        }));
      lastRequestRef.current = { intent, query: trimmed };
      activeRequestRef.current = requestId;
      setError(null);
      setErrorDetail(null);
      setStreaming('');
      setQuery('');
      setPending(intent);
      setMessages((current) => [
        ...current,
        {
          id: `user-${requestId}`,
          role: 'user',
          content: trimmed || STARTER_LABEL[intent],
          intent,
        },
      ]);
      try {
        const response = await askPlutoAboutNote({
          requestId,
          noteId,
          intent,
          query: trimmed,
          ...(selection ? { selection: selection.text } : {}),
          turns,
        });
        if (!mountedRef.current || activeRequestRef.current !== requestId) {
          return;
        }
        if (response.status !== 'answered' || !response.answer.trim()) {
          setError(response.error || 'Pluto could not answer right now.');
          setErrorDetail(response.detail ?? null);
          return;
        }
        const id = `assistant-${requestId}`;
        if (response.suggestedTasks?.length) {
          setTaskChoices((current) => ({
            ...current,
            [id]: response.suggestedTasks ?? [],
          }));
        }
        setMessages((current) => [
          ...current,
          {
            id,
            role: 'assistant',
            content: response.answer,
            intent,
            suggestedTasks: response.suggestedTasks,
            fallbackModel: response.fallbackModel,
          },
        ]);
      } catch (askError) {
        console.error('Note Ask Pluto failed:', askError);
        if (mountedRef.current && activeRequestRef.current === requestId) {
          setError('Pluto could not answer right now.');
        }
      } finally {
        if (mountedRef.current && activeRequestRef.current === requestId) {
          activeRequestRef.current = null;
          setPending(null);
          setStreaming('');
        }
      }
    },
    [messages, noteId, pending, selection],
  );

  const stop = () => {
    const requestId = activeRequestRef.current;
    if (!requestId) return;
    activeRequestRef.current = null;
    cancelNoteAskPluto(requestId);
    const partial = streaming.trim();
    if (partial && pending) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-stopped-${requestId}`,
          role: 'assistant',
          content: partial,
          intent: pending,
          stopped: true,
        },
      ]);
    }
    setStreaming('');
    setPending(null);
  };

  const copy = async (message: PanelMessage) => {
    try {
      await navigator.clipboard?.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(
        () =>
          setCopiedId((current) => (current === message.id ? null : current)),
        1_500,
      );
    } catch {
      setError('Copy failed. Select the text and copy it instead.');
    }
  };

  const markMessage = (id: string, patch: Partial<PanelMessage>) =>
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    );

  const toggleTaskChoice = (messageId: string, title: string) =>
    setTaskChoices((current) => {
      const chosen = current[messageId] ?? [];
      return {
        ...current,
        [messageId]: chosen.includes(title)
          ? chosen.filter((item) => item !== title)
          : [...chosen, title],
      };
    });

  const isEmpty = messages.length === 0 && !pending;

  return (
    <aside className="note-ask-panel" aria-label="Ask Pluto about this note">
      <header className="note-ask-panel__header">
        <span className="note-ask-panel__mark" aria-hidden="true">
          <Logo size={16} variant="default" />
        </span>
        <div className="note-ask-panel__heading">
          <span>Ask Pluto</span>
          <span>About this note</span>
        </div>
        <button
          type="button"
          className="note-ask-panel__icon-button"
          onClick={onClose}
          aria-label="Close Ask Pluto"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </header>

      <div
        ref={threadRef}
        className="note-ask-panel__thread"
        role="log"
        aria-live="polite"
      >
        {isEmpty ? (
          <div className="note-ask-panel__intro">
            <p>Ask anything about this note, or start with one of these.</p>
            <div className="note-ask-panel__starters">
              {STARTERS.map(({ intent, label, icon: Icon }) => (
                <button
                  key={intent}
                  type="button"
                  className="note-ask-panel__starter"
                  onClick={() => void ask(intent, '')}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} className="note-ask-panel__question">
              {message.content}
            </div>
          ) : (
            <div key={message.id} className="note-ask-panel__answer">
              {message.suggestedTasks?.length ? (
                <div className="note-ask-panel__suggestions">
                  <p className="note-ask-panel__suggestions-lead">
                    Suggested tasks
                  </p>
                  <ul>
                    {message.suggestedTasks.map((title) => {
                      const chosen = (taskChoices[message.id] ?? []).includes(
                        title,
                      );
                      return (
                        <li key={title}>
                          <label>
                            <input
                              type="checkbox"
                              className="notion-task-checkbox"
                              checked={chosen}
                              disabled={message.addedTasks}
                              onChange={() =>
                                toggleTaskChoice(message.id, title)
                              }
                            />
                            <span>{title}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {message.addedTasks ? (
                    <p className="note-ask-panel__done">
                      <Check size={13} aria-hidden="true" />
                      Added to the note and your Tasks list
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="note-ask-panel__primary"
                      disabled={!(taskChoices[message.id] ?? []).length}
                      onClick={() => {
                        onAddTasks(taskChoices[message.id] ?? []);
                        markMessage(message.id, { addedTasks: true });
                      }}
                    >
                      {(() => {
                        const count = (taskChoices[message.id] ?? []).length;
                        return count === 1
                          ? 'Add 1 task to note'
                          : `Add ${count} tasks to note`;
                      })()}
                    </button>
                  )}
                </div>
              ) : (
                <div className="note-ask-panel__markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children }) => <span>{children}</span>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              )}
              {message.stopped ? (
                <span className="note-ask-panel__meta">Stopped</span>
              ) : null}
              {message.fallbackModel ? (
                <span className="note-ask-panel__meta">
                  Answered by the smaller {message.fallbackModel} model, since
                  there wasn’t enough free memory for your main model.
                </span>
              ) : null}
              {!message.suggestedTasks?.length ? (
                <div className="note-ask-panel__actions">
                  <button
                    type="button"
                    disabled={message.inserted}
                    onClick={() => {
                      onInsertMarkdown(message.content);
                      markMessage(message.id, { inserted: true });
                    }}
                  >
                    {message.inserted ? (
                      <Check size={12} aria-hidden="true" />
                    ) : (
                      <CornerDownLeft size={12} aria-hidden="true" />
                    )}
                    {message.inserted ? 'Inserted' : 'Insert into note'}
                  </button>
                  <button type="button" onClick={() => void copy(message)}>
                    {copiedId === message.id ? (
                      <Check size={12} aria-hidden="true" />
                    ) : (
                      <Copy size={12} aria-hidden="true" />
                    )}
                    {copiedId === message.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ) : null}
            </div>
          ),
        )}

        {pending ? (
          <div className="note-ask-panel__answer">
            {streaming ? (
              <div className="note-ask-panel__markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streaming}
                </ReactMarkdown>
              </div>
            ) : (
              <output className="note-ask-panel__reading">
                <span className="note-ask-panel__pulse" aria-hidden="true" />
                Reading this note…
              </output>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="note-ask-panel__error" role="alert">
            <div className="note-ask-panel__error-copy">
              <span>{error}</span>
              {errorDetail ? (
                <details>
                  <summary>Details</summary>
                  <code>{errorDetail}</code>
                </details>
              ) : null}
            </div>
            {lastRequestRef.current ? (
              <button
                type="button"
                onClick={() => {
                  const last = lastRequestRef.current;
                  if (!last) return;
                  // Drop the failed question so the retry isn't duplicated.
                  setMessages((current) => current.slice(0, -1));
                  void ask(last.intent, last.query);
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <form
        className="note-ask-panel__composer"
        onSubmit={(event) => {
          event.preventDefault();
          void ask('ask', query);
        }}
      >
        {selection ? (
          <div className="note-ask-panel__selection">
            <span className="note-ask-panel__selection-label">
              {selection.blockCount && selection.blockCount > 1
                ? `Asking about ${selection.blockCount} selected blocks`
                : 'Asking about your selection'}
            </span>
            <span className="note-ask-panel__selection-text">
              {selection.text}
            </span>
            <button
              type="button"
              className="note-ask-panel__icon-button"
              onClick={onClearSelection}
              aria-label="Ask about the whole note instead"
              title="Ask about the whole note"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}
        <div className="note-ask-panel__field">
          <TextareaAutosize
            ref={composerRef}
            value={query}
            minRows={1}
            maxRows={6}
            maxLength={2_000}
            aria-label="Ask about this note"
            placeholder={
              selection ? 'Ask about the selection…' : 'Ask about this note…'
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                if (pending) stop();
                else onClose();
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask('ask', query);
              }
            }}
          />
          {pending ? (
            <button
              type="button"
              className="note-ask-panel__send"
              onClick={stop}
              aria-label="Stop answer"
              title="Stop"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="note-ask-panel__send"
              disabled={!query.trim()}
              aria-label="Send question"
              title="Send (Enter)"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
        <p className="note-ask-panel__footnote">Answers use only this note.</p>
      </form>
    </aside>
  );
};
