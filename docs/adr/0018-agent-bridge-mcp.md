# ADR 0018 — Agent bridge: MCP over the operator registry, a paired loopback bridge to the open tab, a headless runtime

- Status: Proposed (2026-10-19, with the M-AI build spec). Accepted when [MCP-SPEC](../MCP-SPEC.md) freezes at the
  start of its package D0.
- Inputs: research [20](../research/20-mcp-state-and-dcc-servers.md) (MCP in October 2026, DCC servers, security
  record), [21](../research/21-agent-bridge-architecture.md) (runtimes, bridge, pairing, permissions, presence),
  [22](../research/22-animation-agent-toolset.md) (tool catalogue, conventions, evaluation),
  [08](../research/08-extensibility-modeling.md) §5.2 and §8, [05](../research/05-landscape.md) §2.3, §3.7;
  ADRs 0002, 0008, 0013, 0017.

## Context

The owner asked for an MCP connection "so an AI agent can help make animation and do tasks in the editor". ADR 0008
made the operator registry the one path for every action, with typed arguments, `poll` reasons and one transaction
and one history step per run, and named "a future scripting/agent API" as one of its consumers; FR-EXT-06 planned an
MCP bridge for M5. Three facts shape the bridge:

- **The editor is a browser tab.** A tab cannot be an MCP server, and MCP clients (Claude Code, Claude Desktop,
  Cursor, VS Code, Codex) start local servers as stdio child processes. Browsers do not apply CORS to WebSockets, and
  Chrome gates public pages reaching loopback behind a Local Network Access prompt (fetch from Chrome 142, WebSockets
  from 147). The MCP Inspector's unauthenticated localhost port (CVE-2025-49596) shows that an `Origin` check alone is
  not enough; PlayCanvas's editor bridge accepts `Origin`-less local processes as "editors".
- **The user is working in that tab at the same time.** The runner records the session selection in every undo
  entry and undo restores it; a change of the playhead drops the user's unkeyed overrides; many operators act on the
  user's selection or current frame; the history is one linear stack (ADR 0013).
- **MCP changed in 2026-07-28** to a stateless revision (no protocol sessions; state as explicit handles; Roots,
  Sampling and Logging deprecated), while many clients still speak 2025-11-25. TypeScript SDK v2
  (`@modelcontextprotocol/server`, Apache-2.0) serves both eras; v1 (MIT) never speaks the new one.

Prompt injection through tool results is the main risk class of agent integrations: the agent that drives the editor
often also has a shell, and names and metadata in imported files are untrusted text.

## Decision

1. **One tool layer over the operator registry, no code execution.** A headless package, `agent-tools`, defines a
   curated set of task-level tools (38 in M-AI, plus stretch tools) with zod schemas published as JSON Schema 2020-12,
   an access class per tool, and `run(ctx, args)` against `EditorApp`. The editor tab, a headless Node runtime and a
   later in-app Assistant run the same code. Every write is **one run of one explicit-target operator**; the long tail
   is reachable through `operator_run` under a policy table (allowed / confirm / denied, with an access class), where
   unclassified operators — including every operator M6a, M6b or an extension adds — are denied. There is no
   `execute_code`, script or network tool.
2. **Agent edits are attributed history steps and never touch the user's session state.** `RunContext` gains
   `actor`, `signal` and a per-call `scope` (targets in place of the user's selection; empty parts stay empty). The
   runner labels actor steps `AI: …`, records the actor and the step's document changes, never coalesces across
   actors, omits selection snapshots, and fails and rolls back an actor run whose operator changed the user's
   selection, playhead, overrides, tools, clipboards, buffers, layout or preferences (only View-grant operators are
   exempt). Frames are explicit arguments; no tool moves the playhead without the View grant. `Mod+Z` undoes AI steps
   like any step; a forward selective revert (`edit.revertSteps`, compare-before-restore per merge unit through a pure
   `planRestore`) undoes older AI steps without destroying later user edits.
3. **Transports.** The `ekza-animator-mcp` bin speaks stdio to the client for both protocol eras through SDK v2's
   `serveStdio` and a low-level `Server` with our own handlers (our validation, our manifest order), optionally
   Streamable HTTP bound to `127.0.0.1` with a bearer token. The **live leg** is a WebSocket that the editor tab opens
   to the server on a loopback port (47821–47830); the **headless leg** runs `createHeadlessEditorApp` in the server
   process on files in a workspace folder. One static, deterministic tool list serves both; project handles (`tab_…`,
   `prj_…`) route calls.
4. **Security boundary.** Loopback only. WebSocket upgrades need a loopback `Host` and an allow-listed `Origin` (a
   missing `Origin` is refused, so only a browser tab can be the editor). A tab is paired only when the agent presents
   a one-time code that the editor shows; the user then grants Read (always), Edit (pre-ticked), Files and View
   (unticked), changeable, pausable and revocable at any time; a 256-bit token in memory resumes dropped sockets.
   Consequential calls are confirmed in the editor (headless: `confirm: true`). Headless file IO is confined to the
   workspace roots (realpath, no dot-segments, extension allow-list, explicit overwrite). Strings from documents are
   returned as sanitised data, and the instructions say they are never instructions. No telemetry and no outbound
   network from the server or the editor's agent module.
5. **Presence and audit in the editor**: a status-line pill, the agent's focus controls outlined and its frame marked
   on the time slider, and an Agent panel with grants, the audit log, Undo/Revert per step and "Revert all AI changes".
   One `PresenceRegistry` in editor-core serves the agent now and collaboration (M3) later.
6. **Versioned contract.** The tool manifest (names, schemas, annotations) is a committed contract file with a semver
   toolset version checked in the bridge handshake; tool names are a public API (added, deprecated, never silently
   renamed).
7. **Later, not now**: an in-app Assistant runs the same tools through the Claude Messages API via a server proxy
   route or the paired companion process — never with a provider key in the browser (ADR 0017's rule); text-to-motion
   tools run behind ADR 0017's gateway; remote MCP servers need Ekza accounts (M4b).

## Alternatives

| Alternative | Why not |
|---|---|
| Expose every operator 1:1 as an MCP tool | 115 tools, many acting on the user's selection or playhead; poor tool choice by models and a large token cost |
| An `execute_code` / script tool (Blender MCP, Spline) | Unbounded reach under prompt injection; everything an agent may do should be something a user may do, through undo and grants |
| Borrow the user's selection for agent runs (set, run, restore) | The runner stores the session selection in each undo entry and undo restores it, so the user's next `Mod+Z` would restore the agent's temporary selection; a frame change drops unkeyed overrides |
| Agent edits through `store.applyChanges` (external origin) | Never on the undo stack; the owner wants `Mod+Z` to undo AI edits |
| `Origin` check without a pairing secret (PlayCanvas), or a secret without `Origin` | A local non-browser process could pose as the editor and feed the agent crafted results; a website could open the socket |
| One fixed port handed to the newest server | A second agent session would silently take the tab from the first |
| The MCP server drives its own headless browser | Not the user's tab or session; heavy; browsers stay out of CI |
| MCP SDK v1 (`@modelcontextprotocol/sdk`) | Maintenance-only, never speaks 2026-07-28 |
| WebMCP or MCP Apps as the transport | Browser agents only or client-specific; later adapters over the same tool layer |
| Agent as a Yjs collaboration peer now | Needs the M3 sync server and per-user undo; the tool layer moves over unchanged later |

## Consequences

- Editor-core gains additive contracts (`RunActor`, `RunScope`, `RunContext.actor/signal/scope/source`,
  `HistoryStep.actor/changes`, `EditorHistory.entries()`, `PresenceRegistry`, `createHeadlessEditorApp`,
  `EditorServices.readSample/viewCapture`, `OperatorDef.agent`), eight explicit-target operators and a scope
  migration of twelve selection-driven operators; doc gains `planRestore`. Shipped behaviour for user runs is
  unchanged.
- M6a's `RunSource` is shared; agent runs never become M6a's `lastRun` (a one-line contract note in M6A-SPEC §5.7);
  M6a/M6b operators stay denied for agents until classified.
- The editor's first-visit route is unchanged (the agent module is a lazy chunk). The published bin is the
  repository's first npm package; publishing it is the owner's decision.
- Hosted HTTPS editors trigger Chrome's Local Network Access prompt at first connect; Safari cannot reach loopback
  from HTTPS pages and is not supported for live mode.
- Agents share the user's single linear history in M-AI; per-actor undo arrives with collaboration (M3).
