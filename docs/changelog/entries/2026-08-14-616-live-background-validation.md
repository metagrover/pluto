### Validate live transcript chunks in the background

- **Issue:** [#616](https://github.com/metagrover/pluto/issues/616)
- **PR:** [#624](https://github.com/metagrover/pluto/pull/624)
- **Changed:** Pluto keeps fast base-model live transcription while opportunistically promoting safe medium-model corrections as evidence-linked capture-journal revisions under a bounded macOS compute policy.
- **Why:** A fast first paint and a high-quality final transcript previously required choosing between visible lag and repeating all validation after the meeting.
- **Replaced:** Unversioned live-only text and the proposed rolling full-meeting reconciliation loop with sealed five-second tuple validation, atomic checkpoint and acceptance-frame promotion, stable IDs, and exact finalization reuse.
- **Notes:** Live work retains priority; validation is single-flight, limited to one start per 20 seconds, denied on battery or serious thermal pressure, and discarded safely on stop or failed alignment. Verification uses synthetic, content-free evidence only.
