# Live Transcript Follow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active transcript follow new speech until the user scrolls away, and render consecutive same-speaker ASR segments as one stable reading turn.

**Architecture:** Add a pure renderer presentation adapter that groups consecutive segments without changing canonical segment objects. Keep follow state inside `LiveTranscript`, use the dedicated transcript scroll element as the single scroll owner, and pin it with direct `scrollTop` assignment only while follow mode is active.

**Tech Stack:** React 18, TypeScript, Vitest with happy-dom, Tailwind `@apply`, Lucide React.

---

### Task 1: Group canonical segments into presentation-only speaker turns

**Files:**
- Create: `src/components/features/liveTranscriptPresentation.ts`
- Create: `tests/unit/liveTranscriptPresentation.test.ts`

- [ ] **Step 1: Write the failing presentation-model tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildLiveTranscriptTurns } from '../../src/components/features/liveTranscriptPresentation';

const segment = (id: string, speaker: 'Me' | 'Them', text: string, timestampMs: number) => ({
  id,
  speaker,
  text,
  timestampMs,
  confirmed: true,
});

it('groups consecutive same-speaker segments without changing their evidence', () => {
  const first = segment('one', 'Me', 'This sentence', 1_000);
  const second = segment('two', 'Me', 'continues here.', 2_000);
  const turns = buildLiveTranscriptTurns([first, second]);

  expect(turns).toEqual([{
    id: 'one',
    speaker: 'Me',
    timestampMs: 1_000,
    segments: [first, second],
  }]);
  expect(first.text).toBe('This sentence');
});

it('starts a new presentation turn when the speaker changes', () => {
  expect(buildLiveTranscriptTurns([
    segment('one', 'Me', 'My turn.', 1_000),
    segment('two', 'Them', 'Their turn.', 2_000),
  ])).toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm exec vitest run tests/unit/liveTranscriptPresentation.test.ts`

Expected: FAIL because `liveTranscriptPresentation` does not exist.

- [ ] **Step 3: Implement the minimal presentation adapter**

```ts
import type { LiveTranscriptSegment } from './recordingWorkspaceModel';

export type LiveTranscriptTurn = {
  id: string;
  speaker: LiveTranscriptSegment['speaker'];
  timestampMs: number;
  segments: LiveTranscriptSegment[];
};

export const buildLiveTranscriptTurns = (segments: LiveTranscriptSegment[]) => {
  const turns: LiveTranscriptTurn[] = [];
  for (const segment of segments) {
    const current = turns.at(-1);
    if (current?.speaker === segment.speaker) {
      current.segments.push(segment);
    } else {
      turns.push({
        id: segment.id,
        speaker: segment.speaker,
        timestampMs: segment.timestampMs,
        segments: [segment],
      });
    }
  }
  return turns;
};
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/liveTranscriptPresentation.test.ts`

Expected: 2 tests pass.

### Task 2: Add user-controlled live following to the grouped transcript

**Files:**
- Modify: `src/components/features/LiveTranscript.tsx`
- Modify: `src/index.css`
- Modify: `tests/unit/LiveTranscript.dom.test.tsx`

- [ ] **Step 1: Add failing DOM coverage for grouped turns**

Render two consecutive `Me` segments and one `Them` segment. Assert that there are two `.transcript-turn` articles, the `Me` label appears once, the two `Me` segment texts remain separately addressable by `.transcript-revealed-text`, and only the active segment owns a caret.

- [ ] **Step 2: Add failing DOM coverage for follow, suspension, and restoration**

Set deterministic `scrollHeight`, `clientHeight`, and writable `scrollTop` values on `.live-transcript-scroll`. Assert that:

```ts
expect(scrollElement.scrollTop).toBe(scrollElement.scrollHeight);
scrollElement.scrollTop = 120;
scrollElement.dispatchEvent(new Event('scroll'));
expect(screenButton('Return to live')).not.toBeNull();
rerenderWithNewSpeech();
expect(scrollElement.scrollTop).toBe(120);
clickReturnToLive();
expect(scrollElement.scrollTop).toBe(scrollElement.scrollHeight);
```

Then dispatch a scroll event at the bottom and assert the control disappears and later speech follows automatically.

- [ ] **Step 3: Run the component test and verify RED**

Run: `pnpm exec vitest run tests/unit/LiveTranscript.dom.test.tsx`

Expected: FAIL because turns are not grouped and `.live-transcript-scroll` plus Return to live do not exist.

- [ ] **Step 4: Implement grouped rendering and follow state**

In `LiveTranscript.tsx`:

```ts
const LIVE_EDGE_TOLERANCE_PX = 48;
const scrollRef = useRef<HTMLDivElement>(null);
const followingLiveRef = useRef(true);
const [isFollowingLive, setIsFollowingLive] = useState(true);
const turns = buildLiveTranscriptTurns(segments);

const setFollowingLive = (following: boolean) => {
  followingLiveRef.current = following;
  setIsFollowingLive(following);
};

const returnToLive = () => {
  setFollowingLive(true);
  const element = scrollRef.current;
  if (element) element.scrollTop = element.scrollHeight;
};

useLayoutEffect(() => {
  const element = scrollRef.current;
  if (!element || !followingLiveRef.current) return;
  element.scrollTop = element.scrollHeight;
}, [interimText, revealState]);
```

Render a non-scrolling `.live-transcript` shell, an inner `.live-transcript-scroll` with `onScroll`, grouped speaker turns, and an absolutely positioned 44px minimum Return to live button. Direct scroll assignment is intentional so word reveal never creates smooth-scroll jitter.

- [ ] **Step 5: Apply the focused visual treatment**

Move padding and overflow ownership from `.live-transcript` to `.live-transcript-scroll`. Keep the 820px reading measure, render dividers only between grouped turns, use normal inline spacing between segment spans, and style the Return to live control with the existing surface, border, accent focus ring, restrained shadow, hover, and active states. Preserve the existing narrow layout and reduced-motion behavior.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/liveTranscriptPresentation.test.ts tests/unit/liveTranscriptReveal.test.ts tests/unit/LiveTranscript.dom.test.tsx`

Expected: all focused tests pass without React act warnings.

### Task 3: Record and verify the shipped outcome

**Files:**
- Create: `docs/changelog/entries/2026-08-11-599-live-transcript-follow.md`
- Modify only if implementation evidence requires it: `docs/superpowers/plans/2026-08-11-live-transcript-follow.md`

- [ ] **Step 1: Add the issue-scoped changelog fragment**

```md
### Keep live transcripts readable and in view
- **Issue:** [#599](https://github.com/metagrover/pluto/issues/599)
- **PR:** Pending.
- **Changed:** The recording transcript now follows accepted speech until the user scrolls away, offers a Return to live control, and reads consecutive same-speaker segments as one stable turn.
- **Why:** Backend segment boundaries should not interrupt a sentence or force users to manually chase the conversation during a meeting.
- **Replaced:** The renderer's misleading Following live label and one-row-per-ASR-segment presentation.
- **Notes:** Grouping is presentation-only; canonical transcript evidence, timestamps, persistence, and finalization are unchanged.
```

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm run test
pnpm run lint
pnpm run changelog:check
pnpm run build
```

Expected: all commands pass. If repository-wide TypeScript remains independently blocked, compare diagnostics with `origin/master` before reporting.

- [ ] **Step 3: Inspect the live component at narrow and wide recording-workspace widths**

Verify the grouped transcript, paused-follow control, focus treatment, long same-speaker text, rapid speaker changes, and reduced-motion state. Perform at least one critique-and-fix pass if any material defect is visible.

- [ ] **Step 4: Commit and deliver traceability**

Commit the plan, tests, implementation, styles, and changelog on `codex/599-live-transcript-follow`. Push the branch, open a PR that closes #599, update the changelog fragment with the PR URL when practical, and add an issue comment with the final verification evidence.
