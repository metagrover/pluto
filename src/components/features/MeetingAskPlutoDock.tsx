import {
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageCircle,
  Send,
  Square,
} from 'lucide-react';
import type React from 'react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatTurnAnchor } from '../../hooks/useChatTurnAnchor';
import { useMeetingAskPluto } from '../../hooks/useMeetingAskPluto';
import type {
  MeetingAskPlutoConversationMessage,
  MeetingAskPlutoLiveContext,
} from '../../types/askPluto';
import {
  LIVE_MEETING_COMMANDS,
  LIVE_MEETING_SHORTCUT_HELP,
  parseLiveMeetingCommand,
} from '../../utils/liveMeetingCommands';
import { MEETING_ASK_PLUTO_LIMITS } from '../../utils/meetingAskPlutoRequest';
import { Logo } from '../Brand/Logo';

/** Ask Pluto while recording. Finished meetings use MeetingAskPlutoPanel. */
type MeetingAskPlutoDockProps = {
  liveContext: MeetingAskPlutoLiveContext;
  conversation?: MeetingAskPlutoConversationMessage[];
  onConversationChange?: React.Dispatch<
    React.SetStateAction<MeetingAskPlutoConversationMessage[]>
  >;
  isMinimized?: boolean;
  onMinimizedChange?: (isMinimized: boolean) => void;
};

export const MeetingAskPlutoDock: React.FC<MeetingAskPlutoDockProps> = ({
  liveContext,
  conversation,
  onConversationChange,
  isMinimized: controlledIsMinimized,
  onMinimizedChange,
}) => {
  const [query, setQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandsDismissed, setCommandsDismissed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const commandListId = useId();
  const hasCommands = LIVE_MEETING_COMMANDS.length > 0;
  const filteredCommands = LIVE_MEETING_COMMANDS.filter((command) =>
    command.name.startsWith(query.toLowerCase()),
  );
  const showsCommands =
    hasCommands &&
    !commandsDismissed &&
    /^\/[a-z-]*$/i.test(query) &&
    filteredCommands.length > 0;
  const selectedCommandIndex = Math.min(
    commandIndex,
    filteredCommands.length - 1,
  );
  const chooseCommand = (name: string) => {
    setQuery(`${name} `);
    setCommandsDismissed(true);
    composerRef.current?.focus();
  };
  const {
    messages,
    isAsking,
    streamingAnswer,
    error,
    setError,
    ask,
    stop: stopAnswer,
    canAnswerWithChatGPT,
    answerWithChatGPT,
  } = useMeetingAskPluto({ liveContext, conversation, onConversationChange });
  const { anchorTurn, conversationRef: threadRef } =
    useChatTurnAnchor<HTMLDivElement>(messages.length);
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
  const dockRef = useRef<HTMLElement>(null);
  const scopeTitle = liveContext.title || 'Meeting';
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
  useLayoutEffect(() => {
    if (showsConversation && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [showsConversation]);
  const dockClassName = [
    'meeting-ask-pluto-dock',
    'meeting-ask-pluto-dock--compact',
    'meeting-ask-pluto-dock--stable-width',
    isExpanded || isComposing ? 'meeting-ask-pluto-dock--expanded' : '',
  ]
    .filter(Boolean)
    .join(' ');

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

  const submitQuestion = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isAsking) return;
    if (parseLiveMeetingCommand(trimmed).kind === 'unknown') {
      setError(LIVE_MEETING_SHORTCUT_HELP);
      setIsMinimized(false);
      return;
    }
    const userMessageId = ask(trimmed);
    if (!userMessageId) return;
    setQuery('');
    setIsMinimized(false);
    anchorTurn(userMessageId);
  };

  return (
    <section ref={dockRef} className={dockClassName} aria-label="Ask Pluto">
      {isMinimized && hasConversation ? (
        <button
          type="button"
          className="meeting-ask-pluto-dock__restore"
          aria-label="Restore Ask Pluto conversation"
          onClick={() => {
            setIsMinimized(false);
          }}
        >
          <MessageCircle className="h-4 w-4" />
          <span className="meeting-ask-pluto-dock__restore-copy">
            <strong>Ask Pluto · Beta</strong>
            <span>{isAsking ? 'Answering…' : 'Active conversation'}</span>
          </span>
          <ChevronUp className="h-4 w-4" />
        </button>
      ) : null}

      {showsConversation ? (
        <div className="meeting-ask-pluto-dock__header">
          <div className="meeting-ask-pluto-dock__header-copy">
            <span>Ask Pluto · Beta</span>
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
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          <div className="meeting-ask-pluto-dock__thread-content">
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <div
                  key={message.id}
                  data-chat-turn-id={message.id}
                  className="meeting-ask-pluto-dock__message meeting-ask-pluto-dock__message--user"
                >
                  {message.content}
                </div>
              ) : (
                <div
                  key={message.id}
                  className={`meeting-ask-pluto-dock__assistant-turn ${index === messages.length - 1 ? 'meeting-ask-pluto-dock__assistant-turn--latest' : ''}`}
                >
                  <span className="meeting-ask-pluto-dock__pluto-mark">
                    <Logo size={18} variant="default" />
                  </span>
                  <div className="meeting-ask-pluto-dock__message meeting-ask-pluto-dock__message--assistant">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ children }) => <span>{children}</span>,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                    {message.interrupted ? (
                      <span className="meeting-ask-pluto-dock__interrupted">
                        Stopped
                      </span>
                    ) : null}
                    {message.answeredBy === 'chatgpt' ? (
                      <span className="meeting-ask-pluto-dock__interrupted">
                        Answered by ChatGPT, since there wasn’t enough free
                        memory for your local model.
                      </span>
                    ) : null}
                  </div>
                </div>
              ),
            )}
            {streamingAnswer ? (
              <div className="meeting-ask-pluto-dock__assistant-turn meeting-ask-pluto-dock__assistant-turn--latest">
                <span className="meeting-ask-pluto-dock__pluto-mark">
                  <Logo size={18} variant="default" />
                </span>
                <div className="meeting-ask-pluto-dock__message meeting-ask-pluto-dock__message--assistant">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children }) => <span>{children}</span>,
                    }}
                  >
                    {streamingAnswer}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            {isAsking && streamingAnswer ? (
              <output className="meeting-ask-pluto-dock__loading meeting-ask-pluto-dock__responding">
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
                Pluto is responding…
              </output>
            ) : null}
            {isAsking && !streamingAnswer ? (
              <output className="meeting-ask-pluto-dock__loading--latest block">
                <span className="meeting-ask-pluto-dock__loading">
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  Reading live transcript
                </span>
              </output>
            ) : null}
          </div>
        </div>
      ) : null}

      {showsConversation && error ? (
        <p className="meeting-ask-pluto-dock__error" role="alert">
          {error}
        </p>
      ) : null}
      {showsConversation && canAnswerWithChatGPT ? (
        <div className="meeting-ask-pluto-dock__fallback">
          <button type="button" onClick={() => answerWithChatGPT()}>
            Answer with ChatGPT
          </button>
          <span>Sends this question and the live notes, just this once.</span>
        </div>
      ) : null}

      {showsCommands && (!isMinimized || !hasConversation) ? (
        <div
          id={commandListId}
          className="meeting-ask-pluto-dock__commands"
          role="listbox"
          tabIndex={-1}
          aria-label="Meeting shortcuts"
        >
          {filteredCommands.map((command, index) => (
            <button
              key={command.name}
              id={`${commandListId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === selectedCommandIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseCommand(command.name)}
            >
              <span>{command.name}</span>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!isMinimized || !hasConversation ? (
        <form
          className="meeting-ask-pluto-dock__composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitQuestion(query);
          }}
        >
          <textarea
            ref={composerRef}
            value={query}
            role={hasCommands ? 'combobox' : undefined}
            aria-label="Ask about this meeting"
            aria-autocomplete={hasCommands ? 'list' : undefined}
            aria-expanded={hasCommands ? showsCommands : undefined}
            aria-controls={showsCommands ? commandListId : undefined}
            aria-activedescendant={
              showsCommands
                ? `${commandListId}-${selectedCommandIndex}`
                : undefined
            }
            onFocus={() => {
              setIsMinimized(false);
              setCommandsDismissed(false);
            }}
            onBlur={() => setCommandsDismissed(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setCommandIndex(0);
              setCommandsDismissed(false);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (showsCommands) {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setCommandsDismissed(true);
                  return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setCommandIndex(
                    (selectedCommandIndex +
                      (event.key === 'ArrowDown' ? 1 : -1) +
                      filteredCommands.length) %
                      filteredCommands.length,
                  );
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  chooseCommand(filteredCommands[selectedCommandIndex].name);
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitQuestion(query);
              }
            }}
            rows={calculatedRows}
            maxLength={MEETING_ASK_PLUTO_LIMITS.queryChars}
            placeholder={
              hasCommands
                ? 'Ask about this meeting (beta), or type /'
                : 'Ask a specific question about this meeting (beta)'
            }
          />
          <button
            type={isAsking ? 'button' : 'submit'}
            disabled={!isAsking && !query.trim()}
            aria-label={isAsking ? 'Stop answering' : 'Send question'}
            title={isAsking ? 'Stop answering' : 'Send question'}
            onClick={isAsking ? stopAnswer : undefined}
          >
            {isAsking ? (
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </form>
      ) : null}
    </section>
  );
};
