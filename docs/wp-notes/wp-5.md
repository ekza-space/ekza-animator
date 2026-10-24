# WP-5 notes — viewport (`@ekza-studio/viewport` + `editor/src/panels/viewport`)

Status: implemented on branch `wp/wp-5` (2026-10-17). Everything in MVP-SPEC §7 WP-5 is built and tested against
the shared test kit; tests that need another package's real implementation run automatically once it lands. The
three WP-5 M1-stretch items are done too: mesh-click picking, the Space-hold camera radial and the one-button macOS
navigation profile. This file records what integration needs to know, the deviations taken, and the cross-package
requests.

## What is where

| Area | Files |
|---|---|
| Manager, panes, rendering, input routing, queries | `packages/viewport/src/manager/ViewportManager.ts` |
| App → manager lookup (panel, GL host, test API) | `manager/registry.ts`, `manager/lookup.ts` |
| Tools + view operators (§4.9 owner 5) | `manager/contributions.ts`, `tools/*` |
| e2e test-API helpers (§4.8 viewport part) | `manager/testApi.ts` |
| Pane layouts, GL viewport/scissor maths | `panes/layout.ts` |
| View and shot cameras | `cameras/cameras.ts` |
| Navigation (camera-controls) and profiles | `navigation/NavigationController.ts`, `navigation/profiles.ts` |
| SceneSync | `sync/SceneSync.ts` |
| Control shapes and two-pass control lines | `controls/shapes.ts`, `controls/ControlLayer.ts`, `overlays/lineBatch.ts` |
| Skeleton lines, backdrop, grid, marquee box | `overlays/*` |
| Analytic picking, marquee, pick points | `picking/geometry.ts`, `picking/picker.ts` |
| Mesh-click picking (M1-stretch, CPU skinned raycast) | `picking/meshPicker.ts` |
| ManipulatorKit and drag maths | `manipulators/ManipulatorKit.ts`, `manipulators/drag.ts` |
| Framing (copy-adapted from ekza-avatar-renderer @ 33c417c) | `framing/bounds.ts`, `framing/fit.ts` |
| React panel (pane grid, headers, HUD, drop zone, camera radial) | `packages/editor/src/panels/viewport/*` |
| Tests | `packages/viewport/test/*.test.ts` (browser mode), `packages/editor/test/viewport-panel.test.tsx` |

## Integration contract for WP-8 (GL host, shell, test API)

1. **Create the manager in the R3F canvas** (`onCreated`):
   `const vm = new ViewportManager({ app, renderer: gl })`, then `const off = registerViewportContributions(app, vm)`.
   Render with `useFrame(() => vm.render(), 1)`; wire `app.setFrameRequester(invalidate)`. On unmount call `off()`
   then `vm.dispose()`. The constructor registers the manager for its app (`viewportManagerOf(app)`), `dispose()`
   unregisters it; the viewport panel finds it there, so `PanelProps` stay `{ app, instanceId }`.
2. The manager sets `renderer.autoClear = false` and `renderer.toneMapping = NoToneMapping` (exact token colours for
   control lines and manipulators). It reads the canvas rectangle every rendered frame; the canvas may cover the
   whole window. `preserveDrawingBuffer: false` is fine: every visible pane is redrawn whenever anything changed.
3. **The viewport dock panel must be transparent** (no background on dockview's content container) so the canvas
   behind shows through the pane surfaces; pane surfaces must receive pointer events.
4. **Scope detection**: pane surfaces carry `data-ekza-panel="viewport"` and `data-ekza-pane="<paneId>"`. Run viewport
   keys with `RunContext { panel: 'viewport', paneId }`; the view operators fall back to `session.hoveredPanel`, then
   to the pane that last received pointer input.
5. **`view.toggleMaximize`** (WP-8): `vm.paneAt(clientX, clientY)` gives the pane under the pointer; the panel shows
   only `session.maximizedPane` while it belongs to the current layout. `view.layout` clears it otherwise.
6. **Test API** (§4.8): delegate `panes()`, `cameraOf()`, `screenOfControl()` (ControlId or template key of the
   active character), `screenOfManipulator()` and `renderedFrames()` to `viewportTestApi(vm)`.
7. **Drops**: the empty-state card (`data-testid="dropzone"`) only explains dropping; the window-wide drop target is
   the shell's. Its "Open file…" button runs `ui.open { dialog: 'open' }`; sample buttons run `file.loadSample`.
8. **Escape**: during a viewport drag the manager itself listens for `Escape` and window blur and cancels (tool
   gesture cancel, navigation restored). `edit.escape` (7b) cancelling the preview also ends a manipulator drag.
9. **Space hold** (M1-stretch): bind `Space` hold → `view.cameraRadial` with `RunContext { panel: 'viewport',
   paneId }`. The radial opens at the last pointer position over that pane and listens on `window` for the `Space`
   **keyup** itself (pick the highlighted camera), `Escape` (capture phase) and presses elsewhere; the input adapter
   must let the keyup reach window listeners (no `stopPropagation`/`stopImmediatePropagation` in a capture handler).
10. **Mesh-click picking** (M1-stretch) is active only while `session.tools.selectionMask.meshes` is true (default
    false, §4.5); a toggle for it belongs to the selection-mask UI (WP-8/WP-7b).

## Requests and notes for other work packages

| WP | What |
|---|---|
| WP-1 | Control shapes are placed as `p_local = offset · (size · p_unit)` (offset is a full TRS: it orients the planar XY shape and slides it down the bone). While `getControlShape`/`tessellateSplineSet` throw `not-implemented`, every kind draws as a unit circle (`controls/shapes.ts`, delete the fallback after WP-1 merges if desired). |
| WP-3 | Joint picks and mesh picks map to controls with `controlForNode` (returns null while stubbed). Auto-rig shape offsets/sizes follow the formula above; the finger acceptance test (`test/fingers.test.ts`) turns on when `autoRig`, `skeletonFromGltf`, `parseGlb` and the lollipop shape exist. |
| WP-4 | SceneSync expects `LoadedModel.root` to carry the facing and `nodeObjects` by SkeletonDesc index; per evaluated frame it writes `PoseBuffers.boneLocal` into `nodeObjects`, runs one `scene.updateMatrixWorld()`, then `nodeConstraints.update()`, then `updateMatrixWorld(true)` on every `skeleton.constrainedNodes` object, then `springBones.update(dt)` (only while playing with a pane's spring flag on; `reset()` when it stops). Meshes are moved to camera layer 1 and skinned meshes get `frustumCulled = false`. The registry owns `DisplayModel.dispose()`. Mesh picking raycasts the visible meshes under `LoadedModel.root` and recomputes a `SkinnedMesh`'s `boundingSphere` (and an already computed `boundingBox`) once per pose, so those two fields always describe the current pose. |
| WP-7a | Move/rotate drags call `beginChannelEditGesture(app, 'Move' | 'Rotate', { key: 'auto' })`, opened on the first 2 px of movement (a click on a handle edits nothing). Object/world rotations send the full rx/ry/rz triplet from `eulerNear` against the previous update; gimbal drags send exactly one channel. The tool's lifecycle (one gesture per drag, one commit, Esc cancel, externally ended gesture) is tested today with a recording gesture; two tests against the real kernel (one history step per drag, Esc leaves no step) in `test/manipulators.test.ts` run once it exists. |
| WP-7b | Clicks, marquees and cycling run `select.controls { ids, mode }` with `RunContext { panel: 'viewport', paneId }` (mode from Shift/Mod; empty click = `{ ids: [], mode: 'replace' }`). The split layout's left pane binds to the document's first shot camera (`FIRST_SHOT_CAMERA`), so the import's `shotCam` shows up there automatically. |
| WP-2 | `view.copyViewToShot` creates `shotCam` with `fractionalIndex(last, null)`; that path (and its test) waits for WP-2. Updating an existing shot camera works today. |
| WP-10 | e2e: `screenOfManipulator` grab points on rings have the most horizontal screen tangent, so drag rings **horizontally** (E2E-06, E2E-25). The ring angle is the pointer travel along the ring's screen tangent divided by the ring's screen speed at the grab point. For E2E-26 a spot with ≥ 2 pick candidates can be found with `pickCandidates`. A locked pane swallows Alt-drags and wheel input and increments `paneState(id).lockFlash`. |

## Deviations and decisions (smallest sane choices; all reversible)

| # | What | Why |
|---|---|---|
| V-1 | Every visible pane is redrawn when anything is dirty (`invalidate(paneId)` ignores the pane). | With `preserveDrawingBuffer: false` the browser may discard the canvas after compositing, so a partial redraw would blank the other panes. The idle editor still renders zero frames. |
| V-2 | Public API beyond §7 (additive): `viewportManagerOf`, `subscribeViewportManager`, `viewportTestApi`, `resolveControl`, `LAYOUT_PANES`, `defaultPaneCamera`, `FIRST_SHOT_CAMERA`, `WHEEL_BURST_MS`, `selectModeOf`, type `PaneState`, `ViewportToolHost`, `ViewportTestApi`; on `ViewportManager`: `app`, `renderer`, `toolHost`, `paneState`, `subscribePanes`, `rememberedPane`, `paneRect`, `activePaneId`, `controlPickPoint`, `manipulatorAxes`. | The panel needs pane state and change notifications; tools need a host; the test API needs page coordinates. Contract members are unchanged. |
| V-3 | Pane ids: `single` → `pane-single`; `split` → `pane-left` (first shot camera), `pane-right` (persp); `quad` → `pane-top`, `pane-persp`, `pane-front`, `pane-side`. Cameras and display flags are remembered per pane id across layout switches. | §4.6 names `pane-left`, `pane-right`, `pane-top`, …; stable ids keep per-pane state. |
| V-4 | A shot binding whose camera does not exist falls back to the first shot camera by order, then to the pane's own persp view camera. | Before the import creates `shotCam` (and after a camera is deleted) the left pane still shows something. |
| V-5 | Pick candidates within 6 px are ordered by depth in 1 cm buckets, then smaller control size, then distance, then id. | §4.11.16 "ties by depth then smaller control"; buckets make the order transitive and let size decide between controls at practically the same depth. |
| V-6 | Ring drags: angle = (Δpointer · T) / \|T\|², with T the screen velocity (px/rad) of the grab point. Grab points on rings maximise separation from other handles and a horizontal tangent. | Deterministic, follows the pointer locally, defines the "N px about the view axis" test (N / radius px for the view ring). |
| V-7 | Navigation applies moves at once (camera-controls driven programmatically with `smoothTime = 0`, no DOM binding). The pinch (`wheel` + Ctrl) dollies in every profile; orthographic views track and zoom but do not tumble; the one-button mac profile (M1-stretch) is implemented. Esc/blur during a navigation drag restores the camera (shot camera: the preview is cancelled). | camera-controls' own wheel handler turns Ctrl+wheel into a perspective *zoom*, not the dolly §4.11.16 asks for; immediate moves keep tests and idle rendering deterministic. |
| V-8 | View cameras that the user has not navigated re-frame whenever the set of characters changes (first load, another import). | ADR 0006: "auto-framed on first load". |
| V-9 | The viewport panel hosts its own canvas and manager when `app.services.models === null` (the shared test kit's fake app: `/dev/panels`, browser tests). | Lets the panel run in the harness without the shell's GL host; production apps always have a model loader and never take this path. |
| V-10 | `packages/viewport/vitest.config.ts` pre-bundles `three`, the three line/loader addons and `camera-controls`, and no longer passes with no tests. | Avoids Vite reloading a running test and a second copy of three in an addon bundle. |
| V-11 | `SceneSync` dims meshes for x-ray by switching material `transparent`/`opacity ×0.5`/`depthWrite` per pane and restores them after the frame; flipping `transparent` sets `needsUpdate` (three's `OPAQUE` define is a program parameter WebGLRenderer does not re-check), and both shader variants stay cached. | ADR 0006 §6, per-pane flag on one shared scene; a pixel test checks the blend. |
| V-12 | Safe-frame masks for shot cameras (research 09 §4.4) and camera bookmarks are not implemented. | Not in the WP-5 list; `CameraRecord.aspect` is stored and can drive it later. |
| V-13 | Mesh-click picking appends at most one `mesh` candidate (the nearest surface) after controls and joints; its node is the hit triangle's dominant joint (Σ barycentric × skin weight, ties → lower joint index), or for a rigid mesh its nearest node ancestor. Clicks only, never hover. | §4.11.16 priority manipulator > control > joint (> mesh); CPU skinned raycasts are O(triangles). |
| V-14 | Camera radial: items are the pane's cameras (persp, top, front, side, then live shot cameras by order) clockwise from the top at 72 px; a release inside 18 px of the centre changes nothing. The radial state lives in the manager (`openRadial`/`closeRadial`, `PaneState.radial`); `view.cameraRadial` is `internal` (no menu entry). | Hold-to-pick is the hotbox gesture of a leading commercial desktop DCC; one radial at a time. |
| V-15 | Shot cameras: an orthographic camera's navigation zoom is folded into `CameraRecord.orthoHeight` on every write (gestures and framing), and a record whose projection changed gets a new three camera. | Without it, ortho shot zoom and framing were lost on the next record apply, and copying an ortho view to a perspective shot camera kept a perspective camera. |
| V-16 | Tests that need another WP's implementation are `it.runIf(<probe>)` / `describe.runIf(<probe>)` with the blocking WP named in the title, instead of `test.fixme`. | The probe calls the stub and turns the test on by itself when the implementation lands (§8.1 intent: no weakened assertions). |

## Measurements

- 4 panes (quad) × Seed-san (21 meshes, skinned, three's GLTFLoader without the VRM runtime until WP-4's loader
  lands) during playback, synthetic rig evaluation and control lines included: **mean 0.4 ms, p95 0.6–0.8 ms CPU per
  frame** run alone, mean 0.55 ms / p95 1.6 ms while the whole monorepo test suite runs in parallel (budget ≤ 8 ms).
  Apple M4 Pro, macOS 26.6, Chrome 155 (Vitest browser mode, `test/bench.test.ts`).

## Test inventory (browser mode, real WebGL)

- `layout.test.ts`: layout ids/default cameras, GL viewport/scissor maths, scissor and viewport rectangles per layout
  (single, split, quad), idle → zero frames / one frame per change, remembered panes, `paneAt`.
- `picking.test.ts`: every well-separated control picked at its pick point ±1 px, pick point on the polyline,
  candidate order (depth bucket → size), manipulator priority with every rotate handle, joints behind the mask,
  select-tool modifier modes, click cycling (and restart), marquee crossing (unit + tool with Shift).
- `manipulators.test.ts`: gimbal axes vs `gimbalAxes` in the parent·offset frame and the exact "turn about axis k =
  add to channel k" property, single-channel gimbal drags, gimbal-lock warning geometry, view-ring drag of N px =
  N / radius rad about the view axis (1e-6, orthographic), object/world ring axes and rotations, world translate on
  axes and the view plane, dimmed non-keyable handles (drawn translucent, pixel check), constant pixel size in
  perspective and with `manipulatorSize`, hover highlight of rings and controls in pixels, press routing,
  click-without-move; tool lifecycle with a
  recording gesture (one gesture and one commit per drag, update per move, gimbal single channel, Esc, externally
  ended gesture); kernel gesture tests (one history step per drag, Esc cancel) gated on WP-7a.
- `navigation.test.ts`: profile tables, `dcc` tumble/track/dolly, dolly-to-cursor, ortho no-tumble, trackpad
  scroll/pinch, locked shot camera swallows and flashes, unlocked shot navigation = one non-undoable local batch,
  wheel burst commit after 120 ms, no navigation while another preview is active, Esc restores, document changes
  followed, orthographic shot zoom persisted as `orthoHeight` (wheel and framing).
- `sync.test.ts`: SceneSync order with a node constraint (locals → one world update → constraint → destination
  subtree), spring preview on/off, mesh layer and x-ray restore, x-ray blend in pixels, placement and visibility,
  removal.
- `operators.test.ts`: every view operator incl. undo of lock toggle and copy-view-to-shot, copy of an orthographic
  view (projection switch and undo), the camera radial (position, clamping, one at a time, closing); create-shot path
  gated on WP-2.
- `meshPicking.test.ts`: skinned raycast at the posed position (not the rest one), bounding sphere refreshed per pose,
  rigid mesh → nearest node ancestor and lowest priority, mask / display / visibility gating, select tool on mesh
  hits, dominant joint weighting and ties.
- `testApi.test.ts`, `fingers.test.ts` (gated on WP-1/3/4), `bench.test.ts` (report).
- `packages/editor/test/viewport-panel.test.tsx`: registration, pane grid per layout and maximized pane, drop zone
  and sample buttons, camera menu, display toggles, lock button and LOCKED badge, imperative HUD, camera radial
  (Space release on the highlighted item, centre release, Escape, item click, press elsewhere) and its geometry.
