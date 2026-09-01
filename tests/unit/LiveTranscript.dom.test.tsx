// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveTranscript } from '../../src/components/features/LiveTranscript';
import { buildRecordingWorkspaceModel } from '../../src/components/features/recordingWorkspaceModel';
import { createEouTranscriptProjection } from '../../src/services/liveTranscription/eouTranscriptProjection';
import { reconcileLiveTranscriptSegments } from '../../src/services/liveTranscription/liveTranscriptReconciliation';

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

  it('labels microphone and system audio as You and Call', () => {
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
    ).toEqual(['You', 'Call']);

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
    ).toEqual(['You', 'Call']);
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
});
