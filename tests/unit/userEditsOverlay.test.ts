import { describe, expect, it } from 'vitest';

import {
  applyUserEdit,
  parseUserEditsJson,
} from '../../src/utils/analysisDocument';

describe('parseUserEditsJson', () => {
  it('returns empty map for null/undefined', () => {
    expect(parseUserEditsJson(null)).toEqual({});
    expect(parseUserEditsJson(undefined)).toEqual({});
  });

  it('returns empty map for blank string', () => {
    expect(parseUserEditsJson('')).toEqual({});
    expect(parseUserEditsJson('   ')).toEqual({});
  });

  it('parses valid edits JSON', () => {
    const json = JSON.stringify({
      'topic:0:point:1': {
        original: 'old text',
        edited: 'new text',
        edited_at: '2026-04-09T00:00:00Z',
      },
    });
    const result = parseUserEditsJson(json);
    expect(result['topic:0:point:1']).toBeDefined();
    expect(result['topic:0:point:1'].edited).toBe('new text');
    expect(result['topic:0:point:1'].original).toBe('old text');
  });

  it('returns empty map for invalid JSON', () => {
    expect(parseUserEditsJson('{invalid')).toEqual({});
  });
});

describe('applyUserEdit', () => {
  it('returns original when no edit exists', () => {
    expect(applyUserEdit('original text', 'topic:0:point:0', {})).toBe(
      'original text',
    );
  });

  it('returns edited text when edit exists', () => {
    const edits = {
      'topic:0:point:0': {
        original: 'original text',
        edited: 'edited text',
        edited_at: '2026-04-09T00:00:00Z',
      },
    };
    expect(applyUserEdit('original text', 'topic:0:point:0', edits)).toBe(
      'edited text',
    );
  });

  it('handles multiple edits independently', () => {
    const edits = {
      'topic:0:point:0': {
        original: 'a',
        edited: 'a-edited',
        edited_at: '2026-04-09T00:00:00Z',
      },
      'topic:1:point:2': {
        original: 'b',
        edited: 'b-edited',
        edited_at: '2026-04-09T00:00:00Z',
      },
    };
    expect(applyUserEdit('a', 'topic:0:point:0', edits)).toBe('a-edited');
    expect(applyUserEdit('b', 'topic:1:point:2', edits)).toBe('b-edited');
    expect(applyUserEdit('c', 'topic:2:point:0', edits)).toBe('c');
  });
});
