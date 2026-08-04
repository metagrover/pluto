// @vitest-environment happy-dom

import { act } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as DashboardModule from '../../src/components/features/Dashboard';

describe('CurrentReadClaim browser lifecycle', () => {
  let container: HTMLDivElement;
  let scrollHeight = 140;
  let clientHeight = 90;
  const observers: Array<{
    callback: ResizeObserverCallback;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  const fontListeners = new Set<EventListener>();
  const addFontListener = vi.fn(
    (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') fontListeners.add(listener);
    },
  );
  const removeFontListener = vi.fn(
    (_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') fontListeners.delete(listener);
    },
  );

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    scrollHeight = 140;
    clientHeight = 90;
    observers.length = 0;
    fontListeners.clear();
    addFontListener.mockClear();
    removeFontListener.mockClear();
    Object.defineProperties(HTMLElement.prototype, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => clientHeight },
    });
    class MockResizeObserver {
      callback: ResizeObserverCallback;
      disconnect = vi.fn();
      observe = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        ready: new Promise(() => {}),
        addEventListener: addFontListener,
        removeEventListener: removeFontListener,
      },
    });
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  it('measures, toggles, remeasures, resets on claim change, and cleans up', () => {
    const CurrentReadClaim = (
      DashboardModule as unknown as Record<string, unknown>
    ).CurrentReadClaim as ComponentType<{ claim: string }>;
    expect(CurrentReadClaim).toBeTypeOf('function');
    const root = createRoot(container);
    act(() => root.render(<CurrentReadClaim claim="first exact claim" />));

    const claim = container.querySelector('#dashboard-current-read-claim');
    const disclosure = container.querySelector<HTMLButtonElement>(
      '#dashboard-current-read-disclosure',
    );
    expect(claim?.className).toContain('line-clamp-3');
    expect(disclosure?.textContent).toBe('Show full current read');
    expect(disclosure?.getAttribute('aria-expanded')).toBe('false');

    act(() => disclosure?.click());
    expect(container.querySelector('h1')?.className).not.toContain(
      'line-clamp-3',
    );
    expect(disclosure?.textContent).toBe('Collapse current read');
    expect(disclosure?.getAttribute('aria-expanded')).toBe('true');

    scrollHeight = 80;
    clientHeight = 90;
    act(() => observers.at(-1)?.callback([], observers.at(-1) as never));
    expect(
      container.querySelector('#dashboard-current-read-disclosure'),
    ).toBeNull();

    scrollHeight = 140;
    act(() => {
      for (const listener of fontListeners) listener(new Event('loadingdone'));
    });
    expect(
      container.querySelector('#dashboard-current-read-disclosure'),
    ).not.toBeNull();

    act(() => root.render(<CurrentReadClaim claim="second exact claim" />));
    expect(container.querySelector('h1')?.textContent).toBe(
      'second exact claim',
    );
    expect(container.querySelector('h1')?.className).toContain('line-clamp-3');
    expect(
      container
        .querySelector('#dashboard-current-read-disclosure')
        ?.getAttribute('aria-expanded'),
    ).toBe('false');

    const activeObserver = observers.at(-1);
    act(() => root.unmount());
    expect(activeObserver?.disconnect).toHaveBeenCalledOnce();
    expect(removeFontListener).toHaveBeenCalledWith(
      'loadingdone',
      expect.any(Function),
    );
  });
});
