import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Loader2,
  Menu,
  MessageCircle,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  archivePersonChatThread,
  cancelPersonChatRequest,
  createPersonChatThread,
  deletePersonChatThread,
  getPersonChatCapability,
  listPersonChatMessages,
  listPersonChatThreads,
  resumePersonChatThread,
  sendPersonChatMessage,
} from '../../api/personChat';
import { useChatTurnAnchor } from '../../hooks/useChatTurnAnchor';
import type {
  PersonChatCitation,
  PersonChatDelta,
  PersonChatMessage,
  PersonChatStatusUpdate,
  PersonChatThread,
} from '../../types/personChat';
import { Logo } from '../Brand/Logo';

const starterPrompts = (name: string) => [
  `Catch me up on ${name}`,
  'Prepare me for our next conversation',
  'What should I follow up on?',
  'Help me handle a difficult situation',
  `Draft a message to ${name}`,
];

const formatSourceDate = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
};

const SourceList = ({
  citations,
  onOpenMeeting,
}: {
  citations: PersonChatCitation[];
  onOpenMeeting: (meetingId: string) => void;
}) => {
  if (citations.length === 0) return null;
  return (
    <div className="person-chat__sources">
      <details>
        <summary>
          <span>
            {citations.length} {citations.length === 1 ? 'source' : 'sources'}
          </span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <div>
          {citations.map((citation) => (
            <button
              type="button"
              key={citation.id}
              onClick={() => onOpenMeeting(citation.meetingId)}
            >
              <strong>{citation.title}</strong>
              <span>
                {citation.evidenceClass}
                {formatSourceDate(citation.date)
                  ? ` · ${formatSourceDate(citation.date)}`
                  : ''}
              </span>
              <small>{citation.excerpt}</small>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
};

export const PersonChatDock: React.FC<{
  personId: string;
  personName: string;
  onOpenMeeting: (meetingId: string) => void;
}> = ({ personId, personName, onOpenMeeting }) => {
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [threads, setThreads] = useState<PersonChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<PersonChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [streaming, setStreaming] = useState('');
  const [asking, setAsking] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const activeRequest = useRef<string | null>(null);
  const { anchorTurn, conversationRef } = useChatTurnAnchor<HTMLDivElement>(
    messages.length,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const newlyCreatedThread = useRef<string | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [query]);

  const refreshThreads = useCallback(async () => {
    const next = await listPersonChatThreads(personId, true);
    setThreads(next);
    return next;
  }, [personId]);

  useEffect(() => {
    if (!window.ipcRenderer) return;
    let cancelled = false;
    void Promise.all([
      getPersonChatCapability(),
      listPersonChatThreads(personId, true),
    ]).then(([capability, nextThreads]) => {
      if (cancelled) return;
      setEnabled(capability.enabled);
      setThreads(nextThreads);
      setThreadId(
        nextThreads.find((thread) => thread.archivedAt === null)?.id ?? null,
      );
    });
    return () => {
      cancelled = true;
      const requestId = activeRequest.current;
      if (requestId) void cancelPersonChatRequest(requestId);
      activeRequest.current = null;
    };
  }, [personId]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    if (newlyCreatedThread.current === threadId) {
      newlyCreatedThread.current = null;
      return;
    }
    let cancelled = false;
    void listPersonChatMessages(personId, threadId).then((next) => {
      if (!cancelled) setMessages(next);
    });
    return () => {
      cancelled = true;
    };
  }, [personId, threadId]);

  useEffect(() => {
    if (!window.ipcRenderer) return undefined;
    return window.ipcRenderer.on(
      'intelligence:person-chat:delta',
      (_event, packet: PersonChatDelta) => {
        if (packet.requestId === activeRequest.current) {
          setStreaming((current) => current + packet.delta);
        }
      },
    );
  }, []);

  useEffect(() => {
    if (!window.ipcRenderer) return undefined;
    return window.ipcRenderer.on(
      'intelligence:person-chat:status',
      (_event, packet: PersonChatStatusUpdate) => {
        if (packet.requestId !== activeRequest.current) return;
        setStatus(
          packet.status === 'reading_person'
            ? `Reading what you know about ${personName}…`
            : 'Pluto is responding…',
        );
      },
    );
  }, [personName]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  const ensureThread = async () => {
    if (threadId) return threadId;
    const created = await createPersonChatThread(personId);
    newlyCreatedThread.current = created.id;
    setThreads((current) => [created, ...current]);
    setThreadId(created.id);
    return created.id;
  };

  const cancelActive = async (): Promise<void> => {
    const requestId = activeRequest.current;
    if (!requestId) return;
    activeRequest.current = null;
    setAsking(false);
    setStreaming('');
    setStatus('');
    await cancelPersonChatRequest(requestId);
  };

  const selectedThread = threads.find((thread) => thread.id === threadId);

  const deleteConversation = async (thread: PersonChatThread) => {
    if (
      !window.confirm(
        `Delete “${thread.title}”? This permanently removes the conversation.`,
      )
    )
      return;
    try {
      if (thread.id === threadId) await cancelActive();
      await deletePersonChatThread(personId, thread.id);
      const next = await refreshThreads();
      if (thread.id === threadId) {
        setThreadId(
          next.find((candidate) => candidate.archivedAt === null)?.id ?? null,
        );
      }
    } catch {
      setError('Pluto could not delete this conversation.');
    }
  };

  const archiveConversation = async () => {
    if (!threadId) return;
    await cancelActive();
    await archivePersonChatThread(personId, threadId);
    const next = await refreshThreads();
    setThreadId(next.find((thread) => thread.archivedAt === null)?.id ?? null);
  };

  const submit = async (value: string) => {
    const content = value.trim();
    if (!content || asking) return;
    if (selectedThread?.archivedAt) {
      setError(
        'This conversation is archived. Resume it before asking another question.',
      );
      return;
    }
    const targetThread = await ensureThread();
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setExpanded(true);
    setAsking(true);
    setError('');
    setStatus(`Reading what you know about ${personName}…`);
    setStreaming('');
    setQuery('');
    const userMessageId = `optimistic-${requestId}`;
    anchorTurn(userMessageId);
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        threadId: targetThread,
        role: 'user',
        content,
        status: 'complete',
        citations: [],
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const response = await sendPersonChatMessage({
        requestId,
        threadId: targetThread,
        personId,
        query: content,
      });
      if (activeRequest.current !== requestId) return;
      if (response.status !== 'answered' || !response.message) {
        if (response.status !== 'cancelled')
          setError(response.rationale || 'Pluto could not answer right now.');
        return;
      }
      setMessages((current) => [...current, response.message!]);
      await refreshThreads();
    } catch {
      setError('Pluto could not answer right now.');
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null;
        setAsking(false);
        setStreaming('');
        setStatus('');
      }
    }
  };

  const stop = () => {
    const requestId = activeRequest.current;
    if (!requestId) return;
    activeRequest.current = null;
    if (streaming.trim()) {
      setMessages((current) => [
        ...current,
        {
          id: `stopped-${requestId}`,
          threadId: threadId ?? '',
          role: 'assistant',
          content: streaming.trim(),
          status: 'interrupted',
          citations: [],
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    setStreaming('');
    setAsking(false);
    setStatus('Stopped');
    void cancelPersonChatRequest(requestId).then(async () => {
      if (!threadId) return;
      setMessages(await listPersonChatMessages(personId, threadId));
    });
  };

  const hasConversation = messages.length > 0 || asking;
  const starters = useMemo(() => starterPrompts(personName), [personName]);
  if (!enabled) return null;
  if (!expanded) {
    return createPortal(
      <button
        type="button"
        className="person-chat-launcher"
        aria-label={`Ask about ${personName}`}
        onClick={() => setExpanded(true)}
      >
        <MessageCircle size={17} aria-hidden="true" />
        <span>Ask about {personName}</span>
      </button>,
      document.body,
    );
  }

  return createPortal(
    <aside
      className="person-chat person-chat--expanded"
      aria-label={`Chat about ${personName}`}
    >
      <header className="person-chat__header">
        <div>
          <button
            type="button"
            className={`person-chat__hamburger ${sidebarOpen ? 'is-active' : ''}`}
            title={
              sidebarOpen ? 'Hide past conversations' : 'Past conversations'
            }
            aria-label={
              sidebarOpen ? 'Hide past conversations' : 'Past conversations'
            }
            aria-expanded={sidebarOpen}
            aria-controls="person-chat-sidebar"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <Menu size={16} aria-hidden="true" />
          </button>
          <Logo size={20} variant="default" />
          <span>
            <strong>Chat about {personName}</strong>
            <small>{status || 'Private, person-scoped conversation'}</small>
          </span>
        </div>
        <div>
          <button
            type="button"
            title="New conversation"
            aria-label="New conversation"
            onClick={() => {
              void cancelActive();
              setThreadId(null);
              setMessages([]);
              setError('');
              setSidebarOpen(false);
            }}
          >
            <Plus size={16} />
          </button>
          {threadId ? (
            threads.find((thread) => thread.id === threadId)?.archivedAt ? (
              <button
                type="button"
                title="Resume chat"
                aria-label="Resume chat"
                onClick={() => {
                  void resumePersonChatThread(personId, threadId).then(
                    async () => {
                      await refreshThreads();
                    },
                  );
                }}
              >
                <ArchiveRestore size={15} />
              </button>
            ) : (
              <button
                type="button"
                title="Archive chat"
                aria-label="Archive chat"
                onClick={() => void archiveConversation()}
              >
                <Archive size={15} />
              </button>
            )
          ) : null}
          <button
            type="button"
            title="Minimize"
            aria-label="Minimize person chat"
            onClick={() => {
              void cancelActive();
              setExpanded(false);
              setSidebarOpen(false);
            }}
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </header>

      <div className="person-chat__body">
        {sidebarOpen ? (
          <>
            <div
              className="person-chat__sidebar-backdrop"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <nav
              id="person-chat-sidebar"
              className="person-chat__sidebar"
              aria-label="Past conversations"
            >
              <div className="person-chat__sidebar-header">
                <strong>Past conversations</strong>
                <button
                  type="button"
                  title="Close sidebar"
                  aria-label="Close sidebar"
                  onClick={() => setSidebarOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="person-chat__sidebar-content">
                <button
                  type="button"
                  aria-label="New conversation"
                  className={`person-chat__sidebar-new ${!threadId ? 'is-active' : ''}`}
                  onClick={() => {
                    void cancelActive();
                    setThreadId(null);
                    setMessages([]);
                    setError('');
                    setSidebarOpen(false);
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                  <span>
                    <strong>New conversation</strong>
                    <small>Start a fresh thread</small>
                  </span>
                  {!threadId ? <Check size={14} aria-hidden="true" /> : null}
                </button>
                {threads.length > 0 ? (
                  <>
                    <p className="person-chat__sidebar-section-title">
                      Recent conversations
                    </p>
                    <div className="person-chat__sidebar-list">
                      {threads.map((thread) => {
                        const isActive = thread.id === threadId;
                        return (
                          <div
                            className="person-chat__sidebar-row"
                            key={thread.id}
                          >
                            <button
                              type="button"
                              aria-label={`${thread.title}${thread.archivedAt ? ', archived' : ''}${isActive ? ', selected' : ''}`}
                              className={`person-chat__sidebar-item ${isActive ? 'is-active' : ''}`}
                              onClick={() => {
                                void cancelActive();
                                setThreadId(thread.id);
                                setSidebarOpen(false);
                              }}
                            >
                              <MessageCircle size={14} aria-hidden="true" />
                              <span className="person-chat__sidebar-item-text">
                                <strong>{thread.title}</strong>
                                {thread.archivedAt ? (
                                  <small>Archived</small>
                                ) : null}
                              </span>
                              {isActive ? (
                                <Check size={14} aria-hidden="true" />
                              ) : null}
                            </button>
                            <button
                              type="button"
                              className="person-chat__sidebar-delete"
                              aria-label={`Delete conversation: ${thread.title}`}
                              title="Delete conversation"
                              onClick={() => void deleteConversation(thread)}
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="person-chat__sidebar-empty">
                    No past conversations yet
                  </p>
                )}
              </div>
            </nav>
          </>
        ) : null}

        <div className="person-chat__main">
          <div
            ref={conversationRef}
            className="person-chat__conversation"
            role="log"
            aria-live="polite"
          >
            {!hasConversation ? (
              <div className="person-chat__welcome">
                <strong>What would you like to think through?</strong>
                <p>
                  Ask for a catch-up, prepare a conversation, explore an
                  approach, or draft something together.
                </p>
                <div>
                  {starters.map((starter) => (
                    <button
                      type="button"
                      key={starter}
                      onClick={() => void submit(starter)}
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div
                  key={message.id}
                  data-chat-turn-id={message.id}
                  className="person-chat__message person-chat__message--user"
                >
                  {message.content}
                </div>
              ) : (
                <div
                  key={message.id}
                  className={`person-chat__assistant ${index === messages.length - 1 ? 'person-chat__assistant--latest' : ''}`}
                >
                  <div
                    className="person-chat__assistant-mark"
                    aria-hidden="true"
                  >
                    <Logo size={16} variant="default" />
                  </div>
                  <div className="person-chat__message person-chat__message--assistant">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                    {message.status === 'interrupted' ? (
                      <small>Stopped</small>
                    ) : null}
                    <SourceList
                      citations={message.citations}
                      onOpenMeeting={onOpenMeeting}
                    />
                  </div>
                </div>
              ),
            )}
            {streaming ? (
              <div className="person-chat__assistant person-chat__assistant--latest">
                <div className="person-chat__assistant-mark" aria-hidden="true">
                  <Logo size={16} variant="default" />
                </div>
                <div className="person-chat__message person-chat__message--assistant">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streaming}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            {asking && !streaming ? (
              <output className="person-chat__loading--latest block">
                <span className="person-chat__loading">
                  <Loader2 className="animate-spin" size={15} /> {status}
                </span>
              </output>
            ) : null}
            {error ? (
              <p className="person-chat__error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {selectedThread?.archivedAt ? (
            <div className="person-chat__archived-notice">
              This conversation is archived. Resume it to ask more questions.
            </div>
          ) : (
            <form
              className="person-chat__composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(query);
              }}
            >
              <textarea
                ref={textareaRef}
                value={query}
                rows={1}
                maxLength={4_000}
                placeholder={`Chat about ${personName}`}
                aria-label={`Chat about ${personName}`}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void submit(query);
                  }
                }}
              />
              <button
                type={asking ? 'button' : 'submit'}
                onClick={asking ? stop : undefined}
                disabled={!asking && !query.trim()}
                aria-label={asking ? 'Stop answering' : 'Send message'}
              >
                {asking ? (
                  <Square size={14} fill="currentColor" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </aside>,
    document.body,
  );
};
