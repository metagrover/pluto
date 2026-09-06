# Responsive Upcoming Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show up to three upcoming meetings in Pluto's compact dashboard and five in its larger dashboard, with an accessible disclosure for overflow and a clear empty-day message.

**Architecture:** Keep calendar fetching, ordering, and state handling unchanged. `UpcomingMeetings` will observe the same `1024px` large-layout breakpoint already used by `Dashboard`, derive the collapsed limit from that media query, and continue to use its existing local expanded state and Pluto styling.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest, Happy DOM

---

### Task 1: Specify responsive agenda behavior

**Files:**
- Modify: `tests/unit/UpcomingMeetings.dom.test.tsx`

- [ ] **Step 1: Extend the meeting fixture for overflow scenarios**

Give `meeting(index)` stable titles for at least six meetings so the test can identify rows beyond both collapsed limits:

```ts
const titles = [
  'Product review',
  'Go-to-market planning',
  'Leadership check-in',
  'Design critique',
  'Customer interview',
  'Weekly retrospective',
];

const meeting = (index: number): CalendarEvent => ({
  occurrenceKey: `event-${index}`,
  eventIdentifier: `event-${index}`,
  calendarIdentifier: 'calendar-a',
  title: titles[index] ?? `Meeting ${index + 1}`,
  start: `2026-08-30T${String(17 + index).padStart(2, '0')}:30:00.000Z`,
  end: `2026-08-30T${String(18 + index).padStart(2, '0')}:30:00.000Z`,
  isAllDay: false,
  isCancelled: false,
  availability: 'busy',
  organizer: null,
  attendees: [],
  lastModified: null,
});
```

- [ ] **Step 2: Add a controllable media-query fixture**

Install a `window.matchMedia` stub that starts below `1024px`, records `change` listeners, and exposes `setMatches(next)` to dispatch a `MediaQueryListEvent`-shaped object. Restore the stub after every test through Vitest:

```ts
const installMatchMedia = (initialMatches: boolean) => {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = '(min-width: 1024px)';
  const query = {
    get matches() {
      return matches;
    },
    media,
    onchange: null,
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => query));
  return {
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next, media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
};
```

Add `vi.unstubAllGlobals()` to `afterEach` after unmounting tests.

- [ ] **Step 3: Write the failing responsive disclosure test**

Render six meetings below the large-layout breakpoint and assert that three rows render with `aria-label="Show 3 more meetings"`. Toggle the media query to large and assert five rows plus `aria-label="Show 1 more meeting"`; click the control and assert all six rows and `Show less`, then collapse and assert five rows again:

```ts
it('shows three compact rows and five large-layout rows before disclosure', async () => {
  const media = installMatchMedia(false);
  const agenda = render({ events: Array.from({ length: 6 }, (_, i) => meeting(i)) });
  expect(agenda.container.querySelectorAll('[data-testid="upcoming-meeting-row"]')).toHaveLength(3);
  expect(agenda.container.querySelector('button[aria-label="Show 3 more meetings"]')).not.toBeNull();

  await act(async () => media.setMatches(true));
  expect(agenda.container.querySelectorAll('[data-testid="upcoming-meeting-row"]')).toHaveLength(5);
  const more = agenda.container.querySelector<HTMLButtonElement>('button[aria-label="Show 1 more meeting"]');
  expect(more?.textContent).toContain('More');

  await act(async () => more?.click());
  expect(agenda.container.querySelectorAll('[data-testid="upcoming-meeting-row"]')).toHaveLength(6);
  const less = agenda.container.querySelector<HTMLButtonElement>('button[aria-label="Show fewer meetings"]');
  await act(async () => less?.click());
  expect(agenda.container.querySelectorAll('[data-testid="upcoming-meeting-row"]')).toHaveLength(5);
  act(() => agenda.root.unmount());
});
```

- [ ] **Step 4: Update the empty-day expectation**

Change the clear-day assertion to require the concise copy `No meetings today` while retaining the existing coverage for loading and stale cached events.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/UpcomingMeetings.dom.test.tsx
```

Expected: the responsive test fails because the component still renders two collapsed rows, and the empty-state assertion fails because the current copy says `No more meetings today`.

### Task 2: Implement the responsive collapsed limit

**Files:**
- Modify: `src/components/features/UpcomingMeetings.tsx`

- [ ] **Step 1: Observe Pluto's large dashboard breakpoint**

Add a local `'(min-width: 1024px)'` media query, initialize its match state safely, subscribe to `change` in an effect, and remove the listener during cleanup:

```ts
const LARGE_DASHBOARD_QUERY = '(min-width: 1024px)';

const [usesLargeLayout, setUsesLargeLayout] = useState(
  () => window.matchMedia?.(LARGE_DASHBOARD_QUERY).matches ?? false,
);

useEffect(() => {
  if (!window.matchMedia) return;
  const query = window.matchMedia(LARGE_DASHBOARD_QUERY);
  const updateLayout = (event: MediaQueryListEvent) =>
    setUsesLargeLayout(event.matches);
  setUsesLargeLayout(query.matches);
  query.addEventListener('change', updateLayout);
  return () => query.removeEventListener('change', updateLayout);
}, []);
```

- [ ] **Step 2: Replace the fixed two-row limit**

Derive `collapsedLimit` as five for the large layout and three otherwise. Slice the collapsed rows and calculate the hidden count from the same value so visible rows, copy, and accessible labels remain consistent:

```ts
const collapsedLimit = usesLargeLayout ? 5 : 3;
const visibleEvents = expanded ? events : events.slice(0, collapsedLimit);
const hiddenCount = Math.max(0, events.length - collapsedLimit);
```

- [ ] **Step 3: Refine disclosure and empty-state copy**

Keep the existing Pluto button styling and chevron behavior, change its collapsed visible label from `See more` to `More`, retain the count-specific `aria-label`, and change the fresh empty state to `No meetings today`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/UpcomingMeetings.dom.test.tsx
```

Expected: all `UpcomingMeetings` tests pass.

### Task 3: Record and verify the shipped product decision

**Files:**
- Modify: `docs/decisions.md`
- Create: `docs/changelog/entries/2026-09-07-778-responsive-upcoming-meetings.md`

- [ ] **Step 1: Record the durable dashboard-density decision**

Append a dated decision linked to issue #778: the collapsed agenda shows three rows below the dashboard's `lg` breakpoint and five at or above it, overflow remains user-expandable, and an empty day is stated explicitly without copying Granola's visual treatment.

- [ ] **Step 2: Add the changelog fragment**

Create the issue-linked fragment with `PR: Pending.`, describing the responsive 3/5-row agenda, the `More` disclosure, and the clear-day copy. State that it replaces the fixed two-row collapsed limit.

- [ ] **Step 3: Run verification**

Run:

```bash
pnpm vitest run tests/unit/UpcomingMeetings.dom.test.tsx
pnpm run changelog:check
pnpm run lint
```

Expected: all commands pass without new warnings or errors.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --check
git diff -- tests/unit/UpcomingMeetings.dom.test.tsx src/components/features/UpcomingMeetings.tsx docs/decisions.md docs/changelog/entries/2026-09-07-778-responsive-upcoming-meetings.md
```

Expected: no whitespace errors and only issue #778 changes.
