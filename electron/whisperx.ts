/**
 * WhisperX Manager for Pluto
 * Manages the Python WhisperX server process and provides a TypeScript API.
 */

import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Agent } = require('undici') as {
  Agent: new (opts: { headersTimeout: number; bodyTimeout: number }) => any;
};

// Types
export interface WhisperXConfig {
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3';
  device: 'cpu' | 'cuda' | 'mps';
  computeType: 'float16' | 'float32' | 'int8';
  language?: string;
}

export interface TranscribeOptions {
  model?: WhisperXConfig['model'];
  language?: string;
  diarize?: boolean;
  hfToken?: string;
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
}

export interface HealthStatus {
  status: 'ok' | 'error';
  whisperx_version?: string;
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
  // WhisperX transcription can be long-running; increase headers/body timeouts
  // so undici doesn't fail before the server responds.
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout: 30 * 60 * 1000,
});

class WhisperXManager {
  private process: ChildProcess | null = null;
  private pythonPath: string = '';
  private port: number = WHISPERX_DEFAULT_PORT;
  private externalServer: boolean = false;

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
      console.log(`[WhisperX] Using bundled executable: ${bundledPath}`);
      return bundledPath;
    }

    // 2. Development: Use local venv
    const venvPython = path.join(this.getPythonDir(), 'venv', 'bin', 'python');
    if (fs.existsSync(venvPython)) {
      console.log(`[WhisperX] Using local venv execution: ${venvPython}`);
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

    const { execSync } = require('child_process');
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
    timeoutMs: number = 1000,
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
    maxAttempts: number = 20,
  ): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const candidate = preferredPort + i;
      if (await this.isPortAvailable(candidate)) {
        return candidate;
      }
    }
    throw new Error('No available port found for WhisperX server');
  }

  /**
   * Get the path to the Python directory
   */
  private getPythonDir(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'python');
    }
    return path.join(app.getAppPath(), 'python');
  }

  /**
   * Start the WhisperX Python server
   */
  private startPromise: Promise<void> | null = null;

  /**
   * Start the WhisperX Python server
   */
  async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      if (this.process || this.externalServer) {
        console.log('[WhisperX] Server already running');
        return;
      }

      try {
        const existingHealth = await this.healthOnPort(WHISPERX_DEFAULT_PORT);
        if (existingHealth.status === 'ok') {
          this.port = WHISPERX_DEFAULT_PORT;
          this.externalServer = true;
          console.log(`[WhisperX] Using existing server on port ${this.port}`);
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
              `WhisperX server script not found at ${serverPath}`,
            );
          }
          spawnArgs = [serverPath];
        } else {
          cwd = path.dirname(executable);
        }

        console.log(
          `[WhisperX] Starting server using: ${executable} ${spawnArgs.join(' ')} (port ${this.port})`,
        );

        // Detect ffmpeg path
        let ffmpegPath = '';
        try {
          ffmpegPath = require('ffmpeg-static');
          if (app.isPackaged) {
            ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
          }
          console.log(`[WhisperX] Using ffmpeg at: ${ffmpegPath}`);
        } catch (e) {
          console.warn('[WhisperX] Could not detect ffmpeg-static path', e);
        }

        // Set environment variables
        const env = {
          ...process.env,
          WHISPERX_PORT: this.port.toString(),
          PATH: ffmpegPath
            ? `${path.dirname(ffmpegPath)}:${process.env.PATH}`
            : process.env.PATH,
        };

        // Spawn the process
        this.process = spawn(executable, spawnArgs, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Log stdout
        this.process.stdout?.on('data', (data) => {
          console.log(`[WhisperX] ${data.toString().trim()}`);
        });

        // Log stderr
        this.process.stderr?.on('data', (data) => {
          console.error(`[WhisperX] ${data.toString().trim()}`);
        });

        // Handle process exit
        this.process.on('close', (code) => {
          console.log(`[WhisperX] Server exited with code ${code}`);
          this.process = null;
          this.startPromise = null; // Reset promise so it can be restarted
          this.externalServer = false;
        });

        this.process.on('error', (err) => {
          console.error(`[WhisperX] Failed to start server: ${err.message}`);
          this.process = null;
          this.startPromise = null;
          this.externalServer = false;
        });

        // Wait for server to be ready
        await this.waitForServer();

        console.log('[WhisperX] Server is ready');
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
    throw new Error('WhisperX server failed to start');
  }

  /**
   * Stop the WhisperX server
   */
  async stop(): Promise<void> {
    if (this.externalServer && !this.process) {
      console.log('[WhisperX] External server in use; skipping stop');
      return;
    }
    if (this.process) {
      console.log('[WhisperX] Stopping server');
      this.process.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Force kill if still running
      if (this.process) {
        this.process.kill('SIGKILL');
      }

      this.process = null;
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

  /**
   * Health check
   */
  async health(): Promise<HealthStatus> {
    return await this.healthOnPort(this.port, 2000);
  }

  /**
   * Transcribe an audio file
   */
  async transcribe(
    audioPath: string,
    options: TranscribeOptions = {},
  ): Promise<Transcript> {
    // Ensure server is running and ready
    await this.start();

    const response = await fetch(`${this.getBaseUrl()}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      dispatcher: WHISPERX_FETCH_AGENT,
      body: JSON.stringify({
        audio_path: audioPath,
        model: options.model,
        language: options.language,
        diarize: options.diarize,
        hf_token: options.hfToken,
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

  /**
   * Update server configuration
   */
  async setConfig(config: Partial<WhisperXConfig>): Promise<void> {
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
export const whisperX = new WhisperXManager();
