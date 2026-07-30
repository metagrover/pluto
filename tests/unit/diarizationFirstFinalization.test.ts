import { describe, expect, it } from 'vitest';

import { persistAttributedTranscriptBeforeDownstream } from '../../src/services/diarizationFirstFinalization';

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
