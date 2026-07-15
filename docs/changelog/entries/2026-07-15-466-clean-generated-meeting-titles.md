### Clean generated meeting titles before saving

- **Issue:** `#466`
- **PR:** `#467`
- **Changed:** Generated meeting titles now remove a leading model response label such as `Title:` before Pluto saves the meeting.
- **Why:** Local models can occasionally ignore the title-only response instruction, causing formatting noise to appear in meeting history.
- **Replaced:** Persisting every short title-generation response verbatim except for quotation marks.
- **Notes:** This is limited to title output normalization and does not change transcript analysis or title-topic selection.
