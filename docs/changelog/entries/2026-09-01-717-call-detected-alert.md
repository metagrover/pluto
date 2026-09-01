### Make call detection feel like a Pluto status update

- **Issue:** [#717](https://github.com/metagrover/pluto/issues/717)
- **PR:** Pending.
- **Changed:** The call-detected alert now uses the same compact notification vocabulary as Pluto's meeting-ended treatment: a restrained status icon, two-level copy, a warm primary action, a quiet dismiss control, and lighter elevation.
- **Why:** The previous oversized capsule and dark promotional button felt disconnected from Pluto's calmer meeting lifecycle surfaces.
- **Replaced:** A pill-like banner with an oversized dark action, heavy elevation, hidden close control, and promotional button typography.
- **Trust:** The visual redesign preserves the existing 15-second lifetime, hover pause, keyboard dismissal, and exact recording-start action.
- **Accessibility:** Both actions have visible keyboard focus, the dismiss control has a specific accessible name, and decorative transitions respect reduced-motion preferences.
- **Notes:** The dedicated alert window remains 320 by 80 pixels and continues to appear at the top right of the matched display.
