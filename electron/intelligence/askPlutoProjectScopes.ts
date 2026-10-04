import type { RetrievalResult } from './intelligenceTypes';

export interface ExplicitProjectScope {
  canonicalId: string;
  name: string;
  displayTitle: string;
}

export const restrictEvidenceToMeetingIds = (
  context: RetrievalResult[],
  meetingIds?: string[],
): RetrievalResult[] => {
  if (!meetingIds) return context;
  const allowed = new Set(meetingIds);
  return context.filter(
    (result) =>
      result.source_type !== 'artifact' && allowed.has(result.meeting_id),
  );
};

export const getProjectFacetKeywords = (
  keywords: string[],
  labels: string[],
): string[] => {
  const labelTokens = labels
    .join(' ')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  return keywords.filter(
    (keyword) => !labelTokens.includes(keyword.toLocaleLowerCase()),
  );
};

export const combineProjectFacetContext = (
  primary: RetrievalResult[],
  supplemental: RetrievalResult[],
): RetrievalResult[] =>
  supplemental.length
    ? balanceProjectNoteContexts(
        [
          primary
            .filter((result) => result.source_type !== 'artifact')
            .slice(0, 12),
          supplemental.slice(0, 12),
        ],
        12,
      )
    : primary;

export const findExplicitProjectScopes = (
  query: string,
  projects: ExplicitProjectScope[],
): ExplicitProjectScope[] => {
  const matchedLabels = new Map<
    string,
    { project: ExplicitProjectScope; literalName: boolean }
  >();
  for (const project of projects) {
    const matchLabel = (label: string): string | null => {
      const trimmed = label.trim();
      if (
        trimmed.length < 3 ||
        /^(?:project|initiative|workstream|stream|roadmap)$/i.test(trimmed)
      )
        return null;
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(
        `(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`,
        'iu',
      ).test(query)
        ? trimmed.toLocaleLowerCase()
        : null;
    };
    const nameLabel = matchLabel(project.name);
    const matchedLabel = nameLabel || matchLabel(project.displayTitle);
    if (!matchedLabel) continue;
    const previous = matchedLabels.get(matchedLabel);
    if (!previous || (nameLabel && !previous.literalName)) {
      matchedLabels.set(matchedLabel, {
        project,
        literalName: Boolean(nameLabel),
      });
    }
  }
  const seen = new Set<string>();
  return [...matchedLabels.values()].flatMap(({ project }) => {
    if (seen.has(project.canonicalId)) return [];
    seen.add(project.canonicalId);
    return [project];
  });
};

export const balanceProjectNoteContexts = (
  groups: RetrievalResult[][],
  limit = 12,
): RetrievalResult[] => {
  const notes = groups.map((group) =>
    group.filter((result) => result.source_type !== 'artifact').slice(0, limit),
  );
  const selected = new Map<string, RetrievalResult>();
  for (let index = 0; index < limit; index += 1) {
    for (const group of notes) {
      const result = group[index];
      if (!result) continue;
      const previous = selected.get(result.meeting_id);
      if (previous) {
        if (
          previous.source_revision &&
          previous.source_revision === result.source_revision &&
          ((previous.evidence_kind === 'note' &&
            result.evidence_kind === 'section') ||
            (previous.evidence_kind === 'section' &&
              result.evidence_kind === 'note'))
        ) {
          if (result.evidence_kind === 'note')
            selected.set(result.meeting_id, result);
          continue;
        }
        if (previous.evidence_text !== result.evidence_text) {
          selected.set(result.meeting_id, {
            ...previous,
            evidence_text: `${previous.evidence_text}\n${result.evidence_text}`,
            retrieved_sections: [
              ...(previous.retrieved_sections || []),
              ...(result.retrieved_sections || []),
            ].filter(
              (section, position, sections) =>
                sections.findIndex(
                  (candidate) => candidate.section_id === section.section_id,
                ) === position,
            ),
          });
        }
      } else if (selected.size < limit) selected.set(result.meeting_id, result);
    }
  }
  return [...selected.values()];
};
