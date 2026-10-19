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
- **MAI-D0-5** Sanitiser: whitespace controls (tab, line breaks, NEL) become spaces before every other `Cc`/`Cf` code
  point is removed, so words never fuse; the whole tag block U+E0000–E007F goes (U+E0000 itself is unassigned, not
  `Cf`). Envelope caps: `data` strings 300 (prose; the tool layer keeps identifiers short or opaque, §5.1), names in
  `clip`/`undo`/`candidates` 120, warnings 200, `message`/`hint`/`next` 300.
- **MAI-D0-6** Gate order of the minimal runtime: unknown tool / not ready → `unsupported`; schema → `invalid_args`
  (path like `set[2].rotateDeg.x`, unknown keys named); hosts and `needs` → `unsupported`; `view` access on a host
  without the `view` capability → `unsupported` (§5.4: "View tools headless"); a missing grant → `not_granted`; pause
  → `paused`; an aborted signal → `cancelled`. The runner's "gesture in progress" maps to `busy` through
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
  `propose` mode and `activate: true` are View per call, which P3's wire schemas resolve. `operator_run`'s static
  access function reads the table (manifest: `by_operator`); P3 adds `OperatorDef.agent` for trusted definitions.
- **MAI-D0-10** Annotations follow §6.0 literally: `destructiveHint` is true for every tool that is not read-only
  except `clip_create` and `project_import` — this includes `editor_connect` and `history_checkpoint` is
  `readOnly` without `idempotent`. INT reviews `editor_connect` with the descriptions.
- **MAI-D0-11** Unit-suffix lint: numeric fields must end with a §5.2 suffix or be one of `value` (unit per channel,
  stated in the description), `weight`, `fps`, `limit`, `worst`, `every`, `neck`, `head`, `inWeight`, `outWeight`,
  `ifClipRevision`, `steps`, `contactFrame`, `attrs`/`params` (records with per-entry units), `direction`/
  `poleDirection` (normalised vectors) and `playbackRange` (the §6.12 name); `x`/`y`/`z` take their parent's unit.
- **MAI-D0-12** Manifest: `pnpm --filter @ekza-animator/agent-tools manifest` is `UPDATE_MANIFEST=1 vitest run
  test/manifest.test.ts` (the workspace's TypeScript sources import extensionless paths, which Node cannot run
  directly); it refuses to write a changed tool list under an unchanged `AGENT_TOOLSET_VERSION`. The committed
  manifest lists no tool (none is ready).
- **MAI-D0-13** `ekza-animator-mcp` lists every runtime dependency as a devDependency (all are inlined by rolldown;
  the published manifest has no `dependencies`), `gltf-validator` as an optional peer. `check:licenses` covers
  production dependencies only; the bundle's third-party notices are P6/INT's (generated from the module graph). The
  D0 bundle inlines dynamic imports (`codeSplitting: false`, one `dist/cli.mjs`); P6 splits `dist/http.mjs`. The build
  copies `fixtures/models/polybot.vrm` to `samples/` (gitignored). Root `test:e2e` builds the server first; turbo
  builds it before its own tests and the evals.
- **MAI-D0-14** Editor: the Agent panel is a new panel directory (`panels/agent`, P8's) registered in
  `panels/index.ts`; Windows › Agent comes from the shell's extra-panel menu items, so `menuItems.ts` and
  `workspace.ts` are unchanged. The status pill is a placeholder in `StatusLine.tsx` ("AI", muted; opens the panel)
  until B9's status-group registry exists. Agent URL parameters are a separate `parseAgentParams` (`EditorParams` is
  unchanged). `agent()` answers null until P8 fills `test-api/mai/agent.ts`.
- **MAI-D0-15** `ViewportManager.agentHost()`: `activePaneId()` is "last interacted, else hovered, else null" (§4.3),
  unlike `ViewportManager.activePaneId()`, which falls back to the first pane. `withPose` turns canonical bone worlds
  into node locals (`W_parent⁻¹·W`, roots `F⁻¹·W` with the skeleton's facing F), draws, and restores the locals;
  overlay passes draw after the control pass and before the manipulator.
- **MAI-D0-16** `SCHEMATIC_COLORS.contact` (not named in §4.8) is `#57e389`. `--presence-agent: #e66cff` is in
  `ui/tokens.json` with a ≥ 3:1 contrast rule against the viewport gradient and the panel backgrounds (passes).
- **MAI-D0-17** `AgentToolFailure` is a real class in `types.ts` (the contract shows `declare class`); its `retryable`
  defaults follow the §5.4 table (`poll_failed` "maybe" → true).

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
- `doc/src/undo/**`: `restorePlan.ts` is a new file; `patchUndo.ts` is untouched. `doc/src/store/memory.ts` gained
  `restoreHost()` and the `RESTORE_HOST` method on `StoreTx` (MAI-D0-1).
- `editor/src/test-api/{types,createTestApi}.ts`: the §4.9 types and one spread of `test-api/mai`.
- `ui/css/tokens.css`: `--presence-agent` through `tokens.json`.
- `viewport/src/manager/ViewportManager.ts`: the `agentHost()` accessor with its two types, the overlay-pass loop in
  `renderPane` and the private `withAgentPose`.

## Tests added

editor-core 22 (`mai-runner.test.ts`) + the registration literal; doc 7 (`restore-plan.test.ts`); headless-tests 3
(`ops.mai-headless.test.ts`); agent-tools 89 (lint, manifest, policy + 45 per-operator invariant runs (5 gated on P1), runtime,
resolver, sanitiser, bridge protocol); motion-analysis 1; schematic-render 1; mcp-server 9 (CLI over the built bin,
in-process server, arguments); agent-evals 3; editor 4 (`mai.test.ts`); viewport 3 (`agentHost.test.ts`); e2e
`ai-00-foundation.spec.ts` (2).

## Gates (2026-10-20, local)

`format:check`, `lint`, `typecheck`, `check:deps`, `check:licenses`, `check:fixtures` green; `pnpm run test` 19/19
turbo tasks (browser suites in local Chrome); `pnpm run build` green; `check:size` 848,267 B ≤ 900,000 B; e2e
`ai-00-foundation` 2/2 and the full suite once with `--project=chrome` on port 3270: 107 passed, 9 skipped
(pre-existing fixmes), 0 failed.
