import { expect, it } from 'vitest';
import { acceptEditedNotes } from '../../electron/llm/meetingNotesAudit';
import { reviewSourceBoundNotes } from '../../electron/llm/meetingNotesSemanticReview';
import {
  createNotesSource,
  quoteCitedSourcePassages,
} from '../../electron/llm/meetingNotesSource';

type Case = {
  id: string;
  subjectSpeech: string;
  draftHint?: string;
  operationFocus?: string;
  draftKind?: string;
  draftOwner?: string | null;
  reviewRetryReason?: string;
  reviewFailures?: { reason: string; instruction: string }[];
  acceptanceRetryReason?: string;
  source: { text: string; bounds: number[][] }[];
};
const casesIn = (prompt: string): Case[] =>
  JSON.parse(prompt.split('\n').at(-1)!);
const point = (id: string, text: string) => ({
  id,
  kind: 'point',
  text,
  owner: null,
  due: null,
  discussion: null,
});
const fixture = (
  speech = 'I felt relieved after that lesson.',
  hint = 'She felt relieved after the lesson.',
  kind: 'point' | 'decision' = 'point',
) => {
  const source = createNotesSource(
    JSON.stringify([
      { speaker: 'Bo', text: 'Earlier we discussed the geometry lesson.' },
      { speaker: 'Ari', text: speech },
      { speaker: 'Cy', text: 'The notebook has three diagrams.' },
    ]),
  );
  const span = (segment: number) => [
    { segment, start: 0, end: source.segments[segment]!.text.length },
  ];
  const notes = acceptEditedNotes({
    source,
    acceptancePolicy: 'conservative',
    draft: {
      title: null,
      overview: null,
      meetingType: 'general',
      sections: [
        {
          id: 'section',
          title: { id: 'heading', text: 'Learning', sources: span(1) },
          items: [
            {
              id: 'experience',
              kind,
              text: hint,
              owner: null,
              due: null,
              sources: span(1),
            },
            {
              id: 'diagrams',
              kind: 'point',
              text: 'The notebook has three diagrams.',
              owner: null,
              due: null,
              sources: span(2),
            },
          ],
        },
      ],
    },
  });
  return { notes, source };
};

it('does not prime source classification with a non-action draft verdict', async () => {
  const { notes } = fixture(
    'I taught the evening class last year.',
    'Ari taught the evening class last year.',
    'decision',
  );
  expect(notes.reviewOriginals!.get('experience')!.kind).toBe('decision');
  const reviewed = await reviewSourceBoundNotes(notes, async ({ prompt }) => {
    const entry = casesIn(prompt).find(({ id }) => id === 'experience')!;
    expect(entry).not.toHaveProperty('draftKind');
    expect(entry).not.toHaveProperty('draftOwner');
    expect(entry.source.map(({ text }) => text).join(' ')).toContain(
      'I taught the evening class last year.',
    );
    return JSON.stringify({
      resolutions: [
        point('experience', 'Ari taught the evening class last year.'),
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    });
  });
  expect(reviewed.draft.sections[0]!.items[0]!.kind).toBe('point');
  expect(reviewed.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
});

it('supplies primary source speech on every pass and omits the generated selector on a held retry', async () => {
  const { notes, source } = fixture();
  const original = structuredClone(notes.reviewOriginals!.get('experience')!);
  let calls = 0;
  let firstCases: Case[] = [];
  const held = await reviewSourceBoundNotes(notes, async ({ prompt }) => {
    calls++;
    firstCases = casesIn(prompt);
    expect(firstCases[0]!.draftHint).toBe(original.text);
    expect(firstCases[0]!.subjectSpeech).toBe(
      quoteCitedSourcePassages(source, original.sources),
    );
    expect(firstCases[0]).not.toHaveProperty('draftKind');
    expect(firstCases[0]).not.toHaveProperty('draftOwner');
    expect(
      firstCases.every((entry) => entry.reviewRetryReason === undefined),
    ).toBe(true);
    return JSON.stringify({
      resolutions: [
        point('experience', 'She felt relieved after the lesson.'),
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    });
  });
  expect(held.issues).toContain('semantic_notes_review_unavailable:experience');
  const repaired = await reviewSourceBoundNotes(held, async ({ prompt }) => {
    calls++;
    const entries = casesIn(prompt);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry).not.toHaveProperty('draftHint');
    expect(entry.subjectSpeech).toBe(
      quoteCitedSourcePassages(source, original.sources),
    );
    expect(entry.subjectSpeech).not.toContain('She');
    expect(entry.subjectSpeech).not.toContain('Earlier');
    expect(entry.reviewRetryReason).toContain(
      'previous verdict failed source checks',
    );
    expect(original.kind).toBe('point');
    expect(entry).not.toHaveProperty('draftKind');
    expect(entry).not.toHaveProperty('draftOwner');
    expect(entry.source).toEqual(firstCases[0]!.source);
    expect(entry.source.map(({ text }) => text).join(' ')).toContain('Earlier');
    return JSON.stringify({
      resolutions: [point('experience', 'Ari felt relieved after the lesson.')],
    });
  });
  expect(calls).toBe(2);
  expect(repaired.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
  expect(repaired.draft.sections[0]!.items[0]!.text).toBe(
    'Ari felt relieved after the lesson.',
  );
});

it('uses the same generic retry feedback for a different failed source check without copying the rejected text', async () => {
  const { notes } = fixture(
    'The lesson included three diagrams.',
    'The lesson included three diagrams.',
  );
  const held = await reviewSourceBoundNotes(notes, async () =>
    JSON.stringify({
      resolutions: [
        point('experience', 'The lesson included three other diagrams.'),
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    }),
  );
  expect(held.issues).toContain('semantic_notes_review_unavailable:experience');
  const repaired = await reviewSourceBoundNotes(held, async ({ prompt }) => {
    const entry = casesIn(prompt)[0]!;
    expect(entry.reviewRetryReason).toBeDefined();
    expect(entry).not.toHaveProperty('draftHint');
    expect(entry.subjectSpeech).not.toContain('other');
    expect(entry.reviewRetryReason).not.toContain('diagrams');
    return JSON.stringify({
      resolutions: [point('experience', 'The lesson included three diagrams.')],
    });
  });
  expect(repaired.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
});

it('preserves the existing source-acceptance feedback alongside generic held-case feedback', async () => {
  const { notes } = fixture(
    'I should be able to send the worksheet.',
    'Ari may be able to send the worksheet.',
  );
  const held = await reviewSourceBoundNotes(notes, async () =>
    JSON.stringify({
      resolutions: [
        {
          ...point('experience', 'Send the worksheet.'),
          kind: 'accepted_action',
          owner: 'Ari',
        },
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    }),
  );
  expect(held.issues).toContain('semantic_notes_acceptance_failed:experience');
  const repaired = await reviewSourceBoundNotes(held, async ({ prompt }) => {
    const entry = casesIn(prompt)[0]!;
    expect(entry.reviewRetryReason).toBeDefined();
    expect(entry.acceptanceRetryReason).toContain('source acceptance checks');
    return JSON.stringify({
      resolutions: [
        point('experience', 'Ari may be able to send the worksheet.'),
      ],
    });
  });
  expect(
    repaired.issues?.some((issue) => issue.startsWith('semantic_notes_')) ??
      false,
  ).toBe(false);
});

it('does not invent per-case failure feedback after a whole-batch transport refusal', async () => {
  const { notes } = fixture('The lesson ended.', 'The lesson ended.');
  const held = await reviewSourceBoundNotes(notes, async () => {
    throw new Error('private transport detail');
  });
  expect(held.issues).toContain('semantic_notes_review_unavailable');
  await reviewSourceBoundNotes(held, async ({ prompt }) => {
    const entries = casesIn(prompt);
    expect(entries).toHaveLength(2);
    expect(
      entries.every((entry) => entry.reviewRetryReason === undefined),
    ).toBe(true);
    expect(entries[0]!.draftHint).toBe('The lesson ended.');
    expect(prompt).not.toContain('private transport detail');
    return JSON.stringify({
      resolutions: [
        point('experience', 'The lesson ended.'),
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    });
  });
});

it('collects independent source failures for one colon-containing ID and repairs them in the same existing retry', async () => {
  const { notes } = fixture(
    'I should be able to send three worksheets.',
    'Ari may be able to send three worksheets.',
  );
  const id = 's0:item:0';
  notes.draft.sections[0]!.items[0]!.id = id;
  notes.reviewOriginals!.set(id, {
    ...notes.reviewOriginals!.get('experience')!,
    id,
  });
  notes.reviewOriginals!.delete('experience');
  let calls = 0;
  const held = await reviewSourceBoundNotes(notes, async () => {
    calls++;
    return JSON.stringify({
      resolutions: [
        {
          ...point(id, 'Send her three other worksheets.'),
          kind: 'accepted_action',
          owner: 'Ari',
        },
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    });
  });
  for (const reason of [
    'quantity_scope',
    'unsupported_pronoun',
    'source_grounding',
  ])
    expect(held.issues).toContain(`semantic_notes_failure:${reason}:${id}`);
  expect(held.draft.sections[0]!.items[0]!.kind).toBe('point');
  const repaired = await reviewSourceBoundNotes(held, async ({ prompt }) => {
    calls++;
    const entry = casesIn(prompt)[0]!;
    expect(entry.id).toBe(id);
    expect(entry.reviewFailures?.map(({ reason }) => reason)).toEqual([
      'quantity_scope',
      'unsupported_pronoun',
      'source_grounding',
    ]);
    expect(
      entry.reviewFailures?.find(
        ({ reason }) => reason === 'unsupported_pronoun',
      )?.instruction,
    ).toContain('gendered pronoun absent from this source');
    expect(
      entry.reviewFailures?.find(({ reason }) => reason === 'source_grounding')
        ?.instruction,
    ).toContain('classification');
    expect(
      entry.reviewFailures?.every(
        ({ instruction }) => !instruction.includes('worksheets'),
      ),
    ).toBe(true);
    expect(entry.acceptanceRetryReason).toBeDefined();
    return JSON.stringify({
      resolutions: [point(id, 'Ari may be able to send three worksheets.')],
    });
  });
  expect(calls).toBe(2);
  expect(
    repaired.issues?.some(
      (issue) =>
        issue.startsWith('semantic_notes_failure:') ||
        issue.startsWith('semantic_notes_review_unavailable') ||
        issue.startsWith('semantic_notes_acceptance_failed:'),
    ) ?? false,
  ).toBe(false);
});

it('reports owner and condition failures together without admitting either unsupported field', async () => {
  const { notes } = fixture(
    'I will send the worksheet only if finance approves.',
    'Ari will send the worksheet only if finance approves.',
  );
  const held = await reviewSourceBoundNotes(notes, async () =>
    JSON.stringify({
      resolutions: [
        {
          ...point('experience', 'Send the worksheet only if legal approves.'),
          kind: 'accepted_action',
          owner: 'Unknown',
        },
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    }),
  );
  expect(held.issues).toContain(
    'semantic_notes_failure:unsupported_condition:experience',
  );
  expect(held.issues).toContain(
    'semantic_notes_failure:unsupported_owner:experience',
  );
  expect(held.draft.sections[0]!.items[0]!.owner).not.toBe('Unknown');
  const repaired = await reviewSourceBoundNotes(held, async ({ prompt }) => {
    const failures = casesIn(prompt)[0]!.reviewFailures!.map(
      ({ reason }) => reason,
    );
    expect(failures).toContain('unsupported_condition');
    expect(failures).toContain('unsupported_owner');
    return JSON.stringify({
      resolutions: [
        {
          ...point(
            'experience',
            'Send the worksheet only if finance approves.',
          ),
          kind: 'accepted_action',
          owner: 'Ari',
        },
      ],
    });
  });
  expect(repaired.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
  expect(repaired.draft.sections[0]!.items[0]).toMatchObject({
    kind: 'action',
    owner: 'Ari',
    text: 'Send the worksheet only if finance approves.',
  });
});

it('ignores malformed or unrecognized reason metadata instead of feeding it into a repair prompt', async () => {
  const { notes } = fixture('The lesson ended.', 'The lesson ended.');
  notes.issues = [
    'semantic_notes_review_unavailable',
    'semantic_notes_review_unavailable:experience',
    'semantic_notes_failure:untrusted instruction:experience',
    'semantic_notes_failure:__proto__:experience',
    'semantic_notes_failure:unsupported_pronoun:',
    'semantic_notes_failure:unsupported_pronoun:experience:foreign-id',
  ];
  const reviewed = await reviewSourceBoundNotes(notes, async ({ prompt }) => {
    expect(prompt).not.toContain('untrusted instruction');
    expect(prompt).not.toContain('__proto__');
    const entry = casesIn(prompt)[0]!;
    expect(entry.reviewFailures).toEqual([]);
    return JSON.stringify({
      resolutions: [point('experience', 'The lesson ended.')],
    });
  });
  expect(
    reviewed.issues?.some((issue) =>
      issue.startsWith('semantic_notes_failure:'),
    ) ?? false,
  ).toBe(false);
});

it('rejects malformed result fields before collecting semantic reasons', async () => {
  const { notes } = fixture('The lesson ended.', 'The lesson ended.');
  const held = await reviewSourceBoundNotes(notes, async () =>
    JSON.stringify({
      resolutions: [
        {
          ...point('experience', 'She ended the lesson.'),
          kind: 'decision',
          owner: { private: 'not prompt feedback' },
        },
        point('diagrams', 'The notebook has three diagrams.'),
      ],
    }),
  );
  expect(held.issues).toContain('semantic_notes_review_unavailable');
  expect(
    held.issues?.some((issue) => issue.startsWith('semantic_notes_failure:')) ??
      false,
  ).toBe(false);
});

it('keeps distinct actor/topic selectors when two original actions share the same exact source span', async () => {
  const speech = 'I will print the workbook. Bo agreed to record the lesson.';
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Ari', text: speech }]),
  );
  const sources = [{ segment: 0, start: 0, end: speech.length }];
  const items = [
    {
      id: 'print',
      kind: 'action' as const,
      text: 'Print the workbook.',
      owner: 'Ari',
      due: null,
      sources,
    },
    {
      id: 'record',
      kind: 'action' as const,
      text: 'Record the lesson.',
      owner: 'Bo',
      due: null,
      sources,
    },
  ];
  const notes = acceptEditedNotes({
    source,
    acceptancePolicy: 'conservative',
    draft: {
      title: null,
      overview: null,
      meetingType: 'general',
      sections: [
        {
          id: 'section',
          title: { id: 'heading', text: 'Lesson preparation', sources },
          items,
        },
      ],
    },
  });
  const reviewed = await reviewSourceBoundNotes(notes, async ({ prompt }) => {
    const entries = casesIn(prompt);
    expect(entries.map(({ subjectSpeech }) => subjectSpeech)).toEqual([
      quoteCitedSourcePassages(source, sources),
      quoteCitedSourcePassages(source, sources),
    ]);
    expect(entries.map(({ operationFocus }) => operationFocus)).toEqual([
      'Print the workbook',
      'Record the lesson',
    ]);
    expect(entries.map(({ draftOwner }) => draftOwner)).toEqual(['Ari', 'Bo']);
    expect(prompt).toContain(
      'never evidence, a required verdict or a ceiling on supported scope',
    );
    return JSON.stringify({
      resolutions: items.map(({ id, text, owner }) => ({
        id,
        text,
        owner,
        kind: 'accepted_action',
        due: null,
        discussion: null,
      })),
    });
  });
  expect(reviewed.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
  expect(
    reviewed.draft.sections[0]!.items.map(
      ({ text, owner, sources: retained }) => ({
        text,
        owner,
        sources: retained,
      }),
    ),
  ).toEqual(
    items.map(({ text, owner, sources: retained }) => ({
      text,
      owner,
      sources: retained,
    })),
  );
});

it('supplies a co-cited ongoing operation as primary speech even when the selector names only its later deliverable', async () => {
  const speech =
    'I am preparing the workshop exercises. I will upload the workbook after the lesson.';
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Ari', text: speech }]),
  );
  const sources = [{ segment: 0, start: 0, end: speech.length }];
  const notes = acceptEditedNotes({
    source,
    acceptancePolicy: 'conservative',
    draft: {
      title: null,
      overview: null,
      meetingType: 'general',
      sections: [
        {
          id: 'section',
          title: { id: 'heading', text: 'Workshop', sources },
          items: [
            {
              id: 'workshop',
              kind: 'action',
              text: 'Upload the workbook after the lesson.',
              owner: 'Ari',
              due: null,
              sources,
            },
          ],
        },
      ],
    },
  });
  const reviewed = await reviewSourceBoundNotes(notes, async ({ prompt }) => {
    const entry = casesIn(prompt)[0]!;
    expect(entry.subjectSpeech).toBe(quoteCitedSourcePassages(source, sources));
    expect(entry.subjectSpeech).toContain(
      'I am preparing the workshop exercises.',
    );
    expect(entry.operationFocus).toBe('Upload the workbook after the lesson');
    expect(entry).not.toHaveProperty('draftHint');
    return JSON.stringify({
      resolutions: [
        {
          id: 'workshop',
          kind: 'accepted_action',
          text: 'Prepare the workshop exercises and upload the workbook after the lesson.',
          owner: 'Ari',
          due: null,
          discussion: null,
        },
      ],
    });
  });
  expect(reviewed.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
  expect(reviewed.draft.sections[0]!.items[0]!.text).toContain(
    'Prepare the workshop exercises',
  );
  expect(reviewed.draft.sections[0]!.items[0]!.sources).toEqual(sources);
});

it('retains distinct immutable action focus on a held retry without replaying a rejected verdict', async () => {
  const speech = 'I will print the workbook. I will also record the lesson.';
  const source = createNotesSource(
    JSON.stringify([{ speaker: 'Ari', text: speech }]),
  );
  const sources = [{ segment: 0, start: 0, end: speech.length }];
  const items = ['Print the workbook.', 'Record the lesson.'].map(
    (text, index) => ({
      id: `task-${index}`,
      kind: 'action' as const,
      text,
      owner: 'Ari',
      due: null,
      sources,
    }),
  );
  const notes = acceptEditedNotes({
    source,
    acceptancePolicy: 'conservative',
    draft: {
      title: null,
      overview: null,
      meetingType: 'general',
      sections: [
        {
          id: 'section',
          title: { id: 'heading', text: 'Lesson', sources },
          items,
        },
      ],
    },
  });
  let calls = 0;
  const respond = async ({ prompt }: { prompt: string }) => {
    calls++;
    const entries = casesIn(prompt);
    expect(entries.map(({ operationFocus }) => operationFocus)).toEqual([
      'Print the workbook',
      'Record the lesson',
    ]);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty('draftHint');
      expect(entry.operationFocus).not.toContain('She');
      expect(entry.subjectSpeech).toBe(
        quoteCitedSourcePassages(source, sources),
      );
      if (calls === 2)
        expect(entry.reviewFailures?.map(({ reason }) => reason)).toContain(
          'unsupported_pronoun',
        );
    }
    return JSON.stringify({
      resolutions: items.map(({ id, text, owner }) => ({
        id,
        text: calls === 1 ? `She will ${text.toLowerCase()}` : text,
        kind: 'accepted_action',
        owner,
        due: null,
        discussion: null,
      })),
    });
  };
  const held = await reviewSourceBoundNotes(notes, respond);
  expect(held.issues).toContain('semantic_notes_review_unavailable:task-0');
  const repaired = await reviewSourceBoundNotes(held, respond);
  expect(calls).toBe(2);
  expect(repaired.issues ?? []).not.toContain(
    'semantic_notes_review_unavailable',
  );
  expect(repaired.draft.sections[0]!.items.map(({ text }) => text)).toEqual(
    items.map(({ text }) => text),
  );
});
