### Publish the immutable speaker-model bundle

- **Issue:** `#529`
- **PR:** `#530`
- **Changed:** Published Pluto's selected sherpa-onnx 1.13.4 segmentation and embedding artifacts from a public Pluto-controlled immutable release, recorded exact transport and installed checksums and sizes, and added the shipped legal/provenance notice.
- **Why:** The app-managed model lifecycle cannot be credential-free, resumable, or legally reviewable while it depends on mutable upstream URLs or user-supplied model-hub access.
- **Replaced:** Direct runtime dependence on upstream release objects without a Pluto-controlled immutable distribution contract or application-shipped license notice.
- **Notes:** The release contains no private benchmark, meeting, transcript, credential, or local-path data. Runtime manifest, acquisition, activation, and rollback implementation remain in `#476` after this distribution contract lands.
