# Update reliability: separate public-launch blocker

Status: candidate CI and standard-profile acceptance passed; encrypted-profile acceptance awaits macOS Keychain consent. Keep this launch blocker open until that check completes.

## Contract

A repeat update click joins the current attempt. The main process owns progress across native menu, Settings, and sidebar. Download and checksum/signature validation complete before quit. A new recording cannot start during an update. The installer must observe the original process exit before replacing its app; a blocked quit fails within 15 seconds of approved handoff, preserves the running app, and allows retry. Manual quit before handoff approval cancels installation without reopening the app unexpectedly.

Failures identify the stage and retain the existing local update log. Startup confirms the installed version before reporting completion. Meeting/profile/model paths are preserved. Replacement safety checks and rollback remain in the existing installer.

## Implemented

- Single-flight admission and shared progress, including a visible failure/retry state and version-confirmed success.
- Prepare/download/verify while Pluto remains open, then approved quit and bounded parent-exit wait before replacement.
- Failure result consumed by the still-running app after blocked quit, or by the reopened app after installation failure.
- Installer process checks scoped to the destination app, preserving the bridge exception and preventing unrelated Pluto copies from blocking an isolated upgrade.
- Regression tests for repeated clicks across mounted controls, failed helper exit, blocked quit and retry, and wrong-version relaunch.
- Packaged end-to-end acceptance added to the installer workflow.

## Evidence and limits

`node scripts/verify_update_flow.mjs /tmp/pluto-update-flow.json` creates two ad-hoc-signed, packaged Electron fixture versions in temporary installation directories. They execute the production UpdateChecker, IPC, quit handler, detached worker, and installer. Tests use real DMG mounting, checksum/signature checks, app replacement, LaunchServices reopen, and installed-version confirmation. They exercise normal upgrade, repeated clicks, blocked quit followed by retry, and checksum rejection followed by retry, and renderer unload veto resolved by the production quit deadline. Fictional profile sentinel bytes survive every case.

Only release HTTP responses/download transport and TCC resets are substituted. No installed user app, real permissions, microphone, or production database is touched. This is updater lifecycle acceptance, not a claim that the fixture runs the entire Pluto application bootstrap or database migrations.

Validation: all 6,511 Vitest tests and 518 suites passed on candidate `be0946b4a55d737b84a672ee86321c36cfee4f1c`; focused updater/UI/ownership tests, TypeScript, lint, and installer rollback tests passed. [Installer CI](https://github.com/metagrover/pluto/actions/runs/38283942771) passed the packaged updater scenarios, native runtime build, DMG build, and package verification. The real published rc.18 download also passes `install-macos.sh --verify-only`, including checksum, app identity, version, and signature checks.

## Full-app acceptance on macOS 26.5.2 / Apple Silicon

The October 12 check used disposable installation directories and fictional test profiles. Published rc.11 and rc.17 DMGs and the exact candidate CI DMG passed their checksums and signatures. Application bundles were not modified or re-signed.

- Published rc.11's real in-app update downloaded and installed published rc.18. Its older updater omitted the selected profile on relaunch and opened the default profile. That app was immediately closed without interacting with its meetings. Explicitly reopening the test profile applied both pending migrations. **Do not use rc.11's in-app updater for a custom profile; use the installer with an explicit `--user-data-dir` instead.** New code cannot retroactively repair that old updater.
- Published rc.17's in-app updater installed the exact candidate and automatically reopened the selected test profile. Only the candidate DMG/checksum download transport was redirected to the downloaded CI artifact, because this candidate is unpublished and still has version rc.18. Release discovery, the full application, worker, installer, signature checks, replacement, permission reset, and LaunchServices relaunch were real. The installed ASAR hash matched the CI candidate.
- Every seeded meeting column survived exactly, including fictional transcript, user notes, generated notes, favorite flag, timestamps, and original audio path. All baseline settings were unchanged. The original audio hash and all 63 verified model-file hashes matched. The full app reused the model cache.
- A separate copy of the saved rc.11 database was opened directly by the exact candidate: 18 migrations became 20. Meeting values remained identical; SQLite integrity and foreign-key checks passed. The standard upgraded profile passed the same checks.
- The real installer reset Pluto's macOS permissions after the ad-hoc signature changed. The first recording attempt encountered blocked microphone access and displayed the recovery dialog. Refreshing the existing microphone grant in System Settings and restarting the selected profile restored recording: the full candidate showed healthy microphone and system audio, then finished a brief recording normally. Permission recovery can require this user action; a successful installer reset alone does not prove recording readiness.
- Encrypted-profile acceptance is pending the user's macOS Keychain prompt. No key material or production meeting data belongs in this report or the PR.

Local detailed evidence is in `/tmp/pluto-full-upgrade/acceptance.json` and the adjacent test snapshots. These are disposable local evidence, not repository fixtures. No release was published.

## Public launch gate

Keep this blocker separate from recording shutdown. Close it after the exact candidate installer CI is green and a candidate upgrade between full Pluto releases has been exercised on an installed test profile, including startup/migration, retained meetings/settings/models, and macOS permission behavior. The first release containing these changes cannot retroactively replace the updater bundled inside older installed builds; users whose old updater is stuck may require the existing manual installer once.

The legacy rc.11 relaunch unexpectedly opened the default profile as described above; no production-data edits were performed. The user authorized the account-wide, Pluto-only permission reset. Public release publication is outside this verification task.
