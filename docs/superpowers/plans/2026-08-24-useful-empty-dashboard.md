# Useful Empty Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pluto's empty homepage compact and useful while preventing background dashboard refreshes from flashing visible status copy.

**Architecture:** Preserve `dashboardModel.ts` as the source of truth and change only the refresh lifecycle and renderer composition. `useDashboardHome` will distinguish initial loading from background refreshing while retaining the last resolved model; `Dashboard.tsx` will render one caught-up state, expose suggested commitments when they are the best next action, and select the strongest available supporting context without reserving empty regions.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, React server rendering tests, Electron

---

## File map

- Modify `src/components/features/useDashboardHome.ts`: represent initial loading and background refreshing separately while preserving concurrent refresh coordination.
- Modify `tests/unit/useDashboardHome.test.ts`: prove refresh phase transitions and resolved-model preservation through pure state transitions.
- Modify `src/components/features/Dashboard.tsx`: implement the revised hierarchy, caught-up state, visible suggestion queue, conditional supporting context, and initial skeleton.
- Modify `tests/unit/Dashboard.test.tsx`: lock the visible empty, suggestion, win, latest-meeting fallback, initial-loading, and background-refresh behavior.
- Modify `docs/decisions.md`: record the durable product and lifecycle decision.
- Create `docs/changelog/entries/2026-08-24-658-useful-empty-dashboard.md`: record what shipped and why.

### Task 1: Separate initial loading from background refresh

**Files:**
- Modify: `src/components/features/useDashboardHome.ts:26-31,176-249`
- Test: `tests/unit/useDashboardHome.test.ts`

- [ ] **Step 1: Write the failing refresh-state tests**

Add `transitionDashboardRefreshState` to the imports and add tests that exercise the exact lifecycle without requiring a browser renderer:

```ts
import {
  createDashboardRefreshCoordinator,
  loadDashboardHomeData,
  transitionDashboardRefreshState,
} from '../../src/components/features/useDashboardHome';

describe('transitionDashboardRefreshState', () => {
  it('uses blocking loading only before the first resolved model', () => {
    expect(
      transitionDashboardRefreshState('start', {
        hasResolvedData: false,
      }),
    ).toEqual({ loading: true, refreshing: false });
  });

  it('keeps resolved content visible during background refreshes', () => {
    expect(
      transitionDashboardRefreshState('start', {
        hasResolvedData: true,
      }),
    ).toEqual({ loading: false, refreshing: true });
    expect(
      transitionDashboardRefreshState('settle', {
        hasResolvedData: true,
      }),
    ).toEqual({ loading: false, refreshing: false });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing transition fails**

Run:

```bash
pnpm exec vitest run tests/unit/useDashboardHome.test.ts
```

Expected: FAIL because `transitionDashboardRefreshState` is not exported.

- [ ] **Step 3: Implement explicit refresh phases**

In `useDashboardHome.ts`, extend the public state and add the pure transition:

```ts
export interface DashboardHomeState {
  model: DashboardHomeModel;
  loading: boolean;
  refreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

interface DashboardRefreshContext {
  hasResolvedData: boolean;
}

export const transitionDashboardRefreshState = (
  event: 'start' | 'settle',
  context: DashboardRefreshContext,
): Pick<DashboardHomeState, 'loading' | 'refreshing'> =>
  event === 'start'
    ? {
        loading: !context.hasResolvedData,
        refreshing: context.hasResolvedData,
      }
    : { loading: false, refreshing: false };
```

Use a private `hasResolvedData` field in the hook state, set it to `true` only after `loadDashboardHomeData` succeeds, and compute `loading` and `refreshing` through the transition helper. Preserve `previous.model` on refresh start and failure. The initial state is:

```ts
const [state, setState] = useState<DashboardHomeState & {
  hasResolvedData: boolean;
}>(() => ({
  model: buildEmptyDashboardHomeModel({ isRecording, meetings }),
  loading: true,
  refreshing: false,
  hasResolvedData: false,
  error: null,
  refresh: async () => {},
}));
```

At refresh start, set:

```ts
setState((previous) => ({
  ...previous,
  ...transitionDashboardRefreshState('start', previous),
  error: null,
  refresh,
}));
```

On success, set `hasResolvedData: true`, `loading: false`, and `refreshing: false`. On failure, preserve `hasResolvedData` and the previous model while applying the settled transition. Remove the separate effect-level state update that unconditionally assigns `loading: true`. Return the public fields without exposing `hasResolvedData`:

```ts
return {
  model: state.model,
  loading: state.loading,
  refreshing: state.refreshing,
  error: state.error,
  refresh: state.refresh,
};
```

- [ ] **Step 4: Run the focused hook tests**

Run:

```bash
pnpm exec vitest run tests/unit/useDashboardHome.test.ts
```

Expected: PASS, including the coordinator tests and new phase-transition tests.

- [ ] **Step 5: Commit the refresh lifecycle**

```bash
git add src/components/features/useDashboardHome.ts tests/unit/useDashboardHome.test.ts
git commit -m "fix: keep dashboard stable during refresh (#658)"
```

### Task 2: Compose a useful caught-up dashboard

**Files:**
- Modify: `src/components/features/Dashboard.tsx:1-10,27-31,350-710`
- Test: `tests/unit/Dashboard.test.tsx`

- [ ] **Step 1: Replace old empty-state expectations with failing design-contract tests**

Add or update focused cases so the renderer contract is explicit:

```tsx
const renderDashboard = (
  model: DashboardHomeModel,
  options: { loading?: boolean } = {},
) =>
  renderToStaticMarkup(
    <Dashboard
      model={model}
      loading={options.loading ?? false}
      isRecording={false}
      setSelectedMeetingId={vi.fn()}
      setActiveTab={vi.fn()}
      updatingTaskIds={new Set()}
      actionError={null}
      handleCompleteTask={vi.fn(async () => {})}
      handleReviewCommitment={vi.fn(async () => {})}
      handleUpdateAttentionStatus={vi.fn(async () => {})}
    />,
  );

const makeEmptyDashboardModel = () =>
  buildDashboardHomeModel({
    isRecording: false,
    meetings: [],
    overdueActions: [],
    staleActions: [],
    activeActions: [],
    attentionAlerts: [],
    workspace: null,
    graphStats: null,
  });

const makeMeetingWithSupportedWin = (): Meeting =>
  makeMeeting({
    analysis_json: JSON.stringify({
      overview: 'The launch review closed a meaningful open question.',
      recent_win: {
        win: 'Privacy review is ready to close',
        why_it_counts: 'The team resolved the final approval question.',
        source: 'Launch Review',
      },
    }),
  });

it('renders one caught-up state and promotes suggested commitments', () => {
  const model = buildDashboardHomeModel({
    isRecording: false,
    meetings: [makeMeeting()],
    overdueActions: [],
    staleActions: [],
    activeActions: [
      makeAction({
        id: 'suggestion-1',
        name: 'Send the revised launch brief',
        metadata: JSON.stringify({
          commitment_state: 'possible',
          source_meeting_id: 'meeting-1',
        }),
      }),
    ],
    attentionAlerts: [],
    workspace: null,
    graphStats: null,
  });

  const markup = renderDashboard(model);

  expect(markup).toContain("You're caught up");
  expect(markup).toContain('No blockers or confirmed commitments need attention right now.');
  expect(markup).toContain('Review 1 suggestion');
  expect(markup).toContain('Suggested commitments');
  expect(markup).toContain('Send the revised launch brief');
  expect(markup).toContain('Confirm task');
  expect(markup).not.toContain('Nothing needs your attention.');
  expect(markup).not.toContain('No recent win surfaced yet');
});

it('uses the latest meeting when no recent win is supported', () => {
  const model = buildDashboardHomeModel({
    isRecording: false,
    meetings: [makeMeeting({ title: 'Launch Review' })],
    overdueActions: [],
    staleActions: [],
    activeActions: [],
    attentionAlerts: [],
    workspace: null,
    graphStats: null,
  });

  const markup = renderDashboard(model);

  expect(markup).toContain('Continue where you left off');
  expect(markup).toContain('Launch Review');
  expect(markup).not.toContain('Recent win');
});

it('keeps a supported recent win instead of the latest-meeting fallback', () => {
  const model = buildDashboardHomeModel({
    isRecording: false,
    meetings: [makeMeetingWithSupportedWin()],
    overdueActions: [],
    staleActions: [],
    activeActions: [],
    attentionAlerts: [],
    workspace: null,
    graphStats: null,
  });

  const markup = renderDashboard(model);

  expect(markup).toContain('Recent win');
  expect(markup).not.toContain('Continue where you left off');
});

it('renders stable skeleton geometry only for initial loading', () => {
  const markup = renderDashboard(makeEmptyDashboardModel(), { loading: true });

  expect(markup).toContain('data-testid="dashboard-initial-loading"');
  expect(markup).not.toContain('Refreshing');
  expect(markup).not.toContain("You're caught up");
});

it('never replaces resolved attention copy with a refresh label', () => {
  const markup = renderDashboard(makeEmptyDashboardModel(), { loading: false });

  expect(markup).toContain("You're caught up");
  expect(markup).not.toContain('Refreshing');
});
```

Place these helpers beside the existing `makeMeeting`, `makeAction`, and workspace fixtures. Import `DashboardHomeModel` as a type from `dashboardModel.ts`.

- [ ] **Step 2: Run the focused component tests and verify the old composition fails**

Run:

```bash
pnpm exec vitest run tests/unit/Dashboard.test.tsx
```

Expected: FAIL on the new caught-up copy, visible suggestion heading, conditional supporting context, and initial-loading skeleton.

- [ ] **Step 3: Implement the initial loading surface**

Import `CheckCircle2` from `lucide-react`. Before the resolved dashboard return, render a stable skeleton when `loading` is true:

```tsx
if (loading) {
  return (
    <main
      data-testid="dashboard-initial-loading"
      aria-busy="true"
      aria-label="Loading daily briefing"
      className="relative mx-auto w-full max-w-[1080px] pb-16"
    >
      <section className="border-b border-pro-border/70 pb-6">
        <div className="h-3 w-24 rounded bg-pro-surface" />
        <div className="mt-3 h-8 w-48 rounded bg-pro-surface" />
        <div className="mt-7 h-20 rounded-xl bg-pro-surface/70 motion-reduce:animate-none" />
      </section>
      <div className="grid gap-8 pt-7 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <div className="space-y-3">
          <div className="h-7 w-44 rounded bg-pro-surface" />
          <div className="h-16 rounded-lg bg-pro-surface/70" />
          <div className="h-16 rounded-lg bg-pro-surface/70" />
        </div>
        <div className="h-44 rounded-xl bg-pro-surface/70" />
      </div>
    </main>
  );
}
```

Do not add a pulse animation. Geometry conveys initial loading without creating motion or a new flashing state.

- [ ] **Step 4: Recompose the briefing and empty state**

Set the page width to `max-w-[1080px]` and remove the detached summary chip. Keep recording status as a contextual inline label. In the empty Top of mind branch, render:

```tsx
<div className="lg:col-span-3 border-t border-pro-border/70 py-6">
  <div className="flex items-start gap-3">
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pro-success/10 text-pro-success">
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <h2 className="text-[17px] font-semibold leading-6 text-pro-text-main">
        You're caught up
      </h2>
      <p className="mt-1 max-w-[64ch] text-[13px] font-medium leading-[1.6] text-pro-text-muted">
        No blockers or confirmed commitments need attention right now.
      </p>
      {model.commitments.needsConfirmation.length > 0 ? (
        <a
          href="#suggested-commitments"
          className="mt-3 inline-flex min-h-8 items-center gap-1 text-[12px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
        >
          Review {model.commitments.needsConfirmation.length}{' '}
          {model.commitments.needsConfirmation.length === 1
            ? 'suggestion'
            : 'suggestions'}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  </div>
</div>
```

This is the only caught-up message on the page.

- [ ] **Step 5: Promote suggestions and conditionally render support**

When `commitmentItems.length === 0` and `needsConfirmation.length > 0`, render the existing review rows directly under a heading with `id="suggested-commitments"` instead of rendering the empty commitment paragraph plus collapsed `details`. Keep the same `getDashboardReviewActions` wiring, no-source disclosure, status label, disabled state, focus styling, and exact action IDs.

When confirmed commitments exist, retain the collapsed suggestion disclosure below them.

Replace the fixed empty Recent win panel with this fallback order. Keep the existing supported-win markup inline for the first branch, including `Open moment`, `Celebrate`, source copy, reduced-motion celebration behavior, and focus styles:

```tsx
{recentWin.state === 'populated' ? (
  <section aria-labelledby="recent-win-title">
    <p className="text-[10px] font-semibold text-pro-text-muted/60">
      Evidence-backed
    </p>
    <h2 id="recent-win-title" className="mt-1 text-[20px] font-serif font-medium text-pro-text-main">
      Recent win
    </h2>
    <div className="mt-4 border-t border-pro-border/70 pt-4">
      <h3 className="text-[15px] font-semibold leading-6 text-pro-text-main">
        {recentWin.title}
      </h3>
      <p className="mt-2 text-[13px] font-medium leading-[1.55] text-pro-text-muted">
        {recentWin.whyItCounts}
      </p>
      <p className="mt-3 text-[10px] font-semibold text-pro-text-muted/65">
        Source: {recentWin.sourceLabel}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedMeetingId(recentWin.meetingId)}
          className="inline-flex min-h-8 items-center gap-1 text-[12px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
        >
          Open moment <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={startCelebration}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[12px] font-bold text-pro-text-muted hover:bg-pro-success/10 hover:text-pro-success focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
        >
          <PartyPopper className="h-3.5 w-3.5" aria-hidden="true" /> Celebrate
        </button>
      </div>
    </div>
  </section>
) : latestMeeting.state === 'populated' ? (
  <section aria-labelledby="continue-title">
    <p className="text-[10px] font-semibold text-pro-text-muted/60">
      Recent context
    </p>
    <h2 id="continue-title" className="mt-1 text-[20px] font-serif font-medium text-pro-text-main">
      Continue where you left off
    </h2>
    <div className="mt-4 border-t border-pro-border/70 pt-4">
      <h3 className="text-[15px] font-semibold text-pro-text-main">
        {latestMeeting.title}
      </h3>
      <p className="mt-2 line-clamp-3 text-[13px] font-medium leading-[1.55] text-pro-text-muted">
        {latestMeeting.detail}
      </p>
      <button
        type="button"
        onClick={() => setSelectedMeetingId(latestMeeting.meetingId)}
        className="mt-3 inline-flex min-h-8 items-center gap-1 text-[12px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
      >
        Open meeting <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  </section>
) : model.knowledgeDocuments.state === 'populated' ? (
  <section aria-labelledby="knowledge-reentry-title">
    <p className="text-[10px] font-semibold text-pro-text-muted/60">
      Working memory
    </p>
    <h2 id="knowledge-reentry-title" className="mt-1 text-[20px] font-serif font-medium text-pro-text-main">
      Return to your current read
    </h2>
    <p className="mt-4 border-t border-pro-border/70 pt-4 text-[13px] font-medium leading-[1.55] text-pro-text-muted">
      {model.knowledgeDocuments.cards[0].title}
    </p>
    <button
      type="button"
      onClick={() => setActiveTab('wiki')}
      className="mt-3 inline-flex min-h-8 items-center gap-1 text-[12px] font-bold text-pro-accent hover:text-pro-text-main focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pro-accent"
    >
      Open knowledge <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  </section>
) : null}
```

Do not add a new model, IPC call, or decorative card grid. Omit the aside entirely when no supported context exists and switch the working grid to one column.

- [ ] **Step 6: Run component and model regression tests**

Run:

```bash
pnpm exec vitest run tests/unit/Dashboard.test.tsx tests/unit/dashboardModel.test.ts
```

Expected: PASS. Update older assertions that intentionally expected `Nothing needs your attention.` or an unsupported Recent win placeholder; do not weaken blocker, evidence, commitment-state, action-label, or item-cap assertions.

- [ ] **Step 7: Commit the dashboard composition**

```bash
git add src/components/features/Dashboard.tsx tests/unit/Dashboard.test.tsx
git commit -m "feat: make empty dashboard useful (#658)"
```

### Task 3: Record the decision and verify the real surface

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-08-24-658-useful-empty-dashboard.md`

- [ ] **Step 1: Record the durable decision**

Append this entry to `docs/decisions.md`:

```md
## 2026-08-24 - Preserve useful context on an empty daily briefing

- **Status:** Accepted
- **Source:** [Issue #658](https://github.com/metagrover/pluto/issues/658), `docs/superpowers/specs/2026-08-24-useful-empty-dashboard-design.md`
- **Decision:** When no supported item needs attention, Pluto states that once and composes the rest of the homepage from the strongest available real context: suggested commitments, a supported recent win, the latest meeting, or Knowledge. Initial loading may reserve layout with skeletons; background refreshes preserve the resolved model and do not replace stable status copy.
- **Rationale:** Repeating empty messages across fixed regions made a data-bearing dashboard appear vacant, while a shared loading flag caused routine background meeting updates to flash a global refresh label.
- **Consequences:** Unsupported sections no longer reserve space, suggested commitments remain visibly distinct from confirmed work, and refresh feedback belongs to initial load or the control that initiated a mutation rather than the whole dashboard.
```

- [ ] **Step 2: Add the changelog fragment**

Create `docs/changelog/entries/2026-08-24-658-useful-empty-dashboard.md`:

```md
### Make an empty daily briefing useful and stable

- **Issue:** [#658](https://github.com/metagrover/pluto/issues/658)
- **Changed:** The homepage now shows one compact caught-up state, promotes suggested commitments, and falls back to a supported win, latest meeting, or Knowledge context instead of repeating empty panels.
- **Fixed:** Background dashboard refreshes keep resolved content visible and no longer flash a global `Refreshing` label.
- **Why:** Nothing urgent should still feel useful, and background processing should not make stable briefing content appear unsettled.
```

- [ ] **Step 3: Run static and focused verification**

Run:

```bash
pnpm exec vitest run tests/unit/useDashboardHome.test.ts tests/unit/Dashboard.test.tsx tests/unit/dashboardModel.test.ts tests/unit/dashboardActionCompletion.test.ts
pnpm exec biome lint src/components/features/useDashboardHome.ts src/components/features/Dashboard.tsx tests/unit/useDashboardHome.test.ts tests/unit/Dashboard.test.tsx
pnpm exec tsc --noEmit
pnpm run changelog:check
git diff --check origin/master...HEAD
```

Expected: all focused tests, changed-file lint, TypeScript, changelog validation, and whitespace checks pass. If repository-wide TypeScript exposes unrelated baseline failures, confirm that neither changed source file appears in the diagnostics and report the limitation precisely.

- [ ] **Step 4: Verify the Electron experience**

Run the actual app with `pnpm run dev`. If Electron reports a `better-sqlite3` ABI mismatch, run `pnpm run fix-sqlite-abi`, verify the module under `ELECTRON_RUN_AS_NODE=1`, then restart Pluto.

Inspect the real dashboard with persisted local data at:

- The user-provided wide viewport, approximately 1728 by 1117 CSS px
- A narrower supported desktop viewport, approximately 1100 by 760 CSS px
- Light and dark themes
- Reduced motion enabled

Verify that the caught-up state appears once, three pending suggestions are directly reviewable, latest context replaces an unsupported win, no visible text flashes during a background meeting refresh, keyboard focus reaches every review and navigation action, and no content clips or creates horizontal scrolling.

- [ ] **Step 5: Commit documentation and verification record**

```bash
git add docs/decisions.md docs/changelog/entries/2026-08-24-658-useful-empty-dashboard.md
git commit -m "docs: record useful dashboard fallback (#658)"
```

- [ ] **Step 6: Update issue #658 with final evidence**

Comment on the issue with the exact commit range, focused test counts, lint/typecheck/changelog results, Electron viewport checks, and any remaining limitation. Do not claim the flashing is fixed unless the background refresh path was observed with stable visible content in the running application.
