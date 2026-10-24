# 05 — Landscape: existing web / OSS / commercial animation tools

> Research date: 2026-10-17. Scope: tools and libraries relevant to a browser-based,
> open-source character-animation editor (three.js + React Three Fiber, VRM/VRMA-first).
> Method: web search plus primary sources (GitHub repositories, npm registry metadata,
> vendor docs, release notes). Versions and licenses were checked on 2026-10-17 with
> `npm view` and the GitHub API. Every claim that depends on a version or license has a
> source at the end of this document.
>
> Related docs: `03-ekza-reuse-audit.md` (what we can reuse from Ekza repos) and
> `08-extensibility-modeling.md` (modeling and future-proofing).
>
> Naming: "the desktop DCC" is a leading commercial desktop DCC, "the open-source DCC" a popular
> open-source DCC, "the auto-rigging service" a web auto-rigging service, and "the mocap package" a
> real-time motion-capture package from the desktop DCC's vendor.

License legend used below:

| Tag | Meaning for an MIT / Apache-2.0 project |
|---|---|
| **DEP** | Safe to depend on (MIT, Apache-2.0, BSD, ISC). Apache-2.0 requires keeping NOTICE/attribution. |
| **PORT** | Permissive source we may read, port or vendor with attribution (keep the copyright header). |
| **DESIGN** | Copyleft (GPL/AGPL), proprietary or unlicensed. Use for UX lessons only and never copy code. |
| **SVC** | Closed service or app. Interop target (file formats) or competitor only. |

---

## 0. TL;DR

1. **The niche is empty.** As of October 2026 no open-source, web-native tool combines (a) a
   professional DCC-grade graph editor (weighted tangents, break/unify, flat/linear/stepped, buffer
   curves), (b) a control rig with on-model curve controls, (c) VRM/VRMA-first round-trip
   that also writes back into GLB, and (d) real-time multiplayer. Each neighbour covers at
   most two of these.
2. **Closest neighbours, all young and small:**
   - **Reze Studio** (MMD/VMD, GPL-3.0, Next.js 16 + WebGPU, ~465 stars). It has the best
     web curve editor of the group and puts "Overleaf-style collaboration" on its roadmap.
   - **VRMA Lab** (VRM/VRMA, Apache-2.0, React 18 + Vite, single developer). It has
     adjustment clips, an agent SDK and read-back export validation, but no graph editor.
   - **Pose Studio** (UE5 Manny, GPL-3.0, created October 2026). It has IK/FK, a dopesheet
     and graph editor side by side, layers and mirroring.
   - **Roboticela Animator** (AGPL-3.0, R3F). It offers basic per-bone keyframing and GLB
     export.

   None is VRM-first with a control rig and a professional graph editor.
3. **Big web platforms do not cover characters:**
   - **Theatre.js** (core Apache-2.0, studio **AGPL-3.0**) is dormant in public: last npm
     publish was May 2024 and development moved to a private repo.
   - The **three.js editor** gained a *read-only* animation panel in February 2026.
   - **PlayCanvas** has a state graph but no keyframe or curve editor.
   - The **Babylon.js Animation Curve Editor** (Apache-2.0) works but is an inspector tool,
     SVG-based and buggy.
   - **Spline** added a beta keyframe timeline in September 2025.
4. **Commercial desktop tools set the UX bar:**
   - **Cascadeur** 2026.2: AutoPosing, AutoPhysics, fulcrum points, an alpha layer system,
     spacing-only easing, and an MCP server.
   - **Unreal** 5.6: editable motion trails, tween tools with overshoot, a curve editor with
     a lattice tool, and Control Rig shape controls.
   - **The open-source DCC**: about 25 graph-editor slider and cleanup operators.

   We copy their *interaction ideas*, never their code.
5. **The user need with the most demand is *FBX/BVH (incl. auto-rigger clips) → VRMA*.** Projects that solve
   only this get the most stars (Text-to-VRMA ~199 stars, fbx2vrma, bvh2vrma, VRMA Lab).
   An import → clean → export path is a P1 adoption driver, not a nice-to-have.
6. **Reusable permissive pieces exist:**
   - `@pixiv/three-vrm(-animation)` (MIT)
   - `@gltf-transform/*` (MIT)
   - the VRM Consortium's `VRMAnimationExporterPlugin` in `bvh2vrma` (MIT)
   - `gltf-transform-vrm-extensions` (MIT, one maintainer)
   - Godot's bezier editor (MIT, design and port reference)
   - Babylon ACE (Apache-2.0)
   - `closed-chain-ik-js` (Apache-2.0)
   - Yjs / yrs (MIT)
   - dockview (MIT, but **not** `dockview-enterprise`)
7. **"Ekza Animator" is free.** We found no product, npm package or GitHub repository with
   that name. The npm scope `@ekza` is **unclaimed**, so claim it now. Do **not** romanize
   the name as "Exo …": ExoTools is a rigging/animation plug-in company. Do **not** use
   the `.eza` file extension: EZ-Animator, an animation app, already uses it.

---

## 1. Positioning map

Relevance: ★★★ direct neighbour or competitor · ★★ strong UX reference · ★ peripheral.

| Tool | Kind | Platform | License (code) | glTF/VRM | Graph editor | Control rig / IK | Multi-user | Relevance |
|---|---|---|---|---|---|---|---|---|
| Reze Studio | MMD curve editor | Web (WebGPU, Next.js 16) | GPL-3.0 → DESIGN | No (PMX/VMD) | Yes, per-channel Bézier | Engine IK, gizmo only | Roadmap | ★★★ |
| VRMA Lab | VRMA workbench | Web (React 18, three 0.170) | Apache-2.0 → PORT | VRM 0.x/1.0 + VRMA | No (adjustment clips) | No | No | ★★★ |
| Pose Studio | UE5 Manny animator | Web PWA, Win, Android | GPL-3.0 → DESIGN | Unreal FBX via the open-source DCC | Yes, beside the dopesheet | IK/FK, mirroring, layers | No | ★★★ |
| Roboticela Animator | Keyframe studio | Web + Tauri, R3F | AGPL-3.0 → DESIGN | GLB in/out | No | No | No | ★★ |
| nanasi vrm-animation-web-editor, vrm-dance, others | Hobby VRMA editors | Web | Mostly unlicensed | VRMA | No | No | No | ★ |
| Theatre.js | Motion-design sequencer | Web | core Apache-2.0 · studio **AGPL-3.0** | Via `@theatre/r3f` props | Yes, normalized per-segment bezier | No | Private "saaz" sync, unreleased | ★★ |
| Babylon.js ACE | Inspector curve editor | Web (React + SVG) | Apache-2.0 → PORT | Babylon animations | Yes, Hermite slopes, no weights | No | No | ★★ |
| Babylon.js Editor "cinematic" | Scene sequencer | Electron (React) | Apache-2.0 → PORT | Babylon | Yes, basic | No | No | ★ |
| three.js editor | Scene editor | Web | MIT → PORT | glTF | **No**; read-only timeline since Feb 2026 | No | No | ★ |
| PlayCanvas Editor | Engine editor | Web | Frontend MIT (Aug 2025), backend closed | glTF import | No; Anim State Graph only | No | **Yes** (ShareDB OT) | ★★ (collab reference) |
| Spline | 3D design SaaS | Web | Proprietary → SVC | glTF/USDZ export | Yes (Timeline beta, Sep 2025) | No | **Yes** | ★★ (UX reference) |
| Rive | 2D interactive animation | Web/desktop editor | Editor proprietary; runtimes MIT | n/a (2D) | Yes | Bones, IK, constraints | Team features | ★★ (mode UX) |
| TiXL (ex-Tooll3) | Real-time motion graphics | Windows (.NET) | MIT → PORT | n/a | Inline curve editor per param | No | No | ★ |
| Mannequin.js | Procedural posable figure | Web (three.js) | GPL-3.0 → DESIGN | No | No | FK posture API | No | ★ |
| M3 CharacterStudio | VRM avatar creator | Web (three.js) | MIT → PORT | VRM 1.0 **exporter** | No | No | No | ★ (VRM export code) |
| VRM Posing Desktop | VRM poser | Desktop (Steam, paid) | Proprietary | VRM 1.0, VRMA import | Weak timeline | Partial | No | ★★ (VRM user base) |
| VRMViewMeister, XR Animator | VRM pose / webcam mocap | Web/desktop | Docs only / unlicensed | VRM, VRMA | No | IK markers | No | ★ |
| Cascadeur 2026.2 | Physics-assisted animator | Win/Mac/Linux desktop | Proprietary | FBX, DAE, USD; BVH import | Yes | AutoPosing, fulcrums, layers (alpha) | No | ★★★ (UX bar) |
| Plask | Video mocap + editor | Web | Proprietary SaaS | FBX/GLB/BVH out | Basic | Foot lock | "Collaborate in cloud" | ★★ |
| Web auto-rigging service | Auto-rig + clip library | Web | Proprietary | FBX out | No | No | No | ★★ (import source) |
| DeepMotion, Rokoko Vision, Move.ai, Uthana, Cartwheel, Flow Studio | Mocap / AI motion SaaS | Web/iOS | Proprietary | FBX/GLB/BVH/USD | n/a | n/a | n/a | ★ (import sources) |
| Open-source DCC | DCC | Desktop | GPL → DESIGN; glTF IO add-on Apache-2.0 → PORT | glTF IO, VRM add-on (MIT) | Best-in-class OSS | Rigify, constraints | No | ★★★ (UX reference) |
| Godot AnimationPlayer | Engine editor | Desktop | MIT → PORT | glTF import | Bezier tracks (not for 3D bone TRS) | SkeletonIK3D / modifiers | No | ★★ |
| Unity Animation / Timeline / Animation Rigging | Engine editor | Desktop | Proprietary / Unity Companion License | FBX; glTF via packages | Yes (weighted tangents) | Constraint package | No | ★★ |
| Unreal Sequencer + Control Rig (5.6) | Engine editor | Desktop | Proprietary EULA | FBX/USD | Yes; lattice, smart snapping | **Yes**; shape library, spaces, physics | Multi-User Editing (Concert) | ★★★ (control-rig UX) |
| mGear (desktop DCC) | Rigging framework | Desktop-DCC plug-in | MIT → PORT | n/a | n/a | Anim Picker, control-shape library | No | ★ (picker reference) |

---

## 2. Tool-by-tool notes

Each entry covers **Good**, **Bad**, **Steal**, **Reuse** and **Competes?**. Lessons are
tagged with the priority we recommend: **P0** = MVP architecture, **P1** = first public
release, **P2** = later.

### 2.1 Web-native animation and scene editors

#### Theatre.js (theatre-js/theatre)
- **What it is:** a motion-design sequencer for the web, with `@theatre/r3f` bindings for
  R3F objects. About 12.8k stars.
- **Status:** dormant in public.
  - npm `@theatre/core` and `@theatre/studio` are at 0.7.2, last published 2024-05-19.
  - The repo was last pushed in August 2024. Its README says development "temporarily
    moved to a private repo" and that "1.0 is around the corner".
- **License trap:** `@theatre/core` is Apache-2.0, but `@theatre/studio` (the editor UI)
  is **AGPL-3.0-only**. Embedding the studio would make our editor AGPL.
- **Good:**
  - A dopesheet ("sequence editor") with a multi-track graph editor.
  - Easing presets appear when you click the connector between two keys.
  - Aggregate keyframes for compound props and objects: moving a parent key moves its
    child keys.
  - Shift-drag marquee selection.
  - A focus range.
  - Projects are plain JSON state.
- **Data model** (from source):
  - `BasicKeyframe = { id, position, value, handles: [lx, ly, rx, ry], connectedRight, type?: 'bezier' | 'hold' }`.
  - Keyframes are stored as `byId` plus `allIds` maps, not arrays. Id-keyed maps merge
    well under CRDTs.
  - Handles are **normalized per segment**, like a CSS `cubic-bezier`. Retiming a key keeps
    the easing shape.
- **Bad for character work:**
  - Normalized handles are easing curves, not value-space tangents. They cannot express
    desktop-DCC-style auto/clamped/weighted tangents continuous across keys.
  - No skeleton awareness, no IK, no rotation-order or Euler-filter tools.
  - Per-prop tracks do not scale to about 55 humanoid bones × 6–9 channels.
- **Steal:**
  - (P0) Id-keyed keyframe maps.
  - (P1) Easing-preset popover on a segment.
  - (P1) Aggregate keys on group rows: a per-bone "summary" row and a per-character row.
  - (P2) Focus or play range.
- **Reuse:** `@theatre/core` (Apache) is of no use to us. Treat the studio as DESIGN only.
- **Competes?** No. It is a motion-design tool.

#### Babylon.js Animation Curve Editor (ACE, inside the Inspector)
- **Source:** `packages/dev/inspector/.../animations/curveEditor` (Apache-2.0). React TSX
  with SVG rendering.
- **Toolbar:**
  - New key, Frame canvas, Frame/Value numeric inputs.
  - **Flatten / Linear / Step / Break / Unify tangent.**
  - Range selector and media player in a bottom bar.
- **Tangent model:** Hermite `inTangent` / `outTangent` slopes plus `lockedTangent`. There
  are **no tangent weights**. Vector and quaternion properties appear as per-component
  curves.
- **Good:**
  - The tangent operations have exactly the names animators know from the desktop DCC.
  - The interpolation enum is clear: `AnimationKeyInterpolation.STEP`.
- **Bad:**
  - It is tied to the Inspector and cannot be opened standalone.
  - The 2025 forum thread "Could animation curve editor get a bit of tender loving care?"
    and the Inspector-V2 tangent-handle bugs (PR #17761) point to maintenance debt.
  - Raw quaternion component curves cannot be animated by hand.
  - SVG struggles with dense curves.
- **Steal:**
  - (P0) The tangent-op vocabulary and toolbar layout.
  - (P0) Lesson: do **not** expose quaternion components. Edit Euler channels and bake to
    quaternions.
  - (P1) Range bar with playhead.
- **Reuse:** PORT. Its `curve.ts` path-building and tangent evaluation, about 280 lines,
  are a compact Apache reference.
- **Competes?** No.

#### Babylon.js Editor, "cinematic" editor (BabylonJS/Editor, Apache-2.0)
- An Electron editor with a sequencer: curves, keys, handles, tracks for property,
  animation group and sound, and event tracks such as "apply impulse".
- **Steal:** (P2) Event and sound tracks on the same timeline. Footstep events are useful
  for games such as OMOBA.
- **Reuse:** PORT reference only. It is Babylon-specific.

#### three.js editor (mrdoob/three.js `editor/`, MIT)
- February 2026 (PR #32869) added a bottom **Animation panel**: play, pause and stop, time
  and duration, timescale, color-coded track rows with key markers, scrubbing, and a
  hover motion path through the new `AnimationPathHelper` addon. A March 2026 change
  improved it.
- It is **view-only**: no key editing, no curves, no rig.
- **Steal:** (P1) Color-coding by channel type (`.position`, `.quaternion`, `.scale`,
  `.morphTargetInfluences`).
- **Reuse:**
  - DEP: `three/addons/helpers/AnimationPathHelper.js` exists in three 0.186. It only
    samples **local position tracks of one object**, so we still need our own
    *world-space* trail for bones and controls.
  - Its `GLTFImportDialog` / `Loader` code is a minor PORT reference.
- **Competes?** No.

#### PlayCanvas Editor (playcanvas/editor, frontend MIT since August 2025)
- Uses PCUI, Observer (data binding and history) and PCUI-Graph.
- Real-time collaboration runs on **ShareDB (OT)** (`sharedb` 3.3.2 in its
  `package.json`). The backend is **not** open source.
- Animation support is limited to the Anim State Graph editor (2021): layers, states and
  transitions. There is no keyframe or curve editor, and forum users ask for a "proper
  animation timeline".
- **Steal:**
  - (P2) Server-authoritative realtime document per asset, with presence (who is editing
    what).
  - (P1) Observer-style history built on the same command objects.
- **Reuse:** Not practical. PCUI is a different UI stack.
- **Competes?** No.

#### Spline (spline.design, proprietary SaaS)
- 3D design in the browser with Figma-like **real-time multiplayer**.
- A **Timeline Animation (beta)** shipped on 2025-09-18: keyframes, a graph editor for
  easing and speed, multiple timelines, and event triggers ("Start → Timeline Animation").
  It is built on top of the older States system.
- **Steal:**
  - (P1) Key diamonds next to every inspector property, with click-to-key.
  - (P2) Multiple named timelines per scene.
  - (P2) Multiplayer presence cursors.
- **Name warning:** "Spline" is Spline Design's brand. Our future modeling feature can be
  called "spline modeling" generically, but never a product named "Ekza Spline".
- **Competes?** Weakly. It does not do character animation.

#### Rive (editor proprietary; runtimes MIT)
- 2D, but has the cleanest **mode separation**:
  - *Design mode*: build, rig, bones and constraints.
  - *Animate mode*: timelines and state machines. The inspector shows key buttons, and
    edits can auto-key when a timeline is selected.
  - **Tab** toggles between the modes.
- Graph editor with per-key interpolation and a "default interpolation for new keys"
  setting.
- **Steal:**
  - (P0) Separate **Rig/Setup mode** from **Animate mode**. Rig edits such as adding a
    control or changing an offset must never create keys.
  - (P1) A visible auto-key state.
  - (P1) A default tangent type for new keys.
- **Competes?** No.

#### TiXL (formerly Tooll3, MIT, C#)
- Renamed in May 2025. Version 4.2 moved its curves **from monotone Hermite to cubic
  Bézier**, a breaking change, and added an inline curve editor per parameter in the
  dopesheet.
- **Lesson (P0):** choose the curve math once and version the file format. A late
  interpolation change forced TiXL into a breaking migration.
- **Competes?** No.

### 2.2 Web humanoid, VRM and MMD editors (closest neighbours)

#### Reze Studio (AmyangXYZ/reze-studio, GPL-3.0) — the best web reference
- **Product:** a WebGPU MMD (PMX/VMD) animation editor.
  - Timeline with dopesheet and per-channel Bézier curve editor.
  - Marquee select and batch drag, copy, cut and paste.
  - "Simplify" for key reduction.
  - Clip library and an "Arrange" view: clips on lanes with trim, split and per-bone
    layering.
  - Double-click a bone in the viewport for a rings-and-axes gizmo.
  - English and Chinese UI.
  - Roadmap: masks, mirrored paste, mocap, **"Overleaf-style real-time collaboration"**,
    AI in-betweening.
- **Stack:** Next.js 16, React 19, shadcn/ui, Tailwind, and its own `reze-engine` (WebGPU,
  Bullet port, IK). It sits in a family with reze-design, MiKaPo webcam mocap (GPL) and
  reze-rig (FBX → VMD).
- **Architecture notes in its README, all worth copying as *ideas*:**
  1. Split external stores: document/selection, which is the undo target, separate from
     transport (playhead, playing). rAF ticks never touch undo state.
  2. `useSyncExternalStore` with selector hooks, plus stable action bags.
  3. **Hot paths bypass React.** Playback, key drag and slider drag mutate refs and repaint
     the canvas imperatively. React is touched once, on release.
  4. A `currentFrameRef` escape hatch for non-subscribing readers.
  5. **Snapshot-bridged undo.** Mid-drag edits mutate a live clip, and commit pushes the
     last *committed* snapshot, so history never captures drag states. 100-step history.
- **Bad for us:** MMD-only (VMD Bézier is a fixed 4-point easing per channel), no glTF/VRM,
  no control rig, GPL.
- **Steal:**
  - (P0) The store split and the hot-path rule.
  - (P1) Simplify (key reduction with a tolerance).
  - (P1) Arrange/clip lanes.
  - (P1) Dopesheet and curve selection are mutually exclusive.
  - (P1) Its keyboard map. It is a good minimal default; see section 4.
- **Competes?** **Yes, adjacent.** It is the most credible OSS web animator today and
  shares the Next.js + React stack. We differ on format (glTF/VRM), rig (controls) and
  license (permissive). Watch it.

#### VRMA Lab (YuBan834/vrma-lab, Apache-2.0)
- **Product:** a local-first VRM motion workbench (React 18, Vite 5, three 0.170,
  three-vrm 3.5). Three entry points:
  - *Human Workbench*: preview, timeline, **adjustment clips** for bones, expressions and
    gaze, A/B comparison, VRMA export.
  - *Agent Mode*: `window.vrmaLab.{inspect, edit, review, validate, exportVrma, undo, redo}`,
    a same-origin `postMessage` JSON bridge, and a deterministic **quad-view review
    render** (full body, upper body, half body, legs/contacts).
  - *Quick Converter*: auto-rigger FBX → VRMA, retargeted and baked at 30 fps.
- **Export validation:** after export the tool **reads the VRMA back**, runs structural and
  semantic tolerance checks, and only then enables download. It never overwrites the
  source.
- **Bad:** no curve editor, no keyframe-level editing, no control rig, one developer,
  about 6 stars.
- **Steal:**
  - (P0) Round-trip **read-back validation** of every export.
  - (P1) Additive "adjustment clip" layers over imported mocap.
  - (P1) A command API shared by UI, agents and tests. Expose it later as an MCP server;
    Cascadeur 2026.2 shipped one too.
  - (P2) Quad-view review renders for agents and thumbnails.
- **Reuse:** PORT. The FBX → VRMA bake and the validator are Apache-2.0. Evaluate them
  before writing our own.
- **Competes?** **Partly.** It holds the "VRMA editor" search slot but not the
  professional-animator slot.

#### Pose Studio (iirg4x/pose-studio, GPL-3.0, created 2026-10-13)
- A browser, PWA, Windows and Android animator for the **UE5 Manny** rig:
  - IK/FK limbs and props.
  - **Dopesheet and graph editor side by side.**
  - Animation layers and **live mirroring**.
  - Reset-to-rest per control.
  - Retarget, and export to Unreal through the open-source DCC.
  - A `UI_RULEBOOK.md`.
- **Steal:**
  - (P1) Live mirroring, using VRM left/right humanoid pairs.
  - (P1) Reset control to rest.
  - (P0) A UI rulebook doc in the repo.
- **Competes?** Adjacent: same "pro animator in a browser" thesis, but Unreal-centric.

#### Roboticela Animator (Roboticela/Animator, AGPL-3.0)
- React 19, R3F, drei, Zustand, Radix and Tauri 2.
- Imports GLB, glTF, FBX and OBJ. Has a bone hierarchy, per-bone keyframes with gizmos, a
  premade clip library, undo, and **GLB-only export**.
- No curves, IK or rig. About 3 stars.
- **Lesson:** confirms that the R3F + Zustand + Radix stack is the default choice. AGPL, so
  DESIGN only.

#### Smaller web VRM tools
- **Projects:** nanasi-apps/vrm-animation-web-editor, reminjp/vrm-dance (2022),
  asymihoney/vrm-animation-editor, k3peta/web-vrm-poser, comfyui-vrm-pose-editor (MIT,
  about 18 stars), tk256ailab/vrm-viewer (MIT).
- All are hobby scale. They confirm demand for "load VRM → pose → export VRMA". None are
  architectural references.

#### Mannequin.js (boytchev/mannequin.js, GPL-3.0)
- A procedural posable figure for teaching, with an FK posture API and a posture editor.
- **Steal:** (P2) A built-in neutral mannequin as a "no model loaded" default.
- DESIGN only (GPL). Use a CC0 VRM such as the 100 Avatars set instead.

#### M3-org CharacterStudio (MIT)
- A web VRM avatar creator that includes `VRMExporter.js`, which writes `VRMC_vrm`
  `specVersion: "1.0"` from a three.js scene.
- **Lesson:** re-exporting from a three.js scene graph is lossy for animation editing.
  We should patch the original glTF document; see section 3.6.
- PORT reference for VRM 1.0 JSON shapes.

#### Text-to-VRMA (Kirakun0328/text-to-vrma, MIT, about 199 stars)
- Text → motion → VRMA in the browser. Engines:
  - LLM-authored keyframes (OpenAI or Anthropic APIs, or compatible providers).
  - NVIDIA **ARDY**: code Apache-2.0, **weights under the NVIDIA Open Model Agreement**.
- Also: 3-candidate comparison, loop closing, "smooth with contact protection".
- **Lesson:** AI motion is an *import source*. The editor's value is cleaning and
  directing it. (P2) Keep an "Import from AI" adapter slot.

#### VRM Posing Desktop (Steam, paid) · VRMViewMeister (web) · XR Animator (web/desktop)
- **VRM Posing Desktop:** VRM 1.0, `.vrma` import, MP4 export, Steam Workshop pose sharing
  and a VRoid Hub link. User reviews (aggregated) complain that the timeline lacks real
  keyframes and that IK is incomplete. Those are exactly our strengths.
- **VRMViewMeister:** IK markers are disabled while a VRMA plays. Lesson: pose tools and
  clip playback must coexist through layers.
- **XR Animator:** webcam full-body mocap for VRM/MMD. The repo has no license, so treat it
  as DESIGN only.
- **VRoid Studio / VRoid Hub** (pixiv): an avatar creator and host. VRoid Hub plays VRMA.
  It is a distribution partner, not a competitor.

### 2.3 Desktop DCC and engine references (UX bar; design lessons only)

> The desktop DCC itself is analysed in `01-dcc-animation-features.md` and `09-ui-ux-spec.md`.
> Below are the *other* references worth stealing from.

#### Open-source DCC (GPL; design only) — Graph Editor, NLA, Pose Library
- **Graph Editor operators** (manual, current): Snap, Mirror, Insert, Copy/Paste, Handle
  Type, Interpolation Mode, **Easing Type**, Density, **Decimate**, **Bake**,
  **Clean**, **Blend / Breakdown / Blend to Neighbor / Blend to Default / Ease / Blend
  Offset / Blend to Ease / Match Slope / Push-Pull / Shear / Scale Average / Scale from
  Neighbor / Time Offset**, **Smooth (Gaussian)**, **Butterworth Smooth**.
- **Handle types:** Free, Aligned, Vector, Automatic, Auto-Clamped. Robert Penner easing
  equations are available as interpolation modes.
- **Actions:** slotted actions arrived in 4.4. Since 5.0 the data model has layers and
  strips, but they are **not exposed in the UI** (still true in 5.2 LTS per secondary
  sources). One action can animate several objects through slots.
- **NLA:** strips, blend modes, influence, "tweak mode".
- **Pose Library:** asset-browser based, with blend-on-drag.
- **Steal:**
  - (P1) Slider operators as one modal "tween slider" family with one interaction: drag
    left/right, overshoot with a modifier.
  - (P1) Decimate, Clean and Butterworth for mocap cleanup.
  - (P2) Pose library with drag-to-blend.
  - (P0) Layered data model from day 1, even if the UI ships later. This is the lesson of
    the open-source DCC's staged rollout.
- **PORT exception:** the open-source DCC's **glTF import/export add-on** (Khronos) is
  **Apache-2.0**. It is the best reference for animation export: sampling, NLA → glTF
  animations, baking, and `KHR_animation_pointer`. The **VRM add-on** for the open-source DCC
  is **MIT** and is a reference for VRMA export.

#### Godot AnimationPlayer and Bezier editor (MIT → PORT)
- **Track types:** value, position3D, rotation3D, scale3D, blend-shape, method,
  **bezier**, audio, animation.
- **Bezier editor context menu** (from `animation_bezier_editor.cpp`):
  - Insert Key Here; Copy, Cut, Paste, Duplicate, Delete.
  - **Make Handles Free / Linear / Balanced / Mirrored**, each with an "(Auto Tangent)"
    variant.
  - Scale Bezier Points.
- **Limitation:** Bezier tracks cannot blend with property tracks in AnimationTree, and 3D
  position/rotation/scale tracks **cannot use Bezier**, according to a Godot developer.
  Bones animated in Godot are therefore linear/sampled.
- **Lesson (P0):** rotation channels must get first-class curves (Euler, editable) with
  deterministic baking to quaternions. Do not repeat Godot's split.
- **Steal:** (P1) the "Balanced vs Mirrored" handle distinction (keep handle *length* or
  only *angle*). The MIT C++ code is a valid port reference.

#### Unity Animation window, Timeline and Animation Rigging (proprietary)
- **Tangent modes:** Clamped Auto (default, no overshoot), Auto (legacy), Free Smooth,
  Flat, Broken (Free/Linear/Constant per side), plus **Weighted** handles.
- **Record mode:** a red tint makes auto-key state unmistakable.
- **Timeline:** tracks, clips, ease-in/out blending, override tracks with **avatar masks**.
- **Animation Rigging:** constraints such as Two-Bone IK, Multi-Aim, Multi-Parent, Chain
  IK, Damped Transform and Twist Correction.
- **Steal:**
  - (P0) "Clamped Auto" as the default tangent, to avoid overshoot.
  - (P1) A record-mode tint.
  - (P2) Avatar-mask layers, mapped to VRM humanoid groups.

#### Unreal Engine 5.6 Sequencer and Control Rig (proprietary) — control-rig UX bar
- **Control Rig:**
  - Controls with **shapes from a shape library** (circles, boxes, arrows).
  - Spaces and space switching.
  - FK/IK switching with snapping.
  - An Anim Details panel.
  - Sequencer constraints.
  - Control Rig Physics (experimental, 5.6).
- **5.6 animation-authoring update**, described as the "biggest update yet":
  - **Motion trails** for actors *and* controls, with editable arcs and spacing in the
    viewport, dashed/time-based/heat-speed styles, pinning, offsets and spaces.
  - **Tween tools** with overshoot and a time-offset slider, embedded in the curve editor.
  - A **curve editor lattice tool** and smart key snapping.
  - Sequencer navigation and audio scrubbing.
- Multi-User Editing ("Concert") exists for virtual production.
- **Steal:**
  - (P0) Controls are data. Each has a shape id from a library, a color, a size and an
    offset transform, and is serialized with the rig.
  - (P1) Editable motion trails.
  - (P1) Tween slider with overshoot.
  - (P2) Lattice deform on selected keys.
  - (P2) Space switching with compensation.

#### Cascadeur 2026.1–2026.2 (Nekki, proprietary) — the "smart posing" bar
- **AutoPosing:** set a few joints; a neural net poses the rest.
- **AutoPhysics:** corrects keyframes toward physically plausible centre-of-mass and
  ballistic arcs.
- **Fulcrum points:** point controllers count as contact points when they are near the
  ground (Y within the collision radius) and nearly still between keys (speed ≤ max
  speed). States are Fulcrum, Enforce and NotFulcrum. AutoPhysics, Fulcrum Motion
  Cleaning, Interaction with Environment and Animation Unbaking use them.
- **2026.2 additions:**
  - **Animation layers** (alpha).
  - **Easing for interpolation:** changes spacing along a trajectory without changing its
    shape.
  - Updated AI in-betweening and motion generation, and BVH import.
  - A **"simple" MCP server**.
  - PySide custom UI.
- **Pricing:** free edition (non-commercial, `.casc` export only), Indie $19/month or
  $96/year, Pro $49/month or $396/year. Rent-to-own.
- **Steal:**
  - (P1) Auto-detected contact intervals (the fulcrum heuristic is simple and documented)
    to drive foot-lock and "keep contact while editing".
  - (P1) Separate *spacing* from *trajectory*: retime along an arc.
  - (P2) An AutoPosing-like "pin some joints, solve the rest" using full-body IK on the
    VRM humanoid.
  - (P2) An MCP server over our command API.
- **Competes?** Cascadeur is the benchmark for "animator-friendly" but is desktop and
  proprietary. Our pitch is *web + open + VRM + multiplayer*, not "better physics".

#### Mocap package and mGear (references)
- The **mocap package** and its full-body IK system popularised the **character-controls
  picker** and full-body IK with reach/pin. A VRM humanoid map lets us build a universal picker for
  *every* VRM (P1).
- **mGear** (MIT) is an open-source rigging framework for the desktop DCC. A late-2026 update added a
  redesigned **Anim Picker** and 3D onion skinning. It is a PORT reference for picker data
  layout and a control-shape library.

### 2.4 Mocap and AI motion sources (ingest, not editors)

| Service | Status (Oct 2026) | Output | Licence / ToS notes | Role for us |
|---|---|---|---|---|
| **Web auto-rigging service** | Free with a vendor account. Maintenance mode with no meaningful updates; outage in June 2025. | FBX | Characters and animations free for commercial use, but **raw files must not be redistributed** as asset packs. | #1 import source. **Never bundle its files** in the OSS repo or the Ekza registry. |
| **Plask** | Web mocap + editor + cloud collaboration. Freemium and MoCap Pro. | FBX, GLB, BVH | SaaS | Import source; partly competes as a web editor. |
| **DeepMotion** Animate 3D / SayMotion | Web, credit-based (third-party listing: from about $9/month) | FBX, BVH, GLB, MP4; VRM **import** only | SaaS | Import source. |
| **Rokoko Vision / Studio** | Free Starter (single-cam, limited seconds per month, FBX). Plus about $20–28/month. | FBX (BVH/CSV paid) | SaaS | Import source. |
| **Move.ai** Move One | iPhone single-cam, from $15/month. Gen 2 (s2) on higher tiers. | FBX, USD, MP4 | SaaS | Import source. |
| **Uthana** | Text-to-motion API; 3.0 in limited release; diffusion-v2 params (steps, CFG, seed) | FBX, GLB (also via Replicate) | SaaS / API | P2 "generate" adapter. |
| **Cartwheel** | Text/video-to-motion, 3–8 s clips, up to 240 fps | GLB, FBX | Credits | P2 adapter. |
| **Flow Studio** (ex-Wonder Studio) | Browser AI mocap + VFX; Wonder 3D (March 2026) | Scenes for common DCCs and Unreal, USD | SaaS | Not a target. |
| **HY-Motion 1.0** (Tencent, December 2025) | Open weights, 1B DiT | SMPL-like motion | **Community licence** with a large-platform (>100M MAU) exclusion | P2 self-hosted generator; check the licence. |
| **ARDY** (NVIDIA, SIGGRAPH 2026) | Code Apache-2.0; weights under NVIDIA Open Model Agreement | Motion | Mixed | P2 generator. |
| **MediaPipe Tasks Vision** + **Kalidokit** | `@mediapipe/tasks-vision` 1.1.1 (Apache-2.0); kalidokit (MIT) | Landmarks → VRM rig rotations | Permissive | P2 in-browser webcam mocap layer. |

Takeaway: **every source outputs FBX, BVH or GLB with arbitrary skeletons.** The editor
needs one robust path, *import → humanoid map → retarget → bake to clean curves → key
reduction → VRMA/GLB*. This is the most-starred capability in the VRM web space.

---

## 3. Cross-cutting lessons (what the landscape teaches)

### 3.1 Curve model: value-space tangents, not easing curves (P0)
- **Two families exist:**
  - (a) **Normalized per-segment easing**: Theatre.js, CSS, MMD VMD, Spline easing.
  - (b) **Value-space tangents per key**: the desktop DCC, Unity, the open-source DCC, Babylon, Godot, Unreal.

  Character animators expect (b): continuous slopes across keys, auto/clamped tangents,
  break/unify, and weighted handles.
- **Storage:** per channel, `(time, value, inSlope, outSlope, inWeight?, outWeight?, tangentType, broken, weighted)`.
  Default type is **Clamped Auto** (Unity) or **Auto-Clamped** (open-source DCC) to avoid
  overshoot.
- **glTF CUBICSPLINE is cubic Hermite.** For a segment `k → k+1` with
  `td = t[k+1] − t[k]` and `s = (t − t[k]) / td`:

  ```
  p(s) = (2s³ − 3s² + 1)·v[k] + (s³ − 2s² + s)·td·b[k]
       + (−2s³ + 3s²)·v[k+1] + (s³ − s²)·td·a[k+1]
  ```

  Here `b[k]` is the out-tangent and `a[k+1]` the in-tangent, both in value per second.
- **Converting a non-weighted Bézier handle to glTF:** a handle at time offset
  `±td/3` and value offset `Δv` gives the slope `m = 3·Δv / td`. Write `b[k] = m_out` and
  `a[k+1] = m_in` directly. **Weighted** handles, where the handle time offset is not
  `td/3`, make time non-linear in `s`. Hermite cannot represent them exactly, so export
  must **resample** (bake at the clip fps, LINEAR) or fit. Godot, Babylon and glTF all
  live with this.
- **Quaternion tracks in glTF:** CUBICSPLINE outputs must be normalized after
  interpolation. Most importers handle this, but **LINEAR baked keys** are the most
  compatible choice for Bevy (OMOBA), Unity and three.js. Make the export mode a setting.

### 3.2 Rotations: edit Euler, store and export quaternions (P0)
- Babylon exposes quaternion components as curves, which is unusable for animators. Godot
  cannot curve 3D rotation tracks at all. Both reference DCCs and Unreal edit Euler channels with
  a rotate order and an **Euler filter** to fix 180° flips.
- **Rule:**
  - The canonical editable data is Euler curves (with rotate order) per *control*.
  - The evaluated pose is quaternions.
  - Export bakes quaternions with hemisphere continuity (`dot(q[i], q[i−1]) < 0 → q[i] = −q[i]`).
  - Import from glTF decomposes to Euler with unwrapping, which is an Euler filter.

### 3.3 Controls are first-class, serializable data (P0)
- Unreal's shape library, the desktop DCC's NURBS circles, Cascadeur point controllers and the mGear
  picker all make the control the unit of animation, not the bone.
- **Model:**
  - `Control { id, name, shapeId ('circle' | 'square' | 'arrow' | 'sphere' …), color, size, offsetMatrix, drivenBone | constraint, channelsLocked, rotateOrder, space }`.
  - Shapes are drawn as screen-space-thick lines (`Line2` / `LineMaterial`) and picked by
    a ray against a ring-shaped proxy.
- **Rig/Setup mode vs Animate mode** (Rive). Rig edits never key.
- Keys live on control channels. Bones are evaluated from controls, then IK, then
  constraints, then baked on export.

### 3.4 Layers in the data model from day 1, UI later (P0 data / P1 UI)
- Cascadeur (alpha), Pose Studio, Reze (per-bone layering), VRMA Lab (adjustment clips),
  Unity (override + avatar mask) and the open-source DCC (layers in data, no UI) all converge on
  **base + additive/override layers with masks**.
- Store `Clip → Layer[] → ChannelCurves` from the start, even if the MVP UI shows one
  layer.

### 3.5 Interactive performance architecture (P0)
- From Reze Studio's write-up:
  - Separate stores for document and transport.
  - Selector subscriptions.
  - **Imperative hot paths** for scrub, drag and play.
  - Commit on pointer-up with snapshot-bridged undo.
- From Babylon ACE and animation-timeline-js:
  - SVG degrades with dense curves.
  - Draw dopesheet and graph on **Canvas2D** with region virtualization (only the visible
    time range). Keep DOM for chrome only.
- Use one WebGL context with drei `<View>` (scissor) for split viewports instead of
  several canvases.

### 3.6 Export fidelity: patch documents, validate by read-back (P0)
- Re-exporting a three.js scene with `GLTFExporter` loses anything without an exporter
  plugin (VRM extensions, extras, unknown extensions, exact accessors).
- `@gltf-transform/core` **also drops unregistered extensions on write**. VRM needs
  registered extension classes: `gltf-transform-vrm-extensions` (MIT) or our own.
- **Approach:**
  - Keep the original `Document`.
  - Replace or add only `animations[]` (and VRMA `VRMC_vrm_animation`).
  - `resample()` / `dedup()` / `prune()`.
  - Then **re-load the output with GLTFLoader + three-vrm**, evaluate N sample frames and
    assert pose error below a tolerance (VRMA Lab's read-back pattern).
- VRMA writing reference: the VRM Consortium's `bvh2vrma` ships
  `VRMAnimationExporterPlugin` (MIT). It writes `VRMC_vrm_animation` `specVersion "1.0"`
  with `humanoid.humanBones` but **not expressions or lookAt**, which we must add.

### 3.7 One command bus for UI, undo, collaboration and agents (P0)
- VRMA Lab's `window.vrmaLab` SDK and Cascadeur's MCP server show the 2026 trend: tools are
  scripted by agents.
- PlayCanvas Observer history and ShareDB ops show the collaboration side.
- Design every mutation as a typed command (`SetKey`, `MoveKeys`, `SetTangent`,
  `AddControl` …) that is:
  - invertible (undo),
  - serializable (Yjs transaction or op log),
  - callable from a public API.

  An MCP server then costs very little (P2).

### 3.8 Collaboration patterns (P2 feature, P0 data shape)
- **PlayCanvas:** ShareDB OT, server-authoritative, frontend-only open source.
- **Spline / Figma:** server-authoritative, property-level last-writer-wins with presence.
- **Theatre.js:** `saaz` local-first sync package (Apache-2.0) and a private sync server.
- **Reze:** collaboration on its roadmap.
- **Conclusion:**
  - Id-keyed keys (`byId`), not arrays, so concurrent inserts merge.
  - Per-control ownership/locking for "four hands on one character".
  - Presence: selection, current frame, viewport camera.
- Yjs (JS) plus **yrs** (Rust, MIT) fits a Rust realtime server such as ekza-rust-server.
  Loro (MIT) is an alternative with movable trees and built-in undo.

### 3.9 Cleanup and "directing" tools beat raw keying for mocap/AI input (P1)
- Open-source DCC: Decimate, Clean, Butterworth, Smooth.
- Reze: Simplify with tolerance.
- Cascadeur: fulcrum-based foot locking and motion cleaning.
- Text-to-VRMA: loop closing and contact-protected smoothing.
- Plask: foot lock.
- Bundle these as a **Cleanup** panel. It is the main value-add on top of free mocap and AI.

### 3.10 Motion trails, onion skin and tween sliders (P1)
- Unreal 5.6: editable trails, tween with overshoot.
- mGear: 3D onion skin.
- Open-source DCC: slider family.
- three's `AnimationPathHelper` is local-position-only, so we need our own world-space
  trail per control, sampled through the full rig evaluation.

---

## 4. Feature matrix: closest neighbours vs the Ekza Animator target

Legend: ✔ yes · ◐ partial · ✖ no · (M) = MVP target · (L) = later.

| Capability | Reze Studio | VRMA Lab | Pose Studio | Roboticela | Theatre.js | Cascadeur | **Ekza Animator** |
|---|---|---|---|---|---|---|---|
| Runs in browser, no install | ✔ | ✔ | ✔ | ✔ | ✔ | ✖ | ✔ (M) |
| Permissive OSS license | ✖ GPL | ✔ Apache | ✖ GPL | ✖ AGPL | ◐ core only | ✖ | ✔ (M) |
| glTF/GLB load + bake back into GLB | ✖ | ✖ | ✖ | ◐ export only | ✖ | ✖ | ✔ (M) |
| VRM 0.x/1.0 + VRMA import/export | ✖ | ✔ | ✖ | ✖ | ✖ | ✖ | ✔ (M) |
| Dopesheet | ✔ | ◐ | ✔ | ◐ | ✔ | ✔ | ✔ (M) |
| Graph editor, value-space tangents, break/unify, weights | ◐ VMD easing | ✖ | ✔ | ✖ | ◐ easing | ✔ | ✔ (M; weights L) |
| On-model curve controls (circles) | ✖ | ✖ | ◐ | ✖ | ✖ | ✔ | ✔ (M) |
| IK/FK + switching | ◐ engine IK | ✖ | ✔ | ✖ | ✖ | ✔ | ◐ (M two-bone) → ✔ (L) |
| Split viewports (fixed cam + free cam) | ✖ | ◐ quad review | ? | ✖ | ✖ | ✔ | ✔ (M) |
| Layers / masks | ◐ | ◐ adjustment | ✔ | ✖ | ✖ | ◐ alpha | data (M), UI (L) |
| Mirroring | ✖ (roadmap) | ✖ | ✔ | ✖ | ✖ | ✔ | (L) |
| Mocap import + cleanup | ✖ (sister app) | ✔ FBX → VRMA | ◐ | ◐ | ✖ | ✔ | ◐ (M FBX/BVH) → ✔ (L) |
| Agent / scripting API | ✖ | ✔ | ✖ | ✖ | ◐ JS API | ✔ Python, MCP | ◐ (M command bus) → MCP (L) |
| Real-time multiplayer | ✖ (roadmap) | ✖ | ✖ | ✖ | ◐ private | ✖ | (L), data-ready in M |
| Ecosystem publish (registry upload) | ◐ Reze Design | ✖ | ✖ | ✖ | ✖ | ✖ | ✔ Ekza (L) |

---

## 5. Deliverables requested by the brief

### (a) Differentiation statement

> **Ekza Animator is the open-source, browser-native character animator for glTF and VRM.**
> It brings a professional DCC-grade graph editor (value-space tangents with auto/clamped, flat,
> linear, stepped, break/unify and weighted handles, plus buffer curves) and an on-model
> control rig (curve controls constrained to bones, IK/FK) to anyone with a link.
>
> It loads any rigged GLB or VRM. Clips are edited non-destructively in layers, then either
> **baked back into the same GLB** with every other byte preserved, or exported as
> **VRMA / animation-only GLB**. Every export is validated by read-back.
>
> Mocap and AI clips (FBX incl. common auto-rigger skeletons, BVH, VRMA) come in through one retarget-and-cleanup
> pipeline.
>
> The document model is command-based and id-keyed. The same edits drive undo, scripting
> or agents, and **real-time multiplayer**: two animators on two characters, or "four
> hands" on one.
>
> It is **permissively licensed** (unlike the GPL/AGPL web neighbours) and is the
> authoring front-end of the Ekza ecosystem. Clips publish as typed assets to Ekza
> Studio/Registry and play unchanged in Ekza Space (web), OMOBA (Bevy) and Mirror (iOS).

Positioning one-liner: *"Reze Studio's speed, Cascadeur's controls, desktop-DCC curves, for
VRM/glTF, in the browser, MIT/Apache, multiplayer-ready."*

### (b) Libraries we can depend on safely (checked 2026-10-17)

**Core (DEP, permissive, actively maintained):**

| Package | Version | License | Role | Notes / risk |
|---|---|---|---|---|
| `three` | 0.186.1 | MIT | Renderer, `GLTFLoader`, `GLTFExporter`, `FBXLoader`, `BVHLoader`, `TransformControls`, `CCDIKSolver`, `SkeletonUtils.retargetClip`, `Line2` | Pin exactly. `ekza-avatar-renderer` peer range is `<0.186`, so it needs a bump before sharing (see 03-reuse audit). |
| `@react-three/fiber` | 9.8.2 | MIT | React renderer | — |
| `@react-three/drei` | 10.7.9 | MIT | `<View>` split viewports, `PivotControls`, `Line`, `Html`, `GizmoHelper` | Only import what we use; keep the hot paths outside drei. |
| `@pixiv/three-vrm` · `@pixiv/three-vrm-animation` · `@pixiv/types-vrmc-vrm-animation-1.0` | 3.5.5 | MIT | VRM 0.x/1.0 load, humanoid normalization, VRMA load (`createVRMAnimationClip`) | No VRMA *exporter*. Write our own; see bvh2vrma below. |
| `@gltf-transform/core` · `/functions` · `/extensions` | 4.5.1 | MIT | Document-level GLB surgery, `resample`, `dedup`, `prune`, binary I/O | Drops unknown extensions unless registered. No built-in `KHR_animation_pointer` / VRMC extensions. |
| `camera-controls` | 3.1.2 | MIT | Alt+drag (DCC-standard) tumble/track/dolly mapping, ortho views | — |
| `three-mesh-bvh` | 0.9.16 | MIT | Fast picking on skinned meshes | — |
| `zustand` | 5.0.15 | MIT | UI stores with selector subscriptions | Document store stays framework-agnostic. |
| `mutative` | 2.0.0 (or `immer` 11.1.21) | MIT | Immutable updates with JSON patches for undo | Pick one. |
| `yjs` · `y-protocols` · `y-indexeddb` · `y-websocket` | 13.6.33 · 1.0.7 · 9.0.12 · 3.1.0 | MIT | Collaborative document, offline cache, transport | `y-indexeddb` is old (2023) but stable. Server can be `@hocuspocus/server` 4.7.1 (MIT) or **`yrs` 0.28** (Rust, MIT) inside a Rust realtime server. |
| `dockview` / `dockview-react` | 8.6.0 | MIT | Dockable panels (desktop-DCC-like workspaces) | **Never** add `dockview-enterprise` (proprietary). Enforce with a license-allowlist CI check. |
| `react-resizable-panels` | 4.14.5 | MIT | Simple split panes (MVP alternative to dockview) | — |
| `@radix-ui/*`, `cmdk` 1.1.1, `tinykeys` 4.0.1 | — | MIT | Menus, command palette, hotkeys | — |
| `comlink` 4.4.2 · `idb-keyval` 6.3.0 | — | Apache-2.0 | Worker RPC (bake, retarget, validation off main thread) · local persistence | Keep NOTICE. |

**Evaluate, then vendor or fork (permissive but small or stale):**

| Package / source | License | Use | Risk |
|---|---|---|---|
| `gltf-transform-vrm-extensions` 0.1.10 | MIT | VRM/VRMA extension classes for glTF-Transform | One maintainer, 0.x. Vendor it with tests, or write our own. |
| `closed-chain-ik-js` (gkjohnson) | Apache-2.0 | Full-body / closed-chain IK solver | npm is stale (0.0.3, 2023) but the repo is active in 2026. Pin a git SHA or vendor it. |
| `animation-timeline-js` 2.3.5 | MIT | Canvas dopesheet reference | Last publish July 2024. Prefer our own canvas dopesheet, since it is a core differentiator. |
| `vrm-c/bvh2vrma` → `VRMAnimationExporterPlugin.ts` | MIT | VRMA writer starting point | Old three (0.153) and three-vrm 2.x. Port and extend with expressions and lookAt. |
| `M3-org/CharacterStudio` → `VRMExporter.js` | MIT | VRM 1.0 JSON reference | Scene re-export pattern (lossy). Use as reference only. |
| `@krapnik/retarget` 0.8.0 | MIT | Format-aware retarget engine | New, 0 stars. Evaluate only. |
| `fbx2vrma-converter` 1.0.2 | MIT | FBX → VRMA reference | Small. |
| `kalidokit` · `@mediapipe/tasks-vision` 1.1.1 | MIT · Apache-2.0 | Webcam mocap (P2) | Model files have their own terms. Check before bundling. |
| `@theatre/saaz` | Apache-2.0 | Local-first sync design reference | Unreleased and dormant. Read only. |

**Port-reference source code (read and port with attribution, no dependency):**
- Godot `editor/animation/animation_bezier_editor.cpp` (MIT).
- Babylon.js ACE `curveEditor/` (Apache-2.0).
- Babylon.js Editor `layout/cinematic/` (Apache-2.0).
- The open-source DCC's Khronos glTF import/export add-on, animation export (Apache-2.0).
- UniVRM VRMA exporter (MIT).
- VRM add-on for the open-source DCC (MIT).
- three.js editor (MIT).
- VRMA Lab converter and validator (Apache-2.0).
- mGear Anim Picker (MIT).

**Do NOT copy code from (DESIGN only):**
- Copyleft:
  - Theatre.js **studio** (AGPL-3.0)
  - Reze Studio, reze-engine family and MiKaPo (GPL-3.0)
  - Pose Studio (GPL-3.0)
  - Roboticela Animator (AGPL-3.0)
  - Mannequin.js (GPL-3.0)
  - The open-source DCC's core (GPL)
- No license: XR Animator / SystemAnimatorOnline (no license = all rights reserved),
  vrm-dance and the other unlicensed hobby repos.
- Proprietary or restricted:
  - Unity, Unreal, Cascadeur, Spline, Rive editor (EULAs).
  - `@tldraw/sync` (tldraw SDK license, needs a production key).
  - Liveblocks backend (SaaS). `@liveblocks/client` is Apache-2.0, but locks us into
    their service.
  - `dockview-enterprise`.
- Assets: files from the auto-rigging service (no redistribution). AI weights such as ARDY (NVIDIA Open Model
  Agreement) and HY-Motion (community licence with an MAU clause) are fine to *call*, but
  must not be bundled without legal review.

Add `CONTRIBUTING.md` rules: no code from GPL/AGPL projects, plus an SPDX-allowlist check in
CI (MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, CC0 for assets).

### (c) Names to avoid and name check

**"Ekza Animator" availability check (2026-10-17):**

| Check | Result |
|---|---|
| Web search for `"Ekza Animator"` | No product found. Nearest hit: **EZ-Animator** (HappyCat Software, Windows/Steam, released November 2024, project files use **`.eza`**). |
| GitHub repository search for `ekza animator` | 0 results. The org `ekza-space` already hosts the ekza-* repos. |
| npm `ekza-animator`, `@ekza/animator` | Not found. The **`@ekza` scope is unclaimed** (the scope lookup returns "Scope not found"). Note: `@ekza/avatar-renderer` is not published to npm either. |
| `VRM Animator` | No product with that exact name. Nearby: XR Animator (webcam mocap), VRM Posing Desktop, VRMViewMeister. |

Verdict: **"Ekza Animator" is usable.** Recommended actions:
1. Claim the npm org `@ekza` and publish a placeholder package.
2. Create the `ekza-space/ekza-animator` repo.
3. Avoid the `.eza` extension. Use `.ekza-anim.json` for project documents, or a
   `.ekzaanim` zip container.
4. If a short brand is wanted, run a quick trademark search before adopting
   "Ekza Motion" or "Ekza Anim". A formal TM search (USPTO/EUIPO/WIPO) was **not**
   performed and is advised before a public launch.

**Names and terms to avoid in the product name, logo or package names** (the docs in this
repository also describe the reference DCCs and the auto-rigging service without naming them):

| Avoid | Owner / conflict |
|---|---|
| The names of the desktop DCC, the mocap package and its full-body IK system, Flow Studio | Trademarks of the desktop DCC's vendor. Do not use its icons or UI assets either. |
| The auto-rigging service's name | Its vendor |
| Adobe Animate, Character Animator | Adobe |
| Cascadeur, AutoPosing, AutoPhysics | Nekki |
| Theatre / Theatre.js | Theatre.js |
| Spline | Spline Design. Our "spline modeling" feature is fine generically. |
| Rive | Rive Inc. |
| Plask, Rokoko, Move / Move One, DeepMotion, Animate 3D, SayMotion, Uthana, Cartwheel | Mocap/AI vendors |
| VRoid, VRoid Hub | pixiv |
| "VRM" *as the product name* (e.g. "VRM Animator") | The VRM Consortium stewards the format. Say "for VRM" or "VRM-ready" descriptively. No public logo or trademark policy was found, so ask the Consortium before using the VRM logo. |
| Sequencer, Control Rig (as capitalized product modules) | Epic feature names. Use lowercase generic "control rig" and "sequencer" in docs; name our modules differently, e.g. "Rig Controls" and "Timeline". |
| Animator (alone), Mecanim | Unity's Animator component; a historic product of that name from the desktop DCC's vendor |
| Character Studio | A historic character-animation plug-in of that name for another of the vendor's desktop DCCs **and** M3-org CharacterStudio |
| Exo… (Exo Animator, ExoRig) | **ExoTools**, a rigging/animation plug-in company (ExoSwitch for the desktop DCC). The founder's spoken "Экзо" must be romanized **Ekza**. |
| Reze, Triplex, Studio (alone) | Neighbouring OSS projects. "Ekza Studio" is already the Registry UI, so do not reuse it for the animator. |
| `.eza` file extension | EZ-Animator |

---

## 6. Recommendations (prioritised)

**P0 (architecture, MVP):**
1. **Curves:** value-space Hermite/Bézier per channel with Clamped-Auto default. Euler
   rotation curves with rotate order, baked to quaternions on export. Weighted handles
   force resampling on export.
2. **Document:** id-keyed (`byId`) keys and controls, with layered clip data
   (`Clip → Layer[] → Channel`) even if the MVP UI shows one layer.
3. **Controls** as serializable data with a shape library, and a separate **Rig mode** and
   **Animate mode**.
4. **Performance:** Reze-style store split, imperative hot paths, Canvas2D
   dopesheet/graph, and drei `<View>` for split viewports in one WebGL context.
5. **Export:** glTF-Transform *document patching* (never scene re-export) with registered
   VRM/VRMA extensions, plus **read-back validation** of every export.
6. **Commands:** one typed command bus, invertible and serializable. It feeds undo, Yjs and
   a public API.
7. **License hygiene:** pick MIT or Apache-2.0 (consider dual MIT/Apache-2.0), add an SPDX
   CI allowlist, and a CONTRIBUTING clean-room rule for GPL/AGPL neighbours.

**P1 (first public release):**
- Import FBX/BVH/VRMA → humanoid map → retarget → bake → Simplify/Decimate/Butterworth.
- Tween slider family with overshoot.
- Editable world-space motion trails.
- Mirror pose and paste.
- Universal VRM humanoid picker.
- Auto-key tint.
- Easing-preset popover.
- Contact (fulcrum-style) detection for foot lock.

**P2 (later):**
- Multiplayer (Yjs + yrs/Hocuspocus) with presence and per-control locks.
- MCP server.
- Webcam mocap layer.
- AI generation adapters (Uthana/Cartwheel API, self-hosted HY-Motion/ARDY after licence
  review).
- Lattice key deform.
- Space switching.
- Pose library.
- Event and sound tracks.
- Spline modeling.

---

## 7. Sources

Web tools and libraries
- Theatre.js repo and license split: https://github.com/theatre-js/theatre · docs (sequences, graph editor): https://www.theatrejs.com/docs/0.5/manual/sequences · npm metadata (`@theatre/core` 0.7.2 Apache-2.0, `@theatre/studio` 0.7.2 AGPL-3.0-only, last modified 2024-05-19) via `npm view`
- Babylon.js ACE announcement: https://forum.babylonjs.com/t/animation-curve-editor-ace-announcement/26095 · maintenance thread: https://forum.babylonjs.com/t/could-animation-curve-editor-get-a-bit-of-tender-loving-care/60585 · source: https://github.com/BabylonJS/Babylon.js/tree/master/packages/dev/inspector/src/components/actionTabs/tabs/propertyGrids/animations/curveEditor
- Babylon.js Editor (Apache-2.0): https://github.com/BabylonJS/Editor
- three.js editor Animation panel PR #32869: https://github.com/mrdoob/three.js/pull/32869 · `AnimationPathHelper`: https://github.com/mrdoob/three.js/blob/dev/examples/jsm/helpers/AnimationPathHelper.js · forum: https://discourse.threejs.org/t/is-there-a-timeline-editor-for-keyframetrack/23568
- PlayCanvas editor open source (MIT): https://blog.playcanvas.com/playcanvas-editor-frontend-is-now-open-source · https://github.com/playcanvas/editor · Anim State Graph: https://blog.playcanvas.com/introducing-the-anim-state-graph/ · timeline request: https://forum.playcanvas.com/t/a-proper-animation-timeline-tool-in-the-editor/33767
- Spline Timeline (2025-09-18): https://blog.spline.design/introducing-3d-timeline-animation · https://docs.spline.design/designing-in-3-d/timeline-animation
- Rive design vs animate mode: https://rive.app/docs/editor/fundamentals/design-vs-animate-mode · runtimes MIT: https://github.com/rive-app/rive-runtime
- TiXL (ex-Tooll3) MIT, 4.2 curve change: https://github.com/tixl3d/tixl · https://newreleases.io/project/github/tixl3d/tixl/release/v4.2.0.3
- animation-timeline-js (MIT): https://github.com/ievgennaida/animation-timeline-control
- dockview licensing (MIT + proprietary enterprise): https://github.com/mathuo/dockview

Web humanoid / VRM / MMD tools
- Reze Studio: https://github.com/AmyangXYZ/reze-studio · https://reze.studio
- VRMA Lab: https://github.com/YuBan834/vrma-lab · https://www.producthunt.com/products/vrma-lab
- Pose Studio: https://github.com/iirg4x/pose-studio
- Roboticela Animator: https://github.com/Roboticela/Animator
- Mannequin.js: https://github.com/boytchev/mannequin.js
- M3-org CharacterStudio: https://github.com/M3-org/CharacterStudio
- Text-to-VRMA: https://github.com/Kirakun0328/text-to-vrma · ARDY: https://github.com/nv-tlabs/ardy
- bvh2vrma (VRM Consortium): https://github.com/vrm-c/bvh2vrma
- VRM Animation spec page: https://vrm.dev/en/vrma/ · Khronos × VRM Consortium: https://khronos.org/news/press/the-khronos-group-and-vrm-consortium-collaborate-to-advance-international-standardization-of-the-vrm-3d-avatar-file-format
- VRM Posing Desktop: https://store.steampowered.com/app/1895630/VRM_Posing_Desktop · review summary: https://vaporlens.app/app/1895630/vrm_posing_desktop
- VRMViewMeister docs: https://nishlumi-vrmviewmdoc.readthedocs.io/en/latest/
- XR Animator: https://github.com/ButzYung/SystemAnimatorOnline
- three-vrm: https://github.com/pixiv/three-vrm · UniVRM: https://github.com/vrm-c/UniVRM · VRM add-on for the open-source DCC (saturday06, MIT; URL omitted)

Desktop and engine references
- Open-source DCC: Graph Editor editing operators (user manual, current) · Actions/slots (user manual, 5.0) · Khronos glTF import/export add-on (Apache-2.0); URLs omitted
- Godot animation track types: https://docs.godotengine.org/en/4.2/tutorials/animation/animation_track_types.html · bezier editor source: https://github.com/godotengine/godot/blob/master/editor/animation/animation_bezier_editor.cpp · Bezier on 3D tracks: https://forum.godotengine.org/t/is-there-a-way-to-animate-3d-bones-with-bezier-curves-in-godot-4/5713
- Unity curves and tangents: https://docs.unity3d.com/Manual/EditingCurves.html
- Unreal 5.6: https://www.unrealengine.com/news/unreal-engine-5-6-is-now-available · https://www.cgchannel.com/2025/06/unreal-engine-5-6-five-key-features-for-cg-artists/
- Cascadeur 2026.2: https://www.cgchannel.com/2026/08/nekki-releases-cascadeur-2026-2-with-animation-layers/ · 2026.1: https://gamefromscratch.com/cascadeur-2026-1-released/ · Fulcrum points: https://cascadeur.com/help/tools/physics_tools/autophysics/fulcrum_points
- mGear: https://github.com/mgear-dev/mgear

Mocap / AI
- Auto-rigging service status 2026: https://app.cinevva.com/guides/free-character-animations-rigging (secondary source, vendor-affiliated)
- Plask: https://www.awn.com/news/plask-launches-namesake-cloud-based-motion-capture-tool · https://80.lv/articles/plask-ai-s-freemium-mocap-pro-payment-plans-get-upgraded
- DeepMotion: https://us.fitgap.com/products/009151/deepmotion (third-party)
- Rokoko pricing: https://www.rokoko.com/pricing
- Move.ai: https://www.move.ai/pricing · https://docs.move.ai/knowledge/move-ai-pricing-plans-credits
- Uthana: https://uthana.com/docs/api/changelog · https://uthana.com/blog/text-to-motion-30-sets-a-new-bar-for-ai-animation
- Cartwheel: https://www.scenario.com/models/cartwheel-text-to-motion
- Flow Studio generative-AI update: CG Channel, 2026-03 (URL omitted)
- HY-Motion 1.0: https://arxiv.org/abs/2512.23464v1 · https://cgworld.jp/flashnews/01-202601-HY-Motion.html
- Kalidokit: https://github.com/yeemachine/kalidokit · MediaPipe: https://github.com/google-ai-edge/mediapipe

Name checks
- EZ-Animator (`.eza`): https://happycatsoftware.itch.io/ez-animator
- ExoTools: https://crunchbase.com/organization/exotools · Lester Banks tutorial tag page on desktop-DCC constraint tools (URL omitted)
- npm registry lookups (`ekza-animator`, `@ekza/animator`, scope `@ekza`) and GitHub repository search on 2026-10-17.

Package versions and licenses in section 5(b) come from `npm view <pkg> version license time.modified` on 2026-10-17. GitHub license and activity data comes from the GitHub REST API on the same date.
