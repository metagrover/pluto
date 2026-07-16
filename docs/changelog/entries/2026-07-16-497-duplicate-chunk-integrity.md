### Reject corrupted duplicate capture-journal chunks

- **Issue:** `#497`
- **PR:** `#498`
- **Changed:** Duplicate capture-journal delivery now re-hashes the already-stored chunk before returning idempotent success and rejects a same-size artifact whose bytes no longer match the acknowledged checksum.
- **Why:** Crash-safe capture depends on the journal's checksum proving the durable source artifact, not only its byte count; accepting same-size corruption would let active recording persistence look trustworthy until a later recovery scan.
- **Replaced:** Duplicate handling that compared incoming metadata and stored file size but did not verify the stored artifact checksum.
- **Notes:** Intact duplicates remain no-op idempotent, checksum failures leave the manifest unchanged, and this focused slice does not add repair, deletion, recovery UI, or retention behavior.
