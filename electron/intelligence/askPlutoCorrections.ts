import type { AskPlutoConversationTurn } from '../../src/types/askPlutoQuery';

export interface AskPlutoClaimCorrection {
  originalClaim: string;
  correctedText: string;
  meetingIds: string[];
  createdAt?: string;
}

interface CorrectionRecord {
  target_kind: string;
  action: string;
  payload_json: string | null;
  created_at: string;
}

const CORRECTION_PREFIX =
  /^(?:actually[,;:]?|correction\s*[:,-]?|(?:that(?:'s| is)|you(?:'re| are))\s+(?:not right|wrong)[,;:]?|no[,;:]\s+)/i;

const clip = (value: string, length = 800): string =>
  value.trim().replace(/\s+/g, ' ').slice(0, length);

export const detectExplicitAskPlutoCorrection = (
  query: string,
  priorTurns: AskPlutoConversationTurn[],
): AskPlutoClaimCorrection | null => {
  if (!CORRECTION_PREFIX.test(query.trim())) return null;
  const priorAnswer = [...priorTurns]
    .reverse()
    .find(
      (turn) =>
        turn.role === 'assistant' &&
        turn.content.trim() &&
        Array.isArray(turn.meetingIds) &&
        turn.meetingIds.length > 0,
    );
  if (!priorAnswer?.meetingIds?.length) return null;
  const correctedText = clip(query.replace(CORRECTION_PREFIX, ''));
  if (
    !correctedText ||
    correctedText.endsWith('?') ||
    /^(?:can|could|would|will|please|what|who|when|where|why|how|compare|summarize|analyze|show|tell)\b/i.test(
      correctedText,
    )
  ) {
    return null;
  }
  return {
    originalClaim: clip(priorAnswer.content),
    correctedText,
    meetingIds: [...new Set(priorAnswer.meetingIds)].slice(0, 8),
  };
};

export const parseAskPlutoCorrectionRecords = (
  records: CorrectionRecord[],
): AskPlutoClaimCorrection[] =>
  records.flatMap((record) => {
    if (
      record.target_kind !== 'claim' ||
      record.action !== 'correct_claim' ||
      !record.payload_json
    ) {
      return [];
    }
    try {
      const payload = JSON.parse(record.payload_json) as Record<
        string,
        unknown
      >;
      if (
        payload.source !== 'ask_pluto' ||
        typeof payload.original_claim !== 'string' ||
        typeof payload.corrected_text !== 'string'
      ) {
        return [];
      }
      return [
        {
          originalClaim: clip(payload.original_claim),
          correctedText: clip(payload.corrected_text),
          meetingIds: Array.isArray(payload.meeting_ids)
            ? payload.meeting_ids
                .filter((id): id is string => typeof id === 'string')
                .slice(0, 8)
            : [],
          createdAt: record.created_at,
        },
      ];
    } catch {
      return [];
    }
  });

const correctionTokens = (value: string): Set<string> =>
  new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
      (token) =>
        token.length > 2 &&
        ![
          'the',
          'and',
          'for',
          'that',
          'this',
          'with',
          'who',
          'what',
          'owns',
        ].includes(token),
    ),
  );

export const selectRelevantAskPlutoCorrections = (
  queryContext: string,
  corrections: AskPlutoClaimCorrection[],
  limit = 6,
): AskPlutoClaimCorrection[] => {
  const queryTokens = correctionTokens(queryContext);
  return corrections
    .filter((correction) => {
      const tokens = correctionTokens(
        `${correction.originalClaim} ${correction.correctedText}`,
      );
      return [...tokens].some((token) => queryTokens.has(token));
    })
    .slice(0, limit);
};

export const formatAskPlutoCorrectionsForPrompt = (
  corrections: AskPlutoClaimCorrection[],
): string => {
  if (corrections.length === 0) return 'None';
  return `These are explicit user corrections, not meeting evidence. Use them to avoid repeating a corrected claim, but never cite them as transcript support:\n${corrections
    .map(
      (correction, index) =>
        `${index + 1}. Replace "${correction.originalClaim}" with "${correction.correctedText}".`,
    )
    .join('\n')}`;
};
