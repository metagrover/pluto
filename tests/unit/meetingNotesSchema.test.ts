import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  applyNotesAudit,
  parseCompactNotesDraft,
  parseNotesAudit,
  parseNotesDraft,
} from '../../electron/llm/meetingNotesAudit';
import { parseEditedNotes } from '../../electron/llm/meetingNotesEditor';
import { buildNotesResponseSchema } from '../../electron/llm/meetingNotesSchema';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

// Reuse electron-builder's existing validator for tests only; no runtime dependency.
const require = createRequire(import.meta.url);
const Ajv = createRequire(require.resolve('electron-builder'))('ajv');
const validator = new Ajv({ allErrors: true });
const fixture = makeDirectNotesFixture();
const wire = createNotesWireRequest('', [
  fixture.draft.sections[0]!.title.sources[0]!,
]);
const text = { text: 'Outline', sources: ['R0'] };
const item = {
  ...text,
  kind: 'action',
  text: 'Send the outline',
  owner: 'Milo',
  due: null,
};
const draft = {
  meetingType: 'general',
  overview: null,
  sections: [{ title: text, items: [item] }],
};
const audit = {
  changes: [],
  dispositions: [],
  terminology: [],
  verdicts: ['s0:title', 's0:item:0'].map((target) => ({
    target,
    status: 'supported',
    sources: ['R0'],
  })),
};
const validate = (
  contract: 'draft' | 'compact_draft' | 'audit' | 'editor',
  value: unknown,
) => validator.validate(buildNotesResponseSchema(contract, ['R0']), value);

describe('local notes wire schemas', () => {
  it('expands a compact writer draft with derived title evidence and empty metadata', () => {
    const value = {
      title: 'Quarterly Planning',
      sections: [
        {
          title: 'Outline',
          items: [
            {
              kind: 'action',
              text: 'Send the outline',
              sources: ['R0'],
              owner: 'Ava',
              due: null,
            },
          ],
        },
      ],
    };

    expect(validate('compact_draft', value)).toBe(true);
    const expected = structuredClone(fixture.draft);
    expected.sections[0]!.items[0]!.owner = 'Ava';
    expect(parseCompactNotesDraft(wire.decode(JSON.stringify(value)))).toEqual(
      expect.objectContaining({
        title: expect.objectContaining({ text: 'Quarterly Planning' }),
        sections: expected.sections,
      }),
    );
  });

  it('ignores a leaked compact meeting type because the editor owns final classification', () => {
    const value = {
      title: 'Interview Overview',
      meetingType: 'interview',
      sections: [
        {
          title: 'Past experience',
          items: [
            {
              kind: 'point',
              text: 'Inez described completed onboarding work.',
              sources: ['R0'],
              owner: null,
              due: null,
            },
          ],
        },
      ],
    };

    expect(parseCompactNotesDraft(wire.decode(JSON.stringify(value)))).toEqual(
      expect.objectContaining({ meetingType: 'general' }),
    );
  });

  it('rejects compact writer items with more than three sources', () => {
    const value = {
      title: 'Outline Review',
      sections: [
        {
          title: 'Outline',
          items: [
            {
              kind: 'action',
              text: 'Send the outline',
              sources: ['R0', 'R0', 'R0', 'R0'],
              owner: 'Ava',
              due: null,
            },
          ],
        },
      ],
    };

    expect(validate('compact_draft', value)).toBe(false);
    expect(() =>
      parseCompactNotesDraft(wire.decode(JSON.stringify(value))),
    ).toThrow('notes_writer_invalid');
  });

  it('accepts compact drafts without invented ids and round trips exact source spans', () => {
    expect(validate('draft', draft)).toBe(true);
    expect(parseNotesDraft(wire.decode(JSON.stringify(draft)))).toEqual(
      fixture.draft,
    );
  });

  it.each(['point', 'question', 'action', 'decision'])(
    'accepts %s with nullable metadata',
    (kind) => {
      const value = {
        ...draft,
        sections: [
          { title: text, items: [{ ...item, kind, owner: null, due: null }] },
        ],
      };
      expect(validate('draft', value)).toBe(true);
      expect(() =>
        parseNotesDraft(wire.decode(JSON.stringify(value))),
      ).not.toThrow();
    },
  );

  it('allows narrative metadata omission, optional inherited ids and optional recent win', () => {
    const value = {
      ...draft,
      sections: [
        {
          id: 'inherited:s0',
          title: { ...text, id: 'inherited:title' },
          items: [{ ...text, id: 'inherited:item', kind: 'point' }],
        },
      ],
      recentWin: { win: text, impact: text },
    };
    expect(validate('draft', value)).toBe(true);
    expect(() =>
      parseNotesDraft(wire.decode(JSON.stringify(value))),
    ).not.toThrow();
    expect(validate('draft', { ...draft, recentWin: null })).toBe(true);
  });

  it('accepts and parses draft with explicit title as SupportedText or string', () => {
    const supportedTitle = { text: 'Quarterly Planning', sources: ['R0'] };
    const withSupported = { ...draft, title: supportedTitle };
    expect(validate('draft', withSupported)).toBe(true);
    const parsedSupported = parseNotesDraft(
      wire.decode(JSON.stringify(withSupported)),
    );
    expect(parsedSupported.title?.text).toBe('Quarterly Planning');
    expect(parsedSupported.title?.sources).toEqual(
      fixture.draft.sections[0]!.title.sources,
    );

    const withString = { ...draft, title: 'Roadmap Review' };
    const parsedString = parseNotesDraft(
      wire.decode(JSON.stringify(withString)),
    );
    expect(parsedString.title?.text).toBe('Roadmap Review');

    const withNull = { ...draft, title: null };
    expect(validate('draft', withNull)).toBe(true);
    const parsedNull = parseNotesDraft(wire.decode(JSON.stringify(withNull)));
    expect(parsedNull.title).toBeUndefined();
  });

  it.each([
    { ...draft, meetingType: 'meeting' },
    { ...draft, overview: 'Outline' },
    { ...draft, summary: text },
    { ...draft, sections: {} },
    { ...draft, recentWin: { win: null, impact: text } },
    { ...draft, sections: [{ title: { text }, items: [] }] },
    {
      ...draft,
      sections: [
        { title: text, items: [{ ...item, text: { text: 'Nested' } }] },
      ],
    },
    {
      ...draft,
      sections: [{ title: text, items: [{ ...item, kind: 'task' }] }],
    },
    {
      ...draft,
      sections: [
        {
          title: text,
          items: [{ text: 'Send', sources: ['R0'], kind: 'action' }],
        },
      ],
    },
    { ...draft, sections: [{ title: text, items: [{ ...item, owner: {} }] }] },
    { ...draft, sections: [{ title: text, items: [{ ...item, due: 12 }] }] },
    {
      ...draft,
      sections: [{ title: text, items: [{ ...item, sources: [] }] }],
    },
    {
      ...draft,
      sections: [{ title: text, items: [{ ...item, sources: ['R99'] }] }],
    },
    {
      ...draft,
      sections: [
        {
          title: text,
          items: [{ ...item, sources: [{ segment: 0, start: 0, end: 1 }] }],
        },
      ],
    },
    {
      ...draft,
      sections: [{ title: text, items: [{ ...item, extra: true }] }],
    },
  ])('rejects malformed draft structure %#', (value) => {
    expect(validate('draft', value)).toBe(false);
  });

  it('accepts audit verdicts and correction values with optional ids, then applies the parsed patch', () => {
    const value = {
      ...audit,
      changes: [{ op: 'replace', target: 's0:item:0', value: item }],
    };
    expect(validate('audit', value)).toBe(true);
    const parsed = parseNotesAudit(wire.decode(JSON.stringify(value)));
    expect(
      applyNotesAudit({
        source: fixture.source,
        draft: fixture.draft,
        audit: parsed,
      }).draft,
    ).toEqual(fixture.draft);
  });

  it('accepts every audit operation with the required insertion identities', () => {
    const value = {
      ...audit,
      changes: [
        { op: 'replace', target: 'overview', value: text },
        { op: 'remove', target: 'old' },
        { op: 'insert', section: 's0', value: { ...item, id: 'new-item' } },
        {
          op: 'insert_section',
          value: {
            id: 'new-section',
            title: { ...text, id: 'new-title' },
            items: [{ ...item, id: 'another-item' }],
          },
        },
      ],
    };
    expect(validate('audit', value)).toBe(true);
    expect(() =>
      parseNotesAudit(wire.decode(JSON.stringify(value))),
    ).not.toThrow();
  });

  it('accepts explicit dispositions and terminology without forcing them on the editor', () => {
    const extras = {
      dispositions: [
        {
          target: 'old',
          kind: 'superseded',
          replacementId: null,
          sources: ['R0'],
        },
      ],
      terminology: [
        {
          rawForms: ['outline'],
          preferredTerm: null,
          segmentIndexes: [0],
          confidence: 'low',
          signals: [],
        },
      ],
    };
    expect(validate('audit', { ...audit, ...extras })).toBe(true);
    expect(() =>
      parseNotesAudit(wire.decode(JSON.stringify({ ...audit, ...extras }))),
    ).not.toThrow();
    const editorDraft = { ...draft, title: text };
    expect(validate('editor', { ...editorDraft, ...extras })).toBe(true);
    expect(validate('editor', editorDraft)).toBe(true);
    expect(() =>
      parseEditedNotes({
        raw: wire.decode(JSON.stringify({ ...editorDraft, ...extras })),
        source: fixture.source,
      }),
    ).not.toThrow();
    expect(validate('draft', { ...draft, ...extras })).toBe(false);
    expect(validate('editor', { ...draft, verdicts: [] })).toBe(false);
  });

  it.each([
    {
      ...audit,
      changes: [
        {
          op: 'replace',
          target: 's0:item:0',
          value: { ...item, kind: 'unknown' },
        },
      ],
    },
    { ...audit, changes: [{ op: 'insert', section: 's0', value: item }] },
    {
      ...audit,
      changes: [{ op: 'insert_section', value: { title: text, items: [] } }],
    },
    { ...audit, changes: [{ op: 'remove', target: 's0:item:0', value: item }] },
    { ...audit, changes: [{ op: 'update', target: 's0:item:0', value: item }] },
    {
      ...audit,
      verdicts: [{ target: 's0:title', status: 'verified', sources: ['R0'] }],
    },
    {
      ...audit,
      verdicts: [{ target: 's0:title', status: 'supported', sources: [] }],
    },
    {
      ...audit,
      dispositions: [
        {
          target: 'old',
          kind: 'deduplicated',
          replacementId: null,
          sources: ['R0'],
        },
      ],
    },
    {
      ...audit,
      terminology: [
        {
          rawForms: [],
          preferredTerm: null,
          segmentIndexes: ['0'],
          confidence: 'high',
          signals: [],
        },
      ],
    },
    {
      ...audit,
      terminology: [
        {
          rawForms: [],
          preferredTerm: null,
          segmentIndexes: [0],
          confidence: 'certain',
          signals: [],
        },
      ],
    },
  ])('rejects malformed audit structure %#', (value) => {
    expect(validate('audit', value)).toBe(false);
  });
});
