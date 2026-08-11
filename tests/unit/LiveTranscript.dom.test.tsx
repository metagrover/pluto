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
});
