# D0 — Contracts, kernel changes, minimal runtime, scaffolds (M-AI)

Branch `mcp/contracts-foundation` (worktree `mcp-contracts-foundation`), on top of `mcp/spec` (MCP-SPEC v0.2).
Binding definition: [MCP-SPEC §8 D0](../MCP-SPEC.md#d0--contracts-kernel-changes-minimal-runtime-scaffolds-integration-agent-first).
The spec names this file `mai-contracts-foundation.md`; the build orchestration asked for `mcp-contracts-foundation.md`.

## What landed

| Item (§8 D0) | Where | State |
|---|---|---|
| (1) §4.1 types, runner rules 1–9, `scope.ts`, `entries()` + change journal, `PresenceRegistry`, headless app, `readSample`, import `activate`, `busy()` no-op for actors, `runContextOf` forwarding | `editor-core/src/{types.ts,operators/{runner,registry,scope}.ts,history/history.ts,presence/registry.ts,app/{headless.ts,factories/presence.ts},operators/builtin/{file,define}.ts,workflows/import{Model,Animation}.ts}` | working; tests `editor-core/test/kernel/mai-runner.test.ts`, `headless-tests/test/ops.mai-headless.test.ts` |
| (2) `planRestore`/`applyRestorePlan`/`restoreHostOf`, `planSnapshotRestore` | `doc/src/undo/restorePlan.ts` (+ `RESTORE_HOST` on the memory store's transactions) | working; `doc/test/restore-plan.test.ts` (≡ `undo()`/`redo()` over the conformance fuzz sequences with foreign writes; snapshot round trip byte for byte + one-step undo) |
| (3) the ten §4.10 operators as poll-failing stubs; `key.tween {frames}`, `rig.ikFk.matchRange {clip}` typed | `editor-core/src/operators/builtin/{agentKeys,agentPose,agentClip,revert}.ts`, `operators/args.ts` | stubs ("not available yet"); registration literal updated in `registration.test.ts` |
| (4) package scaffolds | `packages/{motion-analysis,schematic-render,agent-tools,mcp-server,agent-evals}` | `test/ready.ts` in each; §4.7/§4.8 types + `not-implemented` stubs |
| (5) `agent-tools` contracts | `types.ts`, `policy.ts`, `bridge/protocol.ts`, `tools/**/defs.ts` (39 + 4, `ready: false`), `tools/catalogue.ts`, `manifest/{manifest,lint}.ts`, `operators/wire.ts`, `text/**`, `tools.manifest.json` | schema lint 0 violations + Ajv 2020-12 meta-schema; policy classification; strict bridge parsers |
| (6) minimal tool runtime | `agent-tools/src/{runtime,resolve,envelope,sanitize,budget}/**` | working; `test/runtime.test.ts`, `resolver.test.ts`, `sanitize.test.ts` |
| (7) editor placeholders, test API, `--presence-agent`, agent panel, test ids, `agentHost()` | `editor/src/{agent/**,panels/agent/**,shell/StatusLine.tsx,test-api/{types,params,createTestApi,placeholder}.ts,test-api/mai/**}`, `ui/tokens.json` → `css/tokens.css`, `viewport/src/manager/ViewportManager.ts` | `editor/test/mai.test.ts`, `viewport/test/agentHost.test.ts`, `e2e/ai-00-foundation.spec.ts` |
| (8) lockfile, check-deps rows, turbo, root scripts, `.mcp.json` | `pnpm-lock.yaml`, `tooling/check-deps.mjs`, `.oxlintrc.json`, `turbo.json`, `package.json`, `tsconfig.json`, `.mcp.json` | `check:deps`, `check:licenses` green |
| (9) contract PRs of §8.2, the §3 rule 11 note | see "Routes to M6a" below | recorded here (B0a is not on `dev`) |

DoD: §4 compiles together; the runner changes are behind no flag; every new operator resolves and poll-fails
cleanly; the built server starts, `tools/list` answers `[]` (no tool ready), and it exits when stdin closes
(`mcp-server/test/cli.test.ts`); the first-visit route stays within `check:size`.

## Dependencies (2026-10-20; every one older than the 14-day `minimumReleaseAge`)

`zod` 4.6.5 (4.6.6/4.6.7 too young), `@modelcontextprotocol/server` 2.3.1 and `/client` 2.3.1 (2026-10-05),
`@modelcontextprotocol/node` 2.1.1 (2026-10-02), `ws` 8.22.0, `@types/ws` 8.18.2, `ajv` 8.20.0, `rolldown` 1.2.12
(already in the lockfile). `@modelcontextprotocol/sdk` (v1) is not used (§2).

## Decisions and deviations (INT copies them to DECISIONS-OPEN §H as MAI-D0-n)

- **MAI-D0-1** `RestoreHost` gains `tables()` and `ids(table)`: `planSnapshotRestore` must find records created since
  the snapshot, which the three §4.2 members cannot enumerate. MCP-SPEC §4.2 updated. The memory store's transactions
  answer through `RESTORE_HOST` (a symbol method; `MemoryDocumentStore.restoreHost()` is the same reads the undo
  manager's host uses, so `planRestore` is exactly `undo()`); other stores get a host over the public read API.
  `applyRestorePlan` removes records dependants first (a removal blocked by a record removed later retries).
- **MAI-D0-2** `createAgentToolRuntime` takes an optional `tools` (default `allTools()`): tests and packages run their
  own definitions through the real runtime before the catalogue tools are ready. MCP-SPEC §4.4 updated.
- **MAI-D0-3** `EditorServices.readSample`: a function is used by `file.loadSample`; `null` (the headless default)
  poll-fails "samples are not available"; `undefined` (browser services) keeps `fetch`. A rejected read is
  `asset-missing`.
- **MAI-D0-4** The invariant test of §5.14 also gates `clip.new` and `clip.duplicate` on `READY.p1`: under an actor they
  still activate the new clip until P1 implements `activate: false` (§4.10). The three of §5.14 (`graph.key.insert`,
  `clip.delete`, `rig.ikFk.matchRange`) are gated likewise. View-access operators run with `access: 'view'` and only
  must not end `internal`.
- **MAI-D0-5** Sanitiser: lone surrogates become U+FFFD first (`toWellFormed`, so every string is valid UTF-8 for
  every client); whitespace controls (tab, line breaks, NEL) become spaces before every other `Cc`/`Cf` code
  point is removed, so words never fuse; the whole tag block U+E0000–E007F goes (U+E0000 itself is unassigned, not
  `Cf`); NFC runs **last**, after the removals (round 2: `e` ZWJ U+0301 → `é`; a code-point prefix of an NFC string
  stays NFC, so the length cap keeps it). `sanitizeDeep` defines keys as own properties, so a document key
  `__proto__` stays a key, and throws a `RangeError` on a cyclic value or one nested deeper than 64 levels
  (`NEST_MAX_DEPTH`; a value shared by two branches is fine); the runtime turns it into `internal`, and its error
  path falls back to a fixed `internal` envelope when the failure itself cannot be sanitised (round 2). Progress
  messages go through the sanitiser too (prose, `PROGRESS_MAX_CHARS` 120). Envelope caps: `data` strings 300 (prose; the tool layer keeps identifiers short or opaque, §5.1), names in
  `clip`/`undo`/`candidates` 120, warnings 200, `message`/`hint`/`next` 300.
- **MAI-D0-6** Gate order of the minimal runtime: unknown tool / not ready → `unsupported`; schema → `invalid_args`
  (path like `set[2].rotateDeg.x`, unknown keys named); hosts and `needs` → `unsupported`; `view` access on a host
  without the `view` capability → `unsupported` (§5.4: "View tools headless"); a missing grant → `not_granted` (the
  call's `access` plus its `extraGrants`, MAI-D0-24; `detail.grant` the first missing one, `detail.grants` when
  several are missing, the message names them all); pause → `paused`; an aborted signal → `cancelled`. The runner's "gesture in progress" maps to `busy` through
  `finishedValue()`. Revisions: a minimal tracker (per-clip batch counter, strict `ifClipRevision`); the automatic
  stale check is P2's.
- **MAI-D0-7** Labels: `composeLabel(toolLabel, intent)` puts the intent first and cuts it at a word boundary so
  `AI: <intent> · <tool label>` fits 80 characters; the tool's label always stays whole. The runner adds `AI: ` once
  (an already prefixed label keeps one prefix) and cuts at 80 with `…`.
- **MAI-D0-8** Runner: actor runs are never gesture-safe (`edit.escape` under an actor is refused during a drag);
  override-only actor steps carry `changes: null`; a step loses `changes` with its doc part (`forgetDocEntry`);
  `entries().redo` lists the next redo first (chronological order of the undone steps).
- **MAI-D0-9** Policy table: `clip.setSettings` and `time.setFrame` are `allowed` with `confirmWhen` (the §5.14 rows say
  "confirm only when …, otherwise allowed"); `pose.setAt` and `clip.new`/`clip.duplicate` carry access `edit` — the
  `propose` mode is View per call, which P3's wire schema resolves; `clip.new`/`clip.duplicate {activate: true}` live
  need Edit **and** View (`operator_run`'s `extraGrants`, MAI-D0-24) and P3 runs them with `access: 'view'`. `operator_run`'s static
  access function reads the table (manifest: `by_operator`); P3 adds `OperatorDef.agent` for trusted definitions.
- **MAI-D0-10** Annotations follow §6.0 literally: `destructiveHint` is true for every tool that is not read-only
  except `clip_create` and `project_import` — this includes `editor_connect` and `history_checkpoint` is
  `readOnly` without `idempotent`. INT reviews `editor_connect` with the descriptions.
- **MAI-D0-11** Unit-suffix lint: numeric fields must end with a §5.2 suffix or be one of `value` (unit per channel,
  stated in the description), `weight`, `fps`, `limit`, `worst`, `every`, `neck`, `head`, `inWeight`, `outWeight`,
  `ifClipRevision`, `steps`, `contactFrame`, `attrs`/`params` (records with per-entry units), `direction`/
  `poleDirection` (normalised vectors) and `playbackRange` (the §6.12 name); `x`/`y`/`z` take their parent's unit.
- **MAI-D0-12** Manifest: `pnpm --filter @ekza-studio/agent-tools manifest` is `UPDATE_MANIFEST=1 vitest run
  test/manifest.test.ts` (the workspace's TypeScript sources import extensionless paths, which Node cannot run
  directly); it refuses to write a changed tool list under an unchanged `AGENT_TOOLSET_VERSION`. The committed
  manifest lists no tool (none is ready). CI enforces the bump too: the manifest test compares the committed manifest
  with the one at the merge base of the target branch (`EKZA_MANIFEST_BASE`, else `origin/$GITHUB_BASE_REF`, else
  dev, else main) and fails a changed hash under an unchanged version; CI's `test` job checks out the full history
  (`fetch-depth: 0`); without git history the test skips locally and fails under `CI`. Hand-off to INT: every
  manifest change during M-AI bumps the version (P2's first ready tools included), while §10.2 wants `1.0.0` at
  release — INT picks the release version (any version change passes the guard; a pre-release series such as
  `1.0.0-dev.N` during M-AI would avoid counting down).
- **MAI-D0-13** `ekza-studio-mcp` lists every runtime dependency as a devDependency (all are inlined by rolldown;
  the published manifest has no `dependencies`), `gltf-validator` as an optional peer. Round 2: the workspace's
  `exports` (`./src/index.ts`, for the evals' `createInProcessServer`) is replaced in the packed manifest by
  `publishConfig.exports` (`./package.json` only), so the package is packed and published with pnpm (which also
  rewrites the `workspace:` ranges; `pnpm pack` checked: the tarball's `exports` is `./package.json`), and INT's
  `npm pack --dry-run` runs on that tarball; `test/cli.test.ts` checks that every published entry point (bin,
  exports, main/module/types) is in `files` and that there are no `dependencies`. `check:licenses` covers
  production dependencies only; the bundle's third-party notices are P6/INT's (generated from the module graph). The
  D0 bundle inlines dynamic imports (`codeSplitting: false`, one `dist/cli.mjs`); P6 splits `dist/http.mjs`. The build
  copies `fixtures/models/polybot.vrm` to `samples/` (gitignored). Root `test:e2e` builds the server first; turbo
  builds it before its own tests and the evals.
- **MAI-D0-14** Editor: the Agent panel is a new panel directory (`panels/agent`, P8's) registered in
  `panels/index.ts`; Windows › Agent comes from the shell's extra-panel menu items, so `menuItems.ts` and
  `workspace.ts` are unchanged. The status pill is a placeholder in `StatusLine.tsx` ("AI", muted; opens the panel)
  until B9's status-group registry exists. Agent URL parameters are a separate `parseAgentParams` (`EditorParams` is
  unchanged). `agent()` answers null until P8 fills `test-api/mai/agent.ts`.
- **MAI-D0-15** `ViewportManager.agentHost()`: `activePaneId()` is the pane holding keyboard focus
  (`document.activeElement` inside a pane element, e.g. its pane menu), else the pane of the last pointer press or
  wheel, else the hovered pane, else null (§4.3 "pointer or keyboard focus"), unlike `ViewportManager.activePaneId()`,
  which falls back to the first pane and is unchanged. Focus is read at call time inside the one accessor (no new
  listener in B9's file): a wheel over another pane while focus stays in a pane's menu still answers the focused
  pane. `withPose` turns canonical bone worlds
  into node locals (`W_parent⁻¹·W`, roots `F⁻¹·W` with the skeleton's facing F), draws, and restores the locals;
  overlay passes draw after the control pass and before the manipulator.
- **MAI-D0-16** `SCHEMATIC_COLORS.contact` (not named in §4.8) is `#57e389`. `--presence-agent: #e66cff` is in
  `ui/tokens.json` with a ≥ 3:1 contrast rule against the viewport gradient and the panel backgrounds (passes).
- **MAI-D0-17** `AgentToolFailure` is a real class in `types.ts` (the contract shows `declare class`); its `retryable`
  defaults follow the §5.4 table (`poll_failed` "maybe" → true).
- **MAI-D0-18** Budgets (§5.5): `defineTool` adds an optional `truncated: boolean` to every output that does not
  declare its own (keys_read, curves_summary, pose_read keep theirs), so a cut result validates against the advertised
  closed `outputSchema` (§5.21); the schema lint requires the field. The hard cut walks the output's JSON Schema
  (`outputJsonSchemaOf(tool.output)`, cached): it shortens only declared lists (arrays with an item schema, to
  `minItems`) and records with a declared value schema, never tuples, enum-keyed or `required` records, or opaque
  `unknown` values (an operator's `inputSchema`/`example`, `operator_run`'s `value`), largest first and keeping as many
  entries as fit (binary search); a result still over the cap with every list at its minimum fails with `limit`
  ("narrow the call … or page with cursor"). `finishResult(result, {maxTokens, schema} | null)` replaces the
  `maxTokens | null` parameter. Test: every tool's long sample is cut validly (Ajv against the manifest entry and the
  zod envelope) or refused with `limit`; 27 of 43 tools cut, the 16 scalar-only results answer `limit` at a third of
  their size.
- **MAI-D0-19** Bridge `result` (§4.5, contract): `writes[].name` matches `/^(?!\.{1,2}$)[^/\\:\p{Cc}\p{Cf}]{1,255}$/u`
  (one base name: no separators, no drive colon, no control or format character — a bidi override cannot disguise the
  extension — not `.`/`..`), `images[].mime` is `image/png` or `image/webp`. MCP-SPEC §4.5 updated. The server's own
  checks (§5.10) stay the authority; this is the first line against T7/T16.
- **MAI-D0-20** `OPERATOR_POLICY` is a null-prototype frozen table read through `tablePolicyOf` (`Object.hasOwn`):
  `agentPolicyOf('constructor' | 'toString' | '__proto__')` is denied as unclassified, `operator_run`'s access
  function uses the same lookup. `resolver.bone` checks own humanoid entries (`constructor` is `not_found`).
- **MAI-D0-21** Allowed bridge origins (`--allow-origin`, `EKZA_MCP_ALLOWED_ORIGINS`, §5.10): exact
  `http(s)://host[:port]`, `*` only as the whole port, one trailing slash tolerated; scheme and host are lower-cased and
  a default port dropped (as the browser sends `Origin`); round 2: the result is the WHATWG URL parser's `origin`
  (`:03000` → `:3000`, `127.1` and `2130706433` → `127.0.0.1`, `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`, an invalid
  IP literal is a start error), so a respelled entry matches the header and collapses into an equal one; canonical
  127.0.0.0/8, `[::1]` and IPv4-mapped 127/8 are loopback for the warnings; `*`, `null`, paths, queries, credentials and other schemes
  are a start error naming the flag or variable. The CLI warns at the `warn` level about plain http off loopback, a `*`
  port and gateway-like hosts (`ipfs`, `ipns`, `gateway` labels). Duplicates collapse. P6 applies the list at the
  upgrade (and to `--http`'s `Origin`), P7's helper passes the e2e origin.
- **MAI-D0-22** First-visit size (DoD "unchanged"): measured on both sides on 2026-10-20 with the same machine and
  Next build cache (`pnpm --filter web build`, `check:size`): **`mcp/spec` 845,157 B → D0 848,367 B, +3,210 B gzip -9**
  (+9.5 kB minified). Per source file (source-map attribution of the eager scripts, minified bytes, both builds with
  `ANIMATOR_SOURCE_MAPS=1`): `ViewportManager` +1,773 (`agentHost()`, `withAgentPose`, the overlay-pass loop, §4.3),
  the ten §4.10 operator stubs and `stub.ts` +2,022, `runner.ts` +1,501 (rules 1–9), `presence/registry.ts` +1,075,
  `history.ts` +644 (`entries()`, the change journal), `file.ts` +596 (`readSample`, `activate`), `memory.ts` +419
  (`restoreHost`), `define.ts` +367 (`busy()` for actors), `StatusLine.tsx` +324 (the pill placeholder),
  the Agent panel's lazy registration +270, the rest < 120 each. Every item is a §4.1/§4.3 contract or the menu entry
  §8 D0 (7) asks for, eager by construction (kernel, registered operators, the viewport class, the status line);
  nothing was found that can move behind a lazy boundary without changing a contract (`withPose` is synchronous in
  §4.3). agent-tools and zod are not in the eager chunks. Remaining to the 850,000 B M2a target: 1,633 B; to the
  900,000 B gate: 51,633 B. **Needs explicit acceptance by INT or the owner** (DECISIONS-OPEN §H, MAI-D0-22); P1's
  real operators replace the stubs and P8 must keep the pill and panel lazy or budget against these numbers.
- **MAI-D0-23** (round 2) Targets (§6.1) refine "pass controls or bodyParts" on the shared schema (keys_read,
  keys_delete, keys_adjust, keys_retime, keys_tween, curves_set_interpolation, curves_summary, pose_read,
  view_plot_curves): `targets: {}` and `{channels}` alone are `invalid_args` at `targets`; an absent optional
  `targets` stays valid. Input records are bounded with `boundedRecord(key, value, max)` (entry count checked at
  parse time, `maxProperties` in the JSON Schema): `pose_set` `attrs` ≤ 64, `recipe_apply` `params` ≤ 32,
  `operator_run` `args` ≤ 64 (P3's wire schema stays the real check); the schema lint flags any input record without
  `maxProperties`.
- **MAI-D0-24** (round 2, **Q-AI-38**, owner to confirm) A call that edits the document and changes what the user sees
  needs **Edit and View**: `AgentToolDef.extraGrants(args, host)` (additive, optional) lists grants on top of
  `access`; live `clip_create {activate: true}` (access `edit` + `['view']`; P2's run passes `access: 'view'` to
  `ctx.run` for it) and `operator_run clip.new`/`clip.duplicate {activate: true}` (policy access `edit` + `['view']`).
  `clip_update {activate: true}` stays View only (one change kind per call). `ToolAccess` is unchanged; the manifest
  states a tool with `extraGrants` as `by_argument` (`by_operator` for operator_run), so no manifest change. The
  literal v0.2 §5.9 reading ("View allows clip_create {activate: true}") let an agent with Edit unticked create and
  duplicate clips; MCP-SPEC §5.9/§5.14/§6.6 updated. Related and left as specified: `project_open` and
  `project_import {path}` need Files only (in Q-AI-38's row for the owner).
- **MAI-D0-25** (round 2) `AgentToolDef.example` (additive, optional): a minimal valid call; `invalid_args` carries
  it in `detail.example` and the hint points at it; the lint requires that it parses. **Hand-off to P2** (runtime owner
  after D0): give every catalogue tool an `example` (none has one in D0, so the hint stays generic until then).
- **MAI-D0-26** (round 2) Paths never reach error text (§5.4): `file.loadSample`'s `asset-missing` names the sample
  only (`The sample <file> could not be read`; a Node fs code such as `ENOENT` goes to `details.cause`), and
  `failureFromEkza` reduces absolute paths in any operator or host error text to base names (`scrubPaths`: POSIX,
  Windows drive and UNC paths, `file:` URLs; `30/1`, `and/or` and `https://…` stay).
- **MAI-D0-27** (round 2) e2e helper: `startAgentServer().close()` removes the `ekza-ai-e2e-*` workspace it created
  (a caller's own `workspace` stays).

## Routes to M6a (§8.2) — B0a was not on `dev` when D0 ran

D0 landed first (§8.2 last rule); B0a rebases. The overlaps, each additive:

- `editor-core/src/types.ts`, `operators/args.ts`: `RunSource` is declared character for character as in M6A-SPEC
  §4.6; the second merge keeps one copy. The §4.10 `OperatorMap` rows and the stretch types are appended at the end.
- `operators/runner.ts`, `registry.ts`, `builtin/index.ts`: the runner rules are additive blocks marked "M-AI"; the
  four new operator files are one registration block in `builtin/index.ts`. Rule 8 (LastRun) has nothing to hook
  yet: when B11 lands `LastRunRecorder`, the recorder returns early for `run.ctx?.actor`.
- **Note for M6A-SPEC §5.7 (§3 rule 11), to be added by whichever of D0 and B11 lands second:** "Agent runs never
  become `lastRun`: the recorder returns early when `run.ctx?.actor` is set. An agent step still closes the user's
  Last-op card ('another undoable operator runs')."
- `history/**`: `HistoryStep.actor`/`changes`, `entries()`, the actor check in override-only coalescing; with B0a's
  `dropOldest`/`evictOldest`/limit drops a step takes its `changes` with it (already true for the 1,000-step limit,
  `clear()` and lost doc parts).
- `app/{createEditorApp,kernel}.ts`: one wiring line (`presence: createKernelPresence({ now })`) via
  `app/factories/presence.ts`.
- `doc/src/undo/**`: `restorePlan.ts` is a new file; `patchUndo.ts` is untouched. `doc/src/store/memory.ts` (closed
  by B0a, M6A-SPEC §9.1) gained `restoreHost()` and the `RESTORE_HOST` method on `StoreTx` (MAI-D0-1): its own row in
  MCP-SPEC §8.2 (additive D0 contract PR, B0a rebases).
- `editor/src/test-api/{types,createTestApi}.ts`: the §4.9 types and one spread of `test-api/mai`.
- `ui/css/tokens.css`: `--presence-agent` through `tokens.json`.
- `viewport/src/manager/ViewportManager.ts`: the `agentHost()` accessor with its two types, the overlay-pass loop in
  `renderPane` and the private `withAgentPose`.

## Review fix round 1 (2026-10-20)

| Finding | Fix |
|---|---|
| major: a cut result broke the closed `outputSchema` of 40 of 43 tools | MAI-D0-18: `truncated` on every output, lint rule, schema-aware cut; `test/budget.test.ts` validates every tool's cut result with Ajv and zod |
| major: `result.writes[].name` took paths, `images[].mime` anything | MAI-D0-19: base-name regex, PNG/WebP enum; negative tests (traversal, absolute, backslash, drive, `.`/`..`, controls, bidi, mimes) |
| policy and bone lookups followed the prototype chain | MAI-D0-20; tests for `constructor`, `toString`, `hasOwnProperty`, `__proto__`, `valueOf` |
| the hard cap was not enforced for records and strings | MAI-D0-18: `limit` when no cut fits; every tool × four caps is within its cap or `limit` |
| `memory.ts` had no MCP-SPEC §8.2 row | row added (additive D0 contract PR, B0a rebases) |
| size baseline and delta not recorded | MAI-D0-22 |
| origins unvalidated, no §5.10 warnings | MAI-D0-21; tests for valid, invalid and warned origins |
| lone surrogates passed the sanitiser | MAI-D0-5 (also `__proto__` keys in `sanitizeDeep`) |
| `activePaneId` ignored keyboard focus | MAI-D0-15; viewport test with a focused pane-menu button |
| the toolset bump was enforced only by the update script | MAI-D0-12: merge-base guard in the manifest test, CI `fetch-depth: 0` |
| the every-operator test did not assert outcomes | `EXPECTED_D0` pins each run's outcome (finished with its value, or the refusal); `READY.p1` switches to P1's rule (scope-ready operators finish, stubs gone, the gated five run); `key.tween` gets a middle-key scope |
| flaky anim-core property test | reported below; not D0's code |

## Review fix round 2 (2026-10-20)

| Finding | Fix |
|---|---|
| major: shared `targets` accepted `{}` (no controls or bodyParts) on seven tools | MAI-D0-23: refine on the shared schema; schema test over nine tools, runtime test `keys_delete {targets: {}}` → `invalid_args` at `targets` |
| `readSample` errors leaked absolute paths | MAI-D0-26: message names the sample only, `details.cause` the code; `scrubPaths` in `failureFromEkza`; headless test with an fs-like rejection, runtime test for paths |
| a cyclic failure detail rejected `runtime.call()` | MAI-D0-5: `sanitizeDeep` cycle/depth guard, fixed `internal` fallback on the error path; tests for cyclic detail, 10,000-deep detail and cyclic data |
| NFC before the removals left non-NFC output | MAI-D0-5: NFC last; `e`+ZWJ+U+0301 → `é` and two more cases, NFC in the property test |
| `clip_create {activate: true}` live needed View only (no Edit) | MAI-D0-24, **Q-AI-38** (DECISIONS-OPEN §H.3, owner to confirm): `extraGrants`, Edit and View; same for `operator_run clip.new`/`clip.duplicate`; runtime test of every grant combination, live and headless |
| `attrs`, `params`, `operator_run.args` unbounded | MAI-D0-23: `boundedRecord` (64/32/64), lint rule "record without maxProperties"; tests at the limits and 50,000 entries |
| progress messages unsanitised | MAI-D0-5: sanitised, ≤ 120 characters; runtime test with the hostile string |
| `invalid_args` hint generic | MAI-D0-25: `AgentToolDef.example` → `detail.example`; per-tool examples handed to P2 |
| origins stored as typed | MAI-D0-21: WHATWG URL `origin`; tests for `:03000`, `127.1`, `2130706433`, `0x7f.0.0.1`, IPv4-mapped and long-form IPv6, invalid literals, loopback warnings, duplicates |
| first-visit delta not exact | MAI-D0-22: `mcp/spec` measured (845,157 B → 848,367 B, +3,210 B) with per-file attribution; acceptance left to INT or the owner |
| e2e workspaces left in `$TMPDIR` | MAI-D0-27: `close()` removes its own workspace; the seven empty leftovers removed |
| published manifest exported `src/` | MAI-D0-13: `publishConfig.exports`; package test over the published entry points |

## Known issue outside D0 (reported to the anim-core owner)

`anim-core/test/curve/insert.test.ts` "never writes −0 into a handle" is intermittently red under `pnpm run test`
(review fix round 1 saw seeds 521648951 and -1968291564 fail; standalone runs pass): its property counts every key that
is not the input object (`!c.keys.includes(k)`) as created, so a neighbour key that `insertKeyPreservingShape`
rewrites keeps a `-0` handle the arbitrary already generated. Either `curveArbitrary()` must not generate `-0` handles
or the insert must normalise `-0` on rewritten neighbours; a seed pin would only hide it. anim-core has no D0 diff.

## Tests added

editor-core 22 (`mai-runner.test.ts`) + the registration literal; doc 7 (`restore-plan.test.ts`); headless-tests 3
(`ops.mai-headless.test.ts`, incl. the path-free sample error); agent-tools 117 (lint incl. unbounded records and
examples, final input schemas (Targets over nine tools, record bounds), manifest incl. the merge-base guard, policy +
45 per-operator invariant runs with pinned outcomes (5 gated on P1), budgets (`budget.test.ts`: every tool's cut
result against its own schemas, every tool × four caps), runtime (grants incl. Edit and View for activating creates,
the unwalkable-failure fallback, progress, paths, `detail.example`), resolver, sanitiser (NFC after removals,
cycles and depth), bridge protocol incl. the hostile write names and mimes); motion-analysis 1; schematic-render 1;
mcp-server 13 (CLI over the built bin, the published manifest's entry points, in-process server, arguments and
canonical origins); agent-evals 3; editor 4 (`mai.test.ts`); viewport 4 (`agentHost.test.ts`); e2e
`ai-00-foundation.spec.ts` (2).

## Gates (2026-10-20, local, after review fix round 2)

`format:check` (1,044 files), `lint`, `typecheck`, `check:deps` (18 packages), `check:licenses` (174 production
packages), `check:fixtures` green; lockfile in sync (`--frozen-lockfile --lockfile-only`); `turbo run test
test:tooling --force` 19/19 tasks, 0 cached, with `CI` unset (browser suites in local Chrome): agent-tools 111 passed
/ 6 skipped (P1 gates, update mode), mcp-server 13 (the built-bin tests ran), headless-tests 173, editor-core 769,
viewport 104 / 1 skipped, editor 355 / 1 skipped, curve-editor 209 / 3 skipped, anim-core 650, the rest unchanged;
`turbo run build --force` green; `check:size` 848,367 B ≤ 900,000 B (headroom 51,633 B; 1,633 B under the 850,000 B
target; `mcp/spec` itself 845,157 B, MAI-D0-22); `mcp:build` one `dist/cli.mjs` whose only top-level imports are
`node:path` and `node:process`; `pnpm pack` of `ekza-studio-mcp` checked once by hand (`exports` is
`./package.json`); e2e with `--project=chrome` on port 3270: `ai-00-foundation` 2/2, then the full suite once
against one fresh e2e build: 116 tests, 107 passed, 9 skipped (pre-existing fixmes), 0 failed. The web server stopped
by itself; port 3270 is free; no `ekza-ai-e2e-*` folder is left in `$TMPDIR`.
