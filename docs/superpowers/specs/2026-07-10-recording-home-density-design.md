# Recording and Homepage Density Design

**Issues:** [#357](https://github.com/metagrover/pluto/issues/357), [#59](https://github.com/metagrover/pluto/issues/59)

**Status:** Approved design direction; implementation planning pending written-spec review

## Outcome

Pluto should use desktop space more effectively without becoming a crowded analytics dashboard. The recording screen becomes a quiet command center that makes capture health obvious, while the homepage becomes a compact daily briefing that shows meaningful work in the first viewport.

The redesign preserves Pluto's calm, premium character. It improves information yield by removing unnecessary framing, tightening spacing, and using progressive disclosure—not by shrinking every control or displaying all available data at once.

## Product principles

1. **Confidence before density.** Recording health and the next important action must remain immediately understandable.
2. **Fewer containers, more useful content.** Prefer alignment, dividers, and surface changes over nested cards.
3. **One dominant action per region.** Secondary actions should remain accessible without competing for attention.
4. **Progressive disclosure.** Advanced controls and diagnostics appear when requested or when Pluto detects a problem.
5. **Stable layouts.** Loading, degraded, and live states should not rearrange the entire screen.
6. **Conversation first.** Recording UI must help users participate in the meeting rather than encourage them to monitor Pluto continuously.

## Chosen direction

Use a balanced workspace model inspired by the information hierarchy of ChatGPT and Claude: restrained chrome, compact spacing, a clear central working surface, and shallow supporting regions. Facebook-like density is useful as a reference for information yield, but not for persistent feeds, visual noise, or competing attention signals.

Two alternatives were rejected:

- A dense information console would expose more data but create unnecessary distraction during meetings.
- A minimal focus mode would preserve calmness but fail to solve Pluto's underuse of desktop space.

## Homepage: compact daily briefing

### User goal

On opening Pluto, a user should understand the most important current item, see the next several commitments, and access recent meeting or knowledge context without scrolling through oversized framing.

### Information hierarchy

1. One prioritized daily briefing
2. A compact work queue
3. Latest meeting and relevant project signal
4. Recent memory
5. Secondary navigation actions

The homepage remains a daily briefing, not a chronological workspace feed.

### Layout

#### Compact briefing header

Replace the tall hero card with a shallow header region containing:

- Daily briefing label and status badge
- One prioritized headline
- One concise supporting sentence
- One primary action
- Up to two compact secondary actions

The region should normally occupy 120–150 px of vertical space. Long content must clamp or reflow without increasing the header into a promotional hero.

#### Two-column working area

Below the briefing, use a responsive two-column layout:

- The main column contains "Focus now" and a work queue with five to seven visible actions when data is available.
- The side column contains the latest meeting summary, active recording status when applicable, and one evidence-backed project signal.

Action items should render as compact rows separated by dividers or subtle surface changes. Each row includes the action title, due/freshness state, source, and completion control. Do not wrap every row in a separate elevated card.

When the window is narrow, the main column remains first and the side column stacks beneath it.

#### Recent memory

Render recent knowledge as a compact list rather than three large cards. Each item shows:

- Document type or scope icon
- Title
- One line of context
- Freshness or trust state
- Related project or person when supported by data
- Open action

The section should show four to six useful items in the space currently used for three cards. Unsupported metadata is omitted rather than replaced with invented copy.

### Homepage states

- **Loading:** Preserve section geometry and show localized skeleton rows.
- **Empty:** Explain the next useful action in the affected section without filling the page with oversized empty-state cards.
- **Degraded:** Keep healthy sections interactive and identify only the unavailable source.
- **Recording:** Show compact live-capture context in the side column without displacing the prioritized briefing.
- **Overflow:** Provide a clear route to Projects or Knowledge after the visible row limit.

### Homepage success criteria

- The initial desktop viewport shows the full briefing, at least four work items when available, and most or all of the latest-meeting panel.
- The page contains fewer nested borders and fewer independently rounded containers than the current dashboard.
- Hero priority and real-data rules defined by issue #59 remain unchanged unless separately approved.
- No unsupported people, project, calendar, or meeting claims are introduced.

## Recording screen: quiet command center

### User goal

During a meeting, a user should immediately know that Pluto is recording successfully, be able to verify what it hears, and capture an important note or action without leaving the conversation.

### Information hierarchy

1. Recording state and capture health
2. Live transcript
3. Finish control
4. Quick note and action capture
5. Context and diagnostics

### Layout

#### Persistent capture bar

A compact bar remains visible at the top of the recording workspace. It contains:

- Recording indicator and elapsed time
- Meeting title
- Microphone health
- System-audio health when applicable
- Pause control if supported by existing behavior
- Finish recording action
- Overflow menu for secondary controls

Healthy inputs use calm text and icons. Warning and failure states receive stronger emphasis only when intervention is needed. The finish action must be visually distinct and accessible, but it should not dominate the entire workspace.

#### Live transcript

The transcript is the primary surface and receives most available width. It uses:

- Speaker-grouped entries
- Clear speaker labels and optional timestamps
- Visually distinct interim and confirmed text
- Auto-follow while the user remains at the live edge
- A visible "Return to live" action after manual scrolling
- Inline capture or transcription warnings near the affected content
- Lightweight search and text-size controls

The transcript should read as one continuous conversation, not a stack of cards. Its readable content measure should remain approximately 760–840 px even when the application window is wider.

#### Meeting rail

A 280–320 px rail contains:

- Quick note input
- Mark-as-action input or affordance
- Current meeting context
- Notes and actions captured during the meeting
- Collapsed capture diagnostics

The rail can be collapsed, and that preference should persist locally. Note and action capture must remain immediately reachable but visually secondary to transcript and recording health.

#### Progressive diagnostics

Device selection, transcription settings, detailed levels, and technical diagnostics remain collapsed during healthy capture. Pluto should automatically expose or link to the relevant control when a problem is detected.

The animated waveform must not be the primary focal point. A small level indicator may supplement explicit health text but cannot replace it.

### Recording states

- **Ready:** Explain available inputs and present a clear start action without using a large decorative empty card.
- **Starting:** Reserve the final capture-bar geometry and show which inputs are connecting.
- **Healthy recording:** Keep indicators calm and stable while transcript content advances.
- **Input warning:** Identify the affected source, consequence, and recovery action.
- **Scrolled transcript:** Stop auto-follow and show "Return to live" without moving other controls.
- **Processing:** Replace capture actions with progress and clear safe-to-close guidance based on actual application behavior.
- **Failure:** Preserve recoverable transcript and notes, explain what was saved, and provide a specific retry or exit action.

### Finish behavior

- Confirm before ending a meaningful recording.
- An empty or accidental capture may stop without confirmation if no meaningful content would be lost.
- The confirmation states what will happen to transcript processing and saved notes.
- The final implementation must preserve current recording and transcription behavior unless a separate behavior issue is approved.

### Recording success criteria

- Recording state, elapsed time, both relevant input-health states, and finish control are visible without scrolling.
- The transcript is usable at narrow and wide supported Electron window sizes.
- A note or action can be captured with one direct interaction after typing.
- Healthy capture does not produce persistent animated attention signals.
- Advanced diagnostics do not occupy permanent primary-screen space.

## Shared density system

These values are target ranges, not new global tokens until implementation confirms that they fit Pluto's existing theme:

| Element | Target |
| --- | --- |
| Standard desktop page gutter | 20–24 px |
| Section gap | 12–16 px |
| Functional surface padding | 14–18 px |
| Compact row height | 44–56 px |
| Standard functional radius | 12–16 px |
| Transcript readable measure | 760–840 px |
| Body text | 13–14 px with comfortable line height |
| Meeting rail width | 280–320 px |

Large radii and generous whitespace remain available for exceptional focal moments, not as the default treatment for every section.

## Interaction and accessibility requirements

- Meet WCAG 2.2 AA contrast and focus requirements.
- Preserve a minimum 24×24 px pointer target, with larger targets for primary meeting controls.
- Ensure keyboard order follows visual priority.
- Do not hide required actions behind hover-only affordances.
- Communicate state with text and iconography in addition to color.
- Use an appropriate live region for recording failures and input-health changes.
- Do not announce every interim transcript update to assistive technology.
- Reserve space for status text to avoid layout shifts.
- Respect reduced-motion preferences; capture health cannot depend on animation.
- Tooltips and the overflow menu expose relevant keyboard shortcuts.

## Implementation boundaries

This design spans two user-facing outcomes and must be implemented as separate, reviewable slices:

1. **Recording foundation under #357:** density primitives needed by the recording workspace, persistent capture bar, transcript surface, meeting rail, and recording-state accessibility.
2. **Homepage application under #59:** compact briefing header, work-queue rows, supporting side column, and recent-memory list using the proven density primitives.

Do not combine recording behavior changes, new data pipelines, or a full application-shell redesign into either visual slice. If implementation reveals that pause, health telemetry, quick-action persistence, or finish semantics do not exist, create or update a separate outcome issue before adding that behavior.

## Validation plan

Each implementation slice must include:

- Focused unit tests for any extracted view model or state logic
- Component tests for loading, empty, healthy, warning, degraded, and overflow states
- Keyboard navigation and focus-order verification
- Accessible-name and live-region verification
- Screenshots at agreed narrow and wide Electron viewport sizes
- Light and dark theme review
- Reduced-motion review
- Long-title, long-transcript, and missing-metadata cases
- A real active-recording dogfood pass before shipping #357

## Rollout order

Implement #357 first because the recording workspace has the clearest single job and provides the strongest test of whether the new density system remains calm under real use. Apply the proven primitives to #59 second. This sequencing does not make the homepage dependent on recording behavior; it only reuses validated visual and interaction patterns.

## Non-goals

- A chronological social-style homepage feed
- A dense recording analytics dashboard
- New calendar integration
- New recording or transcription pipelines
- A full navigation or application-shell redesign
- Decorative animation as evidence of capture health
- Invented placeholder data
