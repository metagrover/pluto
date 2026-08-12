### Remove the Meeting View follow-up email draft surface

- **Issue:** `#613`
- **PR:** pending
- **Changed:** Meeting View no longer renders the send-ready follow-up draft composer, and the renderer no longer exposes IPC paths for saving or regenerating Email/Internal/Slack draft variants.
- **Why:** The email-shaped follow-up surface did not have a clear near-term business need and risked making generic generated prose feel like a trusted meeting outcome.
- **Replaced:** The prior Meeting View draft/export composer with the existing evidence-backed meeting summary and durable follow-up lifecycle surfaces.
- **Notes:** Legacy `follow_up_drafts_json` storage remains in place so existing local databases continue to open without a schema migration.
