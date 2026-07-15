### Surface overdue counts in the execution brief detail

- **Issue:** `#432`
- **PR:** `(pending)`
- **Changed:** The Projects execution brief now states overdue counts directly in its supporting summary line whenever commitments are slipping, including inbox-only slipping work, while routine active and empty/completed-only states keep their existing copy.
- **Why:** The heading already says `Slipping commitments`, but the supporting detail still read like generic workload volume and pushed overdue context into a side badge. This change keeps the execution brief honest about how much work is actually overdue without broadening beyond summary copy.
- **Replaced:** Generic `X open ...` detail copy for slipping execution states.
- **Notes:** This stays scoped to the execution summary detail. Heading state, project ordering, project health badges, and due badges remain on their existing issue tracks.
