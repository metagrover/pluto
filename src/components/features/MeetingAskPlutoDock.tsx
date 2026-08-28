import {
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  Send,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Meeting } from '../../types';
import type {
  MeetingAskPlutoAnswerDelta,
  MeetingAskPlutoConversationMessage,
  MeetingAskPlutoLiveContext,
  MeetingAskPlutoRequest,
  MeetingAskPlutoResponse,
  MeetingAskPlutoTurn,
} from '../../types/askPluto';
import {
  createMeetingAskPlutoRequestId,
  describeMeetingAskPlutoRequest,
} from '../../utils/askPlutoDiagnostics';
import { Logo } from '../Brand/Logo';

type MeetingAskPlutoDockProps = {
  onOpenMeeting?: (meetingId: string) => void;
  conversation?: MeetingAskPlutoConversationMessage[];
  onConversationChange?: React.Dispatch<
    React.SetStateAction<MeetingAskPlutoConversationMessage[]>
  >;
  isMinimized?: boolean;
  onMinimizedChange?: (isMinimized: boolean) => void;
} & (
  | {
      meeting: Meeting;
      liveContext?: never;
    }
  | {
      meeting?: never;
      liveContext: MeetingAskPlutoLiveContext;
    }
);

const LIVE_TRANSCRIPT_LIMIT = 24;
const LIVE_TRANSCRIPT_SEGMENT_CHAR_LIMIT = 500;
const LIVE_NOTES_CHAR_LIMIT = 1800;
const LIVE_INTERIM_CHAR_LIMIT = 700;
const LIVE_PARTICIPANT_LIMIT = 8;

const trimToLimit = (value: string | undefined, limit: number) =>
  (value || '').trim().slice(0, limit);

const buildBoundedLiveContext = (
  liveContext: MeetingAskPlutoLiveContext,
): MeetingAskPlutoLiveContext => ({
  title: liveContext.title,
  participants: liveContext.participants
    .map((participant) => participant.trim())
    .filter(Boolean)
    .slice(0, LIVE_PARTICIPANT_LIMIT),
  notes: trimToLimit(liveContext.notes, LIVE_NOTES_CHAR_LIMIT),
  transcript: liveContext.transcript
    .slice(-LIVE_TRANSCRIPT_LIMIT)
    .map((segment) => ({
      ...segment,
      text: trimToLimit(segment.text, LIVE_TRANSCRIPT_SEGMENT_CHAR_LIMIT),
    })),
  interimText: trimToLimit(liveContext.interimText, LIVE_INTERIM_CHAR_LIMIT),
});

const toTurns = (
  messages: MeetingAskPlutoConversationMessage[],
): MeetingAskPlutoTurn[] =>
  messages.map((message) => {
    if (message.role === 'user') {
      return {
        role: 'user',
        content: message.content,
      };
    }

    return {
      role: 'assistant',
      content: message.content,
      citationIds: message.packet.citations.map((citation) => citation.id),
    };
  });

export const MeetingAskPlutoDock: React.FC<MeetingAskPlutoDockProps> = ({
  meeting,
  liveContext,
  conversation,
  onConversationChange,
  isMinimized: controlledIsMinimized,
  onMinimizedChange,
}) => {
  const [query, setQuery] = useState('');
  const [localMessages, setLocalMessages] = useState<
    MeetingAskPlutoConversationMessage[]
  >([]);
  const messages = conversation ?? localMessages;
  const setMessages = onConversationChange ?? setLocalMessages;
  const [isAsking, setIsAsking] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [localIsMinimized, setLocalIsMinimized] = useState(false);
  const isMinimized = controlledIsMinimized ?? localIsMinimized;
  const setIsMinimized = useCallback(
    (nextIsMinimized: boolean) => {
      if (controlledIsMinimized === undefined) {
        setLocalIsMinimized(nextIsMinimized);
      }
      onMinimizedChange?.(nextIsMinimized);
    },
    [controlledIsMinimized, onMinimizedChange],
  );
  const [error, setError] = useState<string | null>(null);
  const dockRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const activeRequestIdRef = useRef<string | null>(null);
  const scopeTitle = meeting?.title || liveContext?.title || 'Meeting';
  const calculatedRows = Math.max(
    1,
    Math.min(
      5,
      query
        .split('\n')
        .reduce(
          (rows, line) => rows + Math.max(1, Math.ceil(line.length / 72)),
          0,
        ),
    ),
  );
  const hasConversation = messages.length > 0 || Boolean(error) || isAsking;
  const isComposing = query.trim().length > 0;
  const showsConversation = hasConversation && !isMinimized;
  const isExpanded = showsConversation || (isComposing && !isMinimized);
  const dockClassName = [
    'meeting-ask-pluto-dock',
    'meeting-ask-pluto-dock--compact',
    'meeting-ask-pluto-dock--stable-width',
    isExpanded || isComposing ? 'meeting-ask-pluto-dock--expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const scrollToLatest = useCallback((force = false) => {
    if (force) shouldFollowLatestRef.current = true;
    if (!shouldFollowLatestRef.current) return;
    threadEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, []);

  const updateFollowMode = () => {
    const thread = threadRef.current;
    if (!thread) return;
    shouldFollowLatestRef.current =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 48;
  };

  useEffect(() => {
    if (!showsConversation) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        dockRef.current &&
        event.target instanceof Node &&
        !dockRef.current.contains(event.target)
      ) {
        setIsMinimized(true);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [setIsMinimized, showsConversation]);

  useEffect(() => {
    if (!showsConversation) return;
    scrollToLatest();
  }, [
    error,
    isAsking,
    messages,
    scrollToLatest,
    showsConversation,
    streamingAnswer,
  ]);

  useEffect(
    () =>
      window.ipcRenderer.on(
        'intelligence:meeting-chat:delta',
        (_event, packet: MeetingAskPlutoAnswerDelta) => {
          if (
            packet.requestId !== activeRequestIdRef.current ||
            !packet.delta
          ) {
            return;
          }
          setStreamingAnswer((current) => `${current}${packet.delta}`);
        },
      ),
    [],
  );

  useEffect(() => {
    if (
      !showsConversation ||
      !threadContentRef.current ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }
    const observer = new ResizeObserver(() => scrollToLatest());
    observer.observe(threadContentRef.current);
    return () => observer.disconnect();
  }, [scrollToLatest, showsConversation]);

  const submitQuestion = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isAsking) return;

    const requestId = createMeetingAskPlutoRequestId();
    const priorTurns = toTurns(messages);
    setError(null);
    setQuery('');
    setStreamingAnswer('');
    setIsAsking(true);
    setIsMinimized(false);
    shouldFollowLatestRef.current = true;
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
      },
    ]);
    activeRequestIdRef.current = requestId;

    try {
      const requestStartedAt = Date.now();
      const request: MeetingAskPlutoRequest = meeting
        ? {
            requestId,
            query: trimmed,
            scope: {
              type: 'meeting',
              meetingId: String(meeting.id),
            },
            turns: priorTurns,
          }
        : {
            requestId,
            query: trimmed,
            answerMode: 'quick',
            scope: {
              type: 'live_meeting',
              ...buildBoundedLiveContext(liveContext),
            },
            turns: priorTurns,
          };
      console.info(
        '[Pluto][Ask Pluto][renderer] request',
        describeMeetingAskPlutoRequest(request),
      );
      const packet = (await window.ipcRenderer.invoke(
        'intelligence:meeting-chat',
        request,
      )) as MeetingAskPlutoResponse;
      console.info('[Pluto][Ask Pluto][renderer] response', {
        requestId,
        status: packet.status,
        trustStatus: packet.trustStatus,
        citationCount: packet.citations.length,
        elapsedMs: Date.now() - requestStartedAt,
      });

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: packet.answer,
          packet,
        },
      ]);
    } catch (submitError) {
      console.error('Meeting Ask Pluto error:', submitError);
      setError('Pluto could not answer this meeting right now.');
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
        setStreamingAnswer('');
      }
      setIsAsking(false);
    }
  };

  return (
    <section ref={dockRef} className={dockClassName} aria-label="Ask Pluto">
      {isMinimized && hasConversation ? (
        <button
          type="button"
          className="meeting-ask-pluto-dock__restore"
          aria-label="Restore Ask Pluto conversation"
          onClick={() => {
            shouldFollowLatestRef.current = true;
            setIsMinimized(false);
          }}
        >
          <MessageCircle className="h-4 w-4" />
          <span className="meeting-ask-pluto-dock__restore-copy">
            <strong>Ask Pluto</strong>
            <span>{isAsking ? 'Answering…' : 'Active conversation'}</span>
          </span>
          <ChevronUp className="h-4 w-4" />
        </button>
      ) : null}

      {showsConversation ? (
        <div className="meeting-ask-pluto-dock__header">
          <div className="meeting-ask-pluto-dock__header-copy">
            <span>Ask Pluto</span>
            <span>{scopeTitle}</span>
          </div>
          <button
            type="button"
            aria-label="Minimize Ask Pluto"
            title="Minimize Ask Pluto"
            onClick={() => setIsMinimized(true)}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {showsConversation && (messages.length > 0 || isAsking) ? (
        <div
          ref={threadRef}
          className="meeting-ask-pluto-dock__thread"
          onScroll={updateFollowMode}
        >
          <div
            ref={threadContentRef}
            className="meeting-ask-pluto-dock__thread-content"
          >
            {messages.map((message) =>
              message.role === 'user' ? (
                <div
                  key={message.id}
                  className="meeting-ask-pluto-dock__message meeting-ask-pluto-dock__message--user"
                >
                  {message.content}
                </div>
              ) : (
                <div
                  key={message.id}
                  className="meeting-ask-pluto-dock__assistant-turn"
                >
                  <span className="meeting-ask-pluto-dock__pluto-mark">
                    <Logo size={18} variant="default" />
                  </span>
                  <div className="meeting-ask-pluto-dock__message meeting-ask-pluto-dock__message--assistant">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ),
            )}
            {streamingAnswer ? (
              <div className="meeting-ask-pluto-dock__assistant-turn">
                <span className="meeting-ask-pluto-dock__pluto-mark">
                  <Logo size={18} variant="default" />
                </span>
                <div className="meeting-ask-pluto-dock__message meeting-ask-pluto-dock__message--assistant">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {streamingAnswer}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            {isAsking && !streamingAnswer ? (
              <div className="meeting-ask-pluto-dock__loading">
                <Loader2 className="h-4 w-4 animate-spin" />
                {liveContext
                  ? 'Reading live transcript'
                  : 'Reading this meeting'}
              </div>
            ) : null}
            <div ref={threadEndRef} aria-hidden="true" />
          </div>
        </div>
      ) : null}

      {showsConversation && error ? (
        <p className="meeting-ask-pluto-dock__error">{error}</p>
      ) : null}

      {!isMinimized || !hasConversation ? (
        <form
          className="meeting-ask-pluto-dock__composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitQuestion(query);
          }}
        >
          <textarea
            value={query}
            onFocus={() => setIsMinimized(false)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitQuestion(query);
              }
            }}
            rows={calculatedRows}
            placeholder="Ask about this meeting"
          />
          <button type="submit" disabled={!query.trim() || isAsking}>
            {isAsking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      ) : null}
    </section>
  );
};
