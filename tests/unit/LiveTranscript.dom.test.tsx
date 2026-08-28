// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveTranscript } from '../../src/components/features/LiveTranscript';

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

  it('marks accepted and interim transcript text as overflow-resistant', () => {
    setReducedMotion(true);
    const root = createRoot(container);
    const longToken = 'supercalifragilistic'.repeat(12);
    act(() =>
      root.render(
        <LiveTranscript
          segments={[
            {
              ...liveSegment,
              text: longToken,
            },
          ]}
          interimText={longToken}
        />,
      ),
    );

    const transcriptText = container.querySelector('.transcript-turn p');
    expect(transcriptText?.textContent).toContain(longToken);
    expect(container.querySelector('.transcript-interim')?.className).toContain(
      'transcript-interim',
    );

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
