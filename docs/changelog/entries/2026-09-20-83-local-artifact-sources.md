### Add local notes and PDF documents as first-class Pluto sources
- **Issue:** [#83](https://github.com/metagrover/pluto/issues/83)
- **PR:** Pending.
- **Changed:** Pluto now imports Markdown notes, plain-text documents, and PDF files through a dedicated Sources surface (with native file picker dialog or drag-and-drop), persists extracted text with local provenance, indexes text in SQLite FTS5 with BM25 ranking, lets users reversibly mark sources included, noisy, or excluded, or permanently delete them, and retrieves active artifacts in Chat with Pluto with source-specific citations and direct navigation.
- **Why:** Meetings are only part of a user's durable context. Local notes and research documents should participate in evidence-backed recall without requiring cloud storage or disguising artifacts as meetings.
- **Replaced:** Treating meeting records as the only source type available to Pluto's global retrieval path and using in-memory string filters.
- **Notes:** Uses `unpdf` for fast, zero-dependency, on-device PDF text extraction with a 15 MB threshold for PDFs and 5 MB for text notes.
