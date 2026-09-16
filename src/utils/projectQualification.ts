export interface ProjectQualification {
  version: 1;
  reviewVersion?: number;
  issue?:
    | 'source_unavailable'
    | 'model_uncertain'
    | 'invalid_proposal'
    | 'outcome_not_grounded'
    | 'work_not_grounded'
    | 'work_not_distinct'
    | 'insufficient_work';
  state: 'qualified' | 'subordinate' | 'unassessed';
  reason: string;
  source: 'extraction' | 'review' | 'user';
  assessedAt: string;
  outcome?: string;
  workItems?: Array<{ description: string; evidenceQuote: string }>;
  outcomeEvidenceQuote?: string;
  sourceMeetingId?: string;
  parentProjectId?: string;
  parentEvidenceQuote?: string;
}

export interface ProjectQualificationProposal {
  kind: 'initiative' | 'task' | 'topic' | 'uncertain';
  outcome?: string;
  outcomeEvidenceQuote?: string;
  workItems?: Array<{ description: string; evidenceQuote: string }>;
  reason?: string;
  parentProjectId?: string;
  parentEvidenceQuote?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

export type ProjectPortfolioDisposition = 'confirmed' | 'dismissed';

export function readProjectPortfolioDisposition(
  metadata: unknown,
): ProjectPortfolioDisposition | null {
  try {
    const parsed: unknown =
      typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (!record(parsed)) return null;
    return parsed.projectPortfolioDisposition === 'confirmed' ||
      parsed.projectPortfolioDisposition === 'dismissed'
      ? parsed.projectPortfolioDisposition
      : null;
  } catch {
    return null;
  }
}

export function withProjectPortfolioDisposition(
  metadata: string | null,
  disposition: ProjectPortfolioDisposition,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(metadata || '{}');
    if (record(value)) parsed = value;
  } catch {
    parsed = {};
  }
  const current = readProjectQualification(parsed);
  const {
    parentProjectId: _removedParentId,
    parentEvidenceQuote: _removedEvidence,
    ...restQ
  } = (current || {}) as Record<string, unknown>;
  return JSON.stringify({
    ...parsed,
    projectPortfolioDisposition: disposition,
    projectPortfolioDispositionUpdatedAt: new Date().toISOString(),
    projectQualification: {
      ...restQ,
      version: 1,
      state: disposition === 'confirmed' ? 'qualified' : 'subordinate',
      source: 'user',
      reason:
        disposition === 'confirmed'
          ? 'Confirmed by the user as a project.'
          : 'Dismissed by the user from the project portfolio.',
      assessedAt: new Date().toISOString(),
    },
  });
}

export function withoutProjectPortfolioDisposition(
  metadata: string | null,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(metadata || '{}');
    if (record(value)) parsed = value;
  } catch {
    parsed = {};
  }
  const current = readProjectQualification(parsed);
  const {
    projectPortfolioDisposition: _removedDisposition,
    projectPortfolioDispositionUpdatedAt: _removedDispositionAt,
    ...restParsed
  } = parsed;
  return JSON.stringify({
    ...restParsed,
    projectQualification: {
      ...(current || {}),
      version: 1,
      state: 'unassessed',
      source: 'user',
      reason: 'Reverted to topic by user.',
      assessedAt: new Date().toISOString(),
    },
  });
}

export function readProjectQualification(
  metadata: unknown,
): ProjectQualification | null {
  try {
    const parsed: unknown =
      typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (!record(parsed) || !record(parsed.projectQualification)) return null;
    const q = parsed.projectQualification;
    if (
      q.version !== 1 ||
      !['qualified', 'subordinate', 'unassessed'].includes(String(q.state)) ||
      !['extraction', 'review', 'user'].includes(String(q.source)) ||
      !nonempty(q.reason) ||
      !nonempty(q.assessedAt) ||
      Number.isNaN(Date.parse(q.assessedAt))
    )
      return null;
    for (const key of [
      'outcome',
      'outcomeEvidenceQuote',
      'sourceMeetingId',
      'parentProjectId',
      'parentEvidenceQuote',
    ]) {
      if (q[key] !== undefined && !nonempty(q[key])) return null;
    }
    if (
      q.workItems !== undefined &&
      (!Array.isArray(q.workItems) ||
        !q.workItems.every(
          (item) =>
            record(item) &&
            nonempty(item.description) &&
            nonempty(item.evidenceQuote),
        ))
    )
      return null;
    return q as unknown as ProjectQualification;
  } catch {
    return null;
  }
}

export const PROJECT_SCOPE_REVIEW_VERSION = 2;

export function isProjectScopeReviewPending(metadata: unknown): boolean {
  const qualification = readProjectQualification(metadata);
  return (
    !qualification ||
    (qualification.state === 'unassessed' && qualification.source !== 'user')
  );
}

export interface ProjectScopeReviewAttempt {
  version: number;
  status: 'failed';
  reason: string;
  attemptedAt: string;
}

export function readProjectScopeReviewReason(metadata: unknown): string | null {
  try {
    const parsed: unknown =
      typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    if (!record(parsed)) return null;
    const attempt = parsed.projectScopeReviewAttempt;
    return record(attempt) &&
      attempt.version === PROJECT_SCOPE_REVIEW_VERSION &&
      attempt.status === 'failed' &&
      nonempty(attempt.reason) &&
      nonempty(attempt.attemptedAt)
      ? attempt.reason.trim()
      : null;
  } catch {
    return null;
  }
}

export function shouldAutomaticallyReviewProjectScope(
  metadata: unknown,
): boolean {
  return (
    isProjectScopeReviewPending(metadata) &&
    readProjectQualification(metadata)?.reviewVersion !==
      PROJECT_SCOPE_REVIEW_VERSION &&
    !readProjectScopeReviewReason(metadata)
  );
}

export function assessProjectProposal(
  proposal: unknown,
  transcript: string,
  options: {
    source: 'extraction' | 'review';
    sourceMeetingId: string;
    assessedAt?: string;
  },
): ProjectQualification {
  const base: ProjectQualification = {
    version: 1,
    state: 'unassessed',
    reason: 'Insufficient grounded evidence for project scope.',
    source: options.source,
    ...(options.sourceMeetingId.trim()
      ? { sourceMeetingId: options.sourceMeetingId }
      : {}),
    assessedAt: options.assessedAt ?? new Date().toISOString(),
  };
  const unresolved = (
    issue: NonNullable<ProjectQualification['issue']>,
    reason: string,
  ): ProjectQualification => ({ ...base, issue, reason });
  if (!transcript.trim())
    return unresolved(
      'source_unavailable',
      'No validated source conversation is available for this review.',
    );
  if (!record(proposal))
    return unresolved(
      'invalid_proposal',
      'The review did not return a usable scope assessment.',
    );
  if (proposal.kind === 'uncertain')
    return unresolved(
      'model_uncertain',
      nonempty(proposal.reason)
        ? proposal.reason.trim()
        : 'The available conversations do not establish project scope.',
    );
  const sourceText = normalize(transcript);
  const grounded = (quote: unknown): quote is string =>
    nonempty(quote) &&
    normalize(quote).length >= 12 &&
    sourceText.includes(normalize(quote));
  if (!grounded(proposal.outcomeEvidenceQuote))
    return unresolved(
      'outcome_not_grounded',
      'The outcome quote could not be verified in the source conversation.',
    );
  if (proposal.kind === 'task' || proposal.kind === 'topic') {
    return {
      ...base,
      state: 'subordinate',
      reason: nonempty(proposal.reason)
        ? proposal.reason.trim()
        : 'Evidence describes a task or topic, not an independent initiative.',
      outcomeEvidenceQuote: proposal.outcomeEvidenceQuote,
    };
  }
  if (
    proposal.kind !== 'initiative' ||
    !nonempty(proposal.outcome) ||
    !Array.isArray(proposal.workItems)
  )
    return unresolved(
      'invalid_proposal',
      'The review did not describe an initiative with constituent work.',
    );
  const workItems: Array<{ description: string; evidenceQuote: string }> = [];
  let discardedWorkIssue: 'work_not_grounded' | 'work_not_distinct' | undefined;
  for (const item of proposal.workItems) {
    if (
      !record(item) ||
      !nonempty(item.description) ||
      !grounded(item.evidenceQuote)
    ) {
      discardedWorkIssue ??= 'work_not_grounded';
      continue;
    }
    const description = normalize(item.description)
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, '');
    const evidence = normalize(item.evidenceQuote);
    const start = sourceText.indexOf(evidence);
    const end = start + evidence.length;
    const overlaps =
      workItems.some((existing) => {
        const previous = normalize(existing.evidenceQuote);
        const previousStart = sourceText.indexOf(previous);
        return start < previousStart + previous.length && previousStart < end;
      }) ||
      workItems.some(
        (existing) =>
          normalize(existing.description)
            .toLowerCase()
            .replace(/[^\p{L}\p{N} ]/gu, '') === description ||
          normalize(existing.evidenceQuote).includes(evidence) ||
          evidence.includes(normalize(existing.evidenceQuote)),
      );
    if (overlaps) {
      discardedWorkIssue ??= 'work_not_distinct';
      continue;
    }
    workItems.push({
      description: item.description.trim(),
      evidenceQuote: item.evidenceQuote.trim(),
    });
  }
  if (workItems.length < 2) {
    if (discardedWorkIssue === 'work_not_grounded')
      return unresolved(
        'work_not_grounded',
        'Fewer than two work item quotes could be verified in the source conversation.',
      );
    if (discardedWorkIssue === 'work_not_distinct')
      return unresolved(
        'work_not_distinct',
        'The work item evidence repeats or overlaps rather than establishing distinct work.',
      );
    return unresolved(
      'insufficient_work',
      'Fewer than two distinct work items are supported by the source conversation.',
    );
  }
  // Parent IDs require database resolution and are deliberately not trusted here.
  return {
    ...base,
    state: 'qualified',
    reason: nonempty(proposal.reason)
      ? proposal.reason.trim()
      : 'A distinct outcome and multiple grounded work items are supported.',
    outcome: proposal.outcome.trim(),
    outcomeEvidenceQuote: proposal.outcomeEvidenceQuote.trim(),
    workItems,
  };
}

export function withParentProject(
  metadata: string | null,
  parentProjectId: string,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(metadata || '{}');
    if (record(value)) parsed = value;
  } catch {
    parsed = {};
  }
  const current = readProjectQualification(parsed);
  return JSON.stringify({
    ...parsed,
    projectQualification: {
      ...(current || {}),
      version: 1,
      state: 'subordinate',
      source: 'user',
      parentProjectId,
      reason: 'Filed as a topic under parent initiative.',
      assessedAt: new Date().toISOString(),
    },
  });
}

export function withoutParentProject(metadata: string | null): string {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(metadata || '{}');
    if (record(value)) parsed = value;
  } catch {
    parsed = {};
  }
  const current = readProjectQualification(parsed);
  const {
    parentProjectId: _removedParentId,
    parentEvidenceQuote: _removedEvidence,
    ...restQ
  } = (current || {}) as Record<string, unknown>;
  return JSON.stringify({
    ...parsed,
    projectQualification: {
      ...restQ,
      version: 1,
      state: 'unassessed',
      source: 'user',
      reason: 'Detached from parent initiative.',
      assessedAt: new Date().toISOString(),
    },
  });
}
