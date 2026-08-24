# Useful Empty Dashboard Design

**Issue:** [#658](https://github.com/metagrover/pluto/issues/658)

**Status:** Approved direction; implementation planning pending written-spec review

## Outcome

Pluto's homepage remains useful and composed when no supported item needs attention. The page should reassure the user that they are caught up, then elevate the best available next step: review suggested commitments, resume the latest meeting context, ask Pluto, or add a commitment.

The design is a focused follow-up to #655. It preserves the calm daily-briefing model while improving hierarchy, density, empty-state usefulness, and background-refresh stability.

## Current problems

The current empty dashboard has four related issues:

1. The same absence is repeated in Top of mind, My commitments, and Recent win.
2. Large section heights and weak type contrast leave the first viewport visually sparse without making it restful.
3. Useful existing context, especially commitments awaiting confirmation and the latest meeting, is visually subordinate to empty copy.
4. Every dashboard reload sets the shared loading flag. The top-right attention chip consequently replaces its stable summary with `Refreshing`, so unrelated background meeting updates can make the chip flash even when the attention state has not changed.

## Chosen direction

Use a quiet briefing with progressive fallback content.

When no supported attention item exists, Pluto should say that once. The rest of the page should reorganize around useful real context rather than preserving empty placeholders for every possible section.

Two alternatives were rejected:

- A setup-first dashboard would overstate first-run onboarding for users who already have meetings and extracted context.
- Keeping the current three fixed regions and polishing each empty message would preserve the repetition and unused space.

## Information hierarchy

The first desktop viewport follows this order:

1. Briefing identity and one stable status
2. Best supported next step
3. Confirmed commitments and suggested commitments awaiting review
4. Latest meeting or knowledge re-entry context
5. Secondary actions

An unsupported Recent win does not reserve a permanent region. A supported win still appears as a distinct evidence-backed moment.

## Layout and typography

### Page frame

- Keep the application shell and sidebar unchanged.
- Use a desktop content measure of approximately 1040 to 1120 px so the page feels intentional on very wide windows.
- Reduce the blank space above and between primary regions while preserving clear separation through dividers and alignment.
- Use one responsive working grid. The commitments area receives roughly two-thirds of the width; supporting context receives one-third.
- At narrower desktop widths, stack supporting context below commitments without changing the reading order.

### Briefing header

- Keep `Daily briefing` and `Top of mind` as the page identity.
- Increase supporting body copy to a comfortable 13 to 14 px with a 1.5 to 1.6 line height.
- Use a clearer type ladder between the page title, section titles, row titles, metadata, and tertiary labels.
- Remove the detached top-right status chip. Status belongs in the briefing content where it has context.
- Do not show background refresh activity as changing visible copy.

### Empty Top of mind

Render a compact status row rather than a large empty block:

- Calm success icon
- Headline: `You're caught up`
- Supporting line: `No blockers or confirmed commitments need attention right now.`
- One contextual action when supported, such as `Review 3 suggestions`

The state must not imply that Pluto has no data. It means only that no supported item currently meets the attention threshold.

### Commitments

- Keep confirmed commitments as compact rows with the current completion and evidence behavior.
- If there are no confirmed commitments but suggestions await confirmation, make the suggestion queue visible in the section body rather than hiding it behind a small disclosure.
- Use the heading `Suggested commitments` with concise source context and direct `Confirm` and `Not a task` actions.
- Keep `Add commitment` available as the section-level action.
- If neither confirmed nor suggested commitments exist, show one short explanatory line and the add action. Do not render a large decorative empty card.

### Supporting context

Use conditional composition rather than fixed empty panels:

- If an evidence-backed win exists, show Recent win with its source and existing actions.
- Otherwise, if a latest meeting exists, show `Continue where you left off` with meeting title, date, and an open action.
- Otherwise, if knowledge exists, show a concise Knowledge re-entry action.
- If none of those sources exist, omit the supporting region and allow the commitments area to use the available width.

`Ask Pluto` remains available as a quiet secondary action. Unsupported content is omitted rather than replaced with generic encouragement.

## Refresh-state contract

Initial loading and background refreshing are different states.

- **Initial loading:** No resolved dashboard data exists. Preserve final layout geometry with localized skeletons.
- **Background refreshing:** Resolved data remains visible and interactive while new data loads. Do not replace headings, status, or empty-state copy.
- **Mutation in progress:** The initiating commitment or attention control owns its loading feedback. Do not turn the whole dashboard into a loading state.
- **Refresh success:** Replace the model only when the resolved data is ready.
- **Refresh failure:** Keep the last resolved model. Expose a quiet, section-appropriate retry message only when the failure affects useful content.

The dashboard hook should represent whether resolved data has ever loaded, rather than treating every refresh as an initial load. Concurrent refresh coordination remains intact.

## Interaction and accessibility

- Preserve keyboard access and visible focus states for all existing actions.
- Use text and iconography together for the caught-up state; color alone cannot carry meaning.
- Background refreshes must not create repeated live-region announcements.
- Initial loading skeletons respect reduced-motion preferences and do not pulse when reduced motion is requested.
- Empty-state actions use descriptive accessible names that include the target when needed.
- Layout changes must not hide source-review actions or the distinction between confirmed and suggested commitments.

## Component boundaries

Keep `dashboardModel.ts` as the source of truth for supported content and priority. Presentation changes belong in the dashboard renderer, while the initial-load versus background-refresh distinction belongs in `useDashboardHome`.

Small focused presentation components may be extracted from `Dashboard.tsx` when they make state behavior testable, but this work does not justify a broad dashboard rewrite or a new data model.

## Validation

Implementation must include:

- A failing hook test proving that a background refresh preserves the resolved presentation state
- Component tests for caught-up, suggested-commitment, supported-win, latest-meeting fallback, and truly empty states
- Assertions that `Refreshing` is not rendered as the attention summary during background reloads
- Focused regression tests for confirmed versus suggested commitment behavior
- Keyboard and accessible-name checks for new or relocated actions
- Visual inspection in the running Electron app at the user-provided wide viewport and a narrower supported desktop width
- Light and dark theme checks
- `prefers-reduced-motion` verification for initial loading and existing celebration behavior

## Non-goals

- A new onboarding flow
- A chronological activity feed
- New ranking or urgency rules
- Invented wins, projects, meetings, or evidence
- Changes to the app shell or sidebar
- New persistence or IPC sources
- Decorative animation or generated imagery

## Success criteria

- The empty homepage communicates the caught-up state once.
- Pending suggestions or recent context become visibly more useful than unsupported empty regions.
- The first viewport has a deliberate reading order without excessive unused space.
- Background processing can refresh dashboard data without flashing or replacing stable status copy.
- Populated dashboard states retain their trust, evidence, commitment, and navigation behavior.
