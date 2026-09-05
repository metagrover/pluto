# Design Spec: Structured Application Logging with Environment-Aware Transports

- **Issue:** [#756](https://github.com/metagrover/pluto/issues/756)
- **Status:** Approved
- **Date:** 2026-09-05

## 1. Overview & Goals

Pluto's Electron main process currently relies on uncoordinated `console.log`, `console.warn`, and `console.error` calls. During startup, components like `electron/db.ts` print upwards of 80 individual column checks, flooding the terminal. Furthermore, in packaged production releases, writing directly to stdout/stderr can cause broken pipe errors (`EPIPE` / `EIO`) when detached from a TTY, and there is no standard macOS file log (`~/Library/Logs/Pluto/main.log`) to assist with troubleshooting.

This specification introduces a zero-dependency, structured logger (`electron/logger.ts`) with:
1. **Developer Experience (DEV)**: Pretty, color-coded, readable terminal logs with timestamps (`HH:mm:ss.SSS`), level badges, and bright subsystem scopes (e.g. `[DB]`, `[Capture]`, `[AudioCap]`, `[Parakeet]`).
2. **Noise Reduction**: Demoting repetitive startup checks (such as DB column migrations) to `debug` so DEV terminal stays clean and focused on actual lifecycle milestones.
3. **Production File Transport**: Rotated log files in `~/Library/Logs/Pluto/main.log` (5MB cap, up to 3 archives), with console output silenced or restricted to `error`.
4. **Safety & Zero-Crash Guarantee**: Safe serialization of error objects and metadata, with internal catch guards against EPIPE/EIO and filesystem errors.

---

## 2. Log Levels & Environment Policies

### Log Levels
Severity ranking (ascending):
- `debug` (0)
- `info` (1)
- `warn` (2)
- `error` (3)
- `silent` (4)

Configurable via `process.env.PLUTO_LOG_LEVEL` (accepts `debug`, `info`, `warn`, `error`, `silent`).

### Environment Matrix

| Environment | Console Transport | File Transport (`~/Library/Logs/Pluto/main.log`) | Default Level |
| :--- | :--- | :--- | :--- |
| **Development** (`!app.isPackaged`) | Enabled with ANSI color formatting | Disabled by default (enabled if `PLUTO_FILE_LOGS=1`) | `info` |
| **Production** (`app.isPackaged`) | Filtered to `error` only (safe for detached TTY) | Enabled (rotating 5MB files, 3 archives) | `info` |
| **Test** (`NODE_ENV === 'test'`) | Silent by default (or configurable in test harnesses) | Disabled | `silent` or test-specific |

---

## 3. Logger API Contract

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  scope?: string;
  minLevel?: LogLevel;
  consoleEnabled?: boolean;
  fileLogPath?: string;
  maxFileSizeBytes?: number;
  maxBackupFiles?: number;
}

export interface ILogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, errorOrMeta?: unknown): void;
  withScope(subScope: string): ILogger;
}
```

Usage pattern across Electron modules:
```ts
import { createLogger } from './logger';

const log = createLogger('DB');
log.info('Database schema initialized', { tableCount: 14 });
log.debug('Checking column existence', { column: 'analysis_json' });
log.warn('FTS index rebuild required');
log.error('Migration failed', err);
```

---

## 4. Presentation & Formatting

### DEV Terminal Format
`HH:mm:ss.SSS LEVEL [Scope] Message { ...meta }`

ANSI Escapes:
- Timestamp: Dim gray (`\x1b[90m`)
- Levels:
  - `DEBUG`: Magenta (`\x1b[35mDEBUG\x1b[0m`)
  - `INFO `: Green (`\x1b[32mINFO \x1b[0m`)
  - `WARN `: Yellow (`\x1b[33mWARN \x1b[0m`)
  - `ERROR`: Bold Red (`\x1b[1;31mERROR\x1b[0m`)
- Scope: Cyan (`\x1b[36m[DB]\x1b[0m`)
- Message: White/Default (`\x1b[37m` or reset)
- Metadata: Dim JSON or serialized error stacks

### Production File Format
Standard readable timestamped entries:
`YYYY-MM-DDTHH:mm:ss.SSSZ [LEVEL] [Scope] Message { "meta": "..." }\n`

---

## 5. File Transport & Rotation Details

- **File Path**: Resolves from `app.getPath('logs')` (macOS default: `~/Library/Logs/Pluto/main.log`). If Electron `app` is unavailable (e.g. isolated test environments), falls back to temporary or specified directory.
- **Rotation Strategy**:
  - Max file size: 5 MB (`5 * 1024 * 1024` bytes).
  - Max backups: 3 (`main.1.log`, `main.2.log`, `main.3.log`).
  - When size threshold is crossed:
    - If `main.3.log` exists, it is deleted.
    - `main.2.log` -> `main.3.log`
    - `main.1.log` -> `main.2.log`
    - `main.log` -> `main.1.log`
    - A new `main.log` is opened.
- **Fault-Tolerance**:
  - File operations use `fs.appendFileSync` or safe write streams wrapped in `try/catch`. If file writing fails (e.g., read-only filesystem or disk full), the error is caught silently to prevent process termination.

---

## 6. Subsystem Noise Reduction Plan

1. **`electron/db.ts`**:
   - Change table/column migration checks from raw `console.log` to `log.debug(...)`.
   - On completion of migrations, log a single high-level `log.info('Database schema initialized', { durationMs })`.
2. **`electron/main.ts`**:
   - Convert process startup, shutdown, recorder, and AudioCap lifecycle logs to `createLogger('Pluto')`, `createLogger('Recorder')`, `createLogger('AudioCap')`.
   - Convert stderr dumps from spawned processes to structured `log.warn(...)` or `log.error(...)` lines instead of raw terminal writes.

---

## 7. Verification Strategy

1. **Unit Tests (`vitest`)**:
   - Test log level filtering (`debug` omitted when minLevel is `info`).
   - Test formatting with ANSI colors and without colors.
   - Test file transport writing and automatic rotation at size limits.
   - Test safe error serialization (stacks, error codes, circular objects).
   - Test that logger calls never throw even if file write or stdout write errors.
2. **Integration Verification**:
   - Run `pnpm vitest` to ensure entire test suite passes.
   - Run dev preview/build to verify clean startup output in terminal.
