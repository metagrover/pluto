### Reconcile saved transcript quality end to end

- **Issue:** [#663](https://github.com/metagrover/pluto/issues/663)
- **PR:** Pending.
- **Changed:** Finalized meetings retain their accepted live EOU wording and reconcile it against recovered-channel timing, suppress bounded phonetic loudspeaker echoes, assemble conservative punctuated sentences, persist participant vocabulary across restart, and measure first-speech-to-text latency separately from recording startup. The exact saved reading projection now feeds meeting analysis.
- **Why:** A validated canonical transcript could still replace accurate live words with fragmented final decodes, misstate loudspeaker echo as the local user, omit punctuation, lose vocabulary hints after the in-memory handoff, and silently drop a displayed turn during analysis cleanup.
- **Analysis reliability:** Local analysis and knowledge generations now stream under separate capacity, idle-progress, and bounded active-generation deadlines. The downstream analysis deadline remains a catastrophic ceiling instead of preempting healthy multi-pass generation at a fixed 15-minute wall.
- **Evidence:** The latest persisted 40-minute meeting replays from 671 canonical segments to 504 readable turns with terminal punctuation on every timed turn and exact display/analysis parity. Older recordings without persisted `liveSegments` cannot recover words that were never saved, but still receive the echo, attribution, sentence, and analysis improvements.
- **Safety:** Canonical transcript JSON, raw channel provenance, timing evidence, and integrity records remain unchanged. Uncertain attribution stays `Speaker`; genuine double-talk is preserved when validated near-end evidence exists.
