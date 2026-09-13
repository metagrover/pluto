### Replace regenerated commitment snapshots

- **Fixed:** Regenerating meeting notes now atomically retires every earlier commitment derived from that meeting before publishing the replacement set, preventing reviewed commitments and pending copies from appearing together.
- **Preserved:** Failed or superseded regeneration leaves the existing set untouched, manually created commitments remain active, and retired meeting-derived records retain their review history for recovery.
- **Improved:** Normal commitment publication no longer waits for owner resolution or semantic comparison model calls.
