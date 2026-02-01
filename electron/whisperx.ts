/**
 * WhisperX Manager for Pluto
 * Manages the Python WhisperX server process and provides a TypeScript API.
 */

import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// Types
export interface WhisperXConfig {
    model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3'
    device: 'cpu' | 'cuda' | 'mps'
    computeType: 'float16' | 'float32' | 'int8'
    language?: string
}

export interface TranscribeOptions {
    model?: WhisperXConfig['model']
    language?: string
    diarize?: boolean
    hfToken?: string
}

export interface TranscriptSegment {
    start: number
    end: number
    text: string
    speaker?: string
    words?: Array<{
        word: string
        start: number
        end: number
    }>
}

export interface Transcript {
    segments: TranscriptSegment[]
    language: string
    duration: number
}

export interface HealthStatus {
    status: 'ok' | 'error'
    whisperx_version?: string
    device?: string
    model?: string
    model_loaded?: boolean
    error?: string
}

// Constants
const WHISPERX_PORT = 5123
const WHISPERX_URL = `http://127.0.0.1:${WHISPERX_PORT}`
const HEALTH_CHECK_INTERVAL = 2000
const MAX_HEALTH_CHECK_RETRIES = 60

class WhisperXManager {
    private process: ChildProcess | null = null
    private isStarting = false
    private pythonPath: string = ''

    constructor() {
        this.detectPython()
    }

    /**
     * Detect the best available Python path
     */
    private detectPython(): string {
        if (this.pythonPath) return this.pythonPath

        // 1. Check environment variable
        if (process.env.PLUTO_PYTHON_PATH) {
            console.log(`[WhisperX] Using Python from PLUTO_PYTHON_PATH: ${process.env.PLUTO_PYTHON_PATH}`)
            this.pythonPath = process.env.PLUTO_PYTHON_PATH
            return this.pythonPath
        }

        const { execSync } = require('child_process')

        // 2. Try common names and specific versions
        const tryNames = ['python3.12', 'python3.11', 'python3', 'python']
        for (const name of tryNames) {
            try {
                const path = execSync(`which ${name}`).toString().trim()
                if (path) {
                    // Check if whisperx is actually in this python
                    execSync(`${path} -c "import whisperx"`)
                    console.log(`[WhisperX] Detected Python path with whisperx: ${path}`)
                    this.pythonPath = path
                    return path
                }
            } catch (e) {
                // version doesn't exist or whisperx not installed
            }
        }

        // 3. Fallback
        this.pythonPath = 'python3'
        console.warn(`[WhisperX] Could not detect Python with whisperx, falling back to: ${this.pythonPath}`)
        return this.pythonPath
    }

    /**
     * Get the path to the Python directory
     */
    private getPythonDir(): string {
        if (app.isPackaged) {
            return path.join(process.resourcesPath, 'python')
        }
        return path.join(app.getAppPath(), 'python')
    }

    /**
     * Check if Python is available
     */
    async checkPython(): Promise<{ available: boolean; version?: string; error?: string }> {
        return new Promise((resolve) => {
            const python = spawn(this.pythonPath, ['--version'])
            let output = ''

            python.stdout?.on('data', (data) => {
                output += data.toString()
            })

            python.stderr?.on('data', (data) => {
                output += data.toString()
            })

            python.on('close', (code) => {
                if (code === 0) {
                    const version = output.trim().replace('Python ', '')
                    resolve({ available: true, version })
                } else {
                    resolve({ available: false, error: 'Python not found' })
                }
            })

            python.on('error', (err) => {
                resolve({ available: false, error: err.message })
            })
        })
    }

    /**
     * Start the WhisperX Python server
     */
    async start(): Promise<void> {
        if (this.process || this.isStarting) {
            console.log('[WhisperX] Server already running or starting')
            return
        }

        this.isStarting = true
        this.detectPython()

        try {
            const pythonDir = this.getPythonDir()
            const serverPath = path.join(pythonDir, 'whisperx_server.py')

            if (!fs.existsSync(serverPath)) {
                throw new Error(`WhisperX server not found at ${serverPath}`)
            }

            console.log(`[WhisperX] Starting server from ${serverPath}`)

            // Set environment variables
            const env = {
                ...process.env,
                WHISPERX_PORT: WHISPERX_PORT.toString(),
            }

            // Spawn the Python process
            this.process = spawn(this.detectPython(), [serverPath], {
                cwd: pythonDir,
                env,
                stdio: ['ignore', 'pipe', 'pipe']
            })

            // Log stdout
            this.process.stdout?.on('data', (data) => {
                console.log(`[WhisperX] ${data.toString().trim()}`)
            })

            // Log stderr
            this.process.stderr?.on('data', (data) => {
                console.error(`[WhisperX] ${data.toString().trim()}`)
            })

            // Handle process exit
            this.process.on('close', (code) => {
                console.log(`[WhisperX] Server exited with code ${code}`)
                this.process = null
            })

            this.process.on('error', (err) => {
                console.error(`[WhisperX] Failed to start server: ${err.message}`)
                this.process = null
            })

            // Wait for server to be ready
            await this.waitForServer()

            console.log('[WhisperX] Server is ready')
        } finally {
            this.isStarting = false
        }
    }

    /**
     * Wait for the server to be ready
     */
    private async waitForServer(): Promise<void> {
        for (let i = 0; i < MAX_HEALTH_CHECK_RETRIES; i++) {
            try {
                const health = await this.health()
                if (health.status === 'ok') {
                    return
                }
            } catch (e) {
                // Server not ready yet
            }
            await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL))
        }
        throw new Error('WhisperX server failed to start')
    }

    /**
     * Stop the WhisperX server
     */
    async stop(): Promise<void> {
        if (this.process) {
            console.log('[WhisperX] Stopping server')
            this.process.kill('SIGTERM')

            // Wait for graceful shutdown
            await new Promise(resolve => setTimeout(resolve, 1000))

            // Force kill if still running
            if (this.process) {
                this.process.kill('SIGKILL')
            }

            this.process = null
        }
    }

    /**
     * Check if the server is running
     */
    isRunning(): boolean {
        return this.process !== null && !this.process.killed
    }

    /**
     * Health check
     */
    async health(): Promise<HealthStatus> {
        try {
            const response = await fetch(`${WHISPERX_URL}/health`)
            if (!response.ok) {
                return { status: 'error', error: `HTTP ${response.status}` }
            }
            return await response.json()
        } catch (e) {
            return { status: 'error', error: (e as Error).message }
        }
    }

    /**
     * Transcribe an audio file
     */
    async transcribe(audioPath: string, options: TranscribeOptions = {}): Promise<Transcript> {
        // Ensure server is running
        if (!this.isRunning()) {
            await this.start()
        }

        const response = await fetch(`${WHISPERX_URL}/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                audio_path: audioPath,
                model: options.model,
                language: options.language,
                diarize: options.diarize,
                hf_token: options.hfToken
            })
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
            throw new Error(error.error || `Transcription failed: ${response.status}`)
        }

        return await response.json()
    }

    /**
     * Update server configuration
     */
    async setConfig(config: Partial<WhisperXConfig>): Promise<void> {
        const response = await fetch(`${WHISPERX_URL}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model,
                device: config.device,
                compute_type: config.computeType,
                language: config.language
            })
        })

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
            throw new Error(error.error || `Config update failed: ${response.status}`)
        }
    }

    /**
     * List available models
     */
    async listModels(): Promise<Array<{ id: string; size: string; speed: string; quality: string }>> {
        const response = await fetch(`${WHISPERX_URL}/models`)
        if (!response.ok) {
            throw new Error(`Failed to list models: ${response.status}`)
        }
        const data = await response.json()
        return data.models
    }
}

// Export singleton instance
export const whisperX = new WhisperXManager()
