# Pluto Knowledge Tab Blueprint

## 1. Core Use Cases & Feature Set
To make the graph useful, you need to move beyond just "nodes." Think of the tab as a Multi-Dimensional Discovery Engine.

**Must-Haves:**
- **Entity Detail Pages:** Clicking "Project X" shouldn't just show a list of meetings. It should show a "Synthetic Summary"—an AI-generated overview of the project's current status, key stakeholders, and a timeline of major decisions gathered across all meetings.
- **Bi-directional Backlinks:** If I’m looking at "Person Y," I need to see every meeting they attended, every action item assigned to them, and every project they are linked to.
- **Temporal Navigation (The Timeline):** Meetings are chronological. Users often remember when something happened. A "Time-Travel" slider that filters the graph to show only entities active in "Q3 2025" is a massive UX win.
- **The "Unlinked" Inbox:** A place for entities the AI isn't sure about yet. This lets the user "confirm" links, which improves your graph's accuracy over time.

**Nice-to-Haves:**
- **Conflict Detection:** AI flags when "Meeting A" and "Meeting B" have contradictory information about a project deadline or owner.
- **Proactive "Knowledge Gaps":** Pluto tells you, "You’ve talked about Project Alpha in 10 meetings, but no owner has been defined. Want to assign one?"

## 2. UX/UI Paradigms & Layout
The "Node-and-Edge" visual graph (like Obsidian) is sexy for marketing but often useless for actual work once you have 500+ nodes. It becomes "spaghetti."

**The Recommendation: The Hybrid "Spatial-Structured" Layout**

*The Three-Pane System:*
1. **Left Sidebar (The Navigator):** Categorized lists of Entities (People, Projects, Topics). Use a "Smart Filter" here (e.g., "Recently Active").
2. **Center Canvas (The Workspace):** This is where you use a Card-based layout (think Heptabase). Instead of dots, use small cards that preview the entity. Users can drag these around to "cluster" them manually.
3. **Right Sidebar (The Inspector):** When an entity is selected, this pane opens. It contains the "Ask Pluto" chat, the full entity summary, and the raw links to transcripts.

*Traversal:* Use "Breadcrumbs" that show the path of discovery (e.g., Project Alpha > Meeting March 12 > Decision: Budget Increase). This makes moving back and forth feel natural.

## 3. AI Integration ("Ask Pluto Intelligence")
Don't treat the chat as a separate feature; treat it as the Graph Pilot.

- **Contextual Chat:** If I’m on the "Project X" page, the AI should already have the entire context of that project loaded into its prompt. I shouldn't have to say "Tell me about Project X." I should just ask, "What’s the biggest blocker here?"
- **The "Natural Language Filter":** Instead of complex UI dropdowns, let the user type into a bar: "Show me all meetings where we discussed the API migration with the Engineering team last month." The graph should then visually filter and highlight those nodes.
- **Synthesized Views:** The AI shouldn't just find data; it should create it. If I select three different projects, the AI should offer a "Compare & Contrast" summary button.

## 4. Technical & Architectural Considerations
As a Senior Engineer, you know the frontend will choke if you try to load a 2,000-node graph into the DOM.

**Frontend Scaling Patterns:**
- **Lazy-Loaded Clusters:** Don't fetch the whole graph. Fetch the "neighborhood." When a user clicks a node, fetch its 1st and 2nd-degree connections.
- **Virtualization:** If you use a list or table view, use `react-window` or `@tanstack/react-virtual`. For the graph, use a library that supports Canvas or WebGL rendering (not SVG).
- **State Management:** Use TanStack Query (React Query) for caching. It’s perfect for entity-based data where you want to keep "Project X" in the cache so it loads instantly when the user navigates back to it.

**Recommended React Libraries:**
- **React Flow:** Best for a "Whiteboard" or "Card" feel. It’s highly customizable and handles "edges" between cards very well. It's more about the workspace than a massive data visualization.
- **Sigma.js:** If you really want a massive visual graph. It uses WebGL and can handle hundreds of thousands of nodes smoothly.
- **Visx (by Airbnb):** If you want to build a custom, highly branded visualization. It gives you the power of D3 but with a clean React component API.

**Potential Pitfall to Avoid:**
*The "Hallucinated" Connection:* The biggest risk is the AI linking "John from Marketing" with "John from Engineering" because it didn't distinguish the entities.
*Fix:* Always provide a "Source Link" (the exact transcript snippet) next to every link in the graph. If a user sees a weird connection, they must be able to verify it in one click.
