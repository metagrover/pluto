import { createHash } from 'node:crypto';
import {
  containsEvidencePhrase,
  normalizeEvidenceText as normalizeSourceText,
} from '../../src/utils/evidenceText';
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
  /\b(?:will|i'll|we'll|agreed (?:to|that|on)|committed (?:to|that)|promised (?:to|that)|must|needs? to|assigned (?:to|that)|(?:is |are |was |were )?required to|action items?(?: is| are)?|owns? the task of|responsible for|tasked with|decided (?:to|that))\b/;
const TENTATIVE_COMMITMENT_CUE =
  /\b(?:propos(?:e|es|ed|ing|als?)|suggest(?:s|ed|ing|ions?)?|consider(?:s|ed|ing|ation)?|might|may|could|aim(?:s|ed|ing)? to|aspirations?|likely|probably|possibly|as long as)\b/;
const NEGATED_COMMITMENT_CUE =
  /\b(?:not|never|no longer|(?:is|was|are|were|has|have|had|does|do|did|will|would|should|could|can)n't|cannot|declined to|refused to|withdrawn?|cancel(?:led|ed)|no action item)\b/;
const CONDITIONAL_COMMITMENT_CUE =
  /\b(?:if|unless|once|when|until|upon approval|after approval|subject to|pending|provided that|assuming|depending on|contingent (?:on|upon))\b/;

const supportedCommitmentTask = (
  proposal: Extract<RawDreamingProposal, { kind: 'project_commitment' }>,
  pkg: DreamingInputPackage,
): string | null => {
  for (const reference of proposal.evidence) {
    const meeting = pkg.recentMeetingNotes.find(
      (item) => item.meetingId === reference.meetingId,
    );
    // A saved action retains its classification. Do not infer a new owner or
    // obligation from a prose fragment, or revive an action removed from notes.
    const saved = meeting?.actionItems?.find(
      (task) =>
        normalizeSourceText(task).replace(/[.!?]+$/, '') ===
          normalizeSourceText(proposal.payload.task).replace(/[.!?]+$/, '') &&
        normalizeSourceText(meeting.notesContent).includes(
          normalizeSourceText(task),
        ) &&
        containsEvidencePhrase(reference.excerpt, task),
    );
    if (saved) return saved;
    for (const sentence of reference.excerpt.match(/[^.!?]+[.!?]?/g) ?? []) {
      const excerpt = normalizeEvidenceText(sentence);
      if (
        containsEvidencePhrase(excerpt, proposal.payload.task) &&
        EXPLICIT_COMMITMENT_CUE.test(excerpt) &&
        !TENTATIVE_COMMITMENT_CUE.test(excerpt) &&
        !NEGATED_COMMITMENT_CUE.test(excerpt) &&
        !CONDITIONAL_COMMITMENT_CUE.test(excerpt)
      )
        return proposal.payload.task;
    }
  }
  return null;
};

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
  let firstRejectionError: string | null = null;

  for (const value of parsed.proposals) {
    let proposal = parseRawDreamingProposal(value, pkg.entityType);
    if (!proposal) {
      firstRejectionError ??= 'invalid_proposal_shape';
      continue;
    }

    const distinctMeetingIds = new Set<string>();
    let evidenceValid = true;
    for (const reference of proposal.evidence) {
      const notes = meetingNotes.get(reference.meetingId);
      const excerpt = normalizeEvidenceText(reference.excerpt);
      if (!notes || !excerpt || !notes.includes(excerpt)) {
        evidenceValid = false;
        break;
      }
      distinctMeetingIds.add(reference.meetingId);
    }
    if (!evidenceValid) {
      firstRejectionError ??= 'invalid_proposal_evidence';
      continue;
    }
    if (proposal.kind === 'project_summary' && distinctMeetingIds.size < 2) {
      firstRejectionError ??= 'insufficient_summary_evidence';
      continue;
    }
    if (proposal.kind === 'project_commitment') {
      const task = supportedCommitmentTask(proposal, pkg);
      if (!task) {
        firstRejectionError ??= 'unsupported_project_commitment';
        continue;
      }
      proposal = { ...proposal, payload: { task } };
    }

    const fingerprint = generateProposalFingerprint(proposal, pkg);
    if (
      corrections.has(generateItemFingerprint(fingerprint)) ||
      corrections.has(legacyClaimFingerprint(proposal))
    ) {
      firstRejectionError ??= 'proposal_corrected';
      continue;
    }
    if (fingerprints.has(fingerprint)) {
      return invalid('duplicate_proposal');
    }
    fingerprints.add(fingerprint);
    proposals.push({ ...proposal, fingerprint } as ValidatedDreamingProposal);
  }

  if (proposals.length === 0) {
    return invalid(firstRejectionError ?? 'invalid_proposed_output');
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
