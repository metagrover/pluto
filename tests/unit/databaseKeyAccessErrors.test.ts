import { describe, expect, it } from 'vitest';
import {
  DatabaseLifecycleError,
  describeDatabaseStartupError,
} from '../../electron/database/errors';

describe('database key recovery messages', () => {
  it.each([
    ['keychain_unavailable', 'Unlock the login Keychain'],
    ['keychain_decrypt_failed', 'could not decrypt the existing database key'],
    ['envelope_unreadable', 'saved database key envelope'],
    ['missing_envelope', 'key envelope is missing'],
  ] as const)('explains %s without leaking its cause', (stage, guidance) => {
    const error = new DatabaseLifecycleError(
      'database_key_unavailable',
      'private cause',
      { keyAccessStage: stage },
      { cause: new Error('private cause') },
    );
    const message = describeDatabaseStartupError(error);

    expect(message).toContain(guidance);
    expect(message).not.toContain('private cause');
  });
});
