import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Meeting } from '../types';
import type {
  MeetingAskPlutoAnswerDelta,
  MeetingAskPlutoConversationMessage,
  MeetingAskPlutoLiveContext,
  MeetingAskPlutoRequest,
  MeetingAskPlutoResponse,
  MeetingAskPlutoTurn,
} from '../types/askPluto';
import {
  createMeetingAskPlutoRequestId,
  describeMeetingAskPlutoRequest,
} from '../utils/askPlutoDiagnostics';
import { MEETING_ASK_PLUTO_LIMITS } from '../utils/meetingAskPlutoRequest';

export type MeetingAskPlutoScope =
  | { meeting: Meeting; liveContext?: never }
  | { meeting?: never; liveContext: MeetingAskPlutoLiveContext };

const trimToLimit = (value: string | undefined, limit: number) =>
  (value || '').trim().slice(0, limit);

const buildBoundedLiveContext = (
  liveContext: MeetingAskPlutoLiveContext,
): MeetingAskPlutoLiveContext => ({
  ...(liveContext.meetingId ? { meetingId: liveContext.meetingId } : {}),
  title:
    trimToLimit(liveContext.title, MEETING_ASK_PLUTO_LIMITS.titleChars) ||
    'Meeting',
  participants: liveContext.participants
    .map((participant) => participant.trim())
    .filter(Boolean)
    .slice(0, MEETING_ASK_PLUTO_LIMITS.participants),
  notes: trimToLimit(liveContext.notes, MEETING_ASK_PLUTO_LIMITS.notesChars),
  transcript: liveContext.transcript
    .slice(-MEETING_ASK_PLUTO_LIMITS.transcriptSegments)
    .map((segment) => ({
      ...segment,
      text: trimToLimit(
        segment.text,
        MEETING_ASK_PLUTO_LIMITS.transcriptSegmentChars,
      ),
    })),
  interimText: trimToLimit(
    liveContext.interimText,
    MEETING_ASK_PLUTO_LIMITS.interimChars,
  ),
});

const toTurns = (
  messages: MeetingAskPlutoConversationMessage[],
): MeetingAskPlutoTurn[] => {
  let latestCompletedAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && !message.interrupted) {
      latestCompletedAssistantIndex = index;
      break;
    }
  }

  const turns = messages.reduce<MeetingAskPlutoTurn[]>(
    (turns, message, index) => {
      if (message.role === 'user') {
        turns.push({
          role: 'user',
          content: trimToLimit(
            message.content,
            MEETING_ASK_PLUTO_LIMITS.turnChars,
          ),
        });
        return turns;
      }

      if (message.interrupted) return turns;

      turns.push({
        role: 'assistant',
        content: trimToLimit(
          message.content,
          MEETING_ASK_PLUTO_LIMITS.turnChars,
        ),
        citationIds: message.packet?.citations
          .map((citation) => citation.id)
          .slice(0, MEETING_ASK_PLUTO_LIMITS.citationIds),
        ...(index === latestCompletedAssistantIndex
          ? {
              evidenceHints: message.packet?.citations
                .map((citation) => citation.evidence_span || citation.claim)
                .filter((hint): hint is string => Boolean(hint?.trim()))
                .slice(0, MEETING_ASK_PLUTO_LIMITS.evidenceHints)
                .map((hint) =>
                  trimToLimit(hint, MEETING_ASK_PLUTO_LIMITS.evidenceHintChars),
                ),
            }
          : {}),
      });
      return turns;
    },
    [],
  );
  return turns.slice(-MEETING_ASK_PLUTO_LIMITS.turns);
};

type UseMeetingAskPlutoOptions = MeetingAskPlutoScope & {
  conversation?: MeetingAskPlutoConversationMessage[];
  onConversationChange?: React.Dispatch<
    React.SetStateAction<MeetingAskPlutoConversationMessage[]>
  >;
};

/**
 * Meeting-scoped Ask Pluto: asks about a finished meeting or the live
 * recording, streams the answer, and keeps the conversation. Shared by the
 * live recording dock and the finished meeting's sidebar.
 */
export const useMeetingAskPluto = ({
  meeting,
  liveContext,
  conversation,
  onConversationChange,
}: UseMeetingAskPlutoOptions) => {
  const [localMessages, setLocalMessages] = useState<
    MeetingAskPlutoConversationMessage[]
  >([]);
  const messages = conversation ?? localMessages;
  const setMessages = onConversationChange ?? setLocalMessages;
  const [isAsking, setIsAsking] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The question local memory refused, when ChatGPT can answer it instead.
  const [chatGPTFallbackQuery, setChatGPTFallbackQuery] = useState<
    string | null
  >(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const scopeKey = meeting
    ? `meeting:${String(meeting.id)}`
    : 'live:active-recording';
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  useEffect(
    () =>
      window.ipcRenderer.on?.(
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
    // React Strict Mode replays effect setup/cleanup in development. Restore the
    // mounted flag during setup so a completed IPC response is not discarded
    // after the simulated cleanup.
    mountedRef.current = true;
    return () => {
      const activeRequestId = activeRequestIdRef.current;
      if (activeRequestId) {
        void window.ipcRenderer.invoke(
          'intelligence:meeting-chat:cancel',
          activeRequestId,
        );
      }
      mountedRef.current = false;
      activeRequestIdRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    const activeRequestId = activeRequestIdRef.current;
    if (!activeRequestId) return;
    activeRequestIdRef.current = null;
    const partialAnswer = streamingAnswer.trim();
    if (partialAnswer) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-stopped-${Date.now()}`,
          role: 'assistant',
          content: partialAnswer,
          interrupted: true,
        },
      ]);
    }
    setStreamingAnswer('');
    setIsAsking(false);
    void window.ipcRenderer.invoke(
      'intelligence:meeting-chat:cancel',
      activeRequestId,
    );
  }, [setMessages, streamingAnswer]);

  /**
   * Sends a question. Returns the new question's message id, or null when
   * nothing was sent (empty question, or an answer is still running).
   */
  const ask = (
    value: string,
    options: {
      answerWith?: 'chatgpt';
      /** Replace the last, unanswered question instead of repeating it. */
      replaceLastQuestion?: boolean;
    } = {},
  ): string | null => {
    const trimmed = value.trim();
    if (!trimmed || isAsking) return null;
    const { answerWith } = options;
    const dropLast = (current: MeetingAskPlutoConversationMessage[]) =>
      options.replaceLastQuestion && current.at(-1)?.role === 'user'
        ? current.slice(0, -1)
        : current;

    const requestId = createMeetingAskPlutoRequestId();
    const previousRequestId = activeRequestIdRef.current;
    if (previousRequestId) {
      void window.ipcRenderer.invoke(
        'intelligence:meeting-chat:cancel',
        previousRequestId,
      );
    }
    const priorTurns = toTurns(dropLast(messages));
    setError(null);
    setChatGPTFallbackQuery(null);
    setStreamingAnswer('');
    setIsAsking(true);
    const userMessageId = `user-${Date.now()}`;
    setMessages((current) => [
      ...dropLast(current),
      {
        id: userMessageId,
        role: 'user',
        content: trimmed,
      },
    ]);
    activeRequestIdRef.current = requestId;
    const requestScopeKey = scopeKey;
    const request: MeetingAskPlutoRequest = meeting
      ? {
          requestId,
          query: trimmed,
          scope: {
            type: 'meeting',
            meetingId: String(meeting.id),
          },
          turns: priorTurns,
          ...(answerWith ? { answerWith } : {}),
        }
      : {
          requestId,
          query: trimmed,
          scope: {
            type: 'live_meeting',
            ...buildBoundedLiveContext(liveContext),
          },
          turns: priorTurns,
          ...(answerWith ? { answerWith } : {}),
        };

    void (async () => {
      try {
        const requestStartedAt = Date.now();
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

        if (
          !mountedRef.current ||
          activeRequestIdRef.current !== requestId ||
          scopeKeyRef.current !== requestScopeKey
        ) {
          return;
        }

        if (packet.status === 'unavailable' || !packet.answer.trim()) {
          // The main process explains why, for example low memory.
          setError(
            packet.answer.trim() ||
              'Pluto could not answer this meeting right now.',
          );
          if (packet.chatGPTFallback === 'available')
            setChatGPTFallbackQuery(trimmed);
          return;
        }

        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: packet.answer,
            packet,
            ...(answerWith ? { answeredBy: answerWith } : {}),
          },
        ]);
      } catch (submitError) {
        console.error('Meeting Ask Pluto error:', submitError);
        if (mountedRef.current && activeRequestIdRef.current === requestId) {
          setError('Pluto could not answer this meeting right now.');
        }
      } finally {
        if (mountedRef.current && activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null;
          setStreamingAnswer('');
          setIsAsking(false);
        }
      }
    })();

    return userMessageId;
  };

  /** Sends the question local memory refused to ChatGPT, just this once. */
  const answerWithChatGPT = () =>
    chatGPTFallbackQuery
      ? ask(chatGPTFallbackQuery, {
          answerWith: 'chatgpt',
          replaceLastQuestion: true,
        })
      : null;

  return {
    messages,
    isAsking,
    streamingAnswer,
    error,
    setError,
    ask,
    stop,
    canAnswerWithChatGPT: chatGPTFallbackQuery !== null && !isAsking,
    answerWithChatGPT,
  };
};
