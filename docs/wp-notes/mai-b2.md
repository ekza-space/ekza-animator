# B2 — Live bridge (M-AI MVP, phase B)

Branch `mai/b2-bridge` off `mai/port`. Binding definition: [MCP-SPEC §0.4.5 B2](../MCP-SPEC.md#045-phase-b-work-packages)
with §4.5, §5.8–§5.10, §5.19 and P7 of §8 as far as the MVP cut (§0.4.2) keeps them. Decisions are copied to
[DECISIONS-OPEN §N.6](../DECISIONS-OPEN.md#n6-mvp-cut-and-port-2026-10-23) as `M-AI-B2-n`.

## What landed

| Item | Where | State |
|---|---|---|
| Loopback WebSocket server: first free of 47821–47830 (`--bridge-port n`, 0 = ephemeral), bound to 127.0.0.1 only; refuses with 403 a `Host` that is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, a missing `Origin` and one off the allow-list (exact or `scheme://host:*`); the hosted editor `https://studio.ekza.io` is compiled in next to the local dev origins; ≤ 8 unpaired sockets (503 beyond), `hello` within 5 s (1008), frames ≤ 64 KiB before pairing (1009), 16 MiB after; refusal lines rate-limited to one per reason per 10 s | `packages/mcp-server/src/bridge/{server,checks}.ts` | `test/bridge.test.ts` |
| `hello` / `hello.ok` / `hello.refused`: toolset handshake (the editor's major must equal the server's; a different hash of the same major is logged at debug), nothing about the tab before `pair.ok` | `bridge/server.ts`, editor `agent/bridge/discovery.ts` | tested both sides |
| Pairing: server-generated codes (31-symbol alphabet, `crypto.randomBytes` with rejection sampling, `K7Q-M4P`), ≤ 4 pending codes, one per socket, TTL 120 s, single use, claims with or without the dash in any case, constant-time compare; five wrong claims within 60 s lock pairing for 60 s (`busy`); `editor_connect` waits ≤ 50 s for the user's decision and answers `busy` (retryable) after it — a repeated claim of the same code waits on the same dialog; Deny → `declined`; one tab per server (`hello.ok {busy: true}`, `pair.offer` → `error busy`) | `bridge/{server,codes}.ts` | tested |
| `pair.ok`: session id, 256-bit base64url token (memory only, never logged), the actor `agt_…` (the client's reported name, sanitised, ≤ 40 characters, else "Agent"), the handle `tab_…`; then the tab reports title and project, the server reads `scene_summary` from it and answers `editor_connect {project, grants, actor, origin, summary}`; "paired with a tab at <origin>" on stderr | `bridge/server.ts` | tested; e2e |
| Call relay: ids `c_<n><8 base62>`, deadlines 30 s (files 300 s, `editor_connect` 50 s) extended once by `confirmTimeoutMs` when the tab reports a confirm or redo card, `timeout` (not retryable) with `cancel`, MCP cancellation → `cancel` and `cancelled`, `bye`/close → in-flight calls `not_connected` and the handle `expired_handle` | `bridge/server.ts`, `bridge/route.ts` | tested |
| Re-validation of every tab result: the server's own output schema (unknown fields stripped), the error envelope's own schema, `finishResult` (sanitiser and the tool's budget), at most one image with its PNG/WebP header checked against the reported size (≤ 1,568 px, ≤ 8 MiB), write names through the strict parser (no separators: the socket closes with 1008), writes performed only through the hub's `TabFileHooks` | `bridge/results.ts` | tested (rogue fields, hostile strings, mislabelled image, `../x.vrma`) |
| Blobs: JSON header + one binary frame, 1 MiB chunks in order, SHA-256 of the whole blob on the last chunk, ≤ 256 MiB pending per socket; both directions (images and writes tab → server; pre-attached workspace files server → tab) | `bridge/server.ts`, editor `agent/bridge/socket.ts` | tested (image) |
| `TabLink` — the hub's only view of the bridge (`port`, `status`, `tab`, `claim`, `call`, `unpair`, `close`); `startHubBridge(hub)` starts it when `config.bridge.enabled` and attaches it; the hub routes `editor_connect`, `project_close {tab_…}` and every call addressed to the tab (`tab_…`, or no `project` while the tab is paired) through `routeToTab` | `bridge/{link,route,attach}.ts`, two hooks in `hub/hub.ts`, `start.ts` | tested |
| `editor_connect` ready (`requiresUserInteraction`, `alwaysLoad`); its `run` answers `unsupported` inside a runtime (the server answers it) | `agent-tools/src/tools/connection/{defs,editor_connect}.ts`, `tools.manifest.json` | manifest regenerated |
| Editor session: discovery of the given ports or the ten defaults (1,500 ms each), automatic selection of the only free server, `pair.offer`, a new code when one expires while offering, `pair.claimed` → `claimed`, Allow/Deny, grants and Pause messages, `bye` on `pagehide` and Disconnect, the runtime per pairing (the same `createAgentToolRuntime` headless runs) with the live host, `cancel` → the call's signal, progress → `waitingFor`, the confirm card queue (one at a time, resolved by history changes for the redo wait), the audit log (≤ 500 rows, step, Show target from the actor's presence, `unreachable` from the history stacks), checkpoints from `history_checkpoint`, errors `no_server` / `lna_denied` / `version` / `closed` with the §5.10 texts | `packages/editor/src/agent/{session.ts,bridge/**}` | e2e |
| Lazy loading: `agent/bridge/slot.ts` (no runtime imports) is the page's session slot; `loadAgentSession` dynamic-imports `agent/session.ts`, which pulls agent-tools; nothing new is imported by the first-visit code of `/editor` or `/autorig` | `agent/bridge/slot.ts` | `check:size` unchanged against `mai/port` |
| Test API: `agent()` from the session store, `agentAct()` (new), `?e2e=1&agentPort=` connects at start (inside the lazy test-API chunk) | `editor/src/test-api/mai/{agent,index}.ts`, `types.ts` (appended), `createTestApi.ts` (passes the host) | e2e |
| `apps/web/e2e/ai-01-live.spec.ts`: the built bin, the production editor; pair, `scene_summary`, `clip_create` and `keys_set` over the bridge, `AI: …` steps attributed to the agent, the audit rows, the user's undo and redo, Disconnect → `expired_handle` | `apps/web/e2e/ai-01-live.spec.ts`, `helpers/ai.ts` (`agentState`, `pairViaTestApi` appended) | green |

## Chrome Local Network Access

An editor served from `https://studio.ekza.io` that opens `ws://127.0.0.1:4782x` is a public page reaching a loopback
address. Chrome's Local Network Access (Chrome 142 and later) asks the user once per site — *"Access other apps and
services on this device"* — before the socket may open; mixed content does not apply (loopback counts as potentially
trustworthy), and WebSockets carry no CORS preflight, so the server needs nothing extra. When the user blocks it (or
Chrome blocked it earlier), the socket fails exactly like a port nobody listens on. The session therefore:

- probes as usual; when nothing answers on a page whose origin is not loopback, it reads
  `navigator.permissions.query({name: 'local-network-access'})` inside try/catch: `denied` → error `lna_denied` with the
  recovery steps (Site settings › Local network access); otherwise `no_server` with the agent setup pointer, the LNA
  hint ("choose Allow; if you blocked it: Site settings › Local network access"), the Safari note on Safari, and the
  `--allow-origin <this page's origin>` hint (a 403 looks the same to the page);
- never retries by itself (no prompt loop); [Try again] in the panel (B3) calls `connect()` again.

Pages on `localhost`/`127.0.0.1` (the `pnpm dev`/e2e editor) are not subject to the prompt. The Agent panel (B3) shows
`error.message` and, for `lna_denied`, the `agent-lna-help` block.

## Decisions and deviations (copied to DECISIONS-OPEN §N.6)

- **M-AI-B2-1** D0 named the B1/B2 seam `TabLink` "in `hub.ts`" but never landed it. B2 defines it in
  `mcp-server/src/bridge/link.ts` and touches `hub.ts` with two additive hooks only: `attachTabLink`/`tabLink()` and a
  first line in `callTool` that asks `routeToTab` (B2's file) whether the call is the bridge's. B1 keeps the hub; its
  router should call the link the same way (and list `link.tab()` in `projects_list`). Without a `project` the tab wins
  while it is paired — B1's router decides between the tab and headless projects.
- **M-AI-B2-2** The frozen `AgentSessionState` is unchanged. The `AgentSession` object gains the actions the UI needs
  (`select`, `cancel`, `accept`, `deny`, `setGrants`, `setPaused`, `answerConfirm`) and a second store `extra` with what
  the grants dialog shows besides the state (`claim: {client, cwdName}` after `pair.claimed`, the preselected `ports`);
  `AgentSessionDeps` gains `build` (what `hello` reports). B3 gets the session through `agentSessionOf(app)` /
  `loadAgentSession(app, deps)` / `onAgentSession` in `agent/bridge/slot.ts`.
- **M-AI-B2-3** The test API gains `agentAct(action, grants?)` (connect, accept, deny, pause, resume, allowConfirm,
  denyConfirm, disconnect) and `maiTestApi(app, host)` takes the host (for the viewport). `ai-01-live` pairs through
  `agentAct('accept')` because the grants dialog is B3's and not on this branch; `helpers/ai.ts`'s UI `pair()` stays for
  B3/INT, which should switch the spec to clicking `agent-allow` once the dialog lands.
- **M-AI-B2-4** The hosted origin `https://studio.ekza.io` is compiled into the bridge's allow-list in
  `bridge/server.ts`, not into `DEFAULT_ALLOWED_ORIGINS` (B1's `config.ts` and its tests); `--help` still names only the
  local origins.
- **M-AI-B2-5** `AGENT_TOOLSET_VERSION` `1.0.0-dev.1` → `1.0.0-dev.2`: `editor_connect` turning ready changes the
  manifest hash and the update guard requires a bump. B1/B3/B4 bump in parallel; INT regenerates and sets
  `1.0.0-mvp.1`. Two agent-tools tests that enumerate the ready tools (`tools-envelope`, `tools-invariant`) leave
  `editor_connect` out (no runtime ever runs it).
- **M-AI-B2-6** Resume is cut (M-AI-MVP-17): `resume` answers `error unsupported`, any close (clean or abnormal, or two
  missed pongs) ends the pairing, the tab keeps no result cache, and the tab shows `error {kind: 'closed'}` ("Connect
  again and pair with a new code"). The replacement rule for a disconnected pairing therefore never applies.
- **M-AI-B2-7** The MCP client's name (`hub.setClientInfo`) is not wired on `mai/port` (`mcp/server.ts` is B1's).
  Until B1 sets it from the SDK's `initialize` (`getClientVersion()`), `hello.ok`/`pair.claimed` carry `client: null`
  and the actor is named "Agent".
- **M-AI-B2-8** Workspace transfers over the bridge go through `TabFileHooks` (`attach`, `write`) that B1's sandbox
  supplies via `startHubBridge(hub, {files})`; without them no bytes are pre-attached and a result with `writes` answers
  `unsupported` "deliver the file as a download". The live host keeps one files buffer (attached bytes, queued writes),
  drained after every edit/files call: correct because those calls run one at a time (§5.8 3).
- **M-AI-B2-9** Lockout: the fifth wrong code itself still answers `not_found`; every claim during the lockout answers
  `busy` "Too many wrong codes; wait a minute".
- **M-AI-B2-10** `?agentPort=` outside e2e (open the panel with the ports preselected, nothing sent before Connect) is
  the panel's (B3); the session takes the ports from `deps.params.agentPorts` and exposes them in `extra.ports`. In e2e
  pages the connect-at-start lives in the lazy test-API chunk, so it costs no first-visit bytes.
- **M-AI-B2-11** Audit rows: `reverted` stays false (no revert tracking in B2), `beforeAgent` stays null (Restore before
  the agent is cut from the MVP UI); `show` comes from the actor's presence focus when the call ended.
- **M-AI-B2-12** The live host advertises `capture.shaded` only when `deps.viewport()` returned a ViewportManager at
  session creation; B3's `view_capture` may need to re-check.

- **M-AI-B2-13** The agent URL parameters (`parseAgentParams`, `AgentParams`, `AGENT_PORT_RANGE`, `AGENT_PORTS_MAX`,
  `DEFAULT_AGENT_PARAMS`) moved from the eager `test-api/params.ts` to `test-api/agentParams.ts`: a lazy chunk that
  imports an export of an eager module keeps that export in the first-visit bundle (it cost ≈ 370 B here). B3's panel
  must import them from `agentParams.ts`.
- **M-AI-B2-14** First-visit cost of B2: **+164 B** on `/editor` (902,926 B against `mai/port`'s 902,762 B) and
  **+169 B** on `/autorig` (664,813 B against 664,644 B), measured on both branches with the same build. No B2 code is
  in the eager scripts: the delta is Turbopack's export registration (`e.s([...])`) of eager `editor-core` modules that
  the lazy agent chunk now imports (`loadAgentOperators`/`AGENT_OPERATOR_IDS`, the runner's `CANCELLED_BY_AGENT` and
  `GESTURE_IN_PROGRESS`, …) — any browser-side agent runtime pays it once (B3 shares it). Owner decision on the gates
  stays M-AI-MVP-2.

## Gate

`EKZA_E2E_PORT=3152 pnpm run ci`: see the final report of the package (check:size red by design on `mai/port`).
