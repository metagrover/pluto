import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import type { NotesSource } from '../../electron/llm/meetingNotesTypes';
import { visibleBlocks } from './notesReplayProjection';

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Triage, not an entailment judge. Only a reviewed gold can establish recall. */
export function triageNotesReplay(
  analysis: AnalysisDocumentV3,
  source: NotesSource,
) {
  const blocks = visibleBlocks(analysis, source);
  const sourceTexts = new Set(
    source.segments.map((segment) => normalize(segment.text)).filter(Boolean),
  );
  const invalidProvenance = blocks
    .filter((block) => !block.provenanceValid)
    .map((block) => block.path);
  const literalCitationMismatches = blocks
    .filter((block) => {
      const text = normalize(block.text);
      return (
        text &&
        sourceTexts.has(text) &&
        block.resolvedEvidence !== null &&
        !normalize(block.resolvedEvidence).includes(text)
      );
    })
    .map((block) => block.path);
  const points = blocks.filter((block) => block.kind === 'point');
  const verbatimPoints = points.filter((block) =>
    sourceTexts.has(normalize(block.text)),
  ).length;
  const transcriptDumpSuspected =
    points.length >= 8 && verbatimPoints / points.length >= 0.7;
  const flags = [
    ...(analysis.quality.issues.length ||
    analysis.quality.fallback_used ||
    analysis.generation_metadata?.audit_status === 'complete_with_warnings'
      ? ['pipeline_quality_warnings']
      : []),
    ...(invalidProvenance.length ? ['invalid_visible_provenance'] : []),
    ...(literalCitationMismatches.length ? ['literal_citation_mismatch'] : []),
    ...(transcriptDumpSuspected ? ['transcript_dump_suspected'] : []),
  ];
  return {
    status: flags.length ? 'flagged_for_review' : 'pending_review',
    qualityApproved: false,
    flags,
    invalidProvenance,
    literalCitationMismatches,
    pointCount: points.length,
    verbatimPoints,
    note: 'Literal-copy heuristics do not prove semantic support or completeness; clean triage is not acceptance.',
  };
}
