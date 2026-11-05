/**
 * Milliseconds for a stored time. SQLite's CURRENT_TIMESTAMP is UTC written
 * as "YYYY-MM-DD HH:MM:SS" with no zone, which Date.parse would read as local
 * time; ISO strings pass through.
 */
export const parseStoredTime = (value: string | null | undefined): number => {
  if (!value) return Number.NaN;
  const sqlite = value.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/,
  );
  return Date.parse(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : value);
};
