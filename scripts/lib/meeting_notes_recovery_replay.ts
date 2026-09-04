export type NotesRecoveryRefusal =
  | 'invalid_json'
  | 'not_writer_draft'
  | 'competing_sources'
  | 'unsupported_nested_text'
  | 'discussion_metadata'
  | 'unknown_field'
  | 'no_supported_change';

export type NotesRecoveryNormalization =
  | {
      status: 'normalized';
      normalizedJson: string;
      transformations: {
        flattenedTextFields: number;
        discussionKindsMapped: number;
      };
    }
  | { status: 'not_normalizable'; reason: NotesRecoveryRefusal };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => Object.keys(value).every((key) => allowed.includes(key));

const validSources = (value: unknown): value is unknown[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (source) =>
      typeof source === 'string' ||
      (isRecord(source) &&
        hasOnlyKeys(source, ['segment', 'start', 'end']) &&
        Number.isInteger(source.segment) &&
        Number.isInteger(source.start) &&
        Number.isInteger(source.end)),
  );

const validSupportedText = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKeys(value, ['text', 'sources']) &&
  typeof value.text === 'string' &&
  validSources(value.sources);

const refuse = (reason: NotesRecoveryRefusal): NotesRecoveryNormalization => ({
  status: 'not_normalizable',
  reason,
});

export const normalizeCapturedNotesDraft = (
  raw: string,
): NotesRecoveryNormalization => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse('invalid_json');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sections)) {
    return refuse('not_writer_draft');
  }
  if (
    !hasOnlyKeys(parsed, ['meetingType', 'overview', 'sections', 'recentWin'])
  ) {
    return refuse('unknown_field');
  }
  const normalized = structuredClone(parsed);
  let flattenedTextFields = 0;
  let discussionKindsMapped = 0;

  for (const section of normalized.sections) {
    if (
      !isRecord(section) ||
      !hasOnlyKeys(section, ['title', 'items']) ||
      !validSupportedText(section.title) ||
      !Array.isArray(section.items)
    ) {
      return refuse(
        isRecord(section) && !hasOnlyKeys(section, ['title', 'items'])
          ? 'unknown_field'
          : 'not_writer_draft',
      );
    }
    for (const item of section.items) {
      if (!isRecord(item)) return refuse('not_writer_draft');
      if (!hasOnlyKeys(item, ['kind', 'text', 'sources', 'owner', 'due'])) {
        return refuse('unknown_field');
      }
      if (isRecord(item.text)) {
        if (Object.hasOwn(item, 'sources')) {
          return refuse('competing_sources');
        }
        if (
          !hasOnlyKeys(item.text, ['text', 'sources']) ||
          typeof item.text.text !== 'string' ||
          !validSources(item.text.sources)
        ) {
          return refuse('unsupported_nested_text');
        }
        item.sources = structuredClone(item.text.sources);
        item.text = item.text.text;
        flattenedTextFields += 1;
      }
      if (item.kind === 'discussion') {
        if (
          (item.owner !== undefined && item.owner !== null) ||
          (item.due !== undefined && item.due !== null)
        ) {
          return refuse('discussion_metadata');
        }
        item.kind = 'point';
        discussionKindsMapped += 1;
      }
    }
  }

  if (flattenedTextFields === 0 && discussionKindsMapped === 0) {
    return refuse('no_supported_change');
  }
  return {
    status: 'normalized',
    normalizedJson: JSON.stringify(normalized),
    transformations: { flattenedTextFields, discussionKindsMapped },
  };
};
