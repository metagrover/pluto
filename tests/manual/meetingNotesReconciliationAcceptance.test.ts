import { describe, expect, it } from 'vitest';
import type { AnalysisDocumentV3 } from '../../electron/llm/analysisTypes';
import {
  buildSourceReconciliationPrompt,
  parseReconciledSource,
  reconciliationDraft,
} from '../../electron/llm/meetingNotesReconciliation';
import { createNotesSource } from '../../electron/llm/meetingNotesSource';
import { createNotesWireRequest } from '../../electron/llm/meetingNotesWire';
import { UnifiedLLMProvider } from '../../electron/llm/unifiedProvider';
import { meetingNotesEditorCases } from './fixtures/meetingNotesEditorCases';

const suite =
  process.env.RUN_MEETING_NOTES_PROVIDER_BENCHMARK === '1'
    ? describe
    : describe.skip;
const seeds = process.env.MEETING_NOTES_ACCEPTANCE_SEED
  ? [Number(process.env.MEETING_NOTES_ACCEPTANCE_SEED)]
  : [41, 42, 43];
const model = 'qwen3.5:9b';

const run = async (
  segments: Array<{ speaker: string; text: string }>,
  seed: number,
) => {
  const source = createNotesSource(JSON.stringify({ segments }));
  const spans = source.segments
    .filter((row) => row.text.trim())
    .map((row) => ({ segment: row.index, start: 0, end: row.text.length }));
  const sourceText = spans
    .map((descriptor) =>
      JSON.stringify({
        descriptor,
        speaker: source.segments[descriptor.segment]!.speaker,
        text: source.segments[descriptor.segment]!.text,
      }),
    )
    .join('\n');
  const wire = createNotesWireRequest(
    buildSourceReconciliationPrompt(sourceText),
    spans,
  );
  const provider = new UnifiedLLMProvider('ollama', {
    ollama_model: model,
    ollama_seed: seed,
    ollama_structured_thinking: false,
  }) as unknown as {
    generateResumableAnalysisText(
      request: Record<string, unknown>,
    ): Promise<string>;
  };
  const started = Date.now();
  // One attempt: retries must not conceal semantic failure in this capability gate.
  const raw = await provider.generateResumableAnalysisText({
    prompt: wire.prompt,
    task: 'notesWriter',
    jsonMode: true,
    signal: AbortSignal.timeout(180_000),
    notesBudget: { contextTokens: 16384, outputTokens: 2048 },
  });
  console.log(
    JSON.stringify({
      reconciliationAcceptance: { seed, latencyMs: Date.now() - started, raw },
    }),
  );
  const reconciled = parseReconciledSource(wire.decode(raw), source);
  const draft = reconciliationDraft(reconciled);
  for (const section of draft.sections) {
    for (const item of section.items) {
      for (const span of item.sources) expect(spans).toContainEqual(span);
    }
  }
  // Stage-only adapter: the reconciler has no overview or presentation contract.
  // Expose ALL returned claims to the existing independent semantic scorers,
  // without adding facts, inferred classifications, evidence quotes, or wording.
  // Final composition must pass the same scorers without this adapter.
  // Do not use the audited projection: it can infer a missing owner, concealing
  // a reconciliation error from this independent gate.
  const topics = draft.sections.map((section) => ({
    title: section.title.text,
    summary: '',
    key_points: section.items
      .filter((item) => item.kind === 'point')
      .map((item) => ({ text: item.text })),
    action_items: section.items
      .filter((item) => item.kind === 'action')
      .map((item) => ({
        text: item.text,
        ...(item.owner === null ? {} : { assignee: item.owner }),
        ...(item.due === null ? {} : { due: item.due }),
      })),
    decisions: section.items
      .filter((item) => item.kind === 'decision')
      .map((item) => ({
        text: item.text,
        ...(item.owner === null ? {} : { decided_by: item.owner }),
      })),
    open_questions: section.items
      .filter((item) => item.kind === 'question')
      .map((item) => item.text),
  }));
  const analysis: AnalysisDocumentV3 = {
    analysis_schema_version: 3,
    meeting_type: 'general',
    overview: draft.sections
      .flatMap((section) => section.items.map((item) => item.text))
      .join('\n'),
    topics,
    all_action_items: topics.flatMap((topic) =>
      topic.action_items.map((item) => ({ ...item, topic: topic.title })),
    ),
    all_decisions: topics.flatMap((topic) => topic.decisions),
    quality: {
      format_pass: true,
      retry_count: 0,
      fallback_used: false,
      issues: [],
    },
  };
  return analysis;
};

suite('source-only reconciliation real-provider acceptance', () => {
  for (const fixture of meetingNotesEditorCases) {
    it.each(seeds)(
      `${fixture.id} (seed %i)`,
      async (seed) => {
        fixture.assertAnalysis(await run(fixture.segments, seed));
      },
      210_000,
    );
  }

  it.each(seeds)(
    'withdrawal and qualified promise across topics (seed %i)',
    async (seed) => {
      const analysis = await run(
        [
          {
            speaker: 'Ava',
            text: 'I will send the integration checklist to Ben by Friday.',
          },
          {
            speaker: 'Ben',
            text: 'If legal approves, I can draft the announcement.',
          },
          {
            speaker: 'Casey',
            text: 'Next quarter the team may explore a migration, but that is not a current commitment.',
          },
          {
            speaker: 'Dana',
            text: 'The research discussion has no assignments or decisions today.',
          },
          {
            speaker: 'Ava',
            text: 'I take back my earlier checklist commitment. The source data is incomplete, so no one should send it Friday.',
          },
          {
            speaker: 'Dana',
            text: 'After the final audit, I will publish the reviewed FAQ to Elena by Wednesday.',
          },
        ],
        seed,
      );
      expect(analysis.all_action_items).toHaveLength(1);
      expect(analysis.all_action_items[0]).toMatchObject({
        assignee: 'Dana',
        due: expect.stringMatching(/Wednesday/i),
        text: expect.stringMatching(/FAQ/i),
      });
      expect(analysis.all_action_items[0]!.text).toMatch(/after.*audit/i);
      expect(analysis.all_decisions).toHaveLength(0);
      expect(analysis.overview).toMatch(/checklist/i);
      expect(analysis.overview).toMatch(
        /withdraw|retract|take[n]? back|cancel|not.*send/i,
      );
      expect(analysis.overview).toMatch(/announcement/i);
      expect(analysis.overview).toMatch(/legal/i);
      expect(analysis.overview).toMatch(/migration/i);
      expect(analysis.overview).not.toMatch(/\bR\d+\b/);
      expect(analysis.overview).not.toMatch(
        /Ava will send the integration checklist/i,
      );
    },
    210_000,
  );

  it.each(seeds)(
    'reassigned task and past work holdout (seed %i)',
    async (seed) => {
      const analysis = await run(
        [
          {
            speaker: 'Rina',
            text: 'I already uploaded the old survey results yesterday.',
          },
          {
            speaker: 'Sol',
            text: 'I can prepare a fresh summary if someone needs it.',
          },
          {
            speaker: 'Rina',
            text: 'No need for that summary. Could you instead email the raw responses to Amara on Monday?',
          },
          {
            speaker: 'Sol',
            text: 'Yes, I will email those responses to Amara on Monday, provided the consent check passes.',
          },
          {
            speaker: 'Amara',
            text: 'I am receiving them, not sending them. There is no summary assignment.',
          },
        ],
        seed,
      );
      expect(analysis.all_action_items).toHaveLength(1);
      expect(analysis.all_action_items[0]).toMatchObject({
        assignee: 'Sol',
        due: expect.stringMatching(/Monday/i),
      });
      expect(analysis.all_action_items[0]!.text).toMatch(/email|send/i);
      expect(analysis.all_action_items[0]!.text).toMatch(/responses/i);
      expect(analysis.all_action_items[0]!.text).toMatch(/Amara/i);
      expect(analysis.all_action_items[0]!.text).toMatch(
        /(?:provided|if|after|once|subject to).*consent|consent.*(?:pass|approv)/i,
      );
      expect(analysis.all_action_items[0]!.text).not.toMatch(/summary/i);
      expect(analysis.all_decisions).toHaveLength(0);
      expect(analysis.overview).toMatch(/Rina.*(?:uploaded|upload|shared)/i);
      expect(analysis.overview).toMatch(/summary/i);
    },
    210_000,
  );
});
