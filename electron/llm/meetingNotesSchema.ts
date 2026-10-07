import { NOTES_EXPERIMENTS_ENABLED } from './meetingNotesExperiments';
import type { NotesResponseContract } from './meetingNotesTypes';

type Schema = Record<string, unknown>;
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items: Schema): Schema => ({ type: 'array', items });
const string: Schema = { type: 'string' };
const nullableString: Schema = { type: ['string', 'null'] };
const id: Schema = {
  type: 'string',
  minLength: 1,
  maxLength: 120,
  pattern: '^[A-Za-z0-9][A-Za-z0-9:_-]*$',
};

/** Generation shape only. Exact source decoding, parser validation and semantic
 * grounding still decide whether any returned content can be published. */
export const buildNotesResponseSchema = (
  contract: NotesResponseContract,
  sourceLabels: readonly string[],
): Schema => {
  const sources: Schema = {
    type: 'array',
    minItems: 1,
    items: sourceLabels.length
      ? { type: 'string', enum: [...sourceLabels] }
      : { not: {} },
  };
  const textProperties = {
    id,
    text: { type: 'string', minLength: 1, maxLength: 12000 },
    sources,
  };
  if (contract === 'compact_draft') {
    const paragraphs =
      NOTES_EXPERIMENTS_ENABLED &&
      sourceLabels.length > 0 &&
      sourceLabels.every((label) => /^P\d+(?:\.\d+)?$/.test(label));
    const turnLabels = paragraphs
      ? sourceLabels.filter((label) => /^P\d+\.\d+$/.test(label))
      : [];
    const compactSources = {
      ...sources,
      ...(turnLabels.length
        ? { items: { type: 'string', enum: turnLabels } }
        : {}),
      maxItems: 3,
    };
    const compactTitle = object(
      {
        text: { type: 'string', minLength: 1, maxLength: 120 },
        sources: compactSources,
      },
      ['text', 'sources'],
    );
    const compactItem = object(
      {
        kind: {
          type: 'string',
          enum: ['point', 'action', 'decision', 'question'],
        },
        text: { type: 'string', minLength: 1, maxLength: 12_000 },
        owner: nullableString,
        due: nullableString,
        sources: compactSources,
      },
      ['kind', 'text', 'owner', 'due', 'sources'],
    );
    return object(
      {
        // Whole-meeting requests produce the document title with the notes,
        // rather than needing a separate model request after publication.
        title: paragraphs
          ? compactTitle
          : { anyOf: [compactTitle, { type: 'null' }] },
        sections: {
          ...array(
            object({
              title: { type: 'string', minLength: 1, maxLength: 12_000 },
              items: {
                ...array(compactItem),
                minItems: 1,
              },
            }),
          ),
          maxItems: 64,
        },
      },
      ['title', 'sections'],
    );
  }
  const text = (requireId: boolean) =>
    object(textProperties, [...(requireId ? ['id'] : []), 'text', 'sources']);
  const item = (requireId: boolean): Schema => ({
    anyOf: [
      object(
        {
          ...textProperties,
          kind: { type: 'string', enum: ['point', 'question'] },
          owner: nullableString,
          due: nullableString,
        },
        [...(requireId ? ['id'] : []), 'text', 'sources', 'kind'],
      ),
      object(
        {
          ...textProperties,
          kind: { type: 'string', enum: ['action', 'decision'] },
          owner: nullableString,
          due: nullableString,
        },
        [
          ...(requireId ? ['id'] : []),
          'text',
          'sources',
          'kind',
          'owner',
          'due',
        ],
      ),
    ],
  });
  const section = (requireId: boolean) =>
    object(
      {
        id,
        title: text(requireId),
        items: array(item(requireId)),
      },
      [...(requireId ? ['id'] : []), 'title', 'items'],
    );
  const dispositions = array({
    anyOf: [
      object({
        target: id,
        kind: { const: 'deduplicated' },
        replacementId: id,
        sources,
      }),
      object({
        target: id,
        kind: { type: 'string', enum: ['cancelled', 'superseded'] },
        replacementId: { anyOf: [id, { type: 'null' }] },
        sources,
      }),
    ],
  });
  const terminology = array(
    object({
      rawForms: array(string),
      preferredTerm: nullableString,
      segmentIndexes: array({ type: 'integer', minimum: 0 }),
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      signals: array(string),
    }),
  );
  const recentWin: Schema = {
    anyOf: [
      object(
        {
          win: text(false),
          impact: text(false),
          ownership: {
            type: 'string',
            enum: ['personal', 'shared', 'other', 'unknown'],
          },
          owner: nullableString,
        },
        ['win', 'impact'],
      ),
      { type: 'null' },
    ],
  };
  if (contract === 'audit' || contract === 'corrections') {
    const audit = object({
      changes: array({
        anyOf: [
          object({
            op: { const: 'replace' },
            target: id,
            value: { anyOf: [text(false), item(false)] },
          }),
          object({ op: { const: 'remove' }, target: id }),
          object({ op: { const: 'insert' }, section: id, value: item(true) }),
          object({ op: { const: 'insert_section' }, value: section(true) }),
        ],
      }),
      verdicts: array(
        object({
          target: id,
          status: {
            type: 'string',
            enum: ['supported', 'uncertain', 'unsupported'],
          },
          sources,
        }),
      ),
      dispositions,
      terminology,
    });
    if (NOTES_EXPERIMENTS_ENABLED && contract === 'corrections') {
      const { verdicts: _verdicts, ...properties } = audit.properties as Record<
        string,
        Schema
      >;
      properties.title = { anyOf: [text(false), { type: 'null' }] };
      properties.recentWin = recentWin;
      properties.overview = { anyOf: [text(false), { type: 'null' }] };
      properties.meetingType = {
        type: 'string',
        enum: [
          'one_on_one',
          'team_sync',
          'brainstorm',
          'presentation',
          'general',
        ],
      };
      return object(properties, ['changes', 'dispositions', 'terminology']);
    }
    return audit;
  }
  return object(
    {
      title: { anyOf: [text(false), { type: 'null' }] },
      meetingType: {
        type: 'string',
        enum: [
          'one_on_one',
          'team_sync',
          'brainstorm',
          'presentation',
          'general',
        ],
      },
      overview: { anyOf: [text(false), { type: 'null' }] },
      sections: { ...array(section(false)), maxItems: 64 },
      recentWin,
      ...(contract === 'editor' ? { dispositions, terminology } : {}),
    },
    contract === 'editor'
      ? ['title', 'meetingType', 'overview', 'sections']
      : ['meetingType', 'overview', 'sections'],
  );
};
