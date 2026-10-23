# M-AI INT — MVP integration (`mai/int`)

MCP-SPEC v0.3 §0.4 (INT row of §0.4.5, acceptance §0.4.6). Decisions: [DECISIONS-OPEN §N.10](../DECISIONS-OPEN.md)
(M-AI-INT-1…11).

## Merges

`mai/int` = `mai/port` (579c786a) + merge commits, in order: `mai/b5-diet` (1a47a46b), `mai/b1-server` (9e849fdd),
`mai/b2-bridge` (1d0b18f7), `mai/b3-ui` (4cb1758e), `mai/b4-rig` (393320fd).

| Merge | Conflicts | Resolution |
|---|---|---|
| B5 | — | clean |
| B1 | DECISIONS-OPEN | both blocks kept |
| B2 | `hub.ts`, `start.ts`, `types.ts` (toolset), `tools-envelope.test.ts`, manifest, DECISIONS-OPEN | B1's hub and routing kept (B2's two hub hooks were already in it), `bridge/route.ts` removed, `start.ts` calls B2's `startHubBridge` directly, duplicate `Tab*` exports dropped, B2's hub test awaits the async hub |
| B3 | `types.ts`, the two catalogue-enumerating tests, manifest, DECISIONS-OPEN | filters combined; B3's `AgentSessionExtraView` is B2's `AgentSessionExtra` (the client carries its version); B3's copies of `slot.ts` and `agentParams.ts` were byte-identical and merged away |
| B4 | `index.ts` (exports), `types.ts`, the two tests, manifest, DECISIONS-OPEN (B4's block renumbered §N.8) | exports combined; INT items below |

The manifest was regenerated after every merge; `runtime.ts` (B5's `loadAgentOperators` before the scope probe)
merged without a conflict.

## Integration items

- Bridge: `startHubBridge(hub, {files: createTabFileHooks(hub.sandbox)})`; workspace bytes and writes only under Files
  + Workspace (M-AI-INT-2). Routing, `projects_list` tab row and the client name: B1's (M-AI-INT-1).
- Setup kinds: hooks registered in the catalogue, `modelReportOut` shared, reference definitions dropped, setup exports
  into `exports/` (M-AI-INT-3). `rigAndAnimateScript` shared from `agent-tools/src/text/rigAndAnimate.ts`; AE-R1 runs
  (M-AI-INT-4).
- Toolset `1.0.0-mvp.1`, 37 tools; generated [agent-tools-reference.md](../agent-tools-reference.md) (M-AI-INT-5).
- Agent panel docks right and opens from `?agentPort=` once the workspace mounted (M-AI-INT-6); Revert all covers
  inner steps and falls back to undo (M-AI-INT-7); test API sees the live and the fake session (M-AI-INT-8).
- Docs: [agents.md](../agents.md) (Claude Code, Claude Desktop, Cursor, VS Code; pairing locally and on the hosted
  editor with Chrome's Local Network Access), README section, repository `.mcp.json` (server `ekza-studio`).

## Acceptance

| ID | Where | State |
|---|---|---|
| MVP-AC-1 | `agent-evals/test/mvp-ac-1.test.ts` (both protocol eras) | green in `pnpm run ci` |
| MVP-AC-2 | `apps/web/e2e/ai-01-live.spec.ts`: the built server, pairing by clicking `agent-allow` in the grants dialog (Files on), Polybot import, the wave script, the [Show] toast, `Mod+Z`/`Shift+Z` on the AI step, `view_capture` of the user's view and a front sheet of frames 0/30/60 (PNG ≤ 1,024 px, pane cameras and frame unchanged), VRMA export after the confirm card, Revert all → the document before the agent, Disconnect → `off` and `expired_handle` | green; 3/3 with `--repeat-each 3` |
| MVP-AC-3 | `agent-tools/test/setup-tools.test.ts`, `headless-tests/test/ai-rig.vrm.test.ts`, AE-R1 in the evals smoke | green |
| MVP-AC-4 | `apps/web/e2e/ai-03-live-rig.spec.ts`: Edit + View + Files + Workspace, Cube Lad import, `model_inspect`/`model_fix`, `rig_create` with the confirm card, `library_list`/`library_use walk`, `project_export vrm` into the workspace (a glTF file), every agent step `AI: …`, the audit rows, Revert all → the document before the agent | green; 3/3 with `--repeat-each 3` |
| MVP-AC-5 | `tooling/m-ai-ac5.mjs`; evidence [`evidence/m-ai-mvp/`](../evidence/m-ai-mvp/) | recorded 2026-10-24 (M-AI-INT-10); the owner's acceptance pending |

AC-5 run: Claude Code paired with code from the page, imported Polybot, made a 2 s right-hand wave with `pose_aim`
and `keys_set`, looked at a front contact sheet, **corrected two forearm keys after looking** and checked again,
imported the Cube Lad (confirm card), rigged it (confirm card), added the library walk, checked a side sheet and
exported `exports/cube-lad.vrm` with meta (glTF-Validator 0 errors, 0 warnings; 33 humanoid bones, 34 joints, the
walk). The user touched only Connect, the Claude Code permission for `editor_connect`, the grants dialog and two
confirm cards (`user-actions.json`). To run it again: `pnpm mcp:build`, build and start the web app, then
`node tooling/m-ai-ac5.mjs --url http://localhost:3000` (options in the file header).

## Gate

`EKZA_E2E_PORT=3156 pnpm run ci` (local Chrome) **green**: format, lint, typecheck, deps, fixtures, licences, unit
suites (22/22 turbo tasks), build, check:size `/editor` 890,932 B and `/autorig` 651,856 B (M-AI-INT-11), e2e 365
passed / 24 skipped. Earlier full runs had one load-dependent failure each (`m6b-rig-01-checklist` twice,
`m6a-shell` pixel probe once, `ai-01-live` once on a camera still framing the import); each passed 3/3 alone with
`--repeat-each 3`. `ai-01-live` now waits for resting cameras and E2E-RIG-01 for a resting knee before its drag.

## Open

- Owner: accept AC-5; the hosted editor origin (M-AI-INT-9); the npm publish (`THIRD_PARTY_NOTICES.md`, README and
  LICENSE in the package, M-AI-B1-14; the name is unchecked, M-AI-MVP-11); merging `mai/int` into `dev`.
- `edit.revertSteps` fails on rigging steps (M-AI-INT-7): Revert of a single rig step in the middle of history is not
  possible; Revert all undoes when the agent's steps are on top.
- One tool call = one step does not hold for `rig_create`, `library_use {name}` and `project_export {meta}` (B4); the
  audit row shows the last step, Revert all covers all of them.
- `projects_list` tab rows report `characters: 0`, `dirty: false` (M-AI-B1-4); resume, checkpoint groups, presence
  drawing and the headless `view_capture` stay deferred (§0.4.2).
- The e2e specs open the editor with `&platform=mac` for `Mod+Z` (as the other undo specs do).
