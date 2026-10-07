// A conservative lexical guard, not a semantic proof. The live answer review
// checks meaning; this guard rejects invented identifiers and obvious polarity
// or modality changes before anything reaches the renderer.
const filler = new Set(
  'a an and are as at be been but by can could did do does for from has have i if in is it may me my of on or our so than that the their them then there these they this those to was we were what when which who will with would you your not no'.split(
    ' ',
  ),
);
const tokens = (text: string) =>
  [
    ...new Set(
      text
        .toLowerCase()
        .replace(/['’]s\b/gu, '')
        .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [],
    ),
  ]
    .filter((token) => !filler.has(token))
    .map((token) => token.replace(/(?:ing|ed|s)$/u, ''));

// Normalize ordinary spoken quantities as well as digits. This also permits
// harmless paraphrases such as “one pm” → “1 pm” without losing quantity checks.
const quantityWords: Record<string, number> = Object.fromEntries(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'
    .split(' ')
    .map((word, index) => [word, index]),
);
Object.assign(quantityWords, {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});
const quantities = (text: string): string[] => {
  const normalized = text
    .toLowerCase()
    .replace(
      /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?\b/g,
      (phrase) => {
        const parts = phrase.split(/[ -]/);
        return String(
          parts.reduce((total, word) => total + quantityWords[word], 0),
        );
      },
    );
  return normalized.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
};

export type LiveClaimSupportIssue =
  | 'empty_evidence'
  | 'invented_number'
  | 'invented_name'
  | 'low_overlap'
  | 'polarity_changed'
  | 'condition_removed'
  | 'certainty_changed';
export const liveClaimSupportIssue = (
  claim: string,
  evidence: string,
  suggestion = false,
  identityEvidence = evidence,
): LiveClaimSupportIssue | null => {
  if (!claim.trim() || !evidence.trim()) return 'empty_evidence';
  // A qualification about another subject cannot license an affirmative claim:
  // "The report is approved, but the date is not confirmed" still asserts approval.
  const clauses = claim.split(/(?<=[.!?;])\s+|,?\s+(?:but|whereas)\s+/iu);
  if (clauses.length > 1) {
    for (const clause of clauses) {
      const issue = liveClaimSupportIssue(
        clause,
        evidence,
        suggestion,
        identityEvidence,
      );
      if (issue && issue !== 'low_overlap') return issue;
    }
  }
  const lower = evidence.toLowerCase();
  const numbers = quantities(claim);
  const evidenceNumbers = quantities(evidence);
  if (numbers.some((number) => !evidenceNumbers.includes(number)))
    return 'invented_number';
  const names = [...claim.matchAll(/\b[\p{Lu}][\p{L}\p{N}'-]+\b/gu)]
    .filter((match) => {
      // Sentence-initial common nouns/verbs are not identities. A first-word
      // subject assigned work, a weekday, or an internal capital remains material.
      return (
        ((match.index ?? 0) > 0 &&
          !/[.!?]\s*$/.test(claim.slice(0, match.index))) ||
        /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(
          match[0],
        ) ||
        /^(?:will|has|is|agreed|promised|owns|assigned)\b/.test(
          claim.slice((match.index ?? 0) + match[0].length).trim(),
        )
      );
    })
    .map((match) => match[0].replace(/['’]s$/u, ''));
  if (
    names.some(
      (name) =>
        !filler.has(name.toLowerCase()) &&
        ![
          'discussed',
          'consider',
          'suggestion',
          'owner',
          'deadline',
          'participant',
          'participants',
        ].includes(name.toLowerCase()) &&
        !(
          !/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(
            name,
          ) &&
          new RegExp(
            `(?:\\b(?:to|for|by|from|with|send|ask|show|tell|email|contact|ping)\\s+${name}\\b|^${name}\\s+(?:will|has|is|agreed|promised|owns|assigned)\\b)`,
            'i',
          ).test(claim)
            ? identityEvidence.toLowerCase()
            : lower
        ).includes(name.toLowerCase()),
    )
  )
    return 'invented_name';
  const claimTokens = tokens(claim);
  const evidenceTokens = new Set(tokens(evidence));
  // Do not silently remove a condition or denial from a short direct source.
  const sentences = evidence.split(/(?<=[.!?])\s+|\n+/u);
  const closest =
    sentences
      .map((sentence) => ({
        sentence,
        score: tokens(sentence).filter((token) => claimTokens.includes(token))
          .length,
      }))
      .sort((a, b) => b.score - a.score)[0]?.sentence ?? '';
  if (
    /\b(?:not approved|not agreed|did not approve|never approved)\b/i.test(
      closest,
    ) &&
    /\b(?:approved|agreed)\b/i.test(claim) &&
    !/\b(?:not|never|pending|unapproved|unresolved)\b/i.test(claim)
  )
    return 'polarity_changed';
  if (
    /\b(?:if approved|only if|unless)\b/i.test(closest) &&
    /\b(?:will|agreed|approved|committed)\b/i.test(claim) &&
    !/\b(?:if|unless|conditional|pending)\b/i.test(claim)
  )
    return 'condition_removed';
  if (
    /\b(?:might|could|would|likely|probably|maybe|suggested|thinking|proposed|sounds like)\b/i.test(
      closest,
    ) &&
    /\b(?:agreed|approved|committed|promised|will|won't|decided|chosen|selected)\b/i.test(
      claim,
    ) &&
    !/\b(?:might|could|would|likely|probably|maybe|suggested|proposed|tentative|sounds like|if|unless)\b/i.test(
      claim,
    )
  )
    return 'certainty_changed';
  if (
    !claimTokens.length ||
    claimTokens.filter((token) => evidenceTokens.has(token)).length /
      claimTokens.length <
      (suggestion ? 0.2 : 0.3)
  )
    return 'low_overlap';
  return null;
};

export const liveClaimHasSourceSupport = (
  claim: string,
  evidence: string,
  suggestion = false,
): boolean => liveClaimSupportIssue(claim, evidence, suggestion) === null;

// A task needs an actual undertaking, not merely overlapping topic words.
// Join adjacent ASR fragments before checking the clause carrying the work.
export const liveActionHasCommitment = (
  claim: string,
  evidence: string,
): boolean => {
  const claimTokens = tokens(claim);
  const clauses = evidence
    .replace(/\([^\n)]*\)\s*/g, '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/u);
  const futureVerb = claim.match(/\bwill\s+([\p{L}]+)\b/iu)?.[1]?.toLowerCase();
  if (futureVerb) {
    const stem = (verb: string) =>
      verb.toLowerCase().replace(/ed$/, '').replace(/e$/, '');
    const overlaps = (clause: string) =>
      tokens(clause).filter((token) => claimTokens.includes(token)).length >= 2;
    const repeated = new RegExp(
      `(?:\\bwill|['’]ll)\\s+(?:just\\s+)?${futureVerb}\\b`,
      'iu',
    );
    const completedIndex = clauses.reduce((last, clause, index) => {
      const verb = clause.match(
        /\b(?:I|we)(?: have|['’]ve)?\s+(?:just|already)\s+([\p{L}]+ed)\b/iu,
      )?.[1];
      return verb && stem(verb) === stem(futureVerb) && overlaps(clause)
        ? index
        : last;
    }, -1);
    // A later explicit undertaking can repeat completed work. A nearby promise
    // about something else cannot turn the completed action back into a task.
    if (
      completedIndex >= 0 &&
      !clauses
        .slice(completedIndex + 1)
        .some((clause) => repeated.test(clause) && overlaps(clause))
    )
      return false;
  }
  return clauses.some((clause) => {
    const undertaking = clause.match(
      /\b(?:(?:(?:I|we)\s+will|(?:I|we)['’]ll)\s+(?:just\s+)?(?!not\b|never\b|likely\b|probably\b|maybe\b|be\b|have\b|the\b|a\b|an\b)[\p{L}]+|(?:(?:I|we|[\p{Lu}][\p{L}]+)\s+will|(?:I|we)['’]ll)\s+(?:just\s+)?(?:send|share|prepare|write|create|build|set|check|follow|review|provide|schedule|upload|update|book|arrange|invite|finish|complete|show|forward|give|deliver|do)|let me\s+(?:just\s+)?(?:send|share|prepare|check|set)|(?:I|we)(?:['’]ve| have)?\s+(?:(?:just|already)\s+)?(?:sent|shared|booked|created))/iu,
    );
    if (!undertaking) return false;
    if (
      /\b(?:thinking|maybe|might|could|would|probably|proposed|suggested|only if|unless)\b/i.test(
        clause.slice(
          Math.max(0, (undertaking.index ?? 0) - 100),
          undertaking.index,
        ),
      )
    )
      return false;
    const overlap = tokens(clause).filter((token) =>
      claimTokens.includes(token),
    );
    if (overlap.length < Math.min(2, claimTokens.length)) return false;
    if (quantities(claim).some((value) => !quantities(clause).includes(value)))
      return false;
    // A completed action must not be recast as an outstanding commitment.
    const completed = /\b(?:sent|shared|booked|created)\b/i.test(
      undertaking[0],
    );
    // A future passive ("needs to be sent") is not a completed action merely
    // because it contains the past participle "sent".
    const futurePassive =
      /\b(?:(?:will|must) be|(?:needs?|remains?|has|have) to be) (?:sent|shared|booked|completed)\b/gi;
    const pastClaim = claim.replace(futurePassive, '');
    if (
      completed &&
      (/\b(?:will|promised|committed|to send|to share)\b/i.test(claim) ||
        pastClaim !== claim ||
        !/\b(?:sent|shared|booked|created)\b/i.test(pastClaim))
    )
      return false;
    if (!completed && /\b(?:sent|shared|booked|completed)\b/i.test(pastClaim))
      return false;
    return true;
  });
};

export const liveDecisionHasConfirmation = (
  claim: string,
  evidence: string,
): boolean => {
  const claimTokens = tokens(claim);
  return evidence
    .replace(/\([^\n)]*\)\s*/g, '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/u)
    .some((clause) => {
      // A question plus "is fine" does not identify an accepted alternative.
      if (
        clause.includes('?') ||
        /\b(?:maybe|might|thinking|could|would|if|unless)\b/i.test(clause)
      )
        return false;
      if (
        !/\b(?:agreed|approved|decided|confirmed|chose|booked|reserved|will not|won't|not going to|let['’]s|go with)\b/i.test(
          clause,
        )
      )
        return false;
      return (
        tokens(clause).filter((token) => claimTokens.includes(token)).length >=
        Math.min(2, claimTokens.length)
      );
    });
};
