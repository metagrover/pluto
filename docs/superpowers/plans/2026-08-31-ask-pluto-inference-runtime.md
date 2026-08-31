# Ask Pluto Inference Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent competing production Pluto processes and make local inference admission, priority, cancellation, and timing reusable by Ollama and later direct-runtime adapters.

**Architecture:** A tiny bootstrap acquires Electron's packaged single-instance lock before dynamically importing any database-owning module. Development startup always supplies a non-production user-data directory. A provider-neutral coordinator owns the existing serialized local-generation gate and content-free admission policy; Ollama becomes its first backend consumer without changing provider behavior.

**Tech Stack:** Electron, TypeScript, Vite Electron plugin, Vitest, existing serialized task gate.

---

### Task 1: Define and enforce runtime profile policy

**Files:**
- Create: `electron/appRuntimePolicy.ts`
- Create: `electron/bootstrap.ts`
- Modify: `electron/main.ts`
- Modify: `vite.config.ts`
- Test: `tests/unit/appRuntimePolicy.test.ts`
- Test: `tests/unit/appBootstrapBoundary.test.ts`

- [ ] **Step 1: Write failing policy and bootstrap-boundary tests**

Test that packaged mode requires a lock, development mode does not, an explicit `PLUTO_USER_DATA_DIR` wins, and the default development path differs from production. Read `bootstrap.ts` and assert `requestSingleInstanceLock` appears before `import('./main')`; read `vite.config.ts` and assert development startup always sends `--user-data-dir`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run tests/unit/appRuntimePolicy.test.ts tests/unit/appBootstrapBoundary.test.ts --maxWorkers=1`

Expected: FAIL because the policy and bootstrap do not exist.

- [ ] **Step 3: Implement pure runtime policy**

```ts
export const shouldAcquireProductionInstanceLock = (isPackaged: boolean) =>
  isPackaged;

export const resolveDevelopmentUserDataDir = ({ explicit, tempDir }: {
  explicit?: string;
  tempDir: string;
}) => explicit?.trim() || path.join(tempDir, 'pluto-development-profile');
```

- [ ] **Step 4: Add early bootstrap and focus behavior**

`bootstrap.ts` imports only `app` and the pure policy before locking. In packaged mode, quit immediately when lock acquisition fails; otherwise install `second-instance`, dynamically import `main.ts`, and call its exported `focusPrimaryWindow`. Change Vite's Electron entry to `electron/bootstrap.ts`.

Export from `main.ts`:

```ts
export const focusPrimaryWindow = () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
};
```

- [ ] **Step 5: Isolate development user data**

In `vite.config.ts`, resolve `PLUTO_USER_DATA_DIR` or `path.join(os.tmpdir(), 'pluto-development-profile')` and always pass it to `startup` as `--user-data-dir=...`. Production packaging does not use this Vite startup path.

- [ ] **Step 6: Run and verify GREEN, then commit**

Run: `pnpm exec vitest run tests/unit/appRuntimePolicy.test.ts tests/unit/appBootstrapBoundary.test.ts --maxWorkers=1`

```bash
git add electron/appRuntimePolicy.ts electron/bootstrap.ts electron/main.ts vite.config.ts tests/unit/appRuntimePolicy.test.ts tests/unit/appBootstrapBoundary.test.ts
git commit -m "feat: isolate Pluto runtime profiles"
```

### Task 2: Extract provider-neutral inference admission

**Files:**
- Create: `electron/llm/inferenceCoordinator.ts`
- Modify: `electron/llm/unifiedProvider.ts`
- Create: `tests/unit/inferenceCoordinator.test.ts`
- Modify: `tests/unit/unifiedProvider.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

Test the exported admission policy:

```ts
expect(getLocalInferenceAdmission('askPluto')).toEqual({ priority: 20, preemptible: false });
expect(getLocalInferenceAdmission('notesWriter')).toEqual({ priority: 10, preemptible: true });
expect(getLocalInferenceAdmission('knowledgeDoc')).toEqual({ priority: 0, preemptible: true });
```

Schedule a blocked background task then Ask Pluto; assert the background signal aborts before foreground starts. Schedule two foreground keys and assert they do not overlap. Assert the admission callback receives non-negative queue milliseconds without prompt or answer fields.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run tests/unit/inferenceCoordinator.test.ts --maxWorkers=1`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 3: Implement the coordinator seam**

Create one module-global serialized gate and export:

```ts
export const runWithLocalInferenceCoordinator = <T>({
  key, task, signal, run, onAdmitted,
}: {
  key: symbol;
  task: LocalInferenceTask;
  signal?: AbortSignal;
  run: (signal: AbortSignal) => Promise<T>;
  onAdmitted?: (metrics: { task: LocalInferenceTask; queueMs: number }) => void;
}) => Promise<T>;
```

The coordinator contains task priority/preemption policy but no Ollama URLs, model names, prompts, answers, or meeting identifiers.

- [ ] **Step 4: Route Ollama through the coordinator**

Remove the provider-local gate and policy ternary. Call the coordinator around `generateWithOllama`, invoke the existing `onStart` after admission, and emit only `{ task, queueMs }` for Ask Pluto timing. Preserve caller cancellation and resumable background preemption.

- [ ] **Step 5: Run and verify GREEN, then commit**

Run: `pnpm exec vitest run tests/unit/inferenceCoordinator.test.ts tests/unit/serializedTaskGate.test.ts tests/unit/unifiedProvider.test.ts tests/unit/meetingNotesProviderRouting.test.ts --maxWorkers=1`

```bash
git add electron/llm/inferenceCoordinator.ts electron/llm/unifiedProvider.ts tests/unit/inferenceCoordinator.test.ts tests/unit/unifiedProvider.test.ts
git commit -m "refactor: coordinate local inference centrally"
```

### Task 3: Verify lifecycle, inference, and packaging together

**Files:**
- Modify: `docs/changelog/entries/2026-08-31-699-notes-first-ask-pluto.md`

- [ ] **Step 1: Update traceability**

Add the early production lock, isolated development profile, centralized local inference admission, and content-free queue timing. State that serialized Ollama remains the selected backend and direct runtimes remain benchmark-only follow-up candidates.

- [ ] **Step 2: Run the complete focused gate**

Run all #699 unit tests with `--maxWorkers=1`, then `pnpm run lint`, `pnpm run build`, and one `ASK_PLUTO_BENCHMARK_RUNS=1` production-path benchmark to a temporary output path.

- [ ] **Step 3: Commit documentation if changed**

```bash
git add docs/changelog/entries/2026-08-31-699-notes-first-ask-pluto.md
git commit -m "docs: record Ask Pluto runtime isolation"
```
