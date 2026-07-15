### Persist per-interval capture journals during recording

- **Issue:** `#456`
- **PR:** `Pending.`
- **Changed:** Pluto now creates a per-meeting capture journal as recording starts, writes each already-formed mic and system interval blob durably through the main process during capture, and seals a versioned manifest when recording stops.
- **Why:** The recording pipeline previously kept interval blobs in renderer memory until stop/finalization, which meant a crash could wipe acknowledged capture before Pluto wrote the first recoverable artifacts. This change moves the existing interval seam behind a durable journal without changing transcript policy yet.
- **Replaced:** Waiting until finalization to write the first recoverable capture artifacts.
- **Notes:** This slice stays focused on journal creation, append idempotency, and seal state. Restart discovery, session-file reconstruction, and recovered-recording UX remain on `#438`.
