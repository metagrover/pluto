import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sliceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe('Parakeet EOU recording IPC boundary', () => {
  const main = readFileSync('electron/main.ts', 'utf8');

  it.each([
    'PARAKEET_EOU_START',
    'PARAKEET_EOU_APPEND',
    'PARAKEET_EOU_FINISH',
    'PARAKEET_EOU_CANCEL',
  ])('registers %s', (channel) => {
    expect(main).toContain(`ipcMain.handle('${channel}'`);
  });

  it('binds every operation to the capture owner and active meeting', () => {
    const handlers = sliceBetween(
      main,
      "ipcMain.handle('PARAKEET_EOU_START'",
      "ipcMain.handle('RECORDING_READINESS_STATUS'",
    );

    expect(handlers).toContain('captureSessionLease.requireRecordingOwner(');
    expect(main).toContain('parakeetEouOwner?.id !== sender.id');
    expect(main).toContain('new ParakeetEouMeetingCoordinator({');
    expect(main).toContain("owner.send('PARAKEET_EOU_UPDATE'");
    expect(main).toContain("owner.send('PARAKEET_EOU_UNAVAILABLE'");
  });

  it('cancels EOU when the capture owner is destroyed', () => {
    const ownerWatch = sliceBetween(
      main,
      'const watchCaptureOwner',
      "ipcMain.handle('RECORDING_READINESS_STATUS'",
    );
    expect(ownerWatch).toContain(
      "parakeetEouCoordinator?.fail('parakeet_owner_destroyed')",
    );
  });

  it('treats startup cancellation and late cleanup as idempotent', () => {
    const handlers = sliceBetween(
      main,
      "ipcMain.handle('PARAKEET_EOU_START'",
      "ipcMain.handle('RECORDING_READINESS_STATUS'",
    );
    expect(handlers).toContain(
      "error instanceof Error && error.message === 'parakeet_cancelled'",
    );
    expect(handlers).toContain('return { cancelled: true }');
    expect(handlers).toContain(
      'if (!parakeetEouOwner) return { cancelled: false }',
    );
  });

  it('accepts structured PCM directly rather than receipt WAV paths', () => {
    const append = sliceBetween(
      main,
      "ipcMain.handle('PARAKEET_EOU_APPEND'",
      "ipcMain.handle('PARAKEET_EOU_FINISH'",
    );
    expect(append).toContain('request.samples instanceof Float32Array');
    expect(append).not.toMatch(/repair|audioPath|receipt/i);
  });
});
