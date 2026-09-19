// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { liveEchoLongPauseFixture } from '../fixtures/liveEchoLongPause';
import { liveEchoOmissionFixture } from '../fixtures/liveEchoOmission';
import { liveTranscriptJumbledSourcesFixture } from '../fixtures/liveTranscriptJumbledSources';

import { LiveTranscript } from '../../src/components/features/LiveTranscript';
import { buildRecordingWorkspaceModel } from '../../src/components/features/recordingWorkspaceModel';
import { createEouTranscriptProjection } from '../../src/services/liveTranscription/eouTranscriptProjection';
import { createLiveConversationProjection } from '../../src/services/liveTranscription/liveConversationProjection';
import { createLiveEchoEvidence } from '../../src/services/liveTranscription/liveEchoEvidence';
import {
  reconcileLiveTranscriptReading,
  reconcileLiveTranscriptSegments,
} from '../../src/services/liveTranscription/liveTranscriptReconciliation';

const liveSegment = {
  id: 'new-turn',
  speaker: 'Me' as const,
  source: 'mic' as const,
  text: 'Shipping today works.',
  timestampMs: 12_000,
  confirmed: true,
};

const continuedSegment = {
  ...liveSegment,
  id: 'continued-turn',
  text: 'The same thought continues.',
  timestampMs: 14_000,
};

const otherSpeakerSegment = {
  ...liveSegment,
  id: 'other-speaker',
  speaker: 'Them' as const,
  source: 'system' as const,
  text: 'Now another person responds.',
  timestampMs: 18_000,
};

describe('LiveTranscript reading experience', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it('shows Call then only the local reply when native microphone EOU omits a System sentence', () => {
    const { mic, system, echoEvidence, local } = liveEchoOmissionFixture();
    const projection = createEouTranscriptProjection();
    const root = createRoot(container);
    const publish = (
      row: typeof mic | typeof system,
      revision: number,
      evidence = echoEvidence,
    ) => {
      const committed = row.wordTimings.slice(0, -1);
      const raw = projection.apply({
        streamId: `omission-${row.source}`,
        source: row.source,
        generation: 1,
        revision,
        processedAudioSeconds: 78,
        committedText: committed.map((word) => word.text).join(' '),
        tentativeText: row.wordTimings.at(-1)!.text,
        tokens: row.wordTimings.map((word, index) => ({
          text: `▁${word.text}`,
          startSeconds: word.timestampMs / 1000,
          endSeconds: word.endTimestampMs / 1000,
          committed: index < row.wordTimings.length - 1,
        })),
      });
      const model = buildRecordingWorkspaceModel({
        startedAtMs: 1,
        nowMs: 78000,
        isStarting: false,
        isProcessing: false,
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
        liveTranscriptIntegrity: 'healthy',
        interimText: '',
        segments: reconcileLiveTranscriptSegments({
          segments: raw,
          activityWindows: [],
          echoEvidence: evidence,
        }),
      });
      act(() =>
        root.render(
          <LiveTranscript segments={model.transcript} interimText="" />,
        ),
      );
      return raw;
    };
    publish(mic, 1);
    const raw = publish(system, 1);
    const turns = () => [...container.querySelectorAll('.transcript-turn')];
    expect(
      turns().map((turn) => turn.querySelector('strong')?.textContent),
    ).toEqual(['Call', 'Mic']);
    expect(
      turns()[1]
        .querySelector('.transcript-turn__content')
        ?.textContent?.replace(/[.]/g, ''),
    ).toBe(local);
    expect(turns()[1].querySelector('time')?.getAttribute('datetime')).toBe(
      new Date(47200).toISOString(),
    );
    expect(container.textContent?.match(/blue notebook/g)).toHaveLength(1);
    expect(raw.find((row) => row.source === 'mic')?.rawText).toContain(
      'tomorrow transcript today',
    );
    publish(system, 2, []);
    expect(container.textContent?.match(/blue notebook/g)).toHaveLength(2);
    act(() => root.unmount());
  });

  it.each([
    ['notes', 'important notes'],
    ['notes', 'not notes'],
    ['eight', 'right'],
    ['could', 'would'],
    ['our nodes', 'pizza'],
    ['our nodes', 'planet'],
    ['our nodes', 'yes'],
  ])(
    'keeps local wording despite helper-admitted mixed audio: %s/%s',
    (systemWord, micWord) => {
      const pcm = (pattern: number) =>
        Float32Array.from({ length: 48_000 }, (_, index) => {
          const bin = Math.floor(index / 160);
          const seed = ((bin + 1) * 1664525 + pattern * 1013904223) >>> 0;
          const hash = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0;
          return (
            (0.01 + (hash / 4294967296) * 0.2) *
            Math.sin((index * 2 * Math.PI * 1000) / 16000)
          );
        });
      const systemPcm = pcm(0);
      const localPcm = pcm(2);
      const mixedPcm = systemPcm.map(
        (sample, index) => 0.4 * sample + 0.2 * localPcm[index],
      );
      const helper = createLiveEchoEvidence();
      helper.append({
        source: 'system',
        sampleRate: 16000,
        samples: systemPcm,
        startTimeMs: 7000,
        endTimeMs: 10000,
      });
      helper.append({
        source: 'mic',
        sampleRate: 16000,
        samples: mixedPcm,
        startTimeMs: 7200,
        endTimeMs: 10200,
      });
      const echoEvidence = helper.snapshot();
      // Correlated mixed audio can pass the acoustic helper. This real admitted
      // pair covers the disputed word completely; lexical safeguards must hold.
      expect(
        echoEvidence.some(
          (window) =>
            window.micStartMs <= 8000 &&
            window.micEndMs >= 8800 &&
            window.systemStartMs <= 7800 &&
            window.systemEndMs >= 8600,
        ),
      ).toBe(true);
      const prefix =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains';
      const suffix = 'i will check the final transcript today';
      const local = 'can you hear me';
      const projection = createEouTranscriptProjection();
      let raw: ReturnType<typeof projection.apply> = [];
      for (const source of ['mic', 'system'] as const) {
        const offset = source === 'mic' ? 200 : 0;
        const words = [
          { text: prefix, start: 1000, duration: 6800 },
          {
            text: source === 'mic' ? micWord : systemWord,
            start: 7800,
            duration: 800,
          },
          { text: suffix, start: 8600, duration: 2400 },
          ...(source === 'mic'
            ? [{ text: local, start: 11400, duration: 2000 }]
            : []),
        ].flatMap((part) =>
          part.text.split(' ').map((text, index, all) => ({
            text,
            startSeconds:
              (part.start + offset + (index * part.duration) / all.length) /
              1000,
            endSeconds:
              (part.start +
                offset +
                ((index + 1) * part.duration) / all.length) /
              1000,
          })),
        );
        raw = projection.apply({
          streamId: `mixed-${source}`,
          source,
          generation: 1,
          revision: 1,
          processedAudioSeconds: 15,
          committedText: words
            .slice(0, -1)
            .map((word) => word.text)
            .join(' '),
          tentativeText: words.at(-1)!.text,
          tokens: words.map((word, index) => ({
            ...word,
            text: `▁${word.text}`,
            committed: index < words.length - 1,
          })),
        });
      }
      const before = structuredClone(raw);
      const reconciled = reconcileLiveTranscriptSegments({
        segments: raw,
        activityWindows: [],
        echoEvidence,
      });
      const model = buildRecordingWorkspaceModel({
        startedAtMs: 1,
        nowMs: 15000,
        isStarting: false,
        isProcessing: false,
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
        liveTranscriptIntegrity: 'healthy',
        interimText: '',
        segments: reconciled,
      });
      const root = createRoot(container);
      act(() =>
        root.render(
          <LiveTranscript segments={model.transcript} interimText="" />,
        ),
      );
      const youText = [...container.querySelectorAll('.transcript-turn')]
        .filter((turn) => turn.querySelector('strong')?.textContent === 'Mic')
        .map(
          (turn) =>
            turn.querySelector('.transcript-turn__content')?.textContent,
        )
        .join(' ')
        .replace(/[.,]/g, '')
        .toLowerCase();
      expect(youText).toContain(`${prefix} ${micWord} ${suffix} ${local}`);
      expect(
        reconciled
          .filter((row) => row.source === 'mic')
          .every((row) => !row.presentation),
      ).toBe(true);
      expect(raw).toEqual(before);
      act(() => root.unmount());
    },
  );

  it('does not resurrect a suppressed terminal word when local speech arrives after a long pause', () => {
    const { rows, echoEvidence } = liveEchoLongPauseFixture();
    const root = createRoot(container);
    const render = (raw: typeof rows) => {
      const model = buildRecordingWorkspaceModel({
        startedAtMs: 1,
        nowMs: 75000,
        isStarting: false,
        isProcessing: false,
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
        liveTranscriptIntegrity: 'healthy',
        interimText: '',
        segments: reconcileLiveTranscriptSegments({
          segments: raw,
          activityWindows: [],
          echoEvidence,
        }),
      });
      act(() =>
        root.render(
          <LiveTranscript segments={model.transcript} interimText="" />,
        ),
      );
    };
    const beforeLocal = structuredClone(rows);
    const short = beforeLocal.at(-1)!;
    short.text = short.rawText = 'today';
    short.endTimestampMs = short.timestampMs + 160;
    short.wordTimings = [
      { ...short.wordTimings![0], endTimestampMs: short.endTimestampMs },
    ];
    render(beforeLocal);
    const turns = () => [...container.querySelectorAll('.transcript-turn')];
    expect(
      turns().map((turn) => turn.querySelector('strong')?.textContent),
    ).toEqual(['Call']);
    const before = structuredClone(rows);
    render(rows);
    expect(
      turns().map((turn) => turn.querySelector('strong')?.textContent),
    ).toEqual(['Call', 'Mic']);
    expect(
      turns()[1].querySelector('.transcript-turn__content')?.textContent,
    ).toBe('can you hear mile vice ok');
    expect(turns()[1].querySelector('time')?.getAttribute('datetime')).toBe(
      new Date(72572.625).toISOString(),
    );
    expect(container.textContent?.match(/today/g)).toHaveLength(1);
    expect(rows).toEqual(before);
    act(() => root.unmount());
  });

  it('shows newly accepted speech immediately without a typewriter effect', () => {
    const root = createRoot(container);
    act(() => root.render(<LiveTranscript segments={[]} interimText="" />));
    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );

    expect(
      container.querySelector('.transcript-paragraph-part')?.textContent,
    ).toBe('Shipping today works.');
    expect(container.querySelector('.transcript-typewriter-caret')).toBeNull();

    act(() => root.unmount());
  });

  it('labels microphone and system audio as Mic and Call', () => {
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[liveSegment, otherSpeakerSegment]}
          interimText=""
        />,
      ),
    );

    expect(
      [...container.querySelectorAll('.transcript-speaker strong')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['Mic', 'Call']);

    act(() => root.unmount());
  });

  it('keeps an uncorroborated microphone wording change visible', () => {
    const root = createRoot(container);
    const mic = {
      ...liveSegment,
      id: 'mic-near-echo',
      text: 'The team reviewed the long release checklist and tried adding the deployment script before connecting to the database for the final validation run',
      rawText:
        'the team reviewed the long release checklist and tried adding the deployment script before connecting to the database for the final validation run',
      timestampMs: 1_100,
      endTimestampMs: 8_100,
    };
    const system = {
      ...otherSpeakerSegment,
      id: 'system-near-echo',
      text: 'The team reviewed the long release checklist and tried running the deployment script before connecting to the database for the final validation run',
      rawText:
        'the team reviewed the long release checklist and tried running the deployment script before connecting to the database for the final validation run',
      timestampMs: 1_000,
      endTimestampMs: 8_000,
    };
    const distinctLocal = {
      ...liveSegment,
      id: 'distinct-local',
      text: 'I will check that separately.',
      timestampMs: 9_000,
      endTimestampMs: 10_000,
    };
    const reconciled = reconcileLiveTranscriptSegments({
      segments: [mic, system, distinctLocal],
      activityWindows: [{ startTime: 1, endTime: 8.2, speaker: 'Them' }],
    });

    act(() =>
      root.render(<LiveTranscript segments={reconciled} interimText="" />),
    );

    expect(container.textContent).toContain('tried adding');
    expect(container.textContent).toContain('tried running');
    expect(container.textContent).toContain('I will check that separately.');
    expect(container.querySelectorAll('.transcript-turn')).toHaveLength(3);

    act(() => root.unmount());
  });

  it('keeps both sources visible through delayed provisional updates and commitment', () => {
    const root = createRoot(container);
    const projection = createEouTranscriptProjection();
    const publish = (
      source: 'mic' | 'system',
      revision: number,
      text: string,
      confirmed = false,
    ) => {
      const segments = projection.apply({
        streamId: `test-${source}`,
        source,
        revision,
        generation: 1,
        processedAudioSeconds: 10,
        committedText: confirmed ? text : '',
        tentativeText: confirmed ? '' : text,
        tokens: text.split(' ').map((word, index) => ({
          text: word,
          startSeconds: 1 + index * 0.1,
          endSeconds: 1.08 + index * 0.1,
          committed: confirmed,
        })),
      });
      const model = buildRecordingWorkspaceModel({
        startedAtMs: 1,
        nowMs: 10_000,
        isStarting: false,
        isProcessing: false,
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
        liveTranscriptIntegrity: 'healthy',
        interimText: '',
        segments: reconcileLiveTranscriptSegments({
          segments,
          activityWindows: [],
        }),
      });
      act(() =>
        root.render(
          <LiveTranscript segments={model.transcript} interimText="" />,
        ),
      );
    };
    publish('system', 1, 'The report is ready');
    expect(container.textContent).toContain('The report is ready');
    publish('mic', 1, 'Wait I have a correction');
    expect(container.textContent).toContain('The report is ready');
    expect(container.textContent).toContain('Wait I have a correction');
    publish('system', 2, 'The report is ready for review');
    expect(container.textContent).toContain('Wait I have a correction');
    expect(
      container.querySelectorAll('.transcript-paragraph-part--tentative'),
    ).toHaveLength(2);
    publish('mic', 2, 'Wait I have a correction', true);
    expect(container.textContent).toContain('Wait I have a correction.');
    expect(container.textContent).toContain('The report is ready for review');
    expect(
      container.querySelectorAll('.transcript-paragraph-part--tentative'),
    ).toHaveLength(1);
    act(() => root.unmount());
  });

  it('reconciles staggered mic EOU splits through the workspace and restores a revised local correction', () => {
    const root = createRoot(container);
    const projection = createEouTranscriptProjection();
    const words =
      'Please open the report and check the download menu before calling the administrator Then review the deployment settings and confirm the release is ready for tomorrow'.split(
        ' ',
      );
    const publish = (
      source: 'mic' | 'system',
      revision: number,
      committedCount: number,
      textWords = words,
    ) => {
      const raw = projection.apply({
        streamId: `test-${source}`,
        source,
        generation: 1,
        revision,
        processedAudioSeconds: 20,
        committedText: textWords.slice(0, committedCount).join(' '),
        tentativeText: textWords.slice(committedCount).join(' '),
        tokens: textWords.map((text, index) => ({
          text,
          startSeconds: 1 + index * 0.3,
          endSeconds: 1.25 + index * 0.3,
          committed: index < committedCount,
        })),
      });
      const model = buildRecordingWorkspaceModel({
        startedAtMs: 1,
        nowMs: 20_000,
        isStarting: false,
        isProcessing: false,
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
        liveTranscriptIntegrity: 'healthy',
        interimText: '',
        segments: reconcileLiveTranscriptSegments({
          segments: raw,
          activityWindows: [],
        }),
      });
      act(() =>
        root.render(
          <LiveTranscript segments={model.transcript} interimText="" />,
        ),
      );
      return raw;
    };
    const labels = () =>
      [...container.querySelectorAll('.transcript-speaker strong')].map(
        (label) => label.textContent,
      );

    publish('system', 1, 0);
    const raw = publish('mic', 1, 14);
    expect(raw.filter((segment) => segment.source === 'mic')).toHaveLength(2);
    expect(raw.every((segment) => !segment.presentation)).toBe(true);
    expect(labels()).toEqual(['Call']);
    expect(container.textContent).toContain('Refining');

    publish('mic', 2, 14, [...words, 'Wait', 'I', 'object']);
    expect(labels()).toContain('Mic');
    expect(labels()).toContain('Call');
    expect(container.textContent).toContain('Wait I object');

    publish('mic', 3, 14);
    expect(labels()).toEqual(['Call']);
    publish('system', 2, words.length);
    expect(labels()).toEqual(['Call']);
    expect(container.textContent).toContain('Caught up');
    publish('mic', 4, words.length);
    expect(labels()).toEqual(['Call']);
    expect(container.querySelectorAll('.transcript-turn')).toHaveLength(1);
    expect(container.textContent).toContain('release is ready for tomorrow');
    act(() => root.unmount());
  });

  it.each(['anodes', 'anos'])(
    'uses corroborated PCM intervals to remove a word-merged echo while keeping the local tail through revisions: %s',
    (mergedWord) => {
      const root = createRoot(container);
      const projection = createEouTranscriptProjection();
      const prefix =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains';
      const suffix = 'i will check the final transcript today';
      const local = 'can you make sure everything is';
      const echoEvidence = [
        {
          micStartMs: 37_500,
          micEndMs: 42_500,
          systemStartMs: 37_360,
          systemEndMs: 42_400,
        },
      ];
      const publish = (
        source: 'mic' | 'system',
        revision: number,
        evidence = echoEvidence,
        today = 'today',
      ) => {
        const mic = source === 'mic';
        const portions = [
          { text: prefix, start: mic ? 31.92 : 32, duration: mic ? 7.44 : 7.2 },
          {
            text: mic
              ? mergedWord
              : mergedWord === 'anos'
                ? 'our nodes'
                : 'our notes',
            start: mic ? 39.36 : 39.2,
            duration: 0.64,
          },
          {
            text: mic ? suffix : suffix.replace('today', today),
            start: mic ? 40 : 39.84,
            duration: 2,
          },
          ...(mic
            ? [
                { text: local, start: 43.52, duration: 1.28 },
                { text: 'perfect', start: 44.8, duration: 0.16 },
              ]
            : []),
        ];
        const words = portions.flatMap((part) =>
          part.text.split(' ').map((text, index, all) => ({
            text,
            startSeconds: part.start + (index * part.duration) / all.length,
            endSeconds:
              mic && text === 'today'
                ? 43.52
                : part.start + ((index + 1) * part.duration) / all.length,
          })),
        );
        const committed = words
          .slice(0, -1)
          .map((word) => word.text)
          .join(' ');
        const raw = projection.apply({
          streamId: `merged-${source}`,
          source,
          generation: 1,
          revision,
          processedAudioSeconds: 78,
          committedText: committed,
          tentativeText: words.at(-1)!.text,
          tokens: words.map((word, index) => ({
            ...word,
            text: `▁${word.text}`,
            committed: index < words.length - 1,
          })),
        });
        const model = buildRecordingWorkspaceModel({
          startedAtMs: 1,
          nowMs: 78_000,
          isStarting: false,
          isProcessing: false,
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
          liveTranscriptIntegrity: 'healthy',
          interimText: '',
          segments: reconcileLiveTranscriptSegments({
            segments: raw,
            activityWindows: [],
            echoEvidence: evidence,
          }),
        });
        act(() =>
          root.render(
            <LiveTranscript segments={model.transcript} interimText="" />,
          ),
        );
        return raw;
      };
      const youText = () =>
        [...container.querySelectorAll('.transcript-turn')]
          .filter((turn) => turn.querySelector('strong')?.textContent === 'Mic')
          .map(
            (turn) =>
              turn.querySelector('.transcript-turn__content')?.textContent,
          )
          .join(' ');
      publish('mic', 1);
      const raw = publish('system', 1);
      const renderedOrder = () =>
        [...container.querySelectorAll('.transcript-turn')].map((turn) => ({
          speaker: turn.querySelector('strong')?.textContent,
          time: turn.querySelector('time')?.getAttribute('datetime'),
        }));
      expect(renderedOrder().map((turn) => turn.speaker)).toEqual([
        'Call',
        'Mic',
      ]);
      expect(renderedOrder()[1].time).toBe(new Date(43_520).toISOString());
      expect(
        container.querySelectorAll('.transcript-turn')[1].textContent,
      ).toContain('perfect');
      expect(youText()).toContain(local);
      expect(youText()).toContain('perfect');
      expect(youText()).not.toContain(mergedWord);
      expect(youText()).not.toContain('today');
      expect(container.textContent?.match(/blue notebook/g)).toHaveLength(1);
      expect(raw.find((row) => row.source === 'mic')?.rawText).toBe(
        `${prefix} ${mergedWord} ${suffix} ${local}`,
      );
      expect(raw.every((row) => !row.presentation)).toBe(true);
      publish('system', 2, []);
      expect(renderedOrder()[0].speaker).toBe('Mic');
      expect(renderedOrder()[0].time).toBe(new Date(31_920).toISOString());
      expect(youText()).toContain(mergedWord);
      expect(youText()).toContain(local);
      publish('system', 3, echoEvidence, 'tonight');
      expect(youText()).toContain(`today ${local}`);
      publish('system', 4);
      expect(youText()).not.toContain(mergedWord);
      expect(youText()).not.toContain('today');
      expect(youText()).toContain(local);
      act(() => root.unmount());
    },
  );

  it.each([false, true])(
    'shows only the local suffix of a mixed mic EOU with split microphone=%s',
    (splitMic) => {
      const root = createRoot(container);
      const projection = createEouTranscriptProjection();
      const remote =
        'The blue notebook is on the desk this check system audio from a new playback process';
      const mic = `${remote} are able to hear this`;
      const publish = (
        source: 'mic' | 'system',
        revision: number,
        committed: string,
        tentative = '',
      ) => {
        const words = `${committed} ${tentative}`.trim().split(' ');
        const committedCount = committed ? committed.split(' ').length : 0;
        const raw = projection.apply({
          streamId: `test-${source}`,
          source,
          generation: 1,
          revision,
          processedAudioSeconds: 20,
          committedText: committed,
          tentativeText: tentative,
          tokens: words.map((text, index) => ({
            text,
            startSeconds: 1 + index * 0.3,
            endSeconds: 1.25 + index * 0.3,
            committed: index < committedCount,
          })),
        });
        const model = buildRecordingWorkspaceModel({
          startedAtMs: 1,
          nowMs: 20_000,
          isStarting: false,
          isProcessing: false,
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
          liveTranscriptIntegrity: 'healthy',
          interimText: '',
          segments: reconcileLiveTranscriptSegments({
            segments: raw,
            activityWindows: [],
          }),
        });
        act(() =>
          root.render(
            <LiveTranscript segments={model.transcript} interimText="" />,
          ),
        );
        return raw;
      };
      const youText = () =>
        [...container.querySelectorAll('.transcript-turn')]
          .filter((turn) => turn.querySelector('strong')?.textContent === 'Mic')
          .map(
            (turn) =>
              turn.querySelector('.transcript-turn__content')?.textContent,
          )
          .join(' ');
      publish('system', 1, remote.slice(0, -' process'.length), 'process');
      const raw = splitMic
        ? publish(
            'mic',
            1,
            mic.split(' ').slice(0, 6).join(' '),
            mic.split(' ').slice(6).join(' '),
          )
        : publish('mic', 1, mic);
      expect(youText().replace(/\.$/, '')).toBe('are able to hear this');
      expect(container.textContent?.match(/blue notebook/g)).toHaveLength(1);
      expect(
        raw
          .filter((row) => row.source === 'mic')
          .map((row) => row.rawText)
          .join(' '),
      ).toBe(mic);
      expect(raw.every((row) => !row.presentation)).toBe(true);
      publish('system', 2, remote.slice(0, -' process'.length), 'processor');
      expect(youText()).toContain('process are able to hear this');
      publish('system', 3, remote);
      expect(youText().replace(/\.$/, '')).toBe('are able to hear this');
      publish('mic', 2, `${mic} Properly the subtraction doesn’t seem to be`);
      expect(youText()).toContain('are able to hear this');
      expect(youText()).toContain(
        'Properly the subtraction doesn’t seem to be.',
      );
      act(() => root.unmount());
    },
  );

  it.each([false, true])(
    'retains the local tail when staggered System EOU wording differs by one ASR letter; padded final word=%s',
    (paddedFinalWord) => {
      const root = createRoot(container);
      const projection = createEouTranscriptProjection();
      const remote =
        'the blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript';
      const echo = remote.replace('folder', 'holder');
      const publish = (
        source: 'mic' | 'system',
        revision: number,
        systemTentative = 'today',
      ) => {
        const committed =
          source === 'mic' ? `${echo} today can you hear me` : remote;
        const tentative = source === 'mic' ? 'okay' : systemTentative;
        const count = committed.split(' ').length;
        const raw = projection.apply({
          streamId: `actual-${source}`,
          source,
          generation: 1,
          revision,
          processedAudioSeconds: 78,
          committedText: committed,
          tentativeText: tentative,
          tokens: `${committed} ${tentative}`.split(' ').map((text, index) => ({
            text: `▁${text}`,
            startSeconds:
              paddedFinalWord && source === 'mic' && index > 25
                ? 63.16 + (index - 26) * 0.2
                : 52.06 + index * 0.38,
            endSeconds:
              paddedFinalWord && source === 'mic' && index >= 25
                ? index === 25
                  ? 63.16
                  : 63.36 + (index - 26) * 0.2
                : 52.36 + index * 0.38,
            committed: index < count,
          })),
        });
        const model = buildRecordingWorkspaceModel({
          startedAtMs: 1,
          nowMs: 78_000,
          isStarting: false,
          isProcessing: false,
          microphone: 'healthy',
          systemAudio: 'healthy',
          captureDurability: 'healthy',
          liveTranscriptIntegrity: 'healthy',
          interimText: '',
          segments: reconcileLiveTranscriptSegments({
            segments: raw,
            activityWindows: [],
            echoEvidence: [
              {
                micStartMs: 50_000,
                micEndMs: 65_000,
                systemStartMs: 50_000,
                systemEndMs: 65_000,
              },
            ],
          }),
        });
        act(() =>
          root.render(
            <LiveTranscript segments={model.transcript} interimText="" />,
          ),
        );
        return raw;
      };
      const youText = () =>
        [...container.querySelectorAll('.transcript-turn')]
          .filter((turn) => turn.querySelector('strong')?.textContent === 'Mic')
          .map(
            (turn) =>
              turn.querySelector('.transcript-turn__content')?.textContent,
          )
          .join(' ');
      publish('mic', 1);
      const raw = publish('system', 1);
      expect(youText()).toContain('can you hear me');
      expect(youText()).toContain('okay');
      expect(youText()).not.toContain('blue notebook');
      expect(youText()).not.toContain('today');
      expect(container.textContent?.match(/blue notebook/g)).toHaveLength(1);
      expect(raw.find((row) => row.source === 'mic')?.rawText).toBe(
        `${echo} today can you hear me`,
      );
      expect(raw.every((row) => !row.presentation)).toBe(true);
      publish('system', 2, 'tonight');
      expect(youText()).toContain('today can you hear me');
      publish('system', 3);
      expect(youText()).not.toContain('blue notebook');
      expect(youText()).toContain('can you hear me');
      act(() => root.unmount());
    },
  );

  it.each([false, true])(
    'removes only the time-aligned System span after local speech, preserving an earlier local repetition=%s',
    (repeatBefore) => {
      const root = createRoot(container);
      const projection = createEouTranscriptProjection();
      const remote =
        'The blue notebook is on the desk i will review the recording tomorrow the green folder contains our notes i will check the final transcript';
      const local = repeatBefore
        ? remote
        : 'In hear me Okay my transcription is showing up Correctly';
      const suffix = 'Please check my microphone';
      const update = (
        source: 'mic' | 'system',
        revision: number,
        remoteText = remote,
      ) => {
        const portions =
          source === 'mic'
            ? [
                { text: local, start: 13 },
                { text: remoteText, start: 27 },
                { text: suffix, start: 37 },
              ]
            : [{ text: remoteText, start: 27 }];
        return projection.apply({
          streamId: `test-${source}`,
          source,
          generation: 1,
          revision,
          processedAudioSeconds: 40,
          committedText: portions.map((part) => part.text).join(' '),
          tentativeText: 'today',
          tokens: [
            ...portions.flatMap((part) =>
              part.text.split(' ').map((text, index) => ({
                text: `▁${text}`,
                startSeconds: part.start + index * 0.3,
                endSeconds: part.start + index * 0.3 + 0.25,
                committed: true,
              })),
            ),
            {
              text: '▁today',
              startSeconds: 39,
              endSeconds: 39.3,
              committed: false,
            },
          ],
        });
      };
      update('mic', 1);
      const raw = update('system', 1);
      const model = buildRecordingWorkspaceModel({
        startedAtMs: 1,
        nowMs: 40_000,
        isStarting: false,
        isProcessing: false,
        microphone: 'healthy',
        systemAudio: 'healthy',
        captureDurability: 'healthy',
        liveTranscriptIntegrity: 'healthy',
        interimText: '',
        segments: reconcileLiveTranscriptSegments({
          segments: raw,
          activityWindows: [],
        }),
      });
      act(() =>
        root.render(
          <LiveTranscript segments={model.transcript} interimText="" />,
        ),
      );
      const you = [...container.querySelectorAll('.transcript-turn')]
        .filter((turn) => turn.querySelector('strong')?.textContent === 'Mic')
        .map(
          (turn) =>
            turn.querySelector('.transcript-turn__content')?.textContent,
        )
        .join(' ');
      expect(you).toContain(local);
      expect(you).toContain(suffix);
      expect(you.match(/blue notebook/g)?.length ?? 0).toBe(
        repeatBefore ? 1 : 0,
      );
      expect(raw.find((row) => row.source === 'mic')?.rawText).toBe(
        `${local} ${remote} ${suffix}`,
      );
      expect(raw.every((row) => !row.presentation)).toBe(true);
      act(() => root.unmount());
    },
  );

  it('labels an older provisional turn as Live below later confirmed history', () => {
    const root = createRoot(container);
    const projection = createEouTranscriptProjection();
    projection.apply({
      streamId: 'test-mic',
      source: 'mic',
      revision: 1,
      generation: 1,
      processedAudioSeconds: 95,
      committedText: '',
      tentativeText: 'a mutable live turn',
      tokens: [
        {
          text: 'a mutable live turn',
          startSeconds: 94,
          endSeconds: 95,
          committed: false,
        },
      ],
    });
    const segments = projection.apply({
      streamId: 'test-system',
      source: 'system',
      revision: 1,
      generation: 1,
      processedAudioSeconds: 380,
      committedText: 'a later confirmed turn',
      tentativeText: '',
      tokens: [
        {
          text: 'a later confirmed turn',
          startSeconds: 378,
          endSeconds: 379,
          committed: true,
        },
      ],
    });

    act(() =>
      root.render(<LiveTranscript segments={segments} interimText="" />),
    );

    expect(
      [...container.querySelectorAll('.transcript-speaker time')].map(
        (time) => time.textContent,
      ),
    ).toEqual(['06:18', 'Live']);
    expect(
      [...container.querySelectorAll('.transcript-turn')].map((turn) =>
        turn.textContent?.toLowerCase().includes('a later confirmed turn')
          ? 'confirmed'
          : 'live',
      ),
    ).toEqual(['confirmed', 'live']);

    act(() => root.unmount());
  });

  it('distinguishes the tentative tail and reports truthful live status', () => {
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[{ ...liveSegment, confirmed: false }]}
          interimText=""
        />,
      ),
    );
    expect(
      container.querySelector('.live-transcript-heading span')?.textContent,
    ).toBe('Refining');
    expect(
      container.querySelector('.transcript-paragraph-part--tentative')
        ?.textContent,
    ).toBe('Shipping today works.');
    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );
    expect(
      container.querySelector('.live-transcript-heading span')?.textContent,
    ).toBe('Caught up');
    act(() =>
      root.render(
        <LiveTranscript
          segments={[liveSegment]}
          interimText=""
          integrity="lagging"
        />,
      ),
    );
    expect(
      container.querySelector('.live-transcript-heading span')?.textContent,
    ).toBe('Falling behind');
    act(() => root.unmount());
  });

  it('renders consecutive same-speaker segments as one stable reading turn', () => {
    const root = createRoot(container);
    act(() => root.render(<LiveTranscript segments={[]} interimText="" />));
    act(() =>
      root.render(
        <LiveTranscript
          segments={[liveSegment, continuedSegment, otherSpeakerSegment]}
          interimText=""
        />,
      ),
    );

    expect(container.querySelectorAll('.transcript-turn')).toHaveLength(2);
    expect(
      [...container.querySelectorAll('.transcript-speaker strong')].map(
        (label) => label.textContent,
      ),
    ).toEqual(['Mic', 'Call']);
    expect(
      [...container.querySelectorAll('.transcript-paragraph-part')].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      'Shipping today works.',
      'The same thought continues.',
      'Now another person responds.',
    ]);

    act(() => root.unmount());
  });

  it('preserves a later paragraph when delayed opposing speech splits its visual group', () => {
    const projector = createLiveConversationProjection({ generation: 1 });
    const first = { ...liveSegment, id: 'first', timestampMs: 1_000 };
    const later = { ...continuedSegment, id: 'later', timestampMs: 3_000 };
    const root = createRoot(container);
    const initial = projector.apply({
      generation: 1,
      reading: reconcileLiveTranscriptReading({
        segments: [first, later],
        activityWindows: [],
      }),
      reason: 'recognition',
    });
    act(() =>
      root.render(
        <LiveTranscript segments={[]} interimText="" conversation={initial} />,
      ),
    );
    const laterParagraph = container.querySelector(
      '[data-conversation-row="later"]',
    );
    const withInterruption = projector.apply({
      generation: 1,
      reading: reconcileLiveTranscriptReading({
        segments: [
          first,
          { ...otherSpeakerSegment, id: 'interruption', timestampMs: 2_000 },
          later,
        ],
        activityWindows: [],
      }),
      reason: 'recognition',
    });
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={withInterruption}
        />,
      ),
    );

    expect(container.querySelector('[data-conversation-row="later"]')).toBe(
      laterParagraph,
    );
    act(() => root.unmount());
  });

  it('keeps a long confirmed history stable when the live edge advances', () => {
    const root = createRoot(container);
    const history = Array.from({ length: 300 }, (_, index) => ({
      ...liveSegment,
      id: `history-${index}`,
      text: `Confirmed synthetic phrase ${index}.`,
      timestampMs: index * 1_000,
    }));
    act(() =>
      root.render(<LiveTranscript segments={history} interimText="" />),
    );

    const firstText = container.querySelector('.transcript-paragraph-part');
    expect(firstText?.textContent).toBe('Confirmed synthetic phrase 0.');

    act(() =>
      root.render(
        <LiveTranscript segments={[...history, liveSegment]} interimText="" />,
      ),
    );
    const texts = container.querySelectorAll('.transcript-paragraph-part');
    expect(texts.item(0)).toBe(firstText);
    expect(texts.item(0).textContent).toBe('Confirmed synthetic phrase 0.');
    expect(texts.item(texts.length - 1).textContent).toBe(
      'Shipping today works.',
    );

    act(() => root.unmount());
  });

  it('follows new speech until the user scrolls away and returns on request', () => {
    const root = createRoot(container);
    act(() => root.render(<LiveTranscript segments={[]} interimText="" />));

    const scrollElement = container.querySelector<HTMLElement>(
      '.live-transcript-scroll',
    );
    expect(scrollElement).not.toBeNull();
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
    });

    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );
    expect(scrollElement?.scrollTop).toBe(600);

    if (!scrollElement) throw new Error('Missing transcript scroll element');
    act(() => {
      scrollElement.scrollTop = 120;
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Return to live',
      ),
    ).toBeDefined();

    act(() =>
      root.render(
        <LiveTranscript
          segments={[liveSegment, continuedSegment]}
          interimText=""
        />,
      ),
    );
    expect(scrollElement.scrollTop).toBe(120);

    const returnToLive = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Return to live',
    );
    act(() => returnToLive?.click());
    expect(scrollElement.scrollTop).toBe(600);
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Return to live',
      ),
    ).toBeUndefined();

    act(() => root.unmount());
  });

  it('restores follow mode when the user manually reaches the live edge', () => {
    const root = createRoot(container);
    act(() => root.render(<LiveTranscript segments={[]} interimText="" />));

    const scrollElement = container.querySelector<HTMLElement>(
      '.live-transcript-scroll',
    );
    if (!scrollElement) throw new Error('Missing transcript scroll element');
    Object.defineProperties(scrollElement, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
    });

    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );
    act(() => {
      scrollElement.scrollTop = 120;
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    act(() => {
      scrollElement.scrollTop = 400;
      scrollElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Return to live',
      ),
    ).toBeUndefined();

    act(() =>
      root.render(
        <LiveTranscript
          segments={[liveSegment, otherSpeakerSegment]}
          interimText=""
        />,
      ),
    );
    expect(scrollElement.scrollTop).toBe(600);

    act(() => root.unmount());
  });

  it('keeps keyed rows while ordering corrected speech by its retained timestamp', () => {
    const fixture = liveTranscriptJumbledSourcesFixture();
    const projection = createLiveConversationProjection({ generation: 1 });
    const project = (echoEvidence: typeof fixture.echoEvidence) =>
      projection.apply({
        generation: 1,
        reading: reconcileLiveTranscriptReading({
          segments: fixture.segments,
          activityWindows: [],
          echoEvidence,
        }),
        reason: echoEvidence.length ? 'echo_evidence' : 'recognition',
      });
    const root = createRoot(container);
    const initial = project([]);
    act(() =>
      root.render(
        <LiveTranscript segments={[]} interimText="" conversation={initial} />,
      ),
    );
    const micText = () =>
      [
        ...container.querySelectorAll(
          '[data-conversation-row^="mic-long-hypothesis"]',
        ),
      ]
        .map((element) => element.textContent)
        .join(' ');

    const corrected = project(fixture.echoEvidence);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={corrected}
        />,
      ),
    );
    expect(
      [
        ...container.querySelectorAll<HTMLElement>('[data-conversation-row]'),
      ].map((element) => element.dataset.conversationRow),
    ).toEqual([
      'system-1',
      'mic-long-hypothesis:speech-0',
      'system-2',
      'mic-long-hypothesis:speech-40',
      'system-3',
      'mic-long-hypothesis:speech-68',
    ]);
    expect(micText()).toContain(fixture.expectedLocalWords.join(' '));
    expect(container.textContent).toContain('Updated');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Transcript updated',
    );

    const restored = project([]);
    act(() =>
      root.render(
        <LiveTranscript segments={[]} interimText="" conversation={restored} />,
      ),
    );
    expect(micText()).toContain(fixture.mic.text);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Transcript wording restored',
    );
    act(() => root.unmount());
  });

  it('groups consecutive source speech and hides duplicate bookkeeping from the conversation', () => {
    const projector = createLiveConversationProjection({ generation: 1 });
    const segments = [liveSegment, continuedSegment, otherSpeakerSegment];
    const conversation = projector.apply({
      generation: 1,
      reason: 'recognition',
      reading: reconcileLiveTranscriptReading({
        segments,
        activityWindows: [],
      }),
    });
    conversation.rows.splice(1, 0, {
      ...conversation.rows[0],
      id: 'removed',
      text: '',
      parts: [],
      display: 'duplicate_removed',
    });
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={conversation}
        />,
      ),
    );
    expect(container.querySelectorAll('.transcript-turn')).toHaveLength(3);
    expect(
      container.querySelectorAll('.live-conversation-row--continuation'),
    ).toHaveLength(1);
    expect(container.querySelectorAll('[data-conversation-row]')).toHaveLength(
      3,
    );
    expect(container.textContent).not.toContain('Duplicate removed');
    expect(container.textContent).toContain(liveSegment.text);
    expect(container.textContent).toContain(continuedSegment.text);
    act(() => root.unmount());
  });

  it('shows both tentative sources in one keyboard-expandable draft', () => {
    const tentative = [
      {
        id: 'mic-draft',
        source: 'mic' as const,
        speaker: 'Speaker' as const,
        text: Array.from({ length: 18 }, (_, index) => `mic${index}`).join(' '),
        timestampMs: 1_000,
        confirmed: false,
      },
      {
        id: 'system-draft',
        source: 'system' as const,
        speaker: 'Speaker' as const,
        text: Array.from({ length: 18 }, (_, index) => `call${index}`).join(
          ' ',
        ),
        timestampMs: 1_100,
        confirmed: false,
      },
    ];
    const projector = createLiveConversationProjection({ generation: 1 });
    const conversation = projector.apply({
      generation: 1,
      reading: reconcileLiveTranscriptReading({
        segments: tentative,
        activityWindows: [],
      }),
      reason: 'recognition',
    });
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={tentative}
          interimText="legacy draft must stay hidden"
          conversation={conversation}
        />,
      ),
    );
    expect(container.querySelectorAll('.live-conversation-draft')).toHaveLength(
      2,
    );
    expect(container.textContent).toContain('Mic');
    expect(container.textContent).toContain('Call');
    expect(container.textContent).not.toContain(
      'legacy draft must stay hidden',
    );
    const toggle = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Show all',
    );
    const firstDraftPart = container.querySelector('[data-conversation-part]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    act(() => {
      toggle?.focus();
      toggle?.click();
    });
    expect(container.textContent).toContain('call17');
    expect(container.querySelector('[data-conversation-part]')).toBe(
      firstDraftPart,
    );
    expect(document.activeElement).toBe(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    act(() => root.unmount());
  });

  it('places tentative speech before later committed speech in the live timeline', () => {
    const committed = {
      ...otherSpeakerSegment,
      id: 'later-committed',
      text: 'This was committed later.',
      timestampMs: 12_000,
    };
    const tentative = {
      ...liveSegment,
      id: 'earlier-tentative',
      text: 'This is still being recognized',
      timestampMs: 2_000,
      confirmed: false,
    };
    const projector = createLiveConversationProjection({ generation: 1 });
    const conversation = projector.apply({
      generation: 1,
      reading: reconcileLiveTranscriptReading({
        segments: [committed, tentative],
        activityWindows: [],
      }),
      reason: 'recognition',
    });
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={conversation}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll<HTMLElement>('.transcript-turn')].map(
        (element) =>
          element.dataset.conversationDraft
            ? 'earlier-tentative'
            : element.querySelector<HTMLElement>('[data-conversation-row]')
                ?.dataset.conversationRow,
      ),
    ).toEqual(['earlier-tentative', 'later-committed']);

    act(() => root.unmount());
  });

  it('preserves the turn and text elements when tentative speech commits', () => {
    const projector = createLiveConversationProjection({ generation: 1 });
    const tentative = {
      ...liveSegment,
      id: 'stable-transition',
      text: 'A stable live phrase',
      timestampMs: 2_000,
      confirmed: false,
    };
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={projector.apply({
            generation: 1,
            reading: reconcileLiveTranscriptReading({
              segments: [tentative],
              activityWindows: [],
            }),
            reason: 'recognition',
          })}
        />,
      ),
    );
    const liveTurn = container.querySelector('.transcript-turn');
    const liveText = container.querySelector('[data-conversation-part]');

    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={projector.apply({
            generation: 1,
            reading: reconcileLiveTranscriptReading({
              segments: [{ ...tentative, confirmed: true }],
              activityWindows: [],
            }),
            reason: 'recognition',
          })}
        />,
      ),
    );

    expect(container.querySelector('.transcript-turn')).toBe(liveTurn);
    expect(container.querySelector('[data-conversation-part]')).toBe(liveText);
    expect(liveTurn?.classList.contains('live-conversation-row')).toBe(true);
    expect(liveTurn?.textContent).toContain('A stable live phrase');
    act(() => root.unmount());
  });

  it('gives split draft fragments distinct stable presentation identities', () => {
    const projector = createLiveConversationProjection({ generation: 1 });
    const tentative = {
      ...liveSegment,
      id: 'split-draft',
      text: 'local before echoed words local after',
      confirmed: false,
    };
    const conversation = projector.apply({
      generation: 1,
      reading: reconcileLiveTranscriptReading({
        segments: [tentative],
        activityWindows: [],
        echoEvidence: [],
      }),
      reason: 'recognition',
    });
    if (!conversation.draft) throw new Error('Expected draft');
    conversation.draft.parts = [
      {
        ...conversation.draft.parts[0],
        id: 'split-draft:0:2:visible',
        text: 'local before',
      },
      {
        ...conversation.draft.parts[0],
        id: 'split-draft:4:6:visible',
        text: 'local after',
        timestampMs: conversation.draft.parts[0].timestampMs + 400,
      },
    ];
    conversation.draft.collapsedParts = conversation.draft.parts;
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={conversation}
        />,
      ),
    );

    expect(
      [
        ...container.querySelectorAll<HTMLElement>('[data-conversation-part]'),
      ].map((element) => element.dataset.conversationPart),
    ).toEqual(['split-draft:0:2:visible', 'split-draft:4:6:visible']);
    act(() => root.unmount());
  });

  it('collapses an expanded draft when the meeting generation changes', () => {
    const draftFor = (generation: number, source: 'mic' | 'system') => {
      const projector = createLiveConversationProjection({ generation });
      return projector.apply({
        generation,
        reading: reconcileLiveTranscriptReading({
          segments: [
            {
              ...liveSegment,
              id: `draft-${generation}`,
              source,
              text: Array.from(
                { length: 30 },
                (_, index) => `word${index}`,
              ).join(' '),
              confirmed: false,
            },
          ],
          activityWindows: [],
        }),
        reason: 'recognition',
      });
    };
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={draftFor(1, 'mic')}
        />,
      ),
    );
    const firstToggle = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Show all',
    );
    act(() => firstToggle?.click());
    expect(firstToggle?.getAttribute('aria-expanded')).toBe('true');

    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={draftFor(2, 'system')}
        />,
      ),
    );
    const nextToggle = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Show all',
    );
    expect(nextToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('word29');
    act(() => root.unmount());
  });

  it('does not group committed rows across intervening tentative speech', () => {
    const before = {
      ...liveSegment,
      id: 'committed-before',
      text: 'Before the interruption.',
      timestampMs: 1_000,
      endTimestampMs: 1_500,
    };
    const tentative = {
      ...otherSpeakerSegment,
      id: 'tentative-between',
      text: 'An intervening reply',
      timestampMs: 2_000,
      endTimestampMs: 2_500,
      confirmed: false,
    };
    const after = {
      ...liveSegment,
      id: 'committed-after',
      text: 'After the interruption.',
      timestampMs: 3_000,
      endTimestampMs: 3_500,
    };
    const projector = createLiveConversationProjection({ generation: 1 });
    const conversation = projector.apply({
      generation: 1,
      reading: reconcileLiveTranscriptReading({
        segments: [before, tentative, after],
        activityWindows: [],
      }),
      reason: 'recognition',
    });
    const root = createRoot(container);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={conversation}
        />,
      ),
    );

    expect(
      [...container.querySelectorAll('.transcript-turn')].map((element) =>
        element.textContent?.replace(/\s+/gu, ' ').trim(),
      ),
    ).toEqual([
      expect.stringContaining('Before the interruption.'),
      expect.stringContaining('An intervening reply'),
      expect.stringContaining('After the interruption.'),
    ]);

    act(() => root.unmount());
  });

  it('shows a degraded warning even before the first live row arrives', () => {
    const projector = createLiveConversationProjection({ generation: 1 });
    const root = createRoot(container);
    const onOpenSettings = vi.fn();
    act(() =>
      root.render(
        <LiveTranscript
          segments={[]}
          interimText=""
          conversation={projector.degraded(1)}
          onOpenSettings={onOpenSettings}
        />,
      ),
    );
    expect(container.textContent).toContain(
      'Audio is recording safely · Live wording paused',
    );
    expect(container.textContent).toContain(
      'turn off Generate notes during meetings in Settings → Meetings',
    );
    const button = container.querySelector<HTMLButtonElement>(
      '.live-conversation-warning__action',
    );
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onOpenSettings).toHaveBeenCalledWith('meetings');
    act(() => root.unmount());
  });

  it('decorates an existing remote row without replacing or reordering it', () => {
    const remote = {
      ...otherSpeakerSegment,
      endTimestampMs: 19_000,
    };
    const onAction = vi.fn();
    const root = createRoot(container);
    act(() =>
      root.render(<LiveTranscript segments={[remote]} interimText="" />),
    );
    const originalRow = container.querySelector('.transcript-turn');
    const originalContent = originalRow?.querySelector(
      '.transcript-turn__content',
    )?.textContent;

    act(() =>
      root.render(
        <LiveTranscript
          segments={[remote]}
          interimText=""
          speakerIdentity={{
            meetingId: 'meeting-1',
            generation: 1,
            revision: 2,
            hints: [
              {
                suggestionId: 'suggestion-1',
                displayLabel: 'Likely Ada',
                state: 'suggested',
                ranges: [{ startMs: 17_500, endMs: 19_500 }],
                generation: 1,
                revision: 2,
              },
            ],
          }}
          onSpeakerIdentityAction={onAction}
        />,
      ),
    );

    const decoratedRow = container.querySelector('.transcript-turn');
    expect(decoratedRow).toBe(originalRow);
    expect(decoratedRow?.querySelector('strong')?.textContent).toBe(
      'Likely Ada',
    );
    expect(
      decoratedRow?.querySelector('.transcript-turn__content')?.textContent,
    ).toBe(originalContent);
    const reject = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Not this person',
    );
    act(() => reject?.click());
    expect(onAction).toHaveBeenCalledWith('suggestion-1', 'reject');
    act(() => root.unmount());
  });
});
