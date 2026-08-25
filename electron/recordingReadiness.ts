import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { app, systemPreferences } from 'electron';
import type { TranscriptionRuntimeHealth } from '../src/services/transcription/contracts';
import type { ParakeetFinalClient } from './transcription/parakeetFinalClient';

export interface ReadinessStatus {
  ready: boolean;
  blockers: string[];
  details: {
    parakeetClient: boolean;
    parakeetModel: boolean;
    parakeetEouReady: boolean;
    audiocapExists: boolean;
    audiocapExecutable: boolean;
    micPermission: boolean;
    systemAudioPermission: boolean;
  };
}

type ReadinessOptions = {
  parakeetFinalClient: ParakeetFinalClient | null;
  parakeetModelRoot: string;
  audiocapPath: string;
};

const verifiedCapabilities = new WeakMap<
  ParakeetFinalClient,
  Promise<TranscriptionRuntimeHealth>
>();

const evaluateRecordingReadiness = (
  options: ReadinessOptions,
  capability: TranscriptionRuntimeHealth | null,
): ReadinessStatus => {
  const details = {
    parakeetClient: options.parakeetFinalClient !== null,
    parakeetModel:
      capability?.ready === true &&
      capability.engine === 'parakeet_coreml' &&
      typeof capability.modelVersion === 'string' &&
      capability.modelVersion.length > 0,
    parakeetEouReady:
      capability?.ready === true &&
      capability.liveEngine === 'parakeet_eou_320ms',
    audiocapExists: false,
    audiocapExecutable: false,
    micPermission: false,
    systemAudioPermission: false,
  };
  const blockers: string[] = [];

  if (!details.parakeetClient) {
    blockers.push('parakeet_client_missing');
  }
  if (!details.parakeetModel) {
    blockers.push('parakeet_model_missing');
  }
  if (!details.parakeetEouReady) blockers.push('parakeet_eou_unavailable');

  // Audiocap
  try {
    if (fs.existsSync(options.audiocapPath)) {
      details.audiocapExists = true;
      try {
        fs.accessSync(options.audiocapPath, fs.constants.X_OK);
        details.audiocapExecutable = true;
      } catch (e) {
        blockers.push('audiocap_not_executable');
      }
    } else {
      blockers.push('audiocap_missing');
    }
  } catch (e) {
    blockers.push('audiocap_missing');
  }

  // Permissions
  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus === 'granted') {
    details.micPermission = true;
  } else {
    blockers.push('mic_permission_missing');
  }

  // System audio
  if (process.platform !== 'darwin') {
    details.systemAudioPermission = true;
  } else {
    const systemAudioStatus = systemPreferences.getMediaAccessStatus('screen');
    if (systemAudioStatus === 'granted') {
      details.systemAudioPermission = true;
    } else {
      blockers.push('system_audio_permission_missing');
    }
  }

  void options.parakeetModelRoot;
  return {
    ready: blockers.length === 0,
    blockers,
    details,
  };
};

const prepareParakeetCapability = async (
  client: ParakeetFinalClient | null,
): Promise<TranscriptionRuntimeHealth | null> => {
  if (!client) return null;
  const existing = verifiedCapabilities.get(client);
  if (existing) return await existing;
  const preparation = client.prepare();
  verifiedCapabilities.set(client, preparation);
  try {
    return await preparation;
  } catch (error) {
    verifiedCapabilities.delete(client);
    console.error('[Readiness] Parakeet prepare failed:', error);
    return null;
  }
};

export async function getRecordingReadinessStatus(
  options: ReadinessOptions,
): Promise<ReadinessStatus> {
  return evaluateRecordingReadiness(
    options,
    await prepareParakeetCapability(options.parakeetFinalClient),
  );
}

export async function prepareRecordingReadiness(
  options: ReadinessOptions,
): Promise<ReadinessStatus> {
  try {
    await downloadNativeExecutables();
  } catch (e) {
    console.error('[Readiness] Native executables download failed:', e);
  }

  const capability = await prepareParakeetCapability(
    options.parakeetFinalClient,
  );
  return evaluateRecordingReadiness(options, capability);
}

function downloadBinary(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return downloadBinary(res.headers.location as string, dest)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(
            new Error(`Failed to download binary: ${res.statusCode}`),
          );
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          // chmod +x
          fs.chmodSync(dest, 0o755);
          // strip quarantine
          execFile('xattr', ['-d', 'com.apple.quarantine', dest], () => {
            // Ignore error if attribute doesn't exist
            resolve();
          });
        });
      })
      .on('error', () => {
        fs.unlink(dest, () => reject(new Error('Failed to download binary')));
      });
  });
}

export async function downloadNativeExecutables(): Promise<void> {
  const binDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const BASE_URL =
    'https://github.com/metagrover/pluto/releases/latest/download';

  const audiocapUrl = `${BASE_URL}/audiocap`;
  const audiocapDest = path.join(binDir, 'audiocap');

  const parakeetUrl = `${BASE_URL}/parakeet-runtime`;
  const parakeetDest = path.join(binDir, 'parakeet-runtime');

  await Promise.all([
    downloadBinary(audiocapUrl, audiocapDest).catch((e) =>
      console.warn('Failed to download audiocap:', e),
    ),
    downloadBinary(parakeetUrl, parakeetDest).catch((e) =>
      console.warn('Failed to download parakeet-runtime:', e),
    ),
  ]);
}
