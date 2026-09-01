### Let fresh profiles finish local transcription setup

- **Issue:** [#707](https://github.com/metagrover/pluto/issues/707)
- **PR:** Pending.
- **Changed:** Parakeet model integrity checks now produce the same digest under normal and symlinked macOS data directories.
- **Why:** Fresh development profiles could download the complete local transcription model and then reject the valid bundle because `/var` and `/private/var` produced different relative paths inside the hash.
- **Replaced:** Integrity input paths that could accidentally include the canonical temporary-directory prefix after resolving only the model root.
- **Trust boundary:** Pinned model revisions and content hashes remain required. Changed files and embedded symlinks still fail verification.
- **Notes:** Existing model digests and manifests do not change; the correction only makes the same verified bytes portable across equivalent macOS filesystem aliases.
