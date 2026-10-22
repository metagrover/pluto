import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  authorizeCaptureJournalInterval,
  createCaptureJournal,
  persistCaptureJournalRawChunk,
  readCaptureJournalManifest,
  sealCaptureJournal,
  stopCaptureJournal,
  updateCaptureJournalActivityEvidence,
} from '../../electron/captureJournal';
import { recoverInterruptedCaptureJournals } from '../../electron/captureJournalRecovery';
import { buildCaptureActivityEvidence } from '../../src/utils/transcriptActivityEvidence';

it.each([true, false])(
  'repairs stopped durable raw before seal (decode succeeds=%s)',
  async (succeeds) => {
    const root = await mkdtemp(join(tmpdir(), 'pluto-tail-recovery-'));
    try {
      const meetingId = 'stopped-tail';
      let manifest = await createCaptureJournal(root, {
        meetingId,
        startedAtMs: 1000,
        schemaVersion: 3,
        expectedSources: ['mic'],
      });
      manifest = await authorizeCaptureJournalInterval(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        sequence: 0,
        chunkStartSec: 0,
        chunkEndSec: 0.061,
      });
      manifest = await persistCaptureJournalRawChunk(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
        source: 'mic',
        sequence: 0,
        format: 'webm',
        data: Buffer.from('preserved-encoded-tail'),
      });
      const raw = manifest.intervals[0].sources.mic;
      if (raw.disposition !== 'raw_durable') throw new Error('expected raw');
      await updateCaptureJournalActivityEvidence(root, {
        meetingId,
        activityEvidence: await buildCaptureActivityEvidence([], {
          clock: {
            kind: 'meeting_relative_seconds',
            origin: 'recording_start',
          },
          thresholds: {
            rms: 0.02,
            dominanceRatio: 1.4,
            minimumSwitchIntervalMs: 250,
          },
          algorithmVersion: 'speaker_activity_v1',
        }),
      });
      manifest = (await readCaptureJournalManifest(
        root,
        meetingId,
      )) as typeof manifest;
      await stopCaptureJournal(root, {
        meetingId,
        generation: manifest.generation,
        expectedRevision: manifest.revision,
      });
      const repair = vi.fn(async () =>
        succeeds ? Buffer.from('repaired-wav') : null,
      );
      await recoverInterruptedCaptureJournals(root, {
        getMeeting: () =>
          ({ id: meetingId, finalization_status: 'recovery_required' }) as any,
        saveMeeting: vi.fn(),
        repairRawChunk: repair,
        stitchWavSegments: async () => join(root, 'stitched.wav'),
      });
      expect(repair).toHaveBeenCalledOnce();
      const after = await readCaptureJournalManifest(root, meetingId);
      if (after.schemaVersion !== 3) throw new Error('expected v3');
      expect(after.intervals[0].chunkEndSec).toBe(0.061);
      expect(after.intervals[0].sources.mic.disposition).toBe(
        succeeds ? 'captured' : 'raw_durable',
      );
      expect(after.lifecycleState).toBe('stopping');
      // Transcript acceptance is deliberately absent; test raw repair and the unchanged seal gate only.
      if (succeeds)
        await expect(
          sealCaptureJournal(root, { meetingId, endedAtMs: 1061 }),
        ).resolves.toMatchObject({ lifecycleState: 'sealed' });
      else
        await expect(
          sealCaptureJournal(root, { meetingId, endedAtMs: 1061 }),
        ).rejects.toThrow('unresolved audio intervals');
      expect(await readFile(join(root, raw.rawRelativePath))).toEqual(
        Buffer.from('preserved-encoded-tail'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
