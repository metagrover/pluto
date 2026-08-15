// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveTranscript } from '../../src/components/features/LiveTranscript';

const liveSegment = {
  id: 'new-turn',
  speaker: 'Me' as const,
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
  text: 'Now another person responds.',
  timestampMs: 18_000,
};

describe('LiveTranscript word reveal', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const setReducedMotion = (matches: boolean) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  };

  it('reveals newly accepted speech one word per timer tick', () => {
    setReducedMotion(false);
    const root = createRoot(container);
    act(() => root.render(<LiveTranscript segments={[]} interimText="" />));
    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );

    const visualText = container.querySelector('.transcript-revealed-text');
    expect(visualText?.textContent).toBe('');
    expect(
      container.querySelector('.transcript-typewriter-caret'),
    ).not.toBeNull();

    act(() => vi.advanceTimersByTime(85));
    expect(visualText?.textContent).toBe('Shipping ');

    act(() => vi.advanceTimersByTime(85));
    act(() => vi.advanceTimersByTime(85));
    expect(visualText?.textContent).toBe('Shipping today works.');
    expect(container.querySelector('.transcript-typewriter-caret')).toBeNull();

    act(() => root.unmount());
  });

  it('shows new speech immediately when reduced motion is requested', () => {
    setReducedMotion(true);
    const root = createRoot(container);
    act(() => root.render(<LiveTranscript segments={[]} interimText="" />));
    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );

    expect(
      container.querySelector('.transcript-revealed-text')?.textContent,
    ).toBe('Shipping today works.');
    expect(container.querySelector('.transcript-typewriter-caret')).toBeNull();

    act(() => root.unmount());
  });

  it('reports preview and fully validated live state quietly in the header', () => {
    setReducedMotion(true);
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
    ).toBe('Refining live');
    act(() =>
      root.render(<LiveTranscript segments={[liveSegment]} interimText="" />),
    );
    expect(
      container.querySelector('.live-transcript-heading span')?.textContent,
    ).toBe('Validated live');
    act(() => root.unmount());
  });

  it('renders consecutive same-speaker segments as one stable reading turn', () => {
    setReducedMotion(false);
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
    ).toEqual(['Me', 'Them']);
    expect(
      container.querySelectorAll('.transcript-revealed-text'),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll('.transcript-typewriter-caret'),
    ).toHaveLength(1);
    expect(
      [...container.querySelectorAll('.transcript-revealed-text')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Shipping today works.', 'The same thought continues.', '']);

    act(() => root.unmount());
  });

  it('keeps a long confirmed history visible while only the live edge reveals', () => {
    setReducedMotion(false);
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

    const firstText = container.querySelector('.transcript-revealed-text');
    expect(firstText?.textContent).toBe('Confirmed synthetic phrase 0.');

    act(() =>
      root.render(
        <LiveTranscript segments={[...history, liveSegment]} interimText="" />,
      ),
    );
    const texts = container.querySelectorAll('.transcript-revealed-text');
    expect(texts.item(0)).toBe(firstText);
    expect(texts.item(texts.length - 1).textContent).toBe('');

    act(() => vi.advanceTimersByTime(85));
    expect(texts.item(0).textContent).toBe('Confirmed synthetic phrase 0.');
    expect(texts.item(texts.length - 1).textContent).toBe('Shipping ');

    act(() => root.unmount());
  });

  it('follows new speech until the user scrolls away and returns on request', () => {
    setReducedMotion(true);
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
    setReducedMotion(true);
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
