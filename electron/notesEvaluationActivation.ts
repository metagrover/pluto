import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveUserDataArgument } from './appRuntimePolicy';
import {
  PHI_NOTES_EXPERIMENT_DIGEST,
  PHI_NOTES_EXPERIMENT_MODEL,
} from './llm/meetingNotesTypes';
import type { DisposableNotesExperimentActivation } from './meetingAnalysisRuns';

// Only the disposable application harness writes this capability. A setting or
// environment variable alone must never select the candidate in a real profile.
export const resolveNotesEvaluationActivation = (input: {
  isPackaged: boolean;
  userDataPath: string;
  argv: string[];
}): DisposableNotesExperimentActivation | undefined => {
  const argument = input.argv.find((value) =>
    value.startsWith('--phi-notes-evaluation='),
  );
  if (!argument) return undefined;
  const reject = (): never => {
    throw new Error('notes_evaluation_profile_rejected');
  };
  const token = argument.split('=')[1];
  if (input.isPackaged || !/^[a-f0-9-]{36}$/.test(token ?? '')) reject();
  const requestedPath = resolveUserDataArgument(input.argv);
  if (requestedPath !== input.userDataPath) reject();
  const root = fs.realpathSync(input.userDataPath);
  if (
    root !== input.userDataPath ||
    path.dirname(root) !== fs.realpathSync(os.tmpdir()) ||
    !path.basename(root).startsWith('pluto-phi-application-') ||
    (fs.statSync(root).mode & 0o777) !== 0o700
  )
    reject();
  const markerPath = path.join(root, '.notes-evaluation.json');
  const markerStat = fs.lstatSync(markerPath);
  if (
    !markerStat.isFile() ||
    (markerStat.mode & 0o777) !== 0o600 ||
    (process.getuid && markerStat.uid !== process.getuid())
  )
    reject();
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (
    marker.token !== token ||
    marker.userDataPath !== root ||
    marker.source !== 'synthetic_only' ||
    marker.version !== 1
  )
    reject();
  return {
    environment: 'disposable_integration',
    configId: 'phi-notes-source-first',
    sourceFirstReconciliation: true,
    compactWriterContract: true,
    model: PHI_NOTES_EXPERIMENT_MODEL,
    digest: PHI_NOTES_EXPERIMENT_DIGEST,
  };
};
