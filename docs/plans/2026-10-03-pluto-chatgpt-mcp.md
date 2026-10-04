# Local Pluto connection for ChatGPT

## Outcome and revised architecture

A user allows notes access and clicks **Connect to ChatGPT** in Pluto. Pluto
registers and installs a local desktop plugin and opens ChatGPT. They start a
Work chat to discuss meetings, request feedback, compare decisions, and explore
patterns across notes. ChatGPT controls tool permissions and may need a new chat
or restart to discover the plugin.

This replaces the earlier Secure MCP Tunnel proposal following the user's
requirement for local-only hosting and a simple setup. No website, externally
hosted server, tunnel client, user-installed Node runtime, or API key is required.
The target is ChatGPT Desktop with local Work plugin support, not browser ChatGPT.
Notes remain stored locally; notes retrieved for conversation are sent to OpenAI.

## Implementation

1. Reuse Pluto's initialized database and current published notes projection.
   Expose paginated listing, literal notes/title search, and note retrieval.
   Honor user edits and deletions. Never select transcripts or recordings.
2. Serve read-only MCP tools on authenticated loopback HTTP. Reject browser
   origins and unexpected hosts, bound requests, cancel work on disconnect,
   and revoke access on disable or quit. Default access off.
3. Ship a stdio bridge executed by Pluto's bundled Electron runtime. Read the
   private connection file per request to support restarts and token rotation.
4. Register a personal local marketplace entry and plugin manifest without
   overwriting unrelated entries. Invoke ChatGPT's bundled plugin CLI through
   execFile, with no shell or user credentials. Open ChatGPT after success.
5. Present consent, pending, ready, error, disconnect, and retry states in Settings.
   Ready means local setup completed; it does not claim a successful conversation.

Tool results provide evidence, not instructions. ChatGPT should distinguish
inference from recorded facts and disclose the retrieved meetings/time range.
Follow pagination before exhaustive analytics. Notes are not verbatim transcripts.

## Work allocation

Three GPT-6.1 Sol agents at medium reasoning implemented meeting tools/local
registration, MCP transport/desktop installation, and Settings. Parent integrated
lifecycle, the bridge, packaging resources, documentation, and verification.
Existing unrelated changes are preserved. No commit or publication requested.

## Verification and remaining acceptance

Focused regression tests cover synthetic notes, privacy, pagination, edits,
protocol behavior, authentication, lifecycle, local plugin registration,
installer commands, and Settings. An official MCP client exercises the real
Electron stdio bridge. TypeScript, targeted Biome, and Vite builds validate
integration. ChatGPT's installed CLI discovered the generated fixture plugin
using a temporary marketplace configuration.

Remaining acceptance: use fictional notes in a real ChatGPT Work conversation
and verify the signed packaged runtime, installation, reload, and disconnect.
Mocked installer tests do not prove live host installation or account access.

## Sources

- [OpenAI local plugins](https://developers.openai.com/plugins/build/plugins)
- [ChatGPT plugins](https://learn.chatgpt.com/docs/plugins)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)

User guide: [ChatGPT connection](../chatgpt-connection.md).
