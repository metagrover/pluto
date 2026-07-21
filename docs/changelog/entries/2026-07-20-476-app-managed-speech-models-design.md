### Design app-managed credential-free speech models

- **Issue:** `#476`
- **PR:** `#528`
- **Changed:** Defined a versioned application-shipped manifest, identity-bound resumable acquisition, immutable model versions, crash-durable activation state, offline health probing, non-destructive legacy adoption, and explicit rollback for Pluto's selected sherpa-onnx bundle.
- **Why:** Credential-free local diarization needs to survive interrupted acquisition and failed upgrades without corrupting or replacing the last healthy model state.
- **Replaced:** Fixed-directory downloads from upstream URLs with no persistent active version, previous-healthy pointer, lifecycle lock, resumable partial identity, health probe, shipped legal notice, or rollback contract.
- **Notes:** Runtime implementation waits for separate written-spec approval and publication of reviewed immutable Pluto-controlled release artifacts; garbage collection, legacy deletion, optional Hugging Face UI removal, remote manifests, generic model management, and automatic inference rollback remain out of scope.
