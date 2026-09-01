# Dashboard Calendar Selection Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow initial calendar selection in the Dashboard and prevent a failed first refresh from being reported as a failed selection.

**Architecture:** The native calendar bridge will share a fractional-second ISO-8601 parser with the date format it emits. The calendar service will return a persisted selected-calendar snapshot even when the first refresh fails. The Dashboard’s upcoming-meetings rail will own the in-place calendar chooser and receive selection callbacks from `App`.

**Tech Stack:** Swift 6, EventKit, TypeScript, React, Vitest, Testing.

---

### Task 1: Accept JavaScript ISO timestamps in the native bridge

**Files:**
- Modify: `native/calendar-helper/Sources/CalendarBridgeCore/CalendarBridgeCore.swift`
- Modify: `native/calendar-helper/Sources/PlutoCalendarHelper/main.swift`
- Test: `native/calendar-helper/Tests/CalendarBridgeCoreTests/CalendarBridgeCoreTests.swift`

- [ ] **Step 1: Write the failing Swift test**

```swift
@Test func parsesJavaScriptFractionalSecondTimestamps() {
    #expect(CalendarBridgeProtocol.parseISO8601("2026-08-16T16:00:00.000Z") != nil)
}
```

- [ ] **Step 2: Verify the test fails because the parser does not exist**

Run: `cd native/calendar-helper && swift test --filter parsesJavaScriptFractionalSecondTimestamps`

Expected: FAIL with a missing `parseISO8601` member.

- [ ] **Step 3: Implement the shared parser and use it for event requests**

```swift
public static func parseISO8601(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)
}
```

Replace the two `ISO8601DateFormatter().date(from:)` calls in `events(params:)` with `CalendarBridgeProtocol.parseISO8601`.

- [ ] **Step 4: Verify the Swift bridge tests pass**

Run: `cd native/calendar-helper && swift test`

Expected: PASS with the new fractional-second parsing test.

### Task 2: Make a selected calendar durable when its initial refresh fails

**Files:**
- Modify: `electron/calendar/service.ts`
- Test: `tests/unit/calendarService.test.ts`

- [ ] **Step 1: Write the failing service test**

```ts
it('keeps a chosen calendar when its first refresh fails', async () => {
  const fixture = createFixture({ authorization: 'full_access' });
  fixture.client.listEvents.mockRejectedValueOnce(new Error('native failed'));

  await expect(fixture.service.selectCalendar(calendar)).resolves.toMatchObject({
    state: 'read_failed', enabled: true, selectedCalendar: calendar,
  });
});
```

- [ ] **Step 2: Verify the test fails because selection rejects**

Run: `pnpm vitest run tests/unit/calendarService.test.ts`

Expected: FAIL because `selectCalendar` rejects `native failed`.

- [ ] **Step 3: Return the selected snapshot after recording the finite refresh failure**

```ts
deps.store.selectCalendar(current);
try {
  await refresh();
} catch {
  // The store already records read_failed; selection remains durable.
}
return snapshotFor('full_access');
```

- [ ] **Step 4: Verify the service tests pass**

Run: `pnpm vitest run tests/unit/calendarService.test.ts`

Expected: PASS.

### Task 3: Keep first-run selection in the Dashboard rail

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/features/Dashboard.tsx`
- Modify: `src/components/features/UpcomingMeetings.tsx`
- Test: `tests/unit/UpcomingMeetings.dom.test.tsx`

- [ ] **Step 1: Write the failing DOM test**

```tsx
it('lets the dashboard choose a calendar in place', async () => {
  const onSelectCalendar = vi.fn(async () => {});
  const { container } = render({
    snapshot: snapshot({ state: 'needs_selection', selectedCalendar: null, calendars: [workCalendar] }),
    events: [], onSelectCalendar,
  });
  await act(async () => container.querySelector<HTMLButtonElement>(
    'button[aria-label="Use Work calendar from iCloud"]',
  )?.click());
  expect(onSelectCalendar).toHaveBeenCalledWith(workCalendar);
});
```

- [ ] **Step 2: Verify the DOM test fails because the callback and picker do not exist**

Run: `pnpm vitest run tests/unit/UpcomingMeetings.dom.test.tsx`

Expected: FAIL because `onSelectCalendar` is not a valid prop and no picker is rendered.

- [ ] **Step 3: Implement the compact in-place chooser**

Add `onSelectCalendar` to the Dashboard and UpcomingMeetings props. In `App`, remove the Settings navigation from `handleCalendarConnect` and add a handler that selects a passed descriptor then reloads the dashboard agenda. In the `needs_selection` state, render the existing compact row vocabulary and call the new callback; retain macOS Settings actions only for denied and no-calendar states.

- [ ] **Step 4: Verify focused dashboard tests pass**

Run: `pnpm vitest run tests/unit/UpcomingMeetings.dom.test.tsx tests/unit/calendarService.test.ts`

Expected: PASS.

### Task 4: Verify and record the repair

**Files:**
- Create: `docs/changelog/entries/2026-08-31-dashboard-calendar-selection-repair.md`

- [ ] **Step 1: Add the changelog fragment**

```markdown
# Dashboard calendar selection repair

Calendar setup now stays in the Dashboard and preserves the selected local calendar when its first event read needs recovery.
```

- [ ] **Step 2: Run focused quality checks**

Run: `pnpm vitest run tests/unit/UpcomingMeetings.dom.test.tsx tests/unit/calendarService.test.ts && cd native/calendar-helper && swift test && cd ../.. && pnpm exec tsc --noEmit && pnpm exec biome check src/App.tsx src/components/features/Dashboard.tsx src/components/features/UpcomingMeetings.tsx electron/calendar/service.ts tests/unit/UpcomingMeetings.dom.test.tsx tests/unit/calendarService.test.ts`

Expected: every command exits 0.

- [ ] **Step 3: Verify the rendered dashboard**

Run: `pnpm run dev`

Expected: after native Calendar permission, the dashboard presents a selectable calendar list without navigating to Settings; after choosing a calendar, the right rail updates in place.

- [ ] **Step 4: Commit the repair**

```bash
git add native/calendar-helper/Sources/CalendarBridgeCore/CalendarBridgeCore.swift native/calendar-helper/Sources/PlutoCalendarHelper/main.swift native/calendar-helper/Tests/CalendarBridgeCoreTests/CalendarBridgeCoreTests.swift electron/calendar/service.ts src/App.tsx src/components/features/Dashboard.tsx src/components/features/UpcomingMeetings.tsx tests/unit/calendarService.test.ts tests/unit/UpcomingMeetings.dom.test.tsx docs/changelog/entries/2026-08-31-dashboard-calendar-selection-repair.md
git commit -m "fix: keep calendar setup on dashboard (#617)"
```
