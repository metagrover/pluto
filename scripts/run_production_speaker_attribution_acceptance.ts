import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type ProductionAttributionAcceptanceManifest,
  runProductionAttributionAcceptance,
} from '../src/services/productionSpeakerAttributionAcceptance.ts';

const manifestFlag = process.argv.indexOf('--manifest');
const manifestPath =
  manifestFlag >= 0 && process.argv[manifestFlag + 1]
    ? path.resolve(process.argv[manifestFlag + 1])
    : path.resolve('scripts/speaker-attribution/production-acceptance.json');

try {
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as ProductionAttributionAcceptanceManifest;
  const report = runProductionAttributionAcceptance(manifest);
  const passedCases = report.results.filter((result) => result.passed).length;
  const falseMeSeconds = report.results.reduce(
    (total, result) => total + result.falseMeSeconds,
    0,
  );
  const missedMeSeconds = report.results.reduce(
    (total, result) => total + result.missedMeSeconds,
    0,
  );

  console.log(
    JSON.stringify({
      passed: report.passed,
      totalCases: report.results.length,
      passedCases,
      falseMeSeconds,
      missedMeSeconds,
      injectedLocalWindows: report.results.reduce(
        (total, result) => total + result.injectedLocalWindows,
        0,
      ),
    }),
  );
  if (!report.passed) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ passed: false, error: 'manifest_invalid' }));
  process.exitCode = 1;
}
