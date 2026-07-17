### Pin the credential-free speaker-attribution stack

- **Issue:** `#509`
- **PR:** `#510`
- **Changed:** Pluto selected the checksum-pinned sherpa-onnx diarization stack for issue #460 and made microphone-exclusive near-end evidence mandatory for mapping diarized speakers to `Me`.
- **Why:** Private evaluation proved the local runtime is fast, credential-free, and conservative about false local attribution, while also exposing a 0.541-second interruption that speaker clustering alone misses.
- **Replaced:** An unresolved production-candidate gate and any assumption that diarization labels alone can establish local identity.
- **Notes:** The decision log contains only aggregate private metrics and public artifact provenance; private audio, transcript content, and filesystem paths remain outside the repository.
