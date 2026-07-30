import { describe, expect, it } from 'vitest';

import {
  persistAttributedTranscriptBeforeDownstream,
  persistDerivedAfterLatencyPatch,
  persistTranscriptThenRunLatencyPatchAndDownstream,
} from '../../src/services/diarizationFirstFinalization';

describe('persistAttributedTranscriptBeforeDownstream', () => {
  it('persists the attributed transcript before downstream intelligence', async () => {
    const order: string[] = [];
    const result = await persistAttributedTranscriptBeforeDownstream({
      persistTranscript: async () => order.push('persist'),
      runDownstream: async () => {
        order.push('downstream');
        return 'analysis';
      },
    });
    expect(order).toEqual(['persist', 'downstream']);
    expect(result).toBe('analysis');
  });

  it('does not run downstream intelligence when persistence fails', async () => {
    let downstreamRan = false;
    await expect(
      persistAttributedTranscriptBeforeDownstream({
        persistTranscript: async () => {
          throw new Error('save failed');
        },
        runDownstream: async () => {
          downstreamRan = true;
        },
      }),
    ).rejects.toThrow('save failed');
    expect(downstreamRan).toBe(false);
  });
});

describe('stop-to-validated persistence orchestration', () => {
  it('waits for transcript durability before starting patch and downstream concurrently', async () => {
    const order: string[] = [];
    let acknowledgeTranscript!: () => void;
    let acknowledgePatch!: () => void;
    const transcriptGate = new Promise<void>((resolve) => {
      acknowledgeTranscript = resolve;
    });
    const patchGate = new Promise<void>((resolve) => {
      acknowledgePatch = resolve;
    });

    const resultPromise = persistTranscriptThenRunLatencyPatchAndDownstream({
      persistTranscript: async () => {
        order.push('transcript:start');
        await transcriptGate;
        order.push('transcript:ack');
      },
      patchLatency: async () => {
        order.push('patch:start');
        await patchGate;
        return 'updated';
      },
      runDownstream: async () => {
        order.push('downstream:start');
        return 'analysis';
      },
    });

    await Promise.resolve();
    expect(order).toEqual(['transcript:start']);
    acknowledgeTranscript();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([
      'transcript:start',
      'transcript:ack',
      'patch:start',
      'downstream:start',
    ]);
    acknowledgePatch();
    await expect(resultPromise).resolves.toEqual({
      patchOutcome: 'updated',
      downstream: 'analysis',
    });
  });

  it.each(['conflict', 'missing', 'failed'] as const)(
    'suppresses derived persistence after metric %s',
    async (patchOutcome) => {
      let persisted = false;
      await expect(
        persistDerivedAfterLatencyPatch({
          patchOutcome,
          persistDerived: async () => {
            persisted = true;
            return 'updated';
          },
        }),
      ).resolves.toEqual({ outcome: 'suppressed' });
      expect(persisted).toBe(false);
    },
  );

  it.each(['updated', 'already_current'] as const)(
    'persists derived fields after metric %s',
    async (patchOutcome) => {
      await expect(
        persistDerivedAfterLatencyPatch({
          patchOutcome,
          persistDerived: async () => 'updated' as const,
        }),
      ).resolves.toEqual({ outcome: 'persisted', result: 'updated' });
    },
  );
});
