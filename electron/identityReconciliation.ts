import { createHash } from 'node:crypto';
import {
  getCommitmentState,
  parseActionMetadata,
} from '../src/utils/actionCommitment';
import { resolveRecordIdentity } from './commitmentIdentity';
import {
  commitmentRecord,
  priorCommitments,
  serializeCommitmentPublication,
} from './commitmentReconciliation';
import {
  type CommitmentSemanticRecord,
  type SemanticGenerate,
  findSemanticCommitmentMatches,
} from './commitmentSemanticReview';
import * as db from './db';

/** Discovery is input-driven, including startup migration; derived aliases do
 * not change the fingerprint and therefore cannot cause a reconciliation loop. */
let lastDiscoveredRevision = '';
export function discoverIdentityReconciliation() {
  const inputRevision = `${db.getIdentityInputRevision()}:${db.identityStore.getRevision()}`;
  if (inputRevision === lastDiscoveredRevision) return;
  const inputs = db.getIdentityReconciliationInputs();
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([db.identityStore.getRevision(), inputs]))
    .digest('hex');
  const meetings = new Set(
    db.getActiveCommitmentAliases().map((alias) => alias.meetingId),
  );
  for (const action of inputs.actions) {
    const metadata = parseActionMetadata(action.metadata);
    if (
      metadata.origin !== 'extraction' ||
      getCommitmentState(action.metadata) !== 'possible' ||
      action.status === 'completed'
    )
      continue;
    const source = commitmentRecord(action).meetingId;
    if (source) meetings.add(source);
  }
  for (const meetingId of meetings)
    if (db.getMeeting(meetingId))
      db.identityStore.enqueue(meetingId, fingerprint);
  lastDiscoveredRevision = inputRevision;
}

interface Cursor {
  aliases: string[];
  candidates: string[];
  prior: string[];
  phase: 'aliases' | 'candidates';
  index: number;
  priorIndex: number;
}
const freshCursor = (meetingId: string): Cursor => {
  const prior = priorCommitments();
  return {
    // Cross-meeting canonical corrections can invalidate any dependent alias.
    aliases: db.getActiveCommitmentAliases().map((alias) => alias.extractionId),
    candidates: prior
      .filter(
        (record) =>
          record.meetingId === meetingId &&
          record.reviewState === 'possible' &&
          record.status !== 'completed' &&
          parseActionMetadata(db.getEntity(record.id)?.metadata ?? null)
            .origin === 'extraction' &&
          !db.wasCommitmentRestored(record.id),
      )
      .map((record) => record.id),
    prior: prior.map((record) => record.id),
    phase: 'aliases',
    index: 0,
    priorIndex: 0,
  };
};

function aliasRecord(alias: db.CommitmentAliasInput): CommitmentSemanticRecord {
  const entity = db.getEntity(alias.extractionId);
  if (entity) return commitmentRecord(entity);
  const source = db.getMeeting(alias.meetingId) as
    | db.PersistedMeeting
    | undefined;
  let overview = '';
  try {
    overview = JSON.parse(source?.analysis_json ?? '{}').overview ?? '';
  } catch {
    /* Keep original source evidence. */
  }
  return {
    id: alias.extractionId,
    text: alias.description,
    owner: alias.original?.owner ?? null,
    due: alias.original?.due ?? null,
    sourceEvidence: alias.original?.sourceEvidence ?? null,
    meetingId: alias.meetingId,
    meetingDate:
      (db.getMeeting(alias.meetingId) as db.PersistedMeeting | undefined)
        ?.started_at ?? null,
    context: [
      alias.original?.sourceEvidence ?? alias.original?.evidence,
      source?.title,
      overview,
    ]
      .filter(Boolean)
      .join('\n'),
    reviewState: 'possible',
    status: 'active',
  };
}

/** Each call handles at most one alias or candidate/prior pair. Provider calls
 * and checkpoints are serial, cancellable, and protected by source/user revisions. */
export function createIdentityReconciler(options: {
  generate: SemanticGenerate;
  isPaused?: () => boolean;
  onChange?: () => void;
}) {
  let running = false;
  return {
    async runNext(signal?: AbortSignal): Promise<boolean> {
      if (running || signal?.aborted || options.isPaused?.()) return false;
      running = true;
      try {
        return await serializeCommitmentPublication(async () => {
          if (signal?.aborted || options.isPaused?.()) return false;
          const job = db.identityStore.nextJob();
          if (!job) return false;
          let cursor: Cursor;
          try {
            cursor = job.cursor
              ? JSON.parse(job.cursor)
              : freshCursor(job.meetingId);
            const revision = db.getCommitmentQueueRevision();
            const ensureCurrent = () => {
              signal?.throwIfAborted();
              if (
                db.identityStore.getStatus(job.meetingId)?.revision !==
                  job.revision ||
                db.getCommitmentQueueRevision() !== revision
              )
                throw new Error('identity_revision_stale');
            };
            let publish: (() => void) | null = null;
            if (cursor.phase === 'aliases') {
              const id = cursor.aliases[cursor.index++];
              const alias = db
                .getActiveCommitmentAliases()
                .find((item) => item.extractionId === id);
              if (alias) {
                const target = db.resolveCommitmentIdentity(alias.canonicalId);
                if (!target)
                  publish = () => db.restoreCommitmentAlias(alias.extractionId);
                else {
                  const candidate = await resolveRecordIdentity(
                    aliasRecord(alias),
                    options.generate,
                    signal,
                  );
                  const canonical = await resolveRecordIdentity(
                    commitmentRecord(target),
                    options.generate,
                    signal,
                  );
                  const proof = alias.original?.identityProof;
                  if (
                    !candidate.ownerKey ||
                    candidate.ownerKey !== canonical.ownerKey
                  )
                    publish = () =>
                      db.restoreCommitmentAlias(alias.extractionId);
                  else if (
                    proof?.candidateFingerprint !==
                      candidate.identityFingerprint ||
                    proof?.canonicalFingerprint !==
                      canonical.identityFingerprint
                  ) {
                    const match = (
                      await findSemanticCommitmentMatches(
                        [candidate],
                        [canonical],
                        options.generate,
                        signal,
                      )
                    ).get(candidate.id);
                    if (!match)
                      publish = () =>
                        db.restoreCommitmentAlias(alias.extractionId);
                    else if (alias.original)
                      publish = () =>
                        db.refreshCommitmentIdentityProof(revision, {
                          ...alias,
                          original: {
                            ...alias.original!,
                            identityProof: {
                              ownerKey: candidate.ownerKey!,
                              candidateFingerprint:
                                candidate.identityFingerprint!,
                              canonicalFingerprint:
                                canonical.identityFingerprint!,
                            },
                          },
                        });
                  }
                }
              }
              if (cursor.index >= cursor.aliases.length) {
                cursor.phase = 'candidates';
                cursor.index = 0;
              }
            } else {
              const id = cursor.candidates[cursor.index];
              const entity = id ? db.getEntity(id) : undefined;
              const rank = cursor.prior.indexOf(id);
              if (
                !entity ||
                db.isRetiredCommitment(id) ||
                db.wasCommitmentRestored(id) ||
                getCommitmentState(entity.metadata) !== 'possible' ||
                entity.status === 'completed' ||
                cursor.priorIndex >= rank
              ) {
                cursor.index++;
                cursor.priorIndex = 0;
              } else {
                const targetId = cursor.prior[cursor.priorIndex++];
                const target = db.resolveCommitmentIdentity(targetId);
                const candidate = await resolveRecordIdentity(
                  commitmentRecord(entity),
                  options.generate,
                  signal,
                );
                if (!candidate.ownerKey) {
                  cursor.index++;
                  cursor.priorIndex = 0;
                } else if (target && target.id !== id) {
                  const canonical = await resolveRecordIdentity(
                    commitmentRecord(target),
                    options.generate,
                    signal,
                  );
                  const match = (
                    await findSemanticCommitmentMatches(
                      [candidate],
                      [canonical],
                      options.generate,
                      signal,
                    )
                  ).get(id);
                  if (match) {
                    const alias: db.CommitmentAliasInput = {
                      extractionId: id,
                      canonicalId: target.id,
                      meetingId: job.meetingId,
                      description: candidate.text,
                      reason: match.reason,
                      original: {
                        owner: candidate.owner,
                        due: candidate.due,
                        evidence: candidate.context,
                        sourceEvidence: candidate.sourceEvidence,
                        normalizedDue: entity.due_date,
                        identityProof: {
                          ownerKey: candidate.ownerKey,
                          candidateFingerprint: candidate.identityFingerprint!,
                          canonicalFingerprint: canonical.identityFingerprint!,
                        },
                      },
                    };
                    publish = () =>
                      db.commitCommitmentAliases(revision, [alias]);
                    cursor.index++;
                    cursor.priorIndex = 0;
                  }
                }
              }
            }
            ensureCurrent();
            db.withCommitmentTransaction(() => {
              ensureCurrent();
              publish?.();
              if (
                !db.identityStore.checkpointJob(
                  job,
                  JSON.stringify(cursor),
                  cursor.phase === 'candidates' &&
                    cursor.index >= cursor.candidates.length,
                )
              )
                throw new Error('identity_revision_stale');
            });
            if (publish) options.onChange?.();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            if (
              signal?.aborted ||
              /preempt|superseded|revision_stale|reconciliation_stale/i.test(
                message,
              )
            )
              db.identityStore.checkpointJob(
                job,
                signal?.aborted || /preempt/i.test(message) ? job.cursor : null,
                false,
              );
            else db.identityStore.failJob(job, message);
          }
          return true;
        });
      } finally {
        running = false;
      }
    },
  };
}

export function startIdentityReconciliation(options: {
  generate: SemanticGenerate;
  pauseReasons: () => Record<string, number>;
  canRun?: () => boolean;
  onChange?: () => void;
}) {
  let controller: AbortController | null = null;
  let nextDiscovery = 0;
  const worker = createIdentityReconciler({
    ...options,
    isPaused: () =>
      options.canRun?.() === false ||
      Object.values(options.pauseReasons()).some(Boolean),
  });
  const tick = () => {
    if (controller) {
      if (
        options.canRun?.() === false ||
        Object.entries(options.pauseReasons()).some(
          ([reason, count]) => reason !== 'llm_active' && count > 0,
        )
      )
        controller.abort();
      return;
    }
    try {
      if (options.canRun?.() === false) return;
      if (Object.values(options.pauseReasons()).some(Boolean)) return;
      if (Date.now() >= nextDiscovery) {
        discoverIdentityReconciliation();
        nextDiscovery = Date.now() + 5000;
      }
      controller = new AbortController();
      void worker
        .runNext(controller.signal)
        .catch(() => undefined)
        .finally(() => {
          controller = null;
        });
    } catch {
      controller = null;
    }
  };
  const timer = setInterval(tick, 250);
  timer.unref?.();
  tick();
  return () => {
    clearInterval(timer);
    controller?.abort();
  };
}
