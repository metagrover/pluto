import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import type { RetrievalResult } from '../electron/intelligence/intelligenceTypes.ts';
import { buildMeetingNotesEvidenceDocument } from '../electron/intelligence/meetingNotesEvidence.ts';
import { getAskPlutoPrompt } from '../electron/intelligence/queryPrompts.ts';
import { UnifiedLLMProvider } from '../electron/llm/unifiedProvider.ts';
import {
  type AskPlutoBenchmarkMode,
  type AskPlutoBenchmarkSample,
  evaluateAskPlutoBenchmark,
  validateAskPlutoBenchmarkSample,
} from '../src/services/askPlutoBenchmark.ts';
import { OLLAMA_GENERAL_MODEL } from '../src/utils/ollamaModels.ts';

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const model =
  process.env.ASK_PLUTO_BENCHMARK_MODEL ||
  argumentValue('--model') ||
  argumentValue('--deep-model') ||
  OLLAMA_GENERAL_MODEL;
const runs = Math.max(
  1,
  Number.parseInt(
    process.env.ASK_PLUTO_BENCHMARK_RUNS || argumentValue('--runs') || '5',
    10,
  ),
);
const outPath = path.resolve(
  process.env.ASK_PLUTO_BENCHMARK_OUT ||
    argumentValue('--out') ||
    'artifacts/ask-pluto-benchmark/latest.json',
);

const provider = new UnifiedLLMProvider('ollama', {
  ollama_model: model,
  ollama_fast_model: model,
  ollama_seed: 42,
});

const fixtures = {
  fast: {
    query: 'Who owns launch signoff and when is the launch?',
    meetings: [
      {
        id: 'benchmark-fast-1',
        title: 'Launch Review',
        enhanced_notes:
          'Sam owns launch signoff. The launch is scheduled for Friday.',
        mid_json: JSON.stringify({
          participants: [{ name: 'Sam' }],
          topics: [{ name: 'Launch' }],
          decisions: [{ description: 'Launch on Friday.' }],
          action_items: [{ description: 'Sam owns launch signoff.' }],
        }),
      },
    ],
    intent: 'factual',
  },
  deep: {
    query:
      'What changed between the earlier and current launch plans, and what risk remains?',
    meetings: [
      {
        id: 'benchmark-deep-1',
        title: 'Earlier Launch Review',
        enhanced_notes:
          'The launch was planned for Tuesday. Sam owned final signoff. Integration testing was complete.',
      },
      {
        id: 'benchmark-deep-2',
        title: 'Current Launch Review',
        enhanced_notes:
          'The launch moved to Friday. Alex now owns final signoff. Payment integration testing remains blocked.',
      },
    ],
    intent: 'comparative',
  },
} as const;

type BenchmarkMeeting =
  | (typeof fixtures.fast.meetings)[number]
  | (typeof fixtures.deep.meetings)[number];

const toRetrievalResult = (meeting: BenchmarkMeeting): RetrievalResult => {
  const document = buildMeetingNotesEvidenceDocument(meeting);
  const evidence = [
    document.notesText && `[Analysis]: ${document.notesText}`,
    document.decisionsText && `[Decisions]: ${document.decisionsText}`,
    document.actionItemsText && `[Action items]: ${document.actionItemsText}`,
    document.topicsText && `[Topics]: ${document.topicsText}`,
    document.participantsText && `[Participants]: ${document.participantsText}`,
  ].filter((value): value is string => Boolean(value));
  return {
    meeting_id: document.meetingId,
    meeting_title: document.title,
    mid: null,
    evidence_text: evidence.join('\n'),
    score: 1,
    score_breakdown: {
      fts_rank: 1,
      graph_proximity: 0,
      recency_decay: 0,
      mention_weight: 0,
    },
  };
};

export const answerPassesQuality = (
  mode: AskPlutoBenchmarkMode,
  answer: string,
): boolean => {
  const normalized = answer.toLowerCase();
  if (
    !normalized.trim() ||
    /could(?:n't| not) (?:find|verify)|no evidence/.test(normalized)
  )
    return false;
  if (
    mode === 'deep' &&
    (/\bsam\s+(?:(?:still|now|currently)\s+)?(?:owns?|is responsible for)\b/.test(
      normalized,
    ) ||
      /\b(?:testing|payment integration)\s+(?:is|was)\s+(?:now\s+)?(?:complete|unblocked)\b/.test(
        normalized,
      ))
  )
    return false;
  if (mode === 'fast') {
    return /\bsam\b/.test(normalized) && normalized.includes('friday');
  }
  return (
    normalized.includes('tuesday') &&
    normalized.includes('friday') &&
    /\bsam\b/.test(normalized) &&
    /\balex\b/.test(normalized) &&
    normalized.includes('payment') &&
    normalized.includes('block')
  );
};

const generate = async (
  mode: AskPlutoBenchmarkMode,
  coldStart: boolean,
): Promise<AskPlutoBenchmarkSample> => {
  const startedAt = performance.now();
  const fixture = fixtures[mode];
  const context = fixture.meetings.map(toRetrievalResult);
  const retrievalCompletedAt = performance.now();
  const prompt = getAskPlutoPrompt(fixture.query, context, fixture.intent);
  const queuedAt = performance.now();
  let generationStartedAt: number | null = null;
  let firstTokenMs: number | null = null;
  const answer = await provider.answerAskPluto(prompt, {
    mode,
    onStart: () => {
      generationStartedAt = performance.now();
    },
    onToken: (delta) => {
      if (delta && firstTokenMs === null) {
        firstTokenMs = performance.now() - startedAt;
      }
    },
  });
  const completedAt = performance.now();
  if (firstTokenMs === null || generationStartedAt === null || !answer.trim()) {
    throw new Error(`Ollama returned no visible ${mode} answer`);
  }
  const sample: AskPlutoBenchmarkSample = {
    mode,
    policy: 'notes_only',
    retrievalMs: Math.round(retrievalCompletedAt - startedAt),
    queueMs: Math.round(generationStartedAt - queuedAt),
    firstTokenMs: Math.round(firstTokenMs),
    generationMs: Math.round(completedAt - generationStartedAt),
    totalMs: Math.round(completedAt - startedAt),
    promptChars: prompt.length,
    evidenceChars: context.reduce(
      (total, source) => total + source.evidence_text.length,
      0,
    ),
    sourceCount: context.length,
    coldStart,
    qualityPassed: answerPassesQuality(mode, answer),
  };
  if (!validateAskPlutoBenchmarkSample(sample)) {
    throw new Error('Ask Pluto benchmark produced an unsafe sample');
  }
  return sample;
};

export const runAskPlutoBenchmark = async () => {
  await generate('fast', true);
  const samples: AskPlutoBenchmarkSample[] = [];
  for (const mode of ['fast', 'deep'] as const) {
    for (let index = 0; index < runs; index += 1) {
      const sample = await generate(mode, false);
      samples.push(sample);
      console.log(
        `[AskPlutoBenchmark] mode=${mode} run=${index + 1}/${runs} retrieval=${sample.retrievalMs}ms queue=${sample.queueMs}ms first_token=${sample.firstTokenMs}ms generation=${sample.generationMs}ms total=${sample.totalMs}ms quality=${sample.qualityPassed ? 'pass' : 'fail'}`,
      );
    }
  }

  const evaluation = evaluateAskPlutoBenchmark(samples);
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    model,
    runsPerMode: runs,
    responseBudgets: { fast: 192, deep: 512 },
    environment: {
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model || 'unknown',
      memoryBytes: os.totalmem(),
      node: process.version,
    },
    samples,
    evaluation,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `[AskPlutoBenchmark] ${evaluation.passed ? 'PASS' : 'FAIL'} fast_p95=${evaluation.fast.firstTokenP95Ms}ms/${evaluation.fast.targetMs}ms deep_p95=${evaluation.deep.firstTokenP95Ms}ms/${evaluation.deep.targetMs}ms report=${outPath}`,
  );
  if (!evaluation.passed) process.exitCode = 1;
  return report;
};
