import { createHash } from 'node:crypto';
import { parseRawDreamingProposal } from './proposalParser';
import type {
  DreamingCommitmentProposal,
  DreamingInputPackage,
  DreamingMilestoneProposal,
  DreamingValidationResult,
  PersonDreamingOutput,
  ProjectDreamingOutput,
  RawDreamingProposal,
  ValidatedDreamingProposal,
} from './types';

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
 * Evidence order is not meaningful, so the fingerprint hashes normalized,
 * sorted references together with canonical entity, kind, and payload data.
 */
export const generateProposalFingerprint = (
  proposal: RawDreamingProposal,
  pkg: Pick<DreamingInputPackage, 'entityId' | 'entityType'>,
): string => {
  const evidence = proposal.evidence
    .map(({ meetingId, excerpt }) => ({
      meetingId,
      excerpt: normalizeEvidenceText(excerpt),
    }))
    .sort((left, right) => {
      const leftKey = `${left.meetingId}\u0000${left.excerpt}`;
      const rightKey = `${right.meetingId}\u0000${right.excerpt}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return createHash('sha256')
    .update(
      JSON.stringify({
        entityId: pkg.entityId,
        entityType: pkg.entityType,
        kind: proposal.kind,
        payload: canonicalPayload(proposal),
        evidence,
      }),
    )
    .digest('hex');
};

const payloadCorrectionFingerprints = (
  proposal: RawDreamingProposal,
): string[] =>
  Object.values(proposal.payload)
    .filter((value): value is string => typeof value === 'string')
    .map(generateItemFingerprint)
    .filter(Boolean);

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
    parsed.proposals.length === 0
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

    const fingerprint = generateProposalFingerprint(proposal, pkg);
    if (
      corrections.has(generateItemFingerprint(fingerprint)) ||
      payloadCorrectionFingerprints(proposal).some((candidate) =>
        corrections.has(candidate),
      )
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

const cleanJson = (raw: string): string => {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
};

export const validateProjectDreamingOutput = (
  raw: string,
  pkg: DreamingInputPackage,
): ProjectDreamingOutput | null => {
  try {
    const cleaned = cleanJson(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const validMeetingIds = new Set(
      pkg.recentMeetingNotes.map((n) => n.meetingId),
    );
    const negativeSet = new Set(
      pkg.negativeConstraints.map((c) => c.toLowerCase().trim()),
    );

    const status = parsed.status === 'updated' ? 'updated' : 'no_change';
    const dossier_summary =
      typeof parsed.dossier_summary === 'string'
        ? parsed.dossier_summary.trim()
        : undefined;

    const milestones: DreamingMilestoneProposal[] = [];
    if (Array.isArray(parsed.milestones)) {
      for (const m of parsed.milestones) {
        if (!m || typeof m !== 'object') continue;
        const name = typeof m.name === 'string' ? m.name.trim() : '';
        const source_meeting_id =
          typeof m.source_meeting_id === 'string'
            ? m.source_meeting_id.trim()
            : '';
        const evidence_snippet =
          typeof m.evidence_snippet === 'string'
            ? m.evidence_snippet.trim()
            : '';
        const rawStatus = m.status;
        const milestoneStatus =
          rawStatus === 'completed' ||
          rawStatus === 'in_progress' ||
          rawStatus === 'planned'
            ? rawStatus
            : 'in_progress';

        if (!name || !source_meeting_id) continue;
        if (!validMeetingIds.has(source_meeting_id)) continue;

        const fingerprint = generateItemFingerprint(name);
        if (negativeSet.has(fingerprint)) continue;

        milestones.push({
          name,
          status: milestoneStatus,
          source_meeting_id,
          evidence_snippet,
        });
      }
    }

    const associated_commitments: DreamingCommitmentProposal[] = [];
    if (Array.isArray(parsed.associated_commitments)) {
      for (const c of parsed.associated_commitments) {
        if (!c || typeof c !== 'object') continue;
        const task = typeof c.task === 'string' ? c.task.trim() : '';
        const owner_name =
          typeof c.owner_name === 'string' ? c.owner_name.trim() : '';
        const source_meeting_id =
          typeof c.source_meeting_id === 'string'
            ? c.source_meeting_id.trim()
            : '';

        if (!task || !source_meeting_id) continue;
        if (!validMeetingIds.has(source_meeting_id)) continue;

        const fingerprint = generateItemFingerprint(task);
        if (negativeSet.has(fingerprint)) continue;

        associated_commitments.push({
          task,
          owner_name,
          source_meeting_id,
        });
      }
    }

    const suggested_aliases: string[] = [];
    if (Array.isArray(parsed.suggested_aliases)) {
      for (const a of parsed.suggested_aliases) {
        if (typeof a === 'string' && a.trim() && a.trim() !== pkg.entityName) {
          const aliasName = a.trim();
          const fp = generateItemFingerprint(aliasName);
          if (!negativeSet.has(fp) && !suggested_aliases.includes(aliasName)) {
            suggested_aliases.push(aliasName);
          }
        }
      }
    }

    return {
      status,
      dossier_summary,
      milestones,
      associated_commitments,
      suggested_aliases,
    };
  } catch {
    return null;
  }
};

export const validatePersonDreamingOutput = (
  raw: string,
  pkg: DreamingInputPackage,
): PersonDreamingOutput | null => {
  try {
    const cleaned = cleanJson(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const negativeSet = new Set(
      pkg.negativeConstraints.map((c) => c.toLowerCase().trim()),
    );

    const status = parsed.status === 'updated' ? 'updated' : 'no_change';
    const headline =
      typeof parsed.headline === 'string' ? parsed.headline.trim() : undefined;
    const current_focus =
      typeof parsed.current_focus === 'string'
        ? parsed.current_focus.trim()
        : undefined;

    const recent_collaborators: string[] = [];
    if (Array.isArray(parsed.recent_collaborators)) {
      for (const c of parsed.recent_collaborators) {
        if (
          typeof c === 'string' &&
          c.trim() &&
          !recent_collaborators.includes(c.trim())
        ) {
          recent_collaborators.push(c.trim());
        }
      }
    }

    const suggested_aliases: string[] = [];
    if (Array.isArray(parsed.suggested_aliases)) {
      for (const a of parsed.suggested_aliases) {
        if (typeof a === 'string' && a.trim() && a.trim() !== pkg.entityName) {
          const aliasName = a.trim();
          const fp = generateItemFingerprint(aliasName);
          if (!negativeSet.has(fp) && !suggested_aliases.includes(aliasName)) {
            suggested_aliases.push(aliasName);
          }
        }
      }
    }

    return {
      status,
      headline,
      current_focus,
      recent_collaborators,
      suggested_aliases,
    };
  } catch {
    return null;
  }
};
