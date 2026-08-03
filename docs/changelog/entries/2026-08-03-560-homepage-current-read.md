### Keep the homepage current read complete and readable
- **Issue:** [#560](https://github.com/metagrover/pluto/issues/560)
- **PR:** Pending.
- **Changed:** The homepage renders the selected current-read claim verbatim at briefing scale, clamps it to three lines by default, and offers an accessible disclosure only when browser layout detects real overflow.
- **Why:** Long or unbroken claims could dominate the homepage without giving people a precise, in-context way to inspect the complete synthesis.
- **Replaced:** An always-expanded display-scale headline with no overflow-aware reading control.
- **Notes:** Expansion preserves the exact claim, source and trust context stay adjacent, and knowledge navigation remains a separate action.
