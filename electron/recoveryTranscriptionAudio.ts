const ALIGNMENT_TOLERANCE_SECONDS = 0.25;

type CheckpointSegment = {
  start: number;
  end: number;
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
};

export const normalizeCheckpointWords = (
  segments: CheckpointSegment[],
  journalDurationSeconds: number,
): CheckpointSegment[] =>
  segments.map((segment) => ({
    ...segment,
    ...(segment.words
      ? {
          words: segment.words.filter(
            (word) =>
              typeof word.word === 'string' &&
              Boolean(word.word.trim()) &&
              Number.isFinite(word.start) &&
              Number.isFinite(word.end) &&
              word.start >= segment.start &&
              word.end > word.start &&
              word.end <= segment.end &&
              word.end <= journalDurationSeconds + ALIGNMENT_TOLERANCE_SECONDS,
          ),
        }
      : {}),
  }));

export type RecoveryAudioAlignmentDependencies = {
  probeDuration: (inputPath: string) => Promise<number | null>;
  createTemporaryPath: () => string;
  trimLeadingOverflow: (args: {
    inputPath: string;
    outputPath: string;
    startSec: number;
    durationSec: number;
  }) => Promise<boolean>;
  removeTemporaryFile: (path: string) => void;
};

export const transcribeJournalAlignedAudio = async <Result>(
  inputPath: string,
  journalDurationSeconds: number,
  deps: RecoveryAudioAlignmentDependencies,
  transcribe: (alignedPath: string) => Promise<Result>,
): Promise<Result> => {
  const artifactDurationSeconds = await deps.probeDuration(inputPath);
  if (artifactDurationSeconds === null) {
    throw new Error('journal_audio_duration_unavailable');
  }
  if (
    artifactDurationSeconds <=
    journalDurationSeconds + ALIGNMENT_TOLERANCE_SECONDS
  ) {
    return await transcribe(inputPath);
  }

  const temporaryPath = deps.createTemporaryPath();
  try {
    const trimmed = await deps.trimLeadingOverflow({
      inputPath,
      outputPath: temporaryPath,
      startSec: artifactDurationSeconds - journalDurationSeconds,
      durationSec: journalDurationSeconds,
    });
    if (!trimmed) throw new Error('journal_audio_trim_failed');
    return await transcribe(temporaryPath);
  } finally {
    deps.removeTemporaryFile(temporaryPath);
  }
};
