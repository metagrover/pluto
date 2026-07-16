### Isolate interrupted recording recovery failures

- **Issue:** [#499](https://github.com/metagrover/pluto/issues/499)
- **PR:** Pending.
- **Changed:** Launch recovery now treats each interrupted capture journal as an independent recovery transaction, continues after stitch or persistence failures, and reports an aggregate failed-journal count in the existing content-free recovery summary.
- **Why:** One damaged recording should never prevent Pluto from restoring other healthy acknowledged audio during the same launch.
- **Replaced:** An all-or-nothing recovery scan where one per-journal exception aborted every later recovery candidate.
- **Notes:** Failed manifests and chunks remain untouched for a later launch; this slice adds no automatic retry, deletion, transcript finalization, or recovery UI.
