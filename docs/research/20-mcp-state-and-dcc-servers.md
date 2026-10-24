# 20 — MCP in October 2026 and what DCC/creative MCP servers teach us

> Research note for Ekza Animator, milestone **M-AI** (the MCP/agent bridge over operators, FR-EXT-06, pulled
> forward from M5). Date: 2026-10-19. Status: evidence for the M-AI spec; nothing here is decided until the owner
> accepts it.
> Scope: (1) the state of the Model Context Protocol — revision, features, transports, auth, the TypeScript SDK, how
> clients configure local servers, client limits and security guidance; (2) a survey of MCP servers for DCC and
> creative tools (a popular open-source DCC, a leading commercial desktop DCC, Unity, Unreal, Cascadeur, Figma, Spline,
> PlayCanvas, Pascal, three.js, VRMA Lab and others; the first two are "the open-source DCC" and "the desktop DCC"
> below):
> what makes them good or bad, tool-design lessons, and what could be reused under our licence policy (ADR 0009).
> Method: specification pages and `schema.ts` of revision 2026-07-28, the TypeScript SDK `docs/` tree on `main`,
> npm registry metadata (`npm view`, 2026-10-19), GitHub and Gitea REST metadata (licence, activity), vendor
> documentation (Claude Code, Claude Desktop/MCPB, Cursor, VS Code, Codex, Unity, Unreal, Figma, Spline, Chrome),
> and READMEs plus selected source files of the surveyed servers. Items marked **(unverified)** rest on secondary
> sources only. All versions, counts and limits carry the date above; this field moves monthly.
> Related: the operator registry as the agent API — [research 08](08-extensibility-modeling.md) §5.2 and
> [ADR 0008](../adr/0008-operator-tool-editor-registries.md); Cascadeur MCP and VRMA Lab's agent SDK —
> [research 05](05-landscape.md) §2.3 and §3.7; declarative `ParamDef`/`paramSchema` — M6A-SPEC §4.1 (branch
> `m6a/spec`); the AI-generation boundary — [ADR 0017](../adr/0017-ai-generation-boundary.md) and
> [research 15](15-ai-3d-generation.md).

---

## 0. Findings in one screen

| # | Finding | Consequence for M-AI |
|---|---|---|
| F1 | The current MCP revision is **2026-07-28**, a breaking *stateless* rewrite: no `initialize` handshake and no protocol sessions, a mandatory `server/discover`, a per-request `_meta` envelope, multi-round-trip requests (`resultType: "input_required"`) instead of server-to-client requests, `subscriptions/listen` instead of resource subscribe. **Roots, Sampling and Logging are deprecated**; Tasks moved out of the core into an extension [MCP-CL-2026]. Clients negotiate per connection, so many connections still run 2025-11-25. | Serve **both protocol eras** from one server factory (the v2 SDK's `serveStdio` does this by default). Build only on what both eras have: tools with output schemas, structured and image content, annotations; resources; prompts; progress; cancellation. Never depend on sampling, roots or protocol logging. |
| F2 | TypeScript SDK **v2** (`@modelcontextprotocol/server` 2.3.1, Apache-2.0, ESM-only, Node ≥ 20, dependencies `zod ^4.2` + `@modelcontextprotocol/core`) is the stable line since 2026-07-27 and the only one that speaks 2026-07-28. **v1** (`@modelcontextprotocol/sdk` 1.32.1, MIT) gets fixes for at least six months and never gets 2026-07-28 [TS-SDK][NPM]. | Use v2. Apache-2.0 is on our CI allowlist. `fromJsonSchema()` registers a tool from a plain JSON Schema, so operator tools can come straight from `paramSchema(ParamDef[])` (M6a) with no second schema copy. |
| F3 | A local server is a **stdio child process launched by the client**. Every client takes the same `command` + `args` shape: Claude Code (`claude mcp add <name> -- <cmd>`, `.mcp.json`), Claude Desktop (`claude_desktop_config.json` or a one-click `.mcpb` bundle), Cursor (`.cursor/mcp.json`), VS Code (`.vscode/mcp.json`, key `servers`), Codex (`[mcp_servers.<name>]` in `config.toml`) [CC-MCP][MCP-LOCAL][MCPB][CURSOR][VSCODE][CODEX]. | Ship one npm bin runnable with `npx -y`, five copy-paste snippets, a committed `.mcp.json` for contributors, a Claude Code plugin with a skill, and later an `.mcpb`. |
| F4 | Client budgets shape the API. Claude Code defers MCP tool definitions behind **tool search** by default, cuts descriptions and server instructions at 4,096 characters (16,384 for a deferred tool), warns at 10,000 tokens of tool output and caps it at 25,000, and drops a tool whose full name `mcp__<server>__<tool>` exceeds 128 characters [CC-MCP]. The Claude API accepts tool names matching `^[a-zA-Z0-9_-]{1,128}$` — no dots [CLAUDE-TOOLS]. An image costs ⌈w/28⌉ × ⌈h/28⌉ visual tokens (1000 × 1000 px ≈ 1,296) [CLAUDE-VISION]. | `snake_case` tool names (operator ids such as `anim.key.insert` go into arguments, never into tool names); 25–35 tools with the searchable words first in each description; summaries with drill-down and paging; screenshots ≤ 1024 px on the long edge. |
| F5 | DCC servers follow three designs: **code execution** (the code tools of both open-source-DCC servers, Spline `3d_run_code`, Figma `use_figma`), **typed verbs** (PlayCanvas Editor, 130 tools; Pascal, 45 tools; Unity MCP, 50 tools in groups; the community Cascadeur server, 36 tools) and **progressive disclosure** (Unreal 5.8 exposes three meta-tools `list_toolsets` / `describe_toolset` / `call_tool`; Unity's `manage_tools` activates groups). | Typed verbs for the 25–35 animation jobs, plus progressive disclosure (`list_operators` / `describe_operator` / `run_operator`) for the long tail of operators. **No code-execution tool.** |
| F6 | The useful creative servers close the loop **visually**: the community open-source-DCC server's `look` (viewport, camera, auto-framed multi-angle sheet, animation frame strip), VRMA Lab's fixed quad-view review, PlayCanvas runtime screenshots, Figma `get_screenshot`, Spline screenshots. | A `capture` tool with presets (quad sheet, frame strip, one pane or camera) returning image content plus a structured caption (frame, camera, character). |
| F7 | Two MIT TypeScript **browser editors** are the closest analogues. **PlayCanvas Editor MCP** is a stdio server that listens on `127.0.0.1:52000` for a WebSocket from the browser editor, checks the `Origin`, waits for the user to click CONNECT, drives one editor at a time and hands the port over between server instances [PLAYCANVAS]. **Pascal** (a React Three Fiber editor) runs its MCP server **headless in Node on the same scene core** the UI uses; an open editor tab follows the agent's edits through a shared local store and an event stream, and a stdio connector reads the dynamic loopback port and a bearer token from local files, so client configs hold neither [PASCAL][PASCAL-CONNECTOR]. Spline keeps its server in the desktop app because "the MCP connection does not work from the browser" [SPLINE]. | The live bridge follows the PlayCanvas shape and adds a pairing secret; the headless leg follows Pascal. Chrome's **Local Network Access** permission gates a public HTTPS page connecting to loopback (fetch since Chrome 142, WebSocket since Chrome 147) [LNA]: design the first-connect UX around that prompt. |
| F8 | The security record: unauthenticated localhost ports (MCP Inspector, CVE-2025-49596, CVSS 9.4) [CVE-INSPECTOR]; arbitrary-code tools (the official open-source-DCC server: "will execute LLM generated code in [the DCC] without any guards in place") [OSS-DCC-LAB]; prompt injection through tool results (the GitHub and Atlassian MCP exploits) [WILLISON-GH]; tool poisoning and rug pulls [POISON]. The spec requires `Origin` validation and recommends binding to 127.0.0.1, a human able to deny calls, and treating annotations as untrusted hints [MCP-SEC][MCP-TOOLS]. | No code tool; file access rooted in one workspace directory; `Origin` allowlist plus a per-launch secret; every agent edit visible as an "AI: …" undo entry with a stop control; strings that come from imported assets are untrusted data in results. |
| F9 | Vendors add a **CLI plus Agent Skills** next to, or instead of, MCP: Unity deprecated its in-Editor MCP server in favour of the Unity CLI (`unity mcp`, `unity command`, `unity skill install`) [UNITY-CLI]; Playwright recommends its CLI with skills for coding agents [PW-MCP]; Figma ships its server inside a plugin bundled with skills [FIGMA]. | The same package offers `mcp` (the stdio server) and direct subcommands for headless batch jobs, and ships a skill with animation workflows. |
| F10 | **WebMCP** (`document.modelContext.registerTool`, a W3C Community Group draft) is in origin trial in Chrome 149 and Edge 150; ChatGPT Desktop supports it and Brave Leo has it experimentally; no Claude client is listed [WEBMCP][WEBMCP-OT]. | A thin WebMCP adapter over the same tool table is cheap later; it is not the M-AI transport. |
| F11 | **MCP Apps** (`io.modelcontextprotocol/ui`) render a server's `ui://` HTML in a sandboxed iframe inside Claude (web and desktop), ChatGPT, VS Code, Cursor, Goose and others [MCP-APPS][MCP-EXT-MATRIX]; the community open-source-DCC server already shows a live viewport inline [OSS-DCC-MCP]. | Later: an inline clip preview. Every tool must still return useful text and images for clients without the extension. |
| F12 | Undo semantics separate the good servers from the rest. Pascal states it: "Mutation tools are captured by Zundo's temporal middleware as a single undoable step", and its batched `apply_patch` is validated and dry-run before commit [PASCAL]. PlayCanvas exposes undo and redo as tools; the community open-source-DCC server tells users to save first; Unreal and Unity are silent. ADR 0008 already makes one operator run one transaction and one history step. | State the guarantee in the M-AI spec and README: every agent call is one labelled, undoable step in the user's History. Among DCC servers only Pascal makes the same promise. |

---

## 1. MCP as of October 2026

### 1.1 Revisions

The protocol is versioned by date; a revision changes only when backwards-incompatible changes land, and
deprecated features stay at least twelve months (ninety days under an expedited exception) before removal
[MCP-VER].

| Revision | What arrived (relevant to us) |
|---|---|
| 2024-11-05 | First public revision: tools, resources, prompts, sampling, roots, stdio and HTTP+SSE transports. |
| 2025-03-26 | OAuth 2.1 authorization framework; **Streamable HTTP** replaces HTTP+SSE; **tool annotations** (read-only, destructive, …); audio content; `message` on progress notifications; completions capability [MCP-CL-2503]. |
| 2025-06-18 | **Structured tool output** (`outputSchema` + `structuredContent`); **elicitation**; resource links in tool results; `title` fields; MCP servers classified as OAuth resource servers with RFC 8707 resource indicators; JSON-RPC batching removed [MCP-CL-2506]. |
| 2025-11-25 | Icons on tools/resources/prompts; tool-name guidance (SEP-986); URL-mode elicitation; tool calling inside sampling; experimental tasks; Client ID Metadata Documents (CIMD); JSON Schema 2020-12 as the default dialect; input-validation failures reported as tool execution errors so models can self-correct (SEP-1303) [MCP-CL-2511]. |
| **2026-07-28** (current) | Stateless core: sessions, `Mcp-Session-Id` and the `initialize` handshake removed; `server/discover`; every request carries protocol version and client capabilities in `_meta`; **multi round-trip requests** replace server-initiated `sampling/createMessage`, `elicitation/create` and `roots/list`; `subscriptions/listen` replaces the HTTP GET stream and `resources/subscribe`; `ping` and `logging/setLevel` removed; tasks moved to the `io.modelcontextprotocol/tasks` extension; list results carry `ttlMs`/`cacheScope`; servers SHOULD list tools in a deterministic order; `inputSchema`/`outputSchema` accept any JSON Schema 2020-12 keyword; **Roots, Sampling and Logging deprecated** (SEP-2577); HTTP+SSE formally Deprecated; Dynamic Client Registration deprecated in favour of CIMD [MCP-CL-2026]. |

Clients interoperate across the two *eras* — "legacy" (2024-10-07 … 2025-11-25, `initialize`-based) and "modern"
(2026-07-28) — by probing with `server/discover` and falling back to `initialize`. On stdio a server that stays
silent on the probe is treated as legacy [TS-SDK-VERS]. Claude Code has two client runtimes; the v2 runtime (on
SDK 2.x) asks stdio and HTTP servers for the newer revision and uses it where offered, and is the default from
v2.1.232 or v2.1.274 depending on the session type [CC-MCP]. Practical consequence: **a server published in late
2026 must answer both eras**, and the v2 SDK's `serveStdio(factory)` does so by default.

### 1.2 Server features, and how we would use them

**Tools** [MCP-TOOLS][MCP-SCHEMA]

- *Definition*: `name`, optional `title`, `description`, `icons`, `inputSchema` (a JSON Schema object whose root is
  `type: "object"`; any 2020-12 keyword since 2026-07-28), optional `outputSchema`, optional `annotations`, `_meta`.
  Display-name precedence is `title`, `annotations.title`, `name`.
- *Names*: SHOULD be 1–128 characters of `A–Z a–z 0–9 _ - .`, case-sensitive and unique within the server. The dot is
  legal in MCP but not in the Claude API's tool-name pattern [CLAUDE-TOOLS], so portable servers avoid it.
- *Listing*: in 2026-07-28 `tools/list` **must not vary per connection** or as a side effect of other requests (it may
  vary by the caller's authorization and may change over time with `notifications/tools/list_changed`), and SHOULD be
  in a deterministic order for prompt caching. Unity MCP's per-session tool groups (§2.3) predate this rule. For us:
  **one static tool list** whether or not an editor is connected; a tool called without an editor returns an
  actionable error.
- *Results*: unstructured `content` blocks — `text`, `image` (base64 + `mimeType`), `audio`, `resource_link`,
  embedded `resource` — each with optional `annotations` (`audience`, `priority`, `lastModified`); and structured
  `structuredContent` (any JSON value) that MUST conform to `outputSchema` when one is declared. A tool returning
  structured content SHOULD also return the serialized JSON as text for older clients.
- *Errors*: protocol errors (unknown tool, malformed request) are JSON-RPC errors; everything the model can fix —
  validation, business rules, a disabled operator — is a result with `isError: true` and an actionable message.
  Clients SHOULD pass execution errors to the model.
- *Annotations* (`ToolAnnotations`): `readOnlyHint` (default false), `destructiveHint` (default **true**, meaningful
  only when not read-only; false means "additive updates only"), `idempotentHint` (default false), `openWorldHint`
  (default **true**). Clients MUST treat annotations as untrusted unless the server is trusted. Clients do use them:
  Codex's `writes` approval mode prompts for every tool not marked read-only [CODEX].
- *Stateful tools*: there is no protocol session, so state that spans calls travels as explicit handles in arguments
  (the spec's non-normative guidance: opaque ids, stated lifetime, an expiry error that tells the model to start
  over). Our character, clip, control and key ids are exactly such handles; an editor-session id is another.
- *Vendor `_meta` keys honoured by Claude Code*: `anthropic/maxResultSizeChars` (raise the persist-to-disk threshold
  for one tool, up to 500,000 characters), `anthropic/requiresUserInteraction` (a permission prompt on every call,
  even in auto modes — for consent steps only), `anthropic/alwaysLoad` (exempt one tool from tool search) [CC-MCP].

**Resources.** URI-addressed read-only content with templates; in 2026-07-28 change notifications arrive over
`subscriptions/listen`. Claude Code lets the *user* `@`-mention resources and gives the model generic list/read
tools [CC-MCP]. Many servers duplicate resource content behind read tools because models call tools more reliably
than they browse resources. For us: resources are optional extras (operator catalog, project summary, keymap);
everything the agent needs is also a tool.

**Prompts.** Server-defined templates; Claude Code lists them as slash commands (`/<server>:<prompt> (MCP)`, also
runnable as `/mcp__<server>__<prompt>`), with arguments split on whitespace, so each argument is one token [CC-MCP]. For us: canned workflows such as "loop this clip", "block a walk cycle",
"clean up curves".

**Elicitation.** A server asks the *user* (not the model) for input: form mode (a flat object of primitive fields)
or URL mode (open a link). Under 2026-07-28 it rides the multi-round-trip pattern — the tool returns
`input_required`, the client retries with `inputResponses` [MCP-TOOLS][TS-SDK-IR]. Claude Code supports both modes
with a dialog [CC-MCP]; Cursor lists elicitation [CURSOR]; Codex's MCP page does not mention it [CODEX]. For us:
useful for a genuine human choice ("overwrite `walk.vrma`?"), never the only safety mechanism, because client
support varies and a headless run cannot answer.

**Sampling** (the server asks the client's model for a completion) is **deprecated** as of 2026-07-28; the stated
migration is "integrate directly with LLM provider APIs" [MCP-CL-2026]. For us: the later in-editor AI panel calls
an LLM API itself with the same tool definitions; the MCP server never borrows the client's model.

**Progress and cancellation.** A request may carry a `progressToken`; the server sends `notifications/progress`
(with a `message`) on the response stream. On stdio the client cancels with `notifications/cancelled`; on
Streamable HTTP it closes the response stream [MCP-TRANSPORTS]. Claude Code: a per-server wall-clock timeout,
an idle timeout of 30 minutes for stdio servers that send neither result nor progress, and automatic backgrounding
of a call still running after two minutes, with the latest progress shown in `/tasks` [CC-MCP]. Codex defaults to
a 60-second tool timeout and a 10-second startup timeout [CODEX].

**Logging** via `notifications/message` is deprecated; log to stderr (stdio) or OpenTelemetry [MCP-CL-2026].

**Extensions** are opt-in on both sides and negotiated in capabilities [MCP-EXT]:

| Extension | What it does | Use for us |
|---|---|---|
| Tasks (`io.modelcontextprotocol/tasks`) | Durable handles for long work: `working` / `input_required` / `completed` / `failed` / `cancelled`, polled with `tasks/get`, input via `tasks/update`, `tasks/cancel` [MCP-TASKS]. | Not needed in M-AI: operators finish in milliseconds and exports in seconds; progress notifications suffice. Candidate later for batch jobs ("5 idle variations"). |
| MCP Apps (`io.modelcontextprotocol/ui`) | A tool declares `_meta.ui.resourceUri` pointing at a `ui://` HTML resource that the host renders in a sandboxed iframe; the app talks to the host over `postMessage` JSON-RPC and can call the server's tools [MCP-APPS]. | Later: an inline three.js clip preview in Claude Desktop/ChatGPT/VS Code. The ext-apps repository ships a `threejs-server` example. |
| Skills over MCP (`io.modelcontextprotocol/skills`) | Serve Agent Skills (workflow instructions + files) as resources. Client support is partial [MCP-EXT-MATRIX]. | Watch; ship the skill through a Claude Code plugin first. |

### 1.3 Transports

- **stdio**: newline-delimited JSON-RPC over the child's stdin/stdout; stdout carries protocol messages only; stderr
  is free-form logging that clients may show or ignore; the server SHOULD exit when stdin closes and the client
  SHOULD restart a crashed server [MCP-STDIO]. One stray `console.log` corrupts the stream [TS-SDK-STDIO].
- **Streamable HTTP**: one POST per message, replies as JSON or a request-scoped SSE stream; stateless in
  2026-07-28 (no session id, no resumability); servers **MUST** validate `Origin` and answer 403 when it is invalid,
  SHOULD bind to 127.0.0.1 when local, SHOULD authenticate every connection — "without these protections, attackers
  could use DNS rebinding to interact with local MCP servers from remote websites" [MCP-SHTTP].
- **HTTP+SSE**: deprecated since 2025-03-26, formally Deprecated in 2026-07-28 [MCP-CL-2026].
- **Custom transports** are allowed if they keep JSON-RPC, the message patterns and the per-request metadata; ones
  over a byte stream SHOULD reuse the stdio framing [MCP-TRANSPORTS]. Claude Code additionally accepts a
  non-standard `ws` server type for remote WebSocket servers (header auth only) [CC-MCP].

For a local desktop-class tool every surveyed server uses **stdio to the client**. The leg from that process to the
running application is private: a TCP socket (both open-source-DCC servers, Unity MCP), a local HTTP endpoint inside
the app (Unreal), a WebSocket from a browser tab (PlayCanvas, threejs-devtools-mcp), a file mailbox polled by the app
(the community Cascadeur server), or the app's own embedded runtime (Spline).

### 1.4 Authorization (remote servers only)

A remote MCP server is an OAuth 2.1 resource server: discovery through Protected Resource Metadata (RFC 9728),
resource indicators (RFC 8707), Client ID Metadata Documents as the preferred client registration (Dynamic Client
Registration deprecated in 2026-07-28), `iss` validation (RFC 9207), incremental scopes via `WWW-Authenticate`, and a
hard ban on token passthrough [MCP-CL-2511][MCP-CL-2026][MCP-SEC]. A stdio server takes credentials from its
environment instead. For M-AI: **no auth on the stdio side**; a hosted Ekza MCP endpoint (for claude.ai web, which
only reaches remote connectors) would need OAuth on Ekza accounts, which is M4b territory.

### 1.5 The TypeScript SDK

| | v1 `@modelcontextprotocol/sdk` | v2 `@modelcontextprotocol/server` (+ `client`, `core`, middleware) |
|---|---|---|
| Version (2026-10-19) | 1.32.1 | 2.3.1 (`node` 2.1.1, `express` 2.0.2) |
| Licence | MIT | Apache-2.0 on npm; the repository says "Apache License 2.0 for new contributions, with existing code under MIT" |
| Protocol | up to 2025-11-25 | both eras; 2026-07-28 through `serveStdio` / `createMcpHandler` |
| Runtime | Node, CJS + ESM | ESM-only, Node ≥ 20, Bun, Deno |
| Dependencies | ajv, express, hono, cors, jose, eventsource, express-rate-limit, … | `zod ^4.2.0`, `@modelcontextprotocol/core` |
| Schemas | zod 3.25+/4 | any Standard Schema that can emit JSON Schema (zod/v4, ArkType, Valibot via wrapper) or plain JSON Schema via `fromJsonSchema()` |
| Status | bug and security fixes for ≥ 6 months after 2026-07-27 | stable line |

Sources: [TS-SDK][TS-SDK-VERS][TS-SDK-SCHEMA][NPM]. Other v2 pieces we would use: `registerTool(name, config,
handler)` validates arguments before the handler and returns failures as `isError` results; `outputSchema` output is
validated before it leaves the server; `annotations` and `title` never change execution; `maxToolInputElements` caps
array/object sizes in arguments (off by default); `inputRequired(...)` + `acceptedContent(...)` implement elicitation
for both eras; an in-memory `Client` drives the server in tests; `npx @modelcontextprotocol/inspector <cmd>` exercises
a stdio server interactively [TS-SDK-TOOLS][TS-SDK-IR]. A codemod migrates v1 code.

An illustrative (not normative) shape for one operator-backed tool:

```ts
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

serveStdio(() => {
  const server = new McpServer({ name: 'ekza-animator', version: '0.3.0' }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of buildToolTable(operatorRegistry)) {          // the same table the WebMCP adapter would read
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,                               // searchable words first, under 4,096 chars
      inputSchema: fromJsonSchema(tool.inputSchema),               // e.g. paramSchema(def.params) + pass-through ids
      outputSchema: fromJsonSchema(tool.outputSchema),
      annotations: tool.annotations,                               // derived from operator flags (§5.2)
    }, (args, ctx) => bridge.call(tool, args, ctx));               // live editor or headless EditorApp
  }
  return server;
});
```

### 1.6 How clients configure a local server

| Client | Add a local stdio server | Where it is stored | Notes for us |
|---|---|---|---|
| Claude Code | `claude mcp add [--scope local\|project\|user] [-e K=V] <name> -- <cmd> [args…]` | `~/.claude.json` (local/user), `.mcp.json` in the repo (project; approval prompt before first use) | Tool search on by default; images shown inline and saved; elicitation form + URL; prompts as slash commands; `MCP_TIMEOUT` for startup; per-server `timeout`; plugins can bundle servers [CC-MCP]. |
| Claude Desktop | Settings › Developer › Edit Config → `mcpServers` in `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`); restart fully | same | Or a one-click **`.mcpb`** bundle (zip of server + `manifest.json`, stdio, Node is bundled with the app, `user_config` generates a settings UI); the directory no longer accepts MCPB submissions — distribute the file or a plugin [MCP-LOCAL][MCPB]. MCP Apps supported [MCP-EXT-MATRIX]. |
| Cursor | `mcpServers` in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global); `command`, `args`, `env`, `envFile` | same | Tools, prompts, resources, roots, elicitation, Apps; returned images attached to the chat; approval before tool runs by default, allowlists in auto-review [CURSOR]. |
| VS Code (Copilot) | `servers` in `.vscode/mcp.json` | same / user profile | Trust prompt for servers outside a trusted workspace; optional per-server sandbox for stdio servers on macOS/Linux (`sandboxEnabled`), whose calls are then auto-approved [VSCODE]. |
| Codex | `codex mcp add <name> [--env K=V] -- <cmd>` | `[mcp_servers.<name>]` in `~/.codex/config.toml` or a trusted project's `.codex/config.toml` (`command`, `args`, `env`, `cwd`, `startup_timeout_sec` 10, `tool_timeout_sec` 60, `enabled_tools`, `disabled_tools`) | Approval modes `auto` / `prompt` / `writes` / `approve`, per tool too; `writes` keys off `readOnlyHint` [CODEX]. |
| Gemini CLI | `mcpServers` in `~/.gemini/settings.json` or `.gemini/settings.json` | same | Per-server include/exclude tool lists and a `trust` flag **(unverified field names)** [GEMINI]. |

Every row uses the same `{ command, args, env }` triple, so one `npx -y <package>` entry point serves all of them.
PlayCanvas, the community open-source-DCC server and the community Cascadeur server all publish exactly this set of
snippets; the Cascadeur server even generates the client files with absolute paths, because Claude Desktop starts
servers from an undefined working directory [CASC-COMM][MCP-LOCAL].

### 1.7 Client limits that shape the design

| Limit | Value (2026-10) | Source | Design response |
|---|---|---|---|
| Tool definitions in context | Deferred behind tool search by default in Claude Code; only names and server instructions load at start | [CC-MCP] | Names and the first lines of descriptions must be searchable ("key", "pose", "tangent", "loop", "export"). |
| Description length | 4,096 characters (upfront tool, server instructions), 16,384 (deferred tool) | [CC-MCP] | Short descriptions; workflow prose goes into a skill, not into tool text. |
| Tool output | Warning at 10,000 tokens, limit 25,000 (`MAX_MCP_OUTPUT_TOKENS`); text over 50,000 characters persisted to a file; images count against the token limit | [CC-MCP] | Paging (`cursor`, `limit`), summaries first, `detail: "summary" \| "full"`. |
| Tool name | Claude API `^[a-zA-Z0-9_-]{1,128}$`; Claude Code drops tools whose `mcp__<server>__<tool>` exceeds 128 characters | [CLAUDE-TOOLS][CC-ERR] | Short server key (`ekza`), short snake_case names. |
| Input schema | Root-level `anyOf`/`oneOf`/`allOf` flattened by Claude Code with a prose note; a tool is excluded when a top-level property name is not 1–64 characters of `A–Z a–z 0–9 _ . -` or the schema fails the 2020-12 meta-schema | [CC-MCP] | Flat object roots; unions only inside properties; a schema test in CI against the meta-schema. |
| Images | ⌈w/28⌉ × ⌈h/28⌉ tokens; long edge capped at 1568 px / 1,568 tokens (2576 px / 4,784 tokens on Claude 4.7 and later) before downscaling; PNG, JPEG, GIF, WebP | [CLAUDE-VISION] | Default capture 768–1024 px (≈ 750–1,350 tokens); quad sheets instead of four images. |
| Timeouts | Claude Code: stdio idle 30 min, backgrounding after 2 min; Codex: 60 s per tool, 10 s startup | [CC-MCP][CODEX] | Fast tools; progress notifications for exports; a fast cold start (no heavy imports before the first `tools/list`). |

### 1.8 Security guidance and incidents

What the spec says [MCP-SEC][MCP-TOOLS][MCP-SHTTP]:

- *Local server compromise*: local servers run with the client's privileges; clients offering one-click install MUST
  show the exact command and get consent; servers meant to run locally SHOULD use stdio, or restrict an HTTP
  transport with an authorization token or an IPC channel with restricted access.
- *DNS rebinding*: HTTP servers MUST validate `Origin`, SHOULD bind 127.0.0.1, SHOULD authenticate.
- *Human in the loop*: there SHOULD always be a human able to deny tool invocations; clients SHOULD show which tools
  are exposed, indicate invocations and confirm sensitive operations. Servers MUST validate inputs, implement access
  control, rate-limit and sanitize outputs. Annotations from untrusted servers are untrusted.
- *State handles*: possession of a handle is not authentication; use random, expiring handles bound to the caller.

What went wrong in practice:

| Incident | Lesson for a localhost bridge |
|---|---|
| MCP Inspector CVE-2025-49596 (CVSS 9.4): its local proxy accepted unauthenticated connections and could spawn processes; a malicious web page reached it through `0.0.0.0` or DNS rebinding. Fixed in 0.14.1 with a session token and origin validation [CVE-INSPECTOR]. | A localhost listener needs **both** an Origin check and a secret. |
| GitHub MCP (May 2025) and Atlassian MCP (June 2025): text in a public issue or a support ticket instructed the agent to read private data and publish it — the "lethal trifecta" of private data, untrusted content and an exfiltration channel [WILLISON-GH][TRIFECTA]. | Content from third-party assets (node names, clip names, `extras`, VRM meta) is untrusted; the agent driving our editor often also has a shell. |
| Tool poisoning and rug pulls: hidden instructions in tool descriptions; definitions changed after approval [POISON]. | Our tool text is static and versioned with the package; no description is built from user data. |
| Arbitrary-code tools: the community open-source-DCC server — "ALWAYS save your work before using it"; the official one recommends a virtual machine [OSS-DCC-MCP][OSS-DCC-LAB]. | Do not ship a code tool; the operator registry is the whole API. |

Browser-specific: browsers do not apply CORS to WebSockets, so any open page can try `ws://127.0.0.1:<port>`; the
browser always sends an `Origin` header that page script cannot forge, which is why PlayCanvas checks it [PLAYCANVAS].
Separately, Chrome's **Local Network Access** permission (from Chrome 142 for fetch, from Chrome 147 for WebSocket and
WebTransport) asks the user before a public page reaches loopback; a denial sticks per origin and looks like "nothing
is listening", so PlayCanvas prints a hint naming the site setting [LNA][PLAYCANVAS]. A page served from `localhost`
is not public, so the prompt does not apply to a locally served editor (to be confirmed in a spike).

---

## 2. Survey: MCP servers for DCC and creative tools

### 2.1 Overview

| Server | Owner, licence | Architecture | Tool surface | Vision | Safety posture | Verdict |
|---|---|---|---|---|---|---|
| **Open-source DCC, community server** [OSS-DCC-MCP] | ahujasid (community), MIT; ★ 31.6k | Python stdio server (run with `uvx`) ↔ TCP socket `localhost:9876` ↔ DCC add-on | 9 tools: a code-execution tool, `look`, `get_scene_info`, `generate_3d`, `search_assets`/`import_asset`, `get_addon_status`, telemetry controls | `look`: viewport, camera, auto-framed multi-angle sheet, **animation frame strip**, shading modes; inline viewport via MCP Apps | Socket has "no authentication or encryption"; opt-in "safe mode" statically screens scripts; telemetry with opt-out; paid generation tier | The most popular DCC server; its value is the code tool plus `look`. Security anti-pattern. |
| **Open-source DCC, official server** [OSS-DCC-LAB] | the DCC project's lab (official), **GPL-3.0** | stdio server ↔ TCP socket ↔ add-on; DCC 5.1+; `.mcpb` release; v1.0.0 2026-04-27, v1.0.3 2026-09-11 | ~25 tools: a code-execution tool, blend-file summaries, object summaries, Python API and manual **doc search**, area/window screenshots, window layout as JSON, viewport jumps; every file-reading tool has a `*_for_cli` twin running the DCC headless | area and window screenshots | "will execute LLM generated code … without any guards"; recommends a VM | Good: live + headless twins, docs search, layout-as-JSON. Bad: code tool. GPL: patterns only. |
| **MCP for Unity** [UNITY-COPLAY] | CoplayDev (community, sponsored), MIT; ★ 15.1k | Python server ↔ Unity editor package; multi-instance routing; remote server with auth option | 50 tools in **groups** (`core` on; `animation`, `ui`, `vfx`, `testing`, … off) toggled by `manage_tools`; `manage_*` tools multiplex an `action` and a free-form `properties` dict; `batch_execute` (default 25, max 100 commands) | screenshots via tools | Roslyn validation of scripts; tool toggles in the editor | Good: groups, batching, per-instance routing. Bad: `action` + untyped `properties` hides the real schema from the model. |
| **Unity AI Assistant MCP → Unity CLI** [UNITY-OFFICIAL][UNITY-CLI] | Unity (official) | In-editor bridge + relay binary; first-time clients appear as *Pending Connections* to Accept/Deny. Now **deprecated** for the Unity CLI's `unity mcp` server (localhost only), with `unity command` / `unity eval` for agents that can run shell commands, and `unity skill install` | `Unity_ManageScene`, `Unity_ManageGameObject`, `Unity_ReadConsole`, custom tools | — | explicit per-client approval | Good: client approval UX; the CLI + skills turn. |
| **Unreal MCP** (UE 5.8) [UNREAL] | Epic (official), experimental | MCP server inside the editor at `http://127.0.0.1:8000/mcp`; tools run **serially on the game thread** ("clients should not issue overlapping Tool calls") | Tool Search mode exposes three meta-tools: `list_toolsets`, `describe_toolset`, `call_tool`; toolsets for scene, actors, material instances, objects (+ more with plugins) | — | "no authentication layer; … not safe to expose beyond the local machine" | Good: progressive disclosure, explicit serial execution. Bad: no auth. |
| unreal-mcp [UNREAL-COMMUNITY] | chongdashu, **no licence**; last push 2025-04 | Python server ↔ UE plugin socket | actors, Blueprints | — | — | Unmaintained; not reusable. |
| Desktop DCC (community servers) [DESKTOP-DCC-MCP] | PatrickPalmer, MIT, last push 2025-05; others unverified | commandPort / plugin bridges | script execution + scene inspection | — | — | No vendor server found as of 2026-10. |
| **Cascadeur** built-in [CASC-NEWS] | Nekki, proprietary; 2026.2 (2026-08) | "a 'simple' MCP server" | **(unverified)** | — | — | Shows the animation-tool trend; details not public. |
| Cascadeur community server [CASC-COMM] | gprethesh, MIT, created 2026-09 | stdio Python ↔ **file mailbox**; a Qt timer in the app runs one request at a time on the main thread; **no network port** | 36 tools: scene and rig inspection, body/finger posing, keyframes, interpolation, timeline selection, camera, PNG previews, FBX I/O; curated physics/AutoPosing action catalog with "explicit verification limits"; optional 37th scripting tool, **off by default** | PNG previews | Workspace path checks; scripting bypasses them and is disabled by default; generated client configs | The closest *animation* tool design: typed posing/keying verbs + previews. Single author, young. |
| **Figma MCP server** [FIGMA] | Figma (official), proprietary; guide repo has no licence | Remote `https://mcp.figma.com/mcp` (OAuth) + a desktop-app server | ~32 tools; read: `get_metadata` (light XML outline) → `get_design_context`, `get_screenshot`, `get_variable_defs`, `get_motion_context` (keyframes, easing); write (remote only): `use_figma` runs Plugin-API code, plus typed creators | `get_screenshot` ("uses more tokens") | Rate limits per seat; write beta; ships with Agent Skills (`figma-use`) | Good: outline → detail drill-down; skills. Write path is code execution. |
| **Spline MCP** [SPLINE] | Spline (official), proprietary; V2, 2026-08 | Built into the **desktop app** (stdio via the app binary, `ELECTRON_RUN_AS_NODE`), binds 127.0.0.1 with an origin allowlist; auto-registers itself in installed clients' configs; "does not work from the browser" | 3D and 2D tools (`3d_run_code`, `2d_write_html`, scenes, models, cameras, screenshots, AI generation) | screenshots | "never reachable from the network"; no per-action approval | Good: zero-config registration, last-focused-tab routing. Bad: code tools; auto-editing client configs. |
| **PlayCanvas Editor MCP** [PLAYCANVAS] | PlayCanvas (official), **MIT**, TypeScript, v1 SDK | stdio (`npx -y @playcanvas/editor-mcp-server`) ↔ WebSocket server on `127.0.0.1:52000` ↔ the **browser** editor (user clicks MCP › CONNECT); Origin allowlist (`*.playcanvas.com`, localhost); one editor at a time; standby servers take over the port | 130 typed tools (~43k tokens of definitions; ~1k with tool search) over entities, assets, scenes, animation state graphs, viewport, selection, **undo/redo**, builds, runtime launch with screenshots and input, VCS | viewport capture; runtime screenshots | No telemetry; one outbound request; LNA hint; no pairing secret (no-Origin local processes allowed) | **The reference for our live bridge.** MIT TypeScript we can learn from directly. |
| **Pascal** (`@pascal-app/mcp`) [PASCAL] | Pascal (official, open source), **MIT**, TypeScript, v1 SDK; ★ 25k (the editor repo) | Headless stdio/HTTP server in Node or Bun on `@pascal-app/core`, no browser or WebGPU; local SQLite store; a running editor tab follows edits over server-sent events; `pascal mcp connect` bridges stdio to the editor's authenticated loopback service; hosted endpoint for accounts | 45 typed tools (inspect, `view_scene`, measure, create/place, `apply_patch`, `verify_scene`, `check_collisions`, undo/redo, export), 6 resources (incl. an agent guide and a design JSON Schema), 3 prompts | `view_scene` from named viewpoints with `maxPx` | One undo step per mutation; version checks (`live_sync_version_conflict`); structured error codes; bearer token required off loopback; plugin tools get host-set annotations | **The reference for the headless leg** and for result/error conventions. Limits: derived geometry lives in React hooks, so headless mode does not rebuild it and GLB export is a stub. |
| threejs-devtools-mcp [THREE-DT] | community, MIT; ★ 122 | stdio ↔ WebSocket bridge **injected** into the user's three.js dev page (or a Chrome it launches via CDP) | 69 tools: scene tree, materials, shaders, textures, animation, performance, audits; run JS | screenshots, video frames | Labels tools by whether they touch code; runs arbitrary JS | Good: tool labelling; Playwright helper. Bad: injection + JS. |
| **VRMA Lab** Agent Mode [VRMA-LAB] | YuBan834, Apache-2.0; ★ 6 | No MCP: `window.vrmaLab` SDK + same-origin `postMessage` JSON bridge, driven by browser-automation agents | `inspect` → `edit` → `review` → `validate` → `exportVrma`, plus undo/redo | **fixed quad-view review** (full body, upper body, half body, legs/contacts) | Export read-back validation before download | Good: the *workflow* (inspect/edit/review/validate/export) and the quad view. |
| Godot MCP [GODOT] | Coding-Solo, MIT; ★ 6.2k | stdio ↔ Godot CLI | launch editor, run project, capture debug output | — | — | Headless/CLI style; shows the "run and read logs" loop. |
| Rive, After Effects, Cavalry (community) | various | various | keyframe/easing/state-machine tools (Rive community: 139 tools) **(unverified)** | — | — | Only community; Rive's official server is in an early-access desktop app **(unverified)**. |
| Web auto-rigging service (community) [AUTORIG-MCP] | V1xel, **no licence**; ★ 4 | Playwright automation of the service's web UI with a saved browser session | search and download clips, upload characters to the auto-rigger | — | stored session cookie | Character-animation MCPs are thin and mostly community UI automation; no Rokoko, Motorica or Move AI server found. |
| Generic browser MCPs: Playwright MCP, Chrome DevTools MCP [PW-MCP][CDT-MCP] | Microsoft / Google, Apache-2.0 | drive a browser; Playwright can attach to an existing tab through its extension | accessibility snapshots, clicks, `browser_evaluate`/`evaluate_script`, screenshots | screenshots | generic | A zero-code fallback: an agent can already drive our editor through `window.__EKZA_STUDIO_TEST__` in e2e builds. Slow, token-heavy, and JS evaluation is unbounded. |
| WebMCP / MCP-B [WEBMCP][MCP-B] | W3C CG draft; MCP-B polyfill MIT | The page registers tools with `document.modelContext.registerTool({name, description, inputSchema, execute, annotations})`; annotations `readOnlyHint`, `untrustedContentHint`, `consequentialHint` | page-defined | page-defined | Browser-mediated; per-origin | Future adapter (F10). |

Counts and stars come from the GitHub API on 2026-10-19 and change daily; they show reach, not quality.

### 2.2 The open-source DCC's servers: the code-execution archetype

The community open-source-DCC server reached the largest audience of any DCC server by doing almost nothing itself:
"The AI writes [the DCC's] Python itself for modelling, layout, materials, animation, rigging and retopology. The MCP
adds what Python can't do on its own, as nine tools" [OSS-DCC-MCP]. That works for the open-source DCC because its
Python API is huge, documented and in every model's training data. Its own limits and warnings are the lesson:

- Every edit is a script, so the user sees code, not intent; failures surface as Python tracebacks; and the API's
  undo behaviour for scripted edits is the user's problem ("ALWAYS save your work before using it").
- The opt-in safe mode screens scripts for file, process and network use — a blocklist on a Turing-complete language,
  which research 08 §8 already rejects as a security boundary.
- The socket has "no authentication or encryption, so anyone who can reach that port can run Python inside [the DCC]".
- What it does well is **`look`**: one tool for every visual check, with presets that frame the subject
  automatically, a multi-angle sheet and an **animation strip**, so the model sees motion without a video.
  `get_scene_info` lets the model choose which fields to return, keeping summaries small.

The official open-source-DCC server (GPL-3.0) keeps the code tool but adds two ideas worth copying: **live and headless
twins** of each inspection tool (`get_blendfile_summary_datablocks` and `…_for_cli`, which opens a `.blend` in a
background DCC process) and **bundled documentation search** (`search_api_docs`, `search_manual_docs`,
`get_python_api_docs`), so the model looks up the API instead of guessing. Its page recommends running it in a
virtual machine [OSS-DCC-LAB].

Our position differs: we have no general-purpose scripting language worth exposing, and we have something the
open-source DCC lacks — every user-visible action is already a named, typed, undoable operator (ADR 0008). The agent API
is the registry; a code tool would bypass the one property that makes agent edits safe to accept.

### 2.3 Unity and Unreal: granularity and disclosure

**MCP for Unity** groups 50 tools and enables only `core` by default because "exposing all of them to the LLM at
once balloons the prompt and dilutes routing decisions", citing prompt economy, routing clarity ("the wrong-tool
rate drops measurably") and hiding tools for packages that are not installed [UNITY-COPLAY]. Two caveats: per-session
visibility conflicts with 2026-07-28's rule that `tools/list` must not vary per connection, and client-side tool
search now provides most of the prompt economy. Its `manage_animation` tool shows the cost of coarse multiplexing:
one `action` string with prefixes (`animator_*`, `controller_*`, `clip_*`) and a free-form `properties` dict whose
keys "match ManageAnimation.cs" — the model cannot see the real argument schema. `batch_execute` (default 25
commands, "10–100× faster" than sequential calls, `fail_fast`) is the right idea for latency-bound bridges.

**Unreal MCP** answers the same problem in the protocol: with Tool Search on, `tools/list` returns three meta-tools
and the model discovers toolsets on demand. Tools run serially on the game thread, and the docs tell clients not to
overlap calls [UNREAL]. **Unity's official server** contributes the connection-approval UX (pending clients must be
accepted in the editor; approved clients reconnect silently) and, with its deprecation, the strongest signal that
vendors want a CLI next to MCP: `unity command`/`unity eval` "are faster and use fewer tokens than MCP", while MCP
mode stays for agents that cannot run shell commands [UNITY-CLI].

### 2.4 Cascadeur and VRMA Lab: the animation-specific designs

The community **Cascadeur** server is the nearest thing to an animator's MCP: typed tools for posing body and
finger controllers, keys, interpolation, timeline selection and camera, PNG previews, and a curated action catalog
for physics and AutoPosing that states which actions it has verified. Its bridge has **no network port** — the
server writes requests into a mailbox directory and a timer inside Cascadeur executes one at a time on the main
thread — and the scripting escape hatch is off by default and documented as bypassing the workspace checks
[CASC-COMM]. Nekki's own 2026.2 server is described only as "simple" [CASC-NEWS].

**VRMA Lab** skips MCP but designs the loop best: `inspect → edit → review → validate → exportVrma`, a fixed
**quad-view review** render (full body, upper body, half body, legs and contacts) so the agent never navigates the
camera, structured state "to reduce token use" and the images only "for final visual confirmation", and read-back
validation of every export [VRMA-LAB]. Research 05 already recommends porting its validator and quad view.

### 2.5 Figma and Spline: the design-tool path

**Figma** separates reading into a cheap outline (`get_metadata`, "a lightweight XML outline") and an expensive
detail call (`get_design_context`), says `get_screenshot` "uses more tokens", truncates large asset sets with an
explicit flag (`rawImagesTruncated: true`) and recommends skills (`figma-use`) for reliable writing. It also exposes
animation as data — `get_motion_context` returns keyframes, easing and CSS/Motion snippets [FIGMA]. Its write path
(`use_figma`) is Plugin-API code on the remote server only.

**Spline** V2 makes setup disappear: the desktop app registers its MCP server in every installed client's config and
routes calls to "the most recently focused tab of the matching kind" ("the most recent connection wins"), with a
60-second forwarding timeout. It also states the constraint we face: the MCP connection "does not work from the
browser", so the server lives in the Electron app [SPLINE]. Editing other applications' configuration files silently
is convenient but intrusive; for an open-source project an explicit `ekza-animator mcp install <client>` (Unity CLI's
`unity mcp configure <client>`) is the better trade.

### 2.6 PlayCanvas: a browser editor driven over MCP

PlayCanvas is the only surveyed vendor with a **browser** editor and an official MCP server, and it is MIT
TypeScript [PLAYCANVAS]:

- *Shape*: the client launches `npx -y @playcanvas/editor-mcp-server`; the server listens on `127.0.0.1:52000`; the
  user opens the editor, clicks the MCP button and CONNECT; the editor's built-in client opens the WebSocket. "Two
  servers take turns owning the Editor port": a second server retries the bind every three seconds and takes over
  when the owner exits, and a newer instance can ask the owner to yield the port [PLAYCANVAS-WSS].
- *Origin check*: `verifyClient` accepts `https://*.playcanvas.com`, `http(s)://localhost|127.0.0.1[:port]`,
  extra origins from an environment variable, and clients **without** an `Origin` (non-browser local processes). No
  token. The comment cites the spec's DNS-rebinding warning and notes that "browsers don't apply CORS to websockets".
- *Failure messages name the cause*: a blocked LNA permission "looks like 'nothing is listening', so failures must
  name it"; a blocked pop-up is named for runtime launch.
- *Breadth*: 130 typed tools, about 43k tokens of definitions, about 1k with tool search; selection, gizmo state,
  undo and redo are tools; runtime launch with screenshots, logs and synthetic input closes the "does it actually
  run" loop.
- *Hygiene*: no telemetry, one outbound request, local files touched only by upload/download tools.

What we would add: a per-launch secret so that a local process without a browser `Origin` cannot pose as the editor
and feed the agent crafted results; and undo semantics per call instead of undo as a tool.

### 2.7 Pascal: a React Three Fiber editor with a headless-first server

Pascal is an MIT, TypeScript, React Three Fiber architectural editor (about 25k stars on 2026-10-19) whose
`@pascal-app/mcp` package is the most complete open-source MCP design for a *browser* 3D editor we found [PASCAL]:

- *Headless first*: the server runs in Node or Bun "with no browser, WebGPU, React, or external database service" and
  "exposes the same scene mutations used by the editor UI … as MCP tools, resources, and prompts". An open editor tab
  sharing the same local store subscribes to a server-sent event stream and applies the agent's edits; every
  mutation version-checks the saved scene and returns `live_sync_version_conflict` when someone saved first.
- *Connection without config secrets*: `pascal editor` starts the editor and an authenticated MCP service together;
  `pascal mcp connect` is "a stable stdio connector that discovers the dynamic loopback port, so MCP client
  configuration contains neither a changing port nor a secret" — it reads a bearer token from a local file and
  proxies stdio to the service's Streamable HTTP endpoint [PASCAL-CONNECTOR]. Binding a non-loopback host requires a
  token. `pascal mcp setup <client>` writes the client entry explicitly.
- *Undo and batching*: each mutation tool is one undoable step; `apply_patch` takes a batch of create/update/delete
  operations, validates and dry-runs it, then commits atomically ("batch-first is the default").
- *Errors as data*: schema rejections come back as `{ error, code: "invalid_input" }`, domain refusals as `{ error,
  code, ...details }` (`cannot_enclose`, `scene_wipe_blocked`); a retired tool is no longer listed but still answers
  with `tool_retired` and its replacement, so old prompts and skills keep working.
- *Units and conventions*: the README states axes, handedness and units up front, and length or angle arguments
  accept a bare number in the field's unit or a string carrying its own (`"9 ft"`, `"6:12"`, `"0.46 rad"`).
- *Seeing and checking*: `view_scene` renders from named viewpoints with a `maxPx` budget; `verify_scene`,
  `check_collisions` and `measure` give numbers to check against.
- *Instructions as resources*: an agent-guide resource carries the workflow; on the hosted server it also points at
  other project chats and files, "read as quoted data, never instructions". Prompts cover brief-to-scene and
  minimal-diff iteration.
- *Plugins*: a plugin's agent tools run through the same runner, one history step each, and "the annotations are the
  host's, never read from the plugin's contract" — the rule our plugin tiers need too (research 08 §8).

Its stated limits are the lesson for us: derived geometry (wall mitering, roofs, CSG cut-outs) is computed in React
hooks, so "headless mode doesn't regenerate derived geometry" and `export_glb` is a stub; the two vision tools
depend on MCP sampling, which 2026-07-28 deprecated. Our evaluation lives in `anim-core` and `rig`, outside React,
and `packages/headless-tests` already runs import, operators and `file.export` (with validation and read-back) in a
plain Node environment, so a headless leg can pose, key, lint and export; only image capture needs a GL context.

---

## 3. Tool-design lessons

### 3.1 Granularity: intent-level verbs, a long-tail escape hatch, no code

Anthropic's guidance is to build fewer, more capable tools around real tasks ("a `schedule_event` tool which finds
availability and schedules an event"), namespace related tools, and evaluate tool sets against realistic tasks
[A-TOOLS]. The surveyed servers confirm it from both sides: tools that mirror an internal API one-to-one (130
PlayCanvas tools) cost 43k tokens without tool search; tools that hide everything behind code or `action` strings
lose the schema. For an animation editor the jobs are few and stable — inspect, pose, key, retime, tween, mirror,
loop, filter, simplify, set tangents, capture, measure, export — so:

1. **25–35 intent-level tools** with complete typed schemas, each mapping to one operator run (or a fixed sequence
   recorded as one history step), e.g. `set_pose`, `set_keys`, `retime_keys`, `tween`, `mirror_animation`,
   `set_loop`, `euler_filter`, `simplify_curves`, `set_tangents`, `capture`, `measure_contacts`, `export_clip`.
2. **A long-tail trio** after Unreal: `list_operators` (filterable, paged), `describe_operator` (its JSON Schema,
   poll state and undo behaviour), `run_operator` (`{ op: "anim.key.insert", args: {…} }`, validated against the
   operator's schema). The registry already carries labels, descriptions, typed args and poll reasons (ADR 0008),
   and M6a adds `ParamDef` lists that emit JSON Schema.
3. **No `execute_code`.** Everything an agent may do is something a user may do, through the same undo and
   permission path.

Code execution as a *client* technique ([A-CODE]: an agent writes code against tool APIs, 150k → 2k tokens in
Anthropic's example) is a different thing: it runs in the client's sandbox and still calls our typed tools. A typed,
well-described tool set is what makes that pattern work.

### 3.2 Names and descriptions

- `snake_case`, verb first or noun-verb consistently, no dots; a short server key so `mcp__ekza__set_tangents` stays
  far below 128 characters.
- Unambiguous parameter names: `control_id`, `clip_id`, `frame`, `frames`, `channels` — "instead of a parameter named
  `user`, try a parameter named `user_id`" [A-TOOLS]. Units in names or descriptions (`degrees`, `frames`,
  `seconds`): the editor stores radians and clip frames, the model reasons in degrees. Pascal goes one step further
  and accepts a string that carries its own unit (`"9 ft"`, `"0.46 rad"`) next to a bare number in the field's unit
  [PASCAL]; for us `"12f"` / `"0.5s"` would be the analogue, to decide in the spec.
- Tool names are a public API: retire, do not rename. Pascal stops listing a retired tool but still answers it with
  a `tool_retired` error naming the replacement, so skills and saved prompts keep working [PASCAL].
- Descriptions start with the searchable job ("Set keys on controls at frames…"), then constraints, then one example;
  under a few hundred characters. Workflow guidance ("block poses on stepped tangents, then spline") lives in the
  server `instructions` (≤ 4,096 characters) and a skill.

### 3.3 Schemas

- Flat object roots; enums for closed sets (tangent types, rotate spaces, body parts); numeric bounds from `ParamDef`
  (`min`, `max`); `additionalProperties: false`; no free-form `properties: object` bags (the Unity
  `manage_animation` lesson).
- Accept **names or ids** where a human would use names ("leftHand", "LeftArm_IK") and resolve them server-side,
  returning the canonical id; Anthropic recommends "resolving arbitrary alphanumeric UUIDs to more semantically
  meaningful and interpretable language" [A-TOOLS].
- `outputSchema` on every tool, with `structuredContent` plus a short text rendering for older clients (spec
  SHOULD). Return what changed: ids of keys written, the history label, warnings (`coerceArgs` problems such as
  "divisions clamped to 32").
- `maxToolInputElements` on the server as a guard against runaway argument arrays.

### 3.4 Read before write: outlines, drill-down, paging

Figma's `get_metadata` → `get_design_context`, the community open-source-DCC server's field-selectable `get_scene_info`,
the official server's summary family and VRMA Lab's `inspect` all give the model a cheap map first. For us: `get_scene`
(characters, clips, current frame, selection, dirty state) → `list_controls` (per character, grouped by body part) →
`get_curves` (one clip, filtered by controls/channels, paged, keys optionally summarised as counts and ranges) →
`get_pose` (values at a frame). The e2e test API (MVP-SPEC §4.8) already has most of these reads and is a ready
inventory.

### 3.5 Seeing the result

- One `capture` tool, many presets, as the community open-source-DCC server's `look` and VRMA Lab's review do: `quad`
  (front, side, three-quarter, feet close-up in one image), `strip` (N frames of a range in one image — motion without
  video), `pane` (a given viewport pane), `camera` (the shot camera). Auto-frame the character; optional overlays
  (controls, ground grid, contact markers).
- Budget: a 1024 × 1024 sheet ≈ 1,369 visual tokens; 512 × 512 ≈ 361 [CLAUDE-VISION]. Default to 768–1024 px and
  JPEG/WebP where clients accept them; always add a structured caption (frame, camera, character, overlays).
- Pair images with **numbers**: foot-slide distance, contact frames, joint-limit violations, arc smoothness. The model
  verifies numerically and uses the image for the final look (VRMA Lab: structured state for tokens, images for
  confirmation).
- Engineering note: capture must render on demand rather than depend on `requestAnimationFrame`, which pauses in a
  background tab, and must read pixels in the same task (the viewport does not keep a preserved drawing buffer).

### 3.6 Errors the model can act on

Return `isError: true` with what failed and what to do next — "Control 'leftFoot' is IK-driven in clip 'walk';
key 'leftFoot_IK' or switch the limb to FK (run_operator rig.ikfk.switch)" — never a stack trace [A-TOOLS][MCP-TOOLS].
Operator `poll` reasons are already written for humans as disabled-item tooltips and can be returned verbatim. The v2
SDK formats schema failures the same way. Stale handles get an explicit "unknown clip id; call get_scene" error.
Pair the message with a stable machine-readable code and details, as Pascal does (`{ error, code: "invalid_input" }`
for schema rejections, `{ error, code, ...details }` for domain refusals) [PASCAL]: the model reads the message, the
skill and the tests key off the code.

### 3.7 Batching, transactions and undo

Bridges pay a round trip per call; Unity's `batch_execute` exists for that reason [UNITY-COPLAY], and Pascal's
`apply_patch` validates and dry-runs a whole batch before committing it atomically as one step [PASCAL]. For us the
question is what a batch means for history. ADR 0008 forbids nested operator runs inside a transaction; the options
for the spec are (a) intent-level tools that already take arrays (`set_keys` over many controls and frames is one
operator run, one undo step), which covers most batching, and (b) a `batch` tool that runs N operators sequentially,
each its own step, optionally grouped under one history label. Either way the agent's edits must show up in History
as named steps ("AI: Set keys (12)").

### 3.8 Concurrency and ownership

Every live bridge serialises: Unreal runs tools on the game thread and asks clients not to overlap calls [UNREAL];
the Cascadeur community bridge executes one mailbox request at a time [CASC-COMM]; Spline routes to the last-focused
tab and the most recent connection wins [SPLINE]; PlayCanvas drives one editor and hands the port between servers
[PLAYCANVAS]; Pascal version-checks every mutation against the saved scene and refuses with
`live_sync_version_conflict`, telling the agent to reload [PASCAL]. Our editor is single-threaded and its runner synchronous in `apply`, so the server should queue calls,
refuse overlapping writes with a clear error, and make "which tab is attached" visible on both sides. The human and
the agent editing at once is the same problem as two collaborators (research 06, M3): per-user undo stacks and
claims apply.

### 3.9 Instructions, prompts and skills

The official open-source-DCC server sends `prompts.yml` "instructions … to the LLM at connection time" [OSS-DCC-LAB];
Figma and Unity ship Agent Skills [FIGMA][UNITY-CLI]; Pascal publishes an agent-guide resource and workflow prompts, and
labels project content reached through it as "quoted data, never instructions" [PASCAL]; Claude Code reads server
instructions to decide when to search for a server's tools [CC-MCP]. Plan three layers: server `instructions` (what the
server is for, the edit-verify loop, units), MCP prompts for canned jobs, and a skill with longer animation craft
(blocking, spacing, overshoot, contact rules) that would bloat tool descriptions.

### 3.10 Verification loops

The best servers make the agent check its own work: VRMA Lab's `validate` and export read-back, PlayCanvas runtime
screenshots and logs, Pascal's `verify_scene` and `check_collisions`, Godot's run-and-capture-output
[VRMA-LAB][PLAYCANVAS][PASCAL][GODOT]. We already have export lints,
read-back checks and evaluation probes; expose them as tools (`validate_clip`, `measure_contacts`, the export
result's read-back report) so a task ends with evidence, not with an assertion.

### 3.11 Telemetry and network

The community open-source-DCC server collects anonymous usage by default and content only on opt-in; PlayCanvas collects
nothing and makes one documented outbound request [OSS-DCC-MCP][PLAYCANVAS]. An MIT editor bridge should collect nothing
and make no network requests of its own.

---

## 4. Reuse and licences

ADR 0009 allows MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak, CC0 and OFL dependencies and forbids copying GPL/AGPL or
unlicensed code.

| Candidate | Licence | Use |
|---|---|---|
| `@modelcontextprotocol/server`, `/client`, `/core` 2.3.1 | Apache-2.0 | **Dependency** (server; client for tests). NOTICE in the generated third-party notices. |
| `@modelcontextprotocol/sdk` 1.32.1 | MIT | Not chosen (maintenance-only, no 2026-07-28, heavy dependency tree). |
| `@modelcontextprotocol/ext-apps` 2.0.3 | MIT | Later, for MCP Apps. |
| `zod` 4.x | MIT | Peer dependency of SDK v2; for hand-written tool schemas. |
| `ws` 8.22.0 | MIT | WebSocket server in the Node process. |
| `@anthropic-ai/mcpb` 2.1.2 | MIT | Build-time CLI to pack an `.mcpb`. |
| `@mcp-b/global` 6.0.3 | MIT | Possible WebMCP polyfill later. |
| PlayCanvas Editor MCP server | MIT | **Copy-adapt with attribution** (ADR 0009 rule 3) where useful: the WebSocket ownership/stand-by logic, Origin allowlist, LNA hints, client snippets. |
| Pascal `@pascal-app/mcp` and `@pascal-app/cli` | MIT | **Copy-adapt with attribution** where useful: the stdio-to-loopback connector with a token file, error-code and retired-tool conventions, the test harness that drives the server through an in-memory client. Built on SDK v1, so code moves over with the v2 codemod. |
| threejs-devtools-mcp, Figma-Context-MCP, community open-source-DCC server, MCP for Unity, community Cascadeur server | MIT | Patterns; code is Python or unrelated except threejs-devtools-mcp (TypeScript). |
| IvanMurzak Unity-MCP, VRMA Lab, Playwright MCP, Chrome DevTools MCP | Apache-2.0 | Patterns; VRMA Lab's validator already flagged in research 05. |
| Official open-source-DCC server | **GPL-3.0** | Ideas only (live/headless twins, docs search); no code. |
| chongdashu/unreal-mcp, figma/mcp-server-guide, V1xel's auto-rigging-service server | **no licence** | Do not copy. |
| `@modelcontextprotocol/inspector` 2.11.0 | "SEE LICENSE IN LICENSE" | Developer tool via `npx`, not a dependency. |

---

## 5. Implications for Ekza Animator

### 5.1 What we already have

| MCP need | Ekza Animator today |
|---|---|
| A typed, discoverable action set | `OperatorRegistry` with ~114 operator ids in `OperatorMap`, `label`, `description`, `category`, `flags` (`undo`, `internal`, `structural`), `poll` with reasons (ADR 0008; `packages/editor-core`) |
| JSON Schema per action | M6a `ParamDef` + `paramSchema()` (draft 2020-12) + `coerceArgs()` that never throws and reports `problems` |
| One call = one undo step | Runner wraps `apply` in one `store.transact`, records one history step, labels via `undoLabel(args)`; `coalesce` for repeated runs |
| Read model | e2e test API (MVP-SPEC §4.8): characters, controls, clips, curves, exact curve values, channel values, bone/control world transforms, limbs, Dope Sheet rows, autosave, last export with lints and read-back |
| Headless execution | `packages/headless-tests` runs import, operators (`app.run`) and `file.export` against fixtures in a Node test environment |
| Verification | export lints, read-back validation, budgets |

The M-AI work is therefore a **projection** of the registry into MCP plus two transports, not a new API.

### 5.2 Proposed mapping from operator flags to annotations (for the spec to confirm)

| Operator kind | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | Extra |
|---|---|---|---|---|---|
| Reads, capture, measurements | true | — | — | false | — |
| Absolute in-document edits (`set_pose`, `set_tangents`, `set_loop`) | false | true (overwrites values; undoable in the editor) | true | false | Description says "one undo step". |
| Relative edits (`retime_keys` by offset, `nudge`) | false | true | false | false | — |
| Purely additive edits (create a clip or a breakdown on an empty frame) | false | false | false | false | — |
| `structural` operators (fps change, rest-pose rewrites) | false | true | false | false | Consider an elicitation confirm in live mode. |
| File writes in headless mode (save project, export to path) | false | true when overwriting | true | false | Paths confined to the workspace root; `anthropic/requiresUserInteraction` only for overwriting files outside autosave (to decide). |
| `internal` operators | not exposed | | | | — |

### 5.3 Architecture sketch (for the architecture topic to refine)

```
MCP client (Claude Code, Claude Desktop, Cursor, Codex, VS Code)
   ⇅ stdio (MCP 2026-07-28 or 2025-11-25, SDK v2 serveStdio)
ekza-animator MCP server (Node, one npm bin: `mcp` | `run <op>` | `capture` | `mcp install <client>`)
   ├─ live:     ⇅ ws://127.0.0.1:<port>  (Origin allowlist + per-launch secret, user clicks Connect in the editor,
   │                                      one editor at a time, serial queue)  ⇅  editor tab → app.run → history
   └─ headless: in-process EditorApp (editor-core + io + rig in Node) on .ekzanim / .vrm / .glb in a workspace root
```

Both legs expose the **same tool table**; a WebMCP adapter (`document.modelContext.registerTool`) and the later
in-editor AI panel (LLM API with the same definitions) would read that table too.

### 5.4 Open questions for the M-AI spec

1. **Pairing.** Origin allowlist plus which secret flow: a code shown by the server in its first tool result and typed
   into the editor, a code shown by the editor and passed as a tool argument, or a URL with a fragment token opened by
   the server? When the same Node process also serves the editor locally, it can hand the page its secret directly,
   and a Pascal-style stdio connector can find the port and token in local files, so neither the user nor the client
   config ever sees them [PASCAL-CONNECTOR]. Which origins (localhost dev, the static export, a future hosted origin)?
2. **Public origin and LNA.** If the editor is served from a public HTTPS origin, the first connect triggers Chrome's
   Local Network Access prompt; is a locally served editor (`npx … mcp --open`) the default instead?
3. **Batch semantics** (§3.7): array-taking intent tools only, or also a `batch` tool; one history step per operator
   or one grouped label?
4. **Selection.** Do agent tools act on explicit ids only (recommended for determinism) or also on the user's current
   selection (`target: "selection"`), and does an agent edit change the user's selection?
5. **Concurrent human edits.** Lock the document while an agent call runs, or treat the agent as a second user
   (per-user undo, claims; aligns with M3)?
6. **Headless scope.** Which packages run in Node today without DOM/WebGL (capture needs a GL context: headless
   Chrome, or skip images in headless mode)?
7. **Tool count and names.** The final list of 25–35 intent tools, and whether `list_operators` hides operators
   whose `poll` fails in the current state or shows them with reasons.
8. **Distribution.** npm package name; Claude Code plugin with a skill; `.mcpb` timing; whether `mcp install <client>`
   edits client configs (Unity CLI style) or only prints snippets.

---

## 6. Sources

Specification and SDK (read 2026-10-19)
- [MCP-VER] Versioning: https://modelcontextprotocol.io/specification/versioning
- [MCP-CL-2026] 2026-07-28 key changes: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- [MCP-CL-2511] 2025-11-25 key changes: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- [MCP-CL-2506] 2025-06-18 key changes: https://modelcontextprotocol.io/specification/2025-06-18/changelog
- [MCP-CL-2503] 2025-03-26 key changes: https://modelcontextprotocol.io/specification/2025-03-26/changelog
- [MCP-TOOLS] Tools (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- [MCP-SCHEMA] `schema.ts` (2026-07-28), `ToolAnnotations`, `Tool`: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
- [MCP-TRANSPORTS] Transports overview: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- [MCP-STDIO] stdio binding: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- [MCP-SHTTP] Streamable HTTP binding (security warning): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- [MCP-SEC] Security best practices: https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
- [MCP-EXT] Extensions overview: https://modelcontextprotocol.io/docs/extensions/overview
- [MCP-EXT-MATRIX] Extension client matrix: https://modelcontextprotocol.io/extensions/client-matrix
- [MCP-TASKS] Tasks extension: https://modelcontextprotocol.io/extensions/tasks/overview · https://github.com/modelcontextprotocol/ext-tasks
- [MCP-APPS] MCP Apps: https://modelcontextprotocol.io/extensions/apps/overview · https://github.com/modelcontextprotocol/ext-apps
- [MCP-LOCAL] Connect to local MCP servers (Claude Desktop config): https://modelcontextprotocol.io/docs/develop/connect-local-servers
- [TS-SDK] TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- [TS-SDK-VERS] Protocol versions and eras: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
- [TS-SDK-TOOLS] Tools guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md
- [TS-SDK-STDIO] Serve over stdio: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md
- [TS-SDK-IR] `input_required`: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/input-required.md
- [TS-SDK-SCHEMA] Schema libraries, `fromJsonSchema`: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/advanced/schema-libraries.md
- [NPM] `npm view` on 2026-10-19: `@modelcontextprotocol/sdk` 1.32.1 (MIT), `@modelcontextprotocol/server`/`client`/`core` 2.3.1 (Apache-2.0, Node ≥ 20, `zod ^4.2.0`), `@modelcontextprotocol/node` 2.1.1, `@modelcontextprotocol/express` 2.0.2, `@modelcontextprotocol/ext-apps` 2.0.3 (MIT), `@modelcontextprotocol/inspector` 2.11.0, `@anthropic-ai/mcpb` 2.1.2 (MIT), `@mcp-b/global` 6.0.3 (MIT), `ws` 8.22.0 (MIT), `zod` 4.6.7
- MCP Registry (preview): https://registry.modelcontextprotocol.io/

Clients
- [CC-MCP] Claude Code MCP: https://code.claude.com/docs/en/mcp
- [CC-ERR] Claude Code errors (128-character tool names): https://code.claude.com/docs/en/errors
- [CLAUDE-TOOLS] Claude API tool definitions (name pattern): https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- [CLAUDE-VISION] Claude vision (visual-token cost): https://platform.claude.com/docs/en/build-with-claude/vision
- [MCPB] MCP Bundles: https://claude.com/docs/connectors/building/mcpb · https://github.com/modelcontextprotocol/mcpb
- [CURSOR] Cursor MCP: https://cursor.com/docs/context/mcp
- [VSCODE] VS Code MCP servers: https://code.visualstudio.com/docs/copilot/customization/mcp-servers
- [CODEX] Codex MCP: https://developers.openai.com/codex/mcp (redirects to https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [GEMINI] Gemini CLI MCP servers: https://geminicli.com/docs/tools/mcp-server/

Tool design
- [A-TOOLS] Anthropic, "Writing effective tools for agents — with agents": https://www.anthropic.com/engineering/writing-tools-for-agents
- [A-CODE] Anthropic, "Code execution with MCP" (2025-11-04): https://www.anthropic.com/engineering/code-execution-with-mcp

Security
- [CVE-INSPECTOR] Oligo Security, MCP Inspector CVE-2025-49596: https://www.oligo.security/blog/critical-rce-vulnerability-in-anthropic-mcp-inspector-cve-2025-49596
- [WILLISON-GH] Simon Willison, GitHub MCP exploited: https://simonwillison.net/2025/May/26/github-mcp-exploited/
- [TRIFECTA] Simon Willison, "The lethal trifecta for AI agents": https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- [POISON] Invariant Labs, tool poisoning: https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks · CSA research note: https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/
- [LNA] Chrome Local Network Access: https://developer.chrome.com/blog/local-network-access · Chrome 147 WebSocket/WebTransport enforcement: https://www.phoronix.com/news/Chrome-147-Stable-Released · PlayCanvas bridge comment (Chrome 142+, WebSockets from 147): https://github.com/playcanvas/editor-mcp-server/blob/main/src/wss.ts

DCC and creative servers (GitHub/Gitea metadata 2026-10-19)
- [OSS-DCC-MCP] Community MCP server for the open-source DCC (ahujasid, MIT; GitHub)
- [OSS-DCC-LAB] Official MCP server from the open-source DCC project's lab (GPL-3.0; project site and Gitea)
- [UNITY-COPLAY] MCP for Unity: https://github.com/CoplayDev/unity-mcp · tool groups: https://coplaydev.github.io/unity-mcp/guides/tool-groups
- [UNITY-OFFICIAL] Unity MCP (AI Assistant): https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.0/manual/unity-mcp-get-started.html
- [UNITY-CLI] Unity CLI replaces the in-Editor MCP server: https://docs.unity.com/en-us/unity-cli/replace-mcp-server-unity-cli
- Unity-MCP (IvanMurzak): https://github.com/IvanMurzak/Unity-MCP
- [UNREAL] Unreal MCP in Unreal Editor (5.8, experimental): https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor
- [UNREAL-COMMUNITY] unreal-mcp: https://github.com/chongdashu/unreal-mcp
- [DESKTOP-DCC-MCP] Community MCP server for the desktop DCC (PatrickPalmer, MIT; GitHub)
- [CASC-NEWS] CG Channel, Cascadeur 2026.2: https://www.cgchannel.com/2026/08/nekki-releases-cascadeur-2026-2-with-animation-layers/
- [CASC-COMM] cascadeur-mcp (community): https://github.com/gprethesh/cascadeur-mcp
- [FIGMA] Figma MCP server tools: https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/ · guide: https://github.com/figma/mcp-server-guide
- Figma-Context-MCP: https://github.com/GLips/Figma-Context-MCP
- [SPLINE] Spline MCP Server: https://docs.spline.design/generate/spline-mcp-server
- [PLAYCANVAS] PlayCanvas Editor MCP Server: https://github.com/playcanvas/editor-mcp-server
- [PLAYCANVAS-WSS] PlayCanvas WebSocket bridge (Origin check, standby and yield): https://github.com/playcanvas/editor-mcp-server/blob/main/src/wss.ts
- [PASCAL] Pascal editor and `@pascal-app/mcp` 1.0.4 (MIT): https://github.com/pascalorg/editor · https://github.com/pascalorg/editor/blob/main/packages/mcp/README.md
- [PASCAL-CONNECTOR] Pascal CLI stdio connector: https://github.com/pascalorg/editor/blob/main/packages/cli/src/mcp-connector.ts
- [THREE-DT] threejs-devtools-mcp: https://github.com/DmitriyGolub/threejs-devtools-mcp
- [VRMA-LAB] VRMA Lab: https://github.com/YuBan834/vrma-lab
- [GODOT] godot-mcp: https://github.com/Coding-Solo/godot-mcp
- [PW-MCP] Playwright MCP: https://github.com/microsoft/playwright-mcp
- [CDT-MCP] Chrome DevTools MCP: https://github.com/ChromeDevTools/chrome-devtools-mcp
- [WEBMCP] WebMCP draft and implementation status: https://webmachinelearning.github.io/webmcp/ · https://github.com/webmachinelearning/webmcp
- [WEBMCP-OT] Chrome WebMCP origin trial (2026-06-09): https://developer.chrome.com/blog/ai-webmcp-origin-trial
- [MCP-B] MCP-B WebMCP polyfill: https://www.npmjs.com/package/@mcp-b/global
- [AUTORIG-MCP] Community MCP server for the web auto-rigging service (V1xel, no licence; GitHub)
- Rive community server **(unverified)**: https://www.npmjs.com/package/rivemcp
