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
}: {
  available: number;
  total: number;
  modelBytes: number;
  modelDigest?: string;
  resident: boolean;
  contextTokens: number;
}): void => {
  // Gemma's observed buffers need fixed sliding-window/runtime headroom; unknown artifacts retain the conservative cold estimate.
  const coldLoad = isEstablishedGemmaArtifact(modelDigest)
    ? modelBytes + 2 * GIB
    : modelBytes * 2.5 + GIB;
  const additional = resident
    ? REACTION_HEADROOM_BYTES
    : coldLoad + contextTokens * 64 * 1024;
  if (!hasMemoryCapacity(available - additional, total)) {
    let maxContextTokens: number | undefined;
    if (!resident && Number.isSafeInteger(contextTokens)) {
      for (
        let context = Math.floor((contextTokens - 1) / 1024) * 1024;
        context >= 4096;
        context -= 1024
      ) {
        if (
          hasMemoryCapacity(available - coldLoad - context * 64 * 1024, total)
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
          void refreshResidency();
        }, MEMORY_CHECK_INTERVAL_MS);
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
      await probe?.dispose();
    },
  };
};
