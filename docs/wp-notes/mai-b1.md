# M-AI B1 — server and headless host (`mai/b1-server`)

MCP-SPEC v0.3 §0.4.1 items 2 and 8: the stdio server's hub with routing and headless projects, the workspace
sandbox, the file and project tools, the MCP surface, the bundle, the evals smoke and MVP-AC-1. Decisions:
[DECISIONS-OPEN §N.9](../DECISIONS-OPEN.md) (M-AI-B1-1…14).

## What landed

| Part | Where |
|---|---|
| Hub: routing by `project` (§5.1), hub-level `projects_list`, `project_close`, `project_open`, `editor_connect` → the bridge, resources of projects, audit log | `mcp-server/src/hub/{hub,router}.ts` |
| Headless projects: `prj_…`, ≤ `--max-projects` (1 with `--seed`), idle close on a clock, dirty close needs `discardChanges`; one runtime per project | `mcp-server/src/headless/{projects,host}.ts` |
| Workspace sandbox (§5.17.3): lexical checks first, realpath'd roots, dot rule relative to the root, extension allow-list, 256 MiB read cap, overwrite → `.ekza-trash/` (newest 50, ≤ 500 MB), unsafe default roots turn the file tools off | `mcp-server/src/files/sandbox.ts` |
| Samples by `SampleDef.file` (bundled Polybot, its two unskinned GLBs, the Cube Lad; others from `--samples-dir`); the clip library served from disk by the server's own fetch (no network) | `mcp-server/src/files/{samples,library}.ts` |
| Live workspace transfers for B2's bridge (`TabFileHooks`) | `mcp-server/src/files/tabHooks.ts` |
| MCP surface: tools/list, tools/call with progress and cancellation, resources (guides, templates, reads), prompts/get; both protocol eras through `serveStdio` (stdio and the in-process pair); the client's name names the actor | `mcp-server/src/mcp/server.ts`, `start.ts` |
| File tools: `project_open/import/save/export` runs (one code path for the tab and headless: captured downloads, sandboxed writes, derived names), setup-kind hooks for B4, `projects_list`/`project_close` ready | `agent-tools/src/tools/files/{defs,run,names}.ts`, `tools/connection/defs.ts` |
| Bundle: `dist/cli.mjs` only (the build fails on a stray chunk or a runtime package import), `node22` target, samples and the starter pack copied | `mcp-server/scripts/build.mjs`, `package.json` `files` |
| Evals: scripted driver over the in-process pair, fixture builders, independent graders, the six smoke tasks with reference and adversarial scripts, MVP-AC-1 in both eras, the hub/file tools' envelopes against the manifest | `agent-evals/src/**`, `agent-evals/test/{smoke,mvp-ac-1,files-envelopes}.test.ts` |

## Seams for integration

- **B2 (bridge)**: `bridge/link.ts` here is byte-identical to `mai/b2-bridge`'s. Merge B2's hub additions away (this
  hub has `attachTabLink`/`tabLink()` and does its own routing; drop the `routeToTab` line). In `start.ts` replace
  `startBridge`'s lookup with `startHubBridge(hub, {files: createTabFileHooks(hub.sandbox)})` (only when
  `hub.sandbox.enabled`); `createInProcessServer` does not start a bridge. `hub.setClientInfo` is fed from
  `initialize` and the 2026-07-28 envelope. The hooks read only `path` of `project_open`/`project_import` and write
  only `project_save {delivery: 'workspace'}` / `project_export {delivery: 'workspace'}` targets; B2 must call
  `attach` only while the tab's grants include Files + Workspace.
- **B4 (rig tools)**: call `registerFileToolHooks({import: SETUP_IMPORT, export: SETUP_EXPORT})` once (e.g. at the
  end of `tools/setup/files.ts`, or in the catalogue module) and replace `modelOut` in `tools/files/defs.ts` with
  B4's `modelReportOut`; drop B4's reference definitions `projectImportSetup`/`projectExportSetup` from the tool set.
  The headless server answers `readSample` for the three Auto-Rig GLBs and serves `/library/animations/…`.
  AE-R1 (`agent-evals/src/tasks/smoke.ts`) runs as soon as the setup tools are listed; it mirrors
  `rigAndAnimateScript` — import that helper when it moves out of B4's test folder.
- **Manifest**: toolset `1.0.0-dev.b1.1` here; regenerate at INT (`1.0.0-mvp.1`).

## Evidence (2026-10-23)

See the final report of the package for the gate numbers (`EKZA_E2E_PORT=3151 pnpm run ci`).

## Open

- `THIRD_PARTY_NOTICES.md`, the package `README.md` and `LICENSE` (in `files`) are not generated; `npm pack` before a
  publish must add them (M-AI-B1-14).
- `--http` still answers "not available in this build" (deferred, §0.4.2); `capture/schematic.ts` stays a stub
  (headless `view_capture` is B3's `unsupported`).
- The simulated user of `createInProcessServer` drives confirmations and the session; it does not model gestures.
- A project's actor name is fixed when the project opens (the client's name known by then).
