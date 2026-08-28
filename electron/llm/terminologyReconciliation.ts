import type {
  MeetingTerminologyArtifactV1,
  MeetingTerminologyProposalV1,
  TerminologyConfidence,
  TerminologySignal,
} from './analysisTypes';

export const TERMINOLOGY_POLICY_VERSION = 'terminology-v1';
export const MAX_TERMINOLOGY_CANDIDATES = 24;
const MAX_CONTEXTS_PER_CANDIDATE = 4;

export type TerminologyKind =
  | 'name'
  | 'organization'
  | 'product'
  | 'acronym'
  | 'domain_term';
export type TerminologyReason =
  | 'variant'
  | 'ambiguous'
  | 'known_term_match'
  | 'spoken_definition';

export interface TerminologyCandidate {
  rawText: string;
  segmentIndexes: number[];
  context: string[];
  kind: TerminologyKind;
  reason: TerminologyReason;
}

export interface TerminologyCandidateCluster {
  rawForms: string[];
  segmentIndexes: number[];
  contexts: string[];
  kind: TerminologyKind;
  reasons: TerminologyReason[];
}

export interface RawTerminologyProposal {
  raw_forms?: unknown;
  preferred_term?: unknown;
  confidence?: unknown;
  signals?: unknown;
  disposition?: unknown;
}

const VALID_KINDS = new Set<TerminologyKind>([
  'name',
  'organization',
  'product',
  'acronym',
  'domain_term',
]);
const VALID_REASONS = new Set<TerminologyReason>([
  'variant',
  'ambiguous',
  'known_term_match',
  'spoken_definition',
]);
const VALID_SIGNALS = new Set<TerminologySignal>([
  'repeated_context',
  'known_person',
  'known_entity',
  'spoken_definition',
  'variant_consistency',
]);
const PROTECTED_WORDS = new Set([
  'no',
  'not',
  'never',
  'none',
  'without',
  'today',
  'tomorrow',
  'yesterday',
  'next week',
  'last week',
  'this week',
]);
const CANDIDATE_STOP_WORDS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'there',
  'their',
  'about',
  'because',
  'before',
  'after',
  'should',
  'would',
  'could',
  'really',
  'actually',
  'basically',
  'probably',
  'something',
  'anything',
  'everything',
  'meeting',
  'discussion',
  'different',
  'and',
  'yeah',
  'like',
  'cool',
]);

const normalizeTerm = (value: string): string =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const isProtectedCandidate = (rawText: string, contexts: string[]): boolean => {
  const normalized = normalizeTerm(rawText);
  if (PROTECTED_WORDS.has(normalized)) return true;
  if (/^\d+(?:[.,:/-]\d+)*$/.test(normalized)) return true;
  if (
    /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return contexts.some((context) => {
    const speaker = context.match(/^\s*(?:\d+[.:]\s*)?([^:]{1,80}):/)?.[1];
    return speaker ? normalizeTerm(speaker) === normalized : false;
  });
};

export const parseTerminologyCandidates = (
  value: unknown,
  transcriptLines: string[],
  segmentOffset = 0,
): TerminologyCandidate[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((entry): TerminologyCandidate[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const rawText =
      typeof record.raw_text === 'string' ? record.raw_text.trim() : '';
    const kind = record.kind as TerminologyKind;
    const reason = record.reason as TerminologyReason;
    if (
      rawText.length < 2 ||
      rawText.length > 80 ||
      /[\r\n]/.test(rawText) ||
      !VALID_KINDS.has(kind) ||
      !VALID_REASONS.has(reason) ||
      !Array.isArray(record.segment_indexes)
    ) {
      return [];
    }
    const localIndexes = unique(
      record.segment_indexes.filter(
        (index): index is number =>
          Number.isInteger(index) &&
          index >= 0 &&
          index < transcriptLines.length,
      ),
    );
    const matchingIndexes = localIndexes.filter((index) =>
      normalizeTerm(transcriptLines[index]).includes(normalizeTerm(rawText)),
    );
    const contexts = matchingIndexes.map((index) => transcriptLines[index]);
    if (
      matchingIndexes.length === 0 ||
      isProtectedCandidate(rawText, contexts)
    ) {
      return [];
    }
    return [
      {
        rawText,
        segmentIndexes: matchingIndexes.map((index) => index + segmentOffset),
        context: contexts.slice(0, MAX_CONTEXTS_PER_CANDIDATE),
        kind,
        reason,
      },
    ];
  });
};

export const discoverRepeatedTerminologyCandidates = (
  transcriptLines: string[],
  segmentOffset = 0,
): TerminologyCandidate[] => {
  const occurrences = new Map<
    string,
    { rawText: string; indexes: number[]; contexts: string[] }
  >();
  for (const [index, line] of transcriptLines.entries()) {
    const content = line.replace(/^\s*(?:\d+[.:]\s*)?[^:]{1,80}:\s*/, '');
    for (const match of content.matchAll(/\b[\p{Lu}][\p{L}\p{N}&.-]{2,}\b/gu)) {
      const rawText = match[0];
      if (CANDIDATE_STOP_WORDS.has(normalizeTerm(rawText))) continue;
      if (isProtectedCandidate(rawText, [line])) continue;
      const key = normalizeTerm(rawText);
      const existing = occurrences.get(key) ?? {
        rawText,
        indexes: [],
        contexts: [],
      };
      existing.indexes.push(index + segmentOffset);
      existing.contexts.push(line);
      occurrences.set(key, existing);
    }
  }
  const repeated = [...occurrences.values()].filter(
    (entry) => new Set(entry.indexes).size >= 2,
  );
  const selected =
    repeated.length <= MAX_TERMINOLOGY_CANDIDATES
      ? repeated
      : Array.from({ length: MAX_TERMINOLOGY_CANDIDATES }, (_, index) =>
          repeated.at(
            Math.floor(
              (index * (repeated.length - 1)) /
                (MAX_TERMINOLOGY_CANDIDATES - 1),
            ),
          ),
        ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  return selected.map((entry) => ({
    rawText: entry.rawText,
    segmentIndexes: unique(entry.indexes).sort((left, right) => left - right),
    context: unique(entry.contexts).slice(0, MAX_CONTEXTS_PER_CANDIDATE),
    kind: /^[\p{Lu}\d]{2,}$/u.test(entry.rawText)
      ? ('acronym' as const)
      : ('name' as const),
    reason: 'ambiguous' as const,
  }));
};

export const aggregateTerminologyCandidates = (
  candidates: TerminologyCandidate[],
): TerminologyCandidateCluster[] => {
  const clusters = new Map<string, TerminologyCandidateCluster>();
  for (const candidate of candidates) {
    const key = normalizeTerm(candidate.rawText);
    const existing = clusters.get(key);
    if (existing) {
      existing.rawForms = unique([...existing.rawForms, candidate.rawText]);
      existing.segmentIndexes = unique([
        ...existing.segmentIndexes,
        ...candidate.segmentIndexes,
      ]).sort((left, right) => left - right);
      existing.contexts = unique([
        ...existing.contexts,
        ...candidate.context,
      ]).slice(0, MAX_CONTEXTS_PER_CANDIDATE);
      existing.reasons = unique([...existing.reasons, candidate.reason]);
      continue;
    }
    clusters.set(key, {
      rawForms: [candidate.rawText],
      segmentIndexes: [...candidate.segmentIndexes],
      contexts: candidate.context.slice(0, MAX_CONTEXTS_PER_CANDIDATE),
      kind: candidate.kind,
      reasons: [candidate.reason],
    });
  }
  return [...clusters.values()].slice(0, MAX_TERMINOLOGY_CANDIDATES);
};

const parseConfidence = (value: unknown): TerminologyConfidence =>
  value === 'high' || value === 'medium' || value === 'low' ? value : 'low';

const findCandidate = (
  candidates: TerminologyCandidateCluster[],
  rawForms: string[],
): TerminologyCandidateCluster | undefined => {
  const proposed = new Set(rawForms.map(normalizeTerm));
  return candidates.find((candidate) =>
    candidate.rawForms.some((rawForm) => proposed.has(normalizeTerm(rawForm))),
  );
};

export const createTerminologyArtifact = (params: {
  candidates: TerminologyCandidateCluster[];
  proposals: RawTerminologyProposal[];
  knownTerms: string[];
  provider: string;
  model: string;
  generatedAt: string;
}): MeetingTerminologyArtifactV1 => {
  const knownTerms = new Set(params.knownTerms.map(normalizeTerm));
  const proposals: MeetingTerminologyProposalV1[] = params.proposals
    .slice(0, MAX_TERMINOLOGY_CANDIDATES)
    .flatMap((proposal): MeetingTerminologyProposalV1[] => {
      const rawForms = Array.isArray(proposal.raw_forms)
        ? unique(
            proposal.raw_forms.filter(
              (value): value is string =>
                typeof value === 'string' && value.trim().length > 0,
            ),
          )
        : [];
      const candidate = findCandidate(params.candidates, rawForms);
      if (!candidate) return [];
      const preferredTerm =
        typeof proposal.preferred_term === 'string' &&
        proposal.preferred_term.trim()
          ? proposal.preferred_term.trim()
          : null;
      const confidence = parseConfidence(proposal.confidence);
      const signals = Array.isArray(proposal.signals)
        ? unique(
            proposal.signals.filter((signal): signal is TerminologySignal =>
              VALID_SIGNALS.has(signal),
            ),
          )
        : [];
      const protectedContent = candidate.rawForms.some((rawForm) =>
        isProtectedCandidate(rawForm, candidate.contexts),
      );
      const knownSignal =
        preferredTerm !== null &&
        knownTerms.has(normalizeTerm(preferredTerm)) &&
        signals.some(
          (signal) => signal === 'known_person' || signal === 'known_entity',
        );
      const spokenDefinition =
        signals.includes('spoken_definition') &&
        candidate.reasons.includes('spoken_definition');
      const variantConsistency =
        signals.includes('variant_consistency') &&
        candidate.rawForms.length > 1;
      const repeatedContext =
        signals.includes('repeated_context') &&
        candidate.segmentIndexes.length > 1 &&
        candidate.contexts.length > 1;
      const changesTerm =
        preferredTerm !== null &&
        !candidate.rawForms.some(
          (rawForm) => normalizeTerm(rawForm) === normalizeTerm(preferredTerm),
        );
      const explicitlyPreserved = proposal.disposition === 'preserve_raw';
      const status =
        protectedContent || explicitlyPreserved
          ? 'preserved'
          : confidence === 'high' &&
              changesTerm &&
              (knownSignal ||
                spokenDefinition ||
                variantConsistency ||
                repeatedContext)
            ? 'applied'
            : preferredTerm && changesTerm
              ? 'proposed'
              : 'preserved';
      return [
        {
          rawForms: candidate.rawForms,
          preferredTerm,
          segmentIndexes: candidate.segmentIndexes,
          confidence,
          signals,
          status,
        },
      ];
    });

  return {
    schemaVersion: 1,
    generatedAt: params.generatedAt,
    provider: params.provider,
    model: params.model,
    policyVersion: TERMINOLOGY_POLICY_VERSION,
    proposals,
  };
};

export const buildTerminologyContextBlock = (
  artifact: MeetingTerminologyArtifactV1,
): string => {
  const applied = artifact.proposals.filter(
    (proposal) =>
      proposal.status === 'applied' || proposal.status === 'confirmed',
  );
  if (applied.length === 0) return '';
  return `Terminology for synthesis only:\n${applied
    .map(
      (proposal) =>
        `- Raw forms: ${proposal.rawForms.map((form) => `"${form}"`).join(', ')}. Preferred term: "${proposal.preferredTerm}".`,
    )
    .join(
      '\n',
    )}\n- Use preferred terms in summaries only. Keep transcript evidence verbatim.`;
};

export const getAppliedTerminologyAliases = (
  artifact: MeetingTerminologyArtifactV1,
): Record<string, string[]> =>
  Object.fromEntries(
    artifact.proposals
      .filter(
        (proposal) =>
          (proposal.status === 'applied' || proposal.status === 'confirmed') &&
          proposal.preferredTerm,
      )
      .map((proposal) => [proposal.preferredTerm as string, proposal.rawForms]),
  );
