import { describe, expect, it } from 'vitest';

import {
  isTranscriptJsonEffectivelyEmpty,
  parseTranscriptSegments,
} from '../../src/utils/transcript';
import {
  TRANSCRIPT_JSON_SCHEMA_VERSION,
  buildTranscriptJsonPayload,
} from '../../src/utils/transcriptSchema';

describe('transcriptSchema', () => {
  it('buildTranscriptJsonPayload includes schema and pipeline fields', () => {
    const payload = buildTranscriptJsonPayload(
      [{ id: '1', text: 'hi', speaker: 'Me' }],
      {
        canonicalSource: 'mix',
        postHydrationBleedPass: true,
        postHydrationBleedDroppedMe: 2,
      },
    );
    expect(payload.schemaVersion).toBe(TRANSCRIPT_JSON_SCHEMA_VERSION);
    expect(payload.canonicalSource).toBe('mix');
    expect(payload.postHydrationBleedPass).toBe(true);
    expect(payload.postHydrationBleedDroppedMe).toBe(2);
    expect(payload.segments).toHaveLength(1);
  });

  it('parseTranscriptSegments reads v2 wrapper', () => {
    const raw = JSON.stringify(
      buildTranscriptJsonPayload([{ text: 'x', speaker: 'Them' }], {
        canonicalSource: 'mic',
        postHydrationBleedPass: false,
      }),
    );
    const segs = parseTranscriptSegments(raw);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('x');
  });

  it('isTranscriptJsonEffectivelyEmpty handles v2 empty segments', () => {
    expect(
      isTranscriptJsonEffectivelyEmpty(
        JSON.stringify(
          buildTranscriptJsonPayload([], {
            canonicalSource: 'mic',
            postHydrationBleedPass: false,
          }),
        ),
      ),
    ).toBe(true);
  });
});
