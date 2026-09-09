### Cross-language encryption contract and key custody

- **Issue:** `#781`
- **PR:** `#800`
- **Changed:** Introduced the cross-language encrypted binary envelope contract (`PENC` v1, AES-256-GCM) shared by TypeScript and native Swift runtimes, verified cross-language sealing and opening test vectors, added key custody probe verifying SafeStorage runtime availability and same-process round-trip, dynamic capture journal generation passing with single-operation scoped capabilities (`['transcribe']` or `['speakerEvidence']`), and encrypted sidecar persistence for transcript checkpoints and acceptance frames in v4 journals.
- **Why:** PR #790 revealed envelope byte mismatches between TypeScript and Swift, hardcoded capability generation values, and unencrypted transcript sidecars in v4 journals. Establishing a shared, fully tested contract is Gate 1 before landing database cipher migrations and playback refactoring.
- **Replaced:** Discrepant envelope specifications between TS and Swift, hardcoded `'gen-1'` capability generation, broad multi-operation capability grants, and plaintext transcript sidecars in schema v4 journals.
- **Notes:** Security claim verified in PR A is strictly limited to runtime availability and same-process round-trip of SafeStorage. Signed-build enforcement, cross-process isolation, and Keychain access denial handling remain unproven at this stage and are deferred to PR F.
