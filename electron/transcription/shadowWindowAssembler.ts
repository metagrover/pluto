export type ShadowReceipt = {
  durable: true;
  meetingId: string;
  generation: string;
  manifestRevision: number;
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

const receiptIsValid = (receipt: unknown): receipt is ShadowReceipt => {
  if (typeof receipt !== 'object' || receipt === null) return false;
  const candidate = receipt as Record<string, unknown>;
  return (
    candidate.durable === true &&
    typeof candidate.meetingId === 'string' &&
    candidate.meetingId.length > 0 &&
    typeof candidate.generation === 'string' &&
    candidate.generation.length > 0 &&
    typeof candidate.manifestRevision === 'number' &&
    Number.isSafeInteger(candidate.manifestRevision) &&
    candidate.manifestRevision >= 0 &&
    (candidate.source === 'mic' || candidate.source === 'system') &&
    typeof candidate.sequence === 'number' &&
    Number.isSafeInteger(candidate.sequence) &&
    candidate.sequence >= 0 &&
    typeof candidate.checksumSha256 === 'string' &&
    SHA_256.test(candidate.checksumSha256) &&
    typeof candidate.repairAudioRelativePath === 'string' &&
    candidate.repairAudioRelativePath.length > 0 &&
    typeof candidate.chunkStartSec === 'number' &&
    typeof candidate.chunkEndSec === 'number' &&
    Number.isFinite(candidate.chunkStartSec) &&
    Number.isFinite(candidate.chunkEndSec) &&
    candidate.chunkStartSec < candidate.chunkEndSec
  );
};

const sameIdentity = (left: ShadowIdentity, right: ShadowReceipt): boolean =>
  left.meetingId === right.meetingId &&
  left.generation === right.generation &&
  left.source === right.source;

/**
 * Accumulates one durable source stream into target-duration, receipt-aligned
 * windows. It deliberately rejects discontinuities instead of attempting
 * reconstruction.
 */
export class ShadowWindowAssembler {
  private identity: ShadowIdentity | null = null;
  private previousReceipt: ShadowReceipt | null = null;
  private receipts: ShadowReceipt[] = [];

  constructor(private readonly options: ShadowWindowAssemblerOptions) {
    if (options.windowSeconds !== 30) {
      throw new Error('shadow_receipt_invalid');
    }
  }

  add(receipt: ShadowReceipt): ShadowWindow[] {
    if (!receiptIsValid(receipt)) invalid();

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

    const windowStart = this.receipts[0]!.chunkStartSec;
    const windowDuration = receipt.chunkEndSec - windowStart;
    return windowDuration >= this.options.windowSeconds
      ? [this.seal(receipt.chunkEndSec)]
      : [];
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
