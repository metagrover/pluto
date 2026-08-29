import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

import {
  type AskPlutoBenchmarkMode,
  type AskPlutoBenchmarkSample,
  evaluateAskPlutoBenchmark,
} from '../src/services/askPlutoBenchmark.ts';
import {
  OLLAMA_GENERAL_MODEL,
  OLLAMA_QUICK_CHAT_MODEL,
} from '../src/utils/ollamaModels.ts';

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const sharedModel = argumentValue('--model');
const fastModel =
  argumentValue('--fast-model') || sharedModel || OLLAMA_QUICK_CHAT_MODEL;
const deepModel =
  argumentValue('--deep-model') || sharedModel || OLLAMA_GENERAL_MODEL;
const runs = Math.max(1, Number.parseInt(argumentValue('--runs') || '5', 10));
const deepTokens = Math.max(
  2048,
  Number.parseInt(argumentValue('--deep-tokens') || '2048', 10),
);
const outPath = path.resolve(
  argumentValue('--out') || 'artifacts/ask-pluto-benchmark/latest.json',
);
const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

const prompts: Record<AskPlutoBenchmarkMode, string> = {
  fast: `You are Pluto, a meeting assistant. Answer in one sentence using only the evidence and include [Source 1].

Question: Who owns launch signoff and when is the launch?

[Source 1] Meeting: Launch Review
Evidence: Sam owns launch signoff. The launch is Friday.`,
  deep: `You are Pluto, a meeting assistant. Compare the two meetings in at most three concise bullets. Use both [Source 1] and [Source 2] for every comparison claim.

Question: What changed between the earlier and current launch plans, and what risk remains?

[Source 1] Meeting: Earlier Launch Review
Evidence: The launch was planned for Tuesday. Sam owned final signoff. Integration testing was complete.

[Source 2] Meeting: Current Launch Review
Evidence: The launch moved to Friday. Alex now owns final signoff. Payment integration testing remains blocked.`,
};

const answerPassesQuality = (
  mode: AskPlutoBenchmarkMode,
  answer: string,
): boolean => {
  const normalized = answer.toLowerCase();
  if (mode === 'fast') {
    return (
      normalized.includes('sam') &&
      normalized.includes('friday') &&
      /\[source\s+1\]/i.test(answer)
    );
  }
  return (
    normalized.includes('tuesday') &&
    normalized.includes('friday') &&
    normalized.includes('sam') &&
    normalized.includes('alex') &&
    normalized.includes('payment') &&
    normalized.includes('block') &&
    /\[source\s+1\]/i.test(answer) &&
    /\[source\s+2\]/i.test(answer)
  );
};

const generate = async (
  mode: AskPlutoBenchmarkMode,
): Promise<AskPlutoBenchmarkSample> => {
  const startedAt = performance.now();
  let firstTokenMs: number | null = null;
  let pending = '';
  let answer = '';
  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: mode === 'fast' ? fastModel : deepModel,
      prompt: prompts[mode],
      stream: true,
      think: false,
      keep_alive: '1h',
      options: {
        num_ctx: mode === 'deep' ? 16_384 : 8192,
        num_predict: mode === 'deep' ? deepTokens : 1024,
        temperature: 0.2,
        ...(mode === 'deep' ? { top_k: 40, top_p: 1 } : {}),
        seed: 42,
      },
    }),
    signal: AbortSignal.timeout(mode === 'deep' ? 180_000 : 90_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Ollama benchmark request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const consume = (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const packet = JSON.parse(line) as { response?: unknown };
      if (typeof packet.response !== 'string' || !packet.response) continue;
      if (firstTokenMs === null) firstTokenMs = performance.now() - startedAt;
      answer += packet.response;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(`${decoder.decode()}${pending ? '\n' : ''}`);
  if (firstTokenMs === null || !answer.trim()) {
    throw new Error(`Ollama returned no visible ${mode} answer`);
  }
  return {
    mode,
    firstTokenMs: Math.round(firstTokenMs),
    totalMs: Math.round(performance.now() - startedAt),
    qualityPassed: answerPassesQuality(mode, answer),
  };
};

const main = async () => {
  await generate('fast');
  const samples: AskPlutoBenchmarkSample[] = [];
  for (const mode of ['fast', 'deep'] as const) {
    for (let index = 0; index < runs; index += 1) {
      const sample = await generate(mode);
      samples.push(sample);
      console.log(
        `[AskPlutoBenchmark] mode=${mode} run=${index + 1}/${runs} first_token=${sample.firstTokenMs}ms total=${sample.totalMs}ms quality=${sample.qualityPassed ? 'pass' : 'fail'}`,
      );
    }
  }

  const evaluation = evaluateAskPlutoBenchmark(samples);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    models: { fast: fastModel, deep: deepModel },
    runsPerMode: runs,
    deepTokens,
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
};

void main().catch((error) => {
  console.error('[AskPlutoBenchmark] failed:', error);
  process.exitCode = 1;
});
