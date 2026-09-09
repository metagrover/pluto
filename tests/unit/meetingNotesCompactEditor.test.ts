import { expect, it, vi } from 'vitest';
import {
  buildNotesEditorPrompt,
  compactEditorInput,
  parseEditedNotes,
} from '../../electron/llm/meetingNotesEditor';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import { buildNotesResponseSchema } from '../../electron/llm/meetingNotesSchema';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { makeDirectNotesFixture } from '../fixtures/meeting-notes-v10';

const fixture = makeDirectNotesFixture();
const compact = {
  meetingType: 'team_sync',
  ...compactEditorInput(fixture.draft),
};

it('derives ids and heading evidence while retaining exact claim sources and classification', () => {
  const result = parseEditedNotes({
    raw: JSON.stringify(compact),
    source: fixture.source,
    compactDraft: true,
    compactOutput: true,
  });
  expect(result.draft.meetingType).toBe('team_sync');
  expect(result.draft.sections[0].items).toEqual(
    fixture.draft.sections[0].items,
  );
  expect(result.draft.sections[0].title.sources).toEqual(
    fixture.draft.sections[0].title.sources,
  );
  expect(result.draft.overview).toBeNull();
});

it('keeps exact request-local markers, rejecting unknown evidence after wire decoding', () => {
  const wire = createNotesWireRequest(
    '',
    fixture.draft.sections[0].items[0].sources,
  );
  const candidate = structuredClone(compact);
  const encoded = JSON.stringify(candidate).replace(
    /\{"segment":0,"start":0,"end":\d+\}/g,
    '"R0"',
  );
  expect(() =>
    parseEditedNotes({
      raw: wire.decode(encoded),
      source: fixture.source,
      compactOutput: true,
    }),
  ).not.toThrow();
  expect(() =>
    parseEditedNotes({
      raw: wire.decode(encoded.replaceAll('R0', 'R999')),
      source: fixture.source,
      compactOutput: true,
    }),
  ).toThrow();
});

it.each([
  '{',
  JSON.stringify({ ...compact, meetingType: 'invented' }),
  JSON.stringify({ ...compact, patches: [] }),
  JSON.stringify({ ...compact, dispositions: [] }),
  JSON.stringify({ ...compact, terminology: [{ invalid: true }] }),
])('rejects malformed or unexpected compact editor content', (raw) => {
  expect(() =>
    parseEditedNotes({ raw, source: fixture.source, compactOutput: true }),
  ).toThrow();
});

it('does not silently discard independently authored overview or recent-win content', () => {
  expect(() =>
    compactEditorInput({
      ...fixture.draft,
      overview: fixture.draft.sections[0].items[0],
    }),
  ).toThrow('notes_compact_editor_requires_compact_draft');
});

it('keeps the source and full semantic review instructions while removing generated scaffolding', () => {
  const input = {
    sourceText: 'immutable source',
    draft: fixture.draft,
    userNotes: '',
    knownTerms: [],
    compactDraft: true,
  };
  const prompt = buildNotesEditorPrompt({ ...input, compactOutput: true });
  expect(prompt).toContain('immutable source');
  expect(prompt).toContain('restore missing material topics');
  expect(prompt).toContain('complete corrected set of sections, not patches');
  const draftJson = JSON.parse(
    prompt.match(/BEGIN DRAFT DATA\n([\s\S]*?)\nEND DRAFT DATA/)![1],
  );
  expect(draftJson).toEqual(compactEditorInput(fixture.draft));
  expect(JSON.stringify(draftJson).length).toBeLessThan(
    JSON.stringify(fixture.draft).length,
  );
  const schema = buildNotesResponseSchema('compact_editor', ['R0']);
  expect(Object.keys(schema.properties as object).sort()).toEqual([
    'meetingType',
    'sections',
    'terminology',
  ]);
});

it('uses two calls with an explicit compact editor contract and unchanged source checks', async () => {
  const generate = vi.fn(async (request) =>
    JSON.stringify(
      request.task === 'notesWriter'
        ? compactEditorInput(fixture.draft)
        : compact,
    ),
  );
  const result = await generateMeetingNotes({
    source: fixture.source,
    context: {
      userNotes: '',
      template: 'auto',
      trustedUserTerms: [],
      entityHints: [],
    },
    provider: 'ollama',
    model: 'gemma4:12b',
    contextTokens: 16384,
    compactWriterContract: true,
    compactEditorContract: true,
    reviewProtocol: 'editor',
    generate,
  });
  expect(
    generate.mock.calls.map(([request]) => request.responseContract),
  ).toEqual(['compact_draft', 'compact_editor']);
  expect(result.all_action_items).toEqual([
    expect.objectContaining(fixture.expectedAction),
  ]);
  expect(result.generation_metadata?.prompt_version).toContain(
    'compact-editor-v1-experimental',
  );
});

it('refuses inherited-commitment reconciliation rather than silently dropping its contract', () => {
  expect(() =>
    buildNotesEditorPrompt({
      sourceText: '',
      draft: fixture.draft,
      userNotes: '',
      knownTerms: [],
      inherited: [fixture.draft.sections[0].items[0]],
      compactOutput: true,
    }),
  ).toThrow('notes_compact_editor_inherited_not_supported');
});
