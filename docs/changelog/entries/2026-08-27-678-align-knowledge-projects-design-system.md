### Align Knowledge and Projects surfaces with Pluto design system

- **Issue:** `#678`
- **PR:** `#636`
- **Changed:** Knowledge, Projects, and FocusSheet now use semantic design tokens (`--pro-success`, `--pro-urgent`, `--pro-warning`, `--pro-accent`), the shared `PageHeader` component, an editorial executive briefing banner on Projects, and normalized typography and corner radii.
- **Why:** The Knowledge and Projects pages had diverged with hardcoded Tailwind colors, inconsistent typography weights, and non-existent CSS classes (`text-pro-text-primary`), breaking dark mode adaptability and editorial visual hierarchy.
- **Replaced:** Hardcoded color classes in status/health badges and flat list headers on Projects.
- **Notes:** This metadata repair makes the existing fragment conform to changelog validation; it does not change Knowledge or Projects behavior.
