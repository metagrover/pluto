import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('capture journal seal boundary', () => {
  it('seals durable capture without running transcript repair inside the seal handler', () => {
    const main = readFileSync('electron/main.ts', 'utf8');
    const handlerStart = main.indexOf("'AUDIO_CAPTURE_JOURNAL_SEAL'");
    const handlerEnd = main.indexOf(
      "ipcMain.handle(\n    'AUDIO_SAVE_AND_CONVERT'",
      handlerStart,
    );
    const handler = main.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('sealCaptureJournal(');
    expect(handler).not.toContain('repairStoppingCaptureJournalTranscript(');
    expect(handler).not.toContain('transcribeTranscriptCheckpointChunk');
  });
});
