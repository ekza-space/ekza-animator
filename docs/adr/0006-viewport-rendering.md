# ADR 0006 — Viewport rendering: one canvas, custom ViewportManager, imperative scene sync

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [04](../research/04-web-stack.md) §4, [09](../research/09-ui-ux-spec.md) §3, §5, §13.3, §14,
  [07](../research/07-rig-controls-math.md) §4, §5.4, §6, §14.4, [08](../research/08-extensibility-modeling.md) §4.5,
  §7.4, [01](../research/01-maya-animation-features.md) §3.1, §3.10, [05](../research/05-landscape.md) §3.5.

## Context

The owner's core layout is a split screen: a locked shot camera and a free camera on the same character, plus
single and four-view layouts. Research 01/05/08 suggest drei `<View>`; research 04/09 read drei's source and found
that each `<View>` renders its own portal scene, so one character would need N clones. Picking proposals differ
(07: GPU ID buffer for controls; 04/09: analytic screen-space), as do navigation (01: custom; 09:
`camera-controls`) and manipulators (04: `TransformControls` first; 09: custom for Gimbal). The design review
asked for Gimbal mode, marquee selection, pick cycling and highlight tokens in M1, a defined way to persist
navigation of an unlocked shot camera, and evaluation of `VRMC_node_constraint` in the preview.

## Decision

1. **One WebGL canvas, one shared scene, N panes.** R3F 9 hosts a single `<Canvas frameloop="demand">` fixed
   behind the DOM workspace (`pointer-events: none`). `@ekza-animator/viewport` owns a framework-free
   `ViewportManager`: panes register a surface `<div>` (rect from `ResizeObserver` + layout events), a camera
   binding and display flags; per dirty pane it sets viewport/scissor, camera layers and renders
   **main scene → controls (two passes) → clear depth → manipulators/overlays**. Rendering runs in a
   `useFrame(…, 1)` callback. `scene.matrixWorldAutoUpdate = false`.
2. **The viewport area is one dock panel** containing its own pane grid (single, 2-pane side by side, 4-view;
   resizable splitters). Space-tap maximizes the pane under the pointer within that grid; over other panels it
   maximizes their dockview group. Popout windows never host a viewport.
3. **Cameras**: *shot cameras* are document records (`CameraRecord`, with a document-level `locked` flag);
   *view cameras* (persp/top/front/side) are per-pane user state. A pane looking through a locked camera swallows
   navigation and flashes a `LOCKED` badge. **Navigating an unlocked shot camera** writes its `transform` and
   `target` through a preview session committed once per gesture with `undoable: false` (label "Move Shot
   Camera"; wheel bursts end after 120 ms idle), so `Mod+Z` undoes animation, not framing (Maya keeps camera moves
   out of the undo queue). Lock, unlock and copy-view-to-shot are undoable operators. New projects get one shot
   camera auto-framed to the character on first load.
4. **Navigation**: `camera-controls` 3.1.2 (MIT) per pane, behind a `NavigationProfile`: *Maya* (Alt+LMB tumble,
   Alt+MMB track, Alt+RMB/wheel dolly, dolly-to-cursor) and *Trackpad* (two-finger scroll tumble, Shift+scroll
   track, pinch = `wheel`+`ctrlKey` dolly; Safari `gesture*` events). The *one-button mac* profile
   (Option+LMB / Option+Cmd+LMB / Option+Ctrl+LMB) is M1-stretch. `F`/`A` frame selection/all with `fitToBox`.
   MMB autoscroll and canvas context menu are suppressed.
5. **Picking priority: manipulator > control > joint** (mesh click → control is M1-stretch). Controls and joints
   are picked **analytically in screen space**: control shape polylines are projected per pane (cached per pose
   version) and tested by point-to-segment distance ≤ 6 CSS px; ties go to the nearer depth, then the smaller
   control. `pickCandidates` returns the sorted list; a repeated click within 3 px with the same candidates selects
   the next one (**cycling**). **Marquee** (select tool, LMB drag on empty space) uses the crossing test on the
   same projected polylines. GPU ID-buffer picking (04/07) is deferred until a measured need.
6. **Control rendering**: `LineSegments2`/`LineMaterial`, per-pane `resolution` set before each pane renders.
   Two passes give occlusion-aware x-ray: occluded segments at 35 % alpha (`depthFunc = GreaterDepth`, no depth
   write), visible segments at 100 %. Widths and colours from tokens: side colours 2 px; hover +1 px and +20 %
   lightness; selected `--sel` white 3 px; lead `--sel-lead` light green 3 px. The *X-ray* display toggle makes
   meshes 50 % transparent. Controls may be batched into one geometry per character.
7. **Manipulators: a custom `ManipulatorKit`** (imperative three objects in the overlay pass, constant pixel size
   per pane): translate (3 axes, 3 planes, view-plane centre) in **object/world** space and rotate (3 rings, view
   ring) in **object/world/gimbal** space. Gimbal rings come from the rotate order (outer axis fixed in
   `W_parent·O_c`, middle rotated by the outer angle, inner by outer then middle); dragging a ring changes exactly
   that Euler channel, so exactly one curve changes; a ring within 10° of gimbal lock is drawn in `--danger`. The
   chosen space is a user preference shown in the status line. Drags run through the editor-core gesture helper
   (preview session, override restore, auto-key on commit; one history step). Object/world rotations convert
   through `eulerNear` with the current channel values. Trackball and scale are V1. three's `TransformControls`
   is rejected: it binds one camera and DOM element, mutates its target and has no gimbal mode.
8. **Imperative scene sync**: `SceneSync` follows character-registry events ('display' when a model has loaded)
   and pose publications, creates/removes three objects for characters, controls and joints, and copies pose
   buffers into bones without allocation. Order per evaluated frame: bone locals → `updateMatrixWorld` →
   `VRMC_node_constraint` update (`VRMNodeConstraintManager`) → destination subtrees → spring bones (when enabled
   and playing). The same order runs before framing and picking, so Seed-san's constrained robot arm follows its
   arm as it does in Ekza Space. React never renders per bone or per frame.
9. **Display flags per pane** via camera layers: mesh, skeleton, controls, grid; x-ray; plus HUD (camera name,
   `LOCKED` badge, clip frame, scene seconds, "Feet pinned"). WebGLRenderer only (no WebGPU in the MVP); custom
   visuals stay in `viewport/overlays`. drei is not a dependency.
10. **Robustness**: `webglcontextlost/restored` rebuilds GPU resources from the document; if WebGL is unavailable
    the editor shows a clear message and 2D panels still work. The model loader receives the renderer before the
    first load (`setRenderer`, for KTX2 support detection).

## Alternatives

| Alternative | Why not |
|---|---|
| drei `<View>` | Portal scene per view: the same `Object3D` cannot have two parents (verified in 04). |
| One `<Canvas>` per pane | Duplicated GPU memory per context, context-loss risk. |
| GPU ID picking for controls (07) | Async readback and an extra pass; analytic picking is exact for polylines and deterministic in e2e. |
| Each pane as a dockview panel (09) | Possible in V1; adds layout bookkeeping without MVP value. |
| Shot-camera moves as undo steps | `Mod+Z` would undo framing instead of animation, unlike Maya. |
| Gimbal mode in V1 (v0.1) | Object/world rotation edits all three Euler curves at once; Gimbal is how Maya animators keep curves clean (07 D6, 09 §5.9). Cheap given `rotateOrderAxes`. |

## Consequences

- e2e tests compute control, manipulator and curve screen positions through the test API and click them for real.
- The idle editor renders zero frames (`frameloop="demand"`); playback invalidates every frame.
- Hover highlighting on meshes is not available in the MVP (controls only).
