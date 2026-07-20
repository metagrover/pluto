### Reject capture journals outside their artifact boundary

- **Issue:** `#505`
- **PR:** `#524`
- **Changed:** Capture-journal operations now reject unsafe meeting identities and non-canonical manifest or chunk paths before filesystem mutation or recovery reads.
- **Why:** Recovery manifests are durable evidence; corrupt identity or path fields must not redirect trusted recording reads outside the meeting artifact directory.
- **Replaced:** Version-1 manifest reads that validated only the schema version before trusting manifest-controlled paths.
- **Notes:** Valid journal schema and create, append, duplicate, seal, and recovery behavior are unchanged; retention, recovery UI, and transcript policy remain out of scope.
