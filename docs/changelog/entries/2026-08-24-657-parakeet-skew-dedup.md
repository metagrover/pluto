### Remove strongly evidenced skewed Parakeet duplicates

- **Issue:** [#657](https://github.com/metagrover/pluto/issues/657)
- **PR:** Not created; committed directly to master at the user's request.
- **Changed:** Parakeet final transcripts materialize microphone and System audio from the same sealed-journal clock, remove aligned cross-channel bleed, credit removed pass-through as explained capture activity, and collapse exact canonical rows created by speaker relabeling.
- **Why:** Saving the microphone from a concatenated browser blob compressed startup gaps while System used timed journal reconstruction, shifting otherwise identical speech beyond the duplicate matcher's safety bound. Correctly removed pass-through could then fail validation because the integrity gate did not count it as explained mic activity.
- **Replaced:** Asymmetric browser-mic and journal-System finalization, plus direct timestamp matching alone for historical cross-channel clock skew.
- **Notes:** The browser mic blob remains a fallback when sealed mic reconstruction fails. Historical skew calibration still requires three independent unique four-word anchors, a 75% dominant cluster, and an absolute offset no greater than 2.5 seconds; ambiguous overlapping speech remains unchanged.
