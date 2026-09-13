// @vitest-environment happy-dom

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoEndToast } from '../../src/components/ui/AutoEndToast';

describe('AutoEndToast component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders single-line title and subtext underneath without em-dashes', async () => {
    const onReopen = vi.fn();
    const onDismiss = vi.fn();

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AutoEndToast
          reason="call_app_exited"
          appName="Zoom"
          onReopen={onReopen}
          onDismiss={onDismiss}
        />,
      );
    });

    // Verify title and subtext exist
    expect(container.textContent).toContain('Meeting ended');
    expect(container.textContent).toContain('Zoom closed');
    expect(container.textContent).not.toContain('—');

    // Verify the structure: title in first paragraph, subtext in second paragraph
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toBe('Meeting ended');
    expect(paragraphs[1].textContent).toBe('Zoom closed');

    // Verify reopen button works
    const reopenBtn = container.querySelector('button:not([aria-label])') as HTMLButtonElement;
    expect(reopenBtn).not.toBeNull();
    expect(reopenBtn.textContent).toBe('Reopen');

    await act(async () => {
      reopenBtn.click();
    });
    expect(onReopen).toHaveBeenCalledTimes(1);

    // Verify dismiss button works
    const dismissBtn = container.querySelector(
      'button[aria-label="Dismiss meeting ended notification"]',
    ) as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();

    await act(async () => {
      dismissBtn.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders fallback reason when reason is audio_inactive_timeout', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <AutoEndToast
          reason="audio_inactive_timeout"
          appName={null}
          onReopen={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
    });

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].textContent).toBe('Meeting ended');
    expect(paragraphs[1].textContent).toBe('No audio detected');
  });
});
