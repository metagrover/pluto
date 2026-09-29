export const formatRelativeStartTime = (isoStart: string): string => {
  const startMs = new Date(isoStart).getTime();
  const diffMs = startMs - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) <= 1) return 'Starts now';
  if (diffMinutes > 1) return `Starts in ${diffMinutes}m`;
  return `Started ${Math.abs(diffMinutes)}m ago`;
};
