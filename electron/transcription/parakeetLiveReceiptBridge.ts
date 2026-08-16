import type { NativeLiveSource } from './nativeJsonLineProcess';

type WatermarkIdentity = {
  streamId: string;
  source: NativeLiveSource;
  generation: number;
};

type ReceiptRecord<TReceipt> = WatermarkIdentity & {
  sequence: number;
  receipt: TReceipt;
};

type Watermarks = WatermarkIdentity & {
  committedThroughSequence: number;
  tentativeThroughSequence: number;
};

const keyFor = ({ streamId, source, generation }: WatermarkIdentity): string =>
  `${streamId}:${source}:${generation}`;

const isSequence = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export class ParakeetLiveReceiptBridge<TReceipt> {
  private readonly receipts = new Map<string, Map<number, TReceipt>>();

  record(record: ReceiptRecord<TReceipt>): void {
    if (!isSequence(record.sequence) || record.sequence === 0) {
      throw new Error('parakeet_receipt_invalid');
    }
    const key = keyFor(record);
    let bySequence = this.receipts.get(key);
    if (!bySequence) {
      bySequence = new Map();
      this.receipts.set(key, bySequence);
    }
    bySequence.set(record.sequence, record.receipt);
  }

  resolve(watermarks: Watermarks): {
    committedThroughReceipt: TReceipt | null;
    tentativeThroughReceipt: TReceipt | null;
  } {
    if (
      !isSequence(watermarks.committedThroughSequence) ||
      !isSequence(watermarks.tentativeThroughSequence) ||
      watermarks.committedThroughSequence > watermarks.tentativeThroughSequence
    ) {
      throw new Error('parakeet_receipt_invalid');
    }
    const bySequence = this.receipts.get(keyFor(watermarks));
    const resolveSequence = (sequence: number): TReceipt | null => {
      if (sequence === 0) return null;
      const receipt = bySequence?.get(sequence);
      if (!receipt) throw new Error('parakeet_receipt_not_found');
      return receipt;
    };
    return {
      committedThroughReceipt: resolveSequence(
        watermarks.committedThroughSequence,
      ),
      tentativeThroughReceipt: resolveSequence(
        watermarks.tentativeThroughSequence,
      ),
    };
  }

  clear(streamId: string): void {
    for (const key of this.receipts.keys()) {
      if (key.startsWith(`${streamId}:`)) this.receipts.delete(key);
    }
  }
}
