### Align recording navigation with macOS window controls

- **Issue:** [#743](https://github.com/metagrover/pluto/issues/743)
- **PR:** Pending.
- **Changed:** The recording workspace Back control is now a compact accessible arrow aligned with the macOS traffic-light row.
- **Why:** The prior text pill cleared the native controls horizontally but sat below their vertical center, weakening the titlebar/navigation relationship.
- **Replaced:** The full-width Back home pill inside the recording-status flow.
- **Preserved:** Recording status, elapsed time, capture health, Finish behavior, keyboard access, and compact-window layout are unchanged.
- **Notes:** The control retains an accessible name and tooltip while its visible treatment follows the compact native-navigation reference.
