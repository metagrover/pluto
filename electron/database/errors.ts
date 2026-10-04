export type DatabaseErrorCode =
  | 'database_path_invalid'
  | 'database_directory_unavailable'
  | 'database_open_failed'
  | 'database_configuration_failed'
  | 'database_version_unsupported'
  | 'database_migration_failed'
  | 'database_integrity_failed'
  | 'database_replacement_failed'
  | 'database_cleanup_failed'
  | 'database_closed'
  | 'database_key_unavailable'
  | 'database_setup_key_unavailable'
  | 'database_key_identity_mismatch'
  | 'database_key_rejected'
  | 'database_cipher_unsupported'
  | 'database_encryption_migration_failed'
  | 'database_restore_failed';

export interface DatabaseErrorDetails {
  migrationId?: string;
  sqliteCode?: string;
}

export class DatabaseLifecycleError extends Error {
  constructor(
    readonly code: DatabaseErrorCode,
    message: string,
    readonly details: DatabaseErrorDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DatabaseLifecycleError';
  }
}

const safeIdentifier = (value: string | undefined) =>
  value && /^[A-Za-z0-9_.-]+$/.test(value) ? value : undefined;

export const describeDatabaseStartupError = (error: unknown): string => {
  if (!(error instanceof DatabaseLifecycleError)) {
    return 'Database startup failed.';
  }

  const migrationId = safeIdentifier(error.details.migrationId);
  const sqliteCode = safeIdentifier(error.details.sqliteCode);
  switch (error.code) {
    case 'database_path_invalid':
      return 'Database path is invalid.';
    case 'database_directory_unavailable':
      return 'Database directory is unavailable.';
    case 'database_open_failed':
      return 'Database could not be opened.';
    case 'database_configuration_failed':
      return 'Database configuration failed.';
    case 'database_version_unsupported':
      return 'Database version is not supported by this Pluto build.';
    case 'database_migration_failed': {
      const migration = migrationId ? ` ${migrationId}` : '';
      const code = sqliteCode ? ` (${sqliteCode})` : '';
      return `Database migration${migration} failed${code}.`;
    }
    case 'database_integrity_failed':
      return 'Database integrity verification failed.';
    case 'database_replacement_failed':
      return 'Database replacement failed.';
    case 'database_cleanup_failed':
      return 'Database replacement cleanup failed.';
    case 'database_closed':
      return 'Database is closed.';
    case 'database_key_unavailable':
      return 'Database encryption key is unavailable or locked in macOS Keychain.';
    case 'database_setup_key_unavailable':
      return 'Encrypted setup could not obtain key-storage permission. No database was created. Choose setup again to retry encryption or use Standard setup.';
    case 'database_key_identity_mismatch':
      return 'Database encryption key belongs to a legacy or differently signed application identity. Pluto stopped before requesting Keychain access.';
    case 'database_key_rejected':
      return 'Database encryption key was rejected or database is corrupted.';
    case 'database_cipher_unsupported':
      return 'SQLite cipher configuration is not supported by this runtime.';
    case 'database_encryption_migration_failed':
      return 'Database encryption migration failed.';
    case 'database_restore_failed':
      return 'Authoritative database restore from backup failed.';
  }
};
