# Settings selection controls implementation plan

> Use executing-plans to implement the approved design task by task.

**Goal:** Match all four settings selection controls to Identify speakers.

**Architecture:** A shared SettingsSelect owns menu presentation and keyboard interaction. Existing forms retain values, persistence, and identity semantics.

**Tech Stack:** React, TypeScript, Tailwind, React DOM portals, Vitest with happy-dom.

- [x] Add failing DOM interaction tests for a fixed selection, editable suggestions, searchable committed selection, disabled options, and dismissal.
- [x] Implement `src/components/ui/SettingsSelect.tsx` with an options/value/onChange interface, optional searchable and allowCustom modes, portal positioning and accessible keyboard control.
- [x] Replace datalists in IdentityProfileForm and native selects in IdentitySettings and SettingsTab. Keep option IDs and save handlers unchanged.
- [x] Adapt identity integration tests to user-visible custom options and add persistence coverage for duration and suggested profile values.
- [x] Run targeted Vitest suites, TypeScript, lint, changelog validation, and browser visual checks. Record the design decision and changelog fragment.
