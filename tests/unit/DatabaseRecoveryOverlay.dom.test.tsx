import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseRecoveryOverlay } from '../../src/components/overlays/DatabaseRecoveryOverlay';

describe('DatabaseRecoveryOverlay', () => {
  it('renders correctly when visible with lock details', () => {
    const markup = renderToStaticMarkup(
      <DatabaseRecoveryOverlay
        visible={true}
        errorCode="database_key_unavailable"
        errorMessage="macOS Keychain access was denied"
        onRetry={vi.fn()}
        onOpenDataFolder={vi.fn()}
        onQuit={vi.fn()}
      />,
    );

    expect(markup).toContain('Database Encryption Locked');
    expect(markup).toContain('Code: database_key_unavailable');
    expect(markup).toContain('macOS Keychain access was denied');
    expect(markup).toContain('Retry Keychain Access');
    expect(markup).toContain('Open Data Folder');
    expect(markup).toContain('Quit Pluto');
    expect(markup).toContain('Your data is preserved safely.');
  });

  it('renders nothing when visible is false', () => {
    const markup = renderToStaticMarkup(
      <DatabaseRecoveryOverlay
        visible={false}
        onRetry={vi.fn()}
        onOpenDataFolder={vi.fn()}
        onQuit={vi.fn()}
      />,
    );
    expect(markup).toBe('');
  });

  it('renders reset option when onResetData is provided', () => {
    const markup = renderToStaticMarkup(
      <DatabaseRecoveryOverlay
        visible={true}
        onRetry={vi.fn()}
        onOpenDataFolder={vi.fn()}
        onQuit={vi.fn()}
        onResetData={vi.fn()}
      />,
    );
    expect(markup).toContain('Reset database (permanently deletes local data)');
  });
});
