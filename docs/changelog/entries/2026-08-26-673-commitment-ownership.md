### Preserve explicit action-item ownership

- **Issue:** [#673](https://github.com/metagrover/pluto/issues/673)
- **PR:** Pending.
- **Changed:** The shared notes prompt and deterministic grounding pipeline now keep action text as a concise task, derive first-person ownership from the evidence speaker, retain explicit named assignments, and distinguish settled collective commitments from suggestions.
- **Why:** Model-generated actions could say `the team will...` even when one participant explicitly accepted the work, or lose the owner because the person's name was not repeated inside a first-person utterance.
- **Replaced:** Prompt-only action phrasing and literal-name-only owner validation.
- **Notes:** Generic `team` ownership is never used as a fallback. Unresolved ownership remains empty, unsupported owner claims remain visible in quality metadata, and transcript evidence is not rewritten.
