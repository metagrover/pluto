# Renderer Runtime Platform Design

**Issue:** [#536](https://github.com/metagrover/pluto/issues/536)

**Status:** Approved direction; awaiting written-spec review

## Outcome

Pluto's Electron renderer and browser QA mount without relying on Node globals, while transcription capability checks still receive truthful platform and architecture evidence. Apple-Silicon-only capability fails closed when architecture is unknown.

## Root Cause

`src/utils/transcriptionBackendConfig.ts` reads `process.platform` and `process.arch` at module evaluation. The module is imported through renderer recording-finalization code, but Electron intentionally runs that renderer with context isolation and without Node integration. `process` is therefore undefined before React mounts, leaving an empty white window.

The main process continues running and may emit unrelated background synthesis errors, but those happen after the renderer-root failure and are not its cause.

## Runtime Descriptor Contract

Add one content-free immutable descriptor:

```ts
type PlutoRuntimePlatform = {
  platform: "darwin" | "linux" | "win32" | "unknown";
  arch: "arm64" | "x64" | "unknown";
};
```

Electron preload exposes `window.plutoRuntimePlatform` using its own trusted `process.platform` and `process.arch`. It exposes no environment variables, paths, Node methods, or mutable API.

Browser QA installs a descriptor through the existing fallback bootstrap. It may map a clearly identified browser OS to `darwin`, `linux`, or `win32`, but architecture remains `unknown` unless the browser provides explicit reliable evidence. It must not infer Apple Silicon from `MacIntel` or a generic macOS user agent.

## Capability Resolution

Remove module-scope reads of `process`. `getTranscriptionCapabilities`, `resolveBackendOptions`, and `listTranscriptionBackends` accept an optional runtime descriptor. When omitted, a resolver checks boundaries in this order:

1. `window.plutoRuntimePlatform` when available;
2. guarded Node `process.platform/process.arch` for main-process and test callers;
3. `{ platform: "unknown", arch: "unknown" }`.

The guard uses `typeof window` and `typeof process`; neither global is dereferenced before its existence is proven. Runtime resolution happens when a capability function is called, not when the module is evaluated. Browser fallback installation in `src/main.tsx` therefore occurs before React invokes capability consumers even though `App` imports them earlier.

`local_alt_apple_silicon` remains available only for `{ platform: "darwin", arch: "arm64" }`. Unknown or partial evidence returns the existing unavailable result. CUDA hints remain limited to explicit Linux or Windows evidence.

## Failure and Security Semantics

- Missing preload descriptor does not crash; capabilities fail closed.
- Unknown architecture never claims Apple Silicon support.
- An unexpected platform/architecture string is normalized to `unknown` before exposure or use.
- The descriptor is frozen in preload and browser fallback so renderer code cannot mutate capability identity.
- Node integration remains disabled; no generic `process` bridge is introduced.
- No user, meeting, transcript, credential, path, hostname, or machine identifier enters the descriptor.

## Testing

Focused tests will prove:

- the shared module evaluates when both `window` and `process` are absent;
- explicit Darwin/arm64 enables the Apple Silicon candidate;
- unknown architecture on macOS fails closed;
- Linux/Windows device hints remain unchanged;
- omitted runtime uses guarded Node evidence in Node tests;
- preload source exposes only the normalized frozen descriptor alongside the existing IPC bridge;
- browser fallback installs an unknown-architecture descriptor before React render;
- renderer/browser startup produces a non-empty `#root` and no `process is not defined` exception.

Repository verification includes focused tests, `pnpm run lint`, `pnpm run test -- --run`, `pnpm run changelog:check`, `pnpm run audit:high`, browser/Electron startup QA, and `git diff --check`.

## Out of Scope

- re-enabling Node integration;
- exposing environment variables or arbitrary Node APIs;
- changing transcription models, presets, or quality policy;
- detecting Apple Silicon from ambiguous browser user-agent data;
- fixing unrelated Knowledge synthesis data-shape errors;
- broader renderer error-boundary or startup redesign.
