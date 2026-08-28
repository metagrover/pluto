# Projects Redesign & Knowledge Integration

## Architecture Shift
The global "Knowledge" tab is being deprecated as a standalone navigation item. Its core sensemaking features (risks, blockers, context, evidence) are being folded directly into the **Projects** tab. Projects will no longer be simple task lists, but comprehensive "intelligence briefs". Global alerts will remain on the Dashboard.

## Level 1: Projects Overview (The Portfolio)
When navigating to the Projects tab, users see a "Borderless Portfolio" view. 
- **Layout:** Edge-to-edge list separated only by 1px horizontal dividers. No heavy cards or boxy containers.
- **Structure (Implicit Columns):**
  - **Identity (Left):** Project Title (bold), followed by a 1-2 sentence description.
  - **Analytics (Center):** Clean typographic stack of metrics: `X Tasks`, `Y People`, `Z Meetings`.
  - **Pulse (Right):** Health indicator (🟢/🟡/🔴), "Updated [Time] ago", and an attention flag if blocked or at risk.
- **Goal:** Optimize for 2-3 active projects, providing immediate, scannable data without requiring a click into the project, while maintaining a premium, text-forward aesthetic.

## Level 2: Project Dossier (Detail View)
Clicking a project opens its Dossier. This uses a split layout to separate static execution data from dynamic AI intelligence.

### Main Column (Execution & Truth)
- **Header:** Project Name, Back button, Health Status.
- **Quick Overview:** Synthesized goal/description.
- **Status Update:** The latest status. Pluto generates a draft from recent transcripts, but the user can manually edit/override it.
- **Participants:** Small circular avatars of involved people.
- **Deliverables & Tasks:** Checkbox list of action items and deadlines.
- **Risks & Unknowns:** Specific blockers and dependencies (ported from the old Knowledge page).

### Right Sidebar (Project Intelligence & History)
A dedicated panel for context and AI advice, keeping the main column clean.
- **Insights (Top):** 1-2 highly relevant, actionable suggestions from Pluto (e.g., "Health dropped. Schedule a sync with [Participant]?").
- **Recent Syncs (Bottom):** A chronological feed of the last 3-5 meetings tagged to this project, allowing quick navigation back to raw transcripts.
