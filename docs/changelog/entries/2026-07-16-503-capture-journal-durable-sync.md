### Sync capture-journal writes before acknowledgement

- **Issue:** `#503`
- **PR:** `Pending`
- **Changed:** Capture-journal chunk and manifest writes now sync temporary files before atomic rename and sync the containing directory after rename, with acknowledgement withheld if either stable-storage boundary fails.
- **Why:** Atomic rename prevents torn visible files, but it does not alone prove acknowledged audio and manifest entries survived an OS crash or power loss.
- **Replaced:** Capture-journal persistence that resolved after `writeFile` and `rename` without an explicit stable-storage sync.
- **Notes:** Existing journal schemas, duplicate-delivery behavior, checksum validation, sealing, and recovery semantics remain unchanged; this focused slice does not add cleanup or retry policy.
