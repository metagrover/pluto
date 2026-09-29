import { useCallback, useLayoutEffect, useRef } from 'react';

const CHAT_TURN_ATTRIBUTE = 'data-chat-turn-id';

export const useChatTurnAnchor = <T extends HTMLElement>(turnCount: number) => {
  const conversationRef = useRef<T>(null);
  const pendingTurnIdRef = useRef<string | null>(null);

  const anchorTurn = useCallback((turnId: string) => {
    pendingTurnIdRef.current = turnId;
  }, []);

  useLayoutEffect(() => {
    const pendingTurnId = pendingTurnIdRef.current;
    if (!pendingTurnId) return;
    const turn = conversationRef.current?.querySelector(
      `[${CHAT_TURN_ATTRIBUTE}="${pendingTurnId}"]`,
    );
    if (!(turn instanceof HTMLElement)) return;
    pendingTurnIdRef.current = null;
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    turn.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [turnCount]);

  return { anchorTurn, conversationRef };
};
