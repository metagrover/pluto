### Setting to include transcript in meeting notes export

- **Issue:** [#745](https://github.com/metagrover/pluto/issues/745)
- **PR:** Pending.
- **Changed:** Added an "Include transcript in exports" setting toggle in Settings → Meetings. When enabled, exported Markdown notes automatically append a clean, human-readable `## Transcript` section with speaker turns and timestamps.
- **Why:** Some users need the spoken transcript alongside their notes for documentation or search, while others prefer notes-only without raw data. A persistent setting allows users to set their preferred export default.
- **Replaced:** Notes-only export without an option to bundle the transcript.
- **Preserved:** Notes-only export remains the default (setting defaults to off), and all user edits, decisions, and metadata continue to export cleanly.
- **Notes:** Transcripts are formatted into clean speaker turns (`**Speaker** (m:ss)`), never raw JSON blobs.
