export const PERSON_PROFILE_SECTIONS = {
  overview: 'Overview',
  responsibilities: 'Responsibilities & contributions',
  shared_context: 'Shared context',
  priorities: 'Priorities & decisions',
  collaboration: 'How they collaborate',
  evolution: 'How the context evolved',
  next_conversation: 'Before your next conversation',
  unknowns: 'Still unresolved',
} as const;

export type PersonProfileSection = keyof typeof PERSON_PROFILE_SECTIONS;

export interface PersonProfileClaim {
  section: PersonProfileSection;
  title: string;
  summary: string;
  citations: Array<{ meeting_id: string; quote: string }>;
}

/** Parse the optional profile extension; unsupported and uncited claims stay out. */
export const parsePersonProfile = (value: unknown): PersonProfileClaim[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .flatMap((raw): PersonProfileClaim[] => {
      if (!raw || typeof raw !== 'object') return [];
      const claim = raw as Record<string, unknown>;
      if (
        typeof claim.section !== 'string' ||
        !Object.hasOwn(PERSON_PROFILE_SECTIONS, claim.section) ||
        typeof claim.summary !== 'string' ||
        !claim.summary.trim() ||
        claim.summary.length > 1400 ||
        !Array.isArray(claim.citations) ||
        claim.citations.length > 4
      )
        return [];
      const citations = claim.citations
        .flatMap((rawCitation) => {
          if (!rawCitation || typeof rawCitation !== 'object') return [];
          const citation = rawCitation as Record<string, unknown>;
          return typeof citation.meeting_id === 'string' &&
            typeof citation.quote === 'string' &&
            citation.quote.trim().length >= 12
            ? [
                {
                  meeting_id: citation.meeting_id,
                  quote: citation.quote.trim(),
                },
              ]
            : [];
        })
        .slice(0, 4);
      const key = `${claim.section}:${claim.summary.trim().toLocaleLowerCase()}`;
      if (
        !citations.length ||
        citations.length !== claim.citations.length ||
        seen.has(key)
      )
        return [];
      seen.add(key);
      return [
        {
          section: claim.section as PersonProfileSection,
          title:
            typeof claim.title === 'string'
              ? claim.title.trim().slice(0, 100)
              : '',
          summary: claim.summary.trim(),
          citations,
        },
      ];
    })
    .slice(0, 32);
};

export const readPersonProfile = (
  structuredJson: string | null | undefined,
) => {
  try {
    const doc = JSON.parse(structuredJson || '{}');
    const evidence = Array.isArray(doc.evidence_index)
      ? doc.evidence_index
      : [];
    return parsePersonProfile(doc.person_profile).flatMap((claim) => {
      const citations = claim.citations.filter((citation) =>
        evidence.some(
          (entry: { meeting_id?: string; quote?: string }) =>
            entry?.meeting_id === citation.meeting_id &&
            entry.quote === citation.quote,
        ),
      );
      return citations.length === claim.citations.length
        ? [{ ...claim, citations }]
        : [];
    });
  } catch {
    return [];
  }
};
