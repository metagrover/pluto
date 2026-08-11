import { spawnSync } from 'node:child_process';
import {
  constants,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  type BenchmarkSpeaker,
  type BenchmarkTurn,
  type CandidateCaseFailure,
  type CandidateCaseSuccess,
  type CandidateFailureCode,
  type CandidateManifestEntry,
  type LocalAttributionBenchmarkCase,
  type LocalAttributionBenchmarkRun,
  type LocalAttributionCandidateOutput,
  buildLocalAttributionBenchmarkReport,
  computeLocalAttributionMetrics,
  loadLocalAttributionManifest,
  loadSpeakerReference,
  runLocalAttributionCandidate,
} from '../src/services/localSpeakerAttributionBenchmark.ts';

export type BenchmarkCliOptions = {
  manifestPath: string;
  outputPath: string;
  timeoutMs: number;
  candidateIds: string[];
  privateCorpusRoot?: string;
};

export const parseBenchmarkCliArgs = (args: string[]): BenchmarkCliOptions => {
  let manifestPath = '';
  let outputPath = '';
  let timeoutMs = 30 * 60 * 1000;
  const candidateIds: string[] = [];
  let privateCorpusRoot: string | undefined;
  const take = (name: string, inline: string | undefined, index: number) => {
    const value = inline ?? args[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for --${name}.`);
    return { value, consumed: inline === undefined ? 1 : 0 };
  };
  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index];
    if (raw === '--') continue;
    const [flag, inline] = raw.split('=', 2);
    const name = flag.replace(/^--/, '');
    if (!flag.startsWith('--'))
      throw new Error('Unexpected positional argument.');
    if (
      ![
        'manifest',
        'out',
        'timeout-ms',
        'candidate',
        'private-corpus-root',
      ].includes(name)
    )
      throw new Error(`Unknown option --${name}.`);
    const { value, consumed } = take(name, inline, index);
    index += consumed;
    if (name === 'manifest') manifestPath = value;
    else if (name === 'out') outputPath = value;
    else if (name === 'candidate') candidateIds.push(value);
    else if (name === 'private-corpus-root') privateCorpusRoot = value;
    else {
      timeoutMs = Number(value);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
        throw new Error(
          'Invalid timeout: expected a positive integer in milliseconds.',
        );
    }
  }
  if (!manifestPath) throw new Error('Missing required --manifest option.');
  if (!outputPath) throw new Error('Missing required --out option.');
  return {
    manifestPath,
    outputPath,
    timeoutMs,
    candidateIds,
    ...(privateCorpusRoot ? { privateCorpusRoot } : {}),
  };
};

const isInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};

const safeOutputPath = (
  outputPath: string,
  privateCorpusRoot?: string,
): string => {
  const resolved = path.resolve(outputPath);
  const canonicalParent = (() => {
    let ancestor = path.dirname(resolved);
    const missingParts: string[] = [];
    while (true) {
      try {
        return path.join(realpathSync(ancestor), ...missingParts);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        missingParts.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
  })();
  const canonicalOutput = path.join(canonicalParent, path.basename(resolved));
  if (
    privateCorpusRoot &&
    isInside(realpathSync(privateCorpusRoot), canonicalOutput)
  )
    throw new Error(
      'Unsafe output location: reports cannot be written inside the private corpus root.',
    );
  return canonicalOutput;
};

const markdownOutputPath = (outputPath: string) =>
  outputPath.endsWith('.json')
    ? `${outputPath.slice(0, -5)}.md`
    : `${outputPath}.md`;

const validateReportDestination = (
  outputPath: string,
  privateCorpusRoot?: string,
) => {
  const safePath = safeOutputPath(outputPath, privateCorpusRoot);
  try {
    const status = lstatSync(safePath);
    if (status.isSymbolicLink())
      throw new Error('Unsafe output location: report symlinks are forbidden.');
    if (!status.isFile())
      throw new Error(
        'Unsafe output location: expected a regular report file.',
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return safePath;
};

const writeReportFile = (filePath: string, content: string) => {
  const descriptor = openSync(
    filePath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(descriptor, content, { encoding: 'utf8' });
  } finally {
    closeSync(descriptor);
  }
};

const jsonAt = (filePath: string): unknown =>
  JSON.parse(readFileSync(filePath, 'utf8'));
const resolveInput = (inputPath: string) =>
  path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);

const overlapSeconds = (
  left: { startTime: number; endTime: number },
  right: { startTime: number; endTime: number },
) =>
  Math.max(
    0,
    Math.min(left.endTime, right.endTime) -
      Math.max(left.startTime, right.startTime),
  );

/**
 * Oracle mapping used only to score a diarizer against a reviewed benchmark
 * reference. Production must identify `Me` from acoustic near-end/AEC evidence;
 * it must never have access to this reference-derived mapping.
 */
export const mapBenchmarkClustersFromReference = (
  turns: LocalAttributionCandidateOutput['diarization']['turns'],
  reference: BenchmarkTurn[],
): ReadonlyMap<string, BenchmarkSpeaker> => {
  const clusters = [...new Set(turns.map(({ cluster }) => cluster))].sort();
  return new Map(
    clusters.map((cluster) => {
      const clusterTurns = turns.filter((turn) => turn.cluster === cluster);
      const support = (speaker: BenchmarkSpeaker) =>
        clusterTurns.reduce(
          (total, turn) =>
            total +
            reference
              .filter((item) => item.speaker === speaker)
              .reduce(
                (subtotal, item) => subtotal + overlapSeconds(turn, item),
                0,
              ),
          0,
        );
      // `Them` wins exact ties, including clusters outside/without reference.
      return [cluster, support('Me') > support('Them') ? 'Me' : 'Them'];
    }),
  );
};

const speakerFor = (
  candidate: CandidateManifestEntry,
  cluster: string,
  oracleMap?: ReadonlyMap<string, BenchmarkSpeaker>,
): BenchmarkSpeaker => {
  if (oracleMap) return oracleMap.get(cluster) ?? 'Them';
  if (cluster === 'Me' || cluster === 'Them') return cluster;
  const map =
    candidate.id === 'synthetic' ? candidate.config.speakerMap : undefined;
  if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
    const mapped = (map as Record<string, unknown>)[cluster];
    if (mapped === 'Me' || mapped === 'Them') return mapped;
  }
  return 'Them';
};

export const composeCandidateAttributedTurns = (
  output: LocalAttributionCandidateOutput,
  candidate: CandidateManifestEntry,
  transcriptOutput = output,
  benchmarkReference?: BenchmarkTurn[],
): BenchmarkTurn[] => {
  const turns = output.diarization.turns;
  const oracleMap = benchmarkReference
    ? mapBenchmarkClustersFromReference(turns, benchmarkReference)
    : undefined;
  const assignedText = turns.map(() => [] as string[]);
  const units =
    transcriptOutput.transcript.words.length > 0
      ? transcriptOutput.transcript.words
      : transcriptOutput.transcript.segments;
  for (const unit of units) {
    const midpoint = (unit.startTime + unit.endTime) / 2;
    const assignment = turns
      .map((turn, index) => ({
        index,
        overlap: Math.max(
          0,
          Math.min(unit.endTime, turn.endTime) -
            Math.max(unit.startTime, turn.startTime),
        ),
        containsMidpoint:
          midpoint >= turn.startTime && midpoint < turn.endTime ? 1 : 0,
        distance: Math.abs(midpoint - (turn.startTime + turn.endTime) / 2),
      }))
      .sort(
        (left, right) =>
          right.overlap - left.overlap ||
          right.containsMidpoint - left.containsMidpoint ||
          left.distance - right.distance ||
          left.index - right.index,
      )[0];
    if (assignment) assignedText[assignment.index].push(unit.text);
  }
  return turns.map((turn, index) => ({
    startTime: turn.startTime,
    endTime: turn.endTime,
    speaker: speakerFor(candidate, turn.cluster, oracleMap),
    text: assignedText[index].join(' '),
  }));
};

const failureStatus = (code: CandidateFailureCode) =>
  code === 'candidate_unsupported_hardware'
    ? ('unsupported' as const)
    : ('failed' as const);

const failureRun = (
  benchmarkCase: LocalAttributionBenchmarkCase,
  candidateId: string,
  failure: CandidateCaseFailure,
  asrCandidate?: string,
  diarizerCandidate?: string,
): LocalAttributionBenchmarkRun => ({
  caseId: benchmarkCase.id,
  tier: benchmarkCase.provenance.tier,
  candidateId,
  ...(asrCandidate ? { asrCandidate } : {}),
  ...(diarizerCandidate ? { diarizerCandidate } : {}),
  status: failureStatus(failure.error.code),
  elapsedMs: 0,
  peakMemoryMb: 0,
  failureCode: failure.error.code,
});

const sourceCommit = () => {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
  });
  const value = result.status === 0 ? result.stdout.trim() : '';
  return /^[a-f0-9]{40}$/.test(value) ? value : 'unknown';
};

export const reportAsMarkdown = (
  report: ReturnType<typeof buildLocalAttributionBenchmarkReport>,
): string => {
  const lines = [
    '# Local speaker attribution benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    `Source commit: ${report.sourceCommit}`,
    '',
    '| ASR | Diarizer | Status | WER | DER | False Me (s) | Elapsed (ms) | Peak MB |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const row of report.results) {
    lines.push(
      `| ${row.asrCandidate} | ${row.diarizerCandidate} | ${row.status}${row.failureCode ? `:${row.failureCode}` : ''} | ${row.metrics?.wordErrorRate ?? ''} | ${row.metrics?.diarizationErrorRate ?? ''} | ${row.metrics?.falseMeSeconds ?? ''} | ${row.elapsedMs} | ${row.peakMemoryMb} |`,
    );
  }
  return `${lines.join('\n')}\n`;
};

export const runLocalSpeakerAttributionBenchmark = async (
  options: BenchmarkCliOptions,
) => {
  const manifestPath = path.resolve(options.manifestPath);
  const outputPath = validateReportDestination(
    options.outputPath,
    options.privateCorpusRoot,
  );
  const markdownPath = validateReportDestination(
    markdownOutputPath(outputPath),
    options.privateCorpusRoot,
  );
  const manifest = loadLocalAttributionManifest(jsonAt(manifestPath), {
    ...(options.privateCorpusRoot
      ? { privateCorpusRoot: options.privateCorpusRoot }
      : {}),
  });
  const requested = new Set(options.candidateIds);
  const candidates = manifest.candidates.filter(
    ({ id }) => requested.size === 0 || requested.has(id),
  );
  if (requested.size > 0 && candidates.length !== requested.size)
    throw new Error('Unknown candidate filter.');
  if (candidates.length === 0) throw new Error('No local candidates selected.');

  const candidateRuns = new Map<
    string,
    Awaited<ReturnType<typeof runLocalAttributionCandidate>>
  >();
  for (const candidate of candidates) {
    candidateRuns.set(
      candidate.id,
      await runLocalAttributionCandidate(candidate, manifest.cases, {
        timeoutMs: options.timeoutMs,
      }),
    );
  }
  const references = new Map(
    manifest.cases.map((benchmarkCase) => [
      benchmarkCase.id,
      loadSpeakerReference(jsonAt(resolveInput(benchmarkCase.referencePath))),
    ]),
  );
  const runs: LocalAttributionBenchmarkRun[] = [];
  const asr = candidates.filter(({ kind }) => kind === 'asr');
  const diarizers = candidates.filter(({ kind }) => kind === 'diarizer');
  const combinations = [
    ...candidates
      .filter(({ kind }) => kind === 'pipeline')
      .map((candidate) => ({ asr: candidate, diarizer: candidate })),
    ...asr.flatMap((asrCandidate) =>
      diarizers.map((diarizer) => ({ asr: asrCandidate, diarizer })),
    ),
    ...(asr.length && !diarizers.length
      ? asr.map((candidate) => ({ asr: candidate, diarizer: candidate }))
      : []),
    ...(!asr.length && diarizers.length
      ? diarizers.map((candidate) => ({ asr: candidate, diarizer: candidate }))
      : []),
  ];
  for (const combination of combinations) {
    for (const benchmarkCase of manifest.cases) {
      const asrResult = candidateRuns
        .get(combination.asr.id)
        ?.results.find(({ caseId }) => caseId === benchmarkCase.id);
      const diarizerResult = candidateRuns
        .get(combination.diarizer.id)
        ?.results.find(({ caseId }) => caseId === benchmarkCase.id);
      const failed = [asrResult, diarizerResult].find(
        (result): result is CandidateCaseFailure =>
          result?.status === 'failure',
      );
      const candidateId =
        combination.asr.id === combination.diarizer.id
          ? combination.asr.id
          : `${combination.asr.id}+${combination.diarizer.id}`;
      if (failed) {
        runs.push(
          failureRun(
            benchmarkCase,
            candidateId,
            failed,
            combination.asr.id,
            combination.diarizer.id,
          ),
        );
        continue;
      }
      if (!asrResult || !diarizerResult)
        throw new Error('Benchmark harness lost a candidate result.');
      const asrSuccess = asrResult as CandidateCaseSuccess;
      const diarizerSuccess = diarizerResult as CandidateCaseSuccess;
      const reference = references.get(benchmarkCase.id);
      if (!reference) throw new Error('Benchmark harness lost a reference.');
      const audioDurationSeconds = Math.max(
        0,
        ...reference.turns.map(({ endTime }) => endTime),
      );
      const elapsedMs =
        asrSuccess.output.runtime.elapsedMs +
        (combination.asr.id === combination.diarizer.id
          ? 0
          : diarizerSuccess.output.runtime.elapsedMs);
      runs.push({
        caseId: benchmarkCase.id,
        tier: benchmarkCase.provenance.tier,
        candidateId,
        asrCandidate: combination.asr.id,
        diarizerCandidate: combination.diarizer.id,
        status: 'ok',
        metrics: computeLocalAttributionMetrics({
          reference: reference.turns,
          generated: composeCandidateAttributedTurns(
            diarizerSuccess.output,
            combination.diarizer,
            asrSuccess.output,
            reference.turns,
          ),
          ...(audioDurationSeconds > 0
            ? { audioDurationSeconds, elapsedMs }
            : {}),
        }),
        elapsedMs,
        peakMemoryMb: Math.max(
          asrSuccess.output.runtime.peakResidentMemoryMb ?? 0,
          diarizerSuccess.output.runtime.peakResidentMemoryMb ?? 0,
        ),
        provenance: {
          pipelineVersion: `${asrSuccess.output.runtime.pipelineVersion}+${diarizerSuccess.output.runtime.pipelineVersion}`,
          models: [
            ...asrSuccess.output.runtime.models,
            ...(combination.asr.id === combination.diarizer.id
              ? []
              : diarizerSuccess.output.runtime.models),
          ],
        },
      });
    }
  }
  const report = buildLocalAttributionBenchmarkReport({
    generatedAt: new Date().toISOString(),
    sourceCommit: sourceCommit(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
    },
    candidates,
    runs,
  });
  mkdirSync(path.dirname(outputPath), { recursive: true });
  validateReportDestination(outputPath, options.privateCorpusRoot);
  validateReportDestination(markdownPath, options.privateCorpusRoot);
  writeReportFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeReportFile(markdownPath, reportAsMarkdown(report));
  return report;
};

export const runBenchmarkCli = async (args: string[]): Promise<number> => {
  try {
    const report = await runLocalSpeakerAttributionBenchmark(
      parseBenchmarkCliArgs(args),
    );
    process.stdout.write('candidate\tstatus\truns\n');
    for (const candidate of report.candidates) {
      const rows = report.results.filter(
        (row) =>
          row.asrCandidate === candidate.id ||
          row.diarizerCandidate === candidate.id,
      );
      const status = rows.some(({ status }) => status === 'failed')
        ? 'failed'
        : rows.some(({ status }) => status === 'unsupported')
          ? 'unsupported'
          : 'ok';
      process.stdout.write(`${candidate.id}\t${status}\t${rows.length}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /unsafe output/i.test(message)
      ? 'unsafe_output_location'
      : /candidate filter/i.test(message)
        ? 'unknown_candidate_filter'
        : /^(Invalid|Missing|Unknown option|Unexpected)/.test(message)
          ? 'configuration_error'
          : 'harness_failure';
    process.stderr.write(`Speaker attribution benchmark failed: ${code}\n`);
    return 1;
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runBenchmarkCli(process.argv.slice(2));
}
