# Dual-Channel Parakeet Shadow Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a dev-only, receipt-bound Parakeet shadow trial over microphone and System audio in non-overlapping 30-second windows, without changing visible MLX text, canonical finalization, or analysis.

**Architecture:** A pure assembler turns five-second durable journal receipts into source-local 30-second windows. The main-process coordinator stitches each window into an approved temporary WAV, submits it to the existing two-stream Parakeet client, records only allowlisted aggregate metrics, flushes the final tail, and removes temporary audio. A development-only environment flag enables the `dual_shadow` rollout for the sample and the rollout fails closed to MLX when absent.

**Tech Stack:** TypeScript, Electron main process, capture-journal receipts, FFmpeg, Parakeet Core ML, Vitest.

---

## File map

- Create `electron/transcription/shadowWindowAssembler.ts`: source-local receipt validation and exact 30-second window assembly.
- Create `tests/unit/shadowWindowAssembler.test.ts`: window, gap, boundary, and tail tests.
- Modify `electron/transcription/parakeetLiveMeetingCoordinator.ts`: dual-source append, normal-stop flush, cleanup, and aggregate counters.
- Modify `tests/unit/parakeetLiveMeetingCoordinator.test.ts`: dual-source, resource, flush, and cleanup tests.
- Create `electron/transcription/dualShadowTrial.ts` and `tests/unit/dualShadowTrial.test.ts`: dev-only activation.
- Create `electron/transcription/dualShadowTrialReport.ts` and `tests/unit/dualShadowTrialReport.test.ts`: content-free aggregate report.
- Modify `electron/main.ts`: guarded rollout and coordinator adapters.
- Create `docs/changelog/entries/2026-08-20-630-dual-channel-parakeet-shadow-trial.md`: shipped disabled trial seam.

### Task 1: Assemble sealed 30-second windows

**Files:**
- Create: `electron/transcription/shadowWindowAssembler.ts`
- Test: `tests/unit/shadowWindowAssembler.test.ts`

- [ ] **Step 1: Write failing exact-once tests**

```ts
import { describe, expect, it } from 'vitest';
import { ShadowWindowAssembler, type ShadowReceipt } from '../../electron/transcription/shadowWindowAssembler';

const receipt = (sequence: number, start: number): ShadowReceipt => ({
  durable: true, meetingId: 'meeting', generation: 'generation', manifestRevision: sequence + 1,
  source: 'mic', sequence, checksumSha256: 'a'.repeat(64),
  chunkStartSec: start, chunkEndSec: start + 5,
  repairAudioRelativePath: `meeting/repair/mic-${sequence}.wav`,
});

describe('ShadowWindowAssembler', () => {
  it('emits exactly one 30-second window after six contiguous receipts', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    const output = Array.from({ length: 6 }, (_, i) => assembler.append(receipt(i, i * 5))).filter(Boolean);
    expect(output).toEqual([expect.objectContaining({ source: 'mic', startSec: 0, endSec: 30, sequenceStart: 0, sequenceEnd: 5 })]);
  });
  it('fails on a gap instead of fabricating coverage', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    assembler.append(receipt(0, 0));
    expect(() => assembler.append(receipt(2, 10))).toThrow('shadow_sequence_gap');
  });
  it('returns a partial tail only during flush', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    for (let i = 0; i < 7; i += 1) assembler.append(receipt(i, i * 5));
    expect(assembler.flush()).toEqual(expect.objectContaining({ startSec: 30, endSec: 35, sequenceStart: 6, sequenceEnd: 6 }));
  });
});
```

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the assembler**

```ts
export type ShadowReceipt = {
  durable?: true; meetingId: string; generation: string; manifestRevision: number;
  source: 'mic' | 'system'; sequence: number; checksumSha256: string;
  chunkStartSec: number; chunkEndSec: number; repairAudioRelativePath: string | null;
};
export type ShadowWindow = {
  source: 'mic' | 'system'; meetingId: string; generation: string;
  startSec: number; endSec: number; sequenceStart: number; sequenceEnd: number;
  receipts: readonly ShadowReceipt[];
};
export class ShadowWindowAssembler {
  private pending: ShadowReceipt[] = [];
  private identity: Pick<ShadowReceipt, 'meetingId' | 'generation' | 'source'> | null = null;
  constructor(private readonly options: { windowSeconds: 30 }) {}
  append(receipt: ShadowReceipt): ShadowWindow | null {
    if (receipt.durable !== true || !receipt.repairAudioRelativePath || !/^[a-f0-9]{64}$/u.test(receipt.checksumSha256)) throw new Error('shadow_receipt_invalid');
    if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0 || !Number.isFinite(receipt.chunkStartSec) || !Number.isFinite(receipt.chunkEndSec) || receipt.chunkEndSec <= receipt.chunkStartSec) throw new Error('shadow_receipt_invalid');
    const identity = { meetingId: receipt.meetingId, generation: receipt.generation, source: receipt.source };
    if (this.identity && Object.entries(identity).some(([key, value]) => this.identity?.[key as keyof typeof identity] !== value)) throw new Error('shadow_identity_mismatch');
    const previous = this.pending.at(-1);
    if (previous && receipt.sequence !== previous.sequence + 1) throw new Error('shadow_sequence_gap');
    if (previous && receipt.chunkStartSec !== previous.chunkEndSec) throw new Error('shadow_time_gap');
    const windowStart = Math.floor(receipt.chunkStartSec / this.options.windowSeconds) * this.options.windowSeconds;
    if (receipt.chunkEndSec > windowStart + this.options.windowSeconds) throw new Error('shadow_crosses_window_boundary');
    this.identity ??= identity; this.pending.push(receipt);
    return receipt.chunkEndSec === windowStart + this.options.windowSeconds ? this.takeWindow() : null;
  }
  flush(): ShadowWindow | null { return this.pending.length === 0 ? null : this.takeWindow(); }
  private takeWindow(): ShadowWindow {
    const receipts = this.pending.splice(0); const first = receipts[0]; const last = receipts.at(-1)!;
    return { source: first.source, meetingId: first.meetingId, generation: first.generation, startSec: first.chunkStartSec, endSec: last.chunkEndSec, sequenceStart: first.sequence, sequenceEnd: last.sequence, receipts };
  }
}
```

Validate durable receipts, SHA-256 checksum, nonempty repair path, a single meeting/generation/source, contiguous sequences, and contiguous time. Throw only `shadow_receipt_invalid`, `shadow_sequence_gap`, `shadow_time_gap`, `shadow_identity_mismatch`, or `shadow_crosses_window_boundary`. A receipt may not be split or cross a 30-second boundary.

- [ ] **Step 4: Cover System isolation, duplicate receipt, boundary crossing, and empty repeated flush**

Run: `pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/transcription/shadowWindowAssembler.ts tests/unit/shadowWindowAssembler.test.ts
git commit -m "feat(transcription): assemble sealed shadow windows (#630)"
```

### Task 2: Make the coordinator dual-source and flush the tail

**Files:**
- Modify: `electron/transcription/parakeetLiveMeetingCoordinator.ts`
- Modify: `tests/unit/parakeetLiveMeetingCoordinator.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

```ts
it('opens mic and system streams and appends one stitched window for each source', async () => {
  const append = vi.fn(async () => {});
  const stitchWindow = vi.fn(async ({ source }: { source: string }) => `/artifacts/${source}.wav`);
  const coordinator = makeCoordinator({ append, stitchWindow });
  await coordinator.start('meeting-1');
  for (const source of ['mic', 'system'] as const)
    for (let sequence = 0; sequence < 6; sequence += 1)
      await coordinator.append(receipt({ source, sequence, chunkStartSec: sequence * 5, chunkEndSec: sequence * 5 + 5 }));
  expect(append).toHaveBeenCalledWith(expect.objectContaining({ source: 'mic', sequence: 1, chunkStartSeconds: 0, chunkEndSeconds: 30 }));
  expect(append).toHaveBeenCalledWith(expect.objectContaining({ source: 'system', sequence: 1, chunkStartSeconds: 0, chunkEndSeconds: 30 }));
});

it('flushes both source tails and deletes every stitched temporary WAV', async () => {
  const flush = vi.fn(async () => ({ finalPreview: '', degradations: [] }));
  const removeTemporaryAudio = vi.fn(async () => {});
  const coordinator = makeCoordinator({ flush, removeTemporaryAudio });
  await coordinator.start('meeting-1');
  await coordinator.append(receipt({ source: 'mic', sequence: 0 }));
  await coordinator.append(receipt({ source: 'system', sequence: 0 }));
  await coordinator.stop();
  expect(flush).toHaveBeenCalledTimes(2);
  expect(removeTemporaryAudio).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run tests/unit/parakeetLiveMeetingCoordinator.test.ts`

Expected: FAIL because the coordinator filters mic receipts and terminates instead of flushing.

- [ ] **Step 3: Refactor the coordinator**

Replace its System-only identity with independent `mic` and `system` live identities, but retain one `ParakeetLiveClient`; its two-stream contract is already bounded. Give each source a `ShadowWindowAssembler`, and inject:

```ts
stitchWindow(input: { source: 'mic' | 'system'; startSec: number; endSec: number; sequenceStart: number; sequenceEnd: number; repairPaths: readonly string[] }): Promise<string | null>;
removeTemporaryAudio(audioPath: string): Promise<void>;
writeReport(report: DualShadowTrialReport): Promise<void>;
```

On each emitted window, sample resources before stitch and append, stitch only its repair paths, append exactly one 30-second WAV with a per-source ordinal sequence starting at one, and remove it after append settles. Retain only numeric counters and finite failure/degradation codes. Do not subscribe to or persist `stream_update` text. On normal `stop()`, submit `flush()` tails, call `client.flush()` for both sources, write one report, then close. On abort, cancel, wait for cleanup and rollback, then report failure.

- [ ] **Step 4: Add failure tests**

Test a missing stitched WAV, source-local append failure, memory/thermal fence, late append after fence, exact-once cleanup, and uncertain cleanup. Run: `pnpm exec vitest run tests/unit/parakeetLiveMeetingCoordinator.test.ts`

Expected: PASS with no recognized-word fixture.

- [ ] **Step 5: Commit**

```bash
git add electron/transcription/parakeetLiveMeetingCoordinator.ts tests/unit/parakeetLiveMeetingCoordinator.test.ts
git commit -m "feat(transcription): run dual-source parakeet shadow windows (#630)"
```

### Task 3: Gate the trial to an explicit dev launch and wire it in main

**Files:**
- Create: `electron/transcription/dualShadowTrial.ts`
- Create: `tests/unit/dualShadowTrial.test.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write failing gate tests**

```ts
import { describe, expect, it } from 'vitest';
import { resolveDualShadowTrial } from '../../electron/transcription/dualShadowTrial';

describe('resolveDualShadowTrial', () => {
  it('enables only an explicit development launch', () =>
    expect(resolveDualShadowTrial({ isPackaged: false, environment: { PLUTO_DUAL_PARAKEET_SHADOW_TRIAL: '1' } })).toMatchObject({ enabled: true, stage: 'dual_shadow' }));
  it.each([{ isPackaged: true, environment: { PLUTO_DUAL_PARAKEET_SHADOW_TRIAL: '1' } }, { isPackaged: false, environment: {} }])
  ('keeps ordinary and packaged launches disabled', (input) =>
    expect(resolveDualShadowTrial(input)).toEqual({ enabled: false }));
});
```

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run tests/unit/dualShadowTrial.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement and integrate**

`resolveDualShadowTrial` accepts only exact environment value `"1"` with `isPackaged === false`. It derives the approved `dual_shadow` digest from public label `pluto-dual-shadow-trial-v1`, supplies that one digest to `LiveTranscriptionRolloutStore`, and promotes it using the process-local owner token before a capture starts. With no flag, supply no digest, so existing startup validation returns to MLX.

In `electron/main.ts`, enable the coordinator only for `mode === 'parakeet' && stage === 'dual_shadow'`. Adapt the existing `stitchWavSegments` with each receipt path and its source-local times. Remove temporary output with `fs.promises.unlink`, treating `ENOENT` as already clean. Await normal coordinator stop before sealing. Log only finite codes and never add an IPC handler, preference, or UI control.

- [ ] **Step 4: Run focused integration tests**

Run:

```bash
pnpm exec vitest run tests/unit/dualShadowTrial.test.ts tests/unit/liveTranscriptionRolloutStore.test.ts tests/unit/liveTranscriptionPolicy.test.ts tests/unit/parakeetLiveMeetingCoordinator.test.ts
```

Expected: PASS; packaged and ordinary launches stay MLX-only.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/transcription/dualShadowTrial.ts tests/unit/dualShadowTrial.test.ts
git commit -m "feat(transcription): gate local dual shadow trial (#630)"
```

### Task 4: Persist a privacy-safe aggregate trial report

**Files:**
- Create: `electron/transcription/dualShadowTrialReport.ts`
- Create: `tests/unit/dualShadowTrialReport.test.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write failing allowlist tests**

```ts
import { expect, it } from 'vitest';
import { serializeDualShadowTrialReport } from '../../electron/transcription/dualShadowTrialReport';

it('serializes only aggregate fields', () => {
  const json = serializeDualShadowTrialReport({
    verdict: 'passed', windowsSubmitted: { mic: 2, system: 2 }, windowsCompleted: { mic: 2, system: 2 },
    unresolved: { mic: 0, system: 0 }, flush: { mic: 'completed', system: 'completed' },
    resource: { peakCombinedRssBucket: '512mb_to_1gb', worstThermal: 'nominal' }, failureCodes: [],
  });
  expect(Object.keys(JSON.parse(json)).sort()).toEqual(['failureCodes', 'flush', 'resource', 'schemaVersion', 'unresolved', 'verdict', 'windowsCompleted', 'windowsSubmitted']);
});
```

- [ ] **Step 2: Confirm RED**

Run: `pnpm exec vitest run tests/unit/dualShadowTrialReport.test.ts`

Expected: FAIL because the serializer does not exist.

- [ ] **Step 3: Implement strict report serialization and writing**

Allow only the tested counters, fixed verdicts, fixed flush outcomes, RSS buckets, thermal states, and finite failure codes. Reject unknown keys, arbitrary strings, text, audio paths, meeting IDs, receipt generations, timestamps, and error messages with `dual_shadow_report_invalid`. Atomically replace one `userData/parakeet-dual-shadow-trial-report.json` file at mode `0600` using a sibling temporary file, `fsync`, and rename.

- [ ] **Step 4: Add privacy rejection tests and verify GREEN**

Test inputs containing `text`, `audioPath`, `meetingId`, `errorMessage`, and an unknown key. Run: `pnpm exec vitest run tests/unit/dualShadowTrialReport.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/transcription/dualShadowTrialReport.ts tests/unit/dualShadowTrialReport.test.ts electron/main.ts
git commit -m "feat(transcription): record private shadow trial evidence (#630)"
```

### Task 5: Verify the guarded sample and record the shipped seam

**Files:**
- Create: `docs/changelog/entries/2026-08-20-630-dual-channel-parakeet-shadow-trial.md`

- [ ] **Step 1: Add the changelog fragment**

```md
---
category: Changed
---

Recording now includes a disabled-by-default local Parakeet dual-source shadow trial. It evaluates sealed microphone and System-audio windows without changing the visible live draft, canonical transcript, or meeting analysis.
```

- [ ] **Step 2: Run project verification**

Run:

```bash
pnpm exec vitest run tests/unit/shadowWindowAssembler.test.ts tests/unit/parakeetLiveMeetingCoordinator.test.ts tests/unit/dualShadowTrial.test.ts tests/unit/dualShadowTrialReport.test.ts tests/unit/liveTranscriptionPolicy.test.ts tests/unit/liveTranscriptionRolloutStore.test.ts
pnpm run changelog:check
pnpm run lint
pnpm run test
```

Expected: all tests, changelog validation, and lint pass. Record any unrelated pre-existing failure exactly; do not call the trial validated if its focused tests fail.

- [ ] **Step 3: Run one guarded owner-consented sample**

Launch only the development app:

```bash
PLUTO_DUAL_PARAKEET_SHADOW_TRIAL=1 pnpm run dev
```

Record a meeting containing both microphone and System audio, stop normally, and inspect only the aggregate report and capture integrity state. Require both sources to be complete or explicitly unresolved, both tails to flush, no failure code, and the ordinary MLX/final transcript path to remain active. Do not publish transcript content, audio paths, IDs, or report internals.

- [ ] **Step 4: Commit the changelog fragment**

```bash
git add docs/changelog/entries/2026-08-20-630-dual-channel-parakeet-shadow-trial.md
git commit -m "docs: record dual-source shadow trial (#630)"
```

## Plan self-review

- Tasks 1-2 cover receipt-bound mic/System processing, 30-second windows, provisional-only handling, normal-stop tail flush, resource fencing, and cleanup.
- Task 3 keeps the trial disabled for ordinary and packaged launches; Task 4 keeps diagnostics content-free; Task 5 verifies the existing live/canonical path is unchanged.
- No task promotes Parakeet to visible live text, canonical commit, or analysis. That remains a separate decision after repeated causal replay and soak evidence.
