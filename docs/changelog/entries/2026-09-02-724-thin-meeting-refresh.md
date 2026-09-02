### Keep meeting refreshes bounded as history grows

- **Issue:** [#724](https://github.com/metagrover/pluto/issues/724)
- **PR:** [#727](https://github.com/metagrover/pluto/pull/727)
- **Changed:** Meeting lists now load explicit summaries, selected meetings load one full detail record with stale-response protection, and notes progress updates through meeting events instead of polling the full corpus every two seconds.
- **Why:** The production 69-meeting list serialized roughly 18.34 MB per full refresh, allowing a long notes run to repeatedly clone gigabytes of unchanged transcript and analysis data.
- **Replaced:** `SELECT *` list IPC, full-corpus notes-progress polling, and renderer-side note-text search over globally loaded meeting details.
- **Notes:** Search remains notes-aware through a five-result metadata query, dashboard previews are loaded separately and length-bounded, and automatic processing fetches detail only for its chosen meeting. Integrity-derived flags are limited to unfinished processing candidates, and lease wakeups refresh one meeting rather than the corpus. A content-free synthetic gate holds 100 representative summaries to 37,281 bytes and rejects detail-only fields or payloads at or above 100 KB.
