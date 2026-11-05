import { expect, it, vi } from 'vitest';
import { buildNotesEditorPrompt } from '../../electron/llm/meetingNotesEditor';
import { notesPeopleGuidance } from '../../electron/llm/meetingNotesGuidance';
import { prepareNotesOverview } from '../../electron/llm/meetingNotesOverview';
import {
  buildCompactNotesWriterPrompt,
  buildNotesAuditPrompt,
  buildNotesMergePrompt,
  buildNotesWriterPrompt,
} from '../../electron/llm/meetingNotesPrompts';
import { buildSourceReconciliationPrompt } from '../../electron/llm/meetingNotesReconciliation';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { reviewSourceLedNotes } from '../../electron/llm/meetingNotesSourceReview';

// Notes are reread weeks later without the recording. Role stand-ins such as
// "the speaker" or "the user" lose their meaning, so every stage that writes
// prose must name people and address an unnamed Me as "you".

const input = {
  sourceText: '',
  userNotes: '',
  knownTerms: [],
  template: 'auto' as const,
  draft: {},
  drafts: [],
  inherited: [],
  primaryRanges: [],
};

it('every writer and document review stage forbids role stand-ins for people', () => {
  for (const prompt of [
    buildNotesWriterPrompt(input),
    buildCompactNotesWriterPrompt(input),
    buildNotesAuditPrompt(input),
    buildNotesEditorPrompt(input),
    buildNotesMergePrompt(input),
    buildSourceReconciliationPrompt(''),
  ]) {
    expect(prompt).toContain('never "the speaker" or "the user"');
    expect(prompt).toContain('write "you" for an unnamed Me');
    // "Source labels" was read as speaker names, steering models away from them.
    expect(prompt).not.toContain('Keep source labels out of prose');
  }
});

it('writer and editor prompts carry the full people rule', () => {
  for (const prompt of [
    buildNotesWriterPrompt(input),
    buildCompactNotesWriterPrompt(input),
    buildNotesEditorPrompt(input),
  ])
    expect(prompt).toContain(notesPeopleGuidance);
});

it('the overview names people and addresses an unnamed Me as you', () => {
  const source = createNotesSource(
    JSON.stringify({
      segments: [
        { speaker: 'Me', text: 'I really like how intuitive this is.' },
        { speaker: 'Them', text: 'Glad to hear it.' },
      ],
    }),
  );
  const request = prepareNotesOverview(
    source,
    source.segments.map((segment) => ({
      segment: segment.index,
      start: 0,
      end: segment.text.length,
    })),
    16_384,
  )!;
  expect(request.prompt).toContain(notesPeopleGuidance);
  expect(notesPeopleGuidance).toContain('never "Me"');
  expect(notesPeopleGuidance).toContain('"the other participant"');
  expect(notesPeopleGuidance).toMatch(/never guess names/i);
  expect(request.prompt).not.toContain('third-person meeting overview');
});

it('the whole-source review stage carries the same people rule', async () => {
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Priya Shah', text: 'I will send the deck.' }]),
  );
  const generate = vi.fn(async (_request: { prompt: string }) =>
    JSON.stringify({
      title: null,
      meetingType: 'general',
      overview: null,
      sections: [],
    }),
  );
  await reviewSourceLedNotes(
    {
      source,
      draft: {
        title: null,
        overview: null,
        meetingType: 'general',
        sections: [],
      },
    },
    generate,
  ).catch(() => undefined);
  expect(generate).toHaveBeenCalled();
  expect(generate.mock.calls[0]![0].prompt).toContain(notesPeopleGuidance);
});
