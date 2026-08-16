import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const LIVE_TRANSCRIPTION_ROLLOUT_STAGES = Object.freeze([
  'system_shadow',
  'dual_shadow',
  'internal_primary',
  'canary',
] as const);

export type LiveTranscriptionRolloutStage =
  (typeof LIVE_TRANSCRIPTION_ROLLOUT_STAGES)[number];
export type LiveTranscriptionMode = 'mlx' | 'parakeet';
export type LiveTranscriptionRollbackReason =
  | 'watchdog'
  | 'backend_failure'
  | 'manual'
  | 'startup_invalid';

const ROLLBACK_REASONS = new Set<LiveTranscriptionRollbackReason>([
  'watchdog',
  'backend_failure',
  'manual',
  'startup_invalid',
]);
const STAGES = new Set<string>(LIVE_TRANSCRIPTION_ROLLOUT_STAGES);
const SHA256 = /^[a-f0-9]{64}$/u;
const ZERO_DIGEST = '0'.repeat(64);

export type LiveTranscriptionRolloutState = {
  schemaVersion: 1;
  mode: LiveTranscriptionMode;
  stage: LiveTranscriptionRolloutStage | 'none';
  evidenceDigest: string;
  engineEpoch: number;
  rollbackCount: number;
  lastRollbackReason?: LiveTranscriptionRollbackReason;
};

export type LiveTranscriptionRolloutStoreOptions = {
  filePath: string;
  ownerToken: string;
  approvedStageEvidenceDigests: Readonly<
    Partial<Record<LiveTranscriptionRolloutStage, readonly string[]>>
  >;
};

export type LiveTranscriptionRolloutMutation =
  | { accepted: true; state: LiveTranscriptionRolloutState }
  | {
      accepted: false;
      reason:
        | 'not_owner'
        | 'invalid_evidence'
        | 'stale_epoch'
        | 'invalid_request'
        | 'write_failed';
    };

export type LiveTranscriptionRolloutPromotion = {
  stage: LiveTranscriptionRolloutStage;
  evidenceDigest: string;
  engineEpoch: number;
  ownerToken: string;
};

export type LiveTranscriptionRolloutRollback = {
  reason: LiveTranscriptionRollbackReason;
  engineEpoch: number;
  ownerToken: string;
};

const defaultState = (): LiveTranscriptionRolloutState => ({
  schemaVersion: 1,
  mode: 'mlx',
  stage: 'none',
  evidenceDigest: ZERO_DIGEST,
  engineEpoch: 0,
  rollbackCount: 0,
});

const isSafeCounter = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const hasOnlyStateKeys = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every((key) =>
    [
      'schemaVersion',
      'mode',
      'stage',
      'evidenceDigest',
      'engineEpoch',
      'rollbackCount',
      'lastRollbackReason',
    ].includes(key),
  );

const parseState = (value: unknown): LiveTranscriptionRolloutState | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  if (!hasOnlyStateKeys(record)) return null;
  if (record.schemaVersion !== 1) return null;
  if (record.mode !== 'mlx' && record.mode !== 'parakeet') return null;
  if (
    record.stage !== 'none' &&
    (typeof record.stage !== 'string' || !STAGES.has(record.stage))
  )
    return null;
  if (
    typeof record.evidenceDigest !== 'string' ||
    !SHA256.test(record.evidenceDigest)
  )
    return null;
  if (
    !isSafeCounter(record.engineEpoch) ||
    !isSafeCounter(record.rollbackCount)
  )
    return null;
  if (
    record.lastRollbackReason !== undefined &&
    !ROLLBACK_REASONS.has(
      record.lastRollbackReason as LiveTranscriptionRollbackReason,
    )
  ) {
    return null;
  }
  if (record.mode === 'mlx' && record.stage !== 'none') return null;
  if (record.mode === 'mlx' && record.evidenceDigest !== ZERO_DIGEST)
    return null;
  if (
    record.mode === 'parakeet' &&
    (record.stage === 'none' || record.evidenceDigest === ZERO_DIGEST)
  )
    return null;
  return {
    schemaVersion: 1,
    mode: record.mode,
    stage: record.stage as LiveTranscriptionRolloutStage | 'none',
    evidenceDigest: record.evidenceDigest,
    engineEpoch: record.engineEpoch,
    rollbackCount: record.rollbackCount,
    ...(record.lastRollbackReason === undefined
      ? {}
      : {
          lastRollbackReason:
            record.lastRollbackReason as LiveTranscriptionRollbackReason,
        }),
  };
};

export class LiveTranscriptionRolloutStore {
  private readonly filePath: string;
  private readonly ownerToken: string;
  private readonly approvedDigests: Readonly<
    Partial<Record<LiveTranscriptionRolloutStage, readonly string[]>>
  >;
  private tempSequence = 0;

  constructor(options: LiveTranscriptionRolloutStoreOptions) {
    this.filePath = options.filePath;
    this.ownerToken = options.ownerToken;
    this.approvedDigests = options.approvedStageEvidenceDigests;
  }

  read(): LiveTranscriptionRolloutState {
    try {
      const parsed = parseState(
        JSON.parse(readFileSync(this.filePath, 'utf8')),
      );
      if (!parsed) return defaultState();
      if (
        parsed.mode === 'parakeet' &&
        parsed.stage !== 'none' &&
        !this.approvedDigests[parsed.stage]?.includes(parsed.evidenceDigest)
      ) {
        const safeRollback: LiveTranscriptionRolloutState = {
          ...defaultState(),
          engineEpoch: parsed.engineEpoch,
          rollbackCount: Math.min(
            Number.MAX_SAFE_INTEGER,
            parsed.rollbackCount +
              (parsed.rollbackCount < Number.MAX_SAFE_INTEGER ? 1 : 0),
          ),
          lastRollbackReason: 'startup_invalid',
        };
        const persisted = this.replace(safeRollback, this.ownerToken);
        return persisted.accepted ? persisted.state : safeRollback;
      }
      return parsed;
    } catch {
      return defaultState();
    }
  }

  promote(
    request: LiveTranscriptionRolloutPromotion,
  ): LiveTranscriptionRolloutMutation {
    if (request.ownerToken !== this.ownerToken)
      return { accepted: false, reason: 'not_owner' };
    const current = this.read();
    if (
      !isSafeCounter(request.engineEpoch) ||
      request.engineEpoch <= current.engineEpoch
    ) {
      return { accepted: false, reason: 'stale_epoch' };
    }
    if (
      !STAGES.has(request.stage) ||
      !SHA256.test(request.evidenceDigest) ||
      !this.approvedDigests[request.stage]?.includes(request.evidenceDigest)
    ) {
      return { accepted: false, reason: 'invalid_evidence' };
    }
    const next: LiveTranscriptionRolloutState = {
      schemaVersion: 1,
      mode: 'parakeet',
      stage: request.stage,
      evidenceDigest: request.evidenceDigest,
      engineEpoch: request.engineEpoch,
      rollbackCount: current.rollbackCount,
    };
    return this.replace(next, request.ownerToken);
  }

  rollback(
    request: LiveTranscriptionRolloutRollback,
  ): LiveTranscriptionRolloutMutation {
    if (request.ownerToken !== this.ownerToken)
      return { accepted: false, reason: 'not_owner' };
    const current = this.read();
    if (
      !isSafeCounter(request.engineEpoch) ||
      request.engineEpoch < current.engineEpoch
    ) {
      return { accepted: false, reason: 'stale_epoch' };
    }
    if (
      !ROLLBACK_REASONS.has(request.reason) ||
      current.rollbackCount === Number.MAX_SAFE_INTEGER
    ) {
      return { accepted: false, reason: 'invalid_request' };
    }
    const next: LiveTranscriptionRolloutState = {
      schemaVersion: 1,
      mode: 'mlx',
      stage: 'none',
      evidenceDigest: ZERO_DIGEST,
      engineEpoch: request.engineEpoch,
      rollbackCount: current.rollbackCount + 1,
      lastRollbackReason: request.reason,
    };
    return this.replace(next, request.ownerToken);
  }

  private replace(
    next: LiveTranscriptionRolloutState,
    ownerToken: string,
  ): LiveTranscriptionRolloutMutation {
    if (ownerToken !== this.ownerToken)
      return { accepted: false, reason: 'not_owner' };
    const temporaryPath = join(
      dirname(this.filePath),
      `.${basename(this.filePath) || 'rollout'}.${this.tempSequence++}.tmp`,
    );
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const payload = `${JSON.stringify(next)}\n`;
      writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
      const descriptor = openSync(temporaryPath, 'r');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporaryPath, this.filePath);
      return { accepted: true, state: next };
    } catch {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup; the old state remains authoritative.
      }
      return { accepted: false, reason: 'write_failed' };
    }
  }
}

export const LIVE_TRANSCRIPTION_ROLLOUT_ZERO_DIGEST = ZERO_DIGEST;
