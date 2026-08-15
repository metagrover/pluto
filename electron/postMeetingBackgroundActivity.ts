export const createPostMeetingBackgroundActivity = (
  setBackgroundThrottling: (allowed: boolean) => void,
) => {
  const activeRuns = new Set<string>();

  const sync = (wasActive: boolean) => {
    const isActive = activeRuns.size > 0;
    if (isActive !== wasActive) {
      setBackgroundThrottling(!isActive);
    }
  };

  return {
    setActive(runId: string, active: boolean) {
      const normalizedRunId = runId.trim();
      if (!normalizedRunId) return;
      const wasActive = activeRuns.size > 0;
      if (active) activeRuns.add(normalizedRunId);
      else activeRuns.delete(normalizedRunId);
      sync(wasActive);
    },
    reset() {
      const wasActive = activeRuns.size > 0;
      activeRuns.clear();
      sync(wasActive);
    },
    activeCount: () => activeRuns.size,
  };
};
