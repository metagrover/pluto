import { describe, expect, it } from 'vitest';

import {
  type LiveTranscriptProjectionInput,
  projectLiveTranscript,
} from '../../src/services/liveTranscription/liveTranscriptProjection';

const snapshot = (overrides: Partial<LiveTranscriptProjectionInput> = {}) => ({
  source: 'mic' as const,
  engineEpoch: 1,
  parakeetGeneration: 3,
  revision: 4,
  committedPreviewText: 'committed history',
  tentativeText: 'first tentative',
  audioEndSeconds: 8,
  ...overrides,
});

describe('live transcript projection', () => {
  it('binds presentation IDs to source, epoch, generation, and revision', () => {
    const projection = projectLiveTranscript(snapshot());

    expect(projection.committed.id).toBe('mic:e1:g3:r4:committed');
    expect(projection.tentative?.id).toBe('mic:e1:g3:r4:tentative');
    expect(projection.committed.canonical).toBe(false);
  });

  it('replaces tentative text while preserving the committed history object', () => {
    const first = projectLiveTranscript(snapshot());
    const second = projectLiveTranscript(
      snapshot({ revision: 5, tentativeText: 'replacement tentative' }),
      first,
    );

    expect(second.tentative?.text).toBe('replacement tentative');
    expect(second.committed).toBe(first.committed);
    expect(second.committed.text).toBe('committed history');
    expect(second.committed.canonical).toBe(false);
  });

  it('retains committed history when a fallback discards the Parakeet tentative tail', () => {
    const primary = projectLiveTranscript(snapshot());
    const fallback = projectLiveTranscript(
      snapshot({
        engineEpoch: 2,
        parakeetGeneration: 0,
        revision: 1,
        tentativeText: '',
      }),
      primary,
    );

    expect(fallback.committed.text).toBe('committed history');
    expect(fallback.committed.id).toBe('mic:e2:g0:r1:committed');
    expect(fallback.tentative).toBeNull();
    expect(fallback.committed.canonical).toBe(false);
  });

  it('ignores a late older epoch or revision instead of overwriting current projection', () => {
    const current = projectLiveTranscript(
      snapshot({ engineEpoch: 2, revision: 8, tentativeText: 'current' }),
    );
    expect(
      projectLiveTranscript(
        snapshot({ engineEpoch: 1, revision: 99, tentativeText: 'late epoch' }),
        current,
      ),
    ).toBe(current);
    expect(
      projectLiveTranscript(
        snapshot({
          engineEpoch: 2,
          revision: 7,
          tentativeText: 'late revision',
        }),
        current,
      ),
    ).toBe(current);
  });

  it('bounds committed retention to the current preview', () => {
    let projection = projectLiveTranscript(snapshot());
    for (let revision = 5; revision < 20; revision += 1) {
      projection = projectLiveTranscript(
        snapshot({
          revision,
          committedPreviewText: `committed ${revision}`,
        }),
        projection,
      );
    }
    expect(projection.committedHistory).toHaveLength(1);
    expect(projection.committedHistory[0]).toBe(projection.committed);
  });

  it('ignores a non-prefix committed rewrite instead of mutating committed history', () => {
    const current = projectLiveTranscript(
      snapshot({ committedPreviewText: 'A' }),
    );
    expect(
      projectLiveTranscript(
        snapshot({ revision: 5, committedPreviewText: 'B' }),
        current,
      ),
    ).toBe(current);
  });

  it('keeps committed preview while the first MLX update drops the Parakeet tentative tail', () => {
    const primary = projectLiveTranscript(
      snapshot({ engineEpoch: 1, tentativeText: 'old tail' }),
    );
    const mlx = projectLiveTranscript(
      snapshot({
        engineEpoch: 2,
        parakeetGeneration: 0,
        revision: 1,
        tentativeText: '',
      }),
      primary,
    );
    expect(mlx.committed.text).toBe(primary.committed.text);
    expect(mlx.tentative).toBeNull();
  });

  it('projects an epoch transition with retained committed text and no stale tentative tail', () => {
    const primary = projectLiveTranscript(
      snapshot({
        engineEpoch: 1,
        committedPreviewText: 'A',
        tentativeText: 'old tail',
      }),
    );
    const mlx = projectLiveTranscript(
      snapshot({
        engineEpoch: 2,
        parakeetGeneration: 0,
        revision: 1,
        committedPreviewText: '',
        tentativeText: 'new MLX',
      }),
      primary,
    );
    expect(mlx.committed.text).toBe('A');
    expect(mlx.tentative?.text).toBe('new MLX');
  });
});
