// Suggestions are sent verbatim as the question, so a cut-off name could
// never match its meeting or topic. Skip names too long to read well instead.
export function fits(
  str: string | null | undefined,
  maxLength: number,
): string | null {
  const value = str?.trim();
  return value && value.length <= maxLength ? value : null;
}
