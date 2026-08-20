import { describe, expect, it } from 'vitest';

import {
  type ShadowReceipt,
  ShadowWindowAssembler,
} from '../../electron/transcription/shadowWindowAssembler';

const receipt = (overrides: Partial<ShadowReceipt> = {}): ShadowReceipt => ({
  durable: true,
  meetingId: 'meeting-1',
  generation: 'generation-1',
  source: 'system',
  sequence: 0,
  checksumSha256: 'a'.repeat(64),
  chunkStartSec: 0,
  chunkEndSec: 5,
  repairAudioRelativePath: 'meeting-1/repair/system-000000.wav',
  ...overrides,
});

const fiveSecondReceipts = (start = 0): ShadowReceipt[] =>
  Array.from({ length: 6 }, (_, index) =>
    receipt({
      sequence: index,
      chunkStartSec: start + index * 5,
      chunkEndSec: start + (index + 1) * 5,
      repairAudioRelativePath: `meeting-1/repair/system-${index}.wav`,
    }),
  );

describe('ShadowWindowAssembler', () => {
  it('emits one sealed 30-second window for six contiguous receipts', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    const emitted = fiveSecondReceipts().flatMap((entry) =>
      assembler.add(entry),
    );

    expect(emitted).toEqual([
      {
        meetingId: 'meeting-1',
        generation: 'generation-1',
        source: 'system',
        startSec: 0,
        endSec: 30,
        firstSequence: 0,
        lastSequence: 5,
        receipts: fiveSecondReceipts(),
      },
    ]);
    expect(assembler.flush()).toEqual([]);
  });

  it('keeps system receipts isolated to one source identity', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    assembler.add(receipt());

    expect(() =>
      assembler.add(
        receipt({
          source: 'mic',
          sequence: 1,
          chunkStartSec: 5,
          chunkEndSec: 10,
        }),
      ),
    ).toThrow('shadow_identity_mismatch');
  });

  it('fails closed for duplicate and missing source-local sequences', () => {
    const duplicate = new ShadowWindowAssembler({ windowSeconds: 30 });
    duplicate.add(receipt());
    expect(() =>
      duplicate.add(
        receipt({ sequence: 0, chunkStartSec: 5, chunkEndSec: 10 }),
      ),
    ).toThrow('shadow_sequence_gap');

    const gap = new ShadowWindowAssembler({ windowSeconds: 30 });
    gap.add(receipt());
    expect(() =>
      gap.add(receipt({ sequence: 2, chunkStartSec: 5, chunkEndSec: 10 })),
    ).toThrow('shadow_sequence_gap');
  });

  it('retains sequence continuity after sealing a window', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    fiveSecondReceipts().forEach((entry) => assembler.add(entry));

    expect(() =>
      assembler.add(
        receipt({ sequence: 7, chunkStartSec: 35, chunkEndSec: 40 }),
      ),
    ).toThrow('shadow_sequence_gap');
  });

  it('fails closed for a gap in receipt time', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    assembler.add(receipt());

    expect(() =>
      assembler.add(
        receipt({ sequence: 1, chunkStartSec: 6, chunkEndSec: 11 }),
      ),
    ).toThrow('shadow_time_gap');
  });

  it('never splits a receipt that crosses a logical window boundary', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    assembler.add(receipt({ chunkStartSec: 5, chunkEndSec: 25 }));

    expect(() =>
      assembler.add(
        receipt({ sequence: 1, chunkStartSec: 25, chunkEndSec: 36 }),
      ),
    ).toThrow('shadow_crosses_window_boundary');
  });

  it('uses fixed nonzero window boundaries', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    const emitted = fiveSecondReceipts(30).flatMap((entry) =>
      assembler.add(entry),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      startSec: 30,
      endSec: 60,
      firstSequence: 0,
      lastSequence: 5,
    });
  });

  it('keeps a shortened boundary-aligned span until flush', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    const emitted = Array.from({ length: 5 }, (_, index) =>
      assembler.add(
        receipt({
          sequence: index,
          chunkStartSec: 5 + index * 5,
          chunkEndSec: 10 + index * 5,
        }),
      ),
    ).flat();

    expect(emitted).toEqual([]);
    expect(assembler.flush()).toMatchObject([
      { startSec: 5, endSec: 30, firstSequence: 0, lastSequence: 4 },
    ]);
  });

  it('anchors consecutive logical windows at the first receipt start', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    const emitted = Array.from({ length: 11 }, (_, index) =>
      assembler.add(
        receipt({
          sequence: index,
          chunkStartSec: 5 + index * 5,
          chunkEndSec: 10 + index * 5,
        }),
      ),
    ).flat();

    expect(emitted).toMatchObject([
      { startSec: 5, endSec: 35, firstSequence: 0, lastSequence: 5 },
    ]);
    expect(assembler.flush()).toMatchObject([
      { startSec: 35, endSec: 60, firstSequence: 6, lastSequence: 10 },
    ]);
  });

  it('emits a partial tail only once when flushed and makes empty flush idempotent', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });
    assembler.add(receipt());
    assembler.add(receipt({ sequence: 1, chunkStartSec: 5, chunkEndSec: 10 }));

    expect(assembler.flush()).toMatchObject([
      { startSec: 0, endSec: 10, firstSequence: 0, lastSequence: 1 },
    ]);
    expect(assembler.flush()).toEqual([]);
  });

  it('rejects invalid receipts before assembling them', () => {
    const assembler = new ShadowWindowAssembler({ windowSeconds: 30 });

    expect(() => assembler.add(receipt({ durable: undefined }))).toThrow(
      'shadow_receipt_invalid',
    );
    expect(() =>
      assembler.add(receipt({ repairAudioRelativePath: '' })),
    ).toThrow('shadow_receipt_invalid');
    expect(() => assembler.add(receipt({ checksumSha256: 'invalid' }))).toThrow(
      'shadow_receipt_invalid',
    );
    expect(() => assembler.add(receipt({ sequence: -1 }))).toThrow(
      'shadow_receipt_invalid',
    );
    expect(() =>
      assembler.add(receipt({ chunkStartSec: 5, chunkEndSec: 5 })),
    ).toThrow('shadow_receipt_invalid');
  });
});
