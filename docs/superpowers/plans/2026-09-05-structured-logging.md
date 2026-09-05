# Structured Application Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide structured, color-coded, scoped terminal logging for development, silent/rotating file logs in production, and demote high-churn startup logs (like database column migrations).

**Architecture:** A zero-dependency `electron/logger.ts` providing scoped logger instances with environment-aware transports (ANSI terminal for dev, rotating files in `~/Library/Logs/Pluto/main.log` for production), safe metadata/error serialization, and configurable log levels.

**Tech Stack:** TypeScript, Node.js (`node:fs`, `node:path`, `node:util`), Electron (`app.getPath('logs')`), Vitest.

---

### Task 1: Core Logger Module & Unit Tests

**Files:**
- Create: `electron/logger.ts`
- Create: `tests/unit/logger.test.ts`

- [ ] **Step 1: Write the failing unit tests for log level filtering and terminal formatting**

```ts
// tests/unit/logger.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createLogger, configureGlobalLogger, resetLoggerState } from '../../electron/logger';

describe('Logger', () => {
  beforeEach(() => {
    resetLoggerState();
  });

  it('filters messages below configured minLevel', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    configureGlobalLogger({ minLevel: 'info', useColors: false, writeToFile: false });

    const log = createLogger('TestScope');
    log.debug('this should be ignored');
    expect(stdoutSpy).not.toHaveBeenCalled();

    log.info('this should be printed');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy.mock.calls[0][0]).toContain('INFO');
    expect(stdoutSpy.mock.calls[0][0]).toContain('[TestScope]');
    expect(stdoutSpy.mock.calls[0][0]).toContain('this should be printed');

    stdoutSpy.mockRestore();
  });

  it('formats error stacks and metadata safely', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    configureGlobalLogger({ minLevel: 'debug', useColors: false, writeToFile: false });

    const log = createLogger('TestScope');
    const err = new Error('boom');
    log.error('failure occurred', err);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain('ERROR');
    expect(output).toContain('failure occurred');
    expect(output).toContain('boom');

    stderrSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/logger.test.ts`
Expected: FAIL (cannot find module `../../electron/logger`)

- [ ] **Step 3: Implement core logger in `electron/logger.ts`**

```ts
// electron/logger.ts
import util from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface GlobalLoggerConfig {
  minLevel?: LogLevel;
  useColors?: boolean;
  writeToFile?: boolean;
  logFilePath?: string;
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

// Global logger state
let currentConfig: Required<GlobalLoggerConfig> = {
  minLevel: 'info',
  useColors: true,
  writeToFile: false,
  logFilePath: '',
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxBackupFiles: 3,
};

export function resetLoggerState(): void {
  currentConfig = {
    minLevel: 'info',
    useColors: true,
    writeToFile: false,
    logFilePath: '',
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxBackupFiles: 3,
  };
}

export function configureGlobalLogger(config: GlobalLoggerConfig): void {
  currentConfig = { ...currentConfig, ...config };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/logger.ts tests/unit/logger.test.ts
git commit -m "feat(logger): implement core structured logger and level filtering (#756)"
```

---

### Task 2: Rotating File Transport & Safety in `electron/logger.ts`

**Files:**
- Modify: `electron/logger.ts`
- Modify: `tests/unit/logger.test.ts`

- [ ] **Step 1: Write unit tests for file writing and rotation in `tests/unit/logger.test.ts`**

```ts
it('rotates log files when size exceeds maxFileSizeBytes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-log-test-'));
  const logFile = path.join(tempDir, 'main.log');

  configureGlobalLogger({
    minLevel: 'info',
    writeToFile: true,
    logFilePath: logFile,
    maxFileSizeBytes: 100, // small limit to trigger rotation
    maxBackupFiles: 2,
    useColors: false,
  });

  const log = createLogger('RotationTest');
  log.info('A'.repeat(80));
  log.info('B'.repeat(80));

  expect(fs.existsSync(logFile)).toBe(true);
  expect(fs.existsSync(`${logFile}.1`)).toBe(true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/logger.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement file transport with safe rotation and catch guards in `electron/logger.ts`**

Add file rotation logic (`rotateLogsIfNeeded`), safe append with `fs.appendFileSync` in a `try/catch` block, and default log file path resolution using Electron `app.getPath('logs')` when available.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/logger.ts tests/unit/logger.test.ts
git commit -m "feat(logger): add bounded rotating file transport (#756)"
```

---

### Task 3: Initialize Global Logger in `electron/bootstrap.ts` & Stream Protection

**Files:**
- Modify: `electron/bootstrap.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Wire logger configuration in `electron/bootstrap.ts`**

Configure logger at the very entrypoint of Electron (`bootstrap.ts`) before any other modules load:
- If `!app.isPackaged`: console colors enabled, level from `process.env.PLUTO_LOG_LEVEL || 'info'`.
- If `app.isPackaged`: file logging enabled in `app.getPath('logs')/main.log`, console restricted to errors.
- Ensure stdout/stderr EPIPE / EIO handlers use safe logging.

- [ ] **Step 2: Run bootstrap tests**

Run: `pnpm vitest run tests/unit/appBootstrapBoundary.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/bootstrap.ts electron/main.ts
git commit -m "feat(logger): initialize global logger and stream protection in bootstrap (#756)"
```

---

### Task 4: Silence DB Migration Noise in `electron/db.ts`

**Files:**
- Modify: `electron/db.ts`

- [ ] **Step 1: Replace raw console.log with dbLogger.debug in `electron/db.ts`**

- Create `const dbLog = createLogger('DB');`
- Replace repetitive `console.log('[DB] Added ... column')` with `dbLog.debug('Added column', { column })`.
- Replace `console.log('[DB] Rebuilding meetings_fts with MID columns...')` with `dbLog.debug(...)`.
- Add milestone log: `dbLog.info('Database initialized and migrated');`
- Replace `console.warn('[DB] ...')` and `console.error('[DB] ...')` with `dbLog.warn(...)` and `dbLog.error(...)`.

- [ ] **Step 2: Run DB unit tests**

Run: `pnpm vitest run tests/unit/db.test.ts` (or relevant db tests)
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/db.ts
git commit -m "refactor(db): demote column migration noise to debug level (#756)"
```

---

### Task 5: Refactor Lifecycle & Subprocess Logging in `electron/main.ts`

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: Replace raw console.log in `electron/main.ts` for lifecycle and subprocesses**

- Create `plutoLog = createLogger('Pluto')`, `audioCapLog = createLogger('AudioCap')`, `recorderLog = createLogger('Recorder')`.
- Replace raw string logs with structured calls.
- Convert raw subprocess stderr data chunks into trimmed line logs.

- [ ] **Step 2: Run main process tests**

Run: `pnpm vitest run tests/unit/appRuntimePolicy.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "refactor(main): adopt scoped structured logging for lifecycle and subprocesses (#756)"
```

---

### Task 6: Decision Log & Changelog Fragment

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/756-structured-logging.md`

- [ ] **Step 1: Add decision entry in `docs/decisions.md`**

Document the durable decision:
- Status: Accepted
- Source: Issue #756
- Decision: Environment-aware structured logging (ANSI in dev, 5MB rotating files in `~/Library/Logs/Pluto/main.log` in packaged release, DB migration noise demoted to debug).

- [ ] **Step 2: Add changelog fragment and validate**

Create `docs/changelog/entries/756-structured-logging.md`.
Run: `pnpm run changelog:check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/decisions.md docs/changelog/entries/756-structured-logging.md
git commit -m "docs: record durable decision and changelog fragment for issue #756"
```

---

### Task 7: Full Verification & Pull Request Creation

- [ ] **Step 1: Run complete test suite**

Run: `pnpm vitest run`
Expected: ALL PASS

- [ ] **Step 2: Run biome linter and audit check**

Run: `pnpm run check` and `pnpm run audit:high`
Expected: PASS

- [ ] **Step 3: Push branch and create Pull Request**

Run: `git push origin feat/756-structured-logging`
Run: `gh pr create --repo metagrover/pluto --title "[Architecture] Structured application logging with environment-aware transports (#756)" --body "..."`
