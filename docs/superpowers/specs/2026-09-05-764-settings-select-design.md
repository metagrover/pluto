# Settings selection controls

Issue: https://github.com/metagrover/pluto/issues/764

The user approved using Identify speakers as the visual reference for Role or field, Industry, Your person, and silence duration.

Use one reusable themed control with rounded borders, a chevron, a floating surface menu, highlighted rows, and a checkmark for the committed selection. Keep existing Pluto color tokens. Role and Industry accept arbitrary text up to 160 characters and offer filtered suggestions. Your person filters existing options but only commits an explicit selection, retaining the separate create-person form and clear-identity confirmation. Silence duration is a fixed-option selection with no search.

The menu must avoid clipping, constrain itself to the viewport, and support arrows, Enter, Escape, Tab dismissal, accessible labels, active descendants, and disabled states. Settings persistence and identity APIs stay in their existing callers. The speaker modal remains the visual reference; its domain-specific logic is not moved.

Verify interaction behavior with DOM tests and inspect actual rendered controls in a browser, including a constrained viewport. Shared IdentityProfileForm also brings the same Role/Industry styling to onboarding.
