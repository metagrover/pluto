import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHash, randomBytes } from 'node:crypto';
import {
  appendCaptureJournalChunk,
  appendCaptureTranscriptAcceptanceFrame,
  appendCaptureTranscriptCheckpoint,
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  createCaptureJournal,
  deleteCaptureJournal,
  markCaptureJournalSourceFailed,
  migrateSealedCaptureJournalToV4,
  persistCaptureJournalRawChunk,
  promoteCaptureTranscriptCheckpoint,
  readCaptureJournalChunk,
  readCaptureJournalManifest,
  readCaptureJournalSidecar,
  recordCaptureJournalStickyFailure,
  replaceCaptureTranscriptCheckpoint,
  sealCaptureJournal,
  setCaptureJournalAudioKeyProvider,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import {
  ENVELOPE_MAGIC,
  EncryptedArtifactStore,
} from '../../electron/crypto/encryptedArtifactStore';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';
import { canonicalizeTranscriptCheckpointConfig } from '../../src/utils/transcriptCheckpointConfig';

describe('capture journal', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  const makeRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), 'pluto-capture-journal-'));
    tempRoots.push(root);
    return root;
  };

  it('durably records a generation-fenced source failure without replacing captured evidence', async () => {
    const root = await makeRoot();
    const manifest = await createCaptureJournal(root, {
      meetingId: 'failure',
      startedAtMs: 1000,
      schemaVersion: 3,
    });
    if (manifest.schemaVersion !== 3) throw new Error('expected v3');
    const identity = {
      meetingId: 'failure',
      generation: manifest.generation,
      expectedRevision: manifest.revision,
      source: 'system' as const,
    };
    await expect(
      markCaptureJournalSourceFailed(root, {
        ...identity,
        generation: 'stale',
      }),
    ).rejects.toThrow('generation mismatch');
    await expect(
      markCaptureJournalSourceFailed(root, {
        ...identity,
        source: 'renderer-controlled' as never,
      }),
    ).rejects.toThrow('Invalid capture source');
    expect(await readCaptureJournalManifest(root, 'failure')).toEqual(manifest);
    const failed = await markCaptureJournalSourceFailed(root, identity);
    expect(failed.sourceAvailability.system).toBe('failed_during_capture');
    expect(failed.intervals).toEqual(manifest.intervals);
    expect(failed.revision).toBe(manifest.revision + 1);
    expect(await readCaptureJournalManifest(root, 'failure')).toEqual(failed);
    await expect(
      markCaptureJournalSourceFailed(root, identity),
    ).rejects.toThrow('revision conflict');
    const again = await markCaptureJournalSourceFailed(root, {
      ...identity,
      expectedRevision: failed.revision,
    });
    expect(again.revision).toBe(failed.revision);
    const stopping = await stopCaptureJournal(root, {
      ...identity,
      expectedRevision: failed.revision,
    });
    expect(stopping.sourceAvailability.system).toBe('failed_during_capture');
  });

  const mutateManifest = async (
    root: string,
    mutate: (manifest: Record<string, unknown>) => void,
  ) => {
    const manifest = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const manifestPath = join(root, manifest.manifestRelativePath);
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    mutate(parsed);
    await writeFile(manifestPath, JSON.stringify(parsed));
  };

  const buildEvidence = (endTime = 5) =>
    buildCaptureActivityEvidence([{ startTime: 0, endTime, speaker: 'Me' }], {
      clock: {
        kind: 'meeting_relative_seconds',
        origin: 'recording_start',
      },
      thresholds: {
        rms: 0.01,
        dominanceRatio: 1.5,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1',
    });

  it('creates a versioned per-meeting manifest', async () => {
    const root = await makeRoot();

    const manifest = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });

    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.meetingId).toBe('meeting-123');
    expect(manifest.lifecycleState).toBe('recording');
    expect(manifest.entries).toEqual([]);
    expect(manifest.artifactRootRelativePath).toBe(
      'meeting-123/capture-journal',
    );
    expect(manifest.activityEvidence).toBeUndefined();
    expect(manifest).toMatchObject({
      revision: 0,
      expectedSources: ['mic', 'system'],
      intervals: [],
      transcriptCheckpoints: [],
      acceptanceFrames: [],
    });
    expect('generation' in manifest ? manifest.generation : '').toMatch(
      /^[0-9a-f-]{16,}$/,
    );
  });

  it('enforces the v3 interval CAS and raw_durable to captured transition', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    expect(authorized.intervals[0].sources).toEqual({
      mic: { disposition: 'pending' },
      system: { disposition: 'pending' },
    });
    await expect(
      authorizeCaptureJournalInterval(root, {
        meetingId: created.meetingId,
        generation: created.generation,
        expectedRevision: created.revision,
        sequence: 1,
        chunkStartSec: 5,
        chunkEndSec: 10,
      }),
    ).rejects.toThrow(/revision conflict/i);

    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
      source: 'mic',
      sequence: 0,
      format: 'webm',
      data: Buffer.from('raw-webm'),
    });
    expect(raw.intervals[0].sources.mic.disposition).toBe('raw_durable');
    const rawDisposition = raw.intervals[0].sources.mic;
    if (rawDisposition.disposition !== 'raw_durable') throw new Error();
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: raw.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: rawDisposition.rawChecksumSha256,
      repairData: Buffer.from('repair-wav'),
    });
    expect(completed.manifest.intervals[0].sources.mic.disposition).toBe(
      'captured',
    );
    expect(completed.receipt).toMatchObject({
      generation: created.generation,
      manifestRevision: completed.manifest.revision,
      repairAudioRelativePath:
        'meeting-123/capture-journal/repair/mic-000000.wav',
    });
  });

  it('atomically appends and verifies transcript and acceptance sidecars', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
      source: 'mic',
      sequence: 0,
      format: 'wav',
      data: Buffer.from('raw'),
    });
    const rawDisposition = raw.intervals[0].sources.mic;
    if (rawDisposition.disposition !== 'raw_durable') throw new Error();
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: raw.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: rawDisposition.rawChecksumSha256,
      repairData: Buffer.from('wav'),
    });
    const sidecar = {
      schemaVersion: 1 as const,
      meetingId: created.meetingId,
      source: 'mic' as const,
      sequence: 0,
      chunkChecksumSha256: completed.receipt.checksumSha256,
      chunkStartSec: 0,
      chunkEndSec: 5,
      transcriptionConfig: {
        backend: 'parakeet',
        preset: 'balanced',
        model: 'parakeet-tdt-0.6b-v3',
        device: 'coreml',
        computeType: 'float16',
        languageMode: 'detected' as const,
        requestedLanguage: null,
        pipelineVersion: 'live_chunk_v1' as const,
      },
      backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
      segments: [],
    };
    const configKey = createHash('sha256')
      .update(
        canonicalizeTranscriptCheckpointConfig(sidecar.transcriptionConfig),
      )
      .digest('hex');
    await expect(
      appendCaptureTranscriptCheckpoint(root, {
        receipt: completed.receipt,
        expectedManifestRevision: completed.manifest.revision + 1,
        transcriptionConfigKey: configKey,
        sidecar,
      }),
    ).rejects.toThrow(/revision conflict/i);
    const checkpoint = await appendCaptureTranscriptCheckpoint(root, {
      receipt: completed.receipt,
      expectedManifestRevision: completed.manifest.revision,
      transcriptionConfigKey: configKey,
      sidecar,
    });
    const checkpointBytes = await readCaptureJournalSidecar(
      root,
      created.meetingId,
      checkpoint.checkpoint.relativePath,
      checkpoint.checkpoint.transcriptChecksumSha256,
    );
    expect(JSON.parse(checkpointBytes.toString())).toEqual(sidecar);

    const activityInputs = { chunkStartSec: 0, chunkEndSec: 5 };
    const digest = createHash('sha256')
      .update(JSON.stringify(activityInputs))
      .digest('hex');
    const frame = await appendCaptureTranscriptAcceptanceFrame(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: checkpoint.manifest.revision,
      sequence: 0,
      micCheckpointChecksumSha256:
        checkpoint.checkpoint.transcriptChecksumSha256,
      systemCheckpointChecksumSha256: null,
      activityEvidenceDigestSha256: digest,
      sidecar: {
        schemaVersion: 1,
        meetingId: created.meetingId,
        sequence: 0,
        arbitrationVersion: 'chunk_arbitration_v1',
        activityInputs,
        segments: [],
      },
    });

    expect(frame.manifest.acceptanceFrames).toEqual([frame.frame]);
    const promotedSidecar = {
      ...sidecar,
      transcriptionConfig: {
        ...sidecar.transcriptionConfig,
        model: 'parakeet-tdt-0.6b-v3',
      },
      segments: [{ start: 0.1, end: 0.2, text: 'synthetic validation' }],
    };
    const promotedConfigKey = createHash('sha256')
      .update(
        canonicalizeTranscriptCheckpointConfig(
          promotedSidecar.transcriptionConfig,
        ),
      )
      .digest('hex');
    const promotionRequest = {
      receipt: completed.receipt,
      expectedManifestRevision: frame.manifest.revision,
      expectedPriorTranscriptChecksumSha256:
        checkpoint.checkpoint.transcriptChecksumSha256,
      transcriptionConfigKey: promotedConfigKey,
      sidecar: promotedSidecar,
      expectedPriorAcceptedChecksumSha256: frame.frame.acceptedChecksumSha256,
      acceptance: {
        sequence: 0,
        micCheckpointChecksumSha256:
          checkpoint.checkpoint.transcriptChecksumSha256,
        systemCheckpointChecksumSha256: null,
        activityEvidenceDigestSha256: digest,
        sidecar: {
          schemaVersion: 1,
          meetingId: created.meetingId,
          sequence: 0,
          arbitrationVersion: 'chunk_arbitration_v1',
          activityInputs,
          segments: [
            {
              source: 'mic',
              start: 0.1,
              end: 0.2,
              text: 'synthetic validation',
            },
          ],
        },
      },
    };
    await expect(
      promoteCaptureTranscriptCheckpoint(root, {
        ...promotionRequest,
        acceptance: {
          ...promotionRequest.acceptance,
          sidecar: {
            ...promotionRequest.acceptance.sidecar,
            segments: [
              {
                source: 'mic' as const,
                start: 0.1,
                end: 0.2,
                text: 'synthetic mismatched evidence',
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/promotion evidence mismatch/i);
    expect(
      (await readCaptureJournalManifest(root, created.meetingId)).revision,
    ).toBe(frame.manifest.revision);

    const promotion = await promoteCaptureTranscriptCheckpoint(
      root,
      promotionRequest,
    );
    expect(promotion.checkpoint).toMatchObject({
      revision: 1,
      repairAttempted: true,
      transcriptionConfigKey: promotedConfigKey,
    });
    expect(promotion.frame).toMatchObject({
      revision: 1,
      micCheckpointChecksumSha256:
        promotion.checkpoint.transcriptChecksumSha256,
    });
  });

  it('migrates sealed v3 audio to authenticated v4 before deleting plaintext', async () => {
    const root = await makeRoot();
    const meetingKey = randomBytes(32);
    const created = await createCaptureJournal(root, {
      meetingId: 'historical',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
      source: 'mic',
      sequence: 0,
      format: 'webm',
      data: Buffer.from('historical-raw'),
    });
    const rawDisposition = raw.intervals[0].sources.mic;
    if (rawDisposition.disposition !== 'raw_durable') throw new Error();
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: raw.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: rawDisposition.rawChecksumSha256,
      repairData: Buffer.from('historical-repair'),
    });
    const evidence = await updateCaptureJournalActivityEvidence(root, {
      meetingId: created.meetingId,
      activityEvidence: await buildEvidence(),
    });
    if (evidence.schemaVersion !== 3) throw new Error('expected v3');
    const stopped = await stopCaptureJournal(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: evidence.revision,
    });
    const sealed = await sealCaptureJournal(root, {
      meetingId: created.meetingId,
      endedAtMs: 6_000,
    });
    if (sealed.schemaVersion !== 3) throw new Error('expected v3');
    const oldMic = completed.manifest.intervals[0].sources.mic;
    if (oldMic.disposition !== 'captured') throw new Error();
    const oldRawPath = join(root, oldMic.rawRelativePath);
    const oldRepairPath = join(root, oldMic.repairRelativePath);

    const result = await migrateSealedCaptureJournalToV4(root, {
      meetingId: created.meetingId,
      keyId: 'historical-key',
      meetingKey,
    });

    expect(result.status).toBe('migrated');
    expect(result.encryptedArtifacts).toBe(2);
    await expect(stat(oldRawPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(oldRepairPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const migrated = await readCaptureJournalManifest(root, 'historical', {
      meetingKey,
    });
    expect(migrated).toMatchObject({
      schemaVersion: 4,
      keyId: 'historical-key',
      generation: created.generation,
      lifecycleState: 'sealed',
    });
    if (migrated.schemaVersion !== 4) throw new Error('expected v4');
    const migratedMic = migrated.intervals[0].sources.mic;
    if (migratedMic.disposition !== 'captured') throw new Error();
    expect(
      await readCaptureJournalChunk(
        root,
        'historical',
        migratedMic.repairRelativePath,
        { meetingKey },
      ),
    ).toEqual(Buffer.from('historical-repair'));
    expect(stopped.lifecycleState).toBe('stopping');
  });

  it('rejects acceptance frames that are not linked to the current checkpoints or interval', async () => {
    const root = await makeRoot();
    const meetingId = 'meeting-invalid-acceptance';
    const created = await createCaptureJournal(root, {
      meetingId,
      startedAtMs: 1_000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
      source: 'mic',
      sequence: 0,
      format: 'wav',
      data: Buffer.from('raw'),
    });
    const rawDisposition = raw.intervals[0].sources.mic;
    if (rawDisposition.disposition !== 'raw_durable') throw new Error();
    const completed = await completeCaptureJournalCapturedChunk(root, {
      meetingId,
      generation: created.generation,
      expectedRevision: raw.revision,
      source: 'mic',
      sequence: 0,
      rawChecksumSha256: rawDisposition.rawChecksumSha256,
      repairData: Buffer.from('wav'),
    });
    const { receipt } = completed;
    const checkpointConfig = {
      backend: 'parakeet',
      preset: 'balanced',
      model: 'parakeet-tdt-0.6b-v3',
      device: 'coreml',
      computeType: 'float16',
      languageMode: 'detected' as const,
      requestedLanguage: null,
      pipelineVersion: 'live_chunk_v1' as const,
    };
    const checkpoint = await appendCaptureTranscriptCheckpoint(root, {
      receipt,
      expectedManifestRevision: completed.manifest.revision,
      transcriptionConfigKey: createHash('sha256')
        .update(canonicalizeTranscriptCheckpointConfig(checkpointConfig))
        .digest('hex'),
      sidecar: {
        schemaVersion: 1,
        meetingId,
        source: 'mic',
        sequence: 0,
        chunkChecksumSha256: receipt.checksumSha256,
        chunkStartSec: 0,
        chunkEndSec: 5,
        transcriptionConfig: checkpointConfig,
        backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
        segments: [],
      },
    });
    const activityInputs = { chunkStartSec: 0, chunkEndSec: 5 };
    const activityEvidenceDigestSha256 = createHash('sha256')
      .update(JSON.stringify(activityInputs))
      .digest('hex');

    await expect(
      appendCaptureTranscriptAcceptanceFrame(root, {
        meetingId,
        generation: checkpoint.manifest.generation,
        expectedRevision: checkpoint.manifest.revision,
        sequence: receipt.sequence,
        micCheckpointChecksumSha256: 'b'.repeat(64),
        systemCheckpointChecksumSha256: null,
        activityEvidenceDigestSha256,
        sidecar: {
          schemaVersion: 1,
          meetingId,
          sequence: receipt.sequence,
          arbitrationVersion: 'chunk_arbitration_v1',
          activityInputs,
          segments: [],
        },
      }),
    ).rejects.toThrow('checkpoint');

    await expect(
      appendCaptureTranscriptAcceptanceFrame(root, {
        meetingId,
        generation: checkpoint.manifest.generation,
        expectedRevision: checkpoint.manifest.revision,
        sequence: receipt.sequence,
        micCheckpointChecksumSha256:
          checkpoint.checkpoint.transcriptChecksumSha256,
        systemCheckpointChecksumSha256: null,
        activityEvidenceDigestSha256,
        sidecar: {
          schemaVersion: 1,
          meetingId,
          sequence: receipt.sequence,
          arbitrationVersion: 'chunk_arbitration_v1',
          activityInputs,
          segments: [
            {
              source: 'mic',
              start: receipt.chunkEndSec + 1,
              end: receipt.chunkEndSec + 2,
              text: 'outside interval',
            },
          ],
        },
      }),
    ).rejects.toThrow('segment');
  });

  it('resolves pending tuples at stopping and removes all artifacts on deletion', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
      sourceAvailability: { system: 'unavailable_at_start' },
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const stopped = await stopCaptureJournal(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
    });
    expect(stopped.intervals[0].sources).toEqual({
      mic: { disposition: 'missing', reason: 'pending_at_stop' },
      system: {
        disposition: 'source_unavailable',
        reason: 'unavailable_at_start',
      },
    });
    await deleteCaptureJournal(root, created.meetingId);
    await expect(
      stat(join(root, 'meeting-123', 'capture-journal')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('marks unsupplied system audio as missing with pending_at_stop when system source was available at start', async () => {
    const root = await makeRoot();
    const created = await createCaptureJournal(root, {
      meetingId: 'meeting-system-missing',
      startedAtMs: 1_000,
      schemaVersion: 3,
      sourceAvailability: { mic: 'available', system: 'available' },
    });
    if (created.schemaVersion !== 3) throw new Error('expected v3');
    const authorized = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
    });
    const stopped = await stopCaptureJournal(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: authorized.revision,
    });
    expect(stopped.intervals[0].sources.system).toEqual({
      disposition: 'missing',
      reason: 'pending_at_stop',
    });
    await deleteCaptureJournal(root, created.meetingId);
  });

  it('reads a legacy v1 manifest as uncertain evidence', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    const legacy = {
      schemaVersion: 1,
      meetingId: 'meeting-123',
      artifactRootRelativePath: 'meeting-123/capture-journal',
      manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
      lifecycleState: 'recording',
      startedAtMs: 1_000,
      endedAtMs: null,
      entries: [],
    };
    await writeFile(
      join(artifactRoot, 'manifest.json'),
      JSON.stringify(legacy),
    );

    expect(await readCaptureJournalManifest(root, 'meeting-123')).toEqual(
      legacy,
    );
  });

  it('rejects appending to a legacy v1 journal without changing disk state', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    const manifestPath = join(artifactRoot, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        meetingId: 'meeting-123',
        artifactRootRelativePath: 'meeting-123/capture-journal',
        manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
        lifecycleState: 'recording',
        startedAtMs: 1_000,
        endedAtMs: null,
        entries: [],
      }),
    );
    const before = await readFile(manifestPath, 'utf8');

    await expect(
      appendCaptureJournalChunk(root, {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: Buffer.from('mic-bytes'),
      }),
    ).rejects.toThrow(/legacy capture journal/i);

    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    expect(await readdir(artifactRoot)).toEqual(['manifest.json']);
  });

  it('rejects activity evidence updates to v1 without changing disk state', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    const manifestPath = join(artifactRoot, 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        meetingId: 'meeting-123',
        artifactRootRelativePath: 'meeting-123/capture-journal',
        manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
        lifecycleState: 'recording',
        startedAtMs: 1_000,
        endedAtMs: null,
        entries: [],
      }),
    );
    const before = await readFile(manifestPath, 'utf8');

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildEvidence(),
      }),
    ).rejects.toThrow(/legacy capture journal/i);

    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    expect(await readdir(artifactRoot)).toEqual(['manifest.json']);
  });

  it('durably persists canonical activity evidence', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const activityEvidence = await buildEvidence();
    const events: string[] = [];
    const durability = {
      syncFile: vi.fn(async (path: string) => events.push(`file:${path}`)),
      syncDirectory: vi.fn(async (path: string) =>
        events.push(`directory:${path}`),
      ),
    };

    const updated = await updateCaptureJournalActivityEvidence(
      root,
      { meetingId: 'meeting-123', activityEvidence },
      durability,
    );

    expect(updated.activityEvidence).toEqual(activityEvidence);
    expect(
      (await readCaptureJournalManifest(root, 'meeting-123')).activityEvidence,
    ).toEqual(activityEvidence);
    expect(events.map((event) => event.split(':')[0])).toEqual([
      'file',
      'directory',
    ]);
  });

  it('preserves both chunk and activity evidence across overlapping updates', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    let releaseChunkSync = () => undefined;
    const chunkSyncBlocked = new Promise<void>((resolve) => {
      releaseChunkSync = resolve;
    });
    let markChunkSyncStarted = () => undefined;
    const chunkSyncStarted = new Promise<void>((resolve) => {
      markChunkSyncStarted = resolve;
    });
    let markEvidenceWritten = () => undefined;
    const evidenceWritten = new Promise<void>((resolve) => {
      markEvidenceWritten = resolve;
    });
    const appendDurability = {
      syncFile: vi.fn(async (path: string) => {
        if (path.endsWith('mic-000000.wav.tmp')) {
          markChunkSyncStarted();
          await chunkSyncBlocked;
        }
      }),
      syncDirectory: vi.fn(async () => undefined),
    };
    const updateDurability = {
      syncFile: vi.fn(async () => undefined),
      syncDirectory: vi.fn(async () => markEvidenceWritten()),
    };

    const append = appendCaptureJournalChunk(
      root,
      {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: Buffer.from('mic-bytes'),
      },
      appendDurability,
    );
    await chunkSyncStarted;
    const activityEvidence = await buildEvidence();
    const update = updateCaptureJournalActivityEvidence(
      root,
      { meetingId: 'meeting-123', activityEvidence },
      updateDurability,
    );

    await Promise.race([
      evidenceWritten,
      new Promise<void>((resolve) => setTimeout(resolve, 25)),
    ]);
    releaseChunkSync();
    await Promise.all([append, update]);

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.activityEvidence).toEqual(activityEvidence);
  });

  it('treats identical activity evidence snapshots as idempotent', async () => {
    const root = await makeRoot();
    const activityEvidence = await buildEvidence();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence,
    });
    const durability = {
      syncFile: vi.fn(async () => undefined),
      syncDirectory: vi.fn(async () => undefined),
    };

    const duplicate = await updateCaptureJournalActivityEvidence(
      root,
      { meetingId: 'meeting-123', activityEvidence },
      durability,
    );

    expect(duplicate.activityEvidence).toEqual(activityEvidence);
    expect(durability.syncFile).not.toHaveBeenCalled();
  });

  it('rejects activity evidence snapshots older than the persisted final window', async () => {
    const root = await makeRoot();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildEvidence(10),
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildEvidence(5),
      }),
    ).rejects.toThrow(/older activity evidence snapshot/i);
  });

  it('rejects conflicting activity evidence with the same window count', async () => {
    const root = await makeRoot();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildEvidence(5),
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildEvidence(6),
      }),
    ).rejects.toThrow(/conflicting activity evidence snapshot/i);
  });

  it('rejects a longer snapshot that rewrites persisted windows', async () => {
    const root = await makeRoot();
    const stored = await buildEvidence(5);
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: stored,
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildCaptureActivityEvidence(
          [
            { startTime: 0, endTime: 4, speaker: 'Them' },
            { startTime: 4, endTime: 8, speaker: 'Me' },
          ],
          {
            clock: stored.clock,
            thresholds: stored.thresholds,
            algorithmVersion: stored.algorithmVersion,
          },
        ),
      }),
    ).rejects.toThrow(/conflicting activity evidence snapshot/i);
  });

  it('rejects a longer snapshot that changes producer metadata', async () => {
    const root = await makeRoot();
    const stored = await buildEvidence(5);
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: stored,
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildCaptureActivityEvidence(
          [...stored.windows, { startTime: 5, endTime: 8, speaker: 'Them' }],
          {
            clock: stored.clock,
            thresholds: {
              ...stored.thresholds,
              rms: stored.thresholds.rms + 1,
            },
            algorithmVersion: stored.algorithmVersion,
          },
        ),
      }),
    ).rejects.toThrow(/conflicting activity evidence snapshot/i);
  });

  it('rejects activity evidence snapshots with fewer windows even when they end later', async () => {
    const root = await makeRoot();
    const producer = {
      clock: {
        kind: 'meeting_relative_seconds' as const,
        origin: 'recording_start' as const,
      },
      thresholds: {
        rms: 0.01,
        dominanceRatio: 1.5,
        minimumSwitchIntervalMs: 250,
      },
      algorithmVersion: 'speaker_activity_v1' as const,
    };
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence: await buildCaptureActivityEvidence(
        [
          { startTime: 0, endTime: 5, speaker: 'Me' },
          { startTime: 5, endTime: 10, speaker: 'Me' },
        ],
        producer,
      ),
    });

    await expect(
      updateCaptureJournalActivityEvidence(root, {
        meetingId: 'meeting-123',
        activityEvidence: await buildCaptureActivityEvidence(
          [{ startTime: 0, endTime: 12, speaker: 'Me' }],
          producer,
        ),
      }),
    ).rejects.toThrow(/older activity evidence snapshot/i);
  });

  it.each([
    '..',
    '.',
    '../escaped',
    'nested/meeting',
    'nested\\meeting',
    'bad\0id',
  ])(
    'rejects unsafe meeting ID %j before filesystem mutation',
    async (meetingId) => {
      const root = await makeRoot();

      await expect(
        createCaptureJournal(root, { meetingId, startedAtMs: 1_000 }),
      ).rejects.toThrow(/invalid capture journal meeting id/i);

      expect(await readdir(root)).toEqual([]);
    },
  );

  it.each<[string, (manifest: Record<string, unknown>) => void]>([
    [
      'meeting identity',
      (manifest) => {
        manifest.meetingId = 'meeting-other';
      },
    ],
    [
      'artifact root',
      (manifest) => {
        manifest.artifactRootRelativePath = '../outside';
      },
    ],
    [
      'manifest path',
      (manifest) => {
        manifest.manifestRelativePath = '../manifest.json';
      },
    ],
  ])('rejects a non-canonical manifest %s', async (_label, mutate) => {
    const root = await makeRoot();
    await mutateManifest(root, mutate);

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow(/invalid capture journal manifest/i);
  });

  it('rejects a chunk entry whose path is not canonical for its metadata', async () => {
    const root = await makeRoot();
    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 2,
      chunkStartSec: 0,
      chunkEndSec: 1,
      format: 'audio/wav',
      data: Buffer.from('mic'),
    });
    const manifestPath = join(root, manifest.manifestRelativePath);
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      entries: Array<{ relativePath: string }>;
    };
    parsed.entries[0].relativePath = '../sentinel.wav';
    await writeFile(manifestPath, JSON.stringify(parsed));

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow(/invalid capture journal manifest entry path/i);
  });

  it('appends chunks with stable relative paths and checksum metadata', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });

    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: Buffer.from('mic-bytes'),
    });

    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      byteCount: 9,
      relativePath: 'meeting-123/capture-journal/chunks/mic-000000.wav',
    });
    expect(manifest.entries[0].checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    const fileStats = await stat(join(root, manifest.entries[0].relativePath));
    expect(fileStats.size).toBe(9);
  });

  it('syncs chunk and manifest files plus their directories before acknowledging append', async () => {
    const root = await makeRoot();
    const events: string[] = [];
    const durability = {
      syncFile: vi.fn(async (path: string) => {
        events.push(`file:${path.slice(root.length + 1)}`);
      }),
      syncDirectory: vi.fn(async (path: string) => {
        events.push(`directory:${path.slice(root.length + 1)}`);
      }),
    };
    await createCaptureJournal(
      root,
      { meetingId: 'meeting-123', startedAtMs: 1_000 },
      durability,
    );
    events.length = 0;

    await appendCaptureJournalChunk(
      root,
      {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: Buffer.from('mic-bytes'),
      },
      durability,
    );

    expect(events).toEqual([
      'file:meeting-123/capture-journal/chunks/mic-000000.wav.tmp',
      'directory:meeting-123/capture-journal/chunks',
      'file:meeting-123/capture-journal/manifest.json.tmp',
      'directory:meeting-123/capture-journal',
    ]);
  });

  it('rejects append when stable-storage sync fails', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const durability = {
      syncFile: vi.fn(async () => {
        throw new Error('synthetic sync failure');
      }),
      syncDirectory: vi.fn(async () => undefined),
    };

    await expect(
      appendCaptureJournalChunk(
        root,
        {
          meetingId: 'meeting-123',
          source: 'mic',
          sequence: 0,
          chunkStartSec: 0,
          chunkEndSec: 5,
          format: 'wav',
          data: Buffer.from('mic-bytes'),
        },
        durability,
      ),
    ).rejects.toThrow('synthetic sync failure');

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    expect(manifest.entries).toEqual([]);
    expect(durability.syncDirectory).not.toHaveBeenCalled();
  });

  it('treats duplicate appends as idempotent', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });

    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'system',
      sequence: 2,
      chunkStartSec: 10,
      chunkEndSec: 15,
      format: 'wav',
      data: Buffer.from('system-bytes'),
    });
    const manifest = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'system',
      sequence: 2,
      chunkStartSec: 10,
      chunkEndSec: 15,
      format: 'wav',
      data: Buffer.from('system-bytes'),
    });

    expect(manifest.entries).toHaveLength(1);
  });

  it('rejects duplicate delivery when the stored chunk checksum changed', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    const original = Buffer.from('mic-bytes');
    const appended = await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: original,
    });
    await writeFile(
      join(root, appended.entries[0].relativePath),
      Buffer.from('bad-bytes'),
    );

    await expect(
      appendCaptureJournalChunk(root, {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: original,
      }),
    ).rejects.toThrow(/artifact checksum mismatch/i);

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    expect(manifest.entries).toHaveLength(1);
  });

  it('seals the journal and blocks later mutation', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: Buffer.from('mic-bytes'),
    });
    const activityEvidence = await buildEvidence();
    await updateCaptureJournalActivityEvidence(root, {
      meetingId: 'meeting-123',
      activityEvidence,
    });

    const sealed = await sealCaptureJournal(root, {
      meetingId: 'meeting-123',
      endedAtMs: 6_000,
    });

    expect(sealed.lifecycleState).toBe('sealed');
    expect(sealed.endedAtMs).toBe(6_000);
    expect(sealed.schemaVersion).toBe(2);
    expect(sealed.activityEvidence).toEqual(activityEvidence);
    expect(await readCaptureJournalManifest(root, 'meeting-123')).toEqual(
      sealed,
    );

    await expect(
      appendCaptureJournalChunk(root, {
        meetingId: 'meeting-123',
        source: 'mic',
        sequence: 1,
        chunkStartSec: 5,
        chunkEndSec: 10,
        format: 'wav',
        data: Buffer.from('later-bytes'),
      }),
    ).rejects.toThrow(/sealed/i);
  });

  it('rejects sealing a legacy v1 journal', async () => {
    const root = await makeRoot();
    const artifactRoot = join(root, 'meeting-123', 'capture-journal');
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      join(artifactRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        meetingId: 'meeting-123',
        artifactRootRelativePath: 'meeting-123/capture-journal',
        manifestRelativePath: 'meeting-123/capture-journal/manifest.json',
        lifecycleState: 'recording',
        startedAtMs: 1_000,
        endedAtMs: null,
        entries: [],
      }),
    );

    await expect(
      sealCaptureJournal(root, {
        meetingId: 'meeting-123',
        endedAtMs: 6_000,
      }),
    ).rejects.toThrow(/legacy capture journal/i);
  });

  it('rejects a sealed v2 manifest without activity evidence', async () => {
    const root = await makeRoot();
    await mutateManifest(root, (manifest) => {
      manifest.lifecycleState = 'sealed';
      manifest.endedAtMs = 6_000;
    });

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow('capture_activity_missing');
  });

  it('rejects sealing a recording v3 journal before stopping', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
      schemaVersion: 3,
    });

    await expect(
      sealCaptureJournal(root, {
        meetingId: 'meeting-123',
        endedAtMs: 6_000,
      }),
    ).rejects.toThrow(/must enter stopping/i);
  });

  it.each([
    [
      'malformed',
      (evidence: Record<string, unknown>) => {
        evidence.clock = undefined;
      },
    ],
    [
      'unsupported',
      (evidence: Record<string, unknown>) => {
        evidence.schemaVersion = 999;
      },
    ],
    [
      'digest_mismatch',
      (evidence: Record<string, unknown>) => {
        evidence.digestSha256 = '0'.repeat(64);
      },
    ],
  ])('rejects v2 activity evidence with %s reason', async (reason, mutate) => {
    const root = await makeRoot();
    const evidence = (await buildEvidence()) as unknown as Record<
      string,
      unknown
    >;
    mutate(evidence);
    await mutateManifest(root, (manifest) => {
      manifest.activityEvidence = evidence;
    });

    await expect(
      readCaptureJournalManifest(root, 'meeting-123'),
    ).rejects.toThrow(String(reason));
  });

  it('persists the manifest as JSON for later recovery work', async () => {
    const root = await makeRoot();
    await createCaptureJournal(root, {
      meetingId: 'meeting-123',
      startedAtMs: 1_000,
    });
    await appendCaptureJournalChunk(root, {
      meetingId: 'meeting-123',
      source: 'mic',
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 5,
      format: 'wav',
      data: Buffer.from('mic-bytes'),
    });

    const manifest = await readCaptureJournalManifest(root, 'meeting-123');
    const manifestJson = JSON.parse(
      await readFile(
        join(root, manifest.artifactRootRelativePath, 'manifest.json'),
        'utf8',
      ),
    );

    expect(manifestJson).toEqual(manifest);
  });

  describe('schema v4 encrypted capture journal', () => {
    it('requires an encryption key to create a v4 journal', async () => {
      const root = await makeRoot();
      setCaptureJournalAudioKeyProvider(null);
      await expect(
        createCaptureJournal(root, {
          meetingId: 'meeting-v4-nokey',
          startedAtMs: 1_000,
          schemaVersion: 4,
        }),
      ).rejects.toThrow('audio_key_unavailable');
    });

    it('creates a v4 journal with plaintext locator and encrypted manifest.enc', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      const manifest = await createCaptureJournal(root, {
        meetingId: 'meeting-v4-basic',
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      });

      expect(manifest.schemaVersion).toBe(4);
      expect(manifest.lifecycleState).toBe('recording');

      // Check on disk: manifest.json is a locator
      const locatorRaw = await readFile(
        join(root, manifest.artifactRootRelativePath, 'manifest.json'),
        'utf8',
      );
      const locator = JSON.parse(locatorRaw);
      expect(locator.schemaVersion).toBe(4);
      expect(locator.envelopeVersion).toBe(1);
      expect(locator.encryptedManifestRelativePath).toBe(
        'meeting-v4-basic/capture-journal/manifest.enc',
      );
      expect(locator.ciphertextSha256).toBeDefined();

      // manifest.enc exists
      const encStat = await stat(
        join(root, locator.encryptedManifestRelativePath),
      );
      expect(encStat.size).toBeGreaterThan(0);

      // Reading without key fails
      setCaptureJournalAudioKeyProvider(null);
      await expect(
        readCaptureJournalManifest(root, 'meeting-v4-basic'),
      ).rejects.toThrow('audio_key_unavailable');

      // Reading with wrong key fails (decryption error)
      const wrongKey = randomBytes(32);
      await expect(
        readCaptureJournalManifest(root, 'meeting-v4-basic', {
          meetingKey: wrongKey,
        }),
      ).rejects.toThrow();

      // Reading with correct key succeeds
      const readManifest = await readCaptureJournalManifest(
        root,
        'meeting-v4-basic',
        { meetingKey },
      );
      expect(readManifest.meetingId).toBe('meeting-v4-basic');
      expect(readManifest.schemaVersion).toBe(4);
    });

    it('appends and reads encrypted chunks with opaque filenames', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      await createCaptureJournal(root, {
        meetingId: 'meeting-v4-chunks',
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      });

      const audioData = Buffer.from('v4-secret-audio-payload-12345');
      const updated = await appendCaptureJournalChunk(root, {
        meetingId: 'meeting-v4-chunks',
        source: 'mic',
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        format: 'wav',
        data: audioData,
        meetingKey,
      });

      expect(updated.entries).toHaveLength(1);
      const entry = updated.entries[0];
      expect(entry.relativePath).toMatch(
        /meeting-v4-chunks\/capture-journal\/chunks\/[a-f0-9-]+\.enc$/,
      );
      expect(entry.ciphertextSha256).toBeDefined();

      // Ensure ciphertext on disk does not contain plaintext string
      const rawDiskBytes = await readFile(join(root, entry.relativePath));
      expect(rawDiskBytes.includes(audioData)).toBe(false);

      // Read chunk decrypted
      const decrypted = await readCaptureJournalChunk(
        root,
        'meeting-v4-chunks',
        entry.relativePath,
        { meetingKey },
      );
      expect(decrypted.equals(audioData)).toBe(true);

      // Read chunk with wrong key throws
      await expect(
        readCaptureJournalChunk(root, 'meeting-v4-chunks', entry.relativePath, {
          meetingKey: randomBytes(32),
        }),
      ).rejects.toThrow();
    });

    it('rejects plaintext repairPath in v4 and requires in-memory repairData', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      const manifest = (await createCaptureJournal(root, {
        meetingId: 'meeting-v4-repair',
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      })) as any;

      await authorizeCaptureJournalInterval(root, {
        meetingId: 'meeting-v4-repair',
        generation: manifest.generation,
        expectedRevision: 0,
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        meetingKey,
      });

      const rawData = Buffer.from('raw-audio-stream-data');
      await persistCaptureJournalRawChunk(root, {
        meetingId: 'meeting-v4-repair',
        generation: manifest.generation,
        expectedRevision: 1,
        source: 'mic',
        sequence: 0,
        format: 'wav',
        data: rawData,
        meetingKey,
      });

      const rawChecksum = createHash('sha256').update(rawData).digest('hex');

      // Attempting to complete with repairPath must throw
      await expect(
        completeCaptureJournalCapturedChunk(root, {
          meetingId: 'meeting-v4-repair',
          generation: manifest.generation,
          expectedRevision: 2,
          source: 'mic',
          sequence: 0,
          rawChecksumSha256: rawChecksum,
          repairPath: join(root, 'some-plaintext-file.wav'),
          meetingKey,
        }),
      ).rejects.toThrow(
        'Capture journal v4 does not permit plaintext repairPath',
      );

      // Completing with in-memory repairData succeeds
      const repairData = Buffer.from('repaired-flac-or-wav-audio');
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId: 'meeting-v4-repair',
        generation: manifest.generation,
        expectedRevision: 2,
        source: 'mic',
        sequence: 0,
        rawChecksumSha256: rawChecksum,
        repairData,
        meetingKey,
      });

      const completedInterval = completed.manifest.intervals.find(
        (i) => i.sequence === 0,
      );
      const micSource = completedInterval?.sources.mic;
      expect(micSource?.disposition).toBe('captured');
      if (micSource && micSource.disposition === 'captured') {
        expect(micSource.repairRelativePath).toMatch(
          /repair\/[a-f0-9-]+\.enc$/,
        );

        // Read decrypted repair chunk
        const decryptedRepair = await readCaptureJournalChunk(
          root,
          'meeting-v4-repair',
          micSource.repairRelativePath,
          { meetingKey },
        );
        expect(decryptedRepair.equals(repairData)).toBe(true);
      }
    });

    it('records sticky failure on manifest and prevents sealing', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      await createCaptureJournal(root, {
        meetingId: 'meeting-v4-sticky',
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      });

      const failedManifest = await recordCaptureJournalStickyFailure(root, {
        meetingId: 'meeting-v4-sticky',
        code: 'authentication_failed',
        reason: 'Decryption authentication tag verification failed',
        meetingKey,
      });

      expect(failedManifest.stickyFailure).toBeDefined();
      expect(failedManifest.stickyFailure?.message).toBe(
        'Decryption authentication tag verification failed',
      );
      expect(failedManifest.stickyFailure?.code).toBe('authentication_failed');

      // Attempting to seal must fail
      await expect(
        sealCaptureJournal(root, {
          meetingId: 'meeting-v4-sticky',
          endedAtMs: 5_000,
          meetingKey,
        }),
      ).rejects.toThrow('Cannot seal capture journal: sticky failure recorded');
    });

    it('encrypts transcript checkpoint and acceptance frame sidecars in v4 journals', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      const meetingId = 'meeting-v4-sidecars';
      const created = (await createCaptureJournal(root, {
        meetingId,
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      })) as any;

      await authorizeCaptureJournalInterval(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 0,
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        meetingKey,
      });

      const rawData = Buffer.from('v4-mic-audio-raw');
      await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 1,
        source: 'mic',
        sequence: 0,
        format: 'wav',
        data: rawData,
        meetingKey,
      });

      const rawChecksum = createHash('sha256').update(rawData).digest('hex');
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 2,
        source: 'mic',
        sequence: 0,
        rawChecksumSha256: rawChecksum,
        repairData: Buffer.from('v4-mic-audio-repair'),
        meetingKey,
      });

      const checkpointSidecar = {
        schemaVersion: 1 as const,
        meetingId,
        source: 'mic' as const,
        sequence: 0,
        chunkChecksumSha256: completed.receipt.checksumSha256,
        chunkStartSec: 0,
        chunkEndSec: 5,
        transcriptionConfig: {
          backend: 'parakeet',
          preset: 'fast',
          model: 'parakeet-tdt-0.6b-v3',
          device: 'coreml',
          computeType: 'float16',
          languageMode: 'detected' as const,
          requestedLanguage: null,
          pipelineVersion: 'live_chunk_v1' as const,
        },
        backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
        segments: [
          { start: 0.5, end: 2.5, text: 'confidential transcript text' },
        ],
      };
      const configKey = createHash('sha256')
        .update(
          canonicalizeTranscriptCheckpointConfig(
            checkpointSidecar.transcriptionConfig,
          ),
        )
        .digest('hex');

      const checkpointResult = await appendCaptureTranscriptCheckpoint(root, {
        receipt: completed.receipt,
        expectedManifestRevision: completed.manifest.revision,
        transcriptionConfigKey: configKey,
        sidecar: checkpointSidecar,
        meetingKey,
      });

      expect(checkpointResult.checkpoint.relativePath).toMatch(
        /transcript-checkpoints\/mic-000000-r0\.enc$/,
      );

      // Verify on disk: starts with PENC and does NOT contain plaintext
      const checkpointDiskBytes = await readFile(
        join(root, checkpointResult.checkpoint.relativePath),
      );
      expect(checkpointDiskBytes.subarray(0, 4)).toEqual(ENVELOPE_MAGIC);
      expect(
        checkpointDiskBytes.includes(
          Buffer.from('confidential transcript text'),
        ),
      ).toBe(false);

      // Decrypt cleanly via readCaptureJournalSidecar
      const decryptedCheckpointBytes = await readCaptureJournalSidecar(
        root,
        meetingId,
        checkpointResult.checkpoint.relativePath,
        checkpointResult.checkpoint.transcriptChecksumSha256,
        { meetingKey },
      );
      expect(JSON.parse(decryptedCheckpointBytes.toString('utf8'))).toEqual(
        checkpointSidecar,
      );

      // Reading with wrong key fails
      await expect(
        readCaptureJournalSidecar(
          root,
          meetingId,
          checkpointResult.checkpoint.relativePath,
          checkpointResult.checkpoint.transcriptChecksumSha256,
          { meetingKey: randomBytes(32) },
        ),
      ).rejects.toThrow();

      // Append acceptance frame sidecar
      const activityInputs = { chunkStartSec: 0, chunkEndSec: 5 };
      const digest = createHash('sha256')
        .update(JSON.stringify(activityInputs))
        .digest('hex');

      const acceptanceSidecar = {
        schemaVersion: 1 as const,
        meetingId,
        sequence: 0,
        arbitrationVersion: 'chunk_arbitration_v1' as const,
        activityInputs,
        segments: [
          {
            source: 'mic' as const,
            start: 0.5,
            end: 2.5,
            text: 'confidential accepted text',
          },
        ],
      };

      const frameResult = await appendCaptureTranscriptAcceptanceFrame(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: checkpointResult.manifest.revision,
        sequence: 0,
        micCheckpointChecksumSha256:
          checkpointResult.checkpoint.transcriptChecksumSha256,
        systemCheckpointChecksumSha256: null,
        activityEvidenceDigestSha256: digest,
        sidecar: acceptanceSidecar,
        meetingKey,
      });

      expect(frameResult.frame.relativePath).toMatch(
        /acceptance-frames\/000000\.enc$/,
      );

      // Verify on disk: starts with PENC and does NOT contain plaintext
      const frameDiskBytes = await readFile(
        join(root, frameResult.frame.relativePath),
      );
      expect(frameDiskBytes.subarray(0, 4)).toEqual(ENVELOPE_MAGIC);
      expect(
        frameDiskBytes.includes(Buffer.from('confidential accepted text')),
      ).toBe(false);

      // Decrypt cleanly via readCaptureJournalSidecar
      const decryptedFrameBytes = await readCaptureJournalSidecar(
        root,
        meetingId,
        frameResult.frame.relativePath,
        frameResult.frame.acceptedChecksumSha256,
        { meetingKey },
      );
      expect(JSON.parse(decryptedFrameBytes.toString('utf8'))).toEqual(
        acceptanceSidecar,
      );

      // Test idempotency: calling appendCaptureTranscriptAcceptanceFrame again returns existing
      const idempotentFrame = await appendCaptureTranscriptAcceptanceFrame(
        root,
        {
          meetingId,
          generation: created.generation,
          expectedRevision: frameResult.manifest.revision,
          sequence: 0,
          micCheckpointChecksumSha256:
            checkpointResult.checkpoint.transcriptChecksumSha256,
          systemCheckpointChecksumSha256: null,
          activityEvidenceDigestSha256: digest,
          sidecar: acceptanceSidecar,
          meetingKey,
        },
      );
      expect(idempotentFrame.frame.relativePath).toBe(
        frameResult.frame.relativePath,
      );

      // Promote transcript checkpoint
      const promotedSidecar = {
        ...checkpointSidecar,
        transcriptionConfig: {
          ...checkpointSidecar.transcriptionConfig,
          model: 'parakeet-tdt-0.6b-v3',
        },
        segments: [
          { start: 0.5, end: 2.5, text: 'promoted confidential text' },
        ],
      };
      const promotedConfigKey = createHash('sha256')
        .update(
          canonicalizeTranscriptCheckpointConfig(
            promotedSidecar.transcriptionConfig,
          ),
        )
        .digest('hex');

      const promotedResult = await promoteCaptureTranscriptCheckpoint(root, {
        receipt: completed.receipt,
        expectedManifestRevision: frameResult.manifest.revision,
        expectedPriorTranscriptChecksumSha256:
          checkpointResult.checkpoint.transcriptChecksumSha256,
        transcriptionConfigKey: promotedConfigKey,
        sidecar: promotedSidecar,
        expectedPriorAcceptedChecksumSha256:
          frameResult.frame.acceptedChecksumSha256,
        acceptance: {
          sequence: 0,
          micCheckpointChecksumSha256:
            checkpointResult.checkpoint.transcriptChecksumSha256,
          systemCheckpointChecksumSha256: null,
          activityEvidenceDigestSha256: digest,
          sidecar: {
            schemaVersion: 1,
            meetingId,
            sequence: 0,
            arbitrationVersion: 'chunk_arbitration_v1',
            activityInputs,
            segments: [
              {
                source: 'mic',
                start: 0.5,
                end: 2.5,
                text: 'promoted confidential text',
              },
            ],
          },
        },
        meetingKey,
      });

      expect(promotedResult.checkpoint.relativePath).toMatch(
        /transcript-checkpoints\/mic-000000-r1\.enc$/,
      );
      expect(promotedResult.frame.relativePath).toMatch(
        /acceptance-frames\/000000-r1\.enc$/,
      );

      // Both promoted files are encrypted envelopes
      const promotedCheckpointDisk = await readFile(
        join(root, promotedResult.checkpoint.relativePath),
      );
      expect(promotedCheckpointDisk.subarray(0, 4)).toEqual(ENVELOPE_MAGIC);
      expect(
        promotedCheckpointDisk.includes(
          Buffer.from('promoted confidential text'),
        ),
      ).toBe(false);

      const promotedFrameDisk = await readFile(
        join(root, promotedResult.frame.relativePath),
      );
      expect(promotedFrameDisk.subarray(0, 4)).toEqual(ENVELOPE_MAGIC);
      expect(
        promotedFrameDisk.includes(Buffer.from('promoted confidential text')),
      ).toBe(false);

      // Decrypt promoted sidecars
      const decryptedPromotedCheckpoint = await readCaptureJournalSidecar(
        root,
        meetingId,
        promotedResult.checkpoint.relativePath,
        promotedResult.checkpoint.transcriptChecksumSha256,
        { meetingKey },
      );
      expect(JSON.parse(decryptedPromotedCheckpoint.toString('utf8'))).toEqual(
        promotedSidecar,
      );

      // Tampering detection: modify byte in encrypted checkpoint
      const tamperedBytes = Buffer.from(promotedCheckpointDisk);
      tamperedBytes[tamperedBytes.length - 1] ^= 0xff;
      await writeFile(
        join(root, promotedResult.checkpoint.relativePath),
        tamperedBytes,
      );
      await expect(
        readCaptureJournalSidecar(
          root,
          meetingId,
          promotedResult.checkpoint.relativePath,
          promotedResult.checkpoint.transcriptChecksumSha256,
          { meetingKey },
        ),
      ).rejects.toThrow();
    });

    it('rejects plaintext sidecar in schema 4 journals', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      const meetingId = 'meeting-v4-plaintext-rejection';
      const created = (await createCaptureJournal(root, {
        meetingId,
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      })) as any;

      await authorizeCaptureJournalInterval(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 0,
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        meetingKey,
      });

      const rawData = Buffer.from('v4-mic-audio-raw');
      await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 1,
        source: 'mic',
        sequence: 0,
        format: 'wav',
        data: rawData,
        meetingKey,
      });

      const rawChecksum = createHash('sha256').update(rawData).digest('hex');
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 2,
        source: 'mic',
        sequence: 0,
        rawChecksumSha256: rawChecksum,
        repairData: Buffer.from('v4-mic-audio-repair'),
        meetingKey,
      });

      const checkpointSidecar = {
        schemaVersion: 1 as const,
        meetingId,
        source: 'mic' as const,
        sequence: 0,
        chunkChecksumSha256: completed.receipt.checksumSha256,
        chunkStartSec: 0,
        chunkEndSec: 5,
        transcriptionConfig: {
          backend: 'parakeet',
          preset: 'fast',
          model: 'parakeet-tdt-0.6b-v3',
          device: 'coreml',
          computeType: 'float16',
          languageMode: 'detected' as const,
          requestedLanguage: null,
          pipelineVersion: 'live_chunk_v1' as const,
        },
        backendResult: { detectedLanguage: 'en', providerLabel: 'local' },
        segments: [
          { start: 0.5, end: 2.5, text: 'confidential transcript text' },
        ],
      };
      const configKey = createHash('sha256')
        .update(
          canonicalizeTranscriptCheckpointConfig(
            checkpointSidecar.transcriptionConfig,
          ),
        )
        .digest('hex');

      // Append a valid sidecar first
      const checkpointRes = await appendCaptureTranscriptCheckpoint(root, {
        receipt: completed.receipt,
        expectedManifestRevision: completed.manifest.revision,
        transcriptionConfigKey: configKey,
        sidecar: checkpointSidecar,
        meetingKey,
      });

      // Overwrite the sidecar with unencrypted plaintext JSON on disk
      const sidecarAbsPath = join(root, checkpointRes.checkpoint.relativePath);
      const plaintextJson = Buffer.from(
        JSON.stringify({ text: 'plaintext sidecar' }),
      );
      const plaintextChecksum = createHash('sha256')
        .update(plaintextJson)
        .digest('hex');
      await writeFile(sidecarAbsPath, plaintextJson);

      // Mutate the encrypted manifest so the checkpoint has the plaintext checksum
      const manifest = (await readCaptureJournalManifest(root, meetingId, {
        meetingKey,
      })) as any;
      manifest.transcriptCheckpoints[0].transcriptChecksumSha256 =
        plaintextChecksum;
      const manifestEncPath = join(
        root,
        `${manifest.artifactRootRelativePath}/manifest.enc`,
      );
      const writeResult = await EncryptedArtifactStore.writeEncryptedFile(
        manifestEncPath,
        Buffer.from(JSON.stringify(manifest, null, 2)),
        meetingKey,
        {
          keyId: manifest.keyId,
          meetingId,
          generation: manifest.generation,
          artifactKind: 'manifest',
          source: 'none',
          sequence: manifest.revision,
        },
      );
      const locatorPath = join(
        root,
        `${manifest.artifactRootRelativePath}/manifest.json`,
      );
      const locator = JSON.parse(
        (await readFile(locatorPath)).toString('utf8'),
      );
      locator.manifestCiphertextSha256 = writeResult.ciphertextSha256;
      await writeFile(locatorPath, JSON.stringify(locator, null, 2));

      // Now readCaptureJournalSidecar should pass checksum check but reject because schema 4 requires encrypted envelopes
      await expect(
        readCaptureJournalSidecar(
          root,
          meetingId,
          checkpointRes.checkpoint.relativePath,
          plaintextChecksum,
          { meetingKey },
        ),
      ).rejects.toThrow(/schema 4 sidecars must be encrypted envelopes/);
    });

    it('fails closed when sealing sidecar without meetingKey in v4', async () => {
      const root = await makeRoot();
      const meetingKey = randomBytes(32);
      const meetingId = 'meeting-v4-no-key';
      const created = (await createCaptureJournal(root, {
        meetingId,
        startedAtMs: 1_000,
        schemaVersion: 4,
        meetingKey,
      })) as any;

      await authorizeCaptureJournalInterval(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 0,
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 5,
        meetingKey,
      });

      const rawData = Buffer.from('v4-mic-audio-raw');
      await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 1,
        source: 'mic',
        sequence: 0,
        format: 'wav',
        data: rawData,
        meetingKey,
      });

      const rawChecksum = createHash('sha256').update(rawData).digest('hex');
      const completed = await completeCaptureJournalCapturedChunk(root, {
        meetingId,
        generation: created.generation,
        expectedRevision: 2,
        source: 'mic',
        sequence: 0,
        rawChecksumSha256: rawChecksum,
        repairData: Buffer.from('v4-mic-audio-repair'),
        meetingKey,
      });

      await expect(
        appendCaptureTranscriptCheckpoint(root, {
          receipt: completed.receipt,
          expectedManifestRevision: completed.manifest.revision,
          transcriptionConfigKey: 'default',
          sidecar: {
            text: 'test',
            transcriptionConfig: { model: 'parakeet' },
          },
          meetingKey: null as any,
        }),
      ).rejects.toThrow(/audio_key_/);
    });
  });
});
