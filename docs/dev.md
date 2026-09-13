# Development troubleshooting

Start with the installation steps in [README.md](../README.md). Use the sections below for specific runtime or verification problems.

Internal recovery tools, including the voice candidate backfill, are documented
in [scripts/README.md](../scripts/README.md). These are developer maintenance
commands, not user-facing settings or routine setup requirements.

## 1) Parakeet transcription is unavailable

**Symptoms**

- Final validation remains retryable with a Parakeet preparation or runtime reason.
- The provisional transcript remains visible and analysis does not start.

**Fix**

Verify Apple Silicon and rebuild the signed native executable:

```bash
pnpm run build:parakeet
```

On first use, allow Pluto to download its pinned Parakeet and CTC Core ML bundles. Pluto does not reuse Hex or another application's cache.

Private quality manifests contain absolute paths only and must stay outside version control. Validate one without printing content or paths:

```bash
pnpm run benchmark:private-transcription:validate -- --manifest /absolute/private/manifest.json
```

For a dual-source live-transcript fixture, validate the guarded EOU manifest and
run the production renderer-session replay with explicit opt-in:

```bash
pnpm run benchmark:private-parakeet-eou:validate -- \
  --manifest /absolute/private/eou-manifest.json

RUN_PARAKEET_EOU_CAUSAL_REPLAY=1 \
PLUTO_PRIVATE_PARAKEET_EOU_MANIFEST=/absolute/private/eou-manifest.json \
pnpm run replay:parakeet-eou
```

Set `PLUTO_E2E_PARAKEET_LIVE_CONFIG=low-latency-2s` only to compare the
native candidate configuration in this private replay. The packaged app keeps
the pinned default unless a held-out evaluation supports a separate promotion.

The EOU report contains aggregate transport, presentation, and resource metrics
only. `crossSourceDuplicatePeak`, `crossSourceDuplicateUpdates`, and
`crossSourceDuplicateVisibleMs` measure substantial time-overlapping passages
visible under both sources during replay, including a six-unit contiguous
subspan inside a longer locally owned passage. `settledCrossSourceDuplicates`
is the strict acceptance gate after recognition finishes. Transient duplicate metrics
remain diagnostic until the evidence-settlement budget is calibrated against
annotated local interruptions and held-out recordings.
The `echoEvidence` counters report content-free detector decisions, including
activity, independent microphone energy, similarity, compatible-window support,
and retained evidence. They are comparison counts rather than speech durations.
`recognition` compares settled live words with an independent final pass using a
sequence-aware count for each source. It is a diagnostic recall signal rather
than ground truth; listening-verified annotation is still required before
tuning recognition behavior.

To replay recent local meetings and create an owner-only blind-review page, keep the output under Pluto's private application-data directory:

```bash
pnpm run benchmark:private-parakeet -- \
  --runtime /absolute/path/to/resources/bin/parakeet-runtime \
  --database /absolute/private/pluto.db \
  --model-root /absolute/private/models/transcription/parakeet \
  --audio-root /absolute/private/meetings \
  --limit 5 \
  --review-cases 24 \
  --review-out /absolute/private/evaluations/parakeet-review.html
```

The console emits aggregate metrics only. Canonical validation probes each actual source duration. Review cases are generated only from meetings whose persisted mic source is distinct from the persisted mixed artifact, whose mic and system durations align with the meeting timeline, and whose bounded excerpt contains recognized system speech. The review page contains private audio references and transcript excerpts, is written with owner-only permissions, must remain outside the repository, and exports content-free A/B ratings. Keep the adjacent hidden-assignment manifest private until the review is complete, then score the exported ratings against it:

```bash
pnpm run benchmark:private-parakeet:review -- \
  --ratings /absolute/private/parakeet-review-ratings.json \
  --manifest /absolute/private/evaluations/parakeet-review.html.manifest.json
```

To exercise the persisted service workflow without mutating the production database, run the guarded manual test with absolute local paths supplied through `PLUTO_E2E_*` environment variables. The test always creates its own process-unique user-data directory and ignores any `PLUTO_E2E_USER_DATA_DIR` value:

```bash
RUN_PARAKEET_APPLICATION_WORKFLOW=1 \
PLUTO_E2E_SOURCE_DATABASE=/absolute/private/pluto.db \
PLUTO_E2E_PARAKEET_RUNTIME=/absolute/path/to/parakeet-runtime \
PLUTO_E2E_PARAKEET_MODEL_ROOT=/absolute/private/models/transcription/parakeet \
PLUTO_E2E_AUDIO_ROOT=/absolute/private/meetings \
pnpm exec vitest run --config vitest.manual.config.ts tests/manual/parakeetApplicationWorkflow.test.ts
```

The source database and audio are read-only. All provisional, validation, canonical, and downstream writes go to the isolated database. The test compares content-free SHA-256 values internally and never prints transcript text or digest values.

## 2) Electron native module ABI mismatch (NODE_MODULE_VERSION)

**Symptoms**

- App fails to load with errors like:
  - `NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 143`
  - Often with `better-sqlite3.node`

**Root cause**

- Native modules were compiled against a different Node/Electron ABI than the runtime (Electron 40 expects ABI 143).

**Fix**

For Electron, verify the binding and rebuild only if necessary:

```bash
pnpm run ensure:sqlite-abi
```

For Node/Vitest tests that report a binding or ABI error:

```bash
pnpm rebuild better-sqlite3
```

Run `pnpm run ensure:sqlite-abi` before returning to Electron. Development startup
also runs this check automatically.

Use `pnpm run lint` and `pnpm exec vitest run` for contributor verification.
Local database/provider probes are opt-in through `pnpm run test:manual`.

## 3) Xcode Command Line Tools

**Check if installed**

```bash
xcode-select -p
xcodebuild -version
```

**Install if missing**

```bash
xcode-select --install
```

## Code Formatting with Biome

This project uses [Biome](https://biomejs.dev/) for code formatting and linting.

**Configuration**

- Biome config: `biome.json` at project root
- Biome runs as part of the pre-commit hook via Lefthook
- Pre-commit hook runs `biome check {staged_files} --write` on staged files only

**Manual Usage**

```bash
# Check for formatting issues
pnpm run check

# Auto-fix formatting issues
pnpm run fix
```

**Pre-commit Hook**

When you commit, Lefthook runs the dependency security audit and Biome checks on
staged JavaScript, TypeScript, and JSON files. Biome may write formatting fixes;
review and stage those changes before retrying the commit. See `lefthook.yml`
for the current hook configuration.
