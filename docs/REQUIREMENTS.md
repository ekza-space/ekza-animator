# Ekza Studio — Requirements

Status: v0.7 (2026-10-22: the Auto-Rig mode integrated — FR-AR-01…13 added and marked ✓, FR-JNT-02 and FR-JNT-08's A-pose path and Apply Pose as Rest ✓ by AUTORIG A0, [AUTORIG-SPEC](AUTORIG-SPEC.md)); v0.6 (2026-10-22: the M6b MVP integrated — FR-JNT and FR-SKIN rows marked ✓ (MVP) or partial with what follows
after the MVP, [M6B-SPEC §0.3](M6B-SPEC.md#03-scope-in-and-deferred)); v0.5 (2026-10-19: M6b expanded into the Rig & Skin workspace with [M6B-SPEC](M6B-SPEC.md) — FR-RIG-10 and
FR-RIG-13 moved from M2c to M6b, FR-MOD-31…34 split into FR-JNT-01…10 and FR-SKIN-01…09, rows aligned with M6B-SPEC v1.1 after its design review; v0.4 2026-10-19: FR-MOD
rewritten for the modeling iteration M6a–M8 with [M6A-SPEC](M6A-SPEC.md); FR-SHELL-08, -09, -11 moved to M6a; v0.3 2026-10-18, M2a integrated: the shipped M2a items are marked ✓). Functional requirements are numbered `FR-<AREA>-NN`, non-functional `NFR-NN`.
IDs are stable: a removed requirement is marked *withdrawn*, never renumbered.

**Priority**: `MVP` (milestone M1 core) · `MVP-S` (M1-stretch: built if time remains, MVP-SPEC §1.2) · `V1`
(first public release line: M2a–M2c, and since 2026-10-18 the modeling base M6a and characters from own models M6b,
which come before M2c in the [recommended order](ROADMAP.md#recommended-order)) · `V2` (power features and ecosystem,
M3–M5, M7) · `LATER` (research or large scope: M6c, M8+). The milestone column points to [ROADMAP.md](ROADMAP.md); **✓** marks a requirement of a milestone after
M1 that has shipped (M2a, integrated 2026-10-18, [M2A-SPEC](M2A-SPEC.md)), **(partial)** one that shipped without
meeting its whole acceptance criterion, pending an owner decision; M1 items shipped with the alpha, M1-stretch items as
their rows say.
Acceptance criteria are the minimum test; MVP items are also covered by the user stories and e2e scenarios in
[MVP-SPEC §5–6](MVP-SPEC.md#5-user-stories). Research references: `R01`…`R09` = `research/0N-*.md`.

---

## 1. Functional requirements

### FR-IO — Opening and importing

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-IO-01 | Open VRM 1.0 avatars (`.vrm`). | MVP | M1 | Seed-san opens; humanoid map with all present bones; viewport shows the mesh (load time reported, target < 3 s). |
| FR-IO-02 | Open VRM 0.x avatars with facing normalized to +Z (π yaw on the character root only; never `VRMUtils.rotateVRM0`) and thumb aliases mapped to VRM 1.0 names. | MVP | M1 | Polybot canonical facing yaw `f.z / hypot(f.x, f.z) > 0.999` with `f = normalize((W(leftUpperLeg) − W(rightUpperLeg)) × (W(head) − W(hips)))` (MVP-SPEC §4.11.9); `leftThumbMetacarpal` present in the humanoid map. |
| FR-IO-03 | Open generic skinned `.glb` files. | MVP | M1 | Quaternius UAL opens; skeleton = skin joints; 1:1 rig created. |
| FR-IO-04 | Open via file picker, drag-and-drop anywhere, and bundled samples (Seed-san, Polybot, Quaternius UAL). | MVP | M1 | Each path reaches the import dialog; samples show credits. |
| FR-IO-05 | The three.js loader displays Draco/meshopt/KTX2-compressed assets with self-hosted decoders (no third-party CDN); the headless reader rejects compressed animation data with `EkzaError('compressed-animation')`. | MVP | M1 | `quaternius-idle-meshopt.glb` displays; its animation import is rejected with that code; no decoder request leaves the origin. |
| FR-IO-06 | Import embedded clips as editable control curves at the detected source frame rate (24/25/30/48/50/60), keys on integer frames by default, mapped per glTF interpolation, with error-bounded key reduction (on by default for dense clips); the import dialog lists clips with checkboxes (all checked when ≤ 8). | MVP | M1 | UAL `Idle_Loop` imports at 24 fps with integer key times; values at every source key time match three's `GLTFLoader` within 1e-4 rad / 1e-5 m; curves with ≥ 20 source keys shrink ≥ 3× within tolerance. |
| FR-IO-07 | Import a `.vrma` as a new clip on the active humanoid, following three-vrm-animation's reading rules (rest worlds incl. non-human nodes), retargeting missing bones by world-delta composition and scaling hips by rest height. | MVP | M1 | Own VRMA round trip < 1e-4 rad; synthetic third-party VRMA golden; Polybot-sourced VRMA on Seed-san < 1e-3 rad on world bone directions. |
| FR-IO-08 | Enforce avatar-scale input budgets (file ≤ 256 MiB, JSON ≤ 8 MiB, Σ `accessor.count` ≤ 16 M, any accessor ≤ 4 M, decoded ≤ 512 MiB) plus structural checks, and report parse errors without crashing. | MVP | M1 | The three fixtures and a synthetic 300k-vertex / 60-morph VRM-like file pass; a synthetic hostile GLB is rejected with a dialog; the editor stays usable. |
| FR-IO-09 | Read and show VRM licence meta (redistribution, modification, commercial use, credit). | MVP | M1 | Import summary shows `Redistribution: … · Modification: …`. |
| FR-IO-10 | Import an animation-only GLB onto a character by node name (`remapRawClipByName`). | MVP-S | M1 | Re-import of an E2E-18 export reproduces channel values within 1e-4 rad. |
| FR-IO-11 | Import FBX (Mixamo) and BVH with a humanoid bone-map retarget (R02 §8). | V1 | M2b | A Mixamo walk plays on Polybot without foot inversion. |
| FR-IO-12 | Import `.gltf` with external buffers/images (multi-file drop) and convert to GLB. | V1 | M2b | A `.gltf` + `.bin` + textures drop opens. |
| FR-IO-13 | Infer a humanoid map for generic rigs (name patterns + topology) with a confirmation dialog. | V1 | M2b | Quaternius `DEF-*` rig maps to ≥ 15 required VRM bones after confirmation. |
| FR-IO-14 | Import with Bézier curve fitting (beyond M1's key reduction) within a tolerance. | V1 | M2b | Mocap clip fitted with max error ≤ tolerance and fewer keys than reduction alone. |
| FR-IO-15 | Open an avatar from the Ekza registry with SHA-256 verification (deep link `/editor?open=ekza:avatar:<uuid>&sha256=<hex>`). | V2 | M4a | Hash mismatch blocks loading. |

### FR-RIG — Control rig

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-RIG-01 | Auto-generate an FK control rig for VRM humanoids on the bones present: `root`, `cog` (pure space), `fk.hips` (pelvis), spine chain parented to `cog`, neck, head, jaw, shoulders, arms, hands, fingers, legs parented to `fk.hips`, feet, toes. | MVP | M1 | Seed-san: ≥ 50 controls; rotating `fk.hips` leaves the spine's world rotation unchanged; missing optional bones collapse to the nearest ancestor. |
| FR-RIG-02 | Zero pose = rest pose: each control has an offset ("zero group"); default channels reproduce the rest pose. | MVP | M1 | All fixtures: bone locals equal rest within 1e-9 at default channels. |
| FR-RIG-03 | Maya-style circle controls around bones (shape registry), sized from the skinned mesh (1.25 × P90 vertex distance, bone-length fallback) with per-group clamps and offsets (fingers as lollipops), coloured by side (L blue, R red, centre yellow) with hover/selected/lead highlight tokens. | MVP | M1 | No control below its group minimum; in a framed hand view on Seed-san and Polybot every finger control has a pick point ≥ 6 px from every other control's polyline. |
| FR-RIG-04 | `root` (floor placement) and `cog` (pure space) are translate+rotate keyable; `fk.hips` and FK controls rotate-only; imports put hips motion on `cog`. | MVP | M1 | Channel Box shows t+r for root/cog, r for `fk.hips` and FK. |
| FR-RIG-05 | Bones hidden and not pickable by default; secondary controls for non-humanoid joints (excluding spring-bone joints and node-constraint destinations) hidden by default with a toggle. | MVP | M1 | Seed-san hair spring joints have no controls. |
| FR-RIG-06 | Humanoid controls are world-aligned in canonical space; VRM 0.x and 1.0 controls mean the same thing; normalized rotations are computed from bone world deltas. | MVP | M1 | The same channel values give the same `humanLocal` on Polybot and Seed-san (< 1e-6); three-vrm parity with `flipYaw` for VRM 0.x (1e-6). |
| FR-RIG-07 | Generic skinned GLBs get a 1:1 bone-aligned FK rig (t, r, s keyable). | MVP | M1 | Quaternius: one control per skin joint. |
| FR-RIG-08 | Per-control rotate order (DCC semantics) with defaults per body part (MVP); changing it preserves the pose by resampling at the union of key times and synchronizing the three curves (MVP-S). | MVP-S | M1 | Changing `fk.upperArm.L` from `yxz` to `xyz` with unsynchronized `rx`/`ry` key times keeps bone worlds within 1e-6 at every union time. |
| FR-RIG-09 | Stateless compiled rig kernel with constraint and solver slots (disabled in the MVP). | MVP | M1 | A constraint record compiles to a disabled op with a warning; evaluation unchanged. |
| FR-RIG-10 | Constraints: parent, point, orient, aim with weights (keyable attributes), maintain offset (rest-derived, stored, snap), skip axes, aim world-up types and blend; Update/Clear Offset, Bake to Keys, Mirror; in Rig & Skin and Animate (moved from M2c 2026-10-19). | V1 | M6b | [M6B-SPEC §5.18–§5.19](M6B-SPEC.md#518-constraints-evaluation-and-compilation-c8a-research-18-39): rest exactness 1e-9; a prop follows an IK hand and is dropped by keyed weights (E2E-CNS-01); bake (E2E-CNS-02); M2a schedules and exports unchanged. |
| FR-RIG-11 | Two-bone IK controls with pole vector, soft IK, IK/FK blend, match and seamless switch (legs first). | V1 | M2a ✓ | R07 §21.3 IK tests; translating `cog` −5 cm leaves the IK foot world unchanged (1e-6). |
| FR-RIG-12 | Foot roll and space switching with matching. The simple foot roll (heel/ball/toe pivots, bank, heel and toe twist on the leg IK control) moved to M2a and shipped ✓ ([M2A-SPEC §5.3.1](M2A-SPEC.md#531-foot-roll-simple-variant-r07-12)); space switching is M6b-stretch as a select-mode parent constraint ([M6B-SPEC §1.2](M6B-SPEC.md#12-m6b-stretch-implement-only-if-time-remains-tests-testfixme-until-done)), else M5. | V2 | M5 | Heel/ball/toe pivots; space switch without pops. |
| FR-RIG-13 | Control shape editing in the Rig & Skin workspace: shape library (+ arrow, double arrow, gear, double circle), colour, size, line width, `W`/`E`/`R` on the shape offset, CV editing into custom shapes, mirror/copy/paste/reset; edits survive control-rig updates; rig edits never create keys (moved from M2c 2026-10-19). | V1 | M6b | E2E-RIG-07, E2E-CNS-03, -04: undoable, no keys created, no rig recompile; mirror is an involution. |
| FR-RIG-14 | VRM spring-bone preview during playback (never baked). | V1 | M2c | Toggle per pane; export unchanged by the toggle. |
| FR-RIG-15 | VRM expressions and lookAt as keyable channels on a face control. | V1 | M2c | Blink keyed and exported to VRMA expressions. |
| FR-RIG-16 | Full-body IK / assisted posing with pinning. | LATER | M6+ | Research item. |
| FR-RIG-17 | Pin Feet / Plant Feet for FK legs: re-solve upper/lower leg and foot to pinned foot worlds with the stateless two-bone solver and write FK channels in one undo step. | MVP | M1 | Polybot: pin at 0, `cog ty −0.05` at 10, plant → foot worlds equal the pins (1e-4 m, 1e-4 rad). |
| FR-RIG-18 | Evaluate `VRMC_node_constraint` in the preview (after the bone write, before framing and picking); never bake it into VRM outputs. | MVP | M1 | Posing `fk.upperArm.L` on Seed-san gives `robo_upper_arm.L` the same rest-relative local rotation as `upper_arm.L` (1e-6). |

### FR-VP — Viewport and manipulators

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-VP-01 | One WebGL canvas renders N panes of one shared scene; layouts single, split (shot + persp), quad (top/persp/front/side). | MVP | M1 | `panes()` count per layout; character not cloned. |
| FR-VP-02 | Shot cameras are document records; a locked shot camera cannot be navigated from any pane; `LOCKED` badge. | MVP | M1 | E2E-05 left camera unchanged after Alt+drag. |
| FR-VP-03 | Maya navigation: Alt+LMB tumble, Alt+MMB track, Alt+RMB / wheel dolly, dolly to cursor. | MVP | M1 | Camera changes per gesture in the free pane. |
| FR-VP-04 | Trackpad profile (two-finger orbit, Shift pan, pinch dolly) (MVP); the one-button macOS fallback profile (MVP-S). | MVP | M1 | E2E-22. |
| FR-VP-05 | `F` frames the selection, `A` frames all, in the hovered pane. | MVP | M1 | Selected control projects inside the central 50 % of the pane. |
| FR-VP-06 | Space tap maximizes/restores the hovered pane (or the hovered panel's dockview group); preference "Space plays" (MVP); Space hold opens a pane-camera radial (MVP-S). | MVP | M1 | E2E-05 Space steps. |
| FR-VP-07 | Per-pane display toggles: mesh, skeleton, controls, grid, x-ray; HUD with camera name, frame, lock badge. | MVP | M1 | Toggling controls hides them only in that pane. |
| FR-VP-08 | Picking priority manipulator > control > joint; repeated clicks cycle overlapping controls; Shift toggles, Mod removes, Mod+Shift adds (MVP); mesh click selects the driving control (MVP-S). | MVP | M1 | E2E-06, E2E-26 and US-05. |
| FR-VP-09 | Translate manipulator (`W`): axes, planes, view plane; object/world space. | MVP | M1 | Dragging the X arrow changes only `tx` in world space for an unrotated cog. |
| FR-VP-10 | Rotate manipulator (`E`): axis rings and view ring; object/world space; quaternion → channels via `eulerNear`. | MVP | M1 | 360° drag accumulates without branch flips. |
| FR-VP-11 | Manipulator size `-`/`=`; one drag = one undo step; Esc cancels; auto-key applies on commit. | MVP | M1 | E2E-13-style undo check for a manipulator drag. |
| FR-VP-12 | Gimbal rotate mode: rings follow the rotate order and a ring drag changes exactly one Euler channel; space remembered per user (MVP). Scale manipulator, trackball, step snapping (`J`) (V1). | MVP | M1 | E2E-25: only the dragged channel changes (1e-12). |
| FR-VP-13 | View history `[`/`]`, camera bookmarks, ortho tumble lock. | V1 | M2c | Undo of a view change restores the camera. |
| FR-VP-14 | Onion skin (±N ghosts, keyed mode). | V1 | M2c | Ghost poses equal evaluated poses at their frames. |
| FR-VP-15 | Motion trails (display); editable trails later. | V1 | M2c | Trail points equal control world positions. |
| FR-VP-16 | Marquee selection of controls in the viewport (crossing test). | MVP | M1 | E2E-26: a marquee over the hand selects its finger controls and no other control. |
| FR-VP-17 | Viewports in popout windows. | LATER | M6+ | Needs a second WebGL context. |
| FR-VP-18 | Navigating an unlocked shot camera persists it once per gesture without an undo entry; lock/unlock/copy-view are undoable. | MVP | M1 | E2E-05: after unlock + orbit, `Mod+Z` does not revert the camera. |

### FR-OUT — Outliner

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-OUT-01 | Tree: character → Rig (control hierarchy), Skeleton (read-only bones with VRM humanoid names), Clips. | MVP | M1 | Seed-san rows match the rig records. |
| FR-OUT-02 | Filter by name and humanoid bone name. | MVP | M1 | "leftHand" shows `fk.hand.L`. |
| FR-OUT-03 | Selection synced both ways with the viewport and Channel Box; hover pre-highlights in viewports. | MVP | M1 | US-05. |
| FR-OUT-04 | Rename clips inline; controls rename in V1. | MVP | M1 | Clip rename undoable. |
| FR-OUT-05 | Pick-walk with arrow keys over the control hierarchy. | V1 | M2a ✓ | ↑ selects the parent control. |

### FR-CB — Channel Box

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-CB-01 | Show keyable channels of the lead selection (degrees for rotations); edits apply to all selected controls; mixed values shown as `—`. | MVP | M1 | Two controls selected → typed value applied to both. |
| FR-CB-02 | Maya colour states: keyed on this frame, keyed elsewhere, changed (override), locked; never colour alone (bar shapes, tooltip). | MVP | M1 | State mapping unit test against `channelState`. |
| FR-CB-03 | Numeric entry with relative expressions (`+=`, `-=`, `*`, `/`, `deg`/`rad` suffix), Tab navigation, ↑/↓ nudge. | MVP | M1 | US-11. |
| FR-CB-04 | Context menu: key selected channels, reset to default, lock/unlock. | MVP | M1 | Locked channels reject edits with a toast. |
| FR-CB-05 | Virtual slider (MMB drag / drag channel name) with Pointer Lock. | V1 | M2a ✓ | Drag changes value at the documented rate. |
| FR-CB-06 | Rotate order shown (MVP); editable, pose-preserving (MVP-S). | MVP | M1 | Shown, and editable per FR-RIG-08 (the stretch item landed with WP-7b; MVP-SPEC §1.2 status). |

### FR-KEY — Keying

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-KEY-01 | `S` keys all keyable channels of the selected controls (or the whole character by key target) at the current frame. | MVP | M1 | Keys created per MVP-SPEC §4.11.1. |
| FR-KEY-02 | `Shift+W/E/R` key translate/rotate/scale only; rotation keys are synchronized across rx/ry/rz. | MVP | M1 | `Shift+E` creates 3 rotation keys only. |
| FR-KEY-03 | Key selected Channel Box channels. | MVP | M1 | Only highlighted channels keyed (rotation triple rule applies). |
| FR-KEY-04 | Auto-key toggle (red time-slider border); Maya rule (only channels with curves) with a preference to key all. | MVP | M1 | E2E-21. |
| FR-KEY-05 | Delete keys at the current frame (viewport/Channel Box) and selected keys (Graph Editor and time-slider band). | MVP | M1 | Undoable. |
| FR-KEY-06 | Default tangent types for new keys as a preference (default auto/auto). | MVP | M1 | Changing the preference affects new keys only. |
| FR-KEY-07 | Unkeyed edits: static values on key-less channels (document, undoable); session overrides on keyed channels (discarded on frame change, undoable through the editor history). | MVP | M1 | MVP-SPEC §4.11.2 table tests; E2E-24. |
| FR-KEY-08 | Breakdown keys with proportional retiming. | V1 | M2a ✓ | Moving neighbours keeps the ratio. |
| FR-KEY-09 | Tween slider family (tween, blend to neighbour, ease, push/pull) with overshoot. | V1 | M2a ✓ | R01 §5.9 formulas. |
| FR-KEY-10 | Keying modes by body part (VRM groups). | V1 | M2a ✓ | `S` on a hand keys the whole arm group. |

### FR-TIME — Time and playback

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-TIME-01 | Time slider with ruler, playhead and key ticks of the selected controls (the MVP summary row), in active-clip frames. | MVP | M1 | Ticks at every key time of the selection. |
| FR-TIME-02 | Scrubbing updates the pose in the same animation frame. | MVP | M1 | Pointer move → pose visible ≤ 1 frame. |
| FR-TIME-03 | Playback range (inner) separate from the clip range (outer). | MVP | M1 | Playback loops inside the playback range. |
| FR-TIME-04 | Play/stop, loop/once/oscillate, real-time (drops frames) vs every-frame, half/double speed; snap to integer frames. | MVP | M1 | Clock unit tests with a fake time source. |
| FR-TIME-05 | Per-clip frame rate 24/25/30/48/50/60/custom (rational); changing it offers keep-seconds or keep-frames. | MVP | M1 | Keep-seconds rescales key times by `new/old`. |
| FR-TIME-06 | Previous/next key, previous/next frame, go to start/end. | MVP | M1 | `,`/`.` jump between key times. |
| FR-TIME-07 | Maya range editing on the slider: Shift+click/drag selects a frame or range band with its keys; drag the middle to move, an end to scale; RMB delete/copy/paste/tangent type (MVP). Mod+drag copy and ripple (V1, shipped in M2a ✓). | MVP | M1 | E2E-23: keys at 10 on three controls move to 14; one `Mod+Z` restores. |
| FR-TIME-08 | Time bookmarks (named coloured ranges), exportable as clips. | V1 | M2c | Bookmark → named glTF animation. |
| FR-TIME-09 | Audio track with waveform and scrubbing. | V1 | M2c | Waveform aligned with frames. |
| FR-TIME-10 | MMB-drag on the slider changes time without evaluation (carry a pose). | V1 | M2a ✓ | `S` after MMB-drag keys the held pose. |
| FR-TIME-11 | Shared scene clock (`sceneFps`, `sceneFrame`); each clip maps it through `sceneStart` and its fps; the UI shows active-clip frames and scene seconds. | MVP | M1 | US-24 / E2E-27: 24 and 30 fps clips (sceneStart 0 and 6) both at clip frame 24 at scene frame 30. |

### FR-GE — Graph Editor

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-GE-01 | Channel list (character → control → channel) with X/Y/Z colour swatches, visibility and lock per curve, filter, "only animated". | MVP | M1 | Rows match curves of the selected controls. |
| FR-GE-02 | Curves drawn exactly (Bézier per segment) from the shared curve engine; infinity drawn dotted. | MVP | M1 | Pixel probe at a known value (browser test). |
| FR-GE-03 | Pan, zoom (both/axis), frame all (`A`) and frame selection (`F`); wheel/pan/zoom gestures per navigation profile (Maya: wheel zoom, Alt+MMB pan; Trackpad: scroll pan, pinch zoom). | MVP | M1 | View transform and gesture tests. |
| FR-GE-04 | Click, box and double-click (whole curve) selection of keys and tangent handles with Shift/Mod modifiers. | MVP | M1 | Hit priority: selected handle > key > handle > curve; double-click selects all keys of the curve. |
| FR-GE-05 | Move keys by LMB drag on the selection or MMB drag anywhere (axis lock with Shift, integer-frame snap) and numerically; collisions resolved on commit. | MVP | M1 | MVP-SPEC §4.11.3. |
| FR-GE-06 | Tangent types auto, spline, clamped, linear, flat (toolbar, menu, keys `1`–`5`) with AnimX span rules (linear only if both sides linear; auto end keys flat). | MVP | M1 | E2E-08 (all keys selected): linear → v(7.5) = mean(v0, v15). |
| FR-GE-07 | Stepped and stepped-next interpolation, read from the span's start key out side. | MVP | M1 | Value held until the next key; `6` on one key steps only the following span. |
| FR-GE-08 | Plateau tangents (calibrated approximation, documented). | MVP-S | M1 | Never overshoots; flat at extrema. |
| FR-GE-09 | Break and unify tangents. | MVP | M1 | E2E-09. |
| FR-GE-10 | Weighted curves with lock/free tangent weight. | MVP | M1 | E2E-10. |
| FR-GE-11 | Pen-like handle dragging (angle only for non-weighted or locked; angle + length for free weights; unified keys stay collinear). | MVP | M1 | MVP-SPEC §4.11.4 tests. |
| FR-GE-12 | Insert a key on a curve preserving its shape (insert tool), freezing the neighbours' affected computed tangents. | MVP | M1 | E2E-11; anim-core property test 1e-12 for every tangent type, weighted and not. |
| FR-GE-13 | Numeric fields: frame, value, in/out angle (Maya convention; in-angle on the forward-pointing vector), in/out weight (weighted curves). | MVP | M1 | E2E-12 incl. an in-angle of 30° on a rising curve. |
| FR-GE-14 | Pre/post infinity: constant, linear, cycle, cycle with offset, oscillate. | MVP | M1 | Values at negative and multi-cycle times match the oracle. |
| FR-GE-15 | Euler filter on selected rotation curves (also run on import). | MVP | M1 | No jumps > π after filtering a flipped clip. |
| FR-GE-16 | Copy/paste keys at the current frame (merge/replace) with handles, broken/weight state and weighted-curve conversion. | MVP | M1 | Relative timing and curve shape preserved. |
| FR-GE-17 | Cycle-aware auto tangents when both infinities cycle. Not built in M1 (stretch); M2a core, with cyclic infinities by default for curves keyed in loop clips ([M2A-SPEC §5.23](M2A-SPEC.md#523-loop-clips-cyclic-curves-and-cycle-aware-auto-tangents-a0-fr-ge-17)). | MVP-S | M2a ✓ | C¹ continuity at the seam (1e-9). |
| FR-GE-18 | Normalized and stacked views. | V1 | M2a ✓ | Display-only, data unchanged. |
| FR-GE-19 | Buffer curve snapshot/swap. | V1 | M2a ✓ | Ghost curve shown; swap restores. |
| FR-GE-20 | Scale keys and region/lattice tools. | V1 | M2a ✓ | Scale around the pivot. |
| FR-GE-21 | Simplify / key reduction with tolerance (`reduceKeys`; Graph Editor command and import option). | MVP | M1 | Error ≤ tolerance at original key times and integer frames. |
| FR-GE-22 | Smoothing filters (Gaussian, Butterworth). | V2 | M5 | Preview popover. |
| FR-GE-23 | Quaternion rotation curves per control (slerp/cubic). | V2 | M5 | No Euler flips by construction. |

### FR-DS — Dope Sheet

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-DS-01 | Dope Sheet with summary/character/control/channel rows, key move/scale, hold bars. | V1 | M2a ✓ | Shares selection with the Graph Editor. |
| FR-DS-02 | Ripple edit. | V1 | M2a ✓ | Later keys shift with the moved block. |

### FR-CLIP — Clips and layers

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-CLIP-01 | Multiple named clips per character. | MVP | M1 | E2E-15. |
| FR-CLIP-02 | New, rename (validated), duplicate (deep copy, new IDs), delete (soft, undoable). | MVP | M1 | Each undoable. |
| FR-CLIP-03 | Switch the active clip (Clips panel, timeline selector). | MVP | M1 | Keys per clip isolated. |
| FR-CLIP-04 | Clip settings: fps (keep seconds / keep frames), range, scene start, loop, root motion (hips / in-place), Ekza slot, contact frame, tags. | MVP | M1 | Exported metadata matches. |
| FR-CLIP-05 | Clip → layers → curves data model with one base layer evaluated. | MVP | M1 | Every clip has exactly one base layer. |
| FR-CLIP-06 | Animation layers UI and evaluation (additive/override, weight, mute/solo, merge). | V2 | M5 | R01 NL-02. |
| FR-CLIP-07 | Non-linear clip sequencing (time editor). | V2 | M5 | Clip instances on tracks. |
| FR-CLIP-08 | Multi-character clips (one clip animates two characters). | V2 | M5 | Interaction shots export per character. |
| FR-CLIP-09 | Clip provenance: `derivedFrom` (title, author, licence, source hash) and `redistributable`, filled on import (VRM meta, Mixamo names, unknown sources) and editable. | MVP | M1 | Seed-san/UAL/VRMA imports record the expected provenance; exported `ekza_animation_v1` carries it per clip. |

### FR-POSE — Pose tools

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-POSE-01 | Copy/paste pose (session + system clipboard), across humanoid characters by template key. | MVP | M1 | Seed-san pose pasted on Polybot gives equal normalized rotations. |
| FR-POSE-02 | Paste mirrored. | MVP | M1 | Equals mirror of the copied pose. |
| FR-POSE-03 | Mirror pose: flip, left→right, right→left (humanoid); scope = selection expanded to mirror pairs; only side `C` self-mirrors; unpaired L/R controls unchanged with a warning. | MVP | M1 | `mirror(mirror(P)) = P`; after flip R = mirror(L_before), L = mirror(R_before); Polybot `fk.toes.R` unchanged. |
| FR-POSE-04 | Reset selected controls to rest. | MVP | M1 | Channels return to defaults (keyed per auto-key rule). |
| FR-POSE-05 | Mirror animation with half-cycle offset. | V1 | M2a ✓ | Left step becomes right step. |
| FR-POSE-06 | Pose library with thumbnails and drag-to-blend. | V2 | M5 | Poses stored per humanoid bone. |
| FR-POSE-07 | Selection sets and an auto-generated humanoid picker. | V1 | M2c | Picker button selects its control. |

### FR-UNDO — Undo and history

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-UNDO-01 | Every document mutation is a transaction issued by an operator or a tool gesture through the edit kernel. | MVP | M1 | No store writes outside `transact`/preview (lint rule + review). |
| FR-UNDO-02 | One gesture = one undo step, including unkeyed override edits (editor history, ADR 0013); Esc cancels a drag with no undo entry. | MVP | M1 | E2E-13, E2E-24. |
| FR-UNDO-03 | Redo until a new change. | MVP | M1 | Redo stack cleared by new local changes. |
| FR-UNDO-04 | Undo/redo restore the selection snapshot of the entry. | MVP | M1 | Selection equals the pre-change selection after undo. |
| FR-UNDO-05 | Per-user undo with compare-before-restore per merge unit (whole record for keys, per field otherwise) and skip reports. | MVP | M1 | A concurrent edit of a different field does not block undo; of the same field it is skipped and reported. |
| FR-UNDO-06 | History panel with labels and authors. | V1 | M2c | Click jumps to an entry. |

### FR-EXP — Export

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-EXP-01 | Bake clips into the original GLB/VRM with the append-only surgeon (4-byte aligned append after `buffers[0].byteLength`, padding rules, refusal of external buffers and animated `matrix` nodes). | MVP | M1 | No validator error absent from the source report; original BIN bytes are a prefix. |
| FR-EXP-02 | Same-name clips (trimmed, case-insensitive) are replaced in place; the `ekza_animator_bake_v1` marker (`baseBinSha256`, `replaced` originals) enables safe rollback; never roll back past a foreign later baseline. | MVP | M1 | Re-bake is byte-identical; on UAL, bake `{Idle_Loop}` then re-bake `{Walk_Loop}` restores the original `Idle_Loop` entry with no new validator errors. |
| FR-EXP-03 | Self-contained clips: every `(node, path)` animated by any clip of the output file — including pre-existing clips kept by the surgeon — has a track in every clip we write (constant → 2 keys). | MVP | M1 | Switching clips in three.js leaves no stale pose; a new UAL clip carries `DEF-hips` translation. |
| FR-EXP-04 | VRM extensions, materials, compression, extras and unknown extensions preserved: JSON-value equality for every original JSON value (except documented tails and markers) and byte identity of the original BIN prefix. | MVP | M1 | `extensions.VRMC_vrm` deep-equal; spring bones load in three-vrm. |
| FR-EXP-05 | VRMA export, one clip per file, LINEAR/STEP only. | MVP | M1 | Validator 0 errors; VRMA lints pass. |
| FR-EXP-06 | VRMA uses an identity-rest canonical humanoid skeleton with parent-relative rest offsets; plays on VRM 0.x and 1.0 targets. | MVP | M1 | E2E-17 error < 1e-3 rad vs `humanLocal` (vrm1) / `flipYaw(humanLocal)` (vrm0); recomposed rest worlds ≤ 1e-5 m. |
| FR-EXP-07 | VRMA expressions and lookAt. | V1 | M2c | Blink and gaze play in three-vrm-animation. |
| FR-EXP-08 | Animation-only GLB (skeleton nodes + clips, no meshes). | MVP | M1 | E2E-18. |
| FR-EXP-09 | Read-back check in the app and glTF-Validator in tests (MVP); validator in an app worker (MVP-S). | MVP | M1 | Errors block the download. |
| FR-EXP-10 | Integer-frame LINEAR sampling with hemisphere continuity, STEP only for fully stepped tracks, loop closure option and root-motion modes (in-place removes the travel in canonical space and keeps the sway; generic rigs on the topmost driven translating joint). | MVP | M1 | `dot(q_i, q_{i−1}) ≥ 0` for all samples; > 90° steps produce a warning lint. |
| FR-EXP-11 | Licence gate for baking avatars whose VRM meta forbids modification or redistribution. | MVP | M1 | Export blocked until acknowledged; VRMA always allowed. |
| FR-EXP-12 | Error-bounded reduction of sampled export tracks. | V1 | M2a (partial) | Hand-keyed clips shrink 3–10× within tolerances (R02 §6.4). *M2a (partial):* every sample within the per-node tolerances and never more samples or bytes (fix round 1); ≥ 3× only on linear blocking — smooth 30 fps motion keeps (nearly) every sample at these tolerances. Owner item M2A-A5-3 / M2A-INT-3 in [DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18): accept, or change the tolerances or the criterion. |
| FR-EXP-13 | BVH and FBX export behind an exporter interface. | V2 | M5 | Blender/Maya round-trip tests. |
| FR-EXP-14 | CUBICSPLINE "compact" GLB mode. | LATER | M6+ | Exact for non-weighted, non-rotation channels. |
| FR-EXP-15 | Optional embedded editable curve source in exported GLBs (`extras.ekza_animator_curves_v1`). | V1 | M2c | Re-import restores curves when hashes match. |

### FR-PROJ — Project files

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-PROJ-01 | Save `.ekzanim` (zip: manifest, project.json, assets by SHA-256). | MVP | M1 | E2E-19. |
| FR-PROJ-02 | Open `.ekzanim` with asset hash verification and migrations. | MVP | M1 | Corrupted asset → clear error. |
| FR-PROJ-03 | `.ekzanim.json` debug variant. | MVP | M1 | Opens when assets are cached or supplied. |
| FR-PROJ-04 | Deterministic output (sorted JSON, fixed zip metadata); `minWriterVersion` or a newer table version opens read-only; unknown tables and fields survive. | MVP | M1 | Same project → same bytes; an unknown table round-trips. |
| FR-PROJ-05 | Autosave to IndexedDB with crash recovery. | V1 | M2a ✓ | Recovery prompt after a forced reload. |
| FR-PROJ-06 | Opening a project that contains CRDT updates (`docs/*.yupd`) merges into an existing copy; schema-1 JSON snapshots always open as a new project. | V2 | M3 | Two edited copies merge without loss. |

### FR-SHELL — Application shell

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-SHELL-01 | Next.js `/editor` client island (MVP); the static export build serving the editor from files is verified in V1 (manual QA in M1). | MVP | M1 | `/editor` works from `next start`; static build checked manually (§8.3). |
| FR-SHELL-02 | Dockable workspace (dockview) with the Animate layout, persistence and reset. | MVP | M1 | Layout survives reload; reset restores the default. |
| FR-SHELL-03 | Menu bar, status line, help line; menu items show keymap labels and poll-disabled reasons. | MVP | M1 | Disabled item tooltip shows the poll reason. |
| FR-SHELL-04 | First-run dialog: navigation profile and Space behaviour; a "Getting started" card states what M1 is for (FK legs with Plant Feet). | MVP | M1 | Choice persisted in prefs. |
| FR-SHELL-05 | Import and export dialogs (MVP-SPEC §4.11.6, §4.11.10) with clip checklist, source fps, reduction option, licence badge, export profile, lints and interop warnings. | MVP | M1 | E2E-03, E2E-04, E2E-16. |
| FR-SHELL-06 | Toasts for batch operations with an Undo action. | MVP | M1 | "Deleted N keys · Undo" works. |
| FR-SHELL-07 | About dialog with licences, sample credits and generated third-party notices. | MVP | M1 | Seed-san credit shown; notices file linked. |
| FR-SHELL-08 | Command palette (`Mod+K`) over all operators, with Blender names as aliases. | V1 | M6a (moved from M2c) | Search runs operators; aliases find Maya-named operators (M6A-SPEC §5.18). |
| FR-SHELL-09 | Marking menus (W/E/Q/Shift+S/RMB, and the Model RMB/Shift+RMB/Ctrl+RMB/Ctrl+Shift+RMB menus) with flick selection. | V1 | M6a (moved from M2c) | Flick within 250 ms triggers without drawing; slots never move between modes. |
| FR-SHELL-10 | Hotkey editor with conflict detection. | V1 | M2c | Overrides stored as a diff. |
| FR-SHELL-11 | Workspace tabs `Model › Rig & Skin › Animate › Review` with status glyphs (Model and Animate in M6a, Rig & Skin in M6b, Review in V1). | V1 | M6a (moved from M2c); Rig & Skin ✓ (M6b MVP) | Workspace switch keeps document, object selection, time and pane cameras (M6A-SPEC §5.17). |

### FR-HK — Hotkeys and input

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-HK-01 | Bindings on `KeyboardEvent.code`; labels from the layout map when available. | MVP | M1 | E2E-20. |
| FR-HK-02 | Panel-under-pointer scopes; text inputs swallow hotkeys except Esc/Enter/Tab and `Mod+S`/`Mod+Z` outside text editors. | MVP | M1 | `S` while typing in a field does not key. |
| FR-HK-03 | Maya preset per MVP-SPEC §4.10; browser/OS reserved chords never bound; MMB autoscroll and canvas context menu suppressed. | MVP | M1 | Keymap table test. |
| FR-HK-04 | Tap/hold handling for Space with blur/visibility reset. | MVP | M1 | Alt-Tab during hold does not leave Space stuck. |
| FR-HK-05 | Shortcut cheat sheet (`?`) generated from the keymap. | MVP | M1 | Lists every bound operator. |

### FR-EKZA — Ekza ecosystem

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-EKZA-01 | Write `asset.extras.ekza_animation_v1` metadata in every export, with per-clip contact, tags and provenance (ADR 0010). | MVP | M1 | Schema test; no `uri` key anywhere; provenance union equals the clips' `derivedFrom`. |
| FR-EKZA-02 | Tier-0 lints per export profile (profiles as data), codes aligned with the registry's issue codes, `provenance-unknown`, `non-redistributable` and `height-scale-range` lints. | MVP | M1 | Planted violations reported with the table's codes and severities (local vs Ekza profile). |
| FR-EKZA-03 | Interop warnings (Space idle/walk, shared-library gate, OMOBA not playing custom clips). | MVP | M1 | Shown for bake-into-model of a VRM. |
| FR-EKZA-04 | Clip slot vocabulary picker (`idle`, `walk`, …; `tpose` reserved). | MVP | M1 | Slot becomes the exported animation name. |
| FR-EKZA-05 | "Preview as Ekza Space" panel: first an emulation of Space's rules; the real renderer after the upstream changes (decoder injection, npm publication, peer `<0.187`). | V1 | M2c | Emulated height and clip selection match Space for Seed-san. |
| FR-EKZA-06 | Upload as typed asset `ekza:animation:<uuid>` (`universal / vrma-humanoid-v1`). | V2 | M4a | Registry accepts the VRMA. |
| FR-EKZA-07 | One-click "Publish to Ekza" with device-code login. | V2 | M4a | New `studio-upload` scope. |
| FR-EKZA-08 | Hub integration contract: deep link with hash verification and the versioned `ekza-studio-embed/v1` iframe protocol (`open`, `ready`, `exported`, `error`). | V2 | M4a | Contract test with a mock host page. |

### FR-COL — Collaboration

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-COL-01 | Strict D/U/P separation: no session or preference state in the document. | MVP | M1 | Snapshot contains no selection/time/camera-view fields (schema test). |
| FR-COL-02 | Stable client IDs, flat records, parent pointers, soft deletes, partitions with an `open/close` lifecycle (clip metadata in the character partition), per-field merge units. | MVP | M1 | `partitionOf` covers every table; batches applied partition by partition keep projections valid. |
| FR-COL-03 | Document-store conformance suite including the replicating part (test network, fuzzing, H1–H5 goldens), run in CI against the memory store (non-replicating part) and a private test-only Yjs store (full suite). | MVP | M1 | Both runs green. |
| FR-COL-04 | Yjs-backed store + Hocuspocus sync service; two users animate two characters live. | V2 | M3 | R06 P1 exit criteria. |
| FR-COL-05 | Presence (selection, time, cursors), claims, follow/presenter. | V2 | M3 | Remote markers visible. |
| FR-COL-06 | Ekza auth, roles and per-document permissions; review comments. | V2 | M4b | Commenter cannot change animation. |
| FR-COL-07 | Per-user animation layers and region claims ("four hands"). | LATER | M5+ | Usage-driven (R06 §16). |

### FR-EXT — Extensibility

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-EXT-01 | Registries for operators (typed `OperatorMap`), tools, panels, keymaps, menus, importers, exporters, export profiles, control shapes, rig op kinds and document tables; built-ins use them; registration is explicit. | MVP | M1 | No UI action bypasses the operator registry; built-in exporters run through the exporter registry. |
| FR-EXT-02 | Unknown tables and fields preserved on load/save; unknown tables are transactable; per-table versions. | MVP | M1 | Round trip keeps an unknown table and an unknown field. |
| FR-EXT-03 | Data packs (keymaps, control shapes, rig templates, export profiles). | V1 | M2c | Pack loads without code. |
| FR-EXT-04 | Trusted dev-mode extensions via `defineExtension`. | V1 | M2c | Extension registers an operator. |
| FR-EXT-05 | Sandboxed third-party plugins (opaque-origin iframe, async RPC, manifest permissions). | LATER | M6+ | R08 §8.3 (trust level "sandboxed"). |
| FR-EXT-06 | Scripting console and MCP/agent bridge over operators. | V2 | M5 | Operator call from a script is undoable. |

### FR-MOD — Modeling (M6a–M8)

Rewritten 2026-10-19 with the modeling plan ([MODELING-PLAN](MODELING-PLAN.md) v0.2) and the M6a build spec
([M6A-SPEC](M6A-SPEC.md) v1.0). FR-MOD-02…04 (splines) keep their IDs and move to M8; FR-MOD-05 is split into the rows
below. Acceptance criteria name the M6a e2e scenarios (`E2E-MOD-NN`) and gates. ✓ = built and green on
`m6a/integration` (2026-10-20; [integration notes](wp-notes/m6a-integration.md)), owner review open.

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-MOD-01 | Control shapes use the shared `SplineSet` type through the control-shape registry. | MVP | M1 | Shapes tessellate from `SplineSet`. |
| FR-MOD-02 | Renderable curve objects with CV/EP/Bézier pen tools and component selection. | LATER | M8 | Pen tool creates editable splines. |
| FR-MOD-03 | Generators (sweep, loft, revolve, extrude) with construction history, outputting `mesh-core` meshes. | LATER | M8 | Editing a profile updates the mesh. |
| FR-MOD-04 | `EKZA_curves` glTF extension (registered prefix) with a `LINE_STRIP` fallback. | LATER | M8 | Validator passes; three plugin loads it. |
| FR-MOD-05 | *Withdrawn 2026-10-19: split into FR-MOD-06…30 (M6a) and FR-MOD-31…36 (M6b, M6c, M7).* | — | — | — |
| FR-MOD-06 | Model workspace with its layout, menus (Mesh, Edit Mesh, Mesh Tools, Mesh Display), status-line groups and hidden timeline; workspace tabs as pipeline steps. | V1 | M6a ✓ | E2E-MOD-01…32 run in the Model workspace; switching keeps the document (M6A-SPEC §5.17). |
| FR-MOD-07 | Component modes (`F8`, `F9`/`1`, `F10`/`2`, `3`, RMB menu) with hilite, per-mode selection memory, click/marquee with Maya modifiers, hover pre-selection, camera-based selection and Maya's loop table (loop, partial loop, ring, deselect) for vertices, edges and faces; grow/shrink/convert/border/shell. | V1 | M6a ✓ | E2E-MOD-02, E2E-MOD-26. |
| FR-MOD-08 | Selection changes are undo steps in the Model workspace (every discrete gesture its own step; auto-repeated keys and drags coalesce, M6A-SPEC S3), off in Animate. | V1 | M6a ✓ | E2E-MOD-26. |
| FR-MOD-09 | Hide selected/unselected and show all for components and objects; isolate per pane. | V1 | M6a ✓ | E2E-MOD-25. |
| FR-MOD-10 | Soft selection (Volume/Surface, falloff presets, `B`/`B`+drag). | V1 | M6a ✓ | E2E-MOD-10. |
| FR-MOD-11 | Symmetry Object/World X/Y/Z remembered per mesh, with vertex/edge/face partner maps; every base tool mirrors by the per-tool table, one symmetric result at the seam. | V1 | M6a ✓ | E2E-MOD-04, -20, -21, -22; property P10. |
| FR-MOD-12 | Six primitives with low-poly defaults (and a Maya preference) and live parameters until the first component edit; templates prop, handheld, humanoid guides and a humanoid body mesh generator. | V1 | M6a ✓ | E2E-MOD-27; AS-LP-A′; AS-LP-S part A. |
| FR-MOD-13 | Component W/E/R (new Scale tool) in World/Object/Component space (Maya's per-component Normal is M6a-stretch, S21); MMB-drag moves the selection (Maya rule); Tweak style; grid/vertex/increment snapping across meshes; pivot editing; Freeze/Reset Transformations. | V1 | M6a ✓ | E2E-MOD-23, -28. |
| FR-MOD-14 | Extrude faces and border edges as an adjustable session (`Ctrl+E`, then the extrude manipulator or `W`/`E`/`R` on the cap, then Divisions — one history step with an args undo stack inside the session, S18), and Shift+drag smart extrude. | V1 | M6a ✓ | E2E-MOD-01, -17, -18. |
| FR-MOD-15 | Inset; Bevel edges (fraction/absolute, 1–3 segments, clamp, fan corners with a warning). | V1 | M6a ✓ | E2E-MOD-07; count oracles. |
| FR-MOD-16 | Insert Edge Loop (relative, equal distance, multiple), Offset Edge Loop, Connect and Multi-Cut (points on edges/vertices, Ctrl loop, snap, RMB/Enter completes, Esc cancels with no step). | V1 | M6a ✓ | E2E-MOD-05, -06. |
| FR-MOD-17 | Slide Edge/Vertex along rails; Average Vertices with pinned borders and seam. | V1 | M6a ✓ | E2E-MOD-24. |
| FR-MOD-18 | Bridge (equal counts, two faces; divisions, twist, offset) and Fill Hole. | V1 | M6a ✓ | E2E-MOD-28; count oracles. |
| FR-MOD-19 | Merge (distance), Merge to Center, Target Weld, Collapse, Merge by Distance; Maya plain Delete and Delete Edge/Vertex. | V1 | M6a ✓ | E2E-MOD-08; count oracles. |
| FR-MOD-20 | Spin Edge, Flip Triangle Edge, Triangulate, Quadrangulate. | V1 | M6a ✓ | Count oracles; E2E-MOD-32. |
| FR-MOD-21 | Combine, Separate, Extract, Duplicate Faces as mesh-set operations in one undo step; Mirror (cut, merge, reversed winding) and Symmetrize; Group/Parent/Unparent/Duplicate. | V1 | M6a ✓ | E2E-MOD-09, -28. |
| FR-MOD-22 | Per-edge hard flags with one propagation rule, faceted new meshes, Soften/Harden/Set Normal Angle/Reverse/Conform; one triangulation and normal function for viewport, picking, HUD and export (WYSIWYG). | V1 | M6a ✓ | E2E-MOD-32; property P7-hard. |
| FR-MOD-23 | Per-face palette slot as colour truth (project palettes, Palette panel, Paint Colour, fill shell, select by swatch, replace swatch, variants); exports as one palette texture with collapsed UVs (default), `COLOR_0`, or one material per colour. | V1 | M6a ✓ | E2E-MOD-11 (round trip within 1/255). |
| FR-MOD-24 | Planar, box and cylindrical UV projections; UVs propagated by every op. | V1 | M6a ✓ | Projection goldens (M6A-SPEC §5.28). |
| FR-MOD-25 | Reference image planes per ortho camera (offset, size, opacity, depth, lock), never picked or exported, saved in the project. | V1 | M6a ✓ | E2E-MOD-29. |
| FR-MOD-26 | Poly Count HUD with a triangle budget bar; Mesh Check panel and overlay with "select matching" and explicit fixes. | V1 | M6a ✓ | E2E-MOD-09, -25; HUD counts equal the kernel's. |
| FR-MOD-27 | Adjust Last Operation (Last-op card and Channel Box INPUTS, `T`), Repeat Last (`G`), last tool (`Y`), numeric input in the narrow capture window; Modeling Toolkit with option boxes. | V1 | M6a ✓ | E2E-MOD-06, -07, -19. |
| FR-MOD-28 | Mesh storage as revision refs over content-addressed chunks (schema v3), autosave and `.ekzanim` with mesh blobs, byte-bounded undo; bit-exact undo and deterministic revisions. | V1 | M6a ✓ | E2E-MOD-14; properties P5, P6, P8; B7 memory bench. |
| FR-MOD-29 | Make editable for imported meshes (licence-gated) keeping skin weights, morph targets, UVs and colours; export through the surgeon's "replace primitives" step with bake marker v2; edited characters keep MToon outlines and expressions. | V1 | M6a ✓ | E2E-MOD-12, -30, -31. |
| FR-MOD-30 | Static GLB export (author writer) with the `ekza/omoba-handheld-v1` profile, `mesh.*`/`ekza.*` lints and the `ekza_model_v1` provenance block. | V1 | M6a ✓ | E2E-MOD-13; AS-LP-B. |
| FR-MOD-31 | *Withdrawn 2026-10-19: split into FR-JNT-01…10 (M6b).* | — | — | — |
| FR-MOD-32 | *Withdrawn 2026-10-19: now FR-SKIN-01.* | — | — | — |
| FR-MOD-33 | *Withdrawn 2026-10-19: split into FR-SKIN-02…06 and FR-JNT-08.* | — | — | — |
| FR-MOD-34 | *Withdrawn 2026-10-19: now FR-SKIN-07 and FR-SKIN-08.* | — | — | — |
| FR-MOD-35 | UV editor, seams → LSCM unwrap → packing, image textures, decals, ramp swatches. | LATER | M6c | E2E-UV-01…04. |
| FR-MOD-36 | AI 3D generation through a server gateway (Tripo, Meshy), post chain on the modeling operators, provenance in every export. | V2 | M7 | MODELING-PLAN §7.3. |

### FR-JNT — Skeletons, joints and the Rig & Skin workspace (M6b)

Added 2026-10-19 with [M6B-SPEC](M6B-SPEC.md) (research [17](research/17-maya-rigging-basics.md),
[19](research/19-rig-workspace-ui.md)); acceptance criteria name the M6b scenarios (`E2E-SKIN-NN`, `E2E-RIG-NN`) and gates.

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-JNT-01 | Rig & Skin workspace: four modes (Object, Skeleton, Skin, Shapes), pose view Bind/Test/Clip, Maya's Skeleton/Skin/Constrain/Control menus and marking menus, Rig Toolkit with a setup checklist, Validation panel as the export gate, selection undo; nothing in it creates a key. | V1 | M6b (partial: MVP — Object/Skeleton/Skin modes, Bind/Test views, the Skeleton and Skin menus, the `rig.modes` marking menu, Toolkit checklist, Validation gate, selection undo; Shapes mode, Clip view, Constrain/Control menus and the other marking menus after the MVP) | E2E-RIG-01, -02, -05, -08; `S` never keys in any Rig scope. |
| FR-JNT-02 | VRM humanoid templates Lite 17 / Core 21 / Standard 33 / Full 52 with rest flexion and a non-deforming `root`, pre-fitted on the generated body; Quick Rig (markers, One-Click guess, guides, projected centre) on T- and A-posed meshes. | V1 | M6b ✓ (MVP — four templates, Quick Rig v2 with the One-Click guess; the A-pose path — fit and bind in the A-pose, *Straighten to T-Pose* — built by AUTORIG A0, E2E-AR-A0 and AS-AR-2) | Fitter within 0.03 H on Seed-san and T- and A-posed Polybot; the A-pose path ends `skel.tpose`-clean; E2E-SKIN-01. |
| FR-JNT-03 | Joint tool (Snap to Projected Center, X symmetry, automatic parent, MMB/`Insert` reposition, `Backspace`, `Enter`/RMB one undo step, `Esc` no step), Insert Joint, Split Bone, Add Chain, Duplicate Joints; user-authored chains get visible controls. | V1 | M6b (after the MVP) | E2E-RIG-03, E2E-SKIN-09. |
| FR-JNT-04 | Hierarchy editing: Remove Joints (splice), Delete (subtree), Parent/Unparent, rename with mirror rename (control ids kept), Map Humanoid Bone, Set Side, joint roles (deforming, helper, prop) and sockets; required-bone refusals; weights fold into the nearest surviving deforming ancestor; edits never move unselected joints. | V1 | M6b (partial: MVP — rename with control ids kept, Map Humanoid Bone; Remove/Delete/Parent/Unparent/Set Side, roles and sockets after the MVP) | Properties P-J1, P-J6; E2E-SKIN-09, E2E-CNS-01. |
| FR-JNT-05 | Orient Joint (World / Maya / Blender presets, Maya's options, children, symmetry), with key conversion on bone-aligned controls; deformation and humanoid animation unchanged. | V1 | M6b ✓ (MVP) | Property P-J2 (1e-9); E2E-SKIN-09. |
| FR-JNT-06 | Mirror Joint across YZ (Orientation / Behavior, name swap, update existing counterparts in place). | V1 | M6b ✓ (MVP) | Involution P-J3; E2E-SKIN-09. |
| FR-JNT-07 | Joint display: X-ray joints, joint size, side colours, local axes, humanoid labels, missing-bone ghosts. | V1 | M6b ✓ (MVP) | E2E-RIG-03; joint overlay bench. |
| FR-JNT-08 | Rest edits with Move Skinned Joints semantics; rotating a bound joint or a control is a session test pose (never a key; IK limbs bend in FK for the test); Go to Bind Pose (the constraint-free rest); ROM test clip; Apply Pose as Rest keeping oriented chains' axes. | V1 | M6b (partial: MVP — Move Skinned Joints, test poses incl. IK → FK, Go to Bind Pose; Apply Pose as Rest ✓ by AUTORIG A0 (T-Stance, Skeleton › Apply Pose as Rest / Straighten to T-Pose); the ROM test clip after the MVP — Auto-Rig ④ previews a range-of-motion clip) | E2E-SKIN-04, -10, -14, E2E-RIG-01, -05; property P-J5. |
| FR-JNT-09 | Characters from own meshes (adoption of scene meshes, Import Static Model); the control rig regenerated inside every skeleton edit keeping control IDs, curves and user shape edits. | V1 | M6b ✓ (MVP) | E2E-SKIN-04; `skeletonFromDoc` ≡ `skeletonFromGltf` of the writer's output. |
| FR-JNT-10 | Attach Prop: prop joint, rigid bind, prop control and a parent constraint whose weights can be keyed. | V1 | M6b (after the MVP) | E2E-CNS-01; AS-LP-T part C2. |

### FR-SKIN — Binding, weights and character export (M6b)

Added 2026-10-19 with [M6B-SPEC](M6B-SPEC.md) (research [14](research/14-skinning-own-models.md),
[17](research/17-maya-rigging-basics.md)).

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-SKIN-01 | Bind Skin: Auto (low-poly) (rigid islands + bone heat), closest in hierarchy, rigid islands, heat, over deforming joints; joint and point masks; one joint = rigid attach; symmetrize; ≤ 4 normalized influences; worker; adjustable; Auto Weights for Selected Joints for joints added to a bound mesh. | V1 | M6b (partial: MVP — every method, masks, symmetrize, worker; Auto Weights for Selected Joints after the MVP) | Polybot within one joint on ≥ 98 % (exact ≥ 85 %); 10k points × 60 joints ≤ 1 s; deterministic across Node and Chromium; E2E-SKIN-01. |
| FR-SKIN-02 | Normalization contract with per-user holds on joints (Maya Hold / lock icons). | V1 | M6b ✓ (MVP) | Property P-S1. |
| FR-SKIN-03 | Paint Skin Weights: Replace/Add/Scale/Smooth, Flood, value/opacity, deterministic stroke rule, surface/volume, X-mirror stroke, sample, pick influence, painting on the posed mesh; one stroke = one undo step. | V1 | M6b ✓ (MVP) | E2E-SKIN-02, -10, E2E-RIG-04; ≤ 4 ms per pointer frame at 10k points. |
| FR-SKIN-04 | Weight display (greyscale, ramp, influence colours, numbers overlay, Lock-Relative) and the Component Editor weight table with a Hold row and averaged rows. | V1 | M6b (partial: MVP — greyscale, ramp and influence colours with the 0-byte switch; numbers overlay, Lock-Relative and the Component Editor after the MVP) | E2E-SKIN-11; switching the active influence uploads 0 bytes. |
| FR-SKIN-05 | Weight utilities: assign, rigid islands, Mirror / Copy (inpainting) / Smooth / Hammer Skin Weights, copy/paste vertex weights, Prune, Normalize, Remove Unused Influences, Move Weights. | V1 | M6b (partial: MVP — Mirror, Smooth, Prune, Normalize, Remove Unused Influences; inpainting Copy, Hammer, copy/paste and Move Weights after the MVP) | E2E-SKIN-03, -11; properties P-S3, P-S6. |
| FR-SKIN-06 | Weights follow every modeling edit; unweighted points after an edit are filled by inpainting with a review flag. | V1 | M6b (partial: MVP — weights follow M6a edits; unweighted points fixed by Bind Unweighted Points, inpainting after the MVP) | E2E-SKIN-12; property P-S8. |
| FR-SKIN-07 | VRM 1.0 and plain GLB character writer: VRM meta with licence presets, thumbnail, palette materials, `ekza_model_v1`, slot clips, props policy; OMOBA five-clip GLB; deterministic. | V1 | M6b (partial: MVP — VRM 1.0 for Space and OMOBA and a plain GLB through `local/generic`; props after the MVP; the OMOBA five-clip GLB is not offered for model characters, §0.4.6) | E2E-SKIN-05, -06; 0 glTF-Validator and `vrm-validator` errors; byte-identical re-export. |
| FR-SKIN-08 | Imported characters: weight edits exported through the surgeon (everything else byte-preserved); Make Character Editable with rebind at rest and the licence gate. | V1 | M6b (after the MVP) | E2E-SKIN-07, -13. |
| FR-SKIN-09 | Validation lints `skel.*`, `skin.*`, `rig.*`, `vrm.*` with severities per export profile; exporter-agnostic `ekza/space-avatar-v1`. | V1 | M6b ✓ (MVP) | E2E-RIG-08; the Export dialog blocks on profile errors. |

### FR-AR — Auto-Rig mode

Added 2026-10-22 with [AUTORIG-SPEC](AUTORIG-SPEC.md) §1.1 and [ADR 0021](adr/0021-autorig-mode.md); built in the
Auto-Rig milestone (A0, D0…D7). Acceptance: the AS-AR scripts (`apps/web/e2e/ar-as-*.spec.ts`).

| ID | Requirement | Pri | M | Acceptance criterion |
|---|---|---|---|---|
| FR-AR-01 | Choose on opening: the landing page offers Auto-Rig and Studio; the choice can be remembered and switched at any time. | V1 | AR ✓ | AS-AR-8 (E2E-AR-02). |
| FR-AR-02 | Mixamo-simple flow: model → markers → rig → animations → export, five steps, one primary button per step. | V1 | AR ✓ | AS-AR-1 (E2E-AR-08). |
| FR-AR-03 | Rig a static humanoid, T- or A-posed (GLB, or a model from Studio), with the M6b Quick Rig markers, One-Click guess, X symmetry and the front/side axis rule; skeleton detail on the markers step. | V1 | AR ✓ | AS-AR-1 steps 3–5, AS-AR-2 steps 1–3. |
| FR-AR-04 | Auto-rig in one click (Create Skeleton + Bind Skin, + Straighten for an A-posed input) with a progress display; the character moves at once. | V1 | AR ✓ | AS-AR-1 step 5 (`PREVIEW Walk` ≤ 300 ms after Checking), AS-AR-2 step 3. |
| FR-AR-05 | Fix when needed: adjust joints and paint weights with the M6b tools inside the wizard. | V1 | AR ✓ | E2E-AR-05, AS-AR-1 step 12 (moving the elbow back clears `skel.tpose`: the hands follow their forearms on *Done*, AR-D7-16). |
| FR-AR-06 | Animations grid: search, preview on the character, speed, trim, mirror, in place, arm space; several clips. | V1 | AR ✓ | AS-AR-1 steps 7–8, E2E-AR-06. |
| FR-AR-07 | Export an OMOBA- and Space-ready VRM 1.0 behind an in-browser checklist, a GLB with the clips, the clips as VRMA, an OMOBA local test kit. | V1 | AR ✓ | AS-AR-1 step 9, AS-AR-4, E2E-AR-07; OMOBA's validator admits the exports (admission only). |
| FR-AR-08 | One document: Open in Studio continues with the full document and, on the same page, its undo history; Studio can send its model to Auto-Rig. | V1 | AR ✓ | AS-AR-3, E2E-AR-01. |
| FR-AR-09 | An already rigged VRM goes straight to animations. | V1 | AR ✓ | AS-AR-4. |
| FR-AR-10 | `/autorig` loads less code than `/editor` (gated). | V1 | AR ✓ | `check:size`: `/autorig` 658,122 B ≤ 660,000 B (enforced), dockview never fetched (bench). |
| FR-AR-11 | Private: nothing leaves the browser; no telemetry. | V1 | AR ✓ | AS-AR-11 (every request same-origin, no POST). |
| FR-AR-12 | Same bytes as Studio: an Auto-Rig export equals Studio's export of the same document. | V1 | AR ✓ | AS-AR-1 step 10, AS-AR-2 step 6, AS-AR-4 (SHA-256). |
| FR-AR-13 | A-posed models become T-pose VRMs: fitted and bound in their pose, the rest converted to the VRM T-pose, the `vrm.*` lints clean, admitted by OMOBA's validator. | V1 | AR ✓ | AS-AR-2 (E2E-AR-13): no `skel.tpose`, read-back directions within 5°, OMOBA exit 0. |

---

## 2. Non-functional requirements

| ID | Requirement | Pri | Acceptance criterion |
|---|---|---|---|
| NFR-01 | Performance budgets of [ARCHITECTURE §14](../ARCHITECTURE.md#14-performance-budgets). | MVP | Benchmarks recorded per release (report-only on CI); misses tracked (ROADMAP: M1's M-1…M-3 fixed in M2a ✓; M-4 open). |
| NFR-02 | Idle editor renders zero WebGL frames and zero canvas redraws. | MVP | E2E-00 frame counter. |
| NFR-03 | Browsers: Chrome/Edge stable (primary); Firefox and Safari 26+ smoke-tested from V1. | MVP | e2e on Chrome; V1 smoke on Firefox/WebKit. |
| NFR-04 | Desktop only; editing from 1024×640, designed for ≥ 1280×720; below 768 px wide review-only (V1). | MVP | Layout usable at 1280×720. |
| NFR-05 | Headless packages (anim-core, doc, rig, io main, editor-core) run in Node without DOM/WebGL. | MVP | Their tests run in Vitest's Node environment. |
| NFR-06 | Determinism: identical inputs give identical exports, snapshots and evaluation buffers. | MVP | Byte-identical re-export test. |
| NFR-07 | Accessibility: WCAG 2.2 AA contrast for text (4.5:1) and graphics (3:1), visible focus, 24 px hit targets, never colour alone; keyboard paths for chrome. | MVP | Tokens from research 09 §8.3 (pre-verified); focus-visible on all controls; automated token contrast check in CI is V1. |
| NFR-08 | Security: untrusted files parsed under budgets; no `eval`; no third-party CDN at runtime; no secrets in the client. | MVP | CSP-compatible build; network log shows only same-origin requests. |
| NFR-09 | Offline capable: the static build works without network after load. | V1 | Static build e2e smoke with network disabled after load (M1: manual QA). |
| NFR-10 | Licence hygiene: MIT + DCO; production dependency allow-list with reviewed exceptions; no LGPL `sharp`; fixtures with recorded licence and SHA-256; generated third-party notices. | MVP | `check:licenses`, `check:fixtures` and the `dco` job in CI. |
| NFR-11 | Quality gates: format, type-aware lint, typecheck, dependency layering, unit, browser and e2e tests in CI. | MVP | Required checks on `dev`. |
| NFR-12 | Storage resilience: the app works with `localStorage`/IndexedDB unavailable. | MVP | All storage access in try/catch (unit tests); e2e with storage blocked: E2E-M2A-20 (`storage=blocked`, M2a ✓). |
| NFR-13 | WebGL context loss recovers from the document. | MVP | Handlers implemented; forced `WEBGL_lose_context` e2e is V1 (M1: manual QA). |
| NFR-14 | Editor route JS ≤ 900 kB gzip (landing ≤ 100 kB). | V1 | size check in CI (`check:size`, 900,000 B, M2a ✓; 843,270 B at the M2a integration). |
| NFR-15 | UI strings centralized for i18n (English only in the MVP). | V1 | No inline user-facing strings outside the string table (lint). |
| NFR-16 | Documentation: every public API documented; one ADR per architectural decision; README status table current. | MVP | Review checklist. |
| NFR-17 | Collaboration readiness: per-user undo per merge unit, preview-then-commit drags, partitions with a lifecycle, async assets, shared scene clock, no U state in the document. | MVP | FR-COL-01…03, FR-TIME-11. |
| NFR-18 | Memory: one Seed-san character with 10 clips of 10 s stays under 1.5 GB tab memory (JS + GPU estimate). | V1 | Chrome task manager measurement recorded. |
