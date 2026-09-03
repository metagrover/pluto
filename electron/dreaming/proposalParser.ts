import type {
  DreamingEntityType,
  DreamingProposalKind,
  DreamingProposalPayloadByKind,
  ValidatedDreamingProposal,
} from './types';

const proposalKindsByEntityType: Record<
  DreamingEntityType,
  readonly DreamingProposalKind[]
> = {
  project: [
    'project_summary',
    'project_milestone',
    'project_commitment',
    'project_alias',
  ],
  person: [
    'person_headline',
    'person_focus',
    'person_collaborator',
    'person_alias',
  ],
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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const parseEvidence = (
  value: unknown,
): ValidatedDreamingProposal['evidence'] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const evidence = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasExactKeys(item, ['meetingId', 'excerpt']) ||
      !isNonEmptyString(item.meetingId) ||
      !isNonEmptyString(item.excerpt)
    ) {
      return null;
    }
    evidence.push({ meetingId: item.meetingId, excerpt: item.excerpt });
  }
  return evidence;
};

const parsePayload = (
  kind: DreamingProposalKind,
  value: unknown,
): DreamingProposalPayloadByKind[DreamingProposalKind] | null => {
  if (!isRecord(value)) return null;
  switch (kind) {
    case 'project_summary':
      return hasExactKeys(value, ['summary']) && isNonEmptyString(value.summary)
        ? { summary: value.summary }
        : null;
    case 'project_milestone':
      return hasExactKeys(value, ['name', 'status']) &&
        isNonEmptyString(value.name) &&
        (value.status === 'planned' ||
          value.status === 'in_progress' ||
          value.status === 'completed')
        ? { name: value.name, status: value.status }
        : null;
    case 'project_commitment':
      return hasExactKeys(value, ['task']) && isNonEmptyString(value.task)
        ? { task: value.task }
        : null;
    case 'project_alias':
    case 'person_alias':
      return hasExactKeys(value, ['alias']) && isNonEmptyString(value.alias)
        ? { alias: value.alias }
        : null;
    case 'person_headline':
      return hasExactKeys(value, ['headline']) &&
        isNonEmptyString(value.headline)
        ? { headline: value.headline }
        : null;
    case 'person_focus':
      return hasExactKeys(value, ['focus']) && isNonEmptyString(value.focus)
        ? { focus: value.focus }
        : null;
    case 'person_collaborator':
      return hasExactKeys(value, ['name']) && isNonEmptyString(value.name)
        ? { name: value.name }
        : null;
  }
};

const normalizedFingerprint = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const parseDreamingProposal = (
  value: unknown,
  entityType: DreamingEntityType,
): ValidatedDreamingProposal | null => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['kind', 'payload', 'evidence', 'fingerprint']) ||
    typeof value.kind !== 'string' ||
    !proposalKindsByEntityType[entityType].includes(
      value.kind as DreamingProposalKind,
    ) ||
    typeof value.fingerprint !== 'string' ||
    !normalizedFingerprint.test(value.fingerprint)
  ) {
    return null;
  }
  const kind = value.kind as DreamingProposalKind;
  const payload = parsePayload(kind, value.payload);
  const evidence = parseEvidence(value.evidence);
  if (!payload || !evidence) return null;
  return {
    kind,
    payload,
    evidence,
    fingerprint: value.fingerprint,
  } as ValidatedDreamingProposal;
};
