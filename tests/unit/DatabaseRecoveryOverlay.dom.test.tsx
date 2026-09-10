// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseRecoveryOverlay } from '../../src/components/overlays/DatabaseRecoveryOverlay';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('DatabaseRecoveryOverlay', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('renders nothing when visible is false', () => {
    act(() => {
      const root = createRoot(container);
      root.render(
        <DatabaseRecoveryOverlay
          visible={false}
          onRetry={vi.fn()}
          onOpenDataFolder={vi.fn()}
          onQuit={vi.fn()}
        />,
      );
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders locked state when visible with key unavailable error', () => {
    act(() => {
      const root = createRoot(container);
      root.render(
        <DatabaseRecoveryOverlay
          visible={true}
          errorCode="database_key_unavailable"
          errorMessage="Pluto could not access the encryption key."
          onRetry={vi.fn()}
          onOpenDataFolder={vi.fn()}
          onQuit={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('Database Encryption Locked');
    expect(container.textContent).toContain('Code: database_key_unavailable');
    expect(container.textContent).toContain(
      'Pluto could not access the encryption key.',
    );
    expect(container.textContent).toContain('Retry Keychain Access');
    expect(container.textContent).toContain('Open Data Folder');
    expect(container.textContent).toContain('Quit Pluto');
  });

  it('triggers onRetry when clicking retry button', () => {
    const onRetry = vi.fn();
    act(() => {
      const root = createRoot(container);
      root.render(
        <DatabaseRecoveryOverlay
          visible={true}
          onRetry={onRetry}
          onOpenDataFolder={vi.fn()}
          onQuit={vi.fn()}
        />,
      );
    });

    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Retry Keychain Access'),
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
