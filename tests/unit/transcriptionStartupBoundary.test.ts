import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('transcription startup boundary', () => {
  it('persists a capability-proven default before interrupted journal recovery', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const selection = main.indexOf('resolvePreferredTranscriptionBackend({');
    const preparation = main.indexOf('await whisperX.setConfig({', selection);
    const activeHealth = main.indexOf(
      'const activeHealth = await whisperX.health()',
      preparation,
    );
    const persistence = main.indexOf(
      "db.setSetting('transcription_backend', startupBackend.backend)",
    );
    const recovery = main.indexOf('recoverInterruptedCaptureJournals(');

    expect(selection).toBeGreaterThan(-1);
    expect(preparation).toBeGreaterThan(selection);
    expect(activeHealth).toBeGreaterThan(preparation);
    expect(persistence).toBeGreaterThan(activeHealth);
    expect(recovery).toBeGreaterThan(persistence);
  });
});
