import type {
  MeetingTerminologyArtifactV1,
  TerminologySignal,
} from './analysisTypes';
import { resolveSourceSpan } from './meetingNotesSource';
import type { NotesAudit, NotesDraft, NotesSource } from './meetingNotesTypes';
import {
  MAX_TERMINOLOGY_CANDIDATES,
  createTerminologyArtifact,
} from './terminologyReconciliation';

const normalize = (text: string): string =>
  text.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const escapePattern = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termPattern = (term: string): string =>
  `(?<![\\p{L}\\p{N}_])${escapePattern(term)}(?![\\p{L}\\p{N}_])`;

const explicitlyDefines = (
  text: string,
  raw: string,
  preferred: string,
): boolean => {
  const definition = new RegExp(
    `${termPattern(raw)}\\s+(?:stands for|means|is short for|is spelled(?: as)?)\\s+["“']?${termPattern(preferred)}["”']?(?=$|[.,;:!?]|\\s+(?:which|that|and|but|not|here)\\b)`,
    'giu',
  );
  for (const match of text.matchAll(definition)) {
    // Only inspect the cited text. Never seek a definition (or its scope) in
    // uncited material elsewhere in the source segment.
    const before =
      text
        .slice(0, match.index)
        .split(/[.!?;\n]/)
        .at(-1) ?? '';
    const remaining = text.slice(match.index + match[0].length);
    const [after = '', following = ''] = remaining.split(/[.!?;\n]/);
    const uncertainBefore =
      /\b(?:not|never|no|maybe|perhaps|possibly|probably|might|could|may|think|guess|believe|assume|suppose|supposedly|unsure|uncertain|whether|if|hypothetically)\b|n['’]t\b/i;
    const uncertainAfter =
      /\b(?:incorrect|false|wrong|unsure|uncertain|unconfirmed|maybe|perhaps|possibly|probably|think|guess|supposedly)\b|\bnot\s+(?:true|sure|correct|certain)\b/i;
    const question = remaining.match(/[.!?;\n]/)?.[0] === '?';
    const qualifiedNextSentence =
      /\b(?:that|definition|expansion|spelling|meaning)\b/i.test(following) &&
      uncertainAfter.test(following);
    if (
      !uncertainBefore.test(before) &&
      !uncertainAfter.test(after) &&
      !question &&
      !qualifiedNextSentence
    )
      return true;
  }
  return false;
};

// A small veto grammar, not general entailment: explicit denial of the same
// expansion, or a named retraction of this raw term's definition. Check all
// cited spans so a proposal cannot hide the contradiction by omitting its index.
const explicitlyRetracts = (
  text: string,
  raw: string,
  preferred: string,
): boolean => {
  const term = termPattern(raw);
  const expansion = termPattern(preferred);
  return [
    `${term}\\s+(?:does not|doesn['’]t|did not|didn['’]t)\\s+(?:stand for|mean)\\s+${expansion}`,
    `${term}\\s+(?:is not|isn['’]t)\\s+(?:short for|spelled(?: as)?)\\s+${expansion}`,
    `\\b(?:definition|expansion|spelling|meaning)\\s+of\\s+${term}\\s+(?:was|is|has been)\\s+(?:wrong|incorrect|false|withdrawn|retracted|uncertain|unconfirmed)\\b`,
    `\\b(?:withdraw|retract)(?:\\s+(?:my|the|that|earlier|previous|original)){0,4}\\s+(?:definition|expansion|spelling|meaning)\\s+of\\s+${term}`,
  ].some((pattern) => new RegExp(pattern, 'iu').test(text));
};

/** Editor trust is stricter than the legacy terminology gate: model-provided
 * signals are discarded, and definitions must bind every alias inside an
 * individual source span cited by the edited document. */
export const createEditorTerminologyArtifact = ({
  source,
  draft,
  proposals,
  context,
}: {
  source: NotesSource;
  draft: NotesDraft;
  proposals: NotesAudit['terminology'];
  context: { trustedUserTerms: string[]; provider: string; model: string };
}): MeetingTerminologyArtifactV1 | undefined => {
  if (!Array.isArray(proposals) || proposals.length === 0) return undefined;
  const blocks = [
    ...(draft.overview ? [draft.overview] : []),
    ...draft.sections.flatMap((section) => [section.title, ...section.items]),
    ...(draft.recentWin ? [draft.recentWin.win, draft.recentWin.impact] : []),
  ];
  const cited = blocks.flatMap((block) =>
    block.sources.flatMap((span) => {
      try {
        return [
          {
            segment: span.segment,
            text: resolveSourceSpan(source, span),
            speaker: source.segments.find(
              (segment) => segment.index === span.segment,
            )?.speaker,
          },
        ];
      } catch {
        return [];
      }
    }),
  );
  const trustedTerms = new Set(context.trustedUserTerms.map(normalize));
  const generatedAt = new Date().toISOString();
  let result: MeetingTerminologyArtifactV1 | undefined;
  for (const proposal of proposals.slice(0, MAX_TERMINOLOGY_CANDIDATES)) {
    if (
      !proposal ||
      typeof proposal !== 'object' ||
      !Array.isArray(proposal.rawForms) ||
      !Array.isArray(proposal.segmentIndexes)
    )
      continue;
    if (
      proposal.preferredTerm !== null &&
      typeof proposal.preferredTerm !== 'string'
    )
      continue;
    const rawForms = [
      ...new Set(
        proposal.rawForms
          .filter(
            (value): value is string =>
              typeof value === 'string' &&
              value.trim().length >= 2 &&
              value.trim().length <= 80 &&
              !/[\r\n]/.test(value),
          )
          .map((value) => value.trim()),
      ),
    ];
    const preferredTerm = proposal.preferredTerm?.trim() || null;
    if (
      rawForms.length === 0 ||
      (preferredTerm &&
        (preferredTerm.length > 160 || /[\r\n]/.test(preferredTerm)))
    )
      continue;
    const indexes = new Set(
      proposal.segmentIndexes.filter(
        (value) => Number.isInteger(value) && value >= 0,
      ),
    );
    const evidence = cited.filter(
      (span) =>
        indexes.has(span.segment) &&
        rawForms.some((raw) =>
          new RegExp(termPattern(raw), 'iu').test(span.text),
        ),
    );
    if (
      !rawForms.every((raw) =>
        evidence.some((span) =>
          new RegExp(termPattern(raw), 'iu').test(span.text),
        ),
      )
    )
      continue;
    const trusted =
      preferredTerm !== null && trustedTerms.has(normalize(preferredTerm));
    const conflicted =
      preferredTerm !== null &&
      rawForms.some((raw) =>
        cited.some((span) => explicitlyRetracts(span.text, raw, preferredTerm)),
      );
    const defined =
      preferredTerm !== null &&
      !conflicted &&
      rawForms.every((raw) =>
        evidence.some((span) =>
          explicitlyDefines(span.text, raw, preferredTerm),
        ),
      );
    const signals: TerminologySignal[] = [
      ...(trusted ? ['known_entity' as const] : []),
      ...(defined ? ['spoken_definition' as const] : []),
    ];
    // Isolate proposals so legacy findCandidate cannot lend one proposal's
    // verified definition to a different preferred term sharing the raw form.
    const artifact = createTerminologyArtifact({
      candidates: [
        {
          rawForms,
          segmentIndexes: [...new Set(evidence.map((span) => span.segment))],
          // Retain source speaker metadata for the legacy protected-name gate;
          // the text itself is still only the exact cited span.
          contexts: evidence.map(
            (span) => `${span.speaker ?? 'Speaker'}: ${span.text}`,
          ),
          kind: 'domain_term',
          reasons: defined
            ? ['spoken_definition']
            : trusted
              ? ['known_term_match']
              : ['ambiguous'],
        },
      ],
      proposals: [
        {
          raw_forms: rawForms,
          preferred_term: preferredTerm,
          confidence: proposal.confidence,
          signals,
        },
      ],
      knownTerms: context.trustedUserTerms,
      provider: context.provider,
      model: context.model,
      generatedAt,
    });
    // A trusted spelling is not permission to overwrite an explicitly disputed
    // definition. Retain the verified trust signal but require human resolution.
    if (conflicted) {
      for (const item of artifact.proposals) {
        if (item.status === 'applied') item.status = 'proposed';
      }
    }
    if (!result) result = artifact;
    else result.proposals.push(...artifact.proposals);
  }
  return result;
};
