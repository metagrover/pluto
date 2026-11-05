import os from 'node:os';
import { evaluateFinalTranscriptionAdmission } from '../../src/services/finalTranscription/finalTranscriptionAdmission';
import { createLocalModelMemoryProbe } from './localModelMemoryProbe';

const GIB = 1024 ** 3;
const GEMMA_4_12B_DIGEST =
  '4eb23ef187e2c5462566d6a1d3bbbc2f1346d0b4327cbb66d58fffbcc9b2b05c';
export const isEstablishedGemmaArtifact = (digest: unknown): boolean =>
  digest === GEMMA_4_12B_DIGEST;

export const getEstablishedGemmaLoadOptions = (
  digest: unknown,
): { num_gpu: number; use_mmap: boolean } | undefined => {
  const total = os.totalmem();
  if (
    isEstablishedGemmaArtifact(digest) &&
    process.platform === 'darwin' &&
    Number.isFinite(total) &&
    total > 0 &&
    total <= 16 * GIB
  )
    return { num_gpu: 16, use_mmap: true };
};

// Conservative fallback context allowance when a model's cache size is unknown.
const DEFAULT_CONTEXT_BYTES_PER_TOKEN = 64 * 1024;

const positiveInteger = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : undefined;

// Bytes of f16 key/value cache each context token allocates, from Ollama's
// `/api/show` model_info. Undefined unless every attention dimension is known.
export const readContextBytesPerToken = (
  modelInfo: unknown,
): number | undefined => {
  if (!modelInfo || typeof modelInfo !== 'object') return undefined;
  const info = modelInfo as Record<string, unknown>;
  const arch = info['general.architecture'];
  if (typeof arch !== 'string' || !arch) return undefined;
  const layers = positiveInteger(info[`${arch}.block_count`]);
  const heads = positiveInteger(info[`${arch}.attention.head_count`]);
  const embedding = positiveInteger(info[`${arch}.embedding_length`]);
  if (!layers) return undefined;
  const rawKvHeads = info[`${arch}.attention.head_count_kv`];
  const kvHeads = Array.isArray(rawKvHeads)
    ? rawKvHeads.length === layers
      ? rawKvHeads.map(positiveInteger)
      : []
    : Array.from({ length: layers }, () => positiveInteger(rawKvHeads));
  const headLength =
    heads && embedding && embedding % heads === 0
      ? embedding / heads
      : undefined;
  const keyLength =
    positiveInteger(info[`${arch}.attention.key_length`]) ?? headLength;
  const valueLength =
    positiveInteger(info[`${arch}.attention.value_length`]) ?? headLength;
  if (!keyLength || !valueLength || kvHeads.length !== layers) return undefined;
  let bytes = 0;
  for (const count of kvHeads) {
    if (!count) return undefined;
    bytes += count * (keyLength + valueLength) * 2;
  }
  return bytes;
};

const MEMORY_CHECK_INTERVAL_MS = 100;
const REACTION_HEADROOM_BYTES = 2 * GIB;
const hasMemoryCapacity = (available: number, total: number): boolean =>
  evaluateFinalTranscriptionAdmission({
    thermalState: 'unknown',
    freeMemoryBytes: available,
    totalMemoryBytes: total,
  }).admitted;

export class LocalModelMemoryError extends Error {
  name = 'LocalModelMemoryError';

  constructor(
    message: string,
    readonly maxContextTokens?: number,
  ) {
    super(message);
  }
}

export const readLocalModelMemory = async (): Promise<{
  available: number;
  total: number;
}> => {
  const total = os.totalmem();
  if (process.platform !== 'darwin') return { total, available: os.freemem() };
  const probe = createLocalModelMemoryProbe(() => {});
  try {
    await probe.start();
    return { total, available: (total * probe.read()) / 100 };
  } catch {
    throw new LocalModelMemoryError(
      'Local memory monitor unavailable. Generation stopped to protect system memory.',
    );
  } finally {
    await probe.dispose();
  }
};

export const assertLocalModelMemoryCapacity = ({
  available,
  total,
  modelBytes,
  modelDigest,
  resident,
  contextTokens,
  contextBytesPerToken,
  measuredColdPeak,
}: {
  available: number;
  total: number;
  modelBytes: number;
  modelDigest?: string;
  resident: boolean;
  contextTokens: number;
  // Key/value cache bytes per context token read from the model's metadata.
  contextBytesPerToken?: number;
  // Peak this Mac actually used for a cold load of the same artifact and
  // placement, and the context it loaded with.
  measuredColdPeak?: { bytes: number; contextTokens: number };
}): void => {
  // Gemma's observed buffers need fixed sliding-window/runtime headroom.
  // Other artifacts with known attention metadata charge their weights plus
  // a CPU-side copy margin and fixed runtime headroom, and their exact cache
  // per token. Unknown artifacts retain the conservative 2.5x cold estimate.
  // The known-layout estimate is close to the real allocation, so it also
  // keeps the watchdog's reaction headroom: without it, a load can be
  // admitted that the watchdog stops as soon as the weights are in memory.
  const established = isEstablishedGemmaArtifact(modelDigest);
  const knownContextBytes =
    !established &&
    contextBytesPerToken !== undefined &&
    Number.isFinite(contextBytesPerToken) &&
    contextBytesPerToken > 0
      ? contextBytesPerToken
      : undefined;
  const coldLoad = established
    ? modelBytes + 2 * GIB
    : knownContextBytes
      ? modelBytes * 1.25 + GIB + REACTION_HEADROOM_BYTES
      : modelBytes * 2.5 + GIB;
  const perToken = knownContextBytes ?? DEFAULT_CONTEXT_BYTES_PER_TOKEN;
  const estimatedAdditional = coldLoad + contextTokens * perToken;
  // A measured peak, with 20 percent margin and any larger context, replaces
  // the file-size estimate only when it is smaller. Live pressure monitoring
  // still cancels generation if memory runs low.
  const measuredAdditional =
    measuredColdPeak && measuredColdPeak.bytes > 0
      ? measuredColdPeak.bytes * 1.2 +
        Math.max(0, contextTokens - measuredColdPeak.contextTokens) * perToken
      : Number.POSITIVE_INFINITY;
  const additional = resident
    ? REACTION_HEADROOM_BYTES
    : Math.min(estimatedAdditional, measuredAdditional);
  if (!hasMemoryCapacity(available - additional, total)) {
    let maxContextTokens: number | undefined;
    if (!resident && Number.isSafeInteger(contextTokens)) {
      for (
        let context = Math.floor((contextTokens - 1) / 1024) * 1024;
        context >= 4096;
        context -= 1024
      ) {
        if (
          hasMemoryCapacity(available - coldLoad - context * perToken, total)
        ) {
          maxContextTokens = context;
          break;
        }
      }
    }
    console.warn('[Local memory admission]', {
      availableBytes: available,
      totalBytes: total,
      additionalBytes: additional,
      contextTokens,
      resident,
    });
    throw new LocalModelMemoryError(
      'Not enough memory to safely load the selected local model. Close other apps or choose a smaller local model in Settings.',
      maxContextTokens,
    );
  }
};

export const watchLocalModelMemory = () => {
  const controller = new AbortController();
  let disposed = false;
  let checking = false;
  // Lowest availability observed while this request ran, including the load.
  let lowestAvailable = Number.POSITIVE_INFINITY;
  let residentCheck: (() => Promise<boolean>) | undefined;
  let resident = false;
  let residentCheckedAt = Number.NEGATIVE_INFINITY;
  let residentEpoch = 0;
  let residentPending: Promise<void> | undefined;
  const refreshResidency = (): Promise<void> | undefined => {
    if (disposed || !residentCheck || residentPending) return residentPending;
    const check = residentCheck;
    const epoch = residentEpoch;
    const pending = Promise.resolve()
      .then(check)
      .then((verified) => {
        if (disposed || epoch !== residentEpoch) return;
        resident = verified === true;
        residentCheckedAt = Date.now();
      })
      .catch(() => {
        if (disposed || epoch !== residentEpoch) return;
        resident = false;
      })
      .finally(() => {
        if (residentPending === pending) residentPending = undefined;
      });
    residentPending = pending;
    return pending;
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  let residencyTimer: ReturnType<typeof setInterval> | undefined;
  let probe: ReturnType<typeof createLocalModelMemoryProbe> | undefined;
  const monitorFailed = () => {
    if (!disposed)
      controller.abort(
        new LocalModelMemoryError(
          'Local memory monitor unavailable. Generation stopped to protect system memory.',
        ),
      );
  };
  const checkMemory = async () => {
    if (checking || disposed) return;
    checking = true;
    try {
      const residentAge = Date.now() - residentCheckedAt;
      const verifiedResident =
        resident && residentAge >= 0 && residentAge <= MEMORY_CHECK_INTERVAL_MS;
      const { available, total } = probe
        ? {
            available: (os.totalmem() * probe.read()) / 100,
            total: os.totalmem(),
          }
        : await readLocalModelMemory();
      lowestAvailable = Math.min(lowestAvailable, available);
      if (
        !disposed &&
        !hasMemoryCapacity(
          available - (verifiedResident ? GIB : REACTION_HEADROOM_BYTES),
          total,
        )
      ) {
        console.warn('[Local memory guard]', {
          availableBytes: available,
          totalBytes: total,
          resident: verifiedResident,
          reactionBytes: verifiedResident ? GIB : REACTION_HEADROOM_BYTES,
        });
        controller.abort(
          new LocalModelMemoryError(
            'Local generation stopped to protect system memory. Close other apps or choose a smaller local model in Settings.',
          ),
        );
      }
    } catch {
      monitorFailed();
    } finally {
      checking = false;
    }
  };
  return {
    signal: controller.signal,
    lowestAvailable: (): number | null =>
      Number.isFinite(lowestAvailable) ? lowestAvailable : null,
    start: async (signal?: AbortSignal) => {
      if (disposed || timer !== undefined) return;
      if (process.platform === 'darwin') {
        probe = createLocalModelMemoryProbe(monitorFailed);
        try {
          await probe.start(signal);
          await refreshResidency();
          await checkMemory();
          controller.signal.throwIfAborted();
        } catch (error) {
          monitorFailed();
          throw controller.signal.reason ?? error;
        }
      }
      if (!disposed) {
        timer = setInterval(() => {
          // Residency discovery must never delay the independent reserve check.
          void checkMemory();
        }, MEMORY_CHECK_INTERVAL_MS);
        // Refresh inside the freshness window so timer jitter cannot age a healthy proof out.
        residencyTimer = setInterval(() => {
          void refreshResidency();
        }, MEMORY_CHECK_INTERVAL_MS / 2);
        void refreshResidency();
      }
    },
    setResidentCheck: (modelDigest: unknown, check: () => Promise<boolean>) => {
      residentEpoch += 1;
      resident = false;
      residentCheckedAt = Number.NEGATIVE_INFINITY;
      residentCheck = isEstablishedGemmaArtifact(modelDigest)
        ? check
        : undefined;
      if (timer !== undefined) void refreshResidency();
    },
    dispose: async () => {
      disposed = true;
      residentEpoch += 1;
      resident = false;
      clearInterval(timer);
      clearInterval(residencyTimer);
      await probe?.dispose();
    },
  };
};
