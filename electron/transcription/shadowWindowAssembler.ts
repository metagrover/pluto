export type ShadowReceipt = {
  durable: true;
  meetingId: string;
  generation: string;
  source: 'mic' | 'system';
  sequence: number;
  checksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  repairAudioRelativePath: string;
};

export type ShadowWindow = {
  meetingId: string;
  generation: string;
  source: ShadowReceipt['source'];
  startSec: number;
  endSec: number;
  firstSequence: number;
  lastSequence: number;
  receipts: ShadowReceipt[];
};

type ShadowWindowAssemblerOptions = {
  windowSeconds: 30;
};

type ShadowIdentity = Pick<
  ShadowReceipt,
  'meetingId' | 'generation' | 'source'
>;

const SHA_256 = /^[a-f0-9]{64}$/u;

const invalid = (): never => {
  throw new Error('shadow_receipt_invalid');
};

const receiptIsValid = (receipt: ShadowReceipt): boolean =>
  receipt.durable === true &&
  typeof receipt.meetingId === 'string' &&
  receipt.meetingId.length > 0 &&
  typeof receipt.generation === 'string' &&
  receipt.generation.length > 0 &&
  (receipt.source === 'mic' || receipt.source === 'system') &&
  Number.isSafeInteger(receipt.sequence) &&
  receipt.sequence >= 0 &&
  SHA_256.test(receipt.checksumSha256) &&
  typeof receipt.repairAudioRelativePath === 'string' &&
  receipt.repairAudioRelativePath.length > 0 &&
  Number.isFinite(receipt.chunkStartSec) &&
  Number.isFinite(receipt.chunkEndSec) &&
  receipt.chunkStartSec < receipt.chunkEndSec;

const sameIdentity = (left: ShadowIdentity, right: ShadowReceipt): boolean =>
  left.meetingId === right.meetingId &&
  left.generation === right.generation &&
  left.source === right.source;

/**
 * Accumulates one durable source stream into fixed, sealed receipt windows.
 * It deliberately rejects discontinuities instead of attempting reconstruction.
 */
export class ShadowWindowAssembler {
  private identity: ShadowIdentity | null = null;
  private previousReceipt: ShadowReceipt | null = null;
  private receipts: ShadowReceipt[] = [];

  constructor(private readonly options: ShadowWindowAssemblerOptions) {
    if (!Number.isFinite(options.windowSeconds) || options.windowSeconds <= 0) {
      throw new Error('shadow_receipt_invalid');
    }
  }

  add(receipt: ShadowReceipt): ShadowWindow[] {
    if (!receiptIsValid(receipt)) invalid();

    const windowStart =
      this.receipts[0]?.chunkStartSec ?? receipt.chunkStartSec;
    const windowEnd = windowStart + this.options.windowSeconds;
    if (receipt.chunkEndSec > windowEnd) {
      throw new Error('shadow_crosses_window_boundary');
    }

    if (this.identity && !sameIdentity(this.identity, receipt)) {
      throw new Error('shadow_identity_mismatch');
    }

    const previous = this.previousReceipt;
    if (previous) {
      if (receipt.sequence !== previous.sequence + 1) {
        throw new Error('shadow_sequence_gap');
      }
      if (receipt.chunkStartSec !== previous.chunkEndSec) {
        throw new Error('shadow_time_gap');
      }
    }

    this.identity ??= {
      meetingId: receipt.meetingId,
      generation: receipt.generation,
      source: receipt.source,
    };
    this.receipts.push(receipt);
    this.previousReceipt = receipt;

    return receipt.chunkEndSec === windowEnd ? [this.seal(windowEnd)] : [];
  }

  flush(): ShadowWindow[] {
    if (this.receipts.length === 0) return [];
    return [this.seal(this.receipts.at(-1)!.chunkEndSec)];
  }

  private seal(endSec: number): ShadowWindow {
    const receipts = this.receipts;
    const first = receipts[0]!;
    const last = receipts.at(-1)!;
    this.receipts = [];
    return {
      meetingId: first.meetingId,
      generation: first.generation,
      source: first.source,
      startSec: first.chunkStartSec,
      endSec,
      firstSequence: first.sequence,
      lastSequence: last.sequence,
      receipts,
    };
  }
}
