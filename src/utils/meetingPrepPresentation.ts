export function formatPrepDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: 'numeric' as const }),
  }).format(date);
}
export function formatPrepParticipants(value: string): string {
  return value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .join(', ');
}
