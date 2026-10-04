# Discuss Pluto meeting notes in ChatGPT

Pluto can serve its current meeting notes through a private, read-only MCP
connection. ChatGPT can use the notes for discussion, feedback, comparisons,
patterns, and follow-up drafts. It does not gain recording controls, edits,
deletion, raw transcript access, or direct database access.

The database remains on your Mac. Notes returned to ChatGPT are sent to OpenAI
and become part of that conversation. Disabling the connection stops future
reads; it cannot remove content already shared with ChatGPT.

## Connect on your Mac

1. Keep Pluto and a current ChatGPT Desktop with local plugin support installed.
2. In Pluto, open **Settings → Advanced → ChatGPT connection**.
3. Allow meeting-note access and click **Connect to ChatGPT**.
4. Fully quit ChatGPT (⌘Q) and reopen it to load the local plugin. Opening
   another window is not enough. Keep Pluto running with access enabled.
5. Start a new Work chat in ChatGPT and mention Pluto. ChatGPT controls tool
   permissions. If tools failed to load before setup finished, use a new chat.

The button registers and installs the local plugin through ChatGPT's bundled
CLI, then opens ChatGPT. No website, hosted server, tunnel, terminal command,
separate Node installation, or OpenAI API key is needed. This integration targets
ChatGPT Desktop's local Work plugins; merely installing a desktop version
without local plugin support does not make it compatible.

Pluto and ChatGPT communicate on the same Mac. Pluto ships the stdio bridge and
uses its bundled Electron runtime. Its service listens only on `127.0.0.1` with
a random credential in a private connection file. The plugin is registered in
the personal local marketplace, preserving other entries. **Ready for ChatGPT**
confirms local setup, not a successful conversation or account authorization.

See OpenAI's [local plugin documentation](https://developers.openai.com/plugins/build/plugins).

## Tools and conversations

- `pluto_list_meetings`: paginated meeting titles, dates, source IDs, and note availability.
- `pluto_search_meetings`: literal phrase search across current titles and notes, with snippets and pagination.
- `pluto_get_meeting`: a selected meeting's current notes, revision, trust status, and text pagination.

Examples with fictional context:

- “Find the Cedar planning meeting and discuss the decisions with me.”
- “What assumptions in those notes should I challenge?”
- “Compare the last three planning meetings. What changed?”
- “Review the commitments and suggest a follow-up draft.”

Pluto exposes saved notes and tool usage information without prescribing an
answer format, citation style, or reasoning workflow. ChatGPT handles the
conversation. Note contents are untrusted evidence, not instructions, and notes
are not verbatim transcripts. Tool results expose pagination and missing notes.

`sourceId` is a stable citation identifier such as
`pluto://meetings/example-meeting/notes`, not a registered clickable deep link.
Find the cited meeting by title/date in Pluto. Changing notes during pagination
can change results; `sourceRevision` identifies the fetched note revision.

## Disconnect and troubleshoot

- **Disable access** in Pluto revokes the local credential and closes connections.
  The plugin remains installed but cannot retrieve notes while access is off.
- Quitting Pluto stops the listener and removes the credential file. Previously
  enabled access restarts with a new credential on the next launch.
- Keep Pluto running and the Mac awake. The bridge reloads connection details
  on each request after Pluto restarts.
- If setup fails, ensure ChatGPT Desktop supports local plugins, update it, and
  try connecting again. Existing foreign plugin files are never overwritten.
- Packaged Pluto ships the bridge in Resources/mcp; development uses resources/mcp
  and a separate pluto-notes-development plugin name.

## Validation status

Automated tests use fictional notes, the official MCP client, and a real Electron
child process. The installed ChatGPT CLI successfully discovered a generated
fixture plugin. Automatic host installation is covered with mocked commands;
a real ChatGPT conversation and a signed packaged Pluto build still need an
end-to-end acceptance check. No production meeting data was connected in tests.

## Connection reliability

The bridge answers initialization and tool discovery from SDK-generated metadata
in Pluto's private connection file. Discovery does not wait for the HTTP service
or an outstanding note read. Notes are still fetched over authenticated loopback
HTTP; unavailable data produces a tool error. Disabling access removes the file
and revokes reads. After updating an already-running bridge, start a new chat
to load its replacement.

Verification includes a deliberately stalled HTTP service with an outstanding
note read, live discovery through ChatGPT's bundled backend, and successful
listing and note retrieval through the installed Pluto plugin. This does not
guarantee how ChatGPT will phrase or choose tools for every question.
