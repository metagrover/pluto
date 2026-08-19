### Bound oversized meeting notes to useful themes

- **Issue:** [#637](https://github.com/metagrover/pluto/issues/637)
- **PR:** [#638](https://github.com/metagrover/pluto/pull/638)
- **Changed:** Long meetings whose full editorial prompt exceeds the local context budget now collapse related local topics into at most six meeting-level sections while preserving grounded decisions and action items.
- **Why:** A real long meeting bypassed the global editor and surfaced 46 micro-topics, including duplicate, housekeeping, and tool-mechanics headings, making the overview unreadable.
- **Replaced:** Returning the complete window-topic draft unchanged whenever the meeting-wide editorial prompt was too large.
- **Notes:** The safety reducer is deterministic and makes no additional model call. Normal meeting-wide editing still uses the single configured Qwen model, and existing saved analyses are not overwritten automatically.
