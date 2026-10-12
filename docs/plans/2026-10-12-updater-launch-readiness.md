# Update reliability: separate public-launch blocker

Status: implementation and local verification complete; PR installer CI and release-candidate acceptance tracked separately from recording shutdown.

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

Local validation: all 6,510 Vitest tests passed; focused updater/UI/ownership tests, TypeScript, lint, and installer rollback tests passed. The real published rc.18 download also passes `install-macos.sh --verify-only`, including checksum, app identity, version, and signature checks.

## Public launch gate

Keep this blocker separate from recording shutdown. Close it after the exact candidate installer CI is green and a candidate upgrade between full Pluto releases has been exercised on an installed test profile, including startup/migration, retained meetings/settings/models, and macOS permission behavior. The first release containing these changes cannot retroactively replace the updater bundled inside older installed builds; users whose old updater is stuck may require the existing manual installer once.

No public release or modification of the user's production profile is part of this PR.
