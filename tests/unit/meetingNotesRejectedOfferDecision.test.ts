import { describe, expect, it, vi } from 'vitest';
import { groundSourceReviewedItem } from '../../electron/llm/analysisGrounding';
import { generateMeetingNotes } from '../../electron/llm/meetingNotesPipeline';
import type { NotesRequest } from '../../electron/llm/meetingNotesTypes';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import captured from '../fixtures/meeting-notes-qualified-publication-seed41.json';
import { makeNotesContext } from '../fixtures/meeting-notes-v10';

const offer = 'I could animate the introduction if useful.';
const choice =
  'We have decided to keep the introduction static because animation distracts from the instructions, so we will not take up that offer.';
const claim =
  'The team decided to keep the introduction static because animation distracts from the instructions, declining the offer to animate.';
const review = (
  text: string,
  lines: string[],
  options: { kind?: 'action' | 'decision'; owner?: string | null } = {},
) => {
  const evidence = lines.map((line) => line.replace(/^[^:]+: /, '')).join(' ');
  const resolved = {
    evidence,
    quotedEvidence: evidence,
    sourceLine: lines.join(' '),
    sourceLines: lines,
    lineIndex: 0,
  };
  const snapshot = structuredClone(resolved);
  const result = groundSourceReviewedItem(
    {
      text,
      kind: options.kind ?? 'decision',
      owner: options.owner ?? null,
      due: null,
    },
    resolved,
  );
  expect(resolved).toEqual(snapshot);
  return result;
};

describe('settled decision with a rejected conditional offer', () => {
  it('publishes the exact captured writer and repaired audit without changing decision text or citations', async () => {
    const source = structuredClone(captured.source);
    const replies = [
      captured.writerRaw,
      captured.repairedAuditRaw,
      captured.repairedAuditRaw,
    ];
    const generate = vi.fn(async (request: NotesRequest) => {
      const raw = replies.shift();
      if (!raw) throw new Error('offline_replay_exhausted');
      return createNotesWireRequest(
        request.prompt,
        request.sourceSpans ?? [],
      ).decode(raw);
    });
    const result = await generateMeetingNotes({
      source,
      context: makeNotesContext(),
      generate,
      provider: 'ollama',
      model: 'gemma4:12b',
      contextTokens: 16384,
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.quality.retry_count).toBe(0);
    expect(result.all_decisions).toEqual([
      { text: claim, evidence: `${offer} ${choice}` },
    ]);
    expect(
      result.generation_metadata?.source_provenance?.blocks['all_decisions:0']
        ?.sources,
    ).toEqual(
      [1, 2].map((index) => ({
        segment: index,
        start: 0,
        end: source.segments[index]!.text.length,
      })),
    );
    expect(result.all_action_items).toEqual([
      expect.objectContaining({
        assignee: 'Cleo',
        due: 'Wednesday',
        text: expect.stringContaining('once the accessibility review passes'),
      }),
    ]);
    expect(JSON.stringify(result.topics)).toContain(
      'Cleo withdrew the promise to replace product screenshots because the images are still accurate.',
    );
    expect(source).toEqual(captured.source);
  });

  it.each(['declining', 'declined'])(
    'recognizes ordinary %s morphology on a decision without mutating its text',
    (verb) => {
      const text = claim.replace('declining', verb);
      expect(
        review(text, [
          `Marin: ${offer.replace(' if useful', '')}`,
          `Cleo: ${choice}`,
        ]),
      ).toEqual({
        text,
        owner: null,
        due: null,
      });
    },
  );

  it('does not inherit a rejected offer prerequisite into the settled choice', () => {
    expect(review(claim, [`Marin: ${offer}`, `Cleo: ${choice}`])).toEqual({
      text: claim,
      owner: null,
      due: null,
    });
  });

  it('covers another choice and offer without fixture-specific subject words', () => {
    const text =
      'The group decided to keep the report plain because charts distract from the figures, declining the offer to add charts to the report.';
    expect(
      review(text, [
        'Ari: I could add charts to the report if useful.',
        'Nora: We have decided to keep the report plain because charts distract from the figures, so we will not take up that offer.',
      ]),
    ).toEqual({ text, owner: null, due: null });
  });

  it('retains a real prerequisite stated on the choice itself', () => {
    const text = claim.replace(
      'static because',
      'static once legal approves because',
    );
    const conditionalChoice = choice.replace(
      'static because',
      'static once legal approves because',
    );
    expect(
      review(text, [`Marin: ${offer}`, `Cleo: ${conditionalChoice}`]),
    ).toEqual({ text, owner: null, due: null });
  });

  it.each([
    [
      'dropped choice prerequisite',
      claim,
      [
        offer,
        choice.replace('static because', 'static once legal approves because'),
      ],
    ],
    [
      'changed choice prerequisite',
      claim.replace('static because', 'static once marketing approves because'),
      [
        offer,
        choice.replace('static because', 'static once legal approves because'),
      ],
    ],
    ['wrong choice', claim.replace('static', 'animated'), [offer, choice]],
    [
      'wrong rationale',
      claim.replace(
        'animation distracts from the instructions',
        'animation costs too much',
      ),
      [offer, choice],
    ],
    [
      'wrong offered task',
      claim.replace('offer to animate', 'offer to translate'),
      [offer, choice],
    ],
    [
      'inverted rejection',
      claim.replace('declining', 'accepting'),
      [offer, choice],
    ],
    [
      'changed recipient',
      claim.replace(
        'offer to animate',
        'offer to animate the introduction for Rina',
      ),
      [offer.replace(' if useful', ' for Theo if useful'), choice],
    ],
    [
      'unrelated settled choice',
      claim,
      [
        offer,
        'We have decided to keep the report plain, so we will not take up that offer.',
      ],
    ],
    [
      'another condition-bearing source turn',
      claim,
      [
        offer,
        choice,
        'The static introduction is acceptable only if legal approves.',
      ],
    ],
    [
      'another condition in the decision turn',
      claim,
      [offer, `${choice} This choice applies only if legal approves.`],
    ],
    [
      'ambiguous multiple offers',
      claim,
      [offer, 'I could translate the introduction if useful.', choice],
    ],
    [
      'unsettled choice',
      claim,
      [offer, choice.replace('We have decided', 'We might decide')],
    ],
  ])(
    'rejects %s without borrowing a settled cue or losing scope',
    (_label, text, lines) => {
      expect(
        review(
          text as string,
          (lines as string[]).map(
            (line, index) => `${index === 0 ? 'Marin' : 'Cleo'}: ${line}`,
          ),
        ),
      ).toBeNull();
    },
  );

  it.fails(
    'known pre-existing action bug: a declined conditional offer borrows an unrelated settled cue',
    () => {
      expect(
        review(
          'Animate the introduction if useful.',
          [`Marin: ${offer}`, `Cleo: ${choice}`],
          { kind: 'action', owner: 'Marin' },
        ),
      ).toBeNull();
    },
  );

  it('never applies rejected-offer decision scoping to an unrelated conditional action', () => {
    expect(
      review(
        'Animate the introduction if useful.',
        [
          'Marin: If useful, I can animate the introduction.',
          'Cleo: We decided to keep the report plain.',
        ],
        { kind: 'action', owner: 'Marin' },
      ),
    ).toBeNull();
  });

  it('does not inherit the offer speaker as the settled decision owner', () => {
    const lines = [`Marin: ${offer}`, `Cleo: ${choice}`];
    expect(review(claim, lines, { owner: 'Marin' })?.owner).toBeNull();
    expect(review(claim, lines, { owner: 'Cleo' })?.owner).toBe('Cleo');
  });

  it('does not invent collective agreement or change an explicitly named decision actor', () => {
    expect(
      review(claim, [
        `Cleo: ${choice.replace('We have decided', 'I have decided')}`,
      ]),
    ).toBeNull();
    expect(
      review(claim, [
        `Marin: ${offer}`,
        `Cleo: ${choice.replace('We have decided', 'I have decided')}`,
      ]),
    ).toBeNull();
    expect(
      review(claim.replace('The team decided', 'Marin decided'), [
        `Marin: ${offer}`,
        `Cleo: ${choice.replace('We have decided', 'Cleo decided')}`,
      ]),
    ).toBeNull();
  });

  it('does not drop a recipient or a compound object from the rejected offer scope', () => {
    expect(
      review(claim.replace('offer to animate', 'offer to translate'), [
        `Cleo: ${choice}`,
      ]),
    ).toBeNull();
    for (const offered of [
      offer.replace(' if useful', ' for Rina if useful'),
      offer.replace(' if useful', ' and the credits if useful'),
    ])
      expect(
        review(claim, [`Marin: ${offered}`, `Cleo: ${choice}`]),
      ).toBeNull();
  });

  it('does not give rejected-offer scoping new authority to assign the reporting speaker', () => {
    expect(
      review(
        claim,
        [
          `Marin: ${offer}`,
          `Cleo: ${choice.replace('will not take up', 'declined')}`,
        ],
        { owner: 'Cleo' },
      )?.owner,
    ).toBeNull();
  });

  it('does not treat declining sales as refusal polarity', () => {
    const text = 'We decided to reduce stock due to declining sales.';
    expect(
      review(text, [
        'Cleo: We decided to reduce stock because sales are falling.',
      ]),
    ).toEqual({ text, owner: null, due: null });
  });

  it.each([
    'I could animate the introduction if useful and I could translate the captions if useful.',
    'I could animate the introduction if useful and I can prepare the captions.',
    'I could animate the introduction if useful and prepare the captions.',
    'I could animate the introduction if useful or translate the captions once approved.',
    'I could animate the introduction if useful, provided the captions are translated.',
  ])(
    'abstains when a conditional tail cannot prove a sole offer: %s',
    (ambiguousOffer) => {
      expect(
        review(claim, [`Marin: ${ambiguousOffer}`, `Cleo: ${choice}`]),
      ).toBeNull();
    },
  );
});
