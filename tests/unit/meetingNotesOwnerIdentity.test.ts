import { describe, expect, it } from 'vitest';
import {
  buildCitedSpeakerAliasProof,
  createNotesSource,
} from '../../electron/llm/meetingNotesSource';
import { reviewSourceLedNotes } from '../../electron/llm/meetingNotesSourceReview';

const sourceFor = (rows: [string, string][]) =>
  createNotesSource(
    JSON.stringify(rows.map(([speaker, text]) => ({ speaker, text }))),
  );
const emptyDraft = () => ({
  title: null,
  overview: null,
  meetingType: 'general' as const,
  sections: [],
});

describe('cited within-conversation owner identity', () => {
  it('admits a named owner established by a separately cited same-voice introduction', async () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'Hey, it’s Ellis.'],
      ['Remote Speaker 1', 'I will send the invitation.'],
    ]);
    await expect(
      reviewSourceLedNotes({ source, draft: emptyDraft() }, async () =>
        JSON.stringify({
          title: null,
          meetingType: 'general',
          overview: {
            text: 'Ellis will send the invitation.',
            sources: ['R0', 'R1'],
          },
          sections: [
            {
              title: { text: 'Invitation', sources: ['R1'] },
              items: [
                {
                  kind: 'action',
                  text: 'Send the invitation',
                  owner: 'Ellis',
                  dueSourceText: null,
                  sources: ['R0', 'R1'],
                },
              ],
            },
          ],
          recentWin: null,
          terminology: [],
        }),
      ),
    ).resolves.toBeDefined();
  });
});

const spansFor = (
  source: ReturnType<typeof sourceFor>,
  indexes = source.segments.map(({ index }) => index),
) =>
  indexes.map((index) => ({
    segment: index,
    start: 0,
    end: source.segments[index]!.text.length,
  }));

describe('app-built cited speaker alias proof', () => {
  it.each(['Hey, it’s Ellis.', 'Hi, I am Ellis.', 'I am Ellis.'])(
    'recognizes a standalone introduction: %s',
    (introduction) => {
      const source = sourceFor([
        ['Remote Speaker 1', introduction],
        ['Remote Speaker 1', 'I will send the invitation.'],
      ]);
      const before = structuredClone(source);
      expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([
        {
          speaker: 'Remote Speaker 1',
          name: 'Ellis',
          introductionSources: spansFor(source, [0]),
        },
      ]);
      expect(source).toEqual(before);
    },
  );

  it('retains Unicode names without changing raw speaker identity or revision', () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'Hi, I am Zoë.'],
      ['Remote Speaker 1', 'I will send the invitation.'],
    ]);
    const before = structuredClone(source);
    expect(buildCitedSpeakerAliasProof(source, spansFor(source))[0]?.name).toBe(
      'Zoë',
    );
    expect(source).toEqual(before);
    expect(
      source.segments.every(({ speaker }) => speaker === 'Remote Speaker 1'),
    ).toBe(true);
  });

  it.each([
    ['role clause', 'I am a teacher.'],
    ['reported name', 'Rowan said I am Ellis.'],
    ['quoted name', '"I am Ellis."'],
    ['recipient only', 'I will send the invitation to Ellis.'],
  ])('abstains on %s', (_label, text) => {
    const source = sourceFor([
      ['Remote Speaker 1', text],
      ['Remote Speaker 1', 'I will send the invitation.'],
    ]);
    expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([]);
  });

  it.each([{ indexes: [0] }, { indexes: [1] }])(
    'requires introduction AND responsibility citations (%j)',
    ({ indexes }) => {
      const source = sourceFor([
        ['Remote Speaker 1', 'I am Ellis.'],
        ['Remote Speaker 1', 'I will send the invitation.'],
      ]);
      expect(
        buildCitedSpeakerAliasProof(source, spansFor(source, indexes)),
      ).toEqual([]);
    },
  );

  it('vetoes conflicting introductions elsewhere in the same voice even if not cited', () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      ['Remote Speaker 1', 'I will send the invitation.'],
      ['Remote Speaker 1', 'I am Noor.'],
    ]);
    expect(
      buildCitedSpeakerAliasProof(source, spansFor(source, [0, 1])),
    ).toEqual([]);
  });

  it('vetoes one claimed name occurring in two voices', () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      ['Remote Speaker 1', 'I will send the invitation.'],
      ['Remote Speaker 2', 'I am Ellis.'],
    ]);
    expect(
      buildCitedSpeakerAliasProof(source, spansFor(source, [0, 1])),
    ).toEqual([]);
  });

  it.each(['Me', 'Confirmed Person'])(
    'does not replace protected identity %s',
    (speaker) => {
      const raw = sourceFor([
        [speaker, 'I am Ellis.'],
        [speaker, 'I will send the invitation.'],
      ]);
      const source = { ...raw, protectedSpeakerLabels: ['Confirmed Person'] };
      expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([]);
    },
  );

  it.each(['Team', 'Group', 'Everyone', 'Unknown', 'Me'])(
    'does not bind collective or reserved self-name %s to an individual',
    (name) => {
      const source = sourceFor([
        ['Remote Speaker 1', `Hi, I am ${name}.`],
        ['Remote Speaker 1', 'I will send the invitation.'],
      ]);
      expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([]);
    },
  );

  it('does not treat a completed first-person activity as a current responsibility', () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      ['Remote Speaker 1', 'I finished sending the invitation.'],
    ]);
    expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([]);
  });
});

const reviewAction = (
  source: ReturnType<typeof sourceFor>,
  text: string,
  owner: string,
  indexes: number[],
  extraPoint?: string,
  extraPointIndexes = indexes,
) =>
  reviewSourceLedNotes({ source, draft: emptyDraft() }, async () =>
    JSON.stringify({
      title: null,
      meetingType: 'general',
      overview: {
        text: text.includes('handover')
          ? 'The support handover was discussed.'
          : 'The invitation was discussed.',
        sources: source.segments.map(({ index }) => `R${index}`),
      },
      sections: [
        {
          title: { text: 'Responsibilities', sources: [`R${indexes[0]}`] },
          items: [
            {
              kind: 'action',
              text,
              owner,
              dueSourceText: null,
              sources: indexes.map((index) => `R${index}`),
            },
            ...(extraPoint
              ? [
                  {
                    kind: 'point',
                    text: extraPoint,
                    owner: null,
                    dueSourceText: null,
                    sources: extraPointIndexes.map((index) => `R${index}`),
                  },
                ]
              : []),
          ],
        },
      ],
      recentWin: null,
      terminology: [],
    }),
  );

describe('alias proof admission remains task and state bound', () => {
  it.each([
    {
      label: 'missing introduction citation',
      text: 'Send the invitation',
      owner: 'Ellis',
      indexes: [1],
    },
    {
      label: 'missing commitment citation',
      text: 'Send the invitation',
      owner: 'Ellis',
      indexes: [0],
    },
    {
      label: 'other owner',
      text: 'Send the invitation',
      owner: 'Rowan',
      indexes: [0, 1],
    },
  ])('refuses $label', async ({ text, owner, indexes }) => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      ['Remote Speaker 1', 'I will send the invitation.'],
    ]);
    await expect(reviewAction(source, text, owner, indexes)).rejects.toThrow(
      'notes_semantic_review_incomplete',
    );
  });

  it('does not bind another voice’s commitment to the introduced name', async () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      ['Remote Speaker 2', 'I will send the invitation.'],
    ]);
    expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([]);
    await expect(
      reviewAction(source, 'Send the invitation', 'Ellis', [0, 1]),
    ).rejects.toThrow('notes_semantic_review_incomplete');
  });

  it('keeps closed work closed despite a valid self-introduction', async () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      ['Remote Speaker 1', 'I finished sending the invitation.'],
    ]);
    await expect(
      reviewAction(source, 'Send the invitation', 'Ellis', [0, 1]),
    ).rejects.toThrow('notes_semantic_review_incomplete');
  });

  it('preserves independently source-named third-party responsibilities', async () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'Rowan will send the invitation.'],
    ]);
    expect(buildCitedSpeakerAliasProof(source, spansFor(source))).toEqual([]);
    const reviewed = await reviewAction(
      source,
      'Send the invitation',
      'Rowan',
      [0],
    );
    expect(reviewed.draft.sections[0]!.items[0]).toMatchObject({
      kind: 'action',
      owner: 'Rowan',
    });
  });

  it('recognizes an exactly covered ongoing responsibility without adding another action', async () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'Hi, I am Ellis.'],
      [
        'Remote Speaker 1',
        'I am preparing the support handover. That work is ongoing.',
      ],
    ]);
    const reviewed = await reviewAction(
      source,
      'Continue preparing the support handover',
      'Ellis',
      [0, 1],
    );
    expect(
      reviewed.draft.sections
        .flatMap(({ items }) => items)
        .filter(({ kind }) => kind === 'action'),
    ).toHaveLength(1);
  });

  it('does not let unrelated action evidence donate coverage to ongoing work', async () => {
    const source = sourceFor([
      ['Remote Speaker 1', 'I am Ellis.'],
      [
        'Remote Speaker 1',
        'I am preparing the support handover. That work is ongoing.',
      ],
      ['Remote Speaker 1', 'I will send the invitation.'],
    ]);
    await expect(
      reviewAction(
        source,
        'Send the invitation',
        'Ellis',
        [0, 2],
        'Ellis is preparing the support handover.',
        [0, 1],
      ),
    ).rejects.toThrow('notes_semantic_review_incomplete');
  });
});
