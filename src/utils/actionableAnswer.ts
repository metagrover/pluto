/** Conservative filter for optional answer shortcuts: uncertainty means no suggestion. */
export function isActionableAnswerItem(text: string): boolean {
  const candidate = text.trim().replace(/[.!;]$/, '');
  if (!candidate || /[?]/.test(candidate)) return false;
  // Status reports, negations, and chat instructions are not outstanding work.
  if (
    /\b(?:no (?:new |further |additional |pending )?(?:tasks?|to-?dos?|actions?|follow[- ]?ups?)|nothing to|already|completed|finished|cancelled|canceled|do not|don't|not required|not needed|no need|cannot|can't|couldn't|unable to)\b/i.test(
      candidate,
    )
  )
    return false;
  if (
    /\b(?:proposed changes|refreshed preview|apply (?:the |these |selected )?changes|ask (?:me|pluto)|please (?:specify|clarify)|which (?:note|task)|could not prepare|review changes below)\b/i.test(
      candidate,
    )
  )
    return false;
  const verbs =
    '(?:send|share|review|schedule|book|prepare|draft|write|update|create|fix|resolve|investigate|check|confirm|contact|email|call|follow up|submit|deliver|finish|complete|implement|test|deploy|publish|approve|collect|gather|document|organize|organise|arrange|ask|discuss|compare|evaluate|research|renew|pay|buy|order|upload|download)';
  const imperative = new RegExp(`^(?:please\\s+)?${verbs}\\s+(.+)$`, 'i');
  const commitment = new RegExp(
    `^(?:I|we|[\\p{L}][\\p{L} .'-]{0,60})\\s+(?:will|must|needs? to|should)\\s+${verbs}\\s+(.+)$`,
    'iu',
  );
  const match = candidate.match(imperative) ?? candidate.match(commitment);
  return (
    !!match &&
    !/^(?:it|this|that|them|something|anything|things)$/i.test(match[1].trim())
  );
}
