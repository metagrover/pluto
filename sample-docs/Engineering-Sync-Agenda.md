# Engineering Weekly Sync & Architecture Review
**Date**: September 21, 2026  
**Attendees**: Maya Lin, Alex Chen, David Rossi, Priya Sharma

---

## Meeting Objectives
1. Review Project Starlight Q3 milestone progress.
2. Review UI refinement for reference document attachments (zero-footprint dropdown entry).
3. Resolve CoreAudio drift issues on macOS Sonoma / Sequoia.
4. Agree on SQLite ABI regression test suite before next release.

---

## Discussion Topics & Notes
- **Local Artifacts UI**: Alex demoed the new quiet inline badge row and dropdown entrypoint. No persistent card above notes. Dropzone triggers smoothly on hover.
- **Audio Synchronization**: David noted 12ms drift during Bluetooth reconnects. Fix is queued for Milestone 2 (Oct 10).
- **CoreML Whisper Quantization**: Priya tested Q4_0 quantization on M2 Max — 22% memory reduction with zero perceptible WER regression on technical jargon.
- **Action Items**:
  - [ ] Maya: Run migration benchmarks on databases with > 500 attachments.
  - [ ] David: Submit pull request for CoreAudio ring buffer retry handler.
  - [ ] Alex: Verify keyboard accessibility on the attachments text preview modal.
