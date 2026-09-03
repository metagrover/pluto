import { createHash } from 'node:crypto';
import { parseRawDreamingProposal } from './proposalParser';
import type {
  DreamingInputPackage,
  DreamingValidationResult,
  RawDreamingProposal,
  ValidatedDreamingProposal,
} from './types';
import { MAX_DREAMING_PROPOSALS } from './types';

export const generateItemFingerprint = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
};

/** Normalize only presentation-equivalent differences; substantive tokens stay ordered. */
const normalizeEvidenceText = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();

const EXPLICIT_COMMITMENT_CUE =
  /\b(?:agreed to|committed to|promised to|will|must|needs? to|assigned to|action item(?: is|:)?|owns? the task of)\b/;
const TENTATIVE_COMMITMENT_CUE =
  /\b(?:propos(?:e|ed|al)|suggest(?:ed|ion)?|consider(?:ed|ing)?|might|may|could|option|alternative|aim(?:ed)? to|aspiration)\b/;

const hasExplicitCommitmentEvidence = (
  proposal: RawDreamingProposal,
): boolean =>
  proposal.evidence.some((reference) => {
    const excerpt = normalizeEvidenceText(reference.excerpt);
    return (
      EXPLICIT_COMMITMENT_CUE.test(excerpt) &&
      !TENTATIVE_COMMITMENT_CUE.test(excerpt)
    );
  });

const canonicalPayload = (proposal: RawDreamingProposal): unknown => {
  switch (proposal.kind) {
    case 'project_summary':
      return { summary: normalizeEvidenceText(proposal.payload.summary) };
    case 'project_milestone':
      return {
        name: normalizeEvidenceText(proposal.payload.name),
        status: proposal.payload.status,
      };
    case 'project_commitment':
      return { task: normalizeEvidenceText(proposal.payload.task) };
    case 'project_alias':
    case 'person_alias':
      return { alias: normalizeEvidenceText(proposal.payload.alias) };
    case 'person_headline':
      return { headline: normalizeEvidenceText(proposal.payload.headline) };
    case 'person_focus':
      return { focus: normalizeEvidenceText(proposal.payload.focus) };
    case 'person_collaborator':
      return { name: normalizeEvidenceText(proposal.payload.name) };
  }
};

/**
 * Evidence proves a claim but is not its identity. This fingerprint remains
 * stable when the same normalized claim is supported by different evidence.
 */
export const generateProposalFingerprint = (
  proposal: RawDreamingProposal,
  pkg: Pick<DreamingInputPackage, 'entityId' | 'entityType'>,
): string => {
  return createHash('sha256')
    .update(
      JSON.stringify({
        entityId: pkg.entityId,
        entityType: pkg.entityType,
        kind: proposal.kind,
        payload: canonicalPayload(proposal),
      }),
    )
    .digest('hex');
};

const legacyClaimFingerprint = (proposal: RawDreamingProposal): string => {
  switch (proposal.kind) {
    case 'project_summary':
      return generateItemFingerprint(proposal.payload.summary);
    case 'project_milestone':
      return generateItemFingerprint(proposal.payload.name);
    case 'project_commitment':
      return generateItemFingerprint(proposal.payload.task);
    case 'project_alias':
    case 'person_alias':
      return generateItemFingerprint(proposal.payload.alias);
    case 'person_headline':
      return generateItemFingerprint(proposal.payload.headline);
    case 'person_focus':
      return generateItemFingerprint(proposal.payload.focus);
    case 'person_collaborator':
      return generateItemFingerprint(proposal.payload.name);
  }
};

const invalid = (error: string): DreamingValidationResult => ({
  valid: false,
  error,
});

export const validateDreamingOutput = (
  raw: string,
  pkg: DreamingInputPackage,
): DreamingValidationResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid('invalid_json');
  }

  if (!isRecord(parsed) || !hasExactKeys(parsed, ['status', 'proposals'])) {
    return invalid('invalid_output_shape');
  }
  if (parsed.status === 'no_change') {
    return Array.isArray(parsed.proposals) && parsed.proposals.length === 0
      ? { valid: true, status: 'no_change', proposals: [] }
      : invalid('invalid_no_change');
  }
  if (
    parsed.status !== 'proposed' ||
    !Array.isArray(parsed.proposals) ||
    parsed.proposals.length === 0 ||
    parsed.proposals.length > MAX_DREAMING_PROPOSALS
  ) {
    return invalid('invalid_proposed_output');
  }

  const meetingNotes = new Map(
    pkg.recentMeetingNotes.map((meeting) => [
      meeting.meetingId,
      normalizeEvidenceText(meeting.notesContent),
    ]),
  );
  const corrections = new Set(
    [...(pkg.correctionFingerprints ?? []), ...pkg.negativeConstraints]
      .map(generateItemFingerprint)
      .filter(Boolean),
  );
  const fingerprints = new Set<string>();
  const proposals: ValidatedDreamingProposal[] = [];

  for (const value of parsed.proposals) {
    const proposal = parseRawDreamingProposal(value, pkg.entityType);
    if (!proposal) return invalid('invalid_proposal_shape');

    const distinctMeetingIds = new Set<string>();
    for (const reference of proposal.evidence) {
      const notes = meetingNotes.get(reference.meetingId);
      const excerpt = normalizeEvidenceText(reference.excerpt);
      if (!notes || !excerpt || !notes.includes(excerpt)) {
        return invalid('invalid_proposal_evidence');
      }
      distinctMeetingIds.add(reference.meetingId);
    }
    if (proposal.kind === 'project_summary' && distinctMeetingIds.size < 2) {
      return invalid('insufficient_summary_evidence');
    }
    if (
      proposal.kind === 'project_commitment' &&
      !hasExplicitCommitmentEvidence(proposal)
    ) {
      return invalid('unsupported_project_commitment');
    }

    const fingerprint = generateProposalFingerprint(proposal, pkg);
    if (
      corrections.has(generateItemFingerprint(fingerprint)) ||
      corrections.has(legacyClaimFingerprint(proposal))
    ) {
      return invalid('proposal_corrected');
    }
    if (fingerprints.has(fingerprint)) {
      return invalid('duplicate_proposal');
    }
    fingerprints.add(fingerprint);
    proposals.push({ ...proposal, fingerprint } as ValidatedDreamingProposal);
  }

  return {
    valid: true,
    status: 'proposed',
    proposals: proposals as [
      ValidatedDreamingProposal,
      ...ValidatedDreamingProposal[],
    ],
  };
};
