import { describe, expect, it } from 'vitest';

import { ParakeetLiveReceiptBridge } from '../../electron/transcription/parakeetLiveReceiptBridge';

describe('ParakeetLiveReceiptBridge', () => {
  it('maps native committed and tentative watermarks to their exact capture receipts', () => {
    const bridge = new ParakeetLiveReceiptBridge();
    bridge.record({
      streamId: 'meeting-1:mic',
      source: 'mic',
      generation: 1,
      sequence: 1,
      receipt: { meetingId: 'meeting-1', sequence: 0, checksumSha256: 'a' },
    });
    bridge.record({
      streamId: 'meeting-1:mic',
      source: 'mic',
      generation: 1,
      sequence: 2,
      receipt: { meetingId: 'meeting-1', sequence: 1, checksumSha256: 'b' },
    });

    expect(
      bridge.resolve({
        streamId: 'meeting-1:mic',
        source: 'mic',
        generation: 1,
        committedThroughSequence: 1,
        tentativeThroughSequence: 2,
      }),
    ).toEqual({
      committedThroughReceipt: {
        meetingId: 'meeting-1',
        sequence: 0,
        checksumSha256: 'a',
      },
      tentativeThroughReceipt: {
        meetingId: 'meeting-1',
        sequence: 1,
        checksumSha256: 'b',
      },
    });
  });

  it('rejects impossible or missing sequence watermarks instead of inferring a receipt', () => {
    const bridge = new ParakeetLiveReceiptBridge();
    bridge.record({
      streamId: 'meeting-1:mic',
      source: 'mic',
      generation: 1,
      sequence: 1,
      receipt: { meetingId: 'meeting-1', checksumSha256: 'a' },
    });

    expect(() =>
      bridge.resolve({
        streamId: 'meeting-1:mic',
        source: 'mic',
        generation: 1,
        committedThroughSequence: 2,
        tentativeThroughSequence: 1,
      }),
    ).toThrow('parakeet_receipt_invalid');
    expect(() =>
      bridge.resolve({
        streamId: 'meeting-1:mic',
        source: 'mic',
        generation: 1,
        committedThroughSequence: 1,
        tentativeThroughSequence: 2,
      }),
    ).toThrow('parakeet_receipt_not_found');
  });
});
