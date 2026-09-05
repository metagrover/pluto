import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureGlobalLogger,
  createLogger,
  getEffectiveLogLevel,
  initializeElectronLogging,
  resetLoggerState,
} from '../../electron/logger';

describe('electron/logger', () => {
  beforeEach(() => {
    resetLoggerState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters messages below configured minLevel', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    configureGlobalLogger({
      minLevel: 'info',
      useColors: false,
      writeToFile: false,
    });

    const log = createLogger('TestScope');
    log.debug('this should be ignored');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();

    log.info('this should be printed');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const line = String(stdoutSpy.mock.calls[0][0]);
    expect(line).toContain('INFO');
    expect(line).toContain('[TestScope]');
    expect(line).toContain('this should be printed');
  });

  it('routes warn and error to stderr', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    configureGlobalLogger({
      minLevel: 'debug',
      useColors: false,
      writeToFile: false,
    });

    const log = createLogger('Alert');
    log.warn('warning message');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0][0])).toContain('WARN');
    expect(String(stderrSpy.mock.calls[0][0])).toContain('warning message');

    log.error('error message');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(String(stderrSpy.mock.calls[1][0])).toContain('ERROR');
    expect(String(stderrSpy.mock.calls[1][0])).toContain('error message');
  });

  it('safely serializes errors and metadata', () => {
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    configureGlobalLogger({
      minLevel: 'debug',
      useColors: false,
      writeToFile: false,
    });

    const log = createLogger('ErrorTest');
    const testErr = new Error('Database locked');
    log.error('Query failed', testErr);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const output = String(stderrSpy.mock.calls[0][0]);
    expect(output).toContain('Query failed');
    expect(output).toContain('Database locked');
    expect(output).toContain('Error: Database locked');
  });

  it('supports child scopes via withScope', () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    configureGlobalLogger({
      minLevel: 'info',
      useColors: false,
      writeToFile: false,
    });

    const parentLog = createLogger('Parent');
    const childLog = parentLog.withScope('Child');

    childLog.info('nested component ready');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const output = String(stdoutSpy.mock.calls[0][0]);
    expect(output).toContain('[Parent:Child]');
    expect(output).toContain('nested component ready');
  });

  it('respects environment variable override PLUTO_LOG_LEVEL', () => {
    const originalEnv = process.env.PLUTO_LOG_LEVEL;
    try {
      process.env.PLUTO_LOG_LEVEL = 'debug';
      expect(getEffectiveLogLevel()).toBe('debug');

      process.env.PLUTO_LOG_LEVEL = 'silent';
      expect(getEffectiveLogLevel()).toBe('silent');
    } finally {
      if (originalEnv === undefined) {
        process.env.PLUTO_LOG_LEVEL = undefined;
      } else {
        process.env.PLUTO_LOG_LEVEL = originalEnv;
      }
    }
  });

  it('never throws even if write stream throws an EPIPE error', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => {
      const err = new Error('write EPIPE') as NodeJS.ErrnoException;
      err.code = 'EPIPE';
      throw err;
    });

    configureGlobalLogger({
      minLevel: 'info',
      useColors: false,
      writeToFile: false,
    });
    const log = createLogger('SafeStream');

    expect(() => {
      log.info('safe write');
    }).not.toThrow();
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('electron/logger file transport', () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    resetLoggerState();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pluto-log-test-'));
    logFile = path.join(tempDir, 'main.log');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes structured logs to file when enabled', () => {
    configureGlobalLogger({
      minLevel: 'info',
      writeToFile: true,
      logFilePath: logFile,
      consoleEnabled: false,
    });

    const log = createLogger('FileScope');
    log.info('file message', { testKey: 'testVal' });

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf8');
    expect(content).toContain('[INFO ] [FileScope] file message');
    expect(content).toContain("testKey: 'testVal'");
  });

  it('rotates logs when maxFileSizeBytes threshold is reached', () => {
    configureGlobalLogger({
      minLevel: 'info',
      writeToFile: true,
      logFilePath: logFile,
      maxFileSizeBytes: 120, // small limit to trigger rotation
      maxBackupFiles: 2,
      consoleEnabled: false,
    });

    const log = createLogger('Rotate');
    // First write ~100 bytes
    log.info('message 1 '.padEnd(60, '1'));
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.1`)).toBe(false);

    // Second write crosses 120 bytes -> rotates to main.log.1
    log.info('message 2 '.padEnd(60, '2'));
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);

    // Third write crosses limit again -> main.log.1 -> main.log.2
    log.info('message 3 '.padEnd(60, '3'));
    expect(fs.existsSync(`${logFile}.2`)).toBe(true);
  });

  it('handles disk errors gracefully without crashing', () => {
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    configureGlobalLogger({
      minLevel: 'info',
      writeToFile: true,
      logFilePath: logFile,
      consoleEnabled: false,
    });

    const log = createLogger('FaultTolerance');
    expect(() => {
      log.info('this should not crash');
    }).not.toThrow();
  });
});

describe('initializeElectronLogging', () => {
  it('configures dev vs prod logging policies accurately', () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pluto-env-log-test-'),
    );
    try {
      // Dev mode
      initializeElectronLogging({
        isPackaged: false,
        logsDirectory: tempDir,
        minLevel: 'debug',
      });
      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const devLog = createLogger('DevScope');
      devLog.debug('dev debug message');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      stdoutSpy.mockRestore();

      // Packaged mode: console suppressed for debug/info, file written
      initializeElectronLogging({
        isPackaged: true,
        logsDirectory: tempDir,
        minLevel: 'info',
      });
      const prodStdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const prodLog = createLogger('ProdScope');
      prodLog.info('prod info message');
      // In production, console is only allowed for error
      expect(prodStdoutSpy).not.toHaveBeenCalled();

      // But file was written
      const prodLogFile = path.join(tempDir, 'main.log');
      expect(fs.existsSync(prodLogFile)).toBe(true);
      const content = fs.readFileSync(prodLogFile, 'utf8');
      expect(content).toContain('[INFO ] [ProdScope] prod info message');

      prodStdoutSpy.mockRestore();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
