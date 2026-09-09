import * as electron from 'electron';

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type KeyCustodyStorageBackend =
  | 'macos_keychain_safestorage'
  | 'injected_mock'
  | 'unsupported';

export type KeyCustodyProbeGuarantees = {
  /** True when SafeStorage or backend is present and isEncryptionAvailable() returns true */
  runtimeApiAvailable: boolean;
  /** True when a test payload is encrypted and successfully decrypted within the current process */
  sameProcessRoundtripVerified: boolean;
};

export type KeyCustodyProbeLimitations = {
  /**
   * The probe executes only within the current Node/Electron process.
   * It does NOT prove that an unsigned or differently-signed binary will be denied access by the OS.
   */
  signedBuildEnforcementProven: false;
  /**
   * The probe does NOT prove cross-process isolation (e.g. other processes running under the same UID 501).
   */
  crossProcessIsolationProven: false;
  /**
   * The probe does NOT prove key persistence across application upgrades, bundle ID changes, or reinstalls.
   */
  upgradeMigrationProven: false;
  /**
   * The probe does NOT test denial or locked-keychain error recovery behavior.
   */
  denialRecoveryProven: false;
};

export type KeyCustodyProbeResult = {
  available: boolean;
  enforceableClaim: 'runtime_availability_and_same_process_roundtrip';
  storageBackend: KeyCustodyStorageBackend;
  roundtripVerified: boolean;
  failureReason?: string;
  guarantees: KeyCustodyProbeGuarantees;
  limitations: KeyCustodyProbeLimitations;
};

const STATIC_LIMITATIONS: KeyCustodyProbeLimitations = {
  signedBuildEnforcementProven: false,
  crossProcessIsolationProven: false,
  upgradeMigrationProven: false,
  denialRecoveryProven: false,
};

/**
 * Probes the availability and basic functionality of the OS-mediated SafeStorage encryption backend.
 *
 * GUARANTEES:
 * - Verifies runtime availability: checks whether SafeStorage is present and isEncryptionAvailable() returns true.
 * - Verifies same-process round-trip: encrypts and decrypts a test payload in the current process.
 *
 * LIMITATIONS:
 * - This probe executes in a single in-process round-trip.
 * - It does NOT prove signed-build enforcement (e.g., that an unsigned binary would be denied by macOS Keychain).
 * - It does NOT prove cross-process isolation (e.g., that another process or identity cannot access the key).
 * - It does NOT prove Keychain persistence across application updates, code-signing changes, or reinstalls.
 * - It does NOT test denial or locked-keychain error handling.
 * - Signed-build enforcement and cross-process isolation remain unproven at this stage and are deferred to PR F.
 * - When an injected backend is passed (e.g., in unit tests), `storageBackend` is `'injected_mock'` and no OS Keychain APIs are invoked.
 */
export function probeKeyCustody(
  backend?: SafeStorageBackend,
): KeyCustodyProbeResult {
  const isInjected = backend !== undefined;
  let fromElectron: SafeStorageBackend | undefined;
  try {
    fromElectron = (electron as Record<string, unknown>).safeStorage as
      | SafeStorageBackend
      | undefined;
  } catch {
    fromElectron = undefined;
  }
  const effectiveBackend = backend ?? fromElectron;
  const targetBackend: KeyCustodyStorageBackend = isInjected
    ? 'injected_mock'
    : process.platform === 'darwin'
      ? 'macos_keychain_safestorage'
      : 'unsupported';

  if (
    !effectiveBackend ||
    typeof effectiveBackend.isEncryptionAvailable !== 'function'
  ) {
    return {
      available: false,
      enforceableClaim: 'runtime_availability_and_same_process_roundtrip',
      storageBackend: 'unsupported',
      roundtripVerified: false,
      failureReason: 'SafeStorage backend not present',
      guarantees: {
        runtimeApiAvailable: false,
        sameProcessRoundtripVerified: false,
      },
      limitations: STATIC_LIMITATIONS,
    };
  }

  try {
    const isAvailable = effectiveBackend.isEncryptionAvailable();
    if (!isAvailable) {
      return {
        available: false,
        enforceableClaim: 'runtime_availability_and_same_process_roundtrip',
        storageBackend: targetBackend,
        roundtripVerified: false,
        failureReason: 'SafeStorage reports encryption unavailable',
        guarantees: {
          runtimeApiAvailable: false,
          sameProcessRoundtripVerified: false,
        },
        limitations: STATIC_LIMITATIONS,
      };
    }

    const testPayload = 'pluto-key-custody-probe-check';
    const encrypted = effectiveBackend.encryptString(testPayload);
    const decrypted = effectiveBackend.decryptString(encrypted);
    if (decrypted !== testPayload) {
      return {
        available: false,
        enforceableClaim: 'runtime_availability_and_same_process_roundtrip',
        storageBackend: targetBackend,
        roundtripVerified: false,
        failureReason: 'Decrypted payload mismatch',
        guarantees: {
          runtimeApiAvailable: true,
          sameProcessRoundtripVerified: false,
        },
        limitations: STATIC_LIMITATIONS,
      };
    }

    return {
      available: true,
      enforceableClaim: 'runtime_availability_and_same_process_roundtrip',
      storageBackend: targetBackend,
      roundtripVerified: true,
      guarantees: {
        runtimeApiAvailable: true,
        sameProcessRoundtripVerified: true,
      },
      limitations: STATIC_LIMITATIONS,
    };
  } catch (error) {
    return {
      available: false,
      enforceableClaim: 'runtime_availability_and_same_process_roundtrip',
      storageBackend: targetBackend,
      roundtripVerified: false,
      failureReason: error instanceof Error ? error.message : String(error),
      guarantees: {
        runtimeApiAvailable: true,
        sameProcessRoundtripVerified: false,
      },
      limitations: STATIC_LIMITATIONS,
    };
  }
}
