import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const SOURCES = ['mic', 'system'] as const;
const VERDICTS = ['passed', 'failed'] as const;
const FLUSH_OUTCOMES = ['completed', 'failed', 'skipped'] as const;
const RSS_BUCKETS = [
  'unavailable',
  'under_512mb',
  '512mb_to_1gb',
  '1gb_to_2gb',
  '2gb_to_4_5gb',
  'over_4_5gb',
] as const;
const THERMAL_STATES = [
  'unavailable',
  'nominal',
  'fair',
  'serious',
  'critical',
] as const;
const FAILURE_CODES = [
  'append_failed',
  'cleanup_uncertain',
  'create_failed',
  'flush_failed',
  'open_failed',
  'report_write_failed',
  'resource_fence',
  'stitch_failed',
  'stitch_missing',
  'temporary_audio_cleanup_failed',
  'window_invalid',
] as const;

export type DualShadowTrialFailureCode = (typeof FAILURE_CODES)[number];
export type DualShadowTrialRssBucket = (typeof RSS_BUCKETS)[number];
export type DualShadowTrialThermalState = (typeof THERMAL_STATES)[number];

export type DualShadowTrialReport = {
  verdict: (typeof VERDICTS)[number];
  windowsSubmitted: Record<(typeof SOURCES)[number], number>;
  windowsCompleted: Record<(typeof SOURCES)[number], number>;
  unresolved: Record<(typeof SOURCES)[number], number>;
  flush: Record<(typeof SOURCES)[number], (typeof FLUSH_OUTCOMES)[number]>;
  resource: {
    peakCombinedRssBucket: DualShadowTrialRssBucket;
    worstThermal: DualShadowTrialThermalState;
  };
  failureCodes: DualShadowTrialFailureCode[];
};

type SerializedDualShadowTrialReport = DualShadowTrialReport & {
  schemaVersion: 1;
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const finiteCounterRecord = (
  value: unknown,
): value is Record<'mic' | 'system', number> => {
  const candidate = record(value);
  return (
    candidate !== null &&
    hasOnlyKeys(candidate, SOURCES) &&
    SOURCES.every(
      (source) =>
        typeof candidate[source] === 'number' &&
        Number.isSafeInteger(candidate[source]) &&
        candidate[source] >= 0,
    )
  );
};

const invalid = (): never => {
  throw new Error('dual_shadow_report_invalid');
};

const validate = (value: unknown): SerializedDualShadowTrialReport => {
  const report = record(value);
  if (
    !report ||
    !hasOnlyKeys(report, [
      'verdict',
      'windowsSubmitted',
      'windowsCompleted',
      'unresolved',
      'flush',
      'resource',
      'failureCodes',
    ]) ||
    !VERDICTS.includes(report.verdict as (typeof VERDICTS)[number]) ||
    !finiteCounterRecord(report.windowsSubmitted) ||
    !finiteCounterRecord(report.windowsCompleted) ||
    !finiteCounterRecord(report.unresolved)
  )
    return invalid();

  const flush = record(report.flush);
  const resource = record(report.resource);
  if (
    !flush ||
    !hasOnlyKeys(flush, SOURCES) ||
    !SOURCES.every((source) =>
      FLUSH_OUTCOMES.includes(flush[source] as (typeof FLUSH_OUTCOMES)[number]),
    ) ||
    !resource ||
    !hasOnlyKeys(resource, ['peakCombinedRssBucket', 'worstThermal']) ||
    !RSS_BUCKETS.includes(
      resource.peakCombinedRssBucket as DualShadowTrialRssBucket,
    ) ||
    !THERMAL_STATES.includes(
      resource.worstThermal as DualShadowTrialThermalState,
    ) ||
    !Array.isArray(report.failureCodes) ||
    !report.failureCodes.every((code) =>
      FAILURE_CODES.includes(code as DualShadowTrialFailureCode),
    )
  )
    return invalid();

  return {
    schemaVersion: 1,
    verdict: report.verdict as DualShadowTrialReport['verdict'],
    windowsSubmitted: report.windowsSubmitted,
    windowsCompleted: report.windowsCompleted,
    unresolved: report.unresolved,
    flush: flush as DualShadowTrialReport['flush'],
    resource: resource as DualShadowTrialReport['resource'],
    failureCodes: [...(report.failureCodes as DualShadowTrialFailureCode[])],
  };
};

export const serializeDualShadowTrialReport = (report: unknown): string =>
  JSON.stringify(validate(report));

export const writeDualShadowTrialReport = ({
  userDataPath,
  report,
}: {
  userDataPath: string;
  report: unknown;
}): void => {
  const filePath = join(userDataPath, 'parakeet-dual-shadow-trial-report.json');
  const temporaryPath = join(dirname(filePath), `.${basename(filePath)}.0.tmp`);
  const payload = `${serializeDualShadowTrialReport(report)}\n`;
  mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
    const descriptor = openSync(temporaryPath, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The previous report remains authoritative if temporary cleanup fails.
    }
    throw error;
  }
};
