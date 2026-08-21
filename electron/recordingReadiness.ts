import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { app, systemPreferences } from 'electron';
import { mlxPreview } from './transcription/mlxPreviewClient';
import type { ParakeetFinalClient } from './transcription/parakeetFinalClient';

export interface ReadinessStatus {
  ready: boolean;
  blockers: string[];
  details: {
    parakeetClient: boolean;
    parakeetModel: boolean;
    mlxAvailable: boolean;
    audiocapExists: boolean;
    audiocapExecutable: boolean;
    micPermission: boolean;
    systemAudioPermission: boolean;
  };
}

export async function getRecordingReadinessStatus(options: {
  parakeetFinalClient: ParakeetFinalClient | null;
  parakeetModelRoot: string;
  audiocapPath: string;
}): Promise<ReadinessStatus> {
  const details = {
    parakeetClient: false,
    parakeetModel: false,
    mlxAvailable: false,
    audiocapExists: false,
    audiocapExecutable: false,
    micPermission: false,
    systemAudioPermission: false,
  };
  const blockers: string[] = [];

  // Parakeet client
  details.parakeetClient = options.parakeetFinalClient !== null;
  if (!details.parakeetClient) {
    blockers.push('parakeet_client_missing');
  }

  // Parakeet model probe
  try {
    if (fs.existsSync(options.parakeetModelRoot)) {
      const files = fs.readdirSync(options.parakeetModelRoot);
      if (files.length > 0) {
        details.parakeetModel = true;
      }
    }
  } catch (e) {
    // Ignore
  }
  if (!details.parakeetModel) {
    blockers.push('parakeet_model_missing');
  }

  // MLX availability probe
  try {
    const health = await mlxPreview.health();
    if (health.engine !== 'unavailable') {
      details.mlxAvailable = true;
    }
  } catch (e) {
    // Ignore
  }

  if (process.arch === 'arm64' && !details.mlxAvailable) {
    // For Apple Silicon, we expect MLX to be available
    blockers.push('mlx_unavailable');
  } else if (process.arch !== 'arm64') {
    // For Intel, it's properly unavailable, so it shouldn't block recording
    details.mlxAvailable = true;
  }

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

  return {
    ready: blockers.length === 0,
    blockers,
    details,
  };
}

export async function prepareRecordingReadiness(options: {
  parakeetFinalClient: ParakeetFinalClient | null;
  parakeetModelRoot: string;
  audiocapPath: string;
}): Promise<ReadinessStatus> {
  try {
    await downloadNativeExecutables();
  } catch (e) {
    console.error('[Readiness] Native executables download failed:', e);
  }

  if (options.parakeetFinalClient) {
    try {
      await options.parakeetFinalClient.prepare();
    } catch (e) {
      console.error('[Readiness] Parakeet prepare failed:', e);
    }
  }

  if (process.arch === 'arm64') {
    try {
      await mlxPreview.prepareDiarizationModels();
    } catch (e) {
      console.error('[Readiness] MLX prepare failed:', e);
    }
  }

  return getRecordingReadinessStatus(options);
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
