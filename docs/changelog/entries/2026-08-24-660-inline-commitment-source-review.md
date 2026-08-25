### Review suggested commitments with their source context

- **Issue:** [#660](https://github.com/metagrover/pluto/issues/660)
- **PR:** Not created yet.
- **Changed:** Suggested commitments now reveal the source meeting overview inline, plus a matching topic summary and supporting quote when those are present in persisted analysis.
- **Fixed:** Every pending suggestion in the dashboard queue is visible and reviewable instead of leaving later items behind a non-interactive waiting count.
- **Why:** People should be able to judge what Pluto heard before adding or dismissing a commitment without leaving the decision flow.
- **Replaced:** A source-only navigation link and hidden pending-suggestion count that forced users to reconstruct context outside the review flow.
- **Notes:** The renderer does not regenerate synthesis or infer missing evidence; the full meeting remains available as the deeper source view.
