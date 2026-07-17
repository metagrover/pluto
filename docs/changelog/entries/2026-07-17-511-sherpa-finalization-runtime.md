### Run credential-free diarization during recording finalization

- **Issue:** `#511`
- **PR:** `#513`
- **Changed:** Completed-recording finalization now selects Pluto's checksum-pinned sherpa-onnx sidecar when no Hugging Face token is configured, acquires the reviewed public model artifacts into managed local storage on first use, and returns anonymous speaker intervals plus content-free model provenance for evidence-gated attribution.
- **Why:** The selected local candidate only improved real recordings after it crossed the benchmark boundary into the production stop-recording pipeline.
- **Replaced:** Disabling final diarization whenever the user had not supplied a model-hub credential.
- **Notes:** Downloads use fixed credential-free GitHub release URLs and become eligible only after both pinned checksums pass. The sidecar rejects audio outside Pluto-managed meeting storage; anonymous diarization labels still cannot declare `Me` without separate acoustic evidence.
