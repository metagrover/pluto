/**
 * Transcription Manager for Pluto
 * Manages the Python transcription server process and provides a TypeScript API.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app } from 'electron';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Agent } = require('undici') as {
  Agent: new (opts: {
    headersTimeout: number;
    bodyTimeout: number;
  }) => unknown;
};

// Types
export interface TranscriptionEngineConfig {
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3';
  device: 'mlx';
  computeType: 'float16';
  language?: string;
}

export interface TranscribeOptions {
  model?: TranscriptionEngineConfig['model'];
  device?: TranscriptionEngineConfig['device'];
  computeType?: TranscriptionEngineConfig['computeType'];
  language?: string;
  diarize?: boolean;
  wordTimestamps?: boolean;
  initialPrompt?: string;
  vocabularyHintPolicyVersion?: string;
  vocabularyHintCount?: number;
  diarizationProvider?: 'sherpa_local';
  signal?: AbortSignal;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface Transcript {
  segments: TranscriptSegment[];
  language: string;
  duration: number;
  vad?: {
    status: 'speech' | 'no_speech' | 'failed';
    speechSeconds: number;
  };
}

export interface DiarizationResult {
  segments: Array<{ start: number; end: number; speaker: string }>;
  provider: 'sherpa-onnx';
  version: string;
  modelProvenance: {
    segmentationSha256: string;
    embeddingSha256: string;
  };
}

export type DiarizationModelReadiness =
  | {
      ready: true;
      provider: 'sherpa-onnx';
      runtimeVersion: string;
      bundleVersion: string;
      licenseIds: string[];
      generation: number;
      modelChecksums: string[];
    }
  | {
      ready: false;
      reason: string;
      operation?: 'idle' | 'preparing' | 'rolling_back';
      progress?: Array<{
        artifactId: string;
        receivedBytes: number;
        expectedBytes: number;
      }>;
    };

export interface AlignedEnergyResult {
  schemaVersion: 1;
  windows: Array<{
    startTime: number;
    endTime: number;
    micRms: number;
    systemRms: number;
  }>;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  engine?: 'mlx_whisper' | 'unavailable';
  mlx_available?: boolean;
  device?: string;
  model?: string;
  model_loaded?: boolean;
  error?: string;
}

// Constants
const WHISPERX_DEFAULT_PORT = 5123;
const HEALTH_CHECK_INTERVAL = 1000;
const MAX_HEALTH_CHECK_RETRIES = 30;
const WHISPERX_FETCH_AGENT = new Agent({
  // transcription can be long-running; increase headers/body timeouts
  // so undici doesn't fail before the server responds.
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 30 * 60 * 1000,
});

export class TranscriptionManager {
  private process: ChildProcess | null = null;
  private pythonPath = '';
  private port: number = WHISPERX_DEFAULT_PORT;
  private externalServer = false;
  private appliedConfig: Partial<TranscriptionEngineConfig> = {};
  private recyclePromise: Promise<boolean> | null = null;

  constructor() {
    this.detectExecutable();
  }

  /**
   * Detect the best available Python path
   */
  /**
   * Check if Python or bundled executable is available and functional
   */
  async checkPython(): Promise<{
    available: boolean;
    version?: string;
    error?: string;
  }> {
    const executable = this.detectExecutable();

    return new Promise((resolve) => {
      // For bundled binary, we might not have --version working same way,
      // but for venv python it will.
      const checkProcess = spawn(executable, ['--version']);
      let output = '';

      checkProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      checkProcess.stderr?.on('data', (data) => {
        output += data.toString();
      });

      checkProcess.on('close', (code) => {
        if (code === 0) {
          const version =
            output.trim() || (app.isPackaged ? 'Bundled Engine' : 'Python 3');
          resolve({ available: true, version });
        } else if (
          app.isPackaged &&
          code === 1 &&
          output.includes('whisperx_server')
        ) {
          // Some executables might exit with 1 on --version if not explicitly handled,
          // but if it's packaged we can be more lenient if the file exists.
          resolve({ available: true, version: 'Bundled Engine' });
        } else {
          resolve({
            available: false,
            error: `Executable check failed with code ${code}: ${output}`,
          });
        }
      });

      checkProcess.on('error', (err) => {
        resolve({ available: false, error: err.message });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!checkProcess.killed) {
          checkProcess.kill();
          resolve({ available: false, error: 'Check timed out' });
        }
      }, 5000);
    });
  }

  /**
   * Detect the best available Python path or bundled executable
   */
  private detectExecutable(): string {
    // 1. Production: Use bundled executable (directory build)
    if (app.isPackaged) {
      const bundledPath = path.join(
        process.resourcesPath,
        'bin',
        'whisperx_server',
        'whisperx_server',
      );
      console.log(`[Transcription] Using bundled executable: ${bundledPath}`);
      return bundledPath;
    }

    // 2. Development: Use local venv
    const venvPython = path.join(this.getPythonDir(), 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
      console.log(`[Transcription] Using local venv execution: ${venvPython}`);
      this.pythonPath = venvPython;
      return venvPython; // This will be used as the executable to spawn
    }

    // 3. Environment variable fallback
    if (process.env.PLUTO_PYTHON_PATH) {
      return process.env.PLUTO_PYTHON_PATH;
    }

    // 4. Fallback to system python detection (legacy behavior, mostly for manual setups)
    return this.detectSystemPython();
  }

  private detectSystemPython(): string {
    if (this.pythonPath) return this.pythonPath;

    const { execSync } = require('node:child_process');
    const tryNames = ['python3.12', 'python3.11', 'python3', 'python'];
    for (const name of tryNames) {
      try {
        const path = execSync(`which ${name}`).toString().trim();
        if (path) {
          this.pythonPath = path;
          return path;
        }
      } catch (e) {
        // ignore
      }
    }
    return 'python3';
  }

  private getBaseUrl(port: number = this.port): string {
    return `http://127.0.0.1:${port}`;
  }

  private async healthOnPort(
    port: number,
    timeoutMs = 1000,
  ): Promise<HealthStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.getBaseUrl(port)}/health`, {
        signal: controller.signal,
      } as RequestInit);
      if (!response.ok) {
        return { status: 'error', error: `HTTP ${response.status}` };
      }
      return await response.json();
    } catch (e) {
      return { status: 'error', error: (e as Error).message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  private async findAvailablePort(
    preferredPort: number,
    maxAttempts = 20,
  ): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = preferredPort + i;
      if (await this.isPortAvailable(candidate)) {
        return candidate;
      }
    }
    throw new Error('No available port found for transcription server');
  }

  /**
   * Get the path to the Python directory
   */
  private getPythonDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'python');
    }
    const appPath = app.getAppPath();
    const directPath = path.join(appPath, 'python');
    if (fs.existsSync(directPath)) return directPath;
    const parentPath = path.join(appPath, '..', 'python');
    if (fs.existsSync(parentPath)) return parentPath;
    return path.join(process.cwd(), 'python');
  }

  /**
   * Start the local transcription server
   */
  private startPromise: Promise<void> | null = null;

  /**
   * Start the local transcription server
   */
  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      if (this.process || this.externalServer) {
        console.log('[Transcription] Server already running');
        return;
      }

      try {
        const existingHealth = await this.healthOnPort(WHISPERX_DEFAULT_PORT);
        if (existingHealth.status === 'ok') {
          this.port = WHISPERX_DEFAULT_PORT;
          this.externalServer = true;
          console.log(
            `[Transcription] Using existing server on port ${this.port}`,
          );
          return;
        }

        this.port = await this.findAvailablePort(WHISPERX_DEFAULT_PORT);

        const executable = this.detectExecutable();
        let spawnArgs: string[] = [];
        let cwd = this.getPythonDir();

        // If in dev (using python interpreter), we need to pass the script script
        if (!app.isPackaged) {
          const serverPath = path.join(cwd, 'whisperx_server.py');
          if (!fs.existsSync(serverPath)) {
            throw new Error(
              `transcription server script not found at ${serverPath}`,
            );
          }
          spawnArgs = [serverPath];
        } else {
          cwd = path.dirname(executable);
        }

        console.log(
          `[Transcription] Starting server using: ${executable} ${spawnArgs.join(' ')} (port ${this.port})`,
        );

        // Detect ffmpeg path
        let ffmpegPath = '';
        try {
          ffmpegPath = require('ffmpeg-static');
          if (app.isPackaged) {
            ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
          }
          console.log(`[Transcription] Using ffmpeg at: ${ffmpegPath}`);
        } catch (e) {
          console.warn(
            '[Transcription] Could not detect ffmpeg-static path',
            e,
          );
        }

        // Set environment variables
        const env = {
          ...process.env,
          WHISPERX_PORT: this.port.toString(),
          PLUTO_SPEAKER_MODELS_DIR: path.join(
            app.getPath('userData'),
            'models',
            'speaker-attribution',
          ),
          PLUTO_MEETINGS_DIR: path.join(app.getPath('userData'), 'meetings'),
          PATH: ffmpegPath
            ? `${path.dirname(ffmpegPath)}:${process.env.PATH}`
            : process.env.PATH,
        };

        // Spawn the process
        const child = spawn(executable, spawnArgs, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.process = child;

        // Log stdout
        child.stdout?.on('data', (data) => {
          console.log(`[Transcription] ${data.toString().trim()}`);
        });

        // Log stderr
        child.stderr?.on('data', (data) => {
          console.error(`[Transcription] ${data.toString().trim()}`);
        });

        // Handle process exit
        child.on('close', (code) => {
          console.log(`[Transcription] Server exited with code ${code}`);
          if (this.process === child) {
            this.process = null;
            this.startPromise = null; // Reset promise so it can be restarted
            this.externalServer = false;
            this.appliedConfig = {};
          }
        });

        child.on('error', (err) => {
          console.error(
            `[Transcription] Failed to start server: ${err.message}`,
          );
          if (this.process === child) {
            this.process = null;
            this.startPromise = null;
            this.externalServer = false;
            this.appliedConfig = {};
          }
        });

        // Wait for server to be ready
        await this.waitForServer();

        console.log('[Transcription] Server is ready');
      } catch (e) {
        this.startPromise = null;
        throw e;
      }
    })();

    return this.startPromise;
  }

  /**
   * Wait for the server to be ready
   */
  private async waitForServer(): Promise<void> {
    for (let i = 0; i < MAX_HEALTH_CHECK_RETRIES; i++) {
      try {
        const health = await this.health();
        if (health.status === 'ok') {
          return;
        }
      } catch (e) {
        // Server not ready yet
      }
      await new Promise((resolve) =>
        setTimeout(resolve, HEALTH_CHECK_INTERVAL),
      );
    }
    throw new Error('transcription server failed to start');
  }

  /**
   * Stop the transcription server
   */
  async stop(): Promise<void> {
    if (this.externalServer && !this.process) {
      console.log('[Transcription] External server in use; skipping stop');
      return;
    }
    if (this.process) {
      console.log('[Transcription] Stopping server');
      const child = this.process;
      const closed = new Promise<void>((resolve) => {
        child.once('close', () => resolve());
      });
      child.kill('SIGTERM');

      // Wait for graceful shutdown
      await Promise.race([
        closed,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);

      // Force kill if still running
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await closed;
      }

      if (this.process === child) {
        this.process = null;
        this.appliedConfig = {};
      }
    }
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return (
      (this.process !== null && !this.process.killed) || this.externalServer
    );
  }

  ownsRunningProcess(): boolean {
    return (
      this.process !== null && !this.process.killed && !this.externalServer
    );
  }

  async recycleOwnedProcessIf(safeToRecycle: () => boolean): Promise<boolean> {
    if (this.recyclePromise) return await this.recyclePromise;
    if (!this.ownsRunningProcess()) return false;
    this.recyclePromise = (async () => {
      if (!safeToRecycle()) return false;
      await this.stop();
      return true;
    })();
    try {
      return await this.recyclePromise;
    } finally {
      this.recyclePromise = null;
    }
  }

  /**
   * Health check
   */
  async health(): Promise<HealthStatus> {
    return await this.healthOnPort(this.port, 2000);
  }

  private async applyConfigFromOptions(
    options: TranscribeOptions,
  ): Promise<void> {
    const next: Partial<TranscriptionEngineConfig> = {};
    if (options.model) next.model = options.model;
    if (options.device) next.device = options.device;
    if (options.computeType) next.computeType = options.computeType;
    if (options.language) next.language = options.language;

    const keys = Object.keys(next) as Array<keyof TranscriptionEngineConfig>;
    const needsUpdate = keys.some(
      (key) => this.appliedConfig[key] !== next[key],
    );
    if (!needsUpdate) return;

    await this.setConfig(next);
    this.appliedConfig = { ...this.appliedConfig, ...next };
  }

  /**
   * Transcribe an audio file
   */
  async transcribe(
    audioPath: string,
    options: TranscribeOptions = {},
  ): Promise<Transcript> {
    if (this.recyclePromise) await this.recyclePromise;
    // Ensure server is running and ready
    await this.start();
    await this.applyConfigFromOptions(options);

    const response = await fetch(`${this.getBaseUrl()}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      dispatcher: WHISPERX_FETCH_AGENT,
      signal: options.signal,
      body: JSON.stringify({
        audio_path: audioPath,
        language: options.language,
        diarize: options.diarize,
        word_timestamps: options.wordTimestamps,
        initial_prompt: options.initialPrompt,
      }),
    } as RequestInit & { dispatcher: typeof WHISPERX_FETCH_AGENT });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(
        error.error || `Transcription failed: ${response.status}`,
      );
    }

    return await response.json();
  }

  async diarize(
    audioPath: string,
    signal?: AbortSignal,
  ): Promise<DiarizationResult> {
    await this.start();
    const response = await fetch(`${this.getBaseUrl()}/diarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      dispatcher: WHISPERX_FETCH_AGENT,
      signal,
      body: JSON.stringify({ audio_path: audioPath }),
    } as RequestInit & { dispatcher: typeof WHISPERX_FETCH_AGENT });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(error.detail || `Diarization failed: ${response.status}`);
    }
    return (await response.json()) as DiarizationResult;
  }

  async getDiarizationModelReadiness(): Promise<DiarizationModelReadiness> {
    await this.start();
    const response = await fetch(
      `${this.getBaseUrl()}/diarization/models/status`,
    );
    if (!response.ok) {
      throw new Error(`Diarization readiness failed: ${response.status}`);
    }
    return (await response.json()) as DiarizationModelReadiness;
  }

  async prepareDiarizationModels(): Promise<DiarizationModelReadiness> {
    await this.start();
    const response = await fetch(
      `${this.getBaseUrl()}/diarization/models/prepare`,
      { method: 'POST' },
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        error.detail ||
          `Diarization model preparation failed: ${response.status}`,
      );
    }
    return (await response.json()) as DiarizationModelReadiness;
  }

  async rollbackDiarizationModels(): Promise<DiarizationModelReadiness> {
    await this.start();
    const response = await fetch(
      `${this.getBaseUrl()}/diarization/models/rollback`,
      { method: 'POST' },
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        error.detail || `Diarization model rollback failed: ${response.status}`,
      );
    }
    return (await response.json()) as DiarizationModelReadiness;
  }

  async getAlignedEnergy(
    micAudioPath: string,
    systemAudioPath: string,
  ): Promise<AlignedEnergyResult> {
    await this.start();
    const response = await fetch(
      `${this.getBaseUrl()}/attribution/aligned-energy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mic_audio_path: micAudioPath,
          system_audio_path: systemAudioPath,
        }),
      },
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        detail?: string;
      };
      throw new Error(
        error.detail || `Aligned energy failed: ${response.status}`,
      );
    }
    return (await response.json()) as AlignedEnergyResult;
  }

  /**
   * Update server configuration
   */
  async setConfig(config: Partial<TranscriptionEngineConfig>): Promise<void> {
    const response = await fetch(`${this.getBaseUrl()}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        device: config.device,
        compute_type: config.computeType,
        language: config.language,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(
        error.error || `Config update failed: ${response.status}`,
      );
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<
    Array<{ id: string; size: string; speed: string; quality: string }>
  > {
    const response = await fetch(`${this.getBaseUrl()}/models`);
    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }
    const data = await response.json();
    return data.models;
  }
}

// Export singleton instance
// Compatibility export while callers migrate away from the historical name.
export { TranscriptionManager as WhisperXManager };
export const whisperX = new TranscriptionManager();
