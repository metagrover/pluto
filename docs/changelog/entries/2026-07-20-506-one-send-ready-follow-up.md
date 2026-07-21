### Make meeting follow-ups send-ready

- **Issue:** `#506`
- **PR:** `#527`
- **Changed:** Follow-up Drafts now presents one evidence-backed Email, Internal, or Slack variant at a time, makes Copy primary, saves versioned per-format edits, preserves those edits when meeting context changes, and explains weak evidence honestly.
- **Why:** A concise message the user can review and send is more useful and trustworthy than three simultaneous exports filled with internal meeting metadata.
- **Replaced:** Three equal draft editors, manual bulk saving, metadata-heavy deterministic templates, and the claim that missing actions or decisions means no follow-up is needed.
- **Notes:** Deterministic composition remains credential-free; model refinement is optional, preserves edited variants, and adds no outbound email or Slack integration.
