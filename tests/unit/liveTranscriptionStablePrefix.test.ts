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

  it('does not insert a space before closing punctuation promoted later', () => {
    const word = reduceLiveStreamUpdate(
      undefined,
      update({ text: 'Hello', audioEndSeconds: 1 }),
    );
    const punctuation = reduceLiveStreamUpdate(
      word,
      update({
        revision: 2,
        text: '!',
        qualifiesPriorTentative: true,
        audioEndSeconds: 2,
      }),
    );
    const next = reduceLiveStreamUpdate(
      punctuation,
      update({
        revision: 3,
        text: 'Next',
        qualifiesPriorTentative: true,
        audioEndSeconds: 3,
      }),
    );

    expect(next.committedPreviewText).toBe('Hello!');
  });

  it('preserves no-space CJK adjacency across promotions', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({ text: '你好', audioEndSeconds: 1 }),
    );
    const second = reduceLiveStreamUpdate(
      first,
      update({
        revision: 2,
        text: '世界',
        qualifiesPriorTentative: true,
        audioEndSeconds: 2,
      }),
    );
    const third = reduceLiveStreamUpdate(
      second,
      update({
        revision: 3,
        text: '。',
        qualifiesPriorTentative: true,
        audioEndSeconds: 3,
      }),
    );

    expect(third.committedPreviewText).toBe('你好世界');
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

  it('propagates exact capture provenance into snapshots and preserves it for stale updates', () => {
    const current = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 8,
        committedThroughCaptureSequence: 7,
        tentativeThroughCaptureSequence: 8,
        engineEpoch: 2,
      }),
    );
    expect(current).toMatchObject({
      captureSequence: 8,
      committedThroughCaptureSequence: 7,
      tentativeThroughCaptureSequence: 8,
      engineEpoch: 2,
    });
    expect(
      reduceLiveStreamUpdate(
        current,
        update({ captureSequence: 7, revision: 0, engineEpoch: 1 }),
      ),
    ).toBe(current);
    expect(
      reduceLiveStreamUpdate(
        current,
        update({ captureSequence: 9, revision: 99, engineEpoch: 1 }),
      ),
    ).toBe(current);
    expect(
      reduceLiveStreamUpdate(
        current,
        update({ captureSequence: 9, revision: 99 }),
      ),
    ).toBe(current);
  });

  it('rejects invalid capture provenance instead of inferring it from timing', () => {
    expect(() =>
      reduceLiveStreamUpdate(undefined, update({ captureSequence: 1.5 })),
    ).toThrowError('live_stream_update_invalid');
  });

  it('requires qualifying provenance to promote exactly the prior tentative receipt', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 8,
        committedThroughCaptureSequence: 7,
        tentativeThroughCaptureSequence: 8,
      }),
    );
    expect(() =>
      reduceLiveStreamUpdate(
        first,
        update({
          captureSequence: 9,
          revision: 2,
          qualifiesPriorTentative: true,
          committedThroughCaptureSequence: 7,
          tentativeThroughCaptureSequence: 9,
        }),
      ),
    ).toThrowError('live_stream_provenance_invalid');
  });

  it('does not promote a Parakeet tentative tail across an engine epoch', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 8,
        committedThroughCaptureSequence: 7,
        tentativeThroughCaptureSequence: 8,
        engineEpoch: 1,
      }),
    );
    const fallback = reduceLiveStreamUpdate(
      first,
      update({
        captureSequence: 9,
        revision: 2,
        qualifiesPriorTentative: true,
        committedThroughCaptureSequence: 8,
        tentativeThroughCaptureSequence: 9,
        engineEpoch: 2,
      }),
    );
    expect(fallback.committedPreviewText).toBe('');
  });

  it('treats an unversioned snapshot as a boundary before first stamped epoch', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 8,
        committedThroughCaptureSequence: 7,
        tentativeThroughCaptureSequence: 8,
      }),
    );
    const stamped = reduceLiveStreamUpdate(
      first,
      update({
        captureSequence: 9,
        revision: 2,
        qualifiesPriorTentative: true,
        committedThroughCaptureSequence: 8,
        tentativeThroughCaptureSequence: 9,
        engineEpoch: 2,
      }),
    );
    expect(stamped.committedPreviewText).toBe('');
  });

  it('requires complete capture provenance for preview updates', () => {
    expect(() =>
      reduceLiveStreamUpdate(
        undefined,
        update({ committedThroughCaptureSequence: 7 }),
      ),
    ).toThrowError('live_stream_update_invalid');
    expect(() =>
      reduceLiveStreamUpdate(
        undefined,
        update({
          captureSequence: 999,
          committedThroughCaptureSequence: 7,
          tentativeThroughCaptureSequence: 7,
        }),
      ),
    ).toThrowError('live_stream_provenance_invalid');
  });

  it('requires applied preview capture receipts to be contiguous', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 8,
        committedThroughCaptureSequence: 7,
        tentativeThroughCaptureSequence: 8,
      }),
    );
    expect(() =>
      reduceLiveStreamUpdate(
        first,
        update({
          captureSequence: 10,
          revision: 2,
          committedThroughCaptureSequence: 8,
          tentativeThroughCaptureSequence: 10,
        }),
      ),
    ).toThrowError('live_stream_provenance_invalid');
  });

  it.each([
    ['committedThroughSequence', Number.NaN],
    ['committedThroughSequence', Number.POSITIVE_INFINITY],
    ['tentativeThroughSequence', Number.NaN],
    ['tentativeThroughSequence', Number.POSITIVE_INFINITY],
  ] as const)('rejects invalid Parakeet provenance %s', (field, value) => {
    expect(() =>
      reduceLiveStreamUpdate(undefined, update({ [field]: value })),
    ).toThrowError('live_stream_update_invalid');
  });

  it('rejects a committed watermark regression on a non-qualifying update', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 1,
        committedThroughSequence: 4,
        tentativeThroughSequence: 5,
        committedThroughCaptureSequence: 0,
        tentativeThroughCaptureSequence: 1,
      }),
    );
    expect(() =>
      reduceLiveStreamUpdate(
        first,
        update({
          captureSequence: 2,
          revision: 2,
          committedThroughSequence: 3,
          tentativeThroughSequence: 6,
          committedThroughCaptureSequence: 1,
          tentativeThroughCaptureSequence: 2,
        }),
      ),
    ).toThrowError('live_stream_provenance_invalid');
  });

  it('rejects a non-qualifying capture committed watermark regression', () => {
    const first = reduceLiveStreamUpdate(
      undefined,
      update({
        captureSequence: 8,
        committedThroughCaptureSequence: 7,
        tentativeThroughCaptureSequence: 8,
      }),
    );
    expect(() =>
      reduceLiveStreamUpdate(
        first,
        update({
          captureSequence: 9,
          revision: 2,
          committedThroughCaptureSequence: 0,
          tentativeThroughCaptureSequence: 9,
        }),
      ),
    ).toThrowError('live_stream_provenance_invalid');
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

  it.each([
    ['generation', 1.5],
    ['generation', Number.MAX_SAFE_INTEGER + 1],
    ['revision', 1.5],
    ['revision', Number.MAX_SAFE_INTEGER + 1],
    ['confidence', 1.01],
  ] as const)('rejects out-of-domain %s values', (field, value) => {
    expect(() =>
      reduceLiveStreamUpdate(undefined, update({ [field]: value })),
    ).toThrowError('live_stream_update_invalid');
  });

  it('rejects a same-generation audio watermark regression', () => {
    const current = reduceLiveStreamUpdate(
      undefined,
      update({ revision: 4, audioEndSeconds: 8 }),
    );

    expect(() =>
      reduceLiveStreamUpdate(
        current,
        update({ revision: 5, audioEndSeconds: 7.99 }),
      ),
    ).toThrowError('live_stream_audio_watermark_regression');
  });

  it('allows an equal audio watermark for a higher revision', () => {
    const current = reduceLiveStreamUpdate(
      undefined,
      update({ revision: 4, audioEndSeconds: 8 }),
    );
    const next = reduceLiveStreamUpdate(
      current,
      update({ revision: 5, audioEndSeconds: 8 }),
    );

    expect(next.revision).toBe(5);
    expect(next.audioEndSeconds).toBe(8);
  });

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
