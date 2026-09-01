### Keep People responsive as relationship history grows

- **Issue:** [#711](https://github.com/metagrover/pluto/issues/711)
- **PR:** [#712](https://github.com/metagrover/pluto/pull/712)
- **Changed:** The People list now loads through one lightweight summary query, while Pluto fetches a full evidence-backed dossier only after a person is opened.
- **Why:** Loading every person's meetings, commitments, and knowledge in the Electron main process made the page appear stuck and blocked unrelated IPC work on production-sized profiles.
- **Replaced:** One full dossier request per person during initial page load.
- **Notes:** Summary and detail reads avoid transcript, notes, and analysis payloads; explicit ownership and confirmed, scheduled, and mentioned meeting distinctions remain authoritative in the dossier.
