import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeCaptureJournalInterval,
  completeCaptureJournalCapturedChunk,
  createCaptureJournal,
  persistCaptureJournalRawChunk,
  readCaptureJournalManifest,
  setCaptureJournalAudioKeyProvider,
} from '../../electron/captureJournal';
import { readLiveJournalAudio } from '../../electron/transcription/liveJournalAudio';
import { decodeJournalAudio } from '../../src/services/liveTranscription/decodeJournalAudio';
import { createWavBlob } from '../../src/utils/audio';

const roots: string[] = [];
afterEach(async () => {
  setCaptureJournalAudioKeyProvider(null);
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const hash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

describe('live journal reads', () => {
  it.each([3, 4] as const)(
    'replays both sources in journal v%s without changing any audio or the manifest',
    async (schemaVersion) => {
      const root = await mkdtemp(join(tmpdir(), 'pluto-live-journal-'));
      roots.push(root);
      const key = randomBytes(32);
      setCaptureJournalAudioKeyProvider(() => key);
      const created = await createCaptureJournal(root, {
        meetingId: 'journal-fixture',
        startedAtMs: 1000,
        schemaVersion,
        meetingKey: key,
      });
      if (created.schemaVersion !== 3 && created.schemaVersion !== 4)
        throw new Error('wrong_schema');
      let manifest = created;
      const stored = new Map<string, string>();
      for (let sequence = 0; sequence < 2; sequence++) {
        manifest = await authorizeCaptureJournalInterval(root, {
          meetingId: created.meetingId,
          generation: created.generation,
          expectedRevision: manifest.revision,
          sequence,
          chunkStartSec: sequence * 2,
          chunkEndSec: sequence * 2 + 2,
        });
        for (const source of ['mic', 'system'] as const) {
          const pcm = new Float32Array(16000).fill((sequence + 1) / 10);
          const data = Buffer.from(
            await createWavBlob(pcm, 8000).arrayBuffer(),
          );
          manifest = await persistCaptureJournalRawChunk(root, {
            meetingId: created.meetingId,
            generation: created.generation,
            expectedRevision: manifest.revision,
            sequence,
            source,
            format: 'wav',
            data,
          });
          const completed = await completeCaptureJournalCapturedChunk(root, {
            meetingId: created.meetingId,
            generation: created.generation,
            expectedRevision: manifest.revision,
            sequence,
            source,
            rawChecksumSha256: hash(data),
            repairData: data,
          });
          manifest = completed.manifest;
          const disposition = manifest.intervals[sequence].sources[source];
          if (disposition.disposition !== 'captured')
            throw new Error('not_captured');
          for (const file of [
            disposition.rawRelativePath,
            disposition.repairRelativePath,
          ])
            stored.set(file, hash(await readFile(join(root, file))));
        }
      }
      const manifestBytes = await readFile(
        join(root, manifest.manifestRelativePath),
      );
      // A retry rereads the same audio; it never consumes or deletes the durable queue.
      for (let retry = 0; retry < 3; retry++) {
        for (const source of ['mic', 'system'] as const) {
          for (const fromSeconds of [0, 2]) {
            const chunk = await readLiveJournalAudio(root, {
              meetingId: created.meetingId,
              source,
              fromSeconds,
            });
            expect(chunk.kind).toBe('audio');
            if (chunk.kind !== 'audio') throw new Error('no_audio');
            const decoded = await decodeJournalAudio(chunk.data);
            expect(decoded.samples).toHaveLength(16000);
            expect(decoded.samples[0]).toBeCloseTo(
              fromSeconds === 0 ? 0.1 : 0.2,
            );
            expect(chunk.startSeconds).toBe(fromSeconds);
          }
        }
      }
      expect(await readFile(join(root, manifest.manifestRelativePath))).toEqual(
        manifestBytes,
      );
      for (const [file, checksum] of stored)
        expect(hash(await readFile(join(root, file)))).toBe(checksum);
      expect(await readCaptureJournalManifest(root, created.meetingId)).toEqual(
        manifest,
      );
    },
  );

  it('waits for a pending chunk and refuses corrupted captured bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pluto-live-journal-'));
    roots.push(root);
    const created = await createCaptureJournal(root, {
      meetingId: 'pending-fixture',
      startedAtMs: 1000,
      schemaVersion: 3,
    });
    if (created.schemaVersion !== 3) throw new Error('wrong_schema');
    const manifest = await authorizeCaptureJournalInterval(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: created.revision,
      sequence: 0,
      chunkStartSec: 0,
      chunkEndSec: 2,
    });
    expect(
      await readLiveJournalAudio(root, {
        meetingId: created.meetingId,
        source: 'mic',
        fromSeconds: 0,
      }),
    ).toMatchObject({ kind: 'waiting' });
    const data = Buffer.from(
      await createWavBlob(new Float32Array(16000), 8000).arrayBuffer(),
    );
    const raw = await persistCaptureJournalRawChunk(root, {
      meetingId: created.meetingId,
      generation: created.generation,
      expectedRevision: manifest.revision,
      sequence: 0,
      source: 'mic',
      format: 'wav',
      data,
    });
    const disposition = raw.intervals[0].sources.mic;
    if (disposition.disposition !== 'raw_durable')
      throw new Error('wrong_disposition');
    await writeFile(
      join(root, disposition.rawRelativePath),
      Buffer.from('corrupt'),
    );
    await expect(
      readLiveJournalAudio(root, {
        meetingId: created.meetingId,
        source: 'mic',
        fromSeconds: 0,
      }),
    ).rejects.toThrow('checksum mismatch');
  });
});
