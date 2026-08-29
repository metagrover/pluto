import {
  getCommitmentState,
  parseActionMetadata,
} from '../src/utils/actionCommitment';
import { resolveRecordIdentities } from './commitmentIdentity';
import {
  type CommitmentSemanticRecord,
  type SemanticGenerate,
  findSemanticCommitmentMatches,
} from './commitmentSemanticReview';
import * as db from './db';

export const COMMITMENT_REVIEW_VERSION = 'resolved-owner-identity-v2';

// Serialize read/compare/publish across meetings; the provider gate alone only
// serializes individual inference calls, not their database snapshots.
let publicationTail: Promise<unknown> = Promise.resolve();
export function serializeCommitmentPublication<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = publicationTail.then(operation, operation);
  publicationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function commitmentRecord(entity: db.Entity): CommitmentSemanticRecord {
  const metadata = parseActionMetadata(entity.metadata);
  const relations = db.getCommitmentSourceRelations(entity.id);
  const meetings = relations.meetings;
  const sourceId =
    typeof metadata.source_meeting_id === 'string'
      ? metadata.source_meeting_id
      : meetings[0]?.id;
  const source = sourceId
    ? (db.getMeeting(sourceId) as db.PersistedMeeting | undefined)
    : undefined;
  const context =
    meetings.find((meeting) => meeting.id === sourceId)?.context ?? '';
  const projects = relations.projects.map((related) => related.name);
  let overview = '';
  try {
    overview = JSON.parse(source?.analysis_json || '{}').overview || '';
  } catch {
    /* Source text remains available. */
  }
  return {
    id: entity.id,
    text:
      typeof metadata.full_description === 'string' &&
      entity.name === metadata.full_description.slice(0, 100)
        ? metadata.full_description
        : entity.name,
    owner: entity.assigned_to
      ? (db.getEntity(entity.assigned_to)?.name ?? null)
      : typeof metadata.assignee_name === 'string'
        ? metadata.assignee_name
        : null,
    sourceEvidence:
      typeof metadata.source_evidence === 'string'
        ? metadata.source_evidence
        : null,
    due:
      entity.due_date ??
      (typeof metadata.source_due_date === 'string'
        ? metadata.source_due_date
        : null),
    meetingId: sourceId == null ? null : String(sourceId),
    meetingDate: source?.started_at ?? null,
    context: [
      projects.length ? `Projects: ${projects.join(', ')}` : '',
      metadata.source_evidence,
      context,
      source?.title,
      overview,
    ]
      .filter(Boolean)
      .join('\n'),
    reviewState: getCommitmentState(entity.metadata),
    status: entity.status,
  };
}

export function priorCommitments(): CommitmentSemanticRecord[] {
  // Reviewed records precede pending candidates; older identities are stable.
  return db
    .getEntitiesByType('action_item')
    .sort((left, right) => {
      const rank = (entity: db.Entity) =>
        entity.status === 'completed'
          ? 0
          : getCommitmentState(entity.metadata) === 'confirmed'
            ? 1
            : getCommitmentState(entity.metadata) === 'rejected'
              ? 2
              : 3;
      return (
        rank(left) - rank(right) ||
        left.created_at.localeCompare(right.created_at) ||
        left.id.localeCompare(right.id)
      );
    })
    .map(commitmentRecord);
}

export async function planCommitmentAliases(
  candidates: CommitmentSemanticRecord[],
  prior: CommitmentSemanticRecord[],
  generate: SemanticGenerate,
  signal?: AbortSignal,
): Promise<db.CommitmentAliasInput[]> {
  const resolvedCandidates = await resolveRecordIdentities(
    candidates,
    generate,
    signal,
  );
  if (!resolvedCandidates.some((candidate) => candidate.ownerKey)) return [];
  const resolvedPrior = await resolveRecordIdentities(prior, generate, signal);
  const matches = await findSemanticCommitmentMatches(
    resolvedCandidates,
    resolvedPrior,
    generate,
    signal,
  );
  return resolvedCandidates.flatMap((candidate) => {
    const match = matches.get(candidate.id);
    if (
      !match ||
      !candidate.meetingId ||
      db.wasCommitmentRestored(candidate.id)
    )
      return [];
    let target = match.matchId;
    const seen = new Set([candidate.id]);
    while (matches.has(target)) {
      if (seen.has(target)) throw new Error('commitment_alias_cycle');
      seen.add(target);
      target = matches.get(target)!.matchId;
    }
    return [
      {
        extractionId: candidate.id,
        canonicalId: target,
        meetingId: candidate.meetingId,
        description: candidate.text,
        reason: match.reason,
        original: {
          owner: candidate.owner,
          due: candidate.due,
          evidence: candidate.context,
          normalizedDue: db.getEntity(candidate.id)?.due_date ?? null,
          sourceEvidence: candidate.sourceEvidence ?? null,
          identityProof: {
            ownerKey: candidate.ownerKey!,
            candidateFingerprint: candidate.identityFingerprint!,
            canonicalFingerprint:
              [...resolvedPrior, ...resolvedCandidates].find(
                (record) => record.id === target,
              )?.identityFingerprint ?? '',
          },
        },
      },
    ];
  });
}

export async function previewPendingCommitmentCleanup(
  generate: SemanticGenerate,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const revision = db.getCommitmentQueueRevision();
  const prior = priorCommitments();
  const candidates = prior.filter((record) => {
    const entity = db.getEntity(record.id)!;
    return (
      record.reviewState === 'possible' &&
      record.status !== 'completed' &&
      parseActionMetadata(entity.metadata).origin === 'extraction' &&
      !db.wasCommitmentRestored(record.id)
    );
  });
  const candidateIds = new Set(candidates.map((record) => record.id));
  const aliases = await planCommitmentAliases(
    candidates,
    prior.filter((record) => !candidateIds.has(record.id)),
    generate,
    signal,
  );
  signal?.throwIfAborted();
  if (db.getCommitmentQueueRevision() !== revision)
    throw new Error('commitment_reconciliation_stale');
  return {
    reviewVersion: COMMITMENT_REVIEW_VERSION,
    revision,
    examined: candidates.length,
    aliases,
  };
}
