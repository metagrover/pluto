import { useCallback, useEffect, useState } from 'react';
import type { CalendarEvent } from '../../electron/calendar/types';
import { getEligibleCalendarPrompt } from '../utils/calendarPromptDecision';

type UseCalendarPromptMonitorArgs = {
  events: CalendarEvent[];
  isRecording: boolean;
  promptEnabled: boolean;
};

export const useCalendarPromptMonitor = ({
  events,
  isRecording,
  promptEnabled,
}: UseCalendarPromptMonitorArgs) => {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [activePromptEvent, setActivePromptEvent] =
    useState<CalendarEvent | null>(null);

  const checkPrompt = useCallback(() => {
    const eligible = getEligibleCalendarPrompt({
      nowMs: Date.now(),
      events,
      dismissedKeys,
      isRecording,
      promptEnabled,
    });
    setActivePromptEvent(eligible);
  }, [events, dismissedKeys, isRecording, promptEnabled]);

  useEffect(() => {
    checkPrompt();
    const interval = window.setInterval(checkPrompt, 10_000);
    return () => window.clearInterval(interval);
  }, [checkPrompt]);

  const dismissPrompt = useCallback((occurrenceKey: string) => {
    setDismissedKeys((prev) => new Set([...prev, occurrenceKey]));
    setActivePromptEvent(null);
  }, []);

  return {
    activePromptEvent,
    dismissPrompt,
  };
};
