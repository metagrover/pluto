### Keep recording ownership singular across renderer lifecycles
- **Issue:** [#601](https://github.com/metagrover/pluto/issues/601)
- **PR:** [#604](https://github.com/metagrover/pluto/pull/604)
- **Changed:** The Electron main process now grants one active capture lease, binds native system audio to its renderer owner, rejects conflicting recording starts before microphone acquisition, and prevents active recording pages from unloading.
- **Why:** Renderer-local guards could reset independently from capture resources, allowing a new recording UI to coexist with work still owned by an earlier lifecycle.
- **Replaced:** Renderer-only recording ownership and mutable main-window routing for native system-audio chunks.
- **Notes:** Duplicate starts are idempotent only for the same synthetic meeting key and renderer owner; interrupted durable journals remain recoverable through the existing startup path.
