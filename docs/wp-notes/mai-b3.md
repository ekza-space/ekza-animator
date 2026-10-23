# M-AI B3 — agent UI and live `view_capture`: build notes

Branch `mai/b3-ui` (from `mai/port`). Scope: [MCP-SPEC §0.4.1](../MCP-SPEC.md#041-in-the-mvp) items 4–5 (P8 minimal
and live `view_capture`), §5.11, §5.15, §7. Decisions are `M-AI-B3-<n>` in
[DECISIONS-OPEN §N.7](../DECISIONS-OPEN.md#n7-phase-b--b3-agent-ui-and-live-capture-2026-10-23).

## What is built

| Area | Files | Notes |
|---|---|---|
| Agent panel | `editor/src/agent/panel/{AgentPanel,AuditLog}.tsx` | connection section by status (off + Connect, probing, server chooser, the pairing code in 32 px with Copy and countdown, claimed, paired/paused with Pause/Resume and Disconnect, error with Try again and the LNA hint), grants (Read fixed, Edit, Files + Workspace folder, View), the audit log newest first with Show and Undo/Revert per step, "Revert all AI changes since pairing" (asks once inline) |
| Grants dialog, confirm card | `editor/src/agent/ui/{GrantsDialog,ConfirmCard}.tsx` | §7.3 (modal, Esc = Deny, outside clicks ignored) and §7.4 (non-modal card near the status line with countdown; danger prompts style Allow red) |
| Status pill | `editor/src/agent/ui/{LivePill.tsx,slot.ts,model.ts}`, `editor/src/shell/StatusLine.tsx` | the §7.5 texts by state (never colour alone), busy tint from `--presence-agent`; the eager status line shows the muted `AI` until the agent module loads; `?agentPort=` opens the panel |
| [Show] toast and `agent.show` | `editor/src/agent/ui/{LivePill.tsx,show.ts}` | first edit of a clip the user is not looking at → `AI is working on clip "wave"` with [Show] once per clip per pairing; `agent.show` refuses actor runs |
| Runtime | `editor/src/agent/ui/{runtime,actions,hooks}.ts` | one per app: B2's session (or a test's), the attached capture service, `agent.show`, the panel-side reverted map; Undo = `edit.undo` while top, Revert = one `edit.revertSteps` |
| Live capture | `editor/src/agent/capture/service.ts`, `viewport/src/manager/agentTile.ts` | per tile: `evaluateAt` → `agentHost().withPose` → offscreen render target (meshes and lights, grid on request; no controls, manipulators, helpers, HUD) → pixels; sheet composed on an `OffscreenCanvas` with burned-in labels, PNG/WebP; the renderer's target, viewport, scissor and clear colour restored; no pane camera, session or playhead change |
| `view_capture` tool | `agent-tools/src/tools/view/{capture,cameras,sheet}.ts`, `defs.ts` | presets from the rest skeleton in character space (front: the character's left on the image's right), crops, sheet layout (≤ 6 frames, ≤ 3 views, long edge ≤ `maxEdgePx`), frames from a list / keys / extremes (hand and foot heights) / every; `withUserOverrides` only at the user's frame; `ready: true`, manifest regenerated, toolset `1.0.0-dev.2` |
| Test doubles | `editor/src/agent/ui/{fakeSession,e2e}.ts` | a fake paired session over the real tool runtime; `window.__EKZA_AGENT_E2E__` in e2e builds only |

`viewport/src/manager/agentPose.ts` needed no change.

## Tests

- `agent-tools/test/tools-view.test.ts`: cameras on both sides, layout and scale-down, tokens, thinning; live calls over a
  fake capture service (user view = null camera, tile order, frames from keys/every/extremes, the 6-frame limit),
  refusals (`withUserOverrides` elsewhere, schematic, `follow`, headless), the envelope against the manifest's
  `outputSchema`, and the session-state invariant (no session, document or history change).
- `viewport/test/agentTile.test.ts` (browser, WebGL): the mesh layer from the tile's own camera, helpers excluded,
  top-row-first pixels, renderer and pane camera unchanged; a pane-camera snapshot tile.
- `editor/test/mai-b3-agent-ui.test.tsx` (browser): pill texts per state, row actions, Revert all targets, the toast
  trigger, the panel over a fake session undoing / reverting / reverting all real actor steps (the user's step stays),
  Pause/Resume/grants/Disconnect/Connect, the grants dialog and the confirm card answers, `agent.show` user-only.
- `apps/web/e2e/ai-02-agent-panel.spec.ts` (production build): pill → panel → fake paired session; real calls
  (`scene_summary`, `clip_create`, two `pose_set`, `view_capture` of the user's view and a front + left sheet ≤ 1,024 px,
  pane cameras / active clip / frames unchanged); six audit rows newest first; the toast's [Show] and a row's Show;
  Undo from a row; Revert all → `counts()` and `clips()` equal the document before the first AI step, the user's
  history steps stay; Disconnect → `AI`.

Shared test files touched (one filter each): `agent-tools/test/tools-envelope.test.ts` and
`tools-invariant.test.ts` leave `view_capture` to `tools-view.test.ts` (it needs a live host with a capture service).

## Gate

`EKZA_E2E_PORT=3153 pnpm run ci` (local Chrome): format, lint, typecheck, deps, fixtures, licenses, unit tests (22/22
turbo tasks) and the build green; `check:size` red as on `mai/port` (B5 fixes it); `pnpm run test:e2e` then ran on its
own: 363 passed, 24 skipped (stretch/fixme), 0 failed.

| Route | `mai/port` | `mai/b3-ui` | Delta |
|---|---|---|---|
| `/editor` | 902,762 B | 903,159 B | +397 B (the pill slot and its `useSyncExternalStore` wrapper in the status line, `?agentPort=` handling) |
| `/autorig` | 664,644 B | 664,809 B | +165 B |

`editor/test/shell.test.tsx` failed once under the full turbo run ("no app" in 5 tests) and passed in isolation and in
two later full runs: load-dependent, not caused by B3.

## Merging with B2

B2's `editor/src/agent/bridge/slot.ts` and `editor/src/test-api/agentParams.ts` are copied byte-identical from
`mai/b2-bridge` (1d0b18f7) so the runtime can follow the page's session (`agentSessionOf`, `onAgentSession`,
`loadAgentSession`); the files stay B2's and merge cleanly. On this branch the D0 `createAgentSession` throws, so the
panel shows "The agent bridge is not available in this build" until B2 merges. The panel calls B2's actions
(`select`, `cancel`, `accept`, `deny`, `setGrants`, `setPaused`, `answerConfirm`) and reads `extra.claim` (client,
folder) in the grants dialog; Allow/Deny carry `agent-allow`/`agent-deny`. B2's `agent()` test-API slice reads the
slot, so the e2e hook's fake session (installed by hand) is not visible there.

## Open issues

- B2's session must implement the controls of M-AI-B3-1 (until then Pause, grants, the dialog's Allow and the confirm
  card's Allow are disabled in a real pairing; Connect and Disconnect use the D0 methods).
- Checkpoint groups, "Restore the project as it was before the agent", presence drawing in the viewport and on the
  time slider: deferred by the MVP cut (§0.4.2).
- The schematic fallback of a failed shaded capture waits for P5 (M-AI-MVP-18).
