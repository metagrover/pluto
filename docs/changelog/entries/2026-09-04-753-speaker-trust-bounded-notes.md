### Restore source-correct speakers and put a hard bound on notes

- **Issue:** [#753](https://github.com/metagrover/pluto/issues/753), extending the speaker-trust work tracked in [#725](https://github.com/metagrover/pluto/issues/725).
- **PR:** Pending.
- **Changed:** Pluto removes System-correlated echo from the microphone transcript, attributes every surviving mic segment to `You`, and diarizes only System audio into participant speakers. Notes capacity uses the compact provider payload and ordinary oversized meetings receive no more than three independently reviewed leaves.
- **Why:** Microphone diarization fragmented the user's surviving speech into generic speakers even though the other mic signal was loudspeaker echo already represented by System. Verbose pre-wire budgeting also sent segmented meetings into a long hierarchy that could finish with another-pass states.
- **Boundaries:** Direct notes use two model calls. Partitioned production notes use at most six, with no model repair, merge, retry, or recursive repartition, and an admitted notes run ends after twelve minutes. Plans that cannot meet those bounds fail before inference with a stable reason.
- **Trust:** Echo removal requires recovered-channel timing, text, and acoustic support. Unresolved source ownership fails closed, and final-transcription reason codes survive persistence without transcript or audio content. Existing v3 transcripts stay readable but require explicit reprocessing before notes run.
- **Replaced:** Diarizing mic audio into anonymous local speakers, sizing notes from the verbose internal prompt, and sending ordinary product runs into the recursive writer/audit/merge hierarchy.
- **Preserved:** Raw recordings, source ASR, exact note citations, stale-run checks, transactional publication, and historical compare-and-save behavior are unchanged.
- **Notes:** The legacy hierarchy remains available to explicit legacy and benchmark callers; it is no longer a production fallback for compact meeting notes.
