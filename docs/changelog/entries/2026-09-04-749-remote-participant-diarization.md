### Separate remote participants without weakening `Me`

- **Issue:** [#749](https://github.com/metagrover/pluto/issues/749)
- **PR:** [#750](https://github.com/metagrover/pluto/pull/750)
- **Changed:** Pluto now runs its pinned FluidAudio diarizer only on the isolated System recording, aligns supported clusters to Parakeet word timestamps, and saves deterministic `Remote Speaker N` labels when multiple remote voices pass the coverage gate. The transcript's speaker-identity controls offer calendar attendees as direct, meeting-scoped choices and immediately show confirmed names across matching turns.
- **Why:** Conferencing apps mix every remote attendee into one System channel, so source separation alone could distinguish `Me` from `Them` but could not preserve who said what among remote participants.
- **Trust:** Recovered source attribution remains authoritative. Remote clustering can relabel only `Them`; `Me` and ambiguous `Unknown` speech never change. Single-speaker, short-lived, overlapping, or low-coverage evidence stays `Them` with content-free fallback metadata.
- **Privacy:** Diarization, transcript alignment, and identity bindings remain on device. Confirmed names are reversible display projections over canonical anonymous labels; no audio, embeddings, transcript text, or identity data leaves Pluto.
- **Replaced:** Collapsing every System-origin participant into one `Them` label and running the diarizer over a mixed local-and-remote recording.
- **Notes:** Automatic conversational name inference and persistent voiceprints remain outside this release; calendar names become identities only after an explicit meeting-scoped user choice.
