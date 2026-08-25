### Make the recording loop immediate and trustworthy

- **Issue:** [#664](https://github.com/metagrover/pluto/issues/664)
- **PR:** Not created yet.
- **Changed:** New meeting now enters a visible starting state immediately, Finish moves straight to a local processing document, and live plus saved transcripts split long same-speaker runs into readable presentation turns without changing evidence.
- **Why:** Recording clicks and transitions should never resemble failure, and transcript presentation should support glancing during a call and reading afterward.
- **Replaced:** Silent asynchronous startup, a live timer that continued through finalization, a fixed narrow transcript rail, and unbounded same-speaker paragraph merging.
- **Notes:** Canonical Parakeet finalization, source attribution, timestamps, transcript integrity, and downstream analysis eligibility remain unchanged; related channel-alignment and readability safeguards stay owned by #657 and #659.
