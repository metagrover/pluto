export type ShadowReceipt = {
  durable?: true;
  meetingId: string;
  generation: string;
  manifestRevision: number;
  source: 'mic' | 'system';
  sequence: number;
  checksumSha256: string;
  chunkStartSec: number;
  chunkEndSec: number;
  repairAudioRelativePath: string | null;
};

type ShadowIdentity = {
  streamId: string;
  source: 'system';
  generation: number;
};

type ShadowClient = {
  open(identity: ShadowIdentity): Promise<void>;
  append(
    request: ShadowIdentity & {
      sequence: number;
      audioPath: string;
      chunkStartSeconds: number;
      chunkEndSeconds: number;
      checksumSha256: string;
    },
  ): Promise<void>;
  close(): Promise<'exited' | 'cleanup_failed'>;
};

export type ShadowResourceSample = {
  mlxRssBytes: number;
  parakeetRssBytes: number;
  electronRssBytes: number;
  freePercent: number;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
};

type CoordinatorOptions = {
  enabled(): boolean;
  createClient(): Promise<ShadowClient>;
  resolveRepairPath(relativePath: string): string;
  sampleResources(): ShadowResourceSample | undefined;
  rollback(): Promise<boolean>;
};

const MAX_COMBINED_RSS_BYTES = 4.5 * 1024 ** 3;

const finiteNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

export const descendantPids = (
  rootPid: number,
  processes: readonly { pid: number; parentPid: number }[],
): Set<number> => {
  const descendants = new Set<number>();
  const parents = new Set([rootPid]);
  while (parents.size > 0) {
    const nextParents = new Set<number>();
    for (const process of processes) {
      if (
        parents.has(process.parentPid) &&
        Number.isSafeInteger(process.pid) &&
        process.pid > 0 &&
        !descendants.has(process.pid)
      ) {
        descendants.add(process.pid);
        nextParents.add(process.pid);
      }
    }
    parents.clear();
    for (const pid of nextParents) parents.add(pid);
  }
  return descendants;
};

const unsafeResources = (sample: ShadowResourceSample | undefined): boolean => {
  if (!sample) return true;
  if (
    !finiteNonNegative(sample.mlxRssBytes) ||
    !finiteNonNegative(sample.parakeetRssBytes) ||
    !finiteNonNegative(sample.electronRssBytes) ||
    !Number.isFinite(sample.freePercent)
  ) {
    return true;
  }
  return (
    sample.mlxRssBytes + sample.parakeetRssBytes + sample.electronRssBytes >=
      MAX_COMBINED_RSS_BYTES ||
    sample.freePercent < 15 ||
    sample.thermal === 'serious' ||
    sample.thermal === 'critical'
  );
};

/**
 * Main-process-only shadow ingestion. It intentionally has no renderer events
 * or transcript output: a durable capture-journal receipt is its sole input.
 */
export class ParakeetLiveMeetingCoordinator {
  private client: ShadowClient | null = null;
  private meetingId: string | null = null;
  private identity: ShadowIdentity | null = null;
  private fenced = false;
  private aborting: Promise<void> | null = null;

  constructor(private readonly options: CoordinatorOptions) {}

  isFenced(): boolean {
    return this.fenced;
  }

  hasActiveClient(): boolean {
    return this.client !== null;
  }

  async start(meetingId: string): Promise<void> {
    if (this.fenced || !this.options.enabled()) return;
    if (unsafeResources(this.options.sampleResources())) {
      await this.abort();
      return;
    }
    if (this.client && this.meetingId === meetingId) return;
    await this.stop();
    if (this.fenced || !this.options.enabled()) return;
    this.client = await this.options.createClient();
    this.meetingId = meetingId;
    this.identity = {
      streamId: `shadow-${meetingId}-system`,
      source: 'system',
      generation: 1,
    };
    try {
      await this.client.open(this.identity);
    } catch {
      await this.abort();
    }
  }

  async append(receipt: ShadowReceipt): Promise<void> {
    if (
      this.fenced ||
      receipt.durable !== true ||
      receipt.source !== 'system' ||
      !receipt.repairAudioRelativePath ||
      receipt.meetingId !== this.meetingId ||
      !this.client ||
      !this.identity ||
      !Number.isSafeInteger(receipt.sequence) ||
      receipt.sequence < 0 ||
      !/^[a-f0-9]{64}$/u.test(receipt.checksumSha256) ||
      !Number.isFinite(receipt.chunkStartSec) ||
      !Number.isFinite(receipt.chunkEndSec) ||
      receipt.chunkEndSec <= receipt.chunkStartSec
    ) {
      return;
    }
    if (unsafeResources(this.options.sampleResources())) {
      await this.abort();
      return;
    }
    try {
      await this.client.append({
        ...this.identity,
        sequence: receipt.sequence + 1,
        audioPath: this.options.resolveRepairPath(
          receipt.repairAudioRelativePath,
        ),
        chunkStartSeconds: receipt.chunkStartSec,
        chunkEndSeconds: receipt.chunkEndSec,
        checksumSha256: receipt.checksumSha256,
      });
    } catch {
      await this.abort();
      return;
    }
    if (unsafeResources(this.options.sampleResources())) await this.abort();
  }

  async stop(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const result = await client.close().catch(() => 'cleanup_failed' as const);
    if (result !== 'exited') return await this.abort();
    this.client = null;
    this.meetingId = null;
    this.identity = null;
  }

  private async abort(): Promise<void> {
    if (this.aborting) return this.aborting;
    this.fenced = true;
    const attempt = async () => {
      const client = this.client;
      const cleanup = client
        ? await client.close().catch(() => 'cleanup_failed' as const)
        : 'exited';
      const rolledBack = await this.options.rollback().catch(() => false);
      if (cleanup !== 'exited' || !rolledBack)
        throw new Error('parakeet_shadow_uncertain_cleanup');
      this.client = null;
      this.meetingId = null;
      this.identity = null;
    };
    this.aborting = attempt().finally(() => {
      this.aborting = null;
    });
    return this.aborting;
  }
}
