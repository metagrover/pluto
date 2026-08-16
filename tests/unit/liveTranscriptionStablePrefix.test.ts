import { describe, expect, it } from 'vitest';

import type { LiveStreamUpdate } from '../../src/services/liveTranscription/contracts';
import { reduceLiveStreamUpdate } from '../../src/services/liveTranscription/stablePrefix';

const update = (
  overrides: Partial<LiveStreamUpdate> = {},
): LiveStreamUpdate => ({
  source: 'mic',
  generation: 1,
  revision: 1,
  text: 'first tentative',
  qualifiesPriorTentative: false,
  confidence: 0.7,
  audioEndSeconds: 2,
  ...overrides,
});

describe('live transcription stable prefix', () => {
  it('keeps the current update tentative while a qualifying update commits only the prior tail', () => {
    const first = reduceLiveStreamUpdate(undefined, update());
    const second = reduceLiveStreamUpdate(
      first,
      update({
        revision: 2,
        text: 'second tentative',
        qualifiesPriorTentative: true,
        confidence: 0.9,
        audioEndSeconds: 4,
      }),
    );

    expect(first).toEqual({
      source: 'mic',
      generation: 1,
      revision: 1,
      committedPreviewText: '',
      tentativeText: 'first tentative',
      audioEndSeconds: 2,
    });
    expect(second).toEqual({
      source: 'mic',
      generation: 1,
      revision: 2,
      committedPreviewText: 'first tentative',
      tentativeText: 'second tentative',
      audioEndSeconds: 4,
    });
  });

  it('replaces only the tentative tail when an update does not qualify the prior tail', () => {
    const first = reduceLiveStreamUpdate(undefined, update());
    const second = reduceLiveStreamUpdate(
      first,
      update({ revision: 2, text: 'replacement', audioEndSeconds: 3 }),
    );

    expect(second.committedPreviewText).toBe('');
    expect(second.tentativeText).toBe('replacement');
  });

  it('ignores stale generations and revisions', () => {
    const current = reduceLiveStreamUpdate(
      undefined,
      update({ generation: 2, revision: 3 }),
    );

    expect(
      reduceLiveStreamUpdate(
        current,
        update({ generation: 1, revision: 99, text: 'old generation' }),
      ),
    ).toBe(current);
    expect(
      reduceLiveStreamUpdate(
        current,
        update({ generation: 2, revision: 3, text: 'same revision' }),
      ),
    ).toBe(current);
    expect(
      reduceLiveStreamUpdate(
        current,
        update({ generation: 2, revision: 2, text: 'old revision' }),
      ),
    ).toBe(current);
  });

  it('resets committed and tentative state for a higher generation', () => {
    const first = reduceLiveStreamUpdate(undefined, update());
    const committed = reduceLiveStreamUpdate(
      first,
      update({ revision: 2, text: 'new tail', qualifiesPriorTentative: true }),
    );
    const reset = reduceLiveStreamUpdate(
      committed,
      update({
        generation: 2,
        revision: 0,
        text: 'fresh generation',
        qualifiesPriorTentative: true,
      }),
    );

    expect(reset.committedPreviewText).toBe('');
    expect(reset.tentativeText).toBe('fresh generation');
  });

  it('handles empty tails without adding join whitespace', () => {
    const empty = reduceLiveStreamUpdate(undefined, update({ text: '' }));
    const next = reduceLiveStreamUpdate(
      empty,
      update({ revision: 2, text: '', qualifiesPriorTentative: true }),
    );

    expect(next.committedPreviewText).toBe('');
    expect(next.tentativeText).toBe('');
  });

  it('normalizes repeated whitespace while preserving Unicode and punctuation', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({ text: '  Héllo,\t 世界!  ' }),
    );
    const second = reduceLiveStreamUpdate(
      first,
      update({
        revision: 2,
        text: '  Ça   va?  ',
        qualifiesPriorTentative: true,
      }),
    );
    const third = reduceLiveStreamUpdate(
      second,
      update({
        revision: 3,
        text: 'fin',
        qualifiesPriorTentative: true,
      }),
    );

    expect(second.tentativeText).toBe('Ça va?');
    expect(third.committedPreviewText).toBe('Héllo, 世界! Ça va?');
  });

  it('rejects a source mismatch with a stable finite error', () => {
    const current = reduceLiveStreamUpdate(undefined, update());

    expect(() =>
      reduceLiveStreamUpdate(
        current,
        update({ source: 'system', revision: 2 }),
      ),
    ).toThrowError('live_stream_source_mismatch');
  });

  it.each([
    ['generation', Number.NaN],
    ['generation', Number.POSITIVE_INFINITY],
    ['generation', -1],
    ['revision', Number.NaN],
    ['revision', Number.POSITIVE_INFINITY],
    ['revision', -1],
    ['confidence', Number.NaN],
    ['confidence', Number.POSITIVE_INFINITY],
    ['confidence', -1],
    ['audioEndSeconds', Number.NaN],
    ['audioEndSeconds', Number.POSITIVE_INFINITY],
    ['audioEndSeconds', -1],
  ] as const)(
    'rejects invalid nonnegative finite %s values',
    (field, value) => {
      expect(() =>
        reduceLiveStreamUpdate(undefined, update({ [field]: value })),
      ).toThrowError('live_stream_update_invalid');
    },
  );

  it('keeps committed preview text monotonic and append-only', () => {
    const snapshots = [
      reduceLiveStreamUpdate(undefined, update({ text: 'one' })),
    ];
    snapshots.push(
      reduceLiveStreamUpdate(
        snapshots.at(-1) ?? null,
        update({ revision: 2, text: 'two', qualifiesPriorTentative: true }),
      ),
    );
    snapshots.push(
      reduceLiveStreamUpdate(
        snapshots.at(-1) ?? null,
        update({ revision: 3, text: 'replacement' }),
      ),
    );
    snapshots.push(
      reduceLiveStreamUpdate(
        snapshots.at(-1) ?? null,
        update({ revision: 4, text: 'four', qualifiesPriorTentative: true }),
      ),
    );

    expect(
      snapshots.map(({ committedPreviewText }) => committedPreviewText),
    ).toEqual(['', 'one', 'one', 'one replacement']);
    for (let index = 1; index < snapshots.length; index += 1) {
      expect(
        snapshots[index]?.committedPreviewText.startsWith(
          snapshots[index - 1]?.committedPreviewText ?? '',
        ),
      ).toBe(true);
    }
  });
});
