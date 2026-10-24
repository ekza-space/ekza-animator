# 01 · Desktop DCC animation toolset → Ekza Animator feature matrix

> Research note · 2026-10-17 · input for the architecture and the MVP plan.
> Scope: how a leading commercial desktop DCC ("the desktop DCC" below) does character animation
> (with a popular open-source DCC, a real-time motion-capture package ("the mocap package"),
> Cascadeur and common desktop-DCC plug-ins wherever they do something better), what Ekza Animator
> should copy and when, the default hotkey map to mirror, and the exact animation-curve math needed
> to match the desktop DCC's curve behaviour.
> Product names are used only to describe and compare features. Ekza Animator is not affiliated
> with the vendors of the tools described here.

---

## 0. TL;DR (decisions this note recommends)

1. **Copy the desktop DCC's interaction model, not its architecture.** Animators love it for its channel-centric
   keying, its Graph Editor and tangent types, its time and range sliders, its hotkeys and its
   NURBS-circle control-rig conventions. All of that can be rebuilt on top of a plain **document model**
   (clips → layers → curves → keys, rig = data) that changes only through **commands**. Its general
   dependency graph is not needed and would make undo and collaboration much harder.
2. **Use an AnimX-compatible curve engine.** One scalar curve per channel. Non-weighted tangents use
   Hermite segments; weighted tangents use cubic Bézier segments in (time, value) with the desktop
   DCC's monotonic-X correction. Tangent types: Auto (legacy) / Auto Ease / Auto Mix / Auto Custom / Spline /
   Clamped / Plateau / Linear / Flat / Stepped / Stepped Next / Fixed. Pre/post infinity modes are
   included. **Port AnimX** (an Apache-2.0 library whose stated goal is to calculate animation curve
   values exactly the way the desktop DCC does) to TypeScript and use the C++ original as a test oracle (§5).
3. **Rotations are authored as Euler curves and exported as quaternions.** Each control has its own
   rotate order, and an Euler filter runs on import and on bake. **Gotcha:** the rotate order `xyz` of
   common DCCs equals three.js `Euler.order = 'ZYX'` (§5.7).
4. **Rig: VRM humanoid → auto-generated FK circle controls in normalized bone space.** At rest every
   channel is 0, the same as a desktop-DCC offset ("zero") group. This makes mirror pose, pose sharing and
   retargeting across Ekza avatars almost free. Two-bone IK with a pole vector, plus IK/FK switching,
   comes in V1.
5. **MVP = make and export a looping humanoid clip.** Contents: a two-pane viewport (locked shot
   camera plus free perspective), outliner, channel box, time and range sliders, `S` /
   `Shift+W/E/R` keying, auto-key, a Graph Editor with tangent types and pen-like handle editing
   (including weighted tangents), infinity cycles with cycle-aware auto tangents, copy/paste of
   keys and poses, undo, and bake to GLB (embedded) / animation-only GLB / VRMA.
6. **Collaboration-ready from day one, collaboration UI later.** Every feature in the matrix is tagged
   with a **state scope** (document / user-session / preference) so a later CRDT layer only syncs
   document state (§1, §3.13).

---

## 1. Legend

### 1.1 Priorities

| Tag | Meaning | Exit criterion |
|---|---|---|
| **MVP** | First runnable version (owner and a few testers, single user, Chrome/Edge/Firefox desktop) | A tester can load a CC0 VRM, animate a 1–2 s loop (idle, wave) with controls and the Graph Editor, and export it so that `@ekza/avatar-renderer` and three.js play it correctly |
| **V1** | First public open-source release | Daily-driver quality for game clips: IK/FK, mirror, tween, dope sheet, onion skin, trails, playblast, audio, key reduction, marking menus, hotkey editor |
| **V2** | Power features | Animation layers, non-linear clips, editable trails, space switching, generic constraints, pose library, tear-off windows, live co-animation |
| **LATER** | Research or large scope | Full-body IK / auto-posing, physics, AI in-betweening, mocap cleanup suite, set-driven keys, modeling |

### 1.2 State scope (column "Sc")

| Tag | What | Sync / undo |
|---|---|---|
| **D** | Document: clips, curves, keys, rig definitions, bookmarks, scene cameras | Persisted, undoable, synced in collaboration (CRDT) |
| **U** | User session: selection, current time, active tool, view cameras, buffer curves, graph view range | Not in the document. Shared only as *presence/awareness* (e.g. "Alice is on frame 12, has the left hand selected") |
| **P** | Preference: hotkeys, colours, default tangents, playback options | Local per user (later synced to the user's account) |

---

## 2. Reference tools: who is best at what

| Tool | Best-in-class at | Borrow | Do not copy |
|---|---|---|---|
| **Desktop DCC** (2025–2027 releases) | Graph Editor and tangent model, Channel Box, time/range slider, hotkeys and marking menus, control-rig conventions (NURBS circles, offset groups, constraints, IK handles, pole vectors), animation layers, Ghosting Editor, editable motion trails, Time Slider bookmarks. Dope Sheet rework with ripple edit in 2025 | Interaction model, curve math, hotkey preset, rig conventions, colour conventions | Dependency-graph-as-UI, character sets, Trax, MEL-era menu sprawl, independent-Euler-only rotations |
| **Open-source DCC** (4.4+/5.x) | Handle editing UX (drag any handle, `V` handle-type menu), Auto-Clamped handles and *Continuous Acceleration* smoothing, cycle-aware keying (auto handles that understand loops), non-destructive F-curve modifiers, easing presets, pose library as assets with drag-blending, slotted actions (one action animates several data-blocks, 4.4) | Cycle-aware tangents, handle UX details, pose-asset concept, multi-target clips | Mode-heavy UI and its non-standard hotkeys as the default |
| **Mocap package** | Full-body IK manipulation with **pinning** (translate/rotate) of effectors; keying modes Full Body / Body Part / Selection; real-time mocap; Story (non-linear) | Keying modes, effector pinning for the future full-body IK | Monolithic UI |
| **Cascadeur** (2025.x) | AutoPosing (pose the whole body from a few points), AutoPhysics (physically correct version of keyframe animation), ballistic trajectories, AI Inbetweening (2025.1+, up to 120 frames in 2025.2) | Ideas for LATER (assisted posing, physics check, centre-of-mass display) | Closed, physics-first workflow as the default |
| **MotionMaker** in the desktop DCC (2026.1+; custom training in 2027.2) | Generative locomotion from start/end pose or a path | Signals where AI-assisted blocking is heading → LATER | Nothing in scope |
| **Desktop-DCC plug-ins**: tweenMachine (archived), animBot (commercial), Studio Library (LGPL-3.0) | In-between slider, blend-to-neighbour/default, nudge, pose library with mirror tables, selection sets | The *features* (implemented from scratch) | Code: LGPL and unknown licences. Clean-room only |

---

## 3. Feature matrix

Columns: **What** = what the feature does (the desktop DCC unless noted) · **Why** = why animators value it ·
**P** = priority · **Sc** = state scope · **Web notes** = implementation hints for three.js/R3F/React.

### 3.1 Viewports and cameras

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| VP-01 | Panel layouts | Single pane, two panes side-by-side or stacked, three/four panes, saved layouts (e.g. "Persp/Graph") via *Panels > Layouts / Saved Layouts* | Seeing the shot camera and a working camera at once is the core blocking workflow | MVP: single, 2-pane side-by-side, Persp/Graph stacked. V1: 4-view, user-saved layouts | P | One R3F `<Canvas>` + drei `<View>` per pane (scissor rendering, shared scene and GPU resources). Docking via a layout library (e.g. dockview, MIT, JSON save/restore) |
| VP-02 | Space-tap maximise | Tapping **Space** toggles the pane under the cursor between maximised and multi-pane. Holding Space opens the hotbox | Fast focus without losing the layout | MVP | U | Distinguish tap from hold (<200 ms). Holding Space opens the command palette (MN-11) |
| VP-03 | Look through selected camera / per-pane camera | *Panels > Look Through Selected*. Any pane can show any camera | The owner's split screen: "one camera fixed, the other free" | MVP | D (cameras), U (pane→camera binding) | Scene cameras are document objects. The per-pane binding is user state |
| VP-04 | Camera lock | Lock a camera's transform so tumbling cannot move it | Prevents accidentally ruining the shot framing | MVP | D | A flag on the camera object. The navigation controller ignores locked cameras |
| VP-05 | Alt+drag navigation | `Alt+LMB` tumble, `Alt+MMB` track, `Alt+RMB` dolly, `F` frame selected, `A` frame all, `Shift+F`/`Shift+A` in all views | Muscle memory | MVP. V1: alternative presets (open-source-DCC MMB, trackpad) | P | Custom controller (not OrbitControls defaults). `pointerdown` with `preventDefault` on MMB stops browser autoscroll. Suppress `contextmenu` on the canvas |
| VP-06 | View undo and camera bookmarks | `[` / `]` undo/redo view changes. *View > Bookmarks* stores camera poses | Return to a good angle instantly | V1 | U (view undo), D (bookmarks) | View changes **never** enter the document undo stack |
| VP-07 | Orthographic views | Front/side/top cameras | Silhouette and arc checks, foot placement | V1 | U | `OrthographicCamera` per pane. Zoom by frustum size |
| VP-08 | Tear-off panels | *Tear Off* / *Tear Off Copy* moves or copies a panel into its own window | Dual-monitor setups (graph editor on the second screen) | V2 | P | dockview popout windows. A viewport in a popout needs a second WebGL context, so start with non-3D panels (Graph Editor, Outliner) |
| VP-09 | Isolate select, hide/show | Show only the selection in a panel. `Ctrl+H` hide, `Shift+H` show, `Alt+H` hide unselected | Focus on one character in crowded scenes | V1 | U | Per-pane three.js layers mask |
| VP-10 | Display filters and modes | Show/hide meshes, joints, controls, cameras, grid. `4`/`5`/`6` wireframe/shaded/textured. X-ray joints | Controls must remain clickable through the mesh | MVP: filters + X-ray controls. V1: shading modes | P/U | Controls render in an overlay pass (`depthTest:false`, or a separate scene rendered after the main one) |
| VP-11 | HUD | Camera name, current frame, fps, selection count | Orientation in split screen; shows in playblasts | MVP | U | DOM overlay per `<View>` |
| VP-12 | Resolution/safe gate | Shows the render aspect frame on the shot camera | Composing for 16:9 or 9:16 game captures | V1 | D | Overlay rectangle plus camera filmOffset |
| VP-13 | Camera animation | Keyable shot camera | Cinematic clips, trailers | V2 | D | The camera becomes a rig with channels and reuses the curve engine |

### 3.2 Time Slider, Range Slider, playback, sound

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| TS-01 | Time Slider with key ticks | Red ticks for keys of the selected objects, **green** for breakdowns. Selected keys are white on blue | Shows timing at a glance | MVP | U | Canvas2D strip. Ticks are the union of key times over the selection's curves (cached per selection) |
| TS-02 | Scrubbing | Drag the current-time indicator. **`K`+drag** in any viewport scrubs (virtual time slider). By default only the active view updates while scrubbing | Feeling timing is the animator's main loop | MVP: drag. V1: `K`-scrub | U | Evaluate synchronously per pointer move. Throttle audio scrubbing |
| TS-03 | MMB-drag on the Time Slider | Changes time **without** re-evaluating the pose, so the current pose can be keyed at the new frame | Classic "carry this pose to frame N" trick | V1 | U | Set the time without running the evaluator, mark the scene "dirty-held" and let the next `S` key the held values |
| TS-04 | Range select on the slider | `Shift+drag` selects a time range. Drag the middle to move keys, the arrows to scale. RMB menu: cut/copy/paste/delete/tangents/snap | Retiming whole poses without opening an editor | MVP: delete and copy/paste at the current frame. V1: range move/scale/ripple | U (selection), D (edits) | Uses the same key-selection model as the Graph Editor and Dope Sheet |
| TS-05 | Range Slider | Outer animation start/end and inner playback min/max. Zoom the time slider to a section | Work on 10 frames of a 300-frame shot | MVP | D (anim range), U (playback range) | Clip length lives in the document. The playback window is user state |
| TS-06 | Playback options | Play forward/back, loop / once / oscillate, real-time vs every frame, playback speed, play every N frames. `Alt+V` play, `Esc` stop | Real-time is needed for judging timing; every-frame is needed for debugging | MVP: real-time, loop, every frame. V1: the rest | P | `requestAnimationFrame` driver with a frame-accurate clock. Real-time mode drops frames, every-frame mode does not |
| TS-07 | Frame rate (time unit) | The desktop DCC defaults to 24 fps (film). Changeable in preferences | Games want 30/60, film wants 24 | MVP: 24/25/30/48/50/60 and custom | D | Store time in **frames (float64)** with doc-level fps. Export converts to seconds. The desktop DCC internally uses 141,120,000 ticks/s (divisible by all common rates), which is optional for us |
| TS-08 | Current-frame field and snapping | Numeric field. Keys snap to whole frames by default | Avoids sub-frame keys that break game export | MVP | U / P | Snap on key creation and move. Allow sub-frame only with a modifier |
| TS-09 | Time Slider bookmarks | Coloured named ranges on top of the slider (`Alt+T`). Ctrl-drag moves or scales them (desktop DCC 2020+) | Mark phases; **for Ekza, also mark "idle / wave / jump" ranges and export each as a named clip** | V1 | D | Bookmark = `{name, color, start, end, exportAsClip?}` |
| TS-10 | Audio | Import audio, show the waveform on the Time Slider, scrub it, offset it | Lip-sync, dance, rhythm | V1 | D (audio asset + offset), P (volume) | Web Audio `decodeAudioData`. Precomputed min/max peaks per pixel. Scrub with short `AudioBufferSourceNode` grains |
| TS-11 | Cached playback | The desktop DCC caches evaluated frames and shows the cache state on the slider | Needed for heavy rigs in the desktop DCC | LATER | – | Our rigs are light. Revisit only if spring bones or full-body IK need it |
| TS-12 | Annotations (Blue Pencil, desktop DCC 2023+) | Per-frame 2D drawings over the viewport, shown as blue blocks on the slider | Directors' notes and arcs sketched over the shot | V2 | D | SVG/Canvas overlay keyed by frame and camera |

### 3.3 Channel Box, Attribute Editor, Outliner

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| CB-01 | Channel Box | Lists keyable channels of the selection (`translateX..scaleZ` plus custom: IK/FK, space, expression weights). Editing a field applies to **all selected** objects | The fastest precise edit and key surface in the desktop DCC | MVP | D | Virtualised list. Channel ids follow the desktop-DCC convention (`tx ty tz rx ry rz sx sy sz` + custom) |
| CB-02 | Channel colour coding | Keyed on this frame = red, keyed elsewhere = dark pink, changed but not keyed = light pink, locked = grey, non-keyable = light grey, muted = brown, blended = green, constrained = blue, connected = yellow, expression = purple | Shows "is this keyed? will my change be lost?" without opening the Graph Editor | MVP: keyed / keyed-elsewhere / changed / locked. V1: muted, constrained/IK-driven, layer-overridden | U (derived) | Derived from curves at the current time. "Changed" = evaluated ≠ held value |
| CB-03 | Virtual slider | Select channel names, then **MMB-drag in the viewport** to scrub the value (modifiers change the speed) | Precise, tactile, hands stay on the mouse | V1 | D | Pointer-lock API for unbounded dragging |
| CB-04 | Channel context menu | Key selected, breakdown selected, mute, lock, reset to default, break connections, select in Graph Editor | Fine-grained keying ("key only rotateY") | MVP: key selected, reset. V1: rest | D | Commands |
| CB-05 | Field math | Relative input (`+=10`, `*=2`), drag over multiple fields | Fast offsets on many controls | V1 | D | Parse in the field component |
| CB-06 | Attribute Editor / Properties | All attributes of the active object (rotate order, limits, control shape, IK settings, curve infinity, clip metadata) | Setup that is not animation | MVP: rotate order, clip settings. V1: full | D | Schema-driven forms from rig/clip types |
| CB-07 | Outliner | Scene tree: characters → controls / bones / meshes, cameras, clips. Filters ("controls only"), search, rename, visibility | Select hard-to-click things and understand the rig | MVP | D (names, visibility), U (expansion) | Virtualised tree. Selection syncs with the viewport and Graph Editor |
| CB-08 | Pick-walk | Arrow keys walk to parent/child/sibling in the hierarchy | Step down a finger chain without clicking | V1 | U | Walk the **control** hierarchy, not the raw bones |
| CB-09 | Node editor / Hypergraph | Visual node graph | Riggers use it, animators rarely do | LATER | – | A rig-graph view only if a rigging mode appears |

### 3.4 Keying

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| KY-01 | Set Key `S` | Keys the keyable channels of selected objects at the current time | The fundamental action | MVP | D | One command. The undo entry is the key set. A preference chooses "all keyable" or "only changed" |
| KY-02 | `Shift+W` / `Shift+E` / `Shift+R` | Key only translate / rotate / scale | Avoid polluting curves with unneeded keys | MVP | D | Same command with a channel mask |
| KY-03 | Key selected channels | Key only the channels selected in the Channel Box | Surgical keys | MVP | D | – |
| KY-04 | Auto Key | When on, editing a value keys it. The desktop DCC keys only attributes that **already have** at least one key (`autoKeyframe`) | Fast posing in the layout and polish passes | MVP (desktop-DCC rule, plus a preference "auto key un-keyed channels too") | P (toggle), D (keys) | A visible red time-slider border while on (desktop-DCC convention) |
| KY-05 | Breakdown keys | Keys that keep a **proportional time position** between the surrounding keys when those move. Green ticks/points | Pose-to-pose retiming keeps in-betweens in proportion | V1 | D | `key.breakdown = true`. When neighbour keys move, recompute `t = t_prev + r·(t_next − t_prev)` with stored ratio `r` |
| KY-06 | Delete / cut / copy / paste keys | Clipboard of keys with paste modes (insert, replace, merge, at current time) | Reusing timing and holds | MVP: copy/paste/delete at current time and selection. V1: paste options | D, U (clipboard) | Clipboard JSON with relative times. Also write to the system clipboard so keys can be pasted between browser tabs |
| KY-07 | Default tangents | Default in/out tangent type and weighted default for new keys (desktop DCC 2025: Auto) | Blocking vs spline workflows | MVP | P | Blocking preset = Stepped. Spline preset = Auto |
| KY-08 | Key hold | Duplicate the previous key's value at the current time | Holds and "moving holds" | V1 | D | – |
| KY-09 | Keying modes (mocap package) | Full Body / Body Part / Selection: what `S` keys | Keeps the body consistent when posing with IK | V1 (Body Part via VRM groups: arm, leg, spine, head, fingers) | P | Uses the humanoid bone groups |
| KY-10 | Key types (open-source DCC) | Labels per key (keyframe, breakdown, extreme, jitter, moving hold) with colours | Communicates intent in reviews | V2 | D | `key.kind` enum, visual only |

### 3.5 Graph Editor

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| GE-01 | Layout and channel list | Left: outliner of animated channels (auto-load selected). Right: curve view | Pick which curves to look at | MVP | U | Same tree component as the Outliner, filtered to channels |
| GE-02 | Curve colours | X = red, Y = green, Z = blue for translate/rotate/scale. Other channels use a palette. Selected curves are highlighted, unselected dimmed | Read three axes instantly | MVP | P | Matches the open-source DCC's "XYZ to RGB" too |
| GE-03 | Navigation | `Alt+MMB` pan, `Alt+RMB` zoom (with axis-constrained zoom), `F` frame selected keys/curves, `A` frame all, auto-frame option | Constant zooming between macro timing and micro value | MVP | U | View transform `(t,v) → (px,py)` with independent scales |
| GE-04 | Key and tangent selection | Click / marquee select keys **and** in/out handles separately. `Shift` toggles, `Ctrl` deselects | Editing the shape between keys | MVP | U | Hit-test buckets per curve. Handles are selectable only on selected keys (desktop DCC) or always (open-source DCC). Make this a preference, defaulting to the desktop-DCC behaviour |
| GE-05 | Move keys | `W` move tool. MMB/LMB drag. **Shift-drag locks to time or value** after the first few pixels of motion. Snap to whole frames. Nudge with keys | Retiming and value tweaks | MVP: move + axis lock + snap. V1: nudge (`Alt+Shift+←/→` style) | D | One undo entry per drag. Live preview through a transient command |
| GE-06 | Scale keys and region/lattice | Scale selected keys in time or value around a pivot. Region tool (box handles), lattice deform | Speeding up or slowing a section, exaggeration | V1 | D | Box-manipulator overlay |
| GE-07 | Insert key on curve | `I`+MMB inserts a key on the curve **keeping its shape**. `S` in the Graph Editor keys the selected curves at the current time | Add control without changing motion | MVP: key at current time. V1: `I`-tool anywhere | D | Shape-preserving insertion = exact cubic split (de Casteljau for Bézier, value+slope for Hermite) |
| GE-08 | Tangent types | Auto, Auto Ease, Auto Mix, Auto Custom (desktop DCC 2022+), Spline, Clamped, Linear, Flat, Stepped, Stepped Next, Plateau, Fixed. Set both sides or only In/Out | "Soften / harden" a motion in one click: the owner's explicit ask | MVP (menu + toolbar buttons). V1: `Shift+S` marking menu | D | Math in §5.4 |
| GE-09 | Break / Unify tangents | Broken: in and out handles move independently. Unify rejoins them | Sharp contacts (bounces, hits) vs smooth flow | MVP | D | `key.broken`. While unified, dragging one handle rotates the other to stay collinear (each keeps its own weight) |
| GE-10 | Weighted tangents | Curve-level toggle. Weighted handles change angle **and length**. *Lock / Free Tangent Weight* limits edits to angle only or allows both | Asymmetric ease-in/out, the "pen tool" feel | MVP (engine + toggle + free/lock) | D | Weighted = Bézier with root solve (§5.3) |
| GE-11 | Pen-like handle drag | Drag a handle. Non-weighted handles are drawn at fixed screen length (angle only). Weighted handles are drawn at true length | Direct manipulation of acceleration | MVP | D | Draw curves with `ctx.bezierCurveTo`. The rendering is exact because both segment types are cubic Béziers in (t, v) (§5.2) |
| GE-12 | Numeric key fields | Frame, value, in/out angle, in/out weight of the selected key(s) | Exact values, typing tangents flat | MVP | D | Multi-edit with "mixed" display |
| GE-13 | Pre/Post infinity | Constant (default), Linear, Cycle, Cycle with Offset, Oscillate. Infinity drawn dotted | **Game loops** (idle/walk), walk cycles moving forward (cycle with offset) | MVP (engine, menu, display) | D | Formulas in §5.6 |
| GE-14 | Cycle-aware tangents/keying (open-source DCC) | With cyclic extrapolation, auto handles at the first/last key use the wrapped neighbours (seamless loop). Cycle-aware keying remaps keys into the cycle and keeps endpoints equal | Seamless game loops without manual tangent matching | MVP (cyclic auto tangents). V1 (cycle-aware keying) | D | §5.4.4 |
| GE-15 | Buffer curves | *Buffer Curve Snapshot* stores a grey copy of the curve. *Swap Buffer Curve* toggles between them | Compare before/after a polish edit, revert a part | V1 | U | Per-user, never synced. Rendered as ghost polyline |
| GE-16 | Normalized / Stacked / Absolute views | Normalized scales each curve to −1..1 for display. Stacked gives each curve its own lane | Compare timing of channels with different ranges (rotation in degrees vs translation in metres) | V1 | U | Display transform only, never changes data |
| GE-17 | Euler filter | Removes Euler flips (±360° jumps, gimbal-equivalent solutions) | Mandatory after importing quaternion clips or baking IK | MVP (auto on import/bake, plus a menu item) | D | §5.7 |
| GE-18 | Simplify / Key Reducer / Resample | Remove keys that are not needed for the curve's shape (Classic and Dense-data methods), or place keys at uniform intervals | Imported baked/mocap clips have a key every frame and cannot be edited by hand | V1 | D | Error-bounded reduction: greedy removal with Hermite refit; tolerance in value units |
| GE-19 | Smoothing filters | Smooth (Butterworth), Smooth (Gaussian), Peak Removal, Key Sync (`filterCurve` types) | Mocap and noise cleanup | V2 | D | Butterworth requires uniform sampling, so resample first |
| GE-20 | Isolate / Pin / Lock / Mute channel | Show only selected curves. Keep a curve visible regardless of selection. Freeze edits. Mute playback of a channel | Focus and safe editing | V1 | U (isolate/pin), D (lock/mute) | Mute = evaluator uses the rest value |
| GE-21 | Retime tool | Place markers on the graph and drag them to retime everything between | Timing passes on dense animation | V2 | D | Piecewise-linear time warp applied to key times |
| GE-22 | Show results / evaluated curves | Shows the evaluated value of driven channels (IK, constraints, layers) as a non-editable curve | Debug pops coming from IK or layers | V2 | U | Sample the evaluator per pixel column |
| GE-23 | Rotation interpolation | Independent Euler (default), Synchronized Euler, Quaternion Slerp / Cubic / Tangent-dependent (*Change Rotation Interp*) | Avoid flips on big rotations | V2 (quaternion slerp option) | D | AnimX has quaternion paths. For us: Euler default |
| GE-24 | F-curve modifiers (open-source DCC) | Non-destructive Noise, Cycles, Envelope, Stepped on a curve | Procedural shake/idle noise for games | V2 (Noise), LATER (rest) | D | Modifier stack evaluated after the keys |
| GE-25 | Easing presets (open-source DCC) | Sine/Quad/Cubic/…/Back/Bounce/Elastic interpolation per segment | Motion-design style, rarely character work | LATER | D | Extra `SpanInterpolation` kinds |
| GE-26 | Spreadsheet | Table of key times/values | Data-heavy edits | LATER | D | – |

### 3.6 Dope Sheet

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| DS-01 | Dope Sheet | Rows per object/channel with a summary row. Select, move, scale and delete keys in time only. Desktop DCC 2025: ripple edit, key colours, custom channel sets | Timing passes without curve clutter | V1 (rows, summary, move/scale, ripple) | D | Shares the key-selection model and commands with the Graph Editor and Time Slider |
| DS-02 | Grouping by body part | Rows grouped as character → limb → control | Retime an arm without touching legs | V1 | U | Groups come from the humanoid map |
| DS-03 | Custom channel sets, key colour palette | Saved row subsets and per-key colours (2025) | Large scenes | V2 | D/P | – |

### 3.7 Clips, layers, non-linear editing

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| NL-01 | Multiple named clips per character | Actions in the open-source DCC. glTF `animations[]`. Create, rename, duplicate, delete, switch the active clip | An avatar needs idle/walk/wave/emotes | MVP | D | `Character.clips[]`. Export all or selected |
| NL-02 | Animation layers | Base layer + Additive/Override layers with keyable **weight**, mute/solo/lock, passthrough. Rotation accumulation per component (Euler add) or per layer (quaternion). Merge/bake down | Variations on top of a library or mocap clip without destroying it | V2 (**MVP document model must already be `clip.layers[]` with one base layer**) | D | Evaluator: `value = blend(layers)`. Override uses slerp for rotations |
| NL-03 | Time Editor / Trax / NLA | Clips as instances on tracks: retime, loop, blend, relative vs absolute | Assemble idle → wave → idle, reuse cycles | V2 | D | Clip instance = `{clipId, start, scale, loops, blendIn/Out}` |
| NL-04 | Library clip import onto the rig | Bring a clip (e.g. the CC0 shared humanoid clips used by `ekza-avatar-renderer`) onto the current avatar as editable curves | Start from a decent walk instead of from zero | V1 | D | Humanoid retarget in normalized space, then Euler conversion + filter + reduction |
| NL-05 | Multi-character clips (open-source-DCC slotted actions) | One clip that animates several characters | Two-character interactions (handshake, fight) for the collaboration scenario | V2 | D | Clip owns `tracks[]` keyed by `characterId` |

### 3.8 Visualization and review

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| VIS-01 | Ghosting / onion skin | Ghosting Editor (2022+): ghosts before/after, by frame step (1s, 2s, 4s, 5s, 10s, custom) or at keys. Colour/opacity, hierarchy include | Spacing and arcs, overlap | V1 | U | Snapshot skinned meshes into frozen-matrix clones (limit ~3–6), or cheaper bone/silhouette ghosts. Recompute on edit, not every frame |
| VIS-02 | Motion trail (display) | World-space path of a bone/control with frame beads and key markers | Arcs are the first thing animation leads check | V1 | U | Sample the evaluator over the range (cached, invalidated by edits to upstream channels) and draw `Line2` |
| VIS-03 | Editable motion trail | Drag keys on the trail in the viewport (translate keys only; with layers, only the active layer) | Fix arcs directly where you see them | V2 | D | Needs IK/translate controls. Edits translate curves |
| VIS-04 | Playblast | Render the viewport (shot camera, HUD) to a movie/image sequence | Dailies, sharing WIPs, Ekza social posts | V1 | – | Deterministic frame stepping + WebCodecs `VideoEncoder` + an MP4/WebM muxer (e.g. Mediabunny). Not real-time `MediaRecorder` |
| VIS-05 | Centre of mass / arc tracker (Cascadeur) | Show CoM and its trajectory | Physical plausibility of jumps | V2 | U | CoM from mesh-weighted bone masses (approximate) |
| VIS-06 | VRM spring-bone preview | Simulate hair/cloth spring bones during playback | What the avatar will look like in Ekza Space | V1 | P | three-vrm spring bones are runtime-only. Not baked by default |
| VIS-07 | Control/joint display | Size, line width, X-ray, wire-on-shaded | Readability | MVP (basic) | P | – |

### 3.9 Posing productivity

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| PP-01 | Selection sets / quick select sets | Named sets, one click to select ("all fingers L") | Selection is half of animating | V1 | D | Sets reference control ids |
| PP-02 | Character scope | The desktop DCC's *character sets* define what gets keyed. We use the character itself as implicit scope: "key whole character" | Consistent full-body keys in blocking | MVP | – | No character-set UI |
| PP-03 | Picker | 2D body map with clickable control buttons (AnimSchool Picker / mGear-style) | Select fingers and face controls without hunting in 3D | V1 (auto-generated from the VRM humanoid map) | D (layout), U | SVG panel. Buttons mirror the control colours |
| PP-04 | Mirror / flip pose | Copy L→R / R→L or flip the whole pose. Mirror animation with a half-cycle offset for walks | Halves posing work. Symmetric walk cycles | V1 | D | Trivial in normalized humanoid space (§5.9) |
| PP-05 | Copy / paste pose | Copy the current values of selected controls and paste them at another frame or onto another character | Reuse key poses, poses across avatars | MVP | D, U (clipboard) | Paste maps by humanoid bone name, so it works across VRMs |
| PP-06 | Tween / in-between slider | tweenMachine: new key at the current frame biased between previous and next keys (−100..100, overshoot allowed). animBot: blend to neighbour/default, push/relax | Fast breakdowns. Favours (ease) without the Graph Editor | V1 | D | Formulas in §5.9 |
| PP-07 | Reset to rest | Zero the selected controls' channels | Start clean, fix broken poses | MVP | D | Zero = rest because of normalized controls |
| PP-08 | Pose library | Save poses and animation snippets with thumbnails, apply, **drag to blend** (Studio Library, open-source-DCC pose assets) | Hands, faces, signature poses reused across shots | V2 (later: shared through the Ekza registry) | D | Poses stored per humanoid bone, so they are cross-avatar |
| PP-09 | Add / Remove inbetween | Shift all later keys by ±1 frame (desktop-DCC keyframe marking menu) | Quick timing pushes | V1 | D | – |
| PP-10 | Reference image / video plane | Image or video in the viewport synced to time | Rotoscoping reference (common in games) | V2 | D | `VideoTexture` on a plane locked to a camera |
| PP-11 | Temp pivots, fake constraints (animBot) | Rotate around arbitrary temporary pivots. Stick a hand to an object temporarily | Advanced polish | LATER | U/D | – |

### 3.10 Manipulation and interaction

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| MN-01 | Transform tools | `Q` select, `W` move, `E` rotate, `R` scale, `T` show manipulator, `Y` last tool | Muscle memory | MVP | P/U | Custom gizmos. three.js `TransformControls` is a starting point but lacks gimbal mode and the view/free-rotate rings |
| MN-02 | Rotate axis modes | Object (default), World, Gimbal (one Euler channel at a time), Component, Custom. MMB on the button toggles the last two | Gimbal mode shows the *actual* Euler axes, so curves stay clean | MVP: Object, World, free/view ring. V1: Gimbal (rings from the rotate order) | P | Gimbal rings: outer = last axis of the rotate order, inner = first axis |
| MN-03 | Move modes | Object / World / Parent space | Translate hips/IK controls predictably | MVP: Object/World. V1: Parent | P | – |
| MN-04 | Manipulator size `+`/`-` | Scales the gizmo in screen space | Small fingers, big hips | MVP | P | – |
| MN-05 | Snapping | `J` (hold) rotation/move step snapping. `X` grid | Exact 90° poses, feet on the grid | V1 | P | – |
| MN-06 | Undo / redo | `Z` / `Ctrl+Z` undo, `Shift+Z` / `Ctrl+Y` redo, `G` repeat last | Safety | MVP | D | Command stack. One drag = one entry. With collaboration, per-user undo (only your own commands) |
| MN-07 | Hotkey presets and editor | Default DCC keymap (§4). Hotkey editor. Alternative keymap preset (open-source-DCC style) | Adoption by animators coming from common DCCs | MVP: `dcc` preset. V1: editor. V2: alternative preset (open-source-DCC style) | P | `KeyboardEvent.code` based. Panel-scoped bindings (hover focus, desktop-DCC convention) |
| MN-08 | Marking menus | Hold a key + drag to a radial menu: `W`/`E`+LMB (axis modes), `Shift+S`+LMB/MMB (keys/tangents, §4) | Gesture memory, very fast | V1 | P | Radial menu with flick-select (direction, not distance) |
| MN-09 | Hotbox | Space-hold full menu at the cursor | Fullscreen work without menus | LATER (use command palette instead) | – | – |
| MN-10 | Command palette | Searchable commands with their hotkeys (web-native hotbox) | Discoverability for new users | V1 | P | `Ctrl/Cmd+K`, plus Space-hold |
| MN-11 | Control picking priority | Clicks hit controls before meshes and bones. Hover highlight. Cycle through overlapping controls | The control rig must feel solid | MVP | U | Raycast the control layer first. GPU picking fallback for thin circles (line raycast threshold in screen px) |
| MN-12 | Pivot editing `D`/`Insert` | Move the pivot of a control | Rigging feature | V2 | D | Only in a "rig edit" mode |

### 3.11 Control rig

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| RIG-01 | Auto FK control rig | NURBS-circle control per bone, oriented to the bone's long axis and sized from bone length or mesh radius. Colour by side: **L = blue, R = red, centre = yellow** (rigging convention). Each control has an **offset (zero) transform = bone rest**, so all channels read 0 at rest. The control drives the bone (orient/parent constraint equivalent) | The owner's explicit ask ("circles around bones"). Animating controls instead of bones keeps channels clean and standard across avatars | MVP: all bones of any skinned GLB/VRM. VRM humanoid gets curated shapes and colours | D (rig def), P (display) | Control world matrix = parentControl · offset · TRS(channels). Bone local = rest ∘ delta (§5.8) |
| RIG-02 | Control shapes and editing | Circle, square, box, sphere, arrow, cog (COG), world/root. Edit size/orientation/colour, choose per bone, hide | Readability. A unique silhouette per body part | V1 | D | Shapes are polylines (unit size) scaled by the control |
| RIG-03 | COG/hips and root | Hips control with translate. Optional **root/world** control for placement and root motion | Locomotion and placement. Game root-motion export | MVP: hips translate. V1: root + in-place/root-motion export | D | VRM: hips is the top humanoid bone. Root is the character transform |
| RIG-04 | Two-bone IK limbs | IK handle control (hand/foot) + pole-vector control + twist. Like the desktop DCC's `ikRPsolver`. Stretch off by default | Planted feet and hands on props. Arcs from the hand, not the shoulder | V1 (soft-IK in V2) | D | Analytic two-bone solve (§5.10) |
| RIG-05 | IK/FK blend and switch | Keyable `ikFk` 0..1 attribute. **Match** FK→IK and IK→FK at the current frame so switching does not pop | Animate arm swings in FK and contacts in IK in the same shot | V1 | D | Matching = solve one side from the other's world pose, then key both |
| RIG-06 | Reverse foot / foot roll | Heel/ball/toe pivots, roll attribute | Walk cycles with proper foot contacts | V2 | D | Extra pivot controls in the IK chain |
| RIG-07 | Space switching | Enum attribute: hand follows world / chest / head / hips. Matching on switch | Hand on the hip, then on a cup, without counter-animation | V2 | D | Parent-constraint weights driven by the enum. Match via world-pose preservation |
| RIG-08 | Constraints | Parent, point, orient, aim, scale (+ maintain offset, keyable weights). Pole vector for IK | Props in hands, eyes looking at targets, prop hand-offs | V2 (parent + aim first) | D | Constraint nodes in a fixed evaluation order after FK |
| RIG-09 | Full-body IK | Full-body IK effectors with pinning (mocap package / desktop DCC). Cascadeur AutoPosing | Pose a body from hands/feet/hips | LATER | D | Candidate: FABRIK/CCD hybrid with humanoid priors. Research item |
| RIG-10 | Attach control to any bone | User picks a bone (tail, ears, hair, props) and gets a control. "Constrain control to bone" | Non-humanoid parts of Ekza avatars | MVP (auto for all bones, toggle per bone). V1 (manual add/edit) | D | Same control type as RIG-01 |
| RIG-11 | Rig definition as data | JSON rig: controls, shapes, offsets, IK chains, attributes. Presets per standard (VRM humanoid) | Reuse across avatars. Share in the Ekza registry later | MVP (schema) | D | Versioned schema. Pure data → CRDT-friendly |
| RIG-12 | Bake rig to skeleton | The desktop DCC's *Bake Simulation*: evaluate everything per frame into bone keys | Export to glTF/VRMA (consumers know bones only) | MVP (FK). V1 (IK/constraints) | – | The export pipeline always bakes. Optional key reduction afterwards |
| RIG-13 | Facial / expression channels | VRM expressions (blink, aa/ih/ou/ee/oh, emotions) as keyable 0..1 channels on a face control. LookAt target | Emotes and lip-sync for avatars | V1 (expressions). V2 (lookAt) | D | Morph-weight curves. Export via VRMA expressions or glTF morph weights |
| RIG-14 | Set-driven keys / drivers | Attribute A drives attribute B through a curve | Rigging automation (finger curl) | LATER | D | – |

### 3.12 Animation-side interop (formats are covered in other research notes)

| ID | Feature | What | Why | P | Sc | Web notes |
|---|---|---|---|---|---|---|
| IO-01 | Import clips as editable curves | glTF/VRMA samplers → control curves. Quaternion → Euler (control rotate order) + Euler filter. Dense keys → reduction | Edit existing animations (owner's goal) | MVP (dense keys). V1 (reduction) | D | §5.7, GE-18 |
| IO-02 | Bake back into the file / export separately | Embedded clip in GLB, animation-only GLB, VRMA | Owner's goal | MVP | – | Re-evaluates the rig per frame (RIG-12) |
| IO-03 | Bake options | Range, fps/step, loop closure (last frame equals first), in-place vs root motion, curve output LINEAR vs CUBICSPLINE | Game engines differ | MVP: range + fps + LINEAR. V1: the rest | P | §5.11 |
| IO-04 | Export bookmarks as clips | Each Time Slider bookmark → named glTF animation | One timeline, many game clips | V1 | – | Needs TS-09 |
| IO-05 | Desktop-DCC `.anim` / `.atom` curve interop | Curves map 1:1 because the tangent model is the same | Import from studios | LATER | – | Tangent x in seconds, stored ×3 (§5.3) |

### 3.13 Collaboration hooks (feature-level requirements)

| ID | Feature | What | P | Notes |
|---|---|---|---|---|
| COL-01 | Command-sourced edits | Every D-scope mutation goes through a typed command (`SetKeys`, `MoveKeys`, `SetTangent`, `EditRig`, …) | MVP | The same commands feed undo now and a CRDT/transport later |
| COL-02 | Strict D/U/P separation | Selection, current time, buffer curves and view cameras are never written to the document | MVP | Otherwise two users fight over "current frame" |
| COL-03 | Presence | Remote users' selection highlighted on controls and keys. Their time cursor on the slider. Their camera frustum in the viewport | V2 | Awareness channel (e.g. Yjs awareness) |
| COL-04 | Soft locks ("four hands") | Claim controls or body parts. Others see a lock badge. Edits to claimed channels need confirmation | V2 | Good fit for one character animated by two people: one takes the arms, the other the legs |
| COL-05 | Per-user undo | Undo only your own commands | V2 | Yjs `UndoManager` with tracked origins |

### 3.14 Deliberately not copying (or deferring)

- **The desktop DCC's dependency graph as a user concept.** We use a fixed, typed evaluation pipeline instead:
  curves → layers → control TRS → constraints/IK → bones → skinning, plus later modules.
- **Character sets and Trax.** The character itself is the scope (PP-02). Non-linear clips come in V2 (NL-03).
- **MEL/Python.** A TypeScript plugin/command API comes LATER (it reuses COL-01 commands).
- **Cached playback / Evaluation Manager.** Not needed at our scale (one or a few humanoids). Profile first.
- **Hotbox.** The command palette replaces it (MN-10).

---

## 4. Hotkey map to mirror (desktop DCC defaults → Ekza "Classic" preset)

Sources: the desktop DCC's hotkey reference (the 2014 "All Hotkeys" table, unchanged in later versions
for these entries), 2016 "Animation Operations", 2025 "Playback Controls", 2025 "Keyframe Tangent Marking
Menu", 2024 Time Slider. A † marks a widely used desktop-DCC convention that this research did not
re-verify against a current official table.

### 4.1 Animation

| Action | Desktop DCC default | Ekza Classic | P |
|---|---|---|---|
| Set key (selected objects, all keyable) | `S` | `S` | MVP |
| Key translate / rotate / scale | `Shift+W` / `Shift+E` / `Shift+R` | same | MVP |
| Keyframe marking menu (viewport) | `Shift+S`+LMB | same | V1 |
| Tangent marking menu (viewport) | `Shift+S`+MMB | same | V1 |
| Keyframe/tangent marking menu (Graph Editor; left = keys, right = tangents) | `Shift+S` in the graph view | same | V1 |
| Insert keys tool (Graph Editor) | `I` (press and hold) + MMB | same | V1 |
| Set key on selected curves (Graph Editor focused) | `S` | same | MVP |
| Play / stop | `Alt+V` (`Option+V` on macOS) | same (Space stays reserved for the pane toggle) | MVP |
| Stop playback | `Esc` | same | MVP |
| Go to min frame | `Alt+Shift+V` | same + `Home` | MVP |
| Step back / forward one frame | `Alt+,` / `Alt+.` | same | MVP |
| Previous / next key | `,` / `.` | same | MVP |
| Virtual time slider (scrub in viewport) | `K` + drag | same | V1 |
| Add bookmark on selected range | `Alt+T` | same | V1 |

### 4.2 Tools, selection, view

| Action | Desktop DCC default | Ekza Classic | P |
|---|---|---|---|
| Select / Move / Rotate / Scale tool (+LMB-hold marking menu) | `Q` / `W` / `E` / `R` | same | MVP (menus V1) |
| Show manipulator / universal manipulator | `T` / `Ctrl+T` | `T` | V1 |
| Last non-QWER tool | `Y` | same | V1 |
| Manipulator size | `+` (`=`) / `-` | same | MVP |
| Move/rotate snapping (hold) | `J` | same | V1 |
| Snap to grid / point (hold) | `X` / `V` | same | V1 |
| Edit pivot | `D` (hold) / `Insert` | same (rig-edit mode only) | V2 |
| Tumble / track / dolly | `Alt`+LMB / MMB / RMB | same | MVP |
| Frame selected / all (active panel) | `F` / `A` | same | MVP |
| Frame selected / all in all views | `Shift+F` / `Shift+A` | same | V1 |
| Box zoom † | `Ctrl+Alt`+LMB drag | same | V1 |
| Toggle single/multi pane (tap) | `Space` | same | MVP |
| Hotbox (hold) | `Space` | command palette | V1 |
| Full-screen panels | `Ctrl+Space` | same | V1 |
| Undo / redo view change | `[` / `]` | same | V1 |
| Wireframe / shaded / textured | `4` / `5` / `6` | same | V1 |
| Hide selection / show / hide unselected | `Ctrl+H` / `Shift+H` / `Alt+H` | same | V1 |
| Pick-walk parent / child / siblings | `↑` / `↓` / `←` `→` | same | V1 |
| Switch Attribute Editor / Channel Box | `Ctrl+A` | same | V1 |

### 4.3 Edit

| Action | Desktop DCC default | Ekza Classic | P |
|---|---|---|---|
| Undo | `Z`, `Ctrl+Z` | same (`Cmd+Z` on macOS) | MVP |
| Redo | `Shift+Z` | same + `Ctrl+Y` / `Cmd+Shift+Z` | MVP |
| Repeat last command | `G` | same | V1 |
| Cut / copy / paste (keys in editors, pose in viewport) | `Ctrl+X/C/V` | same | MVP |
| Group / parent / unparent | `Ctrl+G` / `P` / `Shift+P` | rig-edit mode only | V2 |
| New / open / save scene | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | **`Ctrl+N` is browser-reserved** → menu only. `Ctrl+O`/`Ctrl+S` are interceptable | MVP |

### 4.4 Graph Editor navigation (desktop DCC conventions)

| Action | Desktop DCC | Ekza | P |
|---|---|---|---|
| Pan / zoom | `Alt+MMB` / `Alt+RMB` | same + wheel zoom (Ctrl+wheel = value axis, Shift+wheel = time axis) | MVP |
| Constrained move | `Shift`+drag (first motion decides the axis) | same | MVP |
| Frame selected / all | `F` / `A` | same | MVP |
| Move keys / scale keys | `W` / `R` † | same | MVP / V1 |
| Tangent types | menus + `Shift+S` marking menu | toolbar buttons + marking menu. Optional single-key bindings for Auto/Spline/Linear/Flat/Stepped (unbound by default) | MVP / V1 |

### 4.5 Browser constraints that shape the keymap

1. **Match on `KeyboardEvent.code`, not `key`.** On macOS `Option+V` produces `√` in `key`. Non-US layouts
   move punctuation (`,` `.` `[` `]`). Show labels from `navigator.keyboard.getLayoutMap()` where it is available.
2. **Reserved shortcuts.** `Ctrl/Cmd+N`, `Ctrl/Cmd+T`, `Ctrl/Cmd+W`, `Ctrl/Cmd+Shift+T/N/W` and `Cmd+Q`
   cannot be cancelled by pages (only Chromium's Keyboard Lock API in fullscreen can capture some of them).
   Never bind them.
3. **Mouse.** Prevent MMB autoscroll (`pointerdown` with `button===1` → `preventDefault`) and the canvas
   `contextmenu`. Use `setPointerCapture` for drags and Pointer Lock for virtual sliders. Linux window
   managers may grab `Alt`+drag (the desktop DCC has the same problem), so offer a modifier remap. Trackpad users
   need a preset without MMB.
4. **Hold-to-activate tools** (`K`, `I`, `J`, `D`, `Shift+S`): track keydown/keyup and reset on `blur`
   and `visibilitychange`, or keys will "stick".
5. **Panel-scoped bindings** (desktop-DCC convention): the panel under the pointer receives the key (e.g. `S` keys
   selected curves in the Graph Editor and selected objects in the viewport). Text inputs swallow hotkeys.

---

## 5. Curve engine: AnimX-compatible math

The primary reference is the **AnimX** library (Apache-2.0). It is a dependency-free C++ library
whose stated goal is to replicate the interpolation schemes of the desktop DCC and to calculate
animation curve values exactly the way the desktop DCC does. It covers segment
evaluation (Hermite, Bézier, Linear, Step, StepNext, plus the legacy Sine/Parabolic/Log), infinities,
quaternion rotation paths and **Auto / AutoMix / AutoEase tangent computation**. It does not include
Spline/Clamped/Plateau tangent computation; §5.4 marks those formulas as calibrated approximations.
The desktop DCC's C++ API (`MFnAnimCurve`) supplies the storage convention.

**Plan:** port AnimX to TypeScript (keeping its Apache-2.0 NOTICE/attribution) as `@ekza-studio/curves`
(pure functions, zero deps). Build the C++ AnimX as a small CLI and use it as a **golden-test oracle**
(random curves × all tangent/infinity types, max |Δ| < 1e-9). If a desktop-DCC licence is available,
add fixtures exported from it for Spline/Clamped/Plateau.

### 5.1 Data model

```ts
type TangentType =
  | 'auto' | 'autoEase' | 'autoMix' | 'autoCustom'   // computed from neighbours
  | 'spline' | 'clamped' | 'plateau'                 // computed from neighbours
  | 'linear' | 'flat' | 'step' | 'stepNext'          // computed / interpolation hints
  | 'fixed';                                         // user-edited, never recomputed

interface Handle { dt: number; dv: number }          // offset from the key in (frames, value units)

interface Key {
  t: number;            // frames (float64), snapped to integers by default
  v: number;            // value (radians internally for rotation, metres for translation)
  inType: TangentType;  outType: TangentType;
  hin: Handle;          // points backwards in time: dt <= 0
  hout: Handle;         // dt >= 0
  broken: boolean;      // in/out independent
  weightLocked: boolean;// weighted curves: dragging changes angle only
  breakdown?: { ratio: number };  // KY-05
  autoCustomC?: number; // Auto Custom coefficient c ∈ [-0.5, 1]
}

interface Curve {
  keys: Key[];              // sorted by t, unique t
  weighted: boolean;        // Bézier (true) or Hermite (false) segments
  pre: Infinity; post: Infinity;   // 'constant' | 'linear' | 'cycle' | 'cycleOffset' | 'oscillate'
}
```

Conversion to the desktop DCC's storage: it saves the out-tangent as the vector **3·(P2 − P1)** and the
in-tangent as **3·(P4 − P3)** (`MFnAnimCurve` docs), with x in **seconds**. So

```
dcc.outX = 3 · hout.dt / fps        dcc.outY = 3 · hout.dv
dcc.inX  = 3 · (−hin.dt) / fps      dcc.inY  = 3 · (−hin.dv)
dcc angle (radians) = atan(dcc.y / dcc.x)  (AnimX tangentAngle: x in seconds; ±90° when x = 0)
```

For **non-weighted** curves only the handle *direction* matters. AnimX normalises the vector
(`validateTangent`). The time length used for evaluation and drawing is always 1/3 of the segment.
For **weighted** curves the handle length matters (`dt` is clamped to ≥ 0 on the out side).

### 5.2 Segment selection

For a time `t` between key `k` (start) and `k+1` (end):

```
if k.outType == 'linear' and (k+1).inType == 'linear'   → LINEAR   v = lerp(v_k, v_k+1, (t − t_k)/Δ)
else if k.outType == 'step'                             → STEP     v = v_k
else if k.outType == 'stepNext'                         → STEPNEXT v = v_k+1   (for t > t_k)
else                                                    → CURVE    (Hermite if !weighted, Bézier if weighted)
```

(AnimX: a span is linear only if *both* bounding tangents are linear; step/stepNext come from the
start key's out-tangent.) At exactly `t == t_k` the key value is returned.

**Control points** (both curve kinds):

```
Δ  = t_{k+1} − t_k
P0 = (t_k, v_k)
P1 = P0 + hout_k                    (desktop DCC: P0 + outTangent/3)
P2 = P3 + hin_{k+1}                 (desktop DCC: P3 − inTangent/3)
P3 = (t_{k+1}, v_{k+1})
```

**Drawing tip:** both kinds are exact cubic Béziers in the (t, v) plane, and the Graph Editor view
transform is affine. So `ctx.bezierCurveTo` on a 2D canvas draws them exactly: weighted segments with
P1/P2 as stored, non-weighted segments with the handles rescaled to Δ/3 in time:

```
P1' = (t_k + Δ/3,  v_k + m0·Δ/3)       P2' = (t_{k+1} − Δ/3,  v_{k+1} − m1·Δ/3)
```

Switch to per-pixel polyline sampling only for dense data (> ~1 key per pixel).

### 5.3 Segment evaluation

**Non-weighted (Hermite, AnimX `hermite`)**: tangents enter only through slopes.

```
m0 = hout_k.dv / hout_k.dt        (slope leaving key k;   0 if dt == 0)
m1 = hin_{k+1}.dv / hin_{k+1}.dt  (slope entering key k+1; 0 if dt == 0)
dv = v_{k+1} − v_k ,  s = t − t_k
a  = (Δ·(m0 + m1) − 2·dv) / Δ³
b  = (3·dv − Δ·(2·m0 + m1)) / Δ²
v(t) = ((a·s + b)·s + m0)·s + v_k
```

AnimX short-circuits to a straight line when both tangents are parallel to the chord
(`|Δ·m − dv|` within a relative epsilon of 2e-7). This form is **identical** to glTF `CUBICSPLINE`
with `b_k = m0`, `a_{k+1} = m1` once slopes are expressed per second (§5.11).

**Weighted (Bézier, AnimX `Tbezier::evaluate`)**: x(u) and v(u) are both cubic Béziers in a
parameter u, so the code must solve x(u) = t.

```
x̂1 = (P1.t − t_k)/Δ ,  x̂2 = (P2.t − t_k)/Δ          // normalised handle times
x̂1 = max(x̂1, 0) ; x̂2 = min(x̂2, 1)
if x̂1 > 1 or x̂2 < 0:                                  // handles overshoot in time
    // AnimX checkMonotonic: with p = x̂1, q = 1 − x̂2 the curve is monotonic iff
    //   p² + q² − 2(p + q) + p·q + 1 ≤ 0   (only tested when p > 1 or q > 1)
    // if violated, project onto that ellipse keeping the first handle (constrainInsideBounds)
rescale each moved handle's value offset by the same factor as its time offset
if x̂1 ≈ 1/3 and x̂2 ≈ 2/3 (1e-6): u = (t − t_k)/Δ     // linear time, skip the root solve
else solve  X(u) = 3(1−u)²u·x̂1 + 3(1−u)u²·x̂2 + u³ = (t − t_k)/Δ  for u ∈ [0,1]
v(t) = (1−u)³·v_k + 3(1−u)²u·P1.v + 3(1−u)u²·P2.v + u³·v_{k+1}
```

X(u) is monotonic after the correction, so the root is unique. Use Newton (start at u = s/Δ) with a
bisection fallback, to 1e-12. AnimX uses a polynomial root finder.

### 5.4 Tangent computation (for key i with neighbours p = i−1 and n = i+1)

Notation: `x, y` = key time and value; `px, py`, `nx, ny` = neighbours; one-sided slopes
`m_p = (y − py)/(x − px)` and `m_n = (ny − y)/(nx − x)`. Every computed type produces a **slope**
`m`, then the handles are

```
hin  = ( −(x − px)/3 , −m·(x − px)/3 )
hout = (  (nx − x)/3 ,  m·(nx − x)/3 )
```

(AnimX sets tangent x to the full neighbour span and divides by 3 in evaluation, which is the same
thing.) Computed types are recomputed whenever the key or its neighbours change. `fixed` is never
recomputed.

| Type | Slope rule | Source / confidence |
|---|---|---|
| **Flat** | `m = 0`. End keys copy the x-span of the other side | AnimX `flatTangent` (exact) |
| **Linear** | in-side `m_in = m_p`, out-side `m_out = m_n` (the tangent is *broken* in general). A span is a straight line when both bounding sides are linear | Vendor docs + AnimX (exact) |
| **Stepped / Stepped Next** | Interpolation flag on the out side (§5.2). Handles drawn flat | Vendor docs + AnimX (exact). Note: the desktop DCC's FBIK keys default to Stepped Next |
| **Auto** (legacy) | `target = (ny − py)/(nx − px)`. Then **clamp** (below). End keys flat | AnimX `_autoTangent` (exact) |
| **Auto Mix** | `f = (x − px)/(nx − px)`, `target = (1 − f)·m_p + f·m_n`, then clamp | AnimX (exact) |
| **Auto Ease** | `g = 0.5 + (f − 0.5)·(1 − c + 4c·(f − 0.5)²)` with `c = −0.5`, `target = (1 − g)·m_p + g·m_n`, then clamp | AnimX (exact) |
| **Auto Custom** | Same family with a user coefficient `c ∈ [−0.5, 1]` (`c = 0` ≡ Auto Mix, `c = −0.5` ≡ Auto Ease) | Inferred from the AnimX comment "family of cubic functions g with c in [−1/2, 1]" + vendor docs ("customizable blend of the two slopes"). Verify |
| **Spline** | Interior: `m = (ny − py)/(nx − px)` (non-uniform Catmull-Rom, collinear in/out). End keys: one-sided slope to the only neighbour | Vendor docs describe behaviour only. Calibrate end-key rule with desktop-DCC fixtures |
| **Clamped** | Spline slope, except `m = 0` when `abs(y − py) ≤ ε` or `abs(ny − y) ≤ ε` (adjacent keys "very close", which prevents foot slipping between equal keys). Can still overshoot elsewhere | Vendor docs (behaviour). ε is undocumented; start with `1e-5·max(1, abs(range))`. Calibrate |
| **Plateau** | Spline-like ease, flat at local extrema, flat between equal keys, flat first/last key, never overshoots neighbours. Implement with the **Auto (legacy) clamp** | Vendor docs (behaviour) + AnimX clamp. Treat as an approximation until calibrated |
| **Fixed** | Keep handles as they are when the key moves | Vendor docs |

**Auto clamp (AnimX, exact):**

```
S_p = 3·(y − py)/(x − px) ;  S_n = 3·(ny − y)/(nx − x)       // 3× one-sided slopes
sign(z) = z < 0 ? −1 : +1                                   // note: sign(0) = +1
if sign(S_p) ≠ sign(S_n) or sign(target) ≠ sign(S_n):  m = 0   // local extremum → flat
else if S_n ≥ 0:  m = min(target, S_n, S_p)
else:             m = max(target, S_n, S_p)
```

This guarantees the Bézier handle (at 1/3 of the span) never passes the neighbour's value, so the
curve does not overshoot. That is "Auto doesn't overshoot" in the vendor docs.

#### 5.4.1 Weighted curves
Computed types give the same handles (1/3 span). A user drag switches the side to `fixed`.
`weightLocked` keeps `|h|` and changes only the angle. Free changes both.

#### 5.4.2 Break / unify
Unified keys keep the two handles collinear: dragging one rotates the other by the same angle while
it keeps its own length (weighted) or its fixed draw length (non-weighted). The desktop DCC's *Unify* rejoins
broken handles while keeping their current angles. *Break* sets `broken = true`.

#### 5.4.3 "Soften / harden" UX mapping (owner request)
- *Soften* = Auto Ease / Spline (smooth through the key).
- *Harden* = Linear (straight in and out) or Stepped (pose-to-pose blocking).
- *Ease in/out* = Flat. *Contact* = break tangents, then shape each side.
- These map to toolbar buttons with the curve preview drawn on hover.

#### 5.4.4 Cycle-aware auto tangents (borrowed from the open-source DCC)
When `pre` and `post` are both `cycle` or `cycleOffset`, compute first and last key tangents with
**wrapped neighbours**:

```
prev(first) = (last_prev.t − R, last_prev.v − O)
next(last)  = (first_next.t + R, first_next.v + O)
```

`R = t_last − t_first`, `O = 0` for cycle and `v_last − v_first` for cycle-with-offset. The loop is
then C¹-continuous at the seam. The open-source DCC documents the same behaviour for its Cycles modifier
("automatic Bézier handle placement is aware of the cycle"). Desktop-DCC users usually match tangents by
hand, so this is an improvement.

### 5.5 Angles and units in the UI
- Rotation channels are stored in **radians** and displayed in **degrees** (the desktop DCC displays degrees).
- Tangent angle in the numeric field uses the desktop DCC's convention (x in seconds), so values typed
  from it match. Handle *drag* uses screen space.

### 5.6 Infinity (pre/post extrapolation)

Let `t0 = t_first`, `t1 = t_last`, `R = t1 − t0`, `mod(a, b) = ((a % b) + b) % b`.

| Mode | Formula |
|---|---|
| Constant (default) | `v = v_first` before, `v_last` after |
| Linear | before: `v = v_first − (t0 − t)·m_in(first)`. After: `v = v_last + (t − t1)·m_out(last)` (AnimX uses `tan(angle)` of the end tangent, which equals the slope) |
| Cycle | `t' = t0 + mod(t − t0, R)` → `v = eval(t')` |
| Cycle with Offset | `n = floor((t − t0)/R)`, `v = eval(t') + n·(v_last − v_first)` |
| Oscillate | `u = mod(t − t0, 2R)`, `t' = t0 + (u ≤ R ? u : 2R − u)`, `v = eval(t')` |

Rotation curves in the desktop DCC can also use quaternion infinities (AnimX `evaluateQuaternionInfinity`).
We skip that while rotations are Euler.

### 5.7 Rotations: Euler curves, rotate order, Euler filter

- **Authoring:** three scalar curves `rx, ry, rz` per control with a per-control **rotate order**
  (the desktop DCC's *Independent Euler-angle curves*, the default). Keys on all three are kept in sync on `S`/`Shift+E`
  so the gimbal manipulator and the curves stay coherent.
- **Rotate-order mapping (critical).** Both reference DCCs name orders by *application* order (extrinsic:
  `xyz` = X applied first, so M = Rz·Ry·Rx). three.js names them by *matrix product* order
  (`'XYZ'` → M = Rx·Ry·Rz). Verified from three's `Matrix4.makeRotationFromEuler`, where `'XYZ'` puts
  sin(y) at element m02.

  | Reference DCCs | three.js `Euler.order` |
  |---|---|
  | xyz | `'ZYX'` |
  | yzx | `'XZY'` |
  | zxy | `'YXZ'` |
  | xzy | `'YZX'` |
  | yxz | `'ZXY'` |
  | zyx | `'XYZ'` |

- **Gimbal rule:** the *middle* axis of the order locks at ±90°. Put the bone's twist axis first
  (innermost ring), the least-used axis in the middle and the main swing axis last. Defaults per
  humanoid bone class should be validated with animators. A reasonable start for VRM normalized space
  (Y up): spine/neck/head and legs `yzx` (twist Y, side-bend Z small, forward-bend X). Arms in T-pose:
  twist X first, choose the middle by test.
- **Euler filter** (import, bake, and on demand, GE-17), per sample/key i in time order:

  ```
  unwrap(e, ref) = e + 2π·round((ref − e)/2π)            // per component
  c1 = unwrap((a, b, c), prev)
  c2 = unwrap((a + π, π − b, c + π), prev)               // same rotation, other branch; b = middle angle
  e_i = argmin(|c1 − prev|₁, |c2 − prev|₁)
  ```

  This is the standard discontinuity filter (the desktop DCC's `filterCurve -f euler`; the open-source DCC has
  an equivalent). Run it after quaternion→Euler conversion. Also enforce **quaternion sign continuity** when
  baking:
  `if dot(q_i, q_{i−1}) < 0 then q_i = −q_i`.
- **Later option:** quaternion curves (the desktop DCC's *Quaternion Slerp/Cubic*, AnimX `evaluateQuaternion`) for
  imported mocap that should not be Eulerised. V2, GE-23.

### 5.8 Control → bone evaluation

```
for each control c in topological order:
    c.local  = c.offset · T(tx,ty,tz) · R_euler(rx,ry,rz; order) · S(sx,sy,sz)
    c.world  = c.parent.world · c.local
bone.local = bone.rest · Δ(c)             // FK: Δ = channels expressed in bone-rest space
```

With VRM humanoids, work on **normalized bones** (three-vrm normalized humanoid). There every rest
rotation is identity and the axes are world-aligned, so `c.offset` = rest and Δ = channel TRS. Then
three-vrm maps normalized → raw bones. For non-humanoid bones (tail, hair, props) the offset is the
bone's bind-local transform, like a desktop-DCC joint's `jointOrient` under its `rotate`.

### 5.9 Tween, breakdown, mirror math

```
Tween (tweenMachine):     w = (slider + 100)/200 ;  v = v_prev + w·(v_next − v_prev)   (w may leave [0,1] = overshoot)
Blend to neighbour:       v = v_cur + w·(v_neighbour − v_cur)
Blend to rest/default:    v = (1 − w)·v_cur            (rest = 0 for normalized controls)
Push / relax:             v = v_cur ± w·(v_cur − v_tween(0.5))
Breakdown retime:         t_bd = t_prev + ratio·(t_next − t_prev), ratio stored when the key is set
```

Rotation channels in Euler mode are tweened per curve. A quaternion slerp option comes with GE-23.

**Mirror in normalized humanoid space** (mirror plane YZ, x → −x). Let M = diag(−1, 1, 1). Then
M·Rx(a)·M = Rx(a), M·Ry(b)·M = Ry(−b) and M·Rz(c)·M = Rz(−c), so for **any** rotate order:

```
(rx, ry, rz) → (rx, −ry, −rz)        quaternion (x, y, z, w) → (x, −y, −z, w)
(tx, ty, tz) → (−tx, ty, tz)
swap left*/right* humanoid bones; centre bones mirror in place (flip) or stay (mirror L→R)
```

This holds only because normalized rest frames are identity and symmetric. On raw bones it would need
per-bone mirror tables (Studio Library's approach).

### 5.10 Two-bone IK (V1, `ikRPsolver`-like)

```
A = root (shoulder/hip), B = mid (elbow/knee), C = end, T = IK control, P = pole-vector control
l1 = |B − A|, l2 = |C − B|,  d = clamp(|T − A|, |l1 − l2| + ε, l1 + l2 − ε)
û = (T − A)/|T − A|
w = normalize((P − A) − ((P − A)·û)·û)          // bend direction toward the pole
cos α = (l1² + d² − l2²)/(2·l1·d)
B' = A + l1·(cos α·û + sin α·w)
C' = A + d·û
rotate A's bone to aim at B' (twist from the plane), B's bone to aim at C', end bone orient = IK control orient
```

Then convert the resulting world rotations back to control channels when baking or matching IK→FK.
Soft-IK (easing d near full extension) prevents "knee pop" and comes in V2.

### 5.11 Export mapping to glTF / VRMA

- glTF stores sampler times in **seconds**, interpolation `LINEAR` (rotations use slerp), `STEP` or
  `CUBICSPLINE`. The cubic formula is
  `v_t = (2t³−3t²+1)v_k + t_d(t³−2t²+t)b_k + (−2t³+3t²)v_{k+1} + t_d(t³−t²)a_{k+1}`,
  with in-tangent `a`, out-tangent `b`, `t_d` = segment duration. Rotations must be normalised after
  cubic interpolation. Outside the input range values clamp (no infinity).
- **Exact export is possible** for translation/scale/morph-weight channels when (1) the curve is
  non-weighted, (2) the X/Y/Z curves share key times (insert shape-preserving keys first: splitting a
  cubic Hermite at s with the exact value and derivative reproduces the cubic exactly), and (3) no
  stepped/linear mixing within the vec3. Then `b_k = m0·fps`, `a_{k+1} = m1·fps` (slopes per frame →
  per second) and `v_k` = key values.
- **Resampling is required** for weighted segments (not polynomial in t), rotations (Euler →
  quaternion), infinities (bake the loop into the range), constraints/IK and layers. Default export:
  sample at clip fps → `LINEAR` (quaternions with sign continuity), then optionally drop redundant keys
  (e.g. `@gltf-transform/functions` resample-style dedupe within a tolerance). `LINEAR` is the safest
  common denominator for three.js, VRMA loaders and Bevy.
- **Loop closure:** for cyclic clips make the last sample equal to the first, or omit it, depending on
  the consumer's loop convention. This is an open question for OMOBA/Bevy.

### 5.12 Golden-test plan for the curve engine (MVP gate)

| Test | Oracle | Tolerance |
|---|---|---|
| Hermite/Bézier/Linear/Step/StepNext evaluation on 10k random curves | AnimX C++ CLI (`evaluateCurve`) | 1e-9 |
| Auto / AutoMix / AutoEase tangents | AnimX `autoTangent` | 1e-12 |
| All infinity modes, negative times, multi-cycle | AnimX `evaluateInfinity` | 1e-9 |
| Spline / Clamped / Plateau | `.anim` fixtures exported from the desktop DCC if available. Otherwise property tests (no overshoot for plateau/auto, flat at extrema, equal-key flatness for clamped) | 1e-6 vs the desktop DCC |
| Shape-preserving key insertion | evaluate before/after at 1k points | 1e-12 |
| Euler filter | random quaternion walks → Euler → filter → quaternion equals input (up to sign); no jump > π | 1e-9 |
| glTF CUBICSPLINE equivalence | our Hermite vs the glTF formula with converted tangents | 1e-9 |

---

## 6. Suggested MVP interface (desktop-DCC-like, web-native)

```
┌───────────────────────────── menu · mode tabs (Animate / Rig*) · command palette ─────────────────────────────┐
│ Outliner  │  VIEW A: shot cam (locked)        │  VIEW B: persp (free tumble)         │ Channel Box            │
│ (controls │  HUD: cam · frame · fps           │  gizmo: W/E/R, object/world          │ tx ty tz rx ry rz …    │
│  / bones) ├───────────────────────────────────┴──────────────────────────────────────┤ (keyed colours)        │
│           │  Graph Editor  [Dope Sheet: V1]                                          │ Properties (rot order, │
│           │  channel list │ curves (RGB) · toolbar: Auto Spline Clamped Linear Flat  │  clip, infinity)       │
│           │               │ Stepped Plateau · Break/Unify · Weighted · Lock wt       │                        │
├───────────┴──────────────────────────────────────────────────────────────────────────┴────────────────────────┤
│ Time Slider: ticks (red keys / green breakdowns) · bookmarks (V1) · audio waveform (V1)                        │
│ Range Slider · ⏮ ◀ ▶ ⏭ · fps · loop · Auto Key ● · current frame                                             │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
*Rig mode = control shape/size/colour editing (V1)
```

MVP acceptance scenario (end-to-end):
1. Load the CC0 VRM 1.0 sample → FK circles on all humanoid bones (L blue / R red / centre yellow).
   VIEW A = locked shot camera, VIEW B = free perspective.
2. Animate a 30-frame wave: `S` on frame 0, rotate the arm in VIEW B, `S` on 15 and 30, post-infinity
   *Cycle*. The Graph Editor shows the RGB curves. Switch keys between Auto/Linear/Stepped, break a
   tangent, toggle weighted and drag a handle longer.
3. Playback runs in real time at 30 fps in both views, and the UI stays responsive.
4. Export: (a) GLB with the clip embedded, (b) animation-only GLB, (c) VRMA. Each re-imports and
   plays identically (rotation error < 1e-4 rad) in three.js and in `@ekza/avatar-renderer`.
5. Every action undoes and redoes, and no U-scope state enters the document.

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Desktop-DCC feature breadth → scope creep | MVP never ships | Hard MVP list (§0, §6). Everything else V1+ |
| Spline/Clamped/Plateau formulas are undocumented | Curves "feel different" to desktop-DCC users | AnimX-exact Auto family as the default (the desktop DCC's 2025 default is Auto). Calibrate the others with desktop-DCC fixtures. Document deviations |
| Euler authoring vs quaternion files | Flips and gimbal on import or bake | Euler filter + sign continuity + per-control rotate orders + golden tests |
| Rotate-order naming mismatch (DCCs vs three.js) | Silent wrong rotations | Single conversion table (§5.7) + unit tests |
| Browser keyboard/mouse limits | Desktop-DCC muscle memory partly breaks | `code`-based keymap, remappable modifiers, trackpad preset, avoid reserved keys (§4.5) |
| Onion skin / motion-trail cost with skinned meshes | Frame drops | Limit ghost count, cache, recompute on edit only. Bone-only ghosts as fallback |
| Licence contamination from plug-ins | Open-source licence issues | Clean-room implementations. AnimX is Apache-2.0 (keep NOTICE). Do not copy LGPL (Studio Library) or unlicensed code |
| Trademark | Legal/branding confusion | Do not name third-party products in the UI or the public docs. The hotkey preset is "Classic" (id `dcc`) |
| Collaboration retrofitted late | Rewrite of state | Commands + D/U/P scopes from MVP (COL-01/02) |

---

## 8. Open questions for the owner

1. Does the project have access to a desktop-DCC licence for generating golden fixtures (Spline/Clamped/Plateau, `.anim` interop)?
2. What is the default frame rate for Ekza clips: 30 (games) or 24 (the desktop DCC's default)? Should export resample to 30/60?
3. What loop convention do OMOBA/Bevy and Ekza Space need (duplicate last frame or not)? Root motion or in-place?
4. Should the default keymap be the `dcc` preset only, or should the first-run dialog also offer an alternative preset (open-source-DCC style)?
5. Should IK (V1) come before the Dope Sheet, given that game clips need planted feet?
6. Collaboration granularity for "four hands": soft locks per body part (simple, predictable) or free per-key CRDT merge?
7. Should VRM spring bones ever be baked into exported clips, or always stay runtime-only?

---

## 9. Sources

**Desktop DCC (vendor documentation; URLs omitted)**
- Graph Editor Tangents menu (2025)
- Keyframe Tangent Marking Menu (2025)
- Graph Editor Curves menu (infinity, buffer curves, filters, rotation interp) (2023)
- `filterCurve` command (filter types)
- `MFnAnimCurve` API reference (Bézier P1..P4, tangent stored as 3·(P2 − P1), tangent/infinity enums, AutoMix/AutoEase/AutoCustom since 2022)
- Time Slider (2024)
- Time Slider (2020, bookmarks)
- Playback Controls (2025)
- "All Hotkeys" table (2014)
- Animation Operations hotkeys (2016)
- Channel Box (2024)
- Channel Box colour legend (2017)
- Panel menu: Panels (2026)
- Rotate Tool (2025)
- Breakdowns (2017)
- `autoKeyframe` command
- Ghosting Editor (2023)
- Create an editable motion trail (2023)
- Animation layers (2022)
- What's New 2025, Dope Sheet rework
- Trax vs Time Editor (vendor user forum)
- MotionMaker announcement (vendor blog, 2025-06)
- 2027.1 release (OTIO, Sequencer): Digital Production news, 2026-05-22
- 2027.2 release (custom MotionMaker training): Digital Production news, 2026-07-24

**Curve math**
- AnimX (Apache-2.0; files `src/animx.h`, `src/animx.cpp`, `src/internal/interpolators.h`, `src/internal/Tbezier.h`, `src/internal/math.h`; repository URL omitted)
- glTF 2.0 spec, Appendix C (interpolation): https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#appendix-c-interpolation
- OpenUSD Ts (spline) status, Hermite/auto tangents matching the desktop DCC planned: https://openusd.org/dev/api/page_ts_status.html

**Open-source DCC (manual and developer site; URLs omitted)**
- F-Curve properties (handle types, handle smoothing, interpolation, easing), user manual (latest)
- F-Curve modifiers / cycle-aware auto handles, user manual (2.91)
- Cycle-Aware Keying commit `rB72acce43bc34e5e9569606e08ee536b02cab088b`
- 4.4 slotted actions (developer feedback thread)
- 4.4 key features (CG Channel, 2025-03)

**Mocap package / full-body IK (vendor documentation; URLs omitted)**
- Character Controls (2024)
- Manipulation and keying modes (2017)

**Cascadeur**
- 2025.1 AI Inbetweening: https://cascadeur.com/blog/general/cascadeur-20251-released-faster-animation-workflows-with-ai-inbetweening
- 2025.1 overview: https://www.cgchannel.com/2025/04/nekki-releases-cascadeur-2025-1-with-ai-based-inbetweening/
- 2025.3: https://www.cgchannel.com/2025/11/nekki-releases-cascadeur-2025-3/

**Plug-ins and web libraries**
- Studio Library (LGPL-3.0): https://github.com/krathjen/studiolibrary
- tweenMachine (archived): https://github.com/boredstiff/tweenMachine
- dockview licence/features (MIT core, popout windows): https://dockview.dev/docs/overview/licence
- drei `View` (multi-viewport via scissor): https://drei.docs.pmnd.rs/portals/view
