# M-AI B4 — rig tools (`mai/b4-rig`)

MCP-SPEC v0.3 §0.4.4: the character setup tools, so an agent can "rig this model and add a walk". Decisions:
[DECISIONS-OPEN §N.8](../DECISIONS-OPEN.md#n8-phase-b--b4-rig-tools-2026-10-23) (M-AI-B4-1…10).

## What landed

| Part | Where |
|---|---|
| Actor forwarding of the compositions: `runComposition(app, steps, {alive, context})`, `autorig.rig` passes `runContextOf(ctx)`; the other compositions already run their inner operator through `forward` (which forwards the context) | `editor-core/src/operators/builtin/rig/wizard/{compose,rig}.ts` |
| Use Clip under an actor with Edit access leaves the active clip (M-AI-B4-3) | `editor-core/src/operators/builtin/library.ts` (lazy clip-library chunk) |
| Tools `model_inspect`, `model_fix`, `rig_create`, `library_list`, `library_use` (group `setup`) | `agent-tools/src/tools/setup/{defs,run,common}.ts` |
| Setup kinds of `project_import` / `project_export`: hook + reference definitions (M-AI-B4-1) | `agent-tools/src/tools/setup/files.ts` |
| Policy rows of §0.4.4 | `agent-tools/src/policy.ts` |
| Prompt `rig_and_animate` (grader AE-R1) and its reference script `rigAndAnimateScript` | `agent-tools/src/text/prompts.ts`, `agent-tools/test/setup-support.ts` |
| Tests | `agent-tools/test/setup-tools.test.ts`, `editor-core/test/autorig/actor.test.ts`, `headless-tests/test/ai-rig.vrm.test.ts` |

Shared files touched append-only: `tools/catalogue.ts` (five lines, `SETUP_TOOL_COUNT`), `src/index.ts` (exports),
`types.ts` (`ToolGroup` + `'setup'`, the toolset version), `manifest/lint.ts` (`TOOL_NOUNS` + `model`, `library`),
`tools.manifest.json` (regenerated), the catalogue tests' lists.

## For integration (B1, INT)

- **project_import**: when `SETUP_IMPORT.handles(args)` (a sample `cube_lad` / `polybot_tpose` / `polybot_apose`, or a
  `.glb` path), call `SETUP_IMPORT.run(ctx, args)`; add `model: modelReportOut | null` to the output. The live access
  is Edit (+ Files for a path) and View (the import selects the new meshes); confirm when the scene is not empty.
- **project_export**: when `SETUP_EXPORT.handles(args)` (`kind` `vrm` / `glb` / `omoba_kit`), call
  `SETUP_EXPORT.run(ctx, args)`; take `meta` into the input and the artifact shape of `setupExportOut`. Delivery:
  headless (or `delivery: 'workspace'`) through `host.files.write`, live through `host.files.download` (the editor's
  confirm). Extra grant Edit when `meta` is passed.
- **Headless host**: `readSample` must answer by `SampleDef.file` for the three Auto-Rig GLBs (Polybot's two are
  bundled, Cube Lad via `--samples-dir`); the clip library needs `globalThis.fetch` to serve
  `/library/animations/starter-pack.json` and the `.vrma` files (or `services.libraryPath` + a fetch shim).
- **AE-R1**: `rigAndAnimateScript(call, {sample})` is the reference agent's script (import, then the prompt's calls in
  order).
- Toolset `1.0.0-dev.b4.1` → INT's `1.0.0-mvp.1`; regenerate the manifest after the merges.

## Evidence (2026-10-23)

- `pnpm --filter @ekza-studio/agent-tools test`: 21 files, 251 passed, 7 skipped (setup-tools: 12 tests — MVP-AC-3 for
  `polybot_tpose` and `polybot_apose` through the tool runtime with every envelope validated against its outputSchema,
  the Size, start-check and arms gates, the interrupted rig, live grants/confirm, the policy rows).
- `editor-core` `test/autorig`: 11 files, 97 passed (incl. `actor.test.ts`).
- `headless-tests` `ai-rig.vrm.test.ts`: Polybot T-pose, Polybot A-pose and Cube Lad rigged in Node (Bind Skin without a
  worker), walk added, VRM 1.0 exported: glTF-Validator 0 errors, vrm-validator 0 errors, no error lint, ≥ 15 humanoid
  bones; files in `test-results/ai-rig/`.
- OMOBA's `validate-runtime-vrm`: not run (M-AI-B4-10, the cargo cache drive is not mounted).

## Open

- One tool call = one step does not hold for `rig_create` (2–3 steps, + one per rigid part bind), `library_use` with
  `name` (2) and `project_export` with `meta` (1 + the export): each inner step is its own `AI: …` step and `undo`
  names the last; the runtime's own-step list (`ownSteps`) records only the top step of each `ctx.run`.
- The live flow (MVP-AC-4) needs B2's bridge and B3's confirm card; the tools declare Edit + View and the prompt.
- A user's own Quick Rig blocks `rig_create` live (`busy`); an agent never closes it.
