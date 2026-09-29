import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const requiredOptIn = 'ASK_PLUTO_LIVE_BENCHMARK';
if (process.env[requiredOptIn] !== '1') {
  throw new Error(
    `Set ${requiredOptIn}=1 to run against the production Pluto database.`,
  );
}

const port = Number(process.env.ASK_PLUTO_LIVE_BENCHMARK_PORT || '9333');
const liveUserData = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'pluto',
);
const productionUserData = path.resolve(
  process.env.ASK_PLUTO_LIVE_BENCHMARK_USER_DATA_DIR || liveUserData,
);
const outputPath = path.resolve(
  process.env.ASK_PLUTO_LIVE_BENCHMARK_OUT ||
    `artifacts/ask-pluto-benchmark/live-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`,
);
const benchmarkProject =
  process.env.ASK_PLUTO_BENCHMARK_PROJECT || 'Project Atlas';
const benchmarkUnrelatedProject =
  process.env.ASK_PLUTO_BENCHMARK_UNRELATED_PROJECT || 'Unrelated Project';
const benchmarkColleague = process.env.ASK_PLUTO_BENCHMARK_COLLEAGUE || 'Gamma';
const benchmarkPersonA =
  process.env.ASK_PLUTO_BENCHMARK_PERSON_A || 'Alpha Contact';
const benchmarkPersonB =
  process.env.ASK_PLUTO_BENCHMARK_PERSON_B || 'Beta Reviewer';
const benchmarkRequirement =
  process.env.ASK_PLUTO_BENCHMARK_REQUIREMENT || 'deployment';
const benchmarkPrivateTerm =
  process.env.ASK_PLUTO_BENCHMARK_PRIVATE_TERM || 'hidden personal detail';
const fastModelOverride = process.env.ASK_PLUTO_BENCHMARK_FAST_MODEL?.trim();
const modelOverride = process.env.ASK_PLUTO_BENCHMARK_MODEL?.trim();
if (
  (fastModelOverride || modelOverride) &&
  (!process.env.ASK_PLUTO_LIVE_BENCHMARK_USER_DATA_DIR ||
    fs.realpathSync(productionUserData) === fs.realpathSync(liveUserData))
) {
  throw new Error('A model benchmark override requires a copied profile.');
}
if (fastModelOverride || modelOverride) {
  const installedModels = execFileSync('ollama', ['list'], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0]);
  for (const selectedModel of [fastModelOverride, modelOverride]) {
    if (selectedModel && !installedModels.includes(selectedModel)) {
      throw new Error('A benchmark model override is not installed locally.');
    }
  }
}

const allScenarios = [
  {
    id: 'named-project-detail',
    queries: [
      {
        text: `What is the current state of ${benchmarkProject}'s pipeline? What changed recently, and what needs attention next?`,
        expectedTopic: benchmarkProject,
        requiredAnswerPatterns: ['pipeline'],
      },
    ],
  },
  {
    id: 'named-project-continuation',
    queries: [
      {
        text: `What is the current state of ${benchmarkProject}'s pipeline? What needs attention next?`,
        expectedTopic: benchmarkProject,
        requiredAnswerPatterns: ['pipeline'],
      },
      {
        text: 'Tell me more about the pipeline and what we know versus what needs checking.',
        expectedTopic: benchmarkProject,
      },
      {
        text: 'What would you do first?',
        expectedTopic: benchmarkProject,
      },
    ],
  },
  {
    id: 'priority-to-project',
    queries: [
      { text: 'What should I focus on right now?' },
      {
        text: `Can we dive into more detail about ${benchmarkProject} and the pipeline there?`,
        expectedTopic: benchmarkProject,
        requiredAnswerPatterns: ['pipeline'],
      },
      {
        text: 'What has changed most recently, and what is the next concrete move?',
        expectedTopic: benchmarkProject,
        forbiddenAnswerPatterns: [benchmarkUnrelatedProject],
      },
      {
        text: 'Given all that, what would you do first?',
        expectedTopic: benchmarkProject,
        forbiddenAnswerPatterns: [benchmarkUnrelatedProject],
      },
    ],
  },
  {
    id: 'person-to-draft',
    queries: [
      {
        text: `What is ${benchmarkColleague} working on right now?`,
        forbiddenAnswerPatterns: [benchmarkPrivateTerm],
      },
      {
        text: 'Which of those items seems most urgent, and why?',
        forbiddenAnswerPatterns: [benchmarkPrivateTerm],
      },
      {
        text: `Draft a short, friendly follow-up message to ${benchmarkColleague} about it.`,
        expectsDraft: true,
        forbidRelativeDeadline: true,
        forbiddenAnswerPatterns: [
          benchmarkPrivateTerm,
          benchmarkUnrelatedProject,
        ],
      },
    ],
  },
  {
    id: 'person-overview-to-coaching',
    queries: [
      {
        text: `Tell me about ${benchmarkColleague}.`,
        forbiddenAnswerPatterns: [benchmarkPrivateTerm],
      },
      {
        text: 'How should I coach him?',
        forbiddenAnswerPatterns: [benchmarkPrivateTerm],
      },
    ],
  },
  {
    id: 'project-status',
    queries: [
      {
        text: 'Give me a current read on the Pluto project.',
        expectedTopic: 'Pluto',
      },
      {
        text: 'What are the biggest unresolved product issues?',
        expectedTopic: 'Pluto',
      },
    ],
  },
  {
    id: 'conversation-control',
    queries: [
      {
        text: `Give me the current read on ${benchmarkProject}.`,
        expectedTopic: benchmarkProject,
        expectedRetrievalPolicy: 'fresh',
      },
      {
        text: 'That is a useful insight.',
        expectedRetrievalPolicy: 'none',
        expectedTurnMode: 'social',
      },
      {
        text: 'What do you mean by that?',
        expectedRetrievalPolicy: 'reuse',
        expectedTurnMode: 'clarify',
      },
      {
        text: "I'm not convinced that is current. Reconsider it.",
        expectedRetrievalPolicy: 'fresh',
        expectedTurnMode: 'challenge',
      },
      {
        text: 'Separately, what should I focus on across the workspace?',
        expectedTopic: 'Workspace priorities',
        expectedRetrievalPolicy: 'fresh',
        expectedTurnMode: 'topic_switch',
      },
    ],
  },
  {
    id: 'conversation-boundaries',
    queries: [
      {
        text: 'Hi',
        expectedRetrievalPolicy: 'none',
        expectedTurnMode: 'social',
        forbiddenAnswerPatterns: ['assist'],
      },
      {
        text: "Thanks, that'd be all.",
        expectsClosure: true,
        expectedRetrievalPolicy: 'none',
        expectedTurnMode: 'social',
        forbiddenAnswerPatterns: ['assistance', "don't hesitate", 'reach out'],
      },
      {
        text: 'Nothing at this time.',
        expectsClosure: true,
        expectedRetrievalPolicy: 'none',
        expectedTurnMode: 'social',
        forbiddenAnswerPatterns: [
          'Native Swift plugin',
          'project records',
          'assistance',
          "don't hesitate",
          'reach out',
        ],
      },
    ],
  },
  {
    id: 'no-evidence',
    queries: [
      {
        text: 'What did we decide about the Silver Otter Launch?',
        expectedOutcome: 'no_evidence',
      },
      {
        text: `Draft a short, friendly follow-up to ${benchmarkColleague} about it.`,
        expectedOutcome: 'no_evidence',
        forbiddenAnswerPatterns: [
          'previous conversation',
          'as discussed',
          'Subject:',
        ],
      },
    ],
  },
  {
    id: 'workspace-focus-conversation',
    queries: [
      { text: 'What do you think I should focus on?' },
      { text: 'Tell me more about those priorities.' },
    ],
  },
  {
    id: 'workspace-risks',
    queries: [
      { text: 'Anything I should be concerned about across my work?' },
      { text: 'Tell me more about those concerns and what to check.' },
    ],
  },
  {
    id: 'attribution-boundaries',
    queries: [
      { text: 'Anything I should be concerned about?' },
      { text: 'Tell me more.' },
      { text: 'What do you think I should focus on?' },
      {
        text: `What do you think will satisfy ${benchmarkPersonA} in terms of their expectations?`,
        requiredAnswerPatterns: [benchmarkPersonA],
        forbiddenAnswerPatterns: [benchmarkPersonB],
      },
      {
        text: `What is needed for ${benchmarkPersonB}? Is it for the ${benchmarkProject} project, and who said it?`,
        requiredAnswerPatterns: [
          benchmarkPersonB,
          benchmarkRequirement,
          'does not identify',
        ],
        forbiddenAnswerPatterns: ['assigned to you'],
      },
      {
        text: `Who said that we need to present this to ${benchmarkPersonB}?`,
        requiredAnswerPatterns: ['does not identify'],
        forbiddenAnswerPatterns: ['assigned to you'],
      },
    ],
  },
  {
    id: 'person-attribution-focus',
    queries: [
      {
        text: `What do you think will satisfy ${benchmarkPersonA} in terms of their expectations?`,
        requiredAnswerPatterns: [benchmarkPersonA],
        forbiddenAnswerPatterns: [benchmarkPersonB],
      },
      {
        text: `What is needed for ${benchmarkPersonB}? Is it for the ${benchmarkProject} project, and who said it?`,
        requiredAnswerPatterns: [
          benchmarkPersonB,
          benchmarkRequirement,
          'does not identify',
        ],
        forbiddenAnswerPatterns: [
          'assigned to you',
          'assign you',
          'you were tasked',
        ],
      },
      {
        text: `Who said that we need to present this to ${benchmarkPersonB}?`,
        requiredAnswerPatterns: ['does not identify'],
        forbiddenAnswerPatterns: [
          'assigned to you',
          'assign you',
          'you were tasked',
        ],
      },
    ],
  },
];

const requestedScenarioIds = new Set(
  String(process.env.ASK_PLUTO_LIVE_BENCHMARK_SCENARIOS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);
const scenarios = requestedScenarioIds.size
  ? allScenarios.filter(({ id }) => requestedScenarioIds.has(id))
  : allScenarios;
if (scenarios.length === 0) {
  throw new Error('No live benchmark scenarios matched the requested IDs.');
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const percentile = (values, ratio) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
};

const summarize = (samples, key) => {
  const values = samples
    .map((sample) => sample.timings[key])
    .filter((value) => Number.isFinite(value));
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  };
};

const summarizePerformance = (samples, key) => {
  const values = samples
    .map((sample) => sample.response.performance?.[key])
    .filter((value) => Number.isFinite(value));
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  };
};

const performanceSummary = (samples) =>
  Object.fromEntries(
    [
      'settingsMs',
      'setupMs',
      'conversationResolutionMs',
      'recallMs',
      'retrievalMs',
      'promptConstructionMs',
      'providerAcquisitionMs',
      'providerQueueMs',
      'providerRequestToFirstTokenMs',
      'rawFirstTokenMs',
      'visibleFirstTokenMs',
      'generationMs',
      'finalizationMs',
      'totalMs',
    ].map((key) => [key, summarizePerformance(samples, key)]),
  );

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const packet = JSON.parse(String(event.data));
      if (!packet.id) return;
      const pending = this.pending.get(packet.id);
      if (!pending) return;
      this.pending.delete(packet.id);
      if (packet.error) pending.reject(new Error(packet.error.message));
      else pending.resolve(packet.result);
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const waitForRenderer = async () => {
  const deadline = Date.now() + 90_000;
  let stableTargetId = null;
  let stableSince = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const renderer = targets.find(
        (target) =>
          target.type === 'page' &&
          target.webSocketDebuggerUrl &&
          /^http:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/|$)/.test(
            String(target.url),
          ) &&
          !String(target.url).includes('active-call-alert'),
      );
      if (renderer) {
        if (stableTargetId !== renderer.id) {
          stableTargetId = renderer.id;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 1_500) {
          return renderer;
        }
      } else {
        stableTargetId = null;
        stableSince = 0;
      }
    } catch {
      // The dev server and Electron are still starting.
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for the Pluto renderer');
};

const evaluate = async (client, expression) => {
  const result = await client.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Renderer evaluation failed',
    );
  }
  return result.result?.value;
};

const runQuery = async (client, input) => {
  const serializedInput = JSON.stringify(input).replaceAll('<', '\\u003c');
  return evaluate(
    client,
    `(async () => {
      const input = ${serializedInput};
      const startedAt = performance.now();
      let firstDeltaAt = null;
      let streamedCharacters = 0;
      const phases = [];
      const removeDelta = window.ipcRenderer.on(
        'intelligence:query:delta',
        (_event, packet) => {
          if (packet?.requestId !== input.requestId || !packet.delta) return;
          firstDeltaAt ??= performance.now();
          streamedCharacters += packet.delta.length;
        },
      );
      const removeStatus = window.ipcRenderer.on(
        'intelligence:query:status',
        (_event, status) => {
          if (status?.requestId !== input.requestId) return;
          phases.push({ phase: status.phase, atMs: Math.round(performance.now() - startedAt) });
        },
      );
      try {
        const response = await window.ipcRenderer.invoke('intelligence:query', input);
        return {
          response,
          timings: {
            firstTokenMs: firstDeltaAt === null ? null : Math.round(firstDeltaAt - startedAt),
            totalMs: Math.round(performance.now() - startedAt),
          },
          streamedCharacters,
          phases,
        };
      } finally {
        removeDelta();
        removeStatus();
      }
    })()`,
  );
};

const toPriorAssistantTurn = (response) => ({
  role: 'assistant',
  content: response.answer || '',
  meetingIds:
    response.conversationContext?.meetingIds?.slice(0, 8) ||
    response.citations
      ?.map((citation) => citation.meeting_id)
      .filter(Boolean)
      .slice(0, 8),
  outcome: response.outcome,
  turnMode: response.turnMode,
  retrievalPolicy: response.retrievalPolicy,
  unsupportedClaimCount: response.unsupportedClaimCount,
  omissionRef: response.omissionRef,
  conversationAnchor: response.conversationAnchor,
  conversationContext: response.conversationContext,
  resolvedScope: response.resolvedScope,
  retrievalSummary: response.retrievalSummary,
  retrievalTrace: response.retrievalTrace,
});

const assessQuality = (querySpec, response) => {
  const query = querySpec.text;
  const answer = String(response.answer || '').trim();
  const transcriptPassageCount =
    response.retrievalSummary?.transcriptPassageCount ||
    response.retrievalTrace?.transcriptPassages?.length ||
    0;
  const containsPattern = (pattern) => {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}(?:s)?([^\\p{L}\\p{N}]|$)`,
      'iu',
    ).test(answer);
  };
  const checks = {
    answered:
      response.status === 'answered' &&
      answer.length >= (response.turnMode === 'social' ? 2 : 20),
    synthesizedOnly: transcriptPassageCount === 0,
    noInternalMarkers:
      !/\[Sources?\s+[^\]]*|Grounded answer|Partial answer|meetings searched/i.test(
        answer,
      ),
    completeEnding: /[.!?…)'"”’]$/.test(answer),
    noDanglingListItem: !/(?:^|\n)\s*\d+[.)]\s*$/.test(answer),
    requiredDetailsPresent: (querySpec.requiredAnswerPatterns || []).every(
      containsPattern,
    ),
    expectedTopic:
      !querySpec.expectedTopic ||
      String(response.conversationContext?.topic?.label || '')
        .toLocaleLowerCase()
        .includes(querySpec.expectedTopic.toLocaleLowerCase()),
    noKnownScopeDrift: (querySpec.forbiddenAnswerPatterns || []).every(
      (pattern) => !containsPattern(pattern),
    ),
    respectsConversationClosure:
      !querySpec.expectsClosure ||
      (!answer.includes('?') &&
        !/\b(?:hey|hello|what(?:'s| is)|how can|anything else|feel free|reach out|whenever|glad to help|don(?:'t|’t) hesitate)\b/i.test(
          answer,
        )),
    validDraft:
      !querySpec.expectsDraft ||
      (/^(?:Hi|Hey|Hello)\b/i.test(answer) &&
        !/\b(?:As of|last recorded profile|work focused on)\b/i.test(answer) &&
        answer.split(/\s+/).length <= 180),
    noUnanchoredRelativeDeadline:
      !querySpec.forbidRelativeDeadline ||
      !/\b(?:today|tomorrow|next week|this week)\b/i.test(answer),
    expectedRetrievalPolicy:
      !querySpec.expectedRetrievalPolicy ||
      response.retrievalPolicy === querySpec.expectedRetrievalPolicy,
    expectedTurnMode:
      !querySpec.expectedTurnMode ||
      response.turnMode === querySpec.expectedTurnMode,
    expectedOutcome:
      !querySpec.expectedOutcome ||
      response.outcome === querySpec.expectedOutcome,
  };
  return {
    checks,
    passed: Object.values(checks).every(Boolean),
    wordCount: answer ? answer.split(/\s+/).length : 0,
    paragraphCount: answer ? answer.split(/\n\s*\n/).length : 0,
    needsHumanReview:
      response.turnMode !== 'social' ||
      !Object.values(checks).every(Boolean) ||
      response.outcome !== 'answered' ||
      /\b(?:couldn't find|couldn't verify|not enough information)\b/i.test(
        answer,
      ),
    query,
  };
};

const rescorePath = process.env.ASK_PLUTO_LIVE_BENCHMARK_RESCORE;
if (rescorePath) {
  const resolvedPath = path.resolve(rescorePath);
  const report = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  report.samples = report.samples.map((sample) => {
    const scenario = scenarios.find(({ id }) => id === sample.scenarioId);
    const querySpec = scenario?.queries.find(
      ({ text }) => text === sample.query,
    ) || { text: sample.query };
    return {
      ...sample,
      quality: assessQuality(querySpec, sample.response),
    };
  });
  report.summary = {
    ...report.summary,
    qualityPassed: report.samples.filter((sample) => sample.quality.passed)
      .length,
    humanReviewNeeded: report.samples.filter(
      (sample) => sample.quality.needsHumanReview,
    ).length,
  };
  fs.writeFileSync(
    resolvedPath,
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(`[AskPlutoLive] rescored=${resolvedPath}`);
  process.exit(0);
}

const child = spawn('pnpm', ['run', 'dev'], {
  cwd: process.cwd(),
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    PLUTO_USER_DATA_DIR: productionUserData,
    PLUTO_ALLOW_RECOVERY_PROFILE: '1',
    PLUTO_REMOTE_DEBUGGING_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (data) => process.stdout.write(data));
child.stderr.on('data', (data) => process.stderr.write(data));

let client;
try {
  const target = await waitForRenderer();
  client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.call('Runtime.enable');
  await evaluate(
    client,
    `window.ipcRenderer.invoke('intelligence:query:session-active', true)`,
  );
  if (fastModelOverride) {
    await evaluate(
      client,
      `window.ipcRenderer.invoke('SET_SETTING', ${JSON.stringify({ key: 'ollama_fast_model', value: fastModelOverride })})`,
    );
  }
  if (modelOverride) {
    await evaluate(
      client,
      `window.ipcRenderer.invoke('SET_SETTING', ${JSON.stringify({ key: 'ollama_model', value: modelOverride })})`,
    );
  }

  const samples = [];
  for (const scenario of scenarios) {
    await evaluate(
      client,
      `window.ipcRenderer.invoke('intelligence:query:new-conversation')`,
    );
    const priorTurns = [];
    for (const [turnIndex, querySpec] of scenario.queries.entries()) {
      const query = querySpec.text;
      const requestId = `live-benchmark-${scenario.id}-${turnIndex}-${Date.now()}`;
      const result = await runQuery(client, {
        requestId,
        query,
        modeOverride: 'auto',
        priorTurns,
      });
      const quality = assessQuality(querySpec, result.response);
      const usesModel =
        Number(result.response.performance?.promptCharacters || 0) > 0;
      const hasPriorModelSample = samples.some(
        (sample) =>
          Number(sample.response.performance?.promptCharacters || 0) > 0,
      );
      const sample = {
        scenarioId: scenario.id,
        turn: turnIndex + 1,
        query,
        requestId,
        timings: result.timings,
        streamedCharacters: result.streamedCharacters,
        phases: result.phases,
        runtimeState: usesModel
          ? hasPriorModelSample
            ? 'warm_session'
            : 'cold_model'
          : 'prepared',
        response: result.response,
        quality,
      };
      samples.push(sample);
      console.log(
        `[AskPlutoLive] scenario=${scenario.id} turn=${turnIndex + 1} first_token=${result.timings.firstTokenMs}ms total=${result.timings.totalMs}ms outcome=${result.response.outcome || result.response.status} quality=${quality.passed ? 'pass' : 'review'}`,
      );
      priorTurns.push({ role: 'user', content: query });
      priorTurns.push(toPriorAssistantTurn(result.response));
    }
  }

  const coldSamples = samples.filter(
    (sample) => sample.runtimeState === 'cold_model',
  );
  const warmSamples = samples.filter(
    (sample) => sample.runtimeState === 'warm_session',
  );
  const generatedSample = samples.find(
    (sample) => Number(sample.response.performance?.promptCharacters || 0) > 0,
  );
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    dataSource: 'production synthesized data',
    rawTranscriptPolicy: 'excluded',
    modelRuntime: generatedSample?.response.performance
      ? {
          provider: generatedSample.response.performance.provider,
          model: generatedSample.response.performance.model,
        }
      : 'configured local provider',
    scenarios: scenarios.map(({ id, queries }) => ({
      id,
      queries: queries.map(({ text }) => text),
    })),
    summary: {
      sampleCount: samples.length,
      qualityPassed: samples.filter((sample) => sample.quality.passed).length,
      humanReviewNeeded: samples.filter(
        (sample) => sample.quality.needsHumanReview,
      ).length,
      firstToken: summarize(samples, 'firstTokenMs'),
      total: summarize(samples, 'totalMs'),
      cold: {
        firstToken: summarize(coldSamples, 'firstTokenMs'),
        total: summarize(coldSamples, 'totalMs'),
        phases: performanceSummary(coldSamples),
      },
      warm: {
        firstToken: summarize(warmSamples, 'firstTokenMs'),
        total: summarize(warmSamples, 'totalMs'),
        phases: performanceSummary(warmSamples),
      },
      phases: performanceSummary(samples),
    },
    samples,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[AskPlutoLive] report=${outputPath}`);
} finally {
  if (client) {
    try {
      await evaluate(
        client,
        `window.ipcRenderer.invoke('intelligence:query:session-active', false)`,
      );
    } catch {
      // The renderer may already be closing.
    }
    client.close();
  }
  if (child.exitCode === null) {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  }
}
