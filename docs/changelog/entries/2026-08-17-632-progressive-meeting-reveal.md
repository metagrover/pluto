### Reveal finished-meeting artifacts as they become ready

- **Issue:** [#632](https://github.com/metagrover/pluto/issues/632)
- **PR:** Not opened yet.
- **Changed:** Stopping a recording opens its meeting with the ready transcript expanded, while transcript and analysis use independent final-layout skeletons and replace them in place as each artifact arrives.
- **Why:** Internal validation and downstream states previously appeared as large warning cards and retry controls, making a healthy post-recording pipeline look like a failure even when useful transcript content was already available.
- **Replaced:** Normal-path validation warnings, needs-attention copy, analysis-not-ready cards, manual validation controls, and pipeline-specific meeting status badges.
- **Notes:** Transcript integrity, canonical commit eligibility, and fail-closed analysis gating are unchanged. Terminal artifact failures remain truthful in compact plain language after internal processing stops.
