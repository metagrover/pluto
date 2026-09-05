import { describe, expect, it } from 'vitest';
import { hasCompleteSystemCapture } from '../../src/services/finalTranscription/systemCaptureEvidence';

const journal = {
  schemaVersion: 3,
  generation: 'capture-1',
  lifecycleState: 'sealed',
  sourceAvailability: { system: 'available' },
  intervals: [{ sources: { system: { disposition: 'captured' } } }],
};

describe('System capture evidence', () => {
  it('accepts captured silence without requiring speech or energy', () => {
    expect(hasCompleteSystemCapture(journal, 'capture-1')).toBe(true);
    expect(
      hasCompleteSystemCapture(
        {
          ...journal,
          intervals: [
            { sources: { system: { disposition: 'verified_silence' } } },
          ],
        },
        'capture-1',
      ),
    ).toBe(true);
  });
  it.each(['unavailable_at_start', 'failed_during_capture'])(
    'does not treat %s as a verified silent reference',
    (system) => {
      expect(
        hasCompleteSystemCapture(
          { ...journal, sourceAvailability: { system } },
          'capture-1',
        ),
      ).toBe(false);
    },
  );
  it.each(['source_unavailable', 'missing', 'pending'])(
    'rejects an incomplete %s interval even with an available source',
    (disposition) => {
      expect(
        hasCompleteSystemCapture(
          { ...journal, intervals: [{ sources: { system: { disposition } } }] },
          'capture-1',
        ),
      ).toBe(false);
    },
  );
  it('rejects absent, stale, unsealed, and empty evidence', () => {
    expect(hasCompleteSystemCapture(null, 'capture-1')).toBe(false);
    expect(hasCompleteSystemCapture(journal, 'another-generation')).toBe(false);
    expect(
      hasCompleteSystemCapture(
        { ...journal, lifecycleState: 'recording' },
        'capture-1',
      ),
    ).toBe(false);
    expect(
      hasCompleteSystemCapture({ ...journal, intervals: [] }, 'capture-1'),
    ).toBe(false);
  });
});
