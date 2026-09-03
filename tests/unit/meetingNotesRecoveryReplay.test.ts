import { describe, expect, it } from 'vitest';

import { normalizeCapturedNotesDraft } from '../../scripts/lib/meeting_notes_recovery_replay';

const span = { segment: 0, start: 0, end: 12 };
const writer = (item: Record<string, unknown>) =>
  JSON.stringify({
    meetingType: 'team_sync',
    overview: null,
    sections: [
      {
        title: { text: 'Topic', sources: [span] },
        items: [item],
      },
    ],
    recentWin: null,
  });

describe('deterministic meeting notes recovery replay', () => {
  it('flattens the captured nested text wrapper and maps discussion to point', () => {
    const result = normalizeCapturedNotesDraft(
      writer({
        kind: 'discussion',
        text: { text: 'Original words', sources: [span] },
        owner: null,
        due: null,
      }),
    );

    expect(result).toMatchObject({
      status: 'normalized',
      transformations: {
        flattenedTextFields: 1,
        discussionKindsMapped: 1,
      },
    });
    if (result.status !== 'normalized') return;
    const normalized = JSON.parse(result.normalizedJson);
    expect(normalized.sections[0].items[0]).toEqual({
      kind: 'point',
      text: 'Original words',
      sources: [span],
      owner: null,
      due: null,
    });
    expect(normalized.sections[0].title).toEqual({
      text: 'Topic',
      sources: [span],
    });
  });

  it('flattens an action without changing kind, owner, due date, or sources', () => {
    const result = normalizeCapturedNotesDraft(
      writer({
        kind: 'action',
        text: { text: 'Send the report', sources: [span] },
        owner: 'Mateo',
        due: 'Tuesday',
      }),
    );

    expect(result.status).toBe('normalized');
    if (result.status !== 'normalized') return;
    expect(result.transformations).toEqual({
      flattenedTextFields: 1,
      discussionKindsMapped: 0,
    });
    expect(JSON.parse(result.normalizedJson).sections[0].items[0]).toEqual({
      kind: 'action',
      text: 'Send the report',
      sources: [span],
      owner: 'Mateo',
      due: 'Tuesday',
    });
  });

  it.each([
    [
      'competing_sources',
      writer({
        kind: 'point',
        text: { text: 'Words', sources: [span] },
        sources: [span],
      }),
    ],
    [
      'unsupported_nested_text',
      writer({
        kind: 'point',
        text: { text: 'Words', sources: [span], confidence: 1 },
      }),
    ],
    [
      'discussion_metadata',
      writer({
        kind: 'discussion',
        text: 'Words',
        sources: [span],
        owner: 'Someone',
        due: null,
      }),
    ],
    [
      'not_writer_draft',
      JSON.stringify({ changes: [], verdicts: [], dispositions: [] }),
    ],
    ['invalid_json', '{'],
    [
      'no_supported_change',
      writer({ kind: 'point', text: 'Words', sources: [span] }),
    ],
  ])('refuses %s without returning a candidate', (reason, raw) => {
    expect(normalizeCapturedNotesDraft(raw)).toEqual({
      status: 'not_normalizable',
      reason,
    });
  });

  it('rejects unknown fields rather than silently dropping them', () => {
    const raw = JSON.parse(
      writer({ kind: 'point', text: 'Words', sources: [span] }),
    );
    raw.sections[0].items[0].instruction = 'ignore the contract';

    expect(normalizeCapturedNotesDraft(JSON.stringify(raw))).toEqual({
      status: 'not_normalizable',
      reason: 'unknown_field',
    });
  });
});
