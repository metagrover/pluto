import { describe, expect, it } from 'vitest';
import { liveEchoLongPauseFixture } from '../fixtures/liveEchoLongPause';
import { liveEchoOmissionFixture } from '../fixtures/liveEchoOmission';
import { liveTranscriptJumbledSourcesFixture } from '../fixtures/liveTranscriptJumbledSources';

import {
  reconcileLiveTranscriptReading,
  reconcileLiveTranscriptSegments,
} from '../../src/services/liveTranscription/liveTranscriptReconciliation';

const segment = (
  id: string,
  source: 'mic' | 'system',
  text: string,
  startMs: number,
  endMs: number,
) => ({
  id,
  speaker: 'Speaker' as const,
  source,
  text,
  rawText: text.toLowerCase(),
  timestampMs: startMs,
  endTimestampMs: endMs,
  confirmed: true,
});

describe('live transcript reconciliation', () => {
  it('removes a six-word acoustically supported echo span without consuming local words', () => {
    const echoed = 'one two three four five six'.split(' ');
    const micWords = ['local', 'opening', ...echoed, 'local', 'ending'];
    const mic = {
      ...segment('mic-six-word-span', 'mic', micWords.join(' '), 800, 4_000),
      wordTimings: micWords.map((text, index) => ({
        text,
        timestampMs: 800 + index * 300,
        endTimestampMs: 1_080 + index * 300,
      })),
    };
    const system = {
      ...segment(
        'system-six-word-span',
        'system',
        echoed.join(' '),
        1_200,
        3_000,
      ),
      wordTimings: echoed.map((text, index) => ({
        text,
        timestampMs: 1_200 + index * 300,
        endTimestampMs: 1_480 + index * 300,
      })),
    };
    const reading = reconcileLiveTranscriptReading({
      segments: [mic, system],
      activityWindows: [],
      echoEvidence: [
        {
          micStartMs: 1_400,
          micEndMs: 3_180,
          systemStartMs: 1_200,
          systemEndMs: 2_980,
        },
      ],
    });
    const micRanges = reading.ranges.filter(
      (range) => range.sourceSegmentId === mic.id,
    );

    expect(
      micRanges
        .filter((range) => range.visibility === 'suppressed_echo')
        .map((range) => range.text),
    ).toEqual([echoed.join(' ')]);
    expect(
      micRanges
        .filter((range) => range.visibility === 'visible')
        .map((range) => range.text),
    ).toEqual(['local opening', 'local ending']);
  });

  it('keeps a six-word match when acoustic support does not reach its tail', () => {
    const words = 'one two three four five six'.split(' ');
    const timed = (source: 'mic' | 'system', lag: number) => ({
      ...segment(
        `${source}-sparse`,
        source,
        words.join(' '),
        1_000 + lag,
        3_000 + lag,
      ),
      wordTimings: words.map((text, index) => ({
        text,
        timestampMs: 1_000 + lag + index * 300,
        endTimestampMs: 1_250 + lag + index * 300,
      })),
    });
    const reading = reconcileLiveTranscriptReading({
      segments: [timed('mic', 200), timed('system', 0)],
      activityWindows: [],
      echoEvidence: [
        {
          micStartMs: 1_200,
          micEndMs: 2_300,
          systemStartMs: 1_000,
          systemEndMs: 2_100,
        },
      ],
    });

    expect(
      reading.ranges.filter((range) => range.visibility === 'suppressed_echo'),
    ).toHaveLength(0);
  });

  it('reconciles independently split checkpoints without consuming local additions', () => {
    const words =
      'the blue notebook is on the desk and we will review our meeting recording together tomorrow morning'.split(
        ' ',
      );
    const make = (source: 'mic' | 'system', size: number) => {
      const timings = words.map((text, index) => ({
        text,
        timestampMs: 1_000 + index * 300,
        endTimestampMs: 1_250 + index * 300,
      }));
      if (source === 'mic')
        timings.splice(9, 0, {
          text: 'NO',
          timestampMs: 3_550,
          endTimestampMs: 3_650,
        });
      const rows = [];
      for (let start = 0; start < timings.length; start += size) {
        const chunk = timings.slice(start, start + size);
        rows.push({
          ...segment(
            `${source}-${start}`,
            source,
            chunk.map((w) => w.text).join(' '),
            chunk[0].timestampMs,
            chunk.at(-1)!.endTimestampMs,
          ),
          wordTimings: chunk,
        });
      }
      return rows;
    };
    const segments = [...make('mic', 5), ...make('system', 4)];
    const reconcile = (
      echoEvidence: Array<{
        micStartMs: number;
        micEndMs: number;
        systemStartMs: number;
        systemEndMs: number;
      }>,
    ) =>
      reconcileLiveTranscriptReading({
        segments,
        activityWindows: [],
        echoEvidence,
      });
    const supported = reconcile([
      {
        micStartMs: 1_000,
        micEndMs: 7_000,
        systemStartMs: 1_000,
        systemEndMs: 7_000,
      },
    ]);
    expect(
      supported.ranges
        .filter((r) => r.source === 'mic' && r.visibility === 'visible')
        .map((r) => r.text),
    ).toEqual(['NO']);
    expect(supported.segments).toEqual(segments);
    expect(
      reconcile([]).ranges.filter((r) => r.visibility === 'suppressed_echo'),
    ).toHaveLength(0);
    const delayed = segments.map((row) =>
      row.source !== 'mic'
        ? row
        : {
            ...row,
            timestampMs: row.timestampMs + 10_000,
            endTimestampMs: row.endTimestampMs + 10_000,
            wordTimings: row.wordTimings.map((word) => ({
              ...word,
              timestampMs: word.timestampMs + 10_000,
              endTimestampMs: word.endTimestampMs + 10_000,
            })),
          },
    );
    expect(
      reconcileLiveTranscriptReading({
        segments: delayed,
        activityWindows: [],
        echoEvidence: [
          {
            micStartMs: 1_000,
            micEndMs: 20_000,
            systemStartMs: 1_000,
            systemEndMs: 20_000,
          },
        ],
      }).ranges.filter((r) => r.visibility === 'suppressed_echo'),
    ).toHaveLength(0);
  });

  it('partitions six supported echo spans without losing interleaved local words', () => {
    const fixture = liveTranscriptJumbledSourcesFixture();
    const reading = reconcileLiveTranscriptReading({
      segments: fixture.segments,
      activityWindows: [],
      echoEvidence: fixture.echoEvidence,
    });
    const micRanges = reading.ranges.filter(
      (range) => range.sourceSegmentId === fixture.mic.id,
    );
    const suppressed = micRanges.filter(
      (range) => range.visibility === 'suppressed_echo',
    );
    expect(
      suppressed.map(({ startWord, endWord, supportingSegmentIds }) => ({
        startWord,
        endWord,
        supportingSegmentId: supportingSegmentIds[0],
      })),
    ).toEqual(fixture.expectedSuppressedWordRanges);

    const originalWords = fixture.mic.text.split(/\s+/u);
    expect(
      micRanges.flatMap((range) =>
        originalWords.slice(range.startWord, range.endWord),
      ),
    ).toEqual(originalWords);
    expect(
      micRanges
        .filter((range) => range.visibility === 'visible')
        .flatMap((range) =>
          originalWords.slice(range.startWord, range.endWord),
        ),
    ).toEqual(fixture.expectedLocalWords);
    expect(reading.segments).toEqual(fixture.segments);
  });

  it('restores source-owned words when delayed echo support is withdrawn', () => {
    const fixture = liveTranscriptJumbledSourcesFixture();
    const reconcile = (echoEvidence: typeof fixture.echoEvidence) =>
      reconcileLiveTranscriptReading({
        segments: fixture.segments,
        activityWindows: [],
        echoEvidence,
      }).ranges.filter((range) => range.sourceSegmentId === fixture.mic.id);

    expect(reconcile([])).toMatchObject([
      {
        startWord: 0,
        endWord: fixture.mic.wordTimings!.length,
        visibility: 'visible',
      },
    ]);
    expect(
      reconcile(fixture.echoEvidence).filter(
        (range) => range.visibility === 'suppressed_echo',
      ),
    ).toHaveLength(6);
    expect(reconcile([])).toMatchObject([
      {
        startWord: 0,
        endWord: fixture.mic.wordTimings!.length,
        visibility: 'visible',
      },
    ]);
  });

  it('keeps an unsupported genuine repetition and fails open without word timing', () => {
    const fixture = liveTranscriptJumbledSourcesFixture();
    const repeatedText = fixture.systemSegments[0]
      .wordTimings!.slice(0, 12)
      .map((word) => word.text)
      .join(' ');
    const repetition = {
      ...segment('mic-repetition', 'mic', repeatedText, 50_000, 54_000),
      wordTimings: repeatedText.split(/\s+/u).map((text, index) => ({
        text,
        timestampMs: 50_000 + index * 300,
        endTimestampMs: 50_300 + index * 300,
      })),
    };
    const withoutTiming = { ...fixture.mic, wordTimings: undefined };
    const reading = reconcileLiveTranscriptReading({
      segments: [...fixture.segments, repetition],
      activityWindows: [],
      echoEvidence: fixture.echoEvidence,
    });
    expect(
      reading.ranges.filter((range) => range.sourceSegmentId === repetition.id),
    ).toMatchObject([{ startWord: 0, endWord: 12, visibility: 'visible' }]);
    expect(
      reconcileLiveTranscriptReading({
        segments: [withoutTiming, ...fixture.systemSegments],
        activityWindows: [],
        echoEvidence: fixture.echoEvidence,
      }).ranges.filter((range) => range.sourceSegmentId === withoutTiming.id),
    ).toMatchObject([
      {
        startWord: 0,
        endWord: withoutTiming.text.split(/\s+/u).length,
        visibility: 'visible',
      },
    ]);
  });

  it.each([
    'verified',
    'missing tail proof',
    'proof only at local onset',
    'later repetition',
    'different word',
    'unlinked padding',
  ])(
    'keeps a short matched word stable after a long EOU pause: %s',
    (control) => {
      const { rows, echoEvidence } = liveEchoLongPauseFixture();
      const mic = rows.at(-1)!;
      if (
        control === 'missing tail proof' ||
        control === 'proof only at local onset'
      ) {
        const nearLocal =
          control === 'proof only at local onset'
            ? echoEvidence
                .filter((window) => window.micEndMs >= 36400)
                .map((window) => ({
                  ...window,
                  micStartMs: window.micStartMs + 36000,
                  micEndMs: window.micEndMs + 36000,
                  systemStartMs: window.systemStartMs + 36000,
                  systemEndMs: window.systemEndMs + 36000,
                }))
            : [];
        echoEvidence.splice(
          0,
          echoEvidence.length,
          ...echoEvidence.filter((window) => window.micEndMs < 36400),
          ...nearLocal,
        );
      }
      if (control === 'later repetition') {
        mic.timestampMs = 71000;
        mic.wordTimings![0].timestampMs = 71000;
      }
      if (control === 'different word') {
        mic.text = mic.rawText = mic.text.replace('today', 'not');
        mic.wordTimings![0].text = 'not';
      }
      if (control === 'unlinked padding')
        mic.wordTimings![0].endTimestampMs -= 1000;
      const before = structuredClone(rows);
      const result = reconcileLiveTranscriptSegments({
        segments: rows,
        activityWindows: [],
        echoEvidence,
      });
      const tail = result.at(-1)!;
      if (control === 'verified')
        expect(tail.presentation).toMatchObject({
          visibility: 'echo_span_removed',
          text: 'can you hear mile vice ok',
          timestampMs: 72572.625,
        });
      else expect(tail.presentation).toBeUndefined();
      expect(rows).toEqual(before);
      expect(
        result.every(
          (row, index) =>
            row.rawText === rows[index].rawText &&
            JSON.stringify(row.wordTimings) ===
              JSON.stringify(rows[index].wordTimings),
        ),
      ).toBe(true);
    },
  );

  it('removes an exact System subsequence across microphone omissions and padded word ends', () => {
    const { mic, system, echoEvidence, local } = liveEchoOmissionFixture();
    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [],
      echoEvidence,
    });
    expect(result.presentation).toMatchObject({
      visibility: 'echo_span_removed',
      text: local,
      timestampMs: 47200,
    });
    expect(result.text).toBe(mic.text);
    expect(result.wordTimings).toEqual(mic.wordTimings);
    expect(
      reconcileLiveTranscriptSegments({
        segments: [result, system],
        activityWindows: [],
      })[0],
    ).toEqual(mic);
  });

  it.each([
    'local insertion',
    'skipped negation',
    'skipped number',
    'remote padded word',
    'stale lag',
    'inconsistent lag',
  ])(
    'retains uncertain microphone wording in directional alignment: %s',
    (control) => {
      const { mic, system, echoEvidence } = liveEchoOmissionFixture();
      if (control === 'local insertion') {
        mic.wordTimings.splice(13, 0, {
          text: 'actually',
          timestampMs: 44000,
          endTimestampMs: 44100,
        });
        mic.text = mic.rawText = mic.wordTimings
          .map((word) => word.text)
          .join(' ');
      }
      if (control === 'skipped negation' || control === 'skipped number') {
        system.wordTimings[14].text =
          control === 'skipped negation' ? 'not' : 'eight';
        system.text = system.rawText = system.wordTimings
          .map((word) => word.text)
          .join(' ');
      }
      if (control === 'remote padded word')
        system.wordTimings[24].endTimestampMs = 47000;
      if (control === 'stale lag')
        echoEvidence.splice(
          0,
          echoEvidence.length,
          ...echoEvidence.map((window) => ({
            ...window,
            micStartMs: window.micStartMs - 30000,
            micEndMs: window.micEndMs - 30000,
            systemStartMs: window.systemStartMs - 30000,
            systemEndMs: window.systemEndMs - 30000,
          })),
        );
      if (control === 'inconsistent lag') {
        echoEvidence[2].systemStartMs -= 100;
        echoEvidence[2].systemEndMs -= 100;
      }
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
          echoEvidence,
        })[0].presentation,
      ).toBeUndefined();
    },
  );

  it.each(['leading', 'trailing'])(
    'preserves a critical %s System omission outside the exact anchor',
    (position) => {
      const { mic, system, echoEvidence } = liveEchoOmissionFixture();
      mic.wordTimings = mic.wordTimings.slice(0, 13);
      mic.text = mic.rawText = mic.wordTimings
        .map((word) => word.text)
        .join(' ');
      mic.endTimestampMs = mic.wordTimings.at(-1)!.endTimestampMs;
      system.wordTimings = system.wordTimings.slice(0, 13);
      const omitted = {
        text: 'not',
        timestampMs: position === 'leading' ? 33400 : 40500,
        endTimestampMs: position === 'leading' ? 34560 : 40700,
      };
      if (position === 'leading') system.wordTimings.unshift(omitted);
      else system.wordTimings.push(omitted);
      system.text = system.rawText = system.wordTimings
        .map((word) => word.text)
        .join(' ');
      system.timestampMs = system.wordTimings[0].timestampMs;
      system.endTimestampMs = system.wordTimings.at(-1)!.endTimestampMs;
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
          echoEvidence,
        })[0].presentation,
      ).toBeUndefined();
    },
  );

  it('retains a later local repetition of the exact terminal word after System speech ends', () => {
    const { mic, system, echoEvidence, local } = liveEchoOmissionFixture();
    mic.wordTimings[14].timestampMs = 46500;
    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [],
      echoEvidence,
    });
    expect(result.presentation).toMatchObject({
      visibility: 'echo_span_removed',
      text: `today ${local}`,
      timestampMs: 46500,
    });
    expect(result.wordTimings).toEqual(mic.wordTimings);
  });

  it('matches a leading System omission and retains a distinct local prefix and suffix', () => {
    const { mic, system, echoEvidence, local } = liveEchoOmissionFixture();
    const words = system.wordTimings.slice(2).map((word) => ({
      ...word,
      timestampMs: word.timestampMs + 110,
      endTimestampMs: word.endTimestampMs + 110,
    }));
    mic.wordTimings = [
      { text: 'local', timestampMs: 33000, endTimestampMs: 33200 },
      { text: 'opening', timestampMs: 33200, endTimestampMs: 34000 },
      ...words,
      ...mic.wordTimings.slice(15),
    ];
    mic.timestampMs = 33000;
    mic.text = mic.rawText = mic.wordTimings.map((word) => word.text).join(' ');
    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [],
      echoEvidence,
    });
    expect(result.presentation).toMatchObject({
      visibility: 'echo_span_removed',
      text: `local opening ${local}`,
      timestampMs: 33000,
    });
  });

  it.each([
    ['our notes', 'anodes', true],
    ['our nodes', 'anos', true],
    ['our boats', 'abos', true],
    ['abos', 'our boats', true],
    ['our notes', 'anodes', false],
    ['notebook', 'note book', true],
    ['folder contains', 'holder contains', true],
    ['folder', 'holder', false],
  ])(
    'aligns an acoustically corroborated ASR word boundary change: %s/%s',
    (systemWords, micWords, hasLocal) => {
      const prefix =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains';
      const suffix = 'i will check the final transcript today';
      const remote = `${prefix} ${systemWords} ${suffix}`;
      const echo = `${prefix} ${micWords} ${suffix}`;
      const local = hasLocal
        ? 'No keep $15 instead of $50 can you hear me'
        : '';
      const timed = (disputed: string, localText = '') =>
        [
          { text: prefix, start: 1_000, duration: 6_800 },
          { text: disputed, start: 7_800, duration: 800 },
          { text: suffix, start: 8_600, duration: 2_400 },
          ...(localText
            ? [{ text: localText, start: 11_200, duration: 2_000 }]
            : []),
        ].flatMap((part) =>
          part.text.split(' ').map((text, index, words) => ({
            text,
            timestampMs: part.start + (index * part.duration) / words.length,
            endTimestampMs:
              part.start + ((index + 1) * part.duration) / words.length,
          })),
        );
      const mic = {
        ...segment('mic', 'mic', `${echo} ${local}`.trim(), 1_000, 13_200),
        wordTimings: timed(micWords, local),
      };
      const system = {
        ...segment('system', 'system', remote, 1_000, 11_000),
        wordTimings: timed(systemWords),
      };
      const echoEvidence = [
        {
          micStartMs: 7_700,
          micEndMs: 8_700,
          systemStartMs: 7_700,
          systemEndMs: 8_700,
        },
      ];
      const [result] = reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [],
        echoEvidence,
      });
      expect(result.presentation).toMatchObject(
        local
          ? { visibility: 'echo_span_removed', text: local }
          : { visibility: 'suppressed_echo' },
      );
      expect(result.text).toBe(mic.text);
      expect(result.wordTimings).toEqual(mic.wordTimings);
      for (const evidence of [
        [],
        [{ ...echoEvidence[0], systemStartMs: 12_000, systemEndMs: 13_000 }],
      ]) {
        expect(
          reconcileLiveTranscriptSegments({
            segments: [result, system],
            activityWindows: [],
            echoEvidence: evidence,
          })[0],
        ).toEqual(mic);
      }
    },
  );

  it.each([
    [0, 0, true],
    [300, 300, false],
    [0, 300, false],
    [-400, -400, false],
  ])(
    'allows acoustic word-boundary quantization while rejecting a different spoken interval (%s/%s)',
    (startShift, endShift, matched) => {
      const remote =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript today';
      const local = `${remote.replace('folder', 'holder')} can you hear me`;
      const timed = (text: string) =>
        text.split(' ').map((text, index) => ({
          text,
          timestampMs: 32_000 + index * 400,
          endTimestampMs: 32_400 + index * 400,
        }));
      const mic = {
        ...segment('mic', 'mic', local, 32_000, 44_000),
        wordTimings: timed(local),
      };
      const system = {
        ...segment('system', 'system', remote, 32_000, 42_400),
        wordTimings: timed(remote),
      };
      Object.assign(mic.wordTimings[15], {
        timestampMs: 38_400 + startShift,
        endTimestampMs: 38_800 + endShift,
      });
      Object.assign(system.wordTimings[15], {
        timestampMs: 38_240,
        endTimestampMs: 38_560,
      });
      const evidence = {
        micStartMs: 37_500,
        micEndMs: 40_000,
        systemStartMs: 37_390,
        systemEndMs: 39_890,
      };
      const [result] = reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [],
        echoEvidence: [evidence],
      });
      if (matched)
        expect(result.presentation).toMatchObject({
          visibility: 'echo_span_removed',
          text: 'can you hear me',
        });
      else expect(result.presentation).toBeUndefined();
      expect(result.text).toBe(mic.text);
      expect(result.wordTimings).toEqual(mic.wordTimings);
      // An earlier long interval can keep an expired short pair in the index
      // scan. Its System side must not supplement a different pair's coverage.
      if (matched)
        expect(
          reconcileLiveTranscriptSegments({
            segments: [mic, system],
            activityWindows: [],
            echoEvidence: [
              {
                micStartMs: 37_000,
                micEndMs: 40_000,
                systemStartMs: 40_000,
                systemEndMs: 43_000,
              },
              {
                micStartMs: 37_500,
                micEndMs: 38_390,
                systemStartMs: 37_390,
                systemEndMs: 38_280,
              },
              {
                micStartMs: 38_420,
                micEndMs: 38_800,
                systemStartMs: 38_310,
                systemEndMs: 38_690,
              },
            ],
          })[0].presentation,
        ).toBeUndefined();
      // Proof that covers each source in different pairs cannot be combined.
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
          echoEvidence: [
            { ...evidence, systemStartMs: 39_000, systemEndMs: 41_500 },
            { ...evidence, micStartMs: 40_000, micEndMs: 42_500 },
          ],
        })[0].presentation,
      ).toBeUndefined();
    },
  );

  it.each([
    ['notes', 'important notes'],
    ['our notes', 'actually our notes'],
    ['eight', 'right'],
    ['could', 'would'],
    ['enable', 'disable'],
    ['our notes', 'new rules'],
  ])(
    'preserves critical changes and local insertions despite correlated audio: %s/%s',
    (systemWords, micWords) => {
      const prefix =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains';
      const suffix = 'i will check the final transcript today';
      const remote = `${prefix} ${systemWords} ${suffix}`;
      const local = `${prefix} ${micWords} ${suffix} can you hear me`;
      const withTimings = (words: string) =>
        words.split(' ').map((text, index) => ({
          text,
          timestampMs: 1_000 + index * 300,
          endTimestampMs: 1_300 + index * 300,
        }));
      const mic = {
        ...segment('mic', 'mic', local, 1_000, 15_000),
        wordTimings: withTimings(local),
      };
      const system = {
        ...segment(
          'system',
          'system',
          remote,
          1_000,
          1_000 + remote.split(' ').length * 300,
        ),
        wordTimings: withTimings(remote),
      };
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
          echoEvidence: [
            {
              micStartMs: 1_000,
              micEndMs: 15_000,
              systemStartMs: 1_000,
              systemEndMs: 15_000,
            },
          ],
        }),
      ).toEqual([mic, system]);
    },
  );

  it.each([false, true])(
    'uses aligned final-word onsets only for observed mic end padding; later local repetition=%s',
    (laterLocalWord) => {
      const remote =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript today';
      const micText = `${remote.replace('folder', 'holder')} can you make sure everything is perfect`;
      const mic = {
        ...segment('mic', 'mic', micText, 31_920, 44_960),
        wordTimings: micText.split(' ').map((text, index) => ({
          text,
          timestampMs:
            index < 25
              ? 31_920 + index * 400
              : index === 25
                ? laterLocalWord
                  ? 42_400
                  : 41_920
                : 43_520 + (index - 26) * 200,
          endTimestampMs:
            index < 25
              ? 32_320 + index * 400
              : index === 25
                ? 43_520
                : 43_720 + (index - 26) * 200,
        })),
      };
      const system = {
        ...segment('system', 'system', remote, 32_000, 42_000),
        wordTimings: remote.split(' ').map((text, index) => ({
          text,
          timestampMs: index === 25 ? 41_760 : 32_000 + index * 390.4,
          endTimestampMs: index === 25 ? 42_000 : 32_390.4 + index * 390.4,
        })),
      };
      const [result] = reconcileLiveTranscriptSegments({
        segments: [mic, system],
        echoEvidence: [
          {
            micStartMs: 31_000,
            micEndMs: 43_000,
            systemStartMs: 31_000,
            systemEndMs: 43_000,
          },
        ],
        activityWindows: [],
      });
      if (laterLocalWord) expect(result.presentation).toBeUndefined();
      else
        expect(result.presentation).toMatchObject({
          visibility: 'echo_span_removed',
          text: 'can you make sure everything is perfect',
        });
      expect(result.text).toBe(mic.text);
      expect(result.wordTimings).toEqual(mic.wordTimings);
      for (const unsupported of [
        { ...system, wordTimings: undefined },
        {
          ...system,
          endTimestampMs: 45_000,
          wordTimings: system.wordTimings.map((word, index) =>
            index === 25 ? { ...word, endTimestampMs: 45_000 } : word,
          ),
        },
      ]) {
        // Row-level containment is insufficient to remove the ambiguous tail.
        expect(
          reconcileLiveTranscriptSegments({
            segments: [mic, unsupported],
            activityWindows: [],
          })[0].presentation,
        ).toBeUndefined();
      }
    },
  );

  it('removes one time-aligned ASR letter substitution while preserving every local suffix word and raw revision', () => {
    const remote =
      'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript today';
    const local = 'No keep $15 instead of $50 can you hear me';
    const echo = remote.replace('folder', 'holder');
    const mic = {
      ...segment('mic', 'mic', `${echo} ${local}`, 1_000, 15_000),
      wordTimings: `${echo} ${local}`.split(' ').map((text, index) => ({
        text,
        timestampMs: 1_000 + index * 300,
        endTimestampMs: 1_250 + index * 300,
      })),
    };
    const system = segment(
      'system',
      'system',
      remote,
      1_000,
      1_000 + remote.split(' ').length * 300 - 50,
    );
    const verifiedSystem = {
      ...system,
      wordTimings: remote.split(' ').map((text, index) => ({
        text,
        timestampMs: 1_000 + index * 300,
        endTimestampMs: 1_250 + index * 300,
      })),
    };
    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, verifiedSystem],
      echoEvidence: [
        {
          micStartMs: 1_000,
          micEndMs: 15_000,
          systemStartMs: 1_000,
          systemEndMs: 15_000,
        },
      ],
      activityWindows: [],
    });
    expect(result.presentation).toMatchObject({
      visibility: 'echo_span_removed',
      text: local,
    });
    expect(result.presentation?.confidence).toBeLessThan(1);
    expect(result.text).toBe(mic.text);
    expect(result.rawText).toBe(mic.rawText);
    expect(
      reconcileLiveTranscriptSegments({
        segments: [
          result,
          {
            ...system,
            text: 'Different remote words',
            rawText: 'different remote words',
          },
        ],
        activityWindows: [],
      })[0],
    ).toEqual(mic);
  });

  it.each([
    ['folder', 'holder', false],
    ['folder', 'holder', 'late'],
    ['folder', 'summary', true],
    ['seven', 'sever', true],
    ['eight', 'right', true],
    ['tenth', 'teeth', true],
    ['could', 'would', true],
    ['might', 'right', true],
    ['never', 'newer', true],
    ['folder', 'holder actually', true],
    ['folder', 'holder', 'second substitution'],
  ])(
    'keeps uncertain or meaning-changing spans: %s/%s timing=%s',
    (remoteWord, micWord, timing) => {
      const remote = `the blue notebook is on the desk i will review the recording tomorrow the green ${remoteWord} contains our notes i will check the final transcript today`;
      const echo = remote
        .replace(remoteWord, micWord)
        .replace('blue', timing === 'second substitution' ? 'glue' : 'blue');
      const text = `${echo} can you hear me`;
      const mic = {
        ...segment('mic', 'mic', text, 1_000, 15_000),
        wordTimings: timing
          ? text.split(' ').map((text, index) => ({
              text,
              timestampMs: (timing === 'late' ? 6_000 : 1_000) + index * 300,
              endTimestampMs: (timing === 'late' ? 6_250 : 1_250) + index * 300,
            }))
          : undefined,
      };
      const system = segment(
        'system',
        'system',
        remote,
        1_000,
        1_000 + remote.split(' ').length * 300 - 50,
      );
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
        })[0],
      ).toEqual(mic);
    },
  );

  it('requires verified word timing for interior spans and restores raw wording after a remote revision', () => {
    const remote =
      'Please open the report and check the download menu before calling the administrator';
    const before = 'I have a local comment';
    const after = 'No keep my original changes';
    const mic = {
      ...segment('mic', 'mic', `${before} ${remote} ${after}`, 0, 25_000),
      wordTimings: [
        { text: before, start: 0 },
        { text: remote, start: 10_000 },
        { text: after, start: 20_000 },
      ].flatMap((part) =>
        part.text.split(' ').map((text, index) => ({
          text,
          timestampMs: part.start + index * 100,
          endTimestampMs: part.start + index * 100 + 80,
        })),
      ),
    };
    const system = segment('system', 'system', remote, 10_000, 11_280);
    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [],
    });
    expect(result.presentation).toMatchObject({
      visibility: 'echo_span_removed',
      text: `${before} ${after}`,
    });
    for (const wordTimings of [
      undefined,
      mic.wordTimings.map((word) => ({
        ...word,
        timestampMs: word.timestampMs + 5_000,
        endTimestampMs: word.endTimestampMs + 5_000,
      })),
    ]) {
      const unsupported = { ...mic, wordTimings };
      expect(
        reconcileLiveTranscriptSegments({
          segments: [unsupported, system],
          activityWindows: [],
        })[0],
      ).toEqual(unsupported);
    }
    expect(
      reconcileLiveTranscriptSegments({
        segments: [
          result,
          {
            ...system,
            text: 'Different remote wording',
            rawText: 'different remote wording',
          },
        ],
        activityWindows: [],
      })[0],
    ).toEqual(mic);
  });

  it.each(['Wait', 'Actually'])(
    'preserves a local boundary word beside an uncertain ASR echo: %s',
    (local) => {
      const text =
        'The team reviewed the long release checklist and tried running the deployment script before connecting to the database for the final validation run';
      const uncertain = text.replace('running', 'adding');
      const mic = segment(
        'mic',
        'mic',
        local === 'Wait' ? `${uncertain} ${local}` : `${local} ${uncertain}`,
        1_100,
        8_100,
      );
      const system = segment('system', 'system', text, 1_000, 8_000);
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
        }),
      ).toEqual([mic, system]);
    },
  );

  it.each(['prefix', 'suffix', 'interior'] as const)(
    'projects retained word times after removing an echo %s without changing raw times',
    (position) => {
      const remote =
        'Please open the report and check the download menu before calling the administrator';
      const before = position === 'prefix' ? [] : ['local', 'opening'];
      const after = position === 'suffix' ? [] : ['local', 'answer'];
      const tokens = [...before, ...remote.split(' '), ...after];
      const mic = {
        ...segment('mic', 'mic', tokens.join(' '), 0, tokens.length * 100),
        wordTimings: tokens.map((text, index) => ({
          text,
          timestampMs: index * 100,
          endTimestampMs: (index + 1) * 100,
        })),
      };
      const system = segment(
        'system',
        'system',
        remote,
        before.length * 100,
        (before.length + remote.split(' ').length) * 100,
      );
      const [result] = reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [],
      });
      expect(result.presentation).toMatchObject({
        visibility: 'echo_span_removed',
        timestampMs: before.length ? 0 : remote.split(' ').length * 100,
        endTimestampMs: after.length
          ? tokens.length * 100
          : before.length * 100,
      });
      expect(result.timestampMs).toBe(mic.timestampMs);
      expect(result.endTimestampMs).toBe(mic.endTimestampMs);
      expect(result.wordTimings).toEqual(mic.wordTimings);
    },
  );

  it.each(['Wait', 'No do not do that', 'Keep $15 instead of $50'])(
    'keeps every local suffix word after an exact remote prefix: %s',
    (suffix) => {
      const text =
        'Please open the report and check the download menu before calling the administrator';
      const mic = segment('mic', 'mic', `${text} ${suffix}`, 1_100, 8_000);
      const system = segment('system', 'system', text, 1_000, 8_100);
      const [result] = reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [],
      });
      expect(result.text).toBe(mic.text);
      expect(result.rawText).toBe(mic.rawText);
      expect(result.presentation).toMatchObject({
        visibility: 'echo_span_removed',
        text: suffix,
      });
      expect(mic).not.toHaveProperty('presentation');
    },
  );

  it('preserves the entire mixed mic row when the leading words or time alignment disagree', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const system = segment('system', 'system', text, 1_000, 6_000);
    for (const mic of [
      segment('mic', 'mic', `No ${text} Wait`, 1_100, 8_000),
      segment('mic', 'mic', `${text} Wait`, 3_000, 9_000),
      segment(
        'mic',
        'mic',
        'Please open the summary and check the download menu before calling the administrator Wait',
        1_100,
        8_000,
      ),
    ]) {
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
        })[0],
      ).toEqual(mic);
    }
  });

  it('suppresses an echo split across committed and tentative microphone rows', () => {
    const first = segment(
      'mic-1',
      'mic',
      'Please open the report and check',
      1_100,
      3_100,
    );
    const second = {
      ...segment(
        'mic-2',
        'mic',
        'the download menu before calling the administrator',
        3_100,
        6_100,
      ),
      confirmed: false,
    };
    const system = segment(
      'system',
      'system',
      `${first.text} ${second.text}`,
      1_000,
      6_000,
    );
    const result = reconcileLiveTranscriptSegments({
      segments: [first, system, second],
      activityWindows: [],
    });
    expect(
      result
        .filter((row) => row.presentation?.visibility === 'suppressed_echo')
        .map((row) => row.id),
    ).toEqual(['mic-1', 'mic-2']);
    expect(first).not.toHaveProperty('presentation');
    const restored = reconcileLiveTranscriptSegments({
      segments: result.map((row) =>
        row.source === 'system'
          ? {
              ...row,
              text: 'The request was cancelled',
              rawText: 'the request was cancelled',
            }
          : row,
      ),
      activityWindows: [],
    });
    expect(restored.every((row) => !row.presentation)).toBe(true);
  });

  it('matches different EOU splits on both sources without hiding local additions', () => {
    const mic = [
      segment('mic-1', 'mic', 'Please open the report and check', 1_100, 3_100),
      segment(
        'mic-2',
        'mic',
        'the download menu before calling the administrator',
        3_100,
        6_100,
      ),
    ];
    const system = [
      segment('sys-1', 'system', 'Please open the report', 1_000, 2_400),
      segment(
        'sys-2',
        'system',
        'and check the download menu before calling the administrator',
        2_400,
        6_000,
      ),
    ];
    expect(
      reconcileLiveTranscriptSegments({
        segments: [...mic, ...system],
        activityWindows: [],
      })
        .slice(0, 2)
        .every((row) => row.presentation?.visibility === 'suppressed_echo'),
    ).toBe(true);
    const local = segment('local', 'mic', 'Wait', 3_100, 3_200);
    const withLocal = reconcileLiveTranscriptSegments({
      segments: [mic[0], local, { ...mic[1], timestampMs: 3_200 }, ...system],
      activityWindows: [],
    });
    expect(
      withLocal.find((row) => row.id === 'local')?.presentation,
    ).toBeUndefined();
  });

  it('does not join microphone echoes across a long pause or a contradictory word', () => {
    const first = segment(
      'mic-1',
      'mic',
      'Please open the report and check',
      1_100,
      2_100,
    );
    const second = segment(
      'mic-2',
      'mic',
      'the download menu before calling the administrator',
      4_100,
      6_100,
    );
    const system = segment(
      'system',
      'system',
      `${first.text} ${second.text}`,
      1_000,
      6_000,
    );
    expect(
      reconcileLiveTranscriptSegments({
        segments: [first, second, system],
        activityWindows: [],
      }).every((row) => !row.presentation),
    ).toBe(true);
    const correction = {
      ...second,
      timestampMs: 2_100,
      text: `not ${second.text}`,
      rawText: `not ${second.rawText}`,
    };
    expect(
      reconcileLiveTranscriptSegments({
        segments: [first, correction, system],
        activityWindows: [],
      }).every((row) => !row.presentation),
    ).toBe(true);
  });

  it('presentation-suppresses a strongly aligned microphone echo without deleting it', () => {
    const mic = segment(
      'mic-1',
      'mic',
      'Please request Docker from the software portal.',
      1_100,
      3_100,
    );
    const system = segment(
      'system-1',
      'system',
      'Please request Docker from the software portal.',
      1_000,
      3_000,
    );

    const result = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 3.2, speaker: 'Them' }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).not.toBe(mic);
    expect(result[0].presentation).toEqual({
      visibility: 'suppressed_echo',
      matchedSegmentId: 'system-1',
      confidence: 1,
      reason: 'cross_channel_echo',
    });
    expect(mic).not.toHaveProperty('presentation');
  });

  it('preserves similar overlapping speech when microphone activity is locally dominant', () => {
    const mic = segment(
      'mic-1',
      'mic',
      'I think we should request Docker today.',
      1_000,
      2_500,
    );
    const system = segment(
      'system-1',
      'system',
      'I think we should request Docker today.',
      1_050,
      2_550,
    );

    const result = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 2.6, speaker: 'Me' }],
    });

    expect(result).toEqual([mic, system]);
  });

  it('preserves an uncertain word substitution even when remote activity dominates', () => {
    const mic = segment(
      'mic-1',
      'mic',
      'Please request Docker from the internal software portal today.',
      1_100,
      3_100,
    );
    const system = segment(
      'system-1',
      'system',
      'Please request Docker through the internal software portal today.',
      1_000,
      3_000,
    );

    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 3.2, speaker: 'Them' }],
    });

    expect(result.presentation).toBeUndefined();
  });

  it('preserves a long apparent echo with an uncorroborated modal change', () => {
    const mic = segment(
      'mic-near-echo',
      'mic',
      'She is joining in a minute actually Dana and I were messaging each other for almost an hour so I tried setting it up locally and then you know tried adding the script and I could connect to the database',
      1_100,
      12_100,
    );
    const system = segment(
      'system-near-echo',
      'system',
      'She is joining in a minute actually Dana and I were messaging each other for almost an hour so I tried setting it up locally and then you know tried running the script and I was able to connect to the database',
      1_000,
      12_000,
    );

    const [result] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 12.2, speaker: 'Them' }],
    });

    expect(result.presentation).toBeUndefined();
  });

  it('suppresses a long ordered echo despite louder microphone activity', () => {
    const system = segment(
      'system',
      'system',
      'So when I open the report the download option is not active can you show what the icon says it says the administrator has disabled this feature',
      3_900,
      23_600,
    );
    const mic = segment(
      'mic',
      'mic',
      'So when I uh open the report the download option is not active can you show what the icon says it says the administrator has disabled this feature',
      4_140,
      23_580,
    );
    const result = reconcileLiveTranscriptSegments({
      segments: [system, mic],
      activityWindows: [{ startTime: 4, endTime: 24, speaker: 'Me' }],
    });
    expect(result[1].presentation?.visibility).toBe('suppressed_echo');
    expect(mic).not.toHaveProperty('presentation');
  });

  it('keeps a local correction that differs by one important word', () => {
    const system = segment(
      'system',
      'system',
      'We should deploy the release today because the migration is ready for production',
      1_000,
      6_000,
    );
    const mic = segment(
      'mic',
      'mic',
      'We should not deploy the release today because the migration is ready for production',
      1_100,
      6_100,
    );
    expect(
      reconcileLiveTranscriptSegments({
        segments: [system, mic],
        activityWindows: [{ startTime: 1, endTime: 7, speaker: 'Them' }],
      }),
    ).toEqual([system, mic]);
  });

  it('does not confuse the same vocabulary in a different order with echo', () => {
    const system = segment(
      'system',
      'system',
      'The release blocks the migration and the migration blocks the report',
      1_000,
      6_000,
    );
    const mic = segment(
      'mic',
      'mic',
      'The report blocks the migration and the migration blocks the release',
      1_100,
      6_100,
    );
    expect(
      reconcileLiveTranscriptSegments({
        segments: [system, mic],
        activityWindows: [{ startTime: 1, endTime: 7, speaker: 'Them' }],
      }),
    ).toEqual([system, mic]);
  });

  it('matches a mic echo split across adjacent system utterances', () => {
    const first = segment(
      'system-1',
      'system',
      'Please open the report and check the download menu',
      1_000,
      4_000,
    );
    const second = segment(
      'system-2',
      'system',
      'The administrator has disabled this feature for the current role',
      4_100,
      7_000,
    );
    const mic = segment(
      'mic',
      'mic',
      `${first.text} ${second.text}`,
      1_100,
      7_100,
    );
    const result = reconcileLiveTranscriptSegments({
      segments: [first, second, mic],
      activityWindows: [],
    });
    expect(result[2].presentation?.visibility).toBe('suppressed_echo');
  });

  it('restores a previously matched provisional echo when the remote text revises', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const mic = segment('mic', 'mic', text, 1_100, 5_100);
    const system = {
      ...segment('system', 'system', text, 1_000, 5_000),
      confirmed: false,
    };
    const first = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [],
    });
    expect(first[0].presentation?.visibility).toBe('suppressed_echo');
    const revised = {
      ...system,
      text: 'A different sentence',
      rawText: 'a different sentence',
    };
    const next = reconcileLiveTranscriptSegments({
      segments: [first[0], revised],
      activityWindows: [],
    });
    expect(next[0].presentation).toBeUndefined();
  });

  it('retains a mixed mic segment containing echo plus a unique local interruption', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const system = segment('system', 'system', text, 1_000, 8_000);
    const mic = segment(
      'mic',
      'mic',
      `${text} Wait I will share my screen instead`,
      1_100,
      8_100,
    );
    const [result, remote] = reconcileLiveTranscriptSegments({
      segments: [mic, system],
      activityWindows: [{ startTime: 1, endTime: 9, speaker: 'Them' }],
    });
    expect(result).toMatchObject(mic);
    expect(remote).toBe(system);
    expect(result.presentation).toMatchObject({
      visibility: 'echo_span_removed',
      text: 'Wait I will share my screen instead',
    });
    const revisedSystem = {
      ...system,
      text: 'Different remote words',
      rawText: 'different remote words',
    };
    expect(
      reconcileLiveTranscriptSegments({
        segments: [result, revisedSystem],
        activityWindows: [],
      })[0],
    ).toEqual(mic);
  });

  it.each([
    [
      'Keep the cost at $ 15 before the review so the team can finish today',
      'Keep the cost at € 15 before the review so the team can finish today',
    ],
    [
      'Keep the adjustment at - 15 percent before the review so the team can finish today',
      'Keep the adjustment at + 15 percent before the review so the team can finish today',
    ],
    [
      'Keep the error rate at .5 percent before the review so the team can finish today',
      'Keep the error rate at 5 percent before the review so the team can finish today',
    ],
    [
      'Keep the adjustment at −15 percent before the review so the team can finish today',
      'Keep the adjustment at 15 percent before the review so the team can finish today',
    ],
    [
      'Keep the cost at $15 before the review so the team can finish today',
      'Keep the cost at €15 before the review so the team can finish today',
    ],
    [
      'Keep the error rate at 1.5 percent before the review so the team can finish today',
      'Keep the error rate at 15 percent before the review so the team can finish today',
    ],
    [
      'Keep the adjustment at -15 percent before the review so the team can finish today',
      'Keep the adjustment at +15 percent before the review so the team can finish today',
    ],
    [
      'We will approve 15 reports before the review so the team can finish today',
      'We will approve 50 reports before the review so the team can finish today',
    ],
    [
      'We should deploy the release today because the migration is ready for production',
      'We should not deploy the release today because the migration is ready for production',
    ],
  ])(
    'retains contradictory numbers or remote negations',
    (micText, systemText) => {
      const mic = segment('mic', 'mic', micText, 1_100, 6_100);
      const system = segment('system', 'system', systemText, 1_000, 6_000);
      expect(
        reconcileLiveTranscriptSegments({
          segments: [mic, system],
          activityWindows: [],
        }),
      ).toEqual([mic, system]);
    },
  );

  it('keeps a later local repetition despite overlapping long segment timestamps', () => {
    const text =
      'Please open the report and check the download menu before calling the administrator';
    const system = segment('system', 'system', text, 1_000, 10_000);
    const mic = segment('mic', 'mic', text, 4_000, 13_000);
    expect(
      reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [],
      }),
    ).toEqual([mic, system]);
  });

  it('preserves short and uncertain repeated phrases', () => {
    const mic = segment('mic-1', 'mic', 'Sounds good.', 1_000, 1_500);
    const system = segment('system-1', 'system', 'Sounds good.', 1_000, 1_500);

    expect(
      reconcileLiveTranscriptSegments({
        segments: [mic, system],
        activityWindows: [{ startTime: 1, endTime: 1.5, speaker: 'Them' }],
      }),
    ).toEqual([mic, system]);
  });
});
