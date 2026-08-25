import { describe, expect, it } from 'vitest';

import {
  type ParakeetEouUpdate,
  createEouTranscriptProjection,
} from '../../src/services/liveTranscription/eouTranscriptProjection';

const update = (
  overrides: Partial<ParakeetEouUpdate> = {},
): ParakeetEouUpdate => ({
  streamId: 'eou-meeting-1-mic',
  source: 'mic',
  generation: 1,
  revision: 1,
  processedAudioSeconds: 1,
  committedText: 'hello world',
  tentativeText: 'again',
  tokens: [
    { text: 'hello', startSeconds: 0, endSeconds: 0.2, committed: true },
    { text: 'world', startSeconds: 0.21, endSeconds: 0.4, committed: true },
    { text: 'again', startSeconds: 0.5, endSeconds: 0.7, committed: false },
  ],
  ...overrides,
});

describe('EOU transcript projection', () => {
  it('keeps attribution neutral and punctuates only committed presentation rows', () => {
    const projection = createEouTranscriptProjection();

    expect(projection.apply(update())).toEqual([
      {
        id: 'eou:1:mic:committed-1',
        speaker: 'Speaker',
        text: 'Hello world.',
        rawText: 'hello world',
        source: 'mic',
        timestampMs: 0,
        endTimestampMs: 400,
        confirmed: true,
      },
      {
        id: 'eou:1:mic:tentative',
        speaker: 'Speaker',
        text: 'again',
        rawText: 'again',
        source: 'mic',
        timestampMs: 500,
        endTimestampMs: 700,
        confirmed: false,
      },
    ]);
  });

  it('replaces tentative text without changing the committed row', () => {
    const projection = createEouTranscriptProjection();
    const first = projection.apply(update());
    const second = projection.apply(
      update({
        revision: 2,
        tentativeText: 'today',
        tokens: [
          ...update().tokens.slice(0, 2),
          {
            text: 'today',
            startSeconds: 0.5,
            endSeconds: 0.8,
            committed: false,
          },
        ],
      }),
    );

    expect(second[0]).toBe(first[0]);
    expect(second[1]).toMatchObject({
      id: 'eou:1:mic:tentative',
      text: 'today',
      confirmed: false,
    });
  });

  it('promotes EOU text into a stable committed row', () => {
    const projection = createEouTranscriptProjection();
    projection.apply(update());

    const promoted = projection.apply(
      update({
        revision: 2,
        committedText: 'hello world again',
        tentativeText: '',
        tokens: update().tokens.map((token) => ({ ...token, committed: true })),
      }),
    );

    expect(promoted).toHaveLength(2);
    expect(promoted[0]).toMatchObject({
      id: 'eou:1:mic:committed-1',
      text: 'Hello world.',
      rawText: 'hello world',
      confirmed: true,
    });
    expect(promoted[1]).toMatchObject({
      id: 'eou:1:mic:committed-2',
      text: 'Again.',
      rawText: 'again',
      timestampMs: 500,
      endTimestampMs: 700,
      confirmed: true,
    });
  });

  it('rejects a committed-prefix mutation', () => {
    const projection = createEouTranscriptProjection();
    projection.apply(update());

    expect(() =>
      projection.apply(
        update({
          revision: 2,
          committedText: 'goodbye world',
        }),
      ),
    ).toThrow('parakeet_prefix_mutated');
  });

  it('interleaves System and mic rows by token time, source, then revision', () => {
    const projection = createEouTranscriptProjection();
    projection.apply(
      update({
        source: 'system',
        streamId: 'eou-meeting-1-system',
        committedText: 'system first',
        tentativeText: '',
        tokens: [
          {
            text: 'system',
            startSeconds: 0.1,
            endSeconds: 0.2,
            committed: true,
          },
          {
            text: 'first',
            startSeconds: 0.21,
            endSeconds: 0.3,
            committed: true,
          },
        ],
      }),
    );
    const rows = projection.apply(update());

    expect(rows.map(({ speaker }) => speaker)).toEqual([
      'Speaker',
      'Speaker',
      'Speaker',
    ]);
    expect(rows.map(({ timestampMs }) => timestampMs)).toEqual([0, 100, 500]);
  });

  it('ignores duplicate, stale, or prior-generation updates', () => {
    const projection = createEouTranscriptProjection();
    const current = projection.apply(update({ revision: 3 }));

    expect(
      projection.apply(update({ revision: 3, tentativeText: 'duplicate' })),
    ).toBe(current);
    expect(
      projection.apply(update({ revision: 2, tentativeText: 'stale' })),
    ).toBe(current);
    projection.reset(2);
    const reset = projection.apply(
      update({
        generation: 2,
        revision: 1,
        committedText: '',
        tentativeText: 'fresh',
        tokens: [],
      }),
    );
    expect(projection.apply(update({ generation: 1, revision: 99 }))).toBe(
      reset,
    );
  });
});
