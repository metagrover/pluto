# Known-person transcription vocabulary implementation plan

1. Add RED tests for deterministic bounded selection and privacy-safe provenance.
2. Add a main-process person-candidate query and one recording-start IPC snapshot.
3. Thread the immutable prompt through renderer transcription options, the Electron backend, and the local Python request.
4. Add RED/GREEN transport tests, including empty context and log redaction.
5. Run synthetic MLX ambiguity and negative-control replays.
6. Run the complete repository verification and a disposable-profile Electron recording before delivery.

