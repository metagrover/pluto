### Preserve transcripts during late meeting saves

- **Issue:** [#665](https://github.com/metagrover/pluto/issues/665)
- **PR:** Pending
- **Changed:** Generic meeting saves now preserve existing transcript-owned fields when callers omit them, and live transcript text resists horizontal overflow from long recognized tokens.
- **Why:** Late title or analysis saves could erase a meeting transcript, while long interim transcript text could break the live transcript scroll surface.
- **Replaced:** Unconditional generic upsert defaults for transcript, validation, and audio fields during partial meeting saves.
- **Notes:** The focused DB regression is covered but could not be executed under the current Node ABI without rebuilding `better-sqlite3` away from the Electron ABI.
