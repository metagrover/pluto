### Proactive calendar session auto-naming, start prompts, and silence-based auto-stop

- **Issue:** [#747](https://github.com/metagrover/pluto/issues/747)
- **PR:** [#752](https://github.com/metagrover/pluto/pull/752)
- **Changed:** Added proactive calendar event detection at recording startup that immediately sets session titles and pre-populates attendee lists from scheduled calendar events (±15 minute window) without waiting for finalization. Added non-intrusive floating pill start prompt banners for upcoming or starting conference meetings (Zoom, Google Meet, Teams, Webex, Slack) when idle with 1-click recording start. Implemented capture silence watchdog that automatically seals the capture journal and ends sessions with explicit `end_reason` when continuous silence extends past the scheduled meeting end time or when conference audio ceases, and pushes desktop notifications when notes are ready. Added user configuration toggles and timeout selector in Settings → Meetings.
- **Why:** Reduces manual input friction when starting sessions during scheduled meetings, prevents missing recordings for active video conference calls, and avoids bloating capture records with trailing silence when users forget to stop recording.
- **Replaced:** Manual session naming, empty initial attendee states, and manual-only session stopping.
- **Notes:** Configurable via Settings → Meetings with options for 3m, 5m (default), 10m, or disabled silence auto-stop.
