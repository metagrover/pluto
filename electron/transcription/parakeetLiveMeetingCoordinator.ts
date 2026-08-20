import type {
  DualShadowTrialReport,
  DualShadowTrialRssBucket,
  DualShadowTrialThermalState,
  DualShadowTrialFailureCode as ShadowFailureCode,
} from './dualShadowTrialReport';
import {
  type ShadowReceipt as AssembledShadowReceipt,
  type ShadowWindow,
  ShadowWindowAssembler,
} from './shadowWindowAssembler';

export type ShadowReceipt = Omit<
  AssembledShadowReceipt,
  'durable' | 'repairAudioRelativePath'
> & {
  durable?: true;
  repairAudioRelativePath: string | null;
};

type ShadowSource = ShadowReceipt['source'];

type ShadowIdentity = {
  streamId: string;
  source: ShadowSource;
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
  flush?(identity: ShadowIdentity): Promise<unknown>;
  cancel?(identity: ShadowIdentity): Promise<void>;
  close(): Promise<'exited' | 'cleanup_failed'>;
};

export type ShadowResourceSample = {
  mlxRssBytes: number;
  parakeetRssBytes: number;
  electronRssBytes: number;
  freePercent: number;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
};

export type { DualShadowTrialReport } from './dualShadowTrialReport';

type CoordinatorOptions = {
  enabled(): boolean;
  createClient(): Promise<ShadowClient>;
  resolveRepairPath(relativePath: string): string;
  sampleResources(): ShadowResourceSample | undefined;
  rollback(): Promise<boolean>;
  stitchWindow?(input: {
    source: ShadowSource;
    startSec: number;
    endSec: number;
    sequenceStart: number;
    sequenceEnd: number;
    repairPaths: readonly string[];
    segments: readonly {
      path: string;
      startSec: number;
      endSec: number;
      sequence: number;
    }[];
  }): Promise<string | null>;
  removeTemporaryAudio?(audioPath: string): Promise<void>;
  writeReport?(report: DualShadowTrialReport): Promise<void>;
};

const MAX_COMBINED_RSS_BYTES = 4.5 * 1024 ** 3;
const SOURCES: readonly ShadowSource[] = ['mic', 'system'];

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
  if (
    !sample ||
    !finiteNonNegative(sample.mlxRssBytes) ||
    !finiteNonNegative(sample.parakeetRssBytes) ||
    !finiteNonNegative(sample.electronRssBytes) ||
    !Number.isFinite(sample.freePercent)
  )
    return true;
  return (
    sample.mlxRssBytes + sample.parakeetRssBytes + sample.electronRssBytes >=
      MAX_COMBINED_RSS_BYTES ||
    sample.freePercent < 15 ||
    sample.thermal === 'serious' ||
    sample.thermal === 'critical'
  );
};

const sourceCounts = (): Record<ShadowSource, number> => ({
  mic: 0,
  system: 0,
});
const sourceFlushes = (): DualShadowTrialReport['flush'] => ({
  mic: 'skipped',
  system: 'skipped',
});

const emptyResource = (): DualShadowTrialReport['resource'] => ({
  peakCombinedRssBucket: 'unavailable',
  worstThermal: 'unavailable',
});
const rssBucket = (rssBytes: number): DualShadowTrialRssBucket => {
  const mib = 1024 ** 2;
  if (rssBytes < 512 * mib) return 'under_512mb';
  if (rssBytes < 1024 * mib) return '512mb_to_1gb';
  if (rssBytes < 2 * 1024 * mib) return '1gb_to_2gb';
  if (rssBytes < 4.5 * 1024 * mib) return '2gb_to_4_5gb';
  return 'over_4_5gb';
};
const thermalSeverity: Record<DualShadowTrialThermalState, number> = {
  unavailable: -1,
  nominal: 0,
  fair: 1,
  serious: 2,
  critical: 3,
};

/** Main-process-only, receipt-bound dual-source shadow ingestion. */
export class ParakeetLiveMeetingCoordinator {
  private client: ShadowClient | null = null;
  private meetingId: string | null = null;
  private identities: Record<ShadowSource, ShadowIdentity> | null = null;
  private assemblers: Record<ShadowSource, ShadowWindowAssembler> | null = null;
  private nextOrdinals = sourceCounts();
  private report = this.emptyReport();
  private resource = emptyResource();
  private fenced = false;
  private aborting: Promise<void> | null = null;
  private reported = false;

  constructor(private readonly options: CoordinatorOptions) {}

  isFenced(): boolean {
    return this.fenced;
  }
  hasActiveClient(): boolean {
    return this.client !== null;
  }

  async start(meetingId: string): Promise<void> {
    if (
      this.fenced ||
      !this.options.enabled() ||
      !this.options.stitchWindow ||
      !this.options.removeTemporaryAudio ||
      !this.options.writeReport
    )
      return;
    if (this.client && this.meetingId === meetingId) return;
    await this.stop();
    if (this.fenced || !this.options.enabled()) return;
    this.resetMeeting();
    this.meetingId = meetingId;
    if (this.hasUnsafeResources()) {
      await this.abort('resource_fence');
      return;
    }
    this.identities = Object.fromEntries(
      SOURCES.map((source) => [
        source,
        { streamId: `shadow-${meetingId}-${source}`, source, generation: 1 },
      ]),
    ) as Record<ShadowSource, ShadowIdentity>;
    this.assemblers = Object.fromEntries(
      SOURCES.map((source) => [
        source,
        new ShadowWindowAssembler({ windowSeconds: 30 }),
      ]),
    ) as Record<ShadowSource, ShadowWindowAssembler>;
    try {
      this.client = await this.options.createClient();
    } catch {
      await this.abort('create_failed');
      return;
    }
    try {
      for (const source of SOURCES)
        await this.client.open(this.identities[source]);
    } catch {
      await this.abort('open_failed');
    }
  }

  async append(receipt: ShadowReceipt): Promise<void> {
    if (
      this.fenced ||
      !this.client ||
      !this.assemblers ||
      receipt.meetingId !== this.meetingId
    )
      return;
    if (receipt.durable !== true || !receipt.repairAudioRelativePath) return;
    let windows: ShadowWindow[];
    try {
      windows = this.assemblers[receipt.source].add(
        receipt as AssembledShadowReceipt,
      );
    } catch {
      await this.abort('window_invalid');
      return;
    }
    for (const window of windows) {
      if (this.fenced) return;
      await this.submitWindow(window);
    }
  }

  async stop(): Promise<void> {
    if (!this.client || this.fenced) return;
    try {
      for (const source of SOURCES) {
        for (const window of this.assemblers![source].flush()) {
          await this.submitWindow(window);
          if (this.fenced) return;
        }
      }
      for (const source of SOURCES) {
        const identity = this.identities![source];
        if (!this.client.flush) throw new Error('flush_unavailable');
        await this.client.flush(identity);
        this.report.flush[source] = 'completed';
      }
    } catch {
      await this.abort('flush_failed');
      return;
    }
    const result = await this.client
      .close()
      .catch(() => 'cleanup_failed' as const);
    if (result !== 'exited') {
      await this.abort('cleanup_uncertain');
      return;
    }
    try {
      await this.writeReport();
    } catch {
      await this.abort('report_write_failed');
      return;
    }
    this.clear();
  }

  private async submitWindow(window: ShadowWindow): Promise<void> {
    if (this.hasUnsafeResources()) {
      await this.abort('resource_fence');
      return;
    }
    const source = window.source;
    let audioPath: string | null;
    try {
      audioPath =
        (await this.options.stitchWindow?.({
          source,
          startSec: window.startSec,
          endSec: window.endSec,
          sequenceStart: window.firstSequence,
          sequenceEnd: window.lastSequence,
          repairPaths: window.receipts.map((receipt) =>
            this.options.resolveRepairPath(receipt.repairAudioRelativePath),
          ),
          segments: window.receipts.map((receipt) => ({
            path: this.options.resolveRepairPath(
              receipt.repairAudioRelativePath,
            ),
            startSec: receipt.chunkStartSec,
            endSec: receipt.chunkEndSec,
            sequence: receipt.sequence,
          })),
        })) ?? null;
    } catch {
      this.unresolved(source, 'stitch_failed');
      return;
    }
    if (!audioPath) {
      this.unresolved(source, 'stitch_missing');
      return;
    }
    this.report.windowsSubmitted[source] += 1;
    let appendFailure: ShadowFailureCode | null = null;
    try {
      if (this.hasUnsafeResources()) {
        appendFailure = 'resource_fence';
      } else {
        await this.client!.append({
          ...this.identities![source],
          sequence: ++this.nextOrdinals[source],
          audioPath,
          chunkStartSeconds: window.startSec,
          chunkEndSeconds: window.endSec,
          checksumSha256: window.receipts.at(-1)!.checksumSha256,
        });
        this.report.windowsCompleted[source] += 1;
      }
    } catch {
      appendFailure = 'append_failed';
    }
    let cleanupFailure: ShadowFailureCode | null = null;
    try {
      await this.options.removeTemporaryAudio?.(audioPath);
    } catch {
      cleanupFailure = 'temporary_audio_cleanup_failed';
    }
    if (appendFailure || cleanupFailure) {
      if (appendFailure) this.failure(appendFailure);
      if (cleanupFailure) this.failure(cleanupFailure);
      await this.abort(appendFailure ?? cleanupFailure!);
    }
  }

  private unresolved(source: ShadowSource, code: ShadowFailureCode): void {
    this.report.unresolved[source] += 1;
    this.failure(code);
  }

  private failure(code: ShadowFailureCode): void {
    if (!this.report.failureCodes.includes(code))
      this.report.failureCodes.push(code);
  }

  private async abort(code: ShadowFailureCode): Promise<void> {
    if (this.aborting) return this.aborting;
    this.fenced = true;
    this.failure(code);
    this.aborting = (async () => {
      const client = this.client;
      const identities = this.identities;
      if (client?.cancel && identities)
        await Promise.all(
          SOURCES.map((source) =>
            client.cancel!(identities[source]).catch(() => undefined),
          ),
        );
      const cleanup = client
        ? await client.close().catch(() => 'cleanup_failed' as const)
        : 'exited';
      const rolledBack = await this.options.rollback().catch(() => false);
      if (cleanup !== 'exited' || !rolledBack)
        this.failure('cleanup_uncertain');
      await this.writeReport();
      if (cleanup !== 'exited' || !rolledBack)
        throw new Error('parakeet_shadow_uncertain_cleanup');
      this.clear();
    })().finally(() => {
      this.aborting = null;
    });
    return this.aborting;
  }

  private async writeReport(): Promise<void> {
    if (this.reported) return;
    await this.options.writeReport?.({
      ...this.report,
      resource: this.resource,
      verdict: this.report.failureCodes.length === 0 ? 'passed' : 'failed',
    });
    this.reported = true;
  }

  private clear(): void {
    this.client = null;
    this.meetingId = null;
    this.identities = null;
    this.assemblers = null;
  }

  private resetMeeting(): void {
    this.nextOrdinals = sourceCounts();
    this.report = this.emptyReport();
    this.resource = emptyResource();
    this.reported = false;
  }

  private emptyReport(): Omit<DualShadowTrialReport, 'verdict' | 'resource'> {
    return {
      windowsSubmitted: sourceCounts(),
      windowsCompleted: sourceCounts(),
      unresolved: sourceCounts(),
      flush: sourceFlushes(),
      failureCodes: [],
    };
  }

  private hasUnsafeResources(): boolean {
    const sample = this.options.sampleResources();
    this.recordResource(sample);
    return unsafeResources(sample);
  }

  private recordResource(sample: ShadowResourceSample | undefined): void {
    if (
      !sample ||
      !finiteNonNegative(sample.mlxRssBytes) ||
      !finiteNonNegative(sample.parakeetRssBytes) ||
      !finiteNonNegative(sample.electronRssBytes)
    )
      return;
    const bucket = rssBucket(
      sample.mlxRssBytes + sample.parakeetRssBytes + sample.electronRssBytes,
    );
    const bucketOrder: DualShadowTrialRssBucket[] = [
      'unavailable',
      'under_512mb',
      '512mb_to_1gb',
      '1gb_to_2gb',
      '2gb_to_4_5gb',
      'over_4_5gb',
    ];
    if (
      bucketOrder.indexOf(bucket) >
      bucketOrder.indexOf(this.resource.peakCombinedRssBucket)
    )
      this.resource.peakCombinedRssBucket = bucket;
    if (
      thermalSeverity[sample.thermal] >
      thermalSeverity[this.resource.worstThermal]
    )
      this.resource.worstThermal = sample.thermal;
  }
}
