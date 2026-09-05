### Make remembered voices durable and visible in People Pro

- **Issue:** [#768](https://github.com/metagrover/pluto/issues/768)
- **PR:** Pending.
- **Changed:** Speaker review now carries each stored candidate's exact transcription revision into matching, rejection, and enrollment; enrollment remains available when automatic suggestions are disabled; and newly created People are enrolled through the person ID returned by the confirmed meeting binding. Enrollment failures stay visible instead of silently advancing. People Pro now distinguishes a profile-loading failure from a person who has no enrolled voice.
- **Why:** Checking “Remember this voice for future meetings” could save the meeting identity while silently rejecting or skipping the voice enrollment, leaving recurring peers unidentified and their People Pro Voice Profile empty.
- **Replaced:** Placeholder `gen-1` candidate revisions, silent enrollment failures, and People Pro's ambiguous empty state after a profile read failure.
- **Notes:** Existing failed attempts cannot be reconstructed because no biometric candidate or enrollment was persisted. Automatic suggestions remain default-off pending the existing private calibration gate, and historical meetings without bounded candidate evidence remain manual-identification only unless their transcript is explicitly regenerated.
