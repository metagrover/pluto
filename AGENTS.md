# Pluto

Local-first Electron meeting assistant. React/TypeScript lives in `src/` (main
process code in `electron/`); native Swift runtimes live in `native/` and
`resources/swift/`. Python is optional benchmark tooling, not app transcription.

## Working here

- Use native agent capabilities. No bundled skills, mandatory issue workflow,
  planning ceremony, review-agent chain, or automatic PR creation is required.
- Make reasonable implementation choices and proceed within the user's scope.
  Ask when an unresolved decision materially changes the intended outcome.
- Preserve unrelated work. Keep changes focused; use a worktree when isolation
  helps. Commit, push, or publish when requested.
- Use issues, plans, and decision records when they help coordination or explain
  a lasting choice. They are not prerequisites for making a change.
- Historical plans and workflow entries in `docs/` provide context; their old
  skill requirements and approval procedures do not override this guide.
- Verify with fresh checks appropriate to the change and read their results
  before claiming success. Behavioral changes to capture, persistence,
  migrations, identity, attribution, or provenance require focused regression
  coverage unless it is infeasible; explain any omission. Report what was tested
  and any remaining limitations.
- When a change supersedes an accepted entry in `docs/decisions.md`, add a new
  entry that names the prior decision and records the replacement.

## Commands

- Install: `pnpm install`
- Run: `pnpm run dev` (prepares native runtimes automatically)
- Types: `pnpm exec tsc --noEmit`
- Tests: `pnpm exec vitest run` (append paths for focused tests)
- Lint: `pnpm run lint`
- Build native: `pnpm run build-native`
- Package: `pnpm run build`

For Node tests that use SQLite, run `pnpm rebuild better-sqlite3` if its ABI is
wrong. Run `pnpm run ensure:sqlite-abi` before returning to Electron; `pnpm run dev`
also does this. Manual/provider benchmarks are opt-in. See `docs/dev.md`.

## Product constraints

- Preserve source recordings, transcripts, provenance, and reversible user data.
- Ground notes and identities in evidence. Calendar attendees are hints; they do
  not prove speaker identity. Respect explicit confirmations and deletions.
- Diagnose the actual UI, IPC, runtime, and persistence path. Passing tests alone
  does not establish recording quality or real-world model accuracy.
- Keep private meeting data and credentials out of Git and shared output.
- Follow the existing UI patterns and keep interactions clear and calm.
