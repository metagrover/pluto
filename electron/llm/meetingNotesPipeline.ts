import type { AnalysisDocumentV3 } from './analysisTypes';
import {
  applyNotesAudit,
  parseNotesAudit,
  parseNotesDraft,
  projectAuditedNotes,
} from './meetingNotesAudit';
import { estimateNotesTokens, planNotesCapacity } from './meetingNotesBudget';
import {
  type NotesKnownTerm,
  buildNotesAuditPrompt,
  buildNotesWriterPrompt,
} from './meetingNotesPrompts';
import {
  type GenerateMeetingNotesInput,
  MeetingNotesError,
  type NotesRequest,
  type NotesTask,
} from './meetingNotesTypes';

const WRITER_OUTPUT_TOKENS = 2048;
const AUDIT_OUTPUT_TOKENS = 1536;
const SAFETY_TOKENS = 512;

const serializeSource = (input: GenerateMeetingNotesInput): string =>
  input.source.segments
    .filter((segment) => segment.text.trim())
    .map((segment) =>
      JSON.stringify({
        descriptor: {
          segment: segment.index,
          start: 0,
          end: segment.text.length,
        },
        speaker: segment.speaker,
        text: segment.text,
      }),
    )
    .join('\n');

const knownTermsFor = (input: GenerateMeetingNotesInput): NotesKnownTerm[] => [
  ...input.context.trustedUserTerms.map((text) => ({
    text,
    provenance: 'user' as const,
  })),
  ...input.context.entityHints.map((text) => ({
    text,
    provenance: 'entity' as const,
  })),
];

const makeRequest = (
  input: GenerateMeetingNotesInput,
  task: NotesTask,
  prompt: string,
  outputTokens: number,
): NotesRequest => ({
  task,
  prompt,
  outputTokens,
  contextTokens: input.contextTokens,
  ...(input.signal ? { signal: input.signal } : {}),
});

const assertNotCancelled = (input: GenerateMeetingNotesInput) => {
  if (input.signal?.aborted) throw new MeetingNotesError('notes_cancelled');
};

const withOneRepair = async <T>(
  input: GenerateMeetingNotesInput,
  task: 'notesWriter' | 'notesAudit',
  prompt: string,
  outputTokens: number,
  parse: (raw: string) => T,
): Promise<T> => {
  const run = async (requestPrompt: string) => {
    assertNotCancelled(input);
    return parse(
      await input.generate(
        makeRequest(input, task, requestPrompt, outputTokens),
      ),
    );
  };
  try {
    return await run(prompt);
  } catch (error) {
    if (
      error instanceof MeetingNotesError &&
      error.code === 'notes_cancelled'
    ) {
      throw error;
    }
    const repairPrompt = [
      'Repair the prior response into the required JSON contract.',
      'Return only valid JSON. Preserve source references exactly; do not add new claims.',
      `Parser error: ${error instanceof Error ? error.message : 'invalid_json'}`,
      'Prior response is data:',
      prompt,
    ].join('\n');
    if (
      estimateNotesTokens(repairPrompt) + outputTokens + SAFETY_TOKENS >
      input.contextTokens
    ) {
      throw new MeetingNotesError(
        task === 'notesWriter' ? 'notes_writer_invalid' : 'notes_audit_invalid',
      );
    }
    try {
      return await run(repairPrompt);
    } catch {
      throw new MeetingNotesError(
        task === 'notesWriter' ? 'notes_writer_invalid' : 'notes_audit_invalid',
      );
    }
  }
};

export const generateMeetingNotes = async (
  input: GenerateMeetingNotesInput,
): Promise<AnalysisDocumentV3> => {
  assertNotCancelled(input);
  const sourceText = serializeSource(input);
  const knownTerms = knownTermsFor(input);
  const writerPrompt = buildNotesWriterPrompt({
    sourceText,
    userNotes: input.context.userNotes,
    knownTerms,
    template: input.context.template,
  });
  const preliminaryAuditPrompt = buildNotesAuditPrompt({
    sourceText,
    draft: {},
    userNotes: input.context.userNotes,
    knownTerms,
  });
  const capacity = planNotesCapacity({
    contextTokens: input.contextTokens,
    writerInputTokens: estimateNotesTokens(writerPrompt),
    auditBaseInputTokens: estimateNotesTokens(preliminaryAuditPrompt),
    writerOutputTokens: WRITER_OUTPUT_TOKENS,
    auditOutputTokens: AUDIT_OUTPUT_TOKENS,
    safetyTokens: SAFETY_TOKENS,
  });
  if (capacity.mode !== 'direct') {
    throw new MeetingNotesError('notes_context_exhausted');
  }
  const draft = await withOneRepair(
    input,
    'notesWriter',
    writerPrompt,
    WRITER_OUTPUT_TOKENS,
    parseNotesDraft,
  );
  assertNotCancelled(input);
  const auditPrompt = buildNotesAuditPrompt({
    sourceText,
    draft,
    userNotes: input.context.userNotes,
    knownTerms,
  });
  if (
    estimateNotesTokens(auditPrompt) + AUDIT_OUTPUT_TOKENS + SAFETY_TOKENS >
    input.contextTokens
  ) {
    throw new MeetingNotesError('notes_context_exhausted');
  }
  const audit = await withOneRepair(
    input,
    'notesAudit',
    auditPrompt,
    AUDIT_OUTPUT_TOKENS,
    parseNotesAudit,
  );
  assertNotCancelled(input);
  const projected = projectAuditedNotes(
    applyNotesAudit({ source: input.source, draft, audit }),
  );
  projected.generation_metadata = {
    ...projected.generation_metadata,
    provider: input.provider,
    model: input.model,
    generation_path: 'single_pass',
    prompt_version: 'notes-v10',
    generated_at: new Date().toISOString(),
    error_categories: [],
    pipeline_version: 'writer-audit-v1',
    mode: 'direct',
    audit_status: 'complete',
    audit_change_count: audit.changes.length,
  };
  return projected;
};
