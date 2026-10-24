# Discuss Pluto meeting notes in Claude

Pluto gives Claude Desktop read-only access to saved meeting notes on the same
Mac. You can search meetings, compare decisions, and discuss follow-ups. The
connection exposes the same three tools as the [ChatGPT connection](chatgpt-connection.md):
`pluto_list_meetings`, `pluto_search_meetings`, and `pluto_get_meeting`.
It does not expose raw transcripts, audio, database access, edits, or recording controls.

## Connect on your Mac

1. Install a current Claude Desktop with local MCP support.
2. Open **Settings → Advanced → Claude connection** in Pluto.
3. Read the disclosure, allow meeting-note access, and click **Connect to Claude**.
4. Fully quit Claude (⌘Q), then reopen it. Keep Pluto running with access enabled.
5. Start a new chat in Claude. In the **+ → Connectors** menu, check for
   **pluto-notes**. Development builds use **pluto-notes-development**.
6. Ask “Use Pluto to tell me what we decided in my latest meeting.” Allow note
   reads when Claude asks.

No separate Node installation or Anthropic API key is required. Pluto uses its
bundled Electron runtime and the shipped stdio MCP bridge. This setup targets
Claude Desktop's local MCP configuration, rather than a remote web connector.
See the [official local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

## Privacy and independent access

Claude can read all saved meeting notes when enabled. Retrieved notes are sent
to Anthropic and become part of the Claude conversation. Raw transcripts and
audio are excluded. Notes remain evidence, not instructions, and may differ
from a verbatim transcript; results include source identifiers and revisions.

ChatGPT and Claude have independent consent settings, private credential files,
and authenticated loopback listeners. You can use both at once. Disabling one
does not stop the other. **Disable access** revokes that connection immediately;
it cannot remove notes already shared with the external app. Quitting Pluto
revokes both listeners and removes their credentials. Previously enabled
connections restart with fresh credentials on the next launch.

## Configuration and troubleshooting

- Setup merges Pluto's entry into
  `~/Library/Application Support/Claude/claude_desktop_config.json`, preserving
  other connectors and preferences. Before a changed existing config is replaced,
  Pluto saves its original bytes in a private `.pluto-backup-*.json` file in the
  same directory. The generated entry contains no credentials; Pluto credentials
  stay in its private connection file. Backups preserve the original configuration
  and are readable only by your user account.
- Malformed configuration, symbolic links, or a conflicting Pluto entry cause
  setup to fail without overwriting the config. Fix the configuration through
  Claude's Developer settings, then disable access in Pluto and reconnect.
  Another Pluto profile's entry is treated as a conflict; development and release
  builds have distinct names and can coexist.
- **Note access enabled** means Pluto prepared local access. It does not confirm
  that Claude has loaded the connector or successfully answered a question.
- Update Claude Desktop, fully restart it after connecting, and check its
  Developer settings for connection errors. Organization policies may restrict
  local connectors. Pluto does not bypass those policies.
- Disabling leaves the connector configured, but it cannot read notes. Remove
  Pluto's entry in Claude's Developer configuration if you also want to remove
  it from Claude's list. Keep unrelated entries intact.
- Keep Pluto running and your Mac awake. A missing app can be installed after
  setup; use **Open Claude Desktop** again once installed.

## Verification boundary

Automated tests cover configuration preservation, conflicts, private backups,
separate development identities, informed consent, and independent revocation.
An official MCP client launches the generated Claude command using a real
Electron child process, reads fictional notes, and checks that disabling either
connection leaves the other working. Real Claude conversation behavior and a
signed packaged app still require a manual acceptance check. Tests do not
connect production meeting data to either service.
