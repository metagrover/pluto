import { describe, expect, it } from 'vitest';
import { createEditorTerminologyArtifact } from '../../electron/llm/meetingNotesEditorTerminology';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import type {
  NotesAudit,
  NotesDraft,
  NotesSource,
  SourceSpan,
} from '../../electron/llm/meetingNotesTypes';

const context = {
  trustedUserTerms: [] as string[],
  provider: 'test',
  model: 'synthetic',
};
const sourceFor = (...texts: string[]) =>
  createNotesSource(
    JSON.stringify(texts.map((text) => ({ speaker: 'Ava', text }))),
  );
const draftFor = (source: NotesSource, spans?: SourceSpan[]): NotesDraft => ({
  meetingType: 'general',
  overview: {
    id: 'overview',
    text: 'A conversation about project terminology.',
    sources:
      spans ??
      source.segments.map((segment) => ({
        segment: segment.index,
        start: 0,
        end: segment.text.length,
      })),
  },
  sections: [],
});
const proposal = (
  overrides: Partial<NotesAudit['terminology'][number]> = {},
): NotesAudit['terminology'][number] => ({
  rawForms: ['RAG'],
  preferredTerm: 'Release Approval Gate',
  segmentIndexes: [0],
  confidence: 'high',
  signals: [],
  ...overrides,
});

const check = (
  source: NotesSource,
  proposals: NotesAudit['terminology'] = [proposal()],
  draft = draftFor(source),
  trustedUserTerms: string[] = [],
) =>
  createEditorTerminologyArtifact({
    source,
    draft,
    proposals,
    context: { ...context, trustedUserTerms },
  });

describe('editor-only terminology trust boundary', () => {
  it('applies a trusted user term with a raw form supported in the cited source', () => {
    const artifact = check(
      sourceFor('Ask Ovaltree to review the contract.'),
      [proposal({ rawForms: ['Ovaltree'], preferredTerm: 'Ogletree' })],
      undefined,
      ['Ogletree'],
    );
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      provider: 'test',
      model: 'synthetic',
      proposals: [
        {
          rawForms: ['Ovaltree'],
          preferredTerm: 'Ogletree',
          signals: ['known_entity'],
          status: 'applied',
          segmentIndexes: [0],
        },
      ],
    });
  });

  it.each([
    'stands for',
    'means',
    'is short for',
    'is spelled',
    'is spelled as',
  ])(
    'verifies a source definition using %s without trusting model signals',
    (binding) => {
      const artifact = check(
        sourceFor(`RAG ${binding} Release Approval Gate.`),
      );
      expect(artifact?.proposals).toEqual([
        expect.objectContaining({
          status: 'applied',
          signals: ['spoken_definition'],
        }),
      ]);
    },
  );

  it('never applies repeated-context and variant-consistency claims alone', () => {
    const artifact = check(
      sourceFor(
        'RAG needs two reviewers.',
        'The rag gate also needs approval.',
      ),
      [
        proposal({
          rawForms: ['RAG', 'rag gate'],
          segmentIndexes: [0, 1],
          signals: [
            'repeated_context',
            'variant_consistency',
            'spoken_definition',
          ],
        }),
      ],
    );
    expect(artifact?.proposals).toEqual([
      expect.objectContaining({ status: 'proposed', signals: [] }),
    ]);
  });

  it('does not trust a model entity signal without a trusted user term', () => {
    const artifact = check(sourceFor('Ask Ovaltree about the contract.'), [
      proposal({
        rawForms: ['Ovaltree'],
        preferredTerm: 'Ogletree',
        signals: ['known_entity', 'known_person'],
      }),
    ]);
    expect(artifact?.proposals).toEqual([
      expect.objectContaining({ status: 'proposed', signals: [] }),
    ]);
  });

  it.each([
    'RAG does not stand for Release Approval Gate.',
    'It is not true that RAG means Release Approval Gate.',
    'Maybe RAG means Release Approval Gate.',
    'I think RAG stands for Release Approval Gate.',
    'RAG means Release Approval Gate?',
    'RAG means Release Approval Gate, but that is incorrect.',
    'RAG might mean Release Approval Gate.',
    'If RAG means Release Approval Gate, we need reviewers.',
    'RAG means Release Approval Gate, I think.',
    'Supposedly RAG means Release Approval Gate.',
    'RAG means Release Approval Gate. I am not sure about that definition.',
  ])('does not authorize a negated or uncertain definition: %s', (text) => {
    const artifact = check(sourceFor(text), [
      proposal({ signals: ['spoken_definition'] }),
    ]);
    expect(artifact?.proposals).toEqual([
      expect.objectContaining({ status: 'proposed', signals: [] }),
    ]);
  });

  it('can define the preferred expansion while explicitly rejecting a different expansion', () => {
    const artifact = check(
      sourceFor(
        'RAG means Release Approval Gate, not retrieval-augmented generation.',
      ),
    );
    expect(artifact?.proposals[0]).toMatchObject({
      status: 'applied',
      signals: ['spoken_definition'],
    });
  });

  it('does not widen a cited span to an uncited trailing definition', () => {
    const text = 'RAG needs two reviewers. RAG means Release Approval Gate.';
    const source = sourceFor(text);
    const draft = draftFor(source, [
      { segment: 0, start: 0, end: text.indexOf(' RAG means') },
    ]);
    expect(
      check(source, [proposal({ signals: ['spoken_definition'] })], draft)
        ?.proposals[0],
    ).toMatchObject({ status: 'proposed', signals: [] });
  });

  it('does not stitch separate cited spans into an apparent definition', () => {
    const source = sourceFor(
      'RAG means something else; Release Approval Gate is another term.',
    );
    const text = source.segments[0]!.text;
    const draft = draftFor(source, [
      { segment: 0, start: 0, end: 'RAG means'.length },
      {
        segment: 0,
        start: text.indexOf('Release Approval Gate'),
        end: text.length,
      },
    ]);
    expect(check(source, undefined, draft)?.proposals[0]).toMatchObject({
      status: 'proposed',
      signals: [],
    });
  });

  it('requires the raw form in the actual cited span even for a trusted preferred term', () => {
    const source = sourceFor('Ask the team. Ovaltree can review this.');
    const draft = draftFor(source, [
      { segment: 0, start: 0, end: 'Ask the team.'.length },
    ]);
    expect(
      check(
        source,
        [proposal({ rawForms: ['Ovaltree'], preferredTerm: 'Ogletree' })],
        draft,
        ['Ogletree'],
      ),
    ).toBeUndefined();
  });

  it('ignores an uncited segment even when the model names its index', () => {
    const source = sourceFor(
      'RAG needs reviewers.',
      'RAG means Release Approval Gate.',
    );
    const draft = draftFor(source, [
      { segment: 0, start: 0, end: source.segments[0]!.text.length },
    ]);
    expect(
      check(source, [proposal({ segmentIndexes: [1] })], draft),
    ).toBeUndefined();
  });

  it('does not accept a definition fabricated in the draft prose', () => {
    const source = sourceFor('RAG needs reviewers.');
    const draft = draftFor(source);
    draft.overview!.text = 'RAG means Release Approval Gate.';
    expect(check(source, undefined, draft)?.proposals[0]).toMatchObject({
      status: 'proposed',
      signals: [],
    });
  });

  it('requires every proposed raw alias to have its own supported definition', () => {
    const source = sourceFor(
      'RAG means Release Approval Gate. The rug needs cleaning.',
    );
    const artifact = check(source, [proposal({ rawForms: ['RAG', 'rug'] })]);
    expect(artifact?.proposals[0]).toMatchObject({
      status: 'proposed',
      signals: [],
    });
  });

  it('does not lend a verified definition to a conflicting second proposal', () => {
    const artifact = check(sourceFor('RAG means Release Approval Gate.'), [
      proposal(),
      proposal({
        preferredTerm: 'Retrieval Augmented Generation',
        signals: ['spoken_definition'],
      }),
    ]);
    expect(artifact?.proposals.map((item) => item.status)).toEqual([
      'applied',
      'proposed',
    ]);
    expect(artifact?.proposals[1]!.signals).toEqual([]);
  });

  it('escapes punctuation in the raw form and preferred term', () => {
    const source = sourceFor('R(A)G means Release [Approval] Gate.');
    expect(
      check(source, [
        proposal({
          rawForms: ['R(A)G'],
          preferredTerm: 'Release [Approval] Gate',
        }),
      ])?.proposals[0]!.status,
    ).toBe('applied');
  });

  it('does not treat regex metacharacters as a binding pattern', () => {
    const source = sourceFor(
      'R.G is our label. RAG means Release Approval Gate.',
    );
    expect(
      check(source, [proposal({ rawForms: ['R.G'] })])?.proposals[0],
    ).toMatchObject({ status: 'proposed', signals: [] });
  });

  it('does not find a raw term only as a substring of another word', () => {
    expect(
      check(sourceFor('DRAG means Release Approval Gate.')),
    ).toBeUndefined();
  });

  it('does not accept a truncated expansion as the explicitly defined term', () => {
    const source = sourceFor('RAG means Release Approval Gate.');
    expect(
      check(source, [proposal({ preferredTerm: 'Release Approval' })])
        ?.proposals[0],
    ).toMatchObject({ status: 'proposed', signals: [] });
  });

  it('preserves a proposal without a preferred replacement', () => {
    const source = sourceFor('RAG needs two reviewers.');
    expect(
      check(source, [proposal({ preferredTerm: null })])?.proposals[0],
    ).toMatchObject({ status: 'preserved', signals: [] });
  });

  it('does not upgrade a low-confidence proposal merely because a term is trusted', () => {
    const source = sourceFor('Ask Ovaltree about the contract.');
    expect(
      check(
        source,
        [
          proposal({
            rawForms: ['Ovaltree'],
            preferredTerm: 'Ogletree',
            confidence: 'low',
          }),
        ],
        undefined,
        ['Ogletree'],
      )?.proposals[0],
    ).toMatchObject({
      status: 'proposed',
      confidence: 'low',
      signals: ['known_entity'],
    });
  });

  it('uses citations from section items and recent wins without trusting their prose', () => {
    const source = sourceFor('RAG means Release Approval Gate.');
    const original = draftFor(source);
    const draft: NotesDraft = {
      meetingType: 'general',
      overview: null,
      sections: [
        {
          id: 'section',
          title: { id: 'title', text: 'Terminology', sources: [] },
          items: [
            {
              ...original.overview!,
              id: 'point',
              kind: 'point',
              owner: null,
              due: null,
            },
          ],
        },
      ],
      recentWin: {
        win: { ...original.overview!, id: 'win' },
        impact: { id: 'impact', text: 'A clearer definition.', sources: [] },
      },
    };
    expect(check(source, undefined, draft)?.proposals[0]).toMatchObject({
      status: 'applied',
      signals: ['spoken_definition'],
    });
  });

  it.each([
    null,
    {},
    [{ rawForms: null }],
    [null],
    [proposal({ rawForms: [] })],
    [proposal({ segmentIndexes: [99] })],
    [{ ...proposal(), preferredTerm: 123 }],
  ])('ignores malformed proposals: %j', (value) => {
    expect(
      check(
        sourceFor('RAG means Release Approval Gate.'),
        value as NotesAudit['terminology'],
      ),
    ).toBeUndefined();
  });

  it('ignores malformed source spans without broadening or crashing', () => {
    const source = sourceFor('RAG means Release Approval Gate.');
    const draft = draftFor(source, [{ segment: 0, start: -1, end: 99 }]);
    expect(check(source, undefined, draft)).toBeUndefined();
  });

  it('preserves source, draft, proposal, and context objects', () => {
    const source = sourceFor('RAG means Release Approval Gate.');
    const draft = draftFor(source);
    const proposals = [proposal()];
    const inputs = { source, draft, proposals, context };
    const before = structuredClone(inputs);
    const artifact = createEditorTerminologyArtifact(inputs);
    expect(artifact?.proposals[0]!.status).toBe('applied');
    expect(inputs).toEqual(before);
    expect(Object.isFrozen(source.segments)).toBe(true);
    expect(Object.isFrozen(source.segments[0])).toBe(true);
  });

  it('preserves a source participant name even when the proposed rename is trusted', () => {
    const source = sourceFor('Ava is coordinating review.');
    const artifact = check(
      source,
      [proposal({ rawForms: ['Ava'], preferredTerm: 'Mira' })],
      undefined,
      ['Mira'],
    );
    expect(artifact?.proposals[0]).toMatchObject({
      rawForms: ['Ava'],
      preferredTerm: 'Mira',
      status: 'preserved',
    });
    expect(source.segments[0]).toMatchObject({
      speaker: 'Ava',
      text: 'Ava is coordinating review.',
    });
  });

  it.each([
    'RAG does not stand for Release Approval Gate.',
    'RAG does not mean Release Approval Gate.',
    'RAG is not short for Release Approval Gate.',
    'That definition of RAG was wrong.',
    'I withdraw my earlier definition of RAG.',
  ])(
    'does not apply an earlier definition contradicted in another cited span: %s',
    (retraction) => {
      const source = sourceFor(
        'RAG stands for Release Approval Gate.',
        retraction,
      );
      // The model cannot evade a cited retraction by omitting its segment index.
      const artifact = check(source, [proposal({ segmentIndexes: [0] })]);
      expect(artifact?.proposals[0]).toMatchObject({
        status: 'proposed',
        signals: [],
      });
    },
  );

  it.each([
    'DOG does not stand for Release Approval Gate.',
    'That definition of TAG was wrong.',
    'RAG does not mean retrieval-augmented generation.',
    'The deployment is not ready.',
  ])(
    'does not let unrelated cited negation veto a verified definition: %s',
    (other) => {
      const source = sourceFor('RAG stands for Release Approval Gate.', other);
      expect(check(source)?.proposals[0]).toMatchObject({
        status: 'applied',
        signals: ['spoken_definition'],
      });
    },
  );

  it('keeps a source contradiction proposed even when the preferred term is trusted', () => {
    const source = sourceFor(
      'RAG means Release Approval Gate.',
      'That definition of RAG was wrong.',
    );
    expect(
      check(source, undefined, undefined, ['Release Approval Gate'])
        ?.proposals[0],
    ).toMatchObject({ status: 'proposed', signals: ['known_entity'] });
  });

  it('does not widen cited spans when checking for retractions', () => {
    const source = sourceFor(
      'RAG means Release Approval Gate.',
      'Another topic. That definition of RAG was wrong.',
    );
    const draft = draftFor(source, [
      { segment: 0, start: 0, end: source.segments[0]!.text.length },
      { segment: 1, start: 0, end: 'Another topic.'.length },
    ]);
    expect(check(source, undefined, draft)?.proposals[0]).toMatchObject({
      status: 'applied',
      signals: ['spoken_definition'],
    });
  });
});
