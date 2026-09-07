# Privacy-First Audio and Biometric Encryption at Rest Implementation Plan

## Issue

[#781 — Hardware-backed encryption at rest for meeting audio and biometric voice profiles](https://github.com/metagrover/pluto/issues/781)

## Spec Reference

[docs/superpowers/specs/2026-09-06-privacy-first-audio-biometric-encryption-design.md](../../superpowers/specs/2026-09-06-privacy-first-audio-biometric-encryption-design.md)

## Staged Implementation Plan

- **Phase 0 (Gate 0):** Key Custody Probe, Encrypted SQLite Backend Selection (`better-sqlite3-multiple-ciphers`), Packaging/ABI verification, Benchmark harness, and ADR.
- **Phase 1:** Dedicated Fail-Closed Key Store, Key Derivation (HKDF), Typed Database Lifecycle Errors, Resumable SQLite Database Migration, and Startup Recovery Surface.
- **Phase 2:** Versioned Encrypted Artifact Store (Envelope v1), Per-Meeting Key Hierarchy, and Encrypted Capture Journal Writes (Schema v4).
- **Phase 3:** Scoped Native Meeting Capabilities, Swift CryptoKit In-Memory Decryption, Plaintext-Free Sample Inference (`AudioInput`), and In-Memory Audio Reconstruction.
- **Phase 4:** Audio Retention Policy State Machine & Sweeper, Capability-Loss Warnings, Meeting Privacy UI Controls, and Acceptance Matrix Verification.
