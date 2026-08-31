# Settings Information Architecture Design

**Issue:** [#643](https://github.com/metagrover/pluto/issues/643)

## Feature summary

Pluto's Settings page has accumulated six substantial sections in one vertical stack. The page is already a first-class application surface, but the volume of simultaneously visible controls makes it feel heavier than the rest of Pluto.

Reorganize the existing settings into four horizontal tabs so users see one coherent group at a time. Preserve every setting, state, and persistence behavior while improving hierarchy, scanability, and keyboard access.

## Primary user action

Choose the area of Pluto the user wants to configure, then understand and change the relevant controls without scanning unrelated settings.

## Design direction

- **Register:** Product UI.
- **Color strategy:** Restrained. Use Pluto's existing neutral surfaces and accent only for selection, focus, and primary actions.
- **Scene:** A user returns to Pluto on a Mac during a focused work session to adjust one behavior quickly, without wanting to learn a new settings system.
- **References:** macOS System Settings for clear categories, Notion for quiet hierarchy, and Linear for compact product controls.
- **Visual treatment:** Familiar horizontal tabs, a subtle selected-state underline or quiet tint, divided settings rows, and richer inline layouts only where a setup flow genuinely needs them.
- **Visual probe:** Skipped. This is a focused restructuring of an existing surface, not a new visual direction, and the user declined visual exploration.

## Scope

- **Fidelity:** Production-ready.
- **Breadth:** The complete Settings page.
- **Interactivity:** Shipped keyboard-accessible tab navigation and existing settings controls.
- **Time intent:** Finish to merge-ready quality.
- **Out of scope:** New settings, changed defaults, new persistence contracts, a routing rewrite, or a broader Pluto design-system project.

## Information architecture

The horizontal tab list appears directly below the Settings page title:

1. **Personal**
   - Identity
   - Appearance
2. **Meetings**
   - Calendar context
   - Recording
3. **Intelligence**
   - AI provider
   - Local model selection or hosted-provider credentials
4. **Advanced**
   - Reset knowledge base

Tabs group settings by user intent rather than mirroring every existing section. Calendar remains with recording because both shape how Pluto prepares for and captures meetings. Appearance remains with identity because both are personal, device-level preferences. Destructive maintenance stays isolated from routine configuration.

## Layout strategy

- Keep the existing centered Settings page and page header.
- Place the tab list beneath the title and keep it visible at the top of the Settings content while the active panel scrolls.
- Render exactly one tab panel at a time.
- Give each panel a short title and description only when they add information beyond the tab label.
- Use quiet section headings and divided rows. Avoid wrapping every control in a separate card.
- Preserve richer bordered surfaces for Identity and Calendar because they contain multi-state setup flows rather than simple preferences.
- Keep controls aligned to the right on wider windows and below their labels on narrow windows.
- Allow the tab strip to scroll horizontally at narrow widths instead of compressing or wrapping labels.

## Interaction model

- Personal is the default tab whenever a fresh Settings component mounts.
- Clicking a tab replaces the visible panel without leaving Settings.
- The selected tab remains stable while the Settings component stays mounted.
- Implement tabs with `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, and paired IDs.
- Left and Right Arrow move focus between tabs. Home and End move to the first and last tab. Enter and Space activate the focused tab if focus and selection are not coupled.
- Tab changes use a short state transition only if it respects reduced motion. No decorative page choreography.
- Existing setting mutations, busy states, confirmation prompts, and error messages remain unchanged.

## Key states

- **Default:** Personal selected; Identity loading or ready; theme selection visible.
- **Calendar loading:** Meetings selected; Calendar retains its current loading indicator and eventual state.
- **Calendar permission and selection states:** Preserve not determined, denied, restricted, no calendars, needs selection, connected, read failed, unsupported, and runtime missing.
- **Recording readiness:** Preserve idle, preparing, ready, and error actions.
- **Provider-dependent intelligence:** Ollama shows general and fast model controls; hosted providers show the relevant API credential field.
- **Advanced destructive action:** Keep the reset control visually distinct and require the existing explicit confirmation.
- **Narrow window:** Horizontally scrollable tab strip; settings rows stack without clipping controls.
- **Keyboard and reduced motion:** Visible focus, semantic tab behavior, and no required animation.

## Content requirements

- Tab labels: Personal, Meetings, Intelligence, Advanced.
- Retain current setting names and helper copy unless a small wording change is required to remove duplication introduced by the new hierarchy.
- Do not add explanatory prose that merely repeats tab or section headings.
- Keep privacy and local-processing claims attached to the controls they explain.
- Keep error and success messages adjacent to their originating control.

## Component and code boundaries

- `SettingsTab` owns the tab state, tab semantics, shared section primitives, and composition of the four panels.
- `IdentitySettings` continues to own identity loading, mutation, concurrency, errors, and its profile form.
- `CalendarSettings` continues to own calendar connection, selection, permission, refresh, disconnection, and errors.
- Extract a settings-navigation component only if it materially improves semantic testing or keeps `SettingsTab` readable. Do not introduce a general-purpose tabs abstraction solely for this page.
- No Electron IPC or storage schema changes are expected.

## Verification

- Add DOM coverage for tab labels, default panel visibility, switching, hidden-panel non-rendering or hiding semantics, keyboard navigation, and accessibility attributes.
- Preserve focused Calendar and Identity tests.
- Run focused settings, calendar, identity, and model-setting tests.
- Run TypeScript, lint/format checks for touched files, and `git diff --check`.
- Inspect the rendered Settings page at a typical desktop width and a narrow window before calling visual acceptance complete.

## Recommended implementation references

- Impeccable product reference for familiar product navigation and consistent control vocabulary.
- Impeccable layout guidance for rhythm, density, and responsive structure.
- Impeccable interaction guidance for tab keyboard behavior and focus states.
- Repository test-driven-development and verification-before-completion skills.

## Open questions resolved during implementation

- Prefer an underline or very light surface tint for the selected tab based on the existing Pluto tokens; do not introduce a new color role.
- Preserve active-tab state only for the lifetime of the mounted Settings page. Persistent storage and URL routing are unnecessary for this scope.
- Keep Advanced even though it is initially sparse. Its isolation is intentional because destructive maintenance should not compete with daily settings.
