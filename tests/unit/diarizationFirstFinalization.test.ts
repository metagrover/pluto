import { describe, expect, it } from 'vitest';

import {
  persistAttributedTranscriptBeforeDownstream,
  persistLatencyAndDerivedIntelligence,
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

describe('persistLatencyAndDerivedIntelligence', () => {
  it('starts metric persistence concurrently with downstream work after transcript durability', async () => {
    const order: string[] = [];
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });

    const promise = persistLatencyAndDerivedIntelligence({
      persistTranscript: async () => order.push('transcript'),
      patchLatency: async () => {
        order.push('patch:start');
        await patchGate;
        order.push('patch:end');
        return 'updated' as const;
      },
      runDownstream: async () => {
        order.push('downstream');
        return 'analysis';
      },
      persistDerived: async () => {
        order.push('derived');
        return 'updated' as const;
      },
    });

    await Promise.resolve();
    expect(order).toEqual(['transcript', 'patch:start', 'downstream']);
    releasePatch();
    await expect(promise).resolves.toMatchObject({
      artifacts: 'analysis',
      patchOutcome: 'updated',
      derivedOutcome: 'updated',
    });
    expect(order).toEqual([
      'transcript',
      'patch:start',
      'downstream',
      'patch:end',
      'derived',
    ]);
  });

  it.each(['conflict', 'missing', 'failed'] as const)(
    'suppresses derived persistence after %s metric reconciliation',
    async (patchOutcome) => {
      let derivedRan = false;
      const result = await persistLatencyAndDerivedIntelligence({
        persistTranscript: async () => {},
        patchLatency: async () => patchOutcome,
        runDownstream: async () => 'analysis',
        persistDerived: async () => {
          derivedRan = true;
          return 'updated';
        },
      });

      expect(result).toEqual({
        artifacts: 'analysis',
        patchOutcome,
        derivedOutcome: 'suppressed',
      });
      expect(derivedRan).toBe(false);
    },
  );
});
