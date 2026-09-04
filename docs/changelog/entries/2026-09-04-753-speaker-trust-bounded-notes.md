### Separate local voices and put a hard bound on notes

- **Issue:** [#753](https://github.com/metagrover/pluto/issues/753), extending the speaker-trust work tracked in [#725](https://github.com/metagrover/pluto/issues/725).
- **PR:** Pending.
- **Changed:** Pluto now diarizes microphone and System recordings independently. Multiple supported microphone voices are saved as anonymous `Local Speaker N` labels with verified separation and unresolved self identity. Notes capacity uses the compact provider payload and ordinary oversized meetings receive no more than three independently reviewed leaves.
- **Why:** A participant captured by the microphone could previously be labeled as the workspace user, while verbose pre-wire budgeting sent segmented meetings into a long hierarchy that could finish with another-pass states.
- **Boundaries:** Direct notes use two model calls. Partitioned production notes use at most six, with no model repair, merge, retry, or recursive repartition, and an admitted notes run ends after twelve minutes. Plans that cannot meet those bounds fail before inference with a stable reason.
- **Trust:** Notes require complete content and reliable speaker separation, not an unsupported claim about which separated voice is `Me`. Meeting-scoped identity corrections remain explicit and reversible. Under-covered evidence fails closed, and final-transcription reason codes survive persistence without transcript or audio content.
- **Replaced:** Treating microphone origin as proof of `Me`, sizing notes from the verbose internal prompt, and sending ordinary product runs into the recursive writer/audit/merge hierarchy.
- **Preserved:** Raw recordings, source ASR, exact note citations, stale-run checks, transactional publication, and historical compare-and-save behavior are unchanged. Existing single-speaker microphone meetings retain their current verified source attribution.
- **Notes:** The legacy hierarchy remains available to explicit legacy and benchmark callers; it is no longer a production fallback for compact meeting notes.
