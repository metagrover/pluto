# Zoom Call Lifecycle Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress false Zoom call alerts and add privacy-safe evidence for diagnosing why confirmed calls do not arm auto-end.

**Architecture:** Put alert eligibility in a small pure policy module consumed by the React hook. Put auto-end observation deduplication in a second pure module, while retaining the existing detector and auto-end state-machine semantics.

**Tech Stack:** TypeScript, React hooks, Electron IPC, Vitest, Biome

---

### Task 1: Enforce high-confidence alert eligibility

**Files:**
- Create: `src/activeCall/alertDecision.ts`
- Create: `tests/unit/activeCallAlertDecision.test.ts`
- Modify: `src/hooks/useActiveCallMonitor.ts`

- [ ] **Step 1: Write the failing alert-policy tests**

Create tests that call `isAlertEligible` with active Zoom results:

```ts
expect(
  isAlertEligible({
    active: true,
    appName: 'Zoom',
    confidence: 'medium',
  }),
).toBe(false);

expect(
  isAlertEligible({
    active: true,
    appName: 'Zoom',
    confidence: 'high',
  }),
).toBe(true);
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/activeCallAlertDecision.test.ts
```

Expected: fail because `src/activeCall/alertDecision.ts` does not exist.

- [ ] **Step 3: Implement the minimal policy**

Create:

```ts
export type AlertCallObservation = {
  active: boolean;
  appName: string | null;
  confidence: 'low' | 'medium' | 'high';
};

export const isAlertEligible = ({
  active,
  appName,
  confidence,
}: AlertCallObservation): boolean =>
  active && Boolean(appName) && confidence === 'high';
```

Replace the hook's `Boolean(result?.active) && Boolean(appName)` eligibility
check with `isAlertEligible({ active: Boolean(result?.active), appName, confidence })`.
Keep the existing baseline, cooldown, and transition logic.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/activeCallAlertDecision.test.ts tests/unit/activeCallDetector.test.ts
```

Expected: both files pass.

- [ ] **Step 5: Commit the alert fix**

```bash
git add src/activeCall/alertDecision.ts src/hooks/useActiveCallMonitor.ts tests/unit/activeCallAlertDecision.test.ts
git commit -m "fix: require confirmed audio for call alerts"
```

### Task 2: Record deduplicated auto-end observations

**Files:**
- Create: `src/autoEnd/observation.ts`
- Create: `tests/unit/autoEndObservation.test.ts`
- Modify: `src/hooks/useAutoEndMonitor.ts`

- [ ] **Step 1: Write the failing observation tests**

Cover these inputs:

```ts
const high = {
  active: true,
  appName: 'Zoom',
  confidence: 'high' as const,
  reason: 'call-app-running-with-active-audio',
};

expect(toObservationEvent(null, high)).toEqual({
  signature: 'Zoom|high|call-app-running-with-active-audio',
  reasonCode: 'call_observation_high',
  appName: 'Zoom',
});
expect(
  toObservationEvent(
    'Zoom|high|call-app-running-with-active-audio',
    high,
  ),
).toBeNull();
```

Also assert that medium and low confidence map to
`call_observation_medium` and `call_observation_low`.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/autoEndObservation.test.ts
```

Expected: fail because `src/autoEnd/observation.ts` does not exist.

- [ ] **Step 3: Implement transition mapping**

Create a pure `toObservationEvent(previousSignature, poll)` function. Its
signature is `${appName ?? ''}|${confidence}|${reason}`. Return `null` when it
matches the previous signature; otherwise return the signature, app name, and
`call_observation_${confidence}` reason code.

- [ ] **Step 4: Wire diagnostics into the monitor**

Add `lastObservationSignatureRef`. After normalizing the detector result, call
`toObservationEvent`. On a returned event, update the ref and invoke
`LOG_AUTO_END_EVENT` with `reason_code` and `app_name`. Reset the signature when
the monitor is disabled or recording stops. Do not alter `autoEndDecision`.

- [ ] **Step 5: Run lifecycle tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/autoEndObservation.test.ts tests/unit/autoEndDecision.test.ts tests/unit/nativeAudioCapture.test.ts tests/unit/activeCallDetector.test.ts
```

Expected: all files pass.

- [ ] **Step 6: Commit the diagnostics**

```bash
git add src/autoEnd/observation.ts src/hooks/useAutoEndMonitor.ts tests/unit/autoEndObservation.test.ts
git commit -m "chore: log auto-end call observations"
```

### Task 3: Record delivery and verify

**Files:**
- Create: `docs/changelog/entries/2026-07-30-554-zoom-call-lifecycle-confidence.md`

- [ ] **Step 1: Add the changelog fragment**

Include all required fields: Issue, PR, Changed, Why, Replaced, and Notes.
Set the PR field to `Pending` until the pull request exists.

- [ ] **Step 2: Run focused formatting and validation**

```bash
pnpm exec biome check src/activeCall/alertDecision.ts src/autoEnd/observation.ts src/hooks/useActiveCallMonitor.ts src/hooks/useAutoEndMonitor.ts tests/unit/activeCallAlertDecision.test.ts tests/unit/autoEndObservation.test.ts
pnpm run changelog:check
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm run test -- --run
```

Expected: zero failed tests.

- [ ] **Step 4: Commit the durable record**

```bash
git add docs/changelog/entries/2026-07-30-554-zoom-call-lifecycle-confidence.md docs/superpowers/plans/2026-07-30-zoom-call-lifecycle-confidence.md
git commit -m "docs: record Zoom call lifecycle fix"
```

- [ ] **Step 5: Review the final diff**

```bash
git status --short
git diff --check origin/master...HEAD
git diff --stat origin/master...HEAD
```

Expected: a clean worktree and changes limited to the spec, plan, policy helpers,
the two hooks, focused tests, and changelog fragment.
