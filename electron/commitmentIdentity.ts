import { createHash } from 'node:crypto';
import type { IdentityContext, OwnerResolution } from '../src/types/identity';
import { parseActionMetadata } from '../src/utils/actionCommitment';
import { parseTranscriptSegments } from '../src/utils/transcript';
import type {
  CommitmentSemanticRecord,
  SemanticGenerate,
} from './commitmentSemanticReview';
import * as db from './db';
import { resolveCommitmentOwner } from './identityResolution';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function getMeetingIdentityContext(meetingId: string): IdentityContext {
  const meeting = db.getMeeting(meetingId) as db.PersistedMeeting | undefined;
  const sourceRevision = hash(meeting?.transcript_json ?? null);
  const turns = parseTranscriptSegments(meeting?.transcript_json ?? null).map(
    (turn, index) => ({
      id: `t${index}`,
      speaker: String(turn.speaker ?? `Unknown ${index}`),
      text: typeof turn.text === 'string' ? turn.text : '',
    }),
  );
  const people = db.getEntitiesByType('person').map((person) => {
    const aliases = [
      ...db.identityStore.getPersonAliases(person.id),
      ...db.getPersonNameAliases(person.id),
    ];
    return {
      id: person.id,
      name: person.name,
      ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
    };
  });
  const bindings = db.identityStore.getBindings(meetingId).map((binding) => ({
    ...binding,
    personId: binding.personId
      ? db.resolvePersonIdentityId(binding.personId)
      : null,
  }));
  const storedCapture = db.identityStore.getCapture(meetingId);
  const capture = {
    ...storedCapture,
    selfPersonId: storedCapture.selfPersonId
      ? db.resolvePersonIdentityId(storedCapture.selfPersonId)
      : null,
  };
  // A high-confidence individual near-end attribution plus capture-time self
  // confirmation can name Me. A remote channel may contain several people.
  let attribution: Record<string, unknown> = {};
  try {
    attribution =
      JSON.parse(meeting?.transcript_json ?? '{}')?.speakerAttribution ?? {};
  } catch {
    /* Unknown provenance remains unresolved. */
  }
  const nearEnd = turns.find(
    (turn) => turn.speaker === 'Me' && turn.text.trim(),
  );
  if (
    capture.origin === 'local' &&
    capture.selfPersonId &&
    people.some((person) => person.id === capture.selfPersonId) &&
    (attribution.source === 'local_diarization_acoustic' ||
      attribution.source === 'offline_diarization_acoustic_v1') &&
    attribution.mappingApplied === true &&
    typeof attribution.confidence === 'number' &&
    attribution.confidence >= 0.85 &&
    !attribution.fallbackReason &&
    nearEnd &&
    !bindings.some((binding) => binding.speaker === 'Me')
  ) {
    bindings.push({
      speaker: 'Me',
      personId: capture.selfPersonId,
      individual: true,
      source: 'capture',
      sourceRevision,
      evidence: [],
      captureEvidence: {
        origin: 'local',
        selfPersonId: capture.selfPersonId,
        attributionSource: attribution.source,
        confidence: attribution.confidence,
        mappingApplied: true,
        sourceRevision,
      },
    });
  }
  return { meetingId, sourceRevision, turns, people, bindings, capture };
}

export async function resolveRecordIdentity(
  record: CommitmentSemanticRecord,
  generate: SemanticGenerate,
  signal?: AbortSignal,
): Promise<CommitmentSemanticRecord> {
  signal?.throwIfAborted();
  const context = getMeetingIdentityContext(record.meetingId ?? 'unknown');
  const entity = db.getEntity(record.id);
  const actionSnapshot = JSON.stringify(entity);
  const metadata = parseActionMetadata(entity?.metadata ?? null);
  const explicitlyAssigned =
    metadata.owner_source === 'user' ||
    (metadata.origin === 'user' && entity?.assigned_to != null);
  const input = {
    text: record.text,
    ownerLabel: record.owner,
    evidence:
      record.sourceEvidence ??
      (typeof metadata.source_evidence === 'string'
        ? metadata.source_evidence
        : null),
    explicitPersonId: explicitlyAssigned
      ? (entity?.assigned_to ?? null)
      : undefined,
  };
  const revision = db.identityStore.getRevision();
  const fingerprint = hash([
    input,
    context,
    revision,
    record.due,
    record.context,
    record.meetingDate,
    record.reviewState,
    record.status,
  ]);
  let resolution = db.identityStore.getResolution(record.id, fingerprint);
  if (!resolution) {
    resolution =
      explicitlyAssigned && !input.explicitPersonId
        ? ({
            status: 'unresolved',
            ownerKey: null,
            personId: null,
            source: 'user',
            evidence: [],
            reason: 'The user cleared this owner.',
          } satisfies OwnerResolution)
        : await resolveCommitmentOwner(input, context, generate, signal);
    signal?.throwIfAborted();
    if (
      revision !== db.identityStore.getRevision() ||
      JSON.stringify(db.getEntity(record.id)) !== actionSnapshot ||
      hash(getMeetingIdentityContext(context.meetingId)) !== hash(context)
    )
      throw new Error('identity_revision_stale');
    db.identityStore.saveResolution(
      record.id,
      fingerprint,
      resolution,
      context.meetingId,
    );
  }
  return {
    ...record,
    ownerKey: resolution.ownerKey,
    identityFingerprint: fingerprint,
  };
}

export async function resolveRecordIdentities(
  records: CommitmentSemanticRecord[],
  generate: SemanticGenerate,
  signal?: AbortSignal,
) {
  const resolved: CommitmentSemanticRecord[] = [];
  for (const record of records)
    resolved.push(await resolveRecordIdentity(record, generate, signal));
  return resolved;
}
