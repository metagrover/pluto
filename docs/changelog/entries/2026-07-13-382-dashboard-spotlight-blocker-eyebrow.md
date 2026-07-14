### Surface blocker state in the spotlight section label
- **Issue:** [#382](https://github.com/metagrover/pluto/issues/382)
- **PR:** [#383](https://github.com/metagrover/pluto/pull/383)
- **Changed:** The homepage spotlight renderer now switches its eyebrow to `Blocked project signal` when the selected spotlight is blocker-backed, while non-blocked spotlight states keep the existing `Project signal` label. Focused server-render regression coverage now proves both the blocked and non-blocked section labels.
- **Why:** `#61` still depends on Pluto keeping blocker state explicit across every homepage follow-up surface. Before this slice, the spotlight already surfaced blocker-aware badge, subtitle, and CTA copy, but the first label on the section still flattened that state back to a generic project signal.
- **Replaced:** Hardcoding the spotlight section eyebrow to `Project signal` even when the selected spotlight already represented blocked project work.
- **Notes:** This intentionally stays scoped to the spotlight section label and does not reopen the in-flight hero, briefing, or quick-action blocker-copy slices.
