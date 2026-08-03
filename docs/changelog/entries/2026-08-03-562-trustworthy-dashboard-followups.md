### Review dashboard follow-ups before completion
- **Issue:** [#562](https://github.com/metagrover/pluto/issues/562)
- **PR:** pending
- **Changed:** Dashboard follow-ups now distinguish possible suggestions from confirmed commitments, show content-safe evidence basis, open the exact source meeting when available, and require confirmation before completion or blocker lifecycle controls appear. Repeated extraction reuses a meeting-scoped action without resetting review metadata, final review states cannot be reversed, and source-less review stays inline.
- **Why:** Model extraction can surface useful possibilities, but it cannot prove that a task was actually committed without explicit review.
- **Replaced:** Treating extracted and metadata-free legacy actions as settled work with immediate completion controls and generic attention copy.
- **Notes:** Rejected suggestions remain distinct from completed work, review updates persist before dashboard refresh, and synthetic tests cover source navigation plus confirmation and rejection bindings without recording user content.
