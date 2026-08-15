# Background post-meeting processing implementation plan

Issue: #608

1. Add red unit tests for the background activity controller, stage deadline,
   and downstream lifecycle presentation.
2. Add a main-process IPC boundary that disables renderer throttling only while
   claimed downstream work is active.
3. Bound the analysis, entity extraction, and synthesis stages and persist a
   truthful content-free failure on timeout.
4. Render distinct processing, failed, and ready analysis states for validated
   meetings.
5. Run focused tests, the full repository checks, and a hidden-window synthetic
   Electron dry run.
6. Add the issue-scoped changelog fragment, push, review, and merge.
