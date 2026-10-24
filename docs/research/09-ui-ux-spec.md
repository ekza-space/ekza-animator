# 09 — UI/UX Specification (professional DCC-grade animation UI for the web)

| | |
|---|---|
| Status | Research / proposed spec (v0.1) |
| Date | 2026-10-17 |
| Scope | Layout, panels, interactions, viewport UX, hotkeys, design tokens, docking & workspaces, onboarding, import/export dialogs, accessibility, collaboration affordances, React component tree and state ownership |
| Out of scope | Curve math/export internals, rig solver, network protocol (covered by sibling research docs); here only where the UI depends on them |
| Primary target | Desktop Chromium (Chrome/Edge/Arc) on macOS, Windows, Linux; Firefox and Safari supported with known gaps listed in §7.6 |

Reading guide: §1 principles, §2–3 layout, §4 panels, §5 viewport, §6 interaction rules, §7 hotkeys, §8 design system, §9 docking/workspaces, §10 onboarding/import/export, §11 accessibility, §12 collaboration, §13 implementation (component tree + state), §14 MVP cut, §15 open questions, §16 sources.

---

## 1. Design principles

1. **DCC muscle memory first, browser reality second.** Default hotkeys, navigation, Channels panel colours, time-slider behaviour and Graph Editor semantics follow a leading commercial desktop DCC ("the desktop DCC" below) wherever the browser allows. Every divergence is listed (§7.5) and is rebindable.
2. **Animate controls, not bones.** In the Animate workspace the selection mask defaults to *controls only*. Bones and meshes are visible but not pickable unless the mask is changed.
3. **The panel under the pointer receives the hotkey** (desktop-DCC convention). `F` frames whatever the panel under the cursor shows: the viewport frames the selection, the Graph Editor frames the selected keys.
4. **No modal dialogs while animating.** Option boxes are non-blocking popovers. Destructive operations are undoable and announced by a toast. Only file import/export and preferences open as dialogs.
5. **Precision always available.** Every drag has a numeric twin: the Channels panel, the Graph Editor stats fields and the time field. Fields accept relative expressions (`+=5`, `*1.1`, `-=90`).
6. **Dense but legible.** 12 px UI text, 22 px rows, mid-dark neutral greys. These pass WCAG 2.2 AA contrast (§8.3). They are not near-black: long sessions and mid-tone model readability matter more than brand mood.
7. **One command registry.** Menus, marking menus, toolbar buttons, the command palette and hotkeys all call the same command IDs. This gives one place for labels, enabled state, undo and docs.
8. **Ready for collaboration without being shaped by it.** Selection, cursor, playhead and camera are per-user state from day one. Collaboration later broadcasts these values; it does not change who owns them (§12, §13).
9. **Ready for modeling later.** The workspace/pane/tool architecture is generic: a future "Model" workspace adds tools and a component-selection mode without changing the shell (§9.4).

### 1.1 Desktop-DCC UI → Ekza Animator mapping

| Desktop-DCC element | Ekza decision | Notes |
|---|---|---|
| Main menu bar + menu sets (F2–F6) | **Keep a single menu bar**, no menu sets | Workspaces replace menu sets; F-keys are unreliable on Mac laptops |
| Status Line | **Keep** as a compact *Status line / tool strip* | Tools, manipulator space, snapping, selection mask, key target, auto-key, tween slider |
| Shelf | **Later** (user "Shelf" of pinned commands) | Command palette (`Mod+K`) covers discoverability in the MVP |
| Tool Box (Q/W/E/R) | **Merged into the Status line** | Saves a 40 px column |
| Panel menus + Panel toolbar | **Keep** per viewport pane (header row) | Camera, Shading, Show, Lock, Bookmarks, Isolate, Maximize |
| Quick Layout buttons | **Keep** (layout preset picker + `Shift+[` / `Shift+]`) | §3 |
| Channels | **Keep, faithful** (including the field colour states) | §4.5 |
| Attribute Editor | **Keep** as a second tab of the right panel | Control/Bone/Constraint/Clip/Character sections |
| Outliner | **Keep** | Adds a *Clips* tab |
| Time Slider + Range Slider + playback controls | **Keep, faithful** | Adds a clip selector and an fps menu |
| Help Line / Command Line | **Help Line kept** (hints, status); command line → command palette | Script console later |
| Quick Menu (hold Space) | **Simplified**: Space-hold radial for pane type and camera | Full Quick Menu later |
| Marking menus | **Keep** (hold key + LMB, RMB in panels) | §7.4 |
| Graph Editor | **Keep, faithful core** plus a pen tool and a tween slider | §4.7 |
| Dope Sheet | **Keep** (the desktop DCC's 2025 release added ripple edit and precision mode; ripple edit included) | §4.8 |
| Ghost Editor | **Onion-skin popover** | §5.6 |
| Time Editor / Trax, Animation Layers | **Later** | The state model leaves room (clips are first-class) |
| Blue Pencil | **Later** (2D sketch layer per camera) | |

---

## 2. Global layout — default "Animate" workspace

Reference frame 1440×900 CSS px (works from 1280×720; §11.2 covers smaller sizes).

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │◆ Ekza Animator  File Edit Select Key Playback Rig Display Windows Help     [Animate|Rig|Review|Model]  ◐◑ [Export]│ 28 menu bar
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │[▸Q][✥W][⟳E][⤡R]│Space[Object▾]│J Snap│Mask ◯Ctl ⚬Jnt ▢Mesh│Key[Selected▾] ●Auto│Tween ◀━━━●━━━▶│[▥ Layout▾]│ 32 status line
 ├───────────────┬──────────────────────────────────┬──────────────────────────────────┬────────────────────┤
 │Outliner│Clips │ shotCam▾ 🔒 Shading▾ Show▾ ⧉ ◎  ⤢ │ persp▾ 🔓 Shading▾ Show▾ ⧉ ◎    ⤢ │ Channels │ Attrs   │
 │⌕ filter…      │┌────────────────────────────────┐│                                  │ l_wrist_ctl  XYZ▾  │
 │▾ Scene        ││                                ││                                  │ Translate X    0.00│
 │ ▾ ☺ Hero (VRM)││           O                    ││              O                   │ Translate Y    0.00│
 │  ▾ Rig        ││          /|\   ◯ ← circle ctl  ││             /|\  ◯               │ Translate Z    0.00│
 │   ◯ root_ctl  ││          / \                   ││             / \                  │ Rotate X  ▌  12.50 │ ▌= keyed (red)
 │   ◯ cog_ctl   ││                                ││                          ┌───┐   │ Rotate Y  ▌ -40.00 │
 │    ◯ hips_ctl ││   [ 16:9 safe frame ]          ││                          │ ⊕ │   │ Rotate Z  ▌   3.20 │
 │    ◯ spine_c… │└────────────────────────────────┘│ persp                    └───┘   │ ── Custom ──        │
 │  ▸ Skeleton   │ shotCam · LOCKED          f 24   │                          f 24    │ IK/FK          1.00│
 │  ▸ Meshes     │                                  │                                  │ Space      [world▾]│
 │ ▸ Cameras     │                                  │                                  │                    │
 ├───────────────┴──────────────────────────────────┴──────────────────────────────────┴────────────────────┤
 │ Graph Editor │ Dope Sheet                                                                     ⤢  ⌄      │ dock tabs
 │ [Q][W][R][✎I] Frame[ 24 ] Value[ 12.500 ] │[A][S][C][⟋][—][⌐][⌒]│[⟂][∥]│[≈][▤]│Buffer[◫][⇄]│t⊡ v⊡          │
 │ ⌕ channels   │ 40 ┤                ╭──╮                                                              │
 │ ▾ l_wrist_ctl│ 20 ┤    ■────╮     ╱    ╲          ■ keys, ○ tangent handles                         │
 │  ■ Rotate X  │  0 ┼───╱──────╲───╱──────╲────────■──────────────── playhead ▌                        │
 │  ■ Rotate Y  │-20 ┤ ■╱        ╰─■                                                                    │
 │  ■ Rotate Z  │    └──┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────                    │
 │              │       0    10   20   30   40   50   60   70   80   90  100  110                         │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │0    5    10   15   20  ▌24   30   35   40   45   50   55   60   65   70   75   80   85   90   95  100 │[ 24]│ 30 time slider
 │|    |    ▮    |    |   ▌    ▮    |    |    ▮    |    |    ▮    |    |    |    |    |    |    |    |   │     │
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │[  0][  1]◀━━━━━━━━━━━━━━[  1 ═════════ 120 ]━━━━━━━━━━━━━━▶[120][120]│Clip[walk ▾] 30fps▾│⏮ ⇤ ◀| ◀ ▶ |▶ ⇥ ⏭│↻ 1×▾│ 28 range slider
 ├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Alt+LMB tumble · Alt+MMB track · Alt+RMB dolly · S set key                  Saved 12:41 · 60/30 fps · 3 keys│ 22 help line
 └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Region sizing

| Region | Default | Min | Max / behaviour |
|---|---|---|---|
| Menu bar | 28 px | fixed | always visible (hidden in Zen mode, `Shift+Space`) |
| Status line | 32 px | fixed | groups collapse to icon-only below 1280 px |
| Left dock (Outliner / Clips) | 240 px | 180 px | collapsible to a 36 px icon rail |
| Center (viewport panes) | flex | 240×180 per pane | — |
| Right dock (Channels panel / Attributes) | 280 px | 220 px | collapsible to a rail |
| Bottom dock (Graph Editor / Dope Sheet) | 36 % of the content height | 160 px | `⌄` collapses to the tab strip; `⤢` maximizes |
| Time slider | 30 px (+8 px when bookmarks or an audio track exist) | fixed | — |
| Range slider + playback | 28 px | fixed | — |
| Help line | 22 px | fixed | hideable |

Vertical budget at 900 px: chrome (28+32+30+28+22) = 140 px; viewports ≈ 456 px; graph dock ≈ 304 px.

---

## 3. Viewport layout presets

Every *pane* is a dock panel of type `viewport | graph | dopesheet | outliner`, so its type can change from its header (`Panel ▾`), like the desktop DCC's *Panels › Panel* menu and the editor-type menu of a popular open-source DCC. Presets are named layout JSONs (§9).

| # | Preset | Shape | Default use |
|---|---|---|---|
| P1 | **Single** | `[persp]` | General work, small screens |
| P2 | **Split (shot \| free)** | `[shotCam 🔒 \| persp]` vertical split, 50/50 | The owner's main request: left pane = locked camera framing the pose, right = free tumbling |
| P3 | **Split + Graph** *(Animate default)* | P2 on top, Graph Editor/Dope Sheet tabbed below | Blocking → splining |
| P4 | **Four view** | `top \| persp` / `front \| side` | Classic DCC layout, rig checks |
| P5 | **Graph focus** | small persp (30 %) left + Graph Editor (70 %) right, Dope Sheet tab | Curve polishing |
| P6 | **Review** | shotCam large + persp thumbnail (25 %, floating), timeline only | Playback review, later shared review |

```
P1            P2                 P3 (default)        P4               P5                 P6
┌────────┐    ┌────┬────┐        ┌────┬────┐         ┌────┬────┐      ┌───┬──────────┐   ┌────────────┐
│ persp  │    │shot│pers│        │shot│pers│         │top │pers│      │per│  Graph   │   │  shotCam ┌─┤
│        │    │ 🔒 │    │        ├────┴────┤         ├────┼────┤      │sp │  Editor  │   │          │p│
│        │    │    │    │        │ Graph/DS│         │frnt│side│      │   │          │   │          └─┤
└────────┘    └────┴────┘        └─────────┘         └────┴────┘      └───┴──────────┘   └────────────┘
```

Rules:

- `Space` *tap* (< 200 ms, no other key) toggles **maximize** for the pane under the pointer (desktop-DCC tap-Space). Double-clicking a pane's tab does the same.
- `Shift+[` / `Shift+]` cycle the presets (the desktop DCC's `Shift+{` / `Shift+}`).
- Changing preset keeps each pane's camera and display flags when a pane with the same id exists in the new preset.
- The shot camera is a **scene object** (`shotCam`, saved in the project, visible in the Outliner). A pane only *looks through* it, so locking or unlocking it is per pane and the camera itself is shared.

---

## 4. Panels — detailed behaviour

### 4.1 Menu bar

| Menu | Items (MVP **bold**) |
|---|---|
| File | **New project**, **Open…** (`Mod+O`), **Open recent ▸**, **Import model…**, **Import animation…** (`Mod+I`), **Save** (`Mod+S`, to browser storage + download), **Save as…**, **Export…** (`Mod+E`), Publish to Ekza… (stub, §10.5), **Project settings** (fps, units) |
| Edit | **Undo/Redo**, **Cut/Copy/Paste** (context: pose or keys), **Paste mirrored**, **Delete**, **Select all**, Repeat last (`G`, later), **Preferences…**, **Hotkeys…** |
| Select | **All controls (character)**, **Hierarchy below**, **Mirror counterpart**, **Invert**, **Selection mask ▸**, Selection sets ▸ (later) |
| Key | **Set key** (`S`), **Set breakdown** (`Alt+S`), **Key translate/rotate/scale** (`Shift+W/E/R`), **Delete keys at current frame**, **Copy/Paste keys**, **Auto-key** (`Shift+K`), **Default tangents ▸**, **Bake simulation ▸** (constraints → keys) |
| Playback | **Play/Stop** (`Alt+V` / `Esc`), **Go to start/end**, **Next/prev key/frame**, **Loop ▸ Once / Loop / Ping-pong**, **Speed ▸**, **Snap to frames** |
| Rig | **Auto control rig (VRM humanoid)**, **Add control to bone…**, **Edit control shape…**, **Constraint ▸ Parent/Orient/Point**, **Mirror controls L→R**, **Reset to rest pose**, IK/FK (later) |
| Display | **Shading ▸**, **Show ▸** (meshes/joints/controls/grid/cameras/HUD), **X-ray**, **Onion skin…**, **Safe frame**, **Background ▸**, Motion trail (later) |
| Windows | **Graph Editor**, **Dope Sheet**, **Outliner**, **Clips**, **Channels**, **Attributes**, **Layout presets ▸**, **Reset workspace**, History (later), Console (later) |
| Help | **Shortcuts** (`?`), **Getting started**, **Docs**, **Report a bug**, **About / licences** (sample asset attributions) |

Top-right of the menu bar: workspace tabs (§9.3), presence avatars (later, §12) and a primary **Export** button.

### 4.2 Status line (tool strip)

Left to right, each group separated by a 1 px divider:

1. **Tools**: Select `Q`, Move `W`, Rotate `E`, Scale `R` (toggle group; the active tool is accent-filled). Hold the key + LMB for its marking menu.
2. **Manipulator space** dropdown, contextual to the tool: Move = Object / World / Parent; Rotate = Object / World / Gimbal; Scale = Object.
3. **Snap**: `J` hold = temporary snap; click to make sticky. Popover sets steps (rotate 15°, move 0.1 m, scale 0.1).
4. **Selection mask**: toggles for Controls ◯, Joints ⚬, Meshes ▢, Cameras. Animate default = Controls only.
5. **Key target**: `Selected` / `Character` (all controls of the active character) / `Keying set ▸` (later).
6. **Auto-key** toggle (red dot when on; the time slider border turns red too, a desktop-DCC convention).
7. **Tween slider** (Phase 1.5): drag −100…+100 % to blend the selected controls between the previous and next key at the current frame. Release sets a key. Modes: Tween / Blend-to-neighbour / Ease / Push-pull. These animator-favourite tools ship in Houdini's animation toolbar and the open-source DCC's graph slider; they are not desktop-DCC defaults.
8. **Layout preset** picker (P1–P6 thumbnails).

### 4.3 Outliner (left dock, tab 1) and Clips (tab 2)

**Outliner tree**

```
⌕ filter…                          [◯][⚬][▢][⚙]   ← type filters: controls / joints / meshes / options
▾ Scene
  ▾ ☺ Hero (VRM 1.0)          👁 🔒        ← character node: visibility, lock, (later) owner avatar
    ▾ ⊙ Rig
      ◯ root_ctl
      ▾ ◯ cog_ctl
        ◯ hips_ctl …                      ← controls coloured by side (L blue / R red / C yellow)
    ▸ ⚬ Skeleton (54)                     ← bones, VRM humanoid name as secondary text
    ▸ ▢ Meshes (3)
    ▸ ☻ Expressions (VRM)                 ← blendshape/expression channels (keyable later)
  ▸ 🎥 Cameras  (persp, top, front, side, shotCam)
  ▸ ☀ Lights
```

| Interaction | Behaviour |
|---|---|
| Click / Shift / Mod / Mod+Shift | Replace / toggle / remove / add (§6.1). Selection is synced with the viewport both ways |
| Double-click name, `F2` | Rename (controls, clips, cameras; bones are read-only in Animate) |
| Hover row | Pre-selection highlight in all viewports (outline in `--sel-hover`) |
| Arrow keys (focused) | Tree navigation (ARIA tree): ↑/↓ move, ← collapse / go to parent, → expand / go to child, Enter select |
| `/` (pointer over panel) | Focus the filter field. Filter matches names and VRM humanoid names (`leftHand`) |
| `F` (pointer over panel) | Scroll to the selection |
| Drag | No re-parenting in Animate (rig hierarchy is locked); drag to a viewport frames the item |
| Context menu (RMB) | Select hierarchy, Frame, Hide/Show, Isolate, Rename, Copy name, Reset pose (control), Create control here (bone, opens Rig workspace) |

**Clips tab** — clips are first-class because the product edits GLB/VRM clips:

| Column | Notes |
|---|---|
| ● active | radio; the active clip drives the timeline. Also selectable in the timeline's `Clip ▾` |
| Name | inline rename, validated (unique per character, ≤ 64 chars, `[A-Za-z0-9 _.-]`) |
| Character | owner character |
| Range / length | `1–120 · 4.0 s` |
| fps | authoring grid (glTF stores seconds) |
| Loop | flag stored in extras for consumers |
| Source | `embedded` (from the GLB), `imported` (VRMA/GLB), `library` (Ekza shared clip), `new` |
| Export | `bake into model` ✓ and/or `separate .vrma/.glb` ✓ (§10.4) |
| ✱ | dirty indicator |

Actions: New, Duplicate (`Mod+D`), Delete, Import…, **From Ekza clip library ▸** (`idle`, `walk`, `attack`, `cast`, `death`, the CC0 set already shipped by `ekza-avatar-renderer`; imported as editable baked keys).

### 4.4 Viewport pane

**Header (22 px, one row)**

```
[Panel▾] 🎥 persp ▾ │ 🔒 │ ⌖ Bookmarks ▾ │ Shading ▾ │ Show ▾ │ ◐X-ray ⚬Joints ◯Ctrls ⧉Onion │ ◎ Isolate │ ⤢
```

- `🎥 camera ▾`: persp / top / front / side / shotCam / user cameras, **Look through selected**, **New camera from view**, **Copy view → shotCam**. The last is the fastest way to set up the locked pane: frame in persp, then copy.
- `🔒` lock (§5.3); `⌖` bookmarks (§5.4); `◎` isolate (`Shift+L`); `⤢` maximize.
- Header icons collapse into `Show ▾` when the pane is narrower than 520 px.

**HUD (in the canvas, DOM overlay, `pointer-events: none` except the gizmo)**

| Corner | Content |
|---|---|
| top-left | camera name; a `LOCKED` badge (amber) when locked; `ISOLATE` badge |
| top-right | navigation gizmo (§5.5), 72 px |
| bottom-left | axis triad (world orientation), 40 px |
| bottom-right | current frame `f 24` (tabular figures); in shot cameras optionally `24 / 120` + timecode |
| centre (transient) | drag readouts (Δ values, degrees), lock-attempt flash, drop-zone overlay |

**Safe frame** (shot cameras): mask outside the target aspect (16:9 default; 1:1, 9:16, 4:3, custom) at 60 % `--bg-app`, plus a 1 px title-safe guide. The ratio is stored on the camera, so a later export or playblast uses the same frame.

### 4.5 Channels panel (right dock, tab 1)

```
 l_wrist_ctl                 ✎ (rename)   Rotate order [XYZ▾]
 ───────────────────────────────────────────────────────────
 Translate X   [      0.000 ]
 Translate Y   [      0.000 ]
 Translate Z   [      0.000 ]
 Rotate X     ▐[     12.500 ]   ← red background: key on this frame
 Rotate Y     ▐[    -40.000 ]   ← dark pink: keyed, not on this frame
 Rotate Z     ▐[      3.200 ]   ← light pink: value changed since the key (unkeyed edit)
 Scale X/Y/Z   [ 1.000 ] (hidden for controls whose scale is locked)
 ─ Custom ─
 IK/FK         [      1.000 ]
 Space         [ world     ▾]   (enum channel; keyable as stepped)
 ───────────────────────────────────────────────────────────
 Constraints:  orient → l_hand (w 1.0)          [Attr ▸]
```

**Field state colours** (background fill of the value field; mirrors the desktop DCC so the habits carry over; its documentation lists locked grey, non-keyable light grey, muted brown, blended green, keyed-on-frame red, keyed-off-frame dark pink, key-altered light pink, expression purple, constrained blue, connected yellow):

| State | Token | Fill / text | Contrast |
|---|---|---|---|
| Keyed, key on current frame | `--cb-keyed-on` | `#c8323c` / `#ffffff` | 5.28 |
| Keyed, not on current frame | `--cb-keyed-off` | `#7a2e3a` / `#f3d6db` | 6.78 |
| Key altered (value ≠ curve) | `--cb-altered` | `#f2a5b8` / `#1b1c1f` | 8.80 |
| Breakdown on current frame | `--cb-breakdown` | `#23784e` / `#ffffff` | 5.43 |
| Muted | `--cb-muted` | `#7a5a2e` / `#f1e6d4` | 5.11 |
| Locked | `--cb-locked` | `#33353c` / `#a3a8b2` | 5.13 |
| Non-keyable | `--cb-nonkeyable` | `--bg-field` / `--text-3` | ≥ 5.5 |
| Constrained | `--cb-constrained` | `#3a62c4` / `#ffffff` | 5.64 |
| Driven / connected | `--cb-connected` | `#b8921f` / `#1b1c1f` | 5.82 |
| Expression (later) | `--cb-expression` | `#7a4fd6` / `#ffffff` | 5.36 |
| Remote user editing (later) | `--presence-<n>` | 2 px left bar in the user colour | — |

A state is never shown by colour alone: a 3 px left bar shape (`▐` solid = on-frame key, `▏` thin = off-frame, `◇` outline = breakdown) and a tooltip ("Keyed at f24") repeat it (§11.3).

**Interactions**

| Input | Behaviour |
|---|---|
| Click name | Select the channel (highlights its curve in the Graph Editor). Drag down the names to multi-select; Shift / Mod modify |
| Click value | Edit. `Enter` commits, `Esc` reverts, `Tab` / `Shift+Tab` move to the next field |
| Typed value | Absolute or relative expression: `+=10`, `-=5`, `*2`, `/2`. With several objects selected, it applies to every selected object's channel |
| **Virtual slider** | Drag a channel name horizontally (as in the open-source DCC, trackpad-friendly) **or** MMB-drag anywhere on the rows (the desktop DCC uses Ctrl+MMB; plain MMB is free here). Rate: 0.01 units/px or 0.5°/px; `Shift` ×0.1, `Mod` ×10. Uses Pointer Lock when available (infinite drag) and falls back to pointer capture |
| ↑ / ↓ in a field | ±step (`Shift` ×10, `Alt` ×0.1) |
| Mixed values | Shown as `—` (indeterminate); typing writes all |
| RMB on channels | **Key selected**, **Breakdown selected**, **Delete keys**, **Mute/Unmute**, **Lock/Unlock**, **Hide**, **Reset to default**, **Copy/Paste values**, Select connection, Break connection (later) |

**Rotations** are shown as Euler degrees in the control's rotate order, because animators need Euler curves. Quaternions appear read-only under Attributes › Bone. The Euler→quaternion conversion and the Euler filter on bake belong to the curve/export doc.

### 4.6 Attributes (right dock, tab 2)

Collapsible sections, contextual to the lead selection:

| Section | Fields |
|---|---|
| Control | shape (library picker), size, line width, colour (side-auto / custom), offset rotation, *pickable*, mirror partner |
| Constraint | type (parent/orient/point), target bone, weight, maintain offset; "Bake to keys" |
| Bone | name, VRM humanoid bone, parent, rest pose (read-only quaternion + Euler), rotation limits (later) |
| Clip | name, fps, range, loop, export targets, root motion (in place / keep hips XZ) |
| Character | name, format (glTF / VRM 0.x / VRM 1.0), height, **licence badge from VRM meta** (§10.3), author/credits |
| Camera | focal length (mm) ↔ vertical FOV `fov = 2·atan(sensorH / (2·f))` (sensor 24 mm → 35 mm ≈ 37.8°), near/far, safe-frame aspect, lock |

### 4.7 Graph Editor

Available as the bottom dock tab **and** as a pane type (any pane can become a Graph Editor).

```
┌ Graph Editor ── Edit View Select Curves Keys Tangents List Show ───────────────────────────── ⤢ ✕ ┐
│[▸Q][✥W][⤡R][✎I] │Frame[  24.0 ] Value[ 12.500 ] Angle[ 32.1° ]│[A][S][C][⟋][—][⌐][⌒]│[⟂][∥][⚖]│
│[≈ Norm][▤ Stack]│Buffer[◫ snap][⇄ swap]│Infinity[∞]│Snap t⊡ v□│Auto-load ⊡│Tween ◀━●━▶            │
├──────────────┬──────────────────────────────────────────────────────────────────────────────────────┤
│⌕ channels…   │   50 ┤                                                                                │
│▾ l_wrist_ctl │      │            ○─■─○                                ← selected key (yellow) + handles│
│ 👁 ■ Rotate X │   25 ┤          ╱      ╲                                                             │
│ 👁 ■ Rotate Y │      │    ■───╱         ╲        ■                                                    │
│ 👁 ■ Rotate Z │    0 ┼───╱──────────────╲─────╱─────────────────▌playhead                          │
│▸ l_elbow_ctl │      │  ╱                 ■───╯                     ┆ ┄ ┄ infinity (dotted)            │
│▸ cog_ctl     │  -25 ┤ ■                                                                              │
│              │      ░░░░ outside playback range (shaded) ░░░░                                        │
│[only animated]│     └────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────                 │
│              │          0     10    20    30    40    50    60    70    80    90   100               │
└──────────────┴──────────────────────────────────────────────────────────────────────────────────────┘
```

**Toolbar**

| Group | Controls | Notes |
|---|---|---|
| Tools | Select `Q`, Move `W`, Scale `R`, **Pen** `I` | Pen = Insert Keys + Add Keys (desktop-DCC tools) + Illustrator-style handle pulling (below) |
| Stats fields | Frame, Value, Angle (degrees), Weight (weighted curves only) | Expressions accepted. Multi-selection shows `—` and applies relative input to all |
| Tangent type | Auto, Spline, Clamped, Linear, Flat, Stepped, Plateau (+ Stepped Next, Fixed in the menu) | Same set as the desktop DCC's Tangents menu |
| Tangent edit | Break `⟂`, Unify `∥`, Weighted `⚖` (curve-level), Lock/Free length (menu) | Unify keeps the new angle (desktop-DCC convention) |
| View | Normalize `≈` (each curve mapped to −1…1), Stacked `▤` (one lane per curve), Absolute (default) | Desktop DCC: Absolute / Stacked / Renormalize |
| Buffer | Snapshot `◫`, Swap `⇄` (+ menu: Blend to buffer slider, later) | Desktop DCC: Buffer Curve Snapshot / Swap Buffer Curve |
| Infinity | Pre/Post: Constant, Linear, Cycle, Cycle with offset, Oscillate; "show infinity" toggle | Export bakes within the clip range |
| Snap | Time snap (on: integer frames), Value snap (off) | Desktop-DCC defaults |
| Auto-load | Follow the viewport selection (on) / pin the current channel set (off) | Desktop DCC: "Auto Load Selected Objects" |

**Channel list (left, 200 px, resizable)**

- Tree: character › control › channel. Swatch colour = channel colour (X red, Y green, Z blue, others cyan/neutral; §8.2). Name text stays `--text` for contrast; the colour sits in the swatch.
- Per row: `👁` show curve, lock (no edits), mute, **solo** (`Alt`-click isolates one channel).
- Click selects the channel and shows its curve; Shift/Mod modify; **double-click** selects all keys of that curve. Filter field and "only animated" toggle.

**Curve view: coordinate model**

```
screenX = (frame − viewFrame0) · sx            sx = px per frame
screenY = H − (value − viewValue0) · sy         sy = px per value unit
normalized mode: v' = 2·(v − min_c)/(max_c − min_c) − 1   (per curve c; flat curves → 0)
```

- Grid: frame step = smallest of {1, 2, 5, 10, 20, 50, 100…} giving ≥ 48 px spacing (integer frames only). Value step uses "nice numbers" {1, 2, 5}·10ⁿ for ≥ 32 px. Major lines every 5th step.
- Drawing a segment between keys (t₀,v₀) → (t₁,v₁) with out-slope m₀ and in-slope m₁ (value per frame), Δ = t₁ − t₀:
  `P0=(t₀,v₀)  P1=(t₀+Δ/3, v₀+m₀·Δ/3)  P2=(t₁−Δ/3, v₁−m₁·Δ/3)  P3=(t₁,v₁)` → `ctx.bezierCurveTo`.
  Weighted tangents replace Δ/3 with stored handle lengths w (frames), clamped to 0 ≤ w ≤ Δ so x stays monotonic.
- **Auto tangent** (UI expectation, maths in the curve doc): Catmull-Rom slope `mₖ = (vₖ₊₁ − vₖ₋₁)/(tₖ₊₁ − tₖ₋₁)`, set to 0 at local extrema and at the first and last keys, then clamped with the Fritsch–Carlson monotone limit so curves never overshoot neighbour values (similar to the desktop DCC's "Auto Ease").
- Angle field: `angle = atan(m)` in degrees, with m in display units per frame (degrees per frame for rotations). The convention is documented in the UI tooltip.

**Rendering layers (back to front):** background, outside-range shading, grid + labels, buffer curves (dashed `--curve-buffer`), infinity (dotted), inactive curves (40 % alpha), active curves (1.5 px), selected curve segment (2 px), tangent handles (selected keys only; option "show all"), keys, playhead, marquee, remote cursors (later).

**Keys and handles**

| Element | Unselected | Selected | Size | Hit radius |
|---|---|---|---|---|
| Key | `--key-default` square | `--key-selected` (yellow, desktop-DCC convention) | 5 px / 7 px | 6 px |
| Breakdown key | `--key-breakdown` diamond | yellow diamond | 6 / 8 px | 6 px |
| Tangent handle | `--tangent` line + 4 px circle | `--tangent-selected` | line fixed 40 px (non-weighted) or true length (weighted) | 5 px |
| Broken tangent | handle end is a square, tinted `--tangent-broken` | — | — | — |
| Curve segment | — | 2 px, brighter | — | 4 px (distance to a flattened polyline) |

Hit-test priority: selected handles → keys → handles → curve segments → empty space (marquee).

**Interactions (mouse profile; trackpad equivalents in §5.1)**

| Input | Action |
|---|---|
| LMB click key / handle | Select (replace). Shift toggle, Mod remove, Mod+Shift add |
| LMB drag on empty | Marquee select (same modifiers) |
| LMB drag on a selected key/handle (Move tool) | Move. First 4 px of motion pick the dominant axis when `Shift` is held (constrain to time or value) |
| **MMB drag anywhere** | Move the current selection (desktop-DCC convention); Shift constrains |
| `R` + LMB drag | Scale the selection around the press point (pivot drawn as a cross); horizontal = time, vertical = value; Shift constrains |
| **Pen `I` (hold = spring-loaded, `Shift+I` = sticky)** | Click **on** a curve → insert a key keeping the curve shape (the desktop DCC's Insert Key). Click **off** the curve → add a key at that frame/value on the active curve (the desktop DCC's Add Key). **Click-drag** → create a key and pull unified tangents (Illustrator pen). `Alt` while dragging → break and drag only the out-tangent. `Shift` → snap the tangent angle to 0°/±45°. Cursor `pen` / `pen+` (on curve) |
| Double-click a curve | Select all keys on that curve |
| `F` / `A` | Frame selection (keys, or whole curves when no keys are selected) / frame all visible curves, with 8 % padding |
| Wheel | Zoom both axes around the cursor; `Shift`+wheel = value axis only; `Alt`+wheel = time axis only |
| `Alt+MMB` drag / `Alt+RMB` drag | Pan / zoom (Alt+drag navigation). `Alt+Shift+RMB` = zoom one axis (dominant direction) |
| RMB (no Alt) | **Tangent marking menu** (§7.4) on a key or curve; view/select menu on empty space |
| Drag the playhead in the view | Scrub (same as the time slider) |
| `1`…`7` | Tangent type: 1 Auto, 2 Spline, 3 Clamped, 4 Linear, 5 Flat, 6 Stepped, 7 Plateau |
| `B` / `U` | Break / Unify tangents |
| `N` / `Shift+N` | Normalize / Stacked view toggle |
| `Delete` / `Backspace` | Delete selected keys |
| `Mod+C` / `Mod+V` | Copy keys / paste at the current frame (option: merge / replace / insert) |
| `Mod+A` | Select all keys on visible curves |

**Curves menu (filters):** Euler filter, Simplify (key reducer with tolerance), Smooth (Gaussian / Butterworth, preview with a strength slider in a non-modal popover), Resample (bake every N frames), Snap keys to frames, Mirror values, Pre/Post infinity ▸. These follow the desktop DCC's `filterCurve` family (`euler`, `simplify`, `keyReducer`, `butterworth`, `gaussian`, `peakRemover`, `resample`).

### 4.8 Dope Sheet

```
┌ Dope Sheet ── View Select Keys Show ─────────────── Ripple⊡ Snap⊡ ─────────────────── ⤢ ✕ ┐
│ ⌕ filter          │0    5    10   15   20   25   30   35   40   45   50                    │
│ ◆ Summary         │◆         ◆         ◆    ◇         ◆                                     │
│ ▾ ☺ Hero          │◆         ◆         ◆    ◇         ◆                                     │
│   ▸ cog_ctl       │◆         ◆━━━━━━━━━◆              ◆     ━ = hold (same value)         │
│   ▾ l_wrist_ctl   │◆         ◆         ◆    ◇         ◆                                     │
│      Rotate X     │◆         ◆         ◆    ◇                                               │
│      Rotate Y     │◆                   ◆                                                     │
└───────────────────┴──────────────────────────────────────────────────────────────────────────┘
```

- Rows: Summary (all) › character › control › channel, expandable. Glyphs: key ◆ (`--key-default`), breakdown ◇ (green), selected = yellow. **Hold bars** connect identical consecutive values (an open-source-DCC pattern, useful for blocking). Stepped segments get a subtle hatch.
- Interactions: click / marquee / modifiers as in the Graph Editor; drag = move (snaps to frames); `R`-drag = scale (retime) around the press point; **Ripple edit** toggle shifts later keys when moving or scaling (the desktop DCC's 2025 release added ripple to its reworked Dope Sheet); `Delete`; `Mod+C/V`; `1`…`7` set tangent type on the selected keys; `F`/`A` frame.
- Option: *Sync visible range* with the time slider (default on when docked in P3).

### 4.9 Time Slider, Range Slider, playback

**Time slider (30 px)**

| Element | Behaviour |
|---|---|
| Ruler | Labels every N frames so labels are ≥ 40 px apart; minor ticks every frame when ≥ 6 px/frame |
| Key ticks | Full-height 2 px bars for keys of the **selected controls** (desktop-DCC convention). Option *Show keys: Selected / Active character / All*. Colours: key `--key-tick` (red), breakdown `--key-breakdown` (green), selected range keys white on a blue band (the desktop DCC's documentation lists red keys, green breakdowns, selected white/blue) |
| Playhead | 2 px `--playhead` line + frame badge on top |
| Click / drag | Jump / scrub. Evaluates integer frames (option: sub-frame scrub) |
| `Shift`+drag | Select a time range (red-tinted band, desktop-DCC convention). Drag the band's middle = move those keys; drag its ends = scale; `Mod`+drag the middle = copy keys |
| MMB drag | Change the time **without evaluating** (a desktop-DCC trick to carry a pose: MMB-drag, then `S`) |
| `Alt+T` | Add a time bookmark for the selected range or the current frame. Bookmarks are coloured tags above the ruler; hover shows the name; `Mod`+drag moves them (desktop-DCC convention) |
| RMB | Context menu: Cut/Copy/Paste/Delete keys, Snap, Show keys ▸, Bookmarks ▸, Audio ▸ (later) |
| Auto-key on | 2 px red border around the slider |
| Current frame field (right) | numeric input, accepts `+10`, `-5` |
| Audio waveform | Later (centre band, as in the desktop DCC) |

**Range slider + playback row (28 px)**

```
[anim start][play start] ◀━━━━━━━[ play start ═══════ play end ]━━━━━━━▶ [play end][anim end] │ Clip[walk▾] │ 30 fps▾ │ ⏮ ⇤ ◀| ◀ ▶ |▶ ⇥ ⏭ │ ↻ │ 1×▾ │ ⚙
```

- The range bar's ends drag the playback start/end; its middle shifts the range; double-click toggles between the playback range and the full animation range. The outer fields are the clip's animation range.
- **Clip selector**: switches the active clip (per character). Switching keeps the current frame clamped.
- **fps menu**: 24 / 25 / 30 / 48 / 50 / 60 / custom. Changing fps asks: *Keep timing in seconds (re-time keys)* or *Keep frame numbers*. glTF stores seconds; fps is an authoring grid.
- **Playback buttons**: go to start (`Alt+Shift+V` / `Home`), previous key (`,`), previous frame (`Alt+,`), play backwards, play (`Alt+V`), next frame (`Alt+.`), next key (`.`), go to end (`End`). Esc stops. While playing, the play button becomes Stop.
- **Loop** (`↻`, cycles): Once → Loop (continuous, default) → Ping-pong (oscillate). The desktop DCC names them Once / Continuous / Oscillate.
- **Speed** (`1×▾`): Real-time (default), 0.5×, 2×, custom fps, **Every frame**. Every frame evaluates each frame and never runs faster than real time; this matters on 120 Hz displays, where one frame per rAF would play a 30 fps clip at 4×. The desktop DCC offers Play every frame / Real-time / Half / Twice / Other.
- **Snap playback to frames** (default on): playback shows integer frames even on high-refresh displays.
- The help line shows `achieved / target fps` while playing; it turns amber when more than 10 % of frames drop.

---

## 5. Viewport UX

### 5.1 Navigation profiles

The browser cannot tell a trackpad from a mouse wheel reliably, so the profile is chosen at first run (§10.1) and lives in Preferences. Profiles change bindings only, never the camera maths.

| Action | **Alt+drag (mouse)** — default on Win/Linux | **Trackpad (macOS)** — default on macOS | **One-button (mac)** — always on as a fallback |
|---|---|---|---|
| Tumble (orbit) | `Alt+LMB` drag | two-finger scroll | `Option+LMB` drag |
| Track (pan) | `Alt+MMB` drag | `Shift` + two-finger scroll | `Option+Cmd+LMB` drag |
| Dolly | `Alt+RMB` drag, wheel | pinch (`wheel` + `ctrlKey`), or `Cmd` + two-finger scroll | `Option+Ctrl+LMB` drag |
| Dolly to cursor | on (both) | on | on |
| Frame selected / all | `F` / `A` | `F` / `A` | `F` / `A` |
| Graph/Dope/Timeline pan | `Alt+MMB` drag | two-finger scroll | `Option+Cmd+LMB` |
| Graph/Dope/Timeline zoom | wheel / `Alt+RMB` drag | pinch; `Alt`+pinch = time only, `Shift`+pinch = value only | `Option+Ctrl+LMB` |

Implementation notes:

- `camera-controls` 3.1.2 (MIT) is the navigation core. Its `mouseButtons.{left,middle,right,wheel}` take `ACTION.ROTATE | TRUCK | DOLLY | ZOOM | NONE`. The Alt+drag profile swaps these on Alt keydown/keyup (its "mouse drag with modifier keys" pattern), so without Alt the LMB stays free for selection and manipulators. The library also has `setViewport` for single-canvas multi-view, `toJSON()` / `fromJSON()` for bookmarks, `fitToBox` for `F`/`A`, `dollyToCursor` and `smoothTime`.
- **Trackpad pinch** arrives as `wheel` with `ctrlKey: true` in Chromium and Firefox; `preventDefault()` stops page zoom. Safari historically sends non-standard `gesturestart/gesturechange/gestureend` instead, so we handle both. `wheel` gives no gesture start/end phase, so "end of pinch" is a 120 ms idle timeout.
- The desktop DCC's own mac table maps Track to `Option+Cmd+button` and Dolly to `Option+Ctrl+button` for one-button mice. On macOS, `Ctrl+click` raises `contextmenu`; we suppress it inside viewports when `altKey` is held.
- MMB on Windows starts autoscroll and on Linux pastes the primary selection. Call `preventDefault()` on `pointerdown` (button 1) and `auxclick` inside the editor.
- Some Linux desktops bind `Alt+drag` to window moving (configurable per desktop environment; the desktop DCC's docs give the same advice). The help line shows a one-time hint linking to the Trackpad profile, which needs no Alt.

### 5.2 Cameras

- Default cameras: `persp` (35 mm, vertical FOV 37.8°), orthographic `top`, `front`, `side`, plus `shotCam` (perspective, framed 3/4 front at chest height, 50 mm). Orthographic views tumble out to persp only when `Alt` is held and "allow ortho tumble" is on (off by default, as in the desktop DCC).
- Each pane keeps a **view history**: `[` / `]` undo/redo view changes (desktop-DCC convention), 32 entries, stored per pane.
- Numpad bonus (open-source-DCC habit, no conflicts because `event.code` distinguishes `Numpad1` from `Digit1`): `Numpad1` front, `Numpad3` side, `Numpad7` top, `Numpad5` persp/ortho, `Numpad0` shotCam.

### 5.3 Locked camera pane

- `🔒` toggle in the header, or `Alt+L` with the pointer over the pane. A lock is a property of *pane + camera*; a camera shown in two panes can be locked in one only.
- While locked, any navigation gesture is swallowed. The `LOCKED` badge flashes for 300 ms and the help line says "Camera locked — Alt+L to unlock". Selection, manipulators, scrubbing and `F` (which frames *without moving the camera* by flashing the selection) still work.
- The camera transform in the Attributes panel is read-only while locked. Keying the camera itself (camera animation) comes later.

### 5.4 Camera bookmarks

- `⌖ ▾`: **Add bookmark** (name, stores `camera-controls.toJSON()` + FOV + ortho flag), list (click = recall with a 250 ms transition; instant under `prefers-reduced-motion`), rename, delete, **Update from current view**.
- Bookmarks belong to the camera and are saved in the project, so collaborators share them. View history (§5.2) stays per user.
- Optional hotkeys are left unbound by default (rebindable). `Mod+1…9` cannot be used because browsers reserve them (§7.6).

### 5.5 Navigation gizmo / view cube

- 72 px circular axis gizmo in the top-right of each pane, drawn as **SVG over the canvas** and projected from the pane camera's quaternion each frame. Crisp at any DPR, cheap, and no extra render pass. drei's `GizmoHelper` + `GizmoViewport` / `GizmoViewcube` is an alternative, but it assumes one default camera per canvas, which our single-canvas multi-pane renderer (§13.3) does not have.
- Click an axis bubble → align the view (animated). Click the same one again → opposite side. Drag on the gizmo → tumble (helps trackpad users). Double-click → frame all. Small **persp/ortho** toggle and **home** button below.
- Axis colours from `--axis-x/y/z`; negative axes are hollow circles; labels X/Y/Z are always drawn, so colour is not the only cue.

### 5.6 Display toggles (per pane)

| Toggle | Hotkey | Implementation hint |
|---|---|---|
| Wireframe / Shaded / Textured / Lit | `4` / `5` / `6` / `7` (desktop-DCC keys) | per-pane `scene.overrideMaterial` for wireframe; lighting rig switch |
| Wireframe on shaded | menu | second pass with `overrideMaterial` (wire), depth offset |
| X-ray mesh | `Alt+X` | mesh material opacity uniform set in `onBeforeRender` per pane |
| Joints | `Alt+J` | skeleton helper on camera layer 1 |
| Controls | `Alt+C` | controls on layer 2 (§5.8) |
| Onion skin (ghosts) | `Alt+G` | layer 3; popover below |
| Grid | menu | layer 4 |
| Isolate selection | `Shift+L` (the desktop DCC's "View Selected") | per-pane layer mask + pane badge |
| Background | `Alt+B` cycles gradient / dark / mid / light (desktop-DCC convention) | per pane |
| HUD | menu | DOM overlay |
| Motion trail | later | layer 5 |

Per-pane flags use **camera layers** (`Object3D.layers`, `camera.layers`), so one shared scene renders differently in each pane without duplicating objects.

**Onion skin popover:** Before `3` / After `3` / Step `2` frames, or *Keys only*. Style: Silhouette (flat unlit tint, default) / Wireframe / Skeleton only (cheapest). Opacity runs 0.45 near to 0.10 far, linearly. Colours `--ghost-past` (warm) and `--ghost-future` (cool). Scope: selected character (default) or all. Poses come from a sampled-pose cache that is invalidated per edited curve range. The desktop DCC's Ghost Editor exposes the same essentials: frames before/after, per-direction colour, count.

### 5.7 Selection highlighting

| State | Controls | Joints | Meshes |
|---|---|---|---|
| Default | side colour (L blue / R red / C yellow), 2 px | grey | normal shading |
| Hover (pre-select) | +1 px width, colour +20 % lightness | light grey | 1 px outline `--sel-hover` |
| Selected | white `--sel`, 3 px | white | 2 px outline `--sel` |
| **Lead** (last selected) | `--sel-lead` (light green, desktop-DCC convention) | `--sel-lead` | outline `--sel-lead` |
| Remote user selection (later) | dashed 2 px in the user colour + name chip | — | dashed outline |
| Locked / not pickable | 50 % alpha, no hover | — | — |

### 5.8 Control rig visuals ("circles around bones")

- Drawn with three's `Line2` / `LineMaterial` (fat lines, constant pixel width, DPR-aware). 64 segments per circle.
- **Occlusion-aware X-ray** (default): pass 1 draws the occluded part at 35 % alpha (`depthFunc = GreaterDepth`), pass 2 the visible part at 100 %. Controls never disappear inside the mesh, yet depth stays readable.
- **Picking** happens in screen space: distance from the pointer to the projected polyline ≤ 6 px. Ties go to the nearest in depth, then the smallest control. This is more forgiving than raycasting thin lines.
- Shape library: circle, double circle (COG), square, cube, diamond, sphere (3 circles), arrow, 4-way arrow (root), cross, pin/lollipop (fingers), foot box. Default size comes from bone length / skinned-mesh radius; orientation = normal along the bone axis.
- Side colours (rigging convention): left `--rig-left` blue, right `--rig-right` red, centre `--rig-center` yellow; IK handles `--rig-ik` orange (later).

### 5.9 Manipulators (W / E / R)

| Tool | Handles | Spaces (status line / `W`,`E` + LMB marking menu) |
|---|---|---|
| Move `W` | 3 axis arrows, 3 plane squares, centre screen-plane square | Object (local), World, Parent |
| Rotate `E` | 3 axis rings, view ring (outer, `--axis-view`), free trackball (inner disc) | Object, World, **Gimbal** (shows the real non-orthogonal Euler axes for the rotate order; the most useful mode for clean curves) |
| Scale `R` | 3 axis cubes, centre uniform cube | Object |

- Active / hovered axis = `--axis-active` (yellow, desktop-DCC convention). During a drag the other handles fade to 30 %.
- Readout HUD near the cursor: `ΔX 0.120 m`, `RX +15.0°`. `J` hold = snap (rotate 15°, move 0.1, scale 0.1; editable). `+` / `-` = manipulator size (desktop-DCC keys).
- three's `TransformControls` (examples/jsm) covers translate/rotate/scale in local or world space, but has no Gimbal, Parent space, view ring or trackball. Plan a custom manipulator module that keeps its proven picking approach.
- One drag = one undo step and one coalesced document command; continuous updates stay transient (§13.4).

---

## 6. Interaction rules (cross-panel)

### 6.1 Selection modifiers (all panels)

| Gesture | Win/Linux | macOS | Desktop-DCC equivalent |
|---|---|---|---|
| Replace | click | click | click |
| Toggle | `Shift`+click | `Shift`+click | Shift |
| Remove | `Ctrl`+click | `Cmd`+click | Ctrl (mac `Ctrl`+click would open the context menu) |
| Add | `Ctrl+Shift`+click | `Cmd+Shift`+click | Ctrl+Shift |
| Marquee | drag on empty space | same | same |

`Mod` below means `Ctrl` on Windows/Linux and `Cmd` on macOS. `Alt` means `Option` on macOS.

### 6.2 Drag precision and constraint

- `Shift` while dragging a value = constrain to the dominant axis (Graph/Dope/timeline) or fine ×0.1 (virtual sliders). In viewports `Shift`-drag on a manipulator plane does not exist; axes do that job.
- Drags under 3 px are clicks. Long drags use `setPointerCapture`; virtual sliders may request Pointer Lock with `{ unadjustedMovement: true }` and fall back silently. Chrome announced a permission prompt for pointer/keyboard lock and then withdrew it, so the API still has to be feature-detected.
- `Esc` during any drag cancels it and restores the pre-drag state (no undo entry).

### 6.3 Undo granularity

One user gesture = one undo step: a manipulator drag, a marquee move of N keys, a typed value applied to M channels, a tween-slider release. Selection changes are **not** undoable by default in the Animate workspace; camera moves use the per-pane view history instead. With collaboration, undo only reverts **your** operations (§12). *Corrected 2026-10-19 (MODELING-PLAN v0.2 §3.5): the desktop DCC records selection changes in its undo queue **by default** (users have asked the vendor, on its ideas forum, to consolidate them), and the open-source DCC records edit-mode selection; the Model workspace therefore makes component selection undoable (coalesced "Select" steps, session-only), with a per-workspace preference.*

### 6.4 Numeric entry

All numeric fields share the grammar `[=]?expr | (+=|-=|*=|/=) expr`, where `expr` allows `+ − * / ( )`, decimals, and a `deg`/`rad` suffix for angles. Invalid input shows a red 1 px border plus a tooltip and keeps the old value. Values show three decimals; full precision is in the tooltip.

### 6.5 Feedback

- Toasts (bottom-right, above the timeline, 4 s, stack ≤ 3) for completed batch operations with an inline **Undo** button: "Deleted 9 keys at f24 · Undo".
- The help line shows the current tool's hints and the hovered item's description (as in the desktop DCC's help line).
- Busy states: import/export progress in a non-blocking bottom-left pill; the UI never freezes for more than 100 ms (heavy work goes to Web Workers; see the architecture doc).

---

## 7. Hotkeys

### 7.1 Implementation rules

1. Match on **`KeyboardEvent.code`** (physical key), never `key`. Option+letter on macOS yields characters such as `√` in `key`, and Russian ЙЦУКЕН and other non-US layouts would otherwise break `W`/`E`/`R`. Show the user's real key labels with `navigator.keyboard.getLayoutMap()` (Chromium) and fall back to US labels.
2. **Scope resolution:** text input focused → only `Esc`, `Enter`, `Tab`, and `Mod+S`/`Mod+Z` when the input is not a text editor. Otherwise: modal/overlay → **panel under the pointer** (Graph, Dope, Viewport, Outliner, Channels, Timeline) → workspace → global. A scope may *consume* or *pass through*.
3. **Tap vs hold:** keys with both meanings (`Space`, `W/E/R/Q` + LMB, `K`, `I`, `J`, `Shift+S`) start a 200 ms timer on keydown (ignore `e.repeat`). Release before the timer and without pointer activity = tap. Otherwise = hold (spring-loaded tool or marking menu); keyup restores the previous tool.
4. `preventDefault()` only for handled combos, plus `Space` (page scroll), `Alt` keyup (Firefox Windows menu-bar focus) and MMB defaults (§5.1). Keep browser `Mod+F`, `Mod+L`, `Mod+R` untouched. Guard unsaved work with `beforeunload`.
5. All bindings live in one table (command id → chord list → scope) that the Hotkey editor, cheat sheet (`?`) and docs read. User overrides are stored as a diff in preferences. Conflicts are detected inside a scope and flagged by the editor.

### 7.2 Default map

Legend: **M** = matches the desktop DCC's default · **M~** = modelled on the desktop DCC, adapted · **E** = Ekza addition. Scope: G global, V viewport, T timeline, GE Graph Editor, DS Dope Sheet, O Outliner, CB Channels panel.

**Global / file / edit**

| Action | Win/Linux | macOS | Scope | Origin |
|---|---|---|---|---|
| Command palette | `Ctrl+K` | `Cmd+K` | G | E |
| Shortcut cheat sheet | `?` (`Shift+Slash`) | same | G | E |
| Open / Import animation / Export | `Ctrl+O` / `Ctrl+I` / `Ctrl+E` | `Cmd+O` / `Cmd+I` / `Cmd+E` | G | M (Open) / E |
| Save (browser storage + download) | `Ctrl+S` | `Cmd+S` | G | M |
| Save as | `Ctrl+Shift+S` | `Cmd+Shift+S` | G | M |
| Undo | `Z`, `Ctrl+Z` | `Z`, `Cmd+Z` | G | M |
| Redo | `Shift+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` | `Shift+Z`, `Cmd+Shift+Z` | G | M (+web) |
| Copy / Paste (pose in V, keys in T/GE/DS) | `Ctrl+C` / `Ctrl+V` | `Cmd+C` / `Cmd+V` | context | M |
| Paste mirrored pose | `Ctrl+Shift+V` | `Cmd+Shift+V` | V | E |
| Duplicate (clip / keys) | `Ctrl+D` | `Cmd+D` | O, GE, DS | M |
| Select all (controls / keys) | `Ctrl+A` | `Cmd+A` | context | E (the desktop DCC uses Ctrl+A for the Attribute Editor) |
| Maximize pane under pointer | `Space` tap | same | G | M |
| Pane/camera radial | `Space` hold | same | G | M~ (a lite quick menu) |
| Zen mode (hide side docks) | `Shift+Space` | same | G | M~ (desktop DCC: `Ctrl+Space`; that conflicts with the macOS input-source switch) |
| Previous / next layout preset | `Shift+[` / `Shift+]` | same | G | M |
| Cancel / stop playback / close menu | `Esc` | same | G | M |

**Tools, selection, view (viewport)**

| Action | Key | Scope | Origin |
|---|---|---|---|
| Select / Move / Rotate / Scale tool | `Q` / `W` / `E` / `R` (hold + LMB = marking menu) | V, GE (Q/W/R), DS | M |
| Manipulator size − / + | `-` / `=` | V | M |
| Snap while held | `J` | V | M |
| Pick-walk parent / child / sibling | `↑` / `↓` / `←` `→` | V, O | M (preference: arrows step frames instead) |
| Frame selected / all (panel) | `F` / `A` | V, GE, DS, O | M |
| Frame selected / all (every pane) | `Shift+F` / `Shift+A` | G | M |
| Undo / redo view change | `[` / `]` | V | M |
| Isolate selection | `Shift+L` | V | M (the desktop DCC's "View Selected"; its `Ctrl+1` (2016+) is browser-reserved) |
| Hide selected / show selected / hide unselected | `H` / `Shift+H` / `Alt+H` | V, O | M~ (desktop DCC: `Ctrl+H`; `Cmd+H` hides the browser on mac) / M / M |
| Wireframe / shaded / textured / lit | `4` / `5` / `6` / `7` | V | M |
| X-ray / joints / controls / onion skin | `Alt+X` / `Alt+J` / `Alt+C` / `Alt+G` | V | E |
| Cycle background | `Alt+B` | V | M |
| Lock pane camera | `Alt+L` | V | E |
| Virtual time slider (scrub in viewport) | `K` + LMB or MMB drag | V | M |
| Mirror pose | `Alt+M` | V | E |

**Keys and playback**

| Action | Key | Scope | Origin |
|---|---|---|---|
| Set key (key target) | `S` | V, CB, G | M |
| Key translate / rotate / scale | `Shift+W` / `Shift+E` / `Shift+R` | V | M |
| Set breakdown | `Alt+S` | V | E |
| Keyframe marking menu | `Shift+S` hold + LMB | V | M |
| Auto-key toggle | `Shift+K` | G | E |
| Delete keys (selected keys; else keys at the current frame on selected controls) | `Delete` / `Backspace` | V, T, GE, DS | M~ |
| Play / stop | `Alt+V` | G | M |
| Stop | `Esc` | G | M |
| Go to start | `Alt+Shift+V`, `Home` | G | M / E |
| Go to end | `End` | G | E |
| Next / previous key | `.` / `,` | G | M |
| Next / previous frame | `Alt+.` / `Alt+,` | G | M |
| Add time bookmark | `Alt+T` | G | M |
| *(preference)* Space plays | `Space` | G | E (open-source-DCC / AE habit; replaces tap-maximize) |

**Graph Editor / Dope Sheet**

| Action | Key | Origin |
|---|---|---|
| Pen / insert key (hold = spring-loaded) | `I` | M (Insert Keys tool) |
| Pen sticky | `Shift+I` | E |
| Tangent: Auto / Spline / Clamped / Linear / Flat / Stepped / Plateau | `1` … `7` | E |
| Break / Unify tangents | `B` / `U` | E |
| Normalize / Stacked view | `N` / `Shift+N` | E |
| Pan / zoom view | `Alt+MMB` / `Alt+RMB` (axis zoom `Alt+Shift+RMB`), wheel | M |
| Tangent marking menu | RMB on key/curve | M~ (desktop DCC: `Shift+S` + MMB; MMB is unavailable on trackpads) |

**Outliner / Channels panel:** `/` focus filter, `F2` rename (`Enter` on macOS, where F-keys need `fn`), arrow tree navigation, `Tab` field cycling, `↑/↓` value nudge.

### 7.3 Spring-loaded tools and marking menus

| Trigger | Menu / behaviour |
|---|---|
| `W` hold + LMB | Move space: N World · E Object · S Parent · W Snap settings… |
| `E` hold + LMB | Rotate space: N World · E Object · S Gimbal · W Snap settings… |
| `Q` hold + LMB | Selection mask: N Controls only · E +Joints · S All · W Meshes only |
| `Shift+S` hold + LMB | Keyframe: N Set key · NE Key translate · E Key rotate · SE Key scale · S Breakdown · SW Delete key · W Mirror pose · NW Reset to rest |
| RMB on control (V) | N Select hierarchy · E Select mirror · S Reset pose · W Frame · NE Key selected · SE Copy pose · SW Paste pose · NW Paste mirrored |
| RMB on empty (V) | N Top · E Side · S Front · W Persp · NE shotCam · SE Frame all · SW Shading ▸ · NW Show ▸ |
| RMB on key/curve (GE) | **Tangents, fixed geometry:** N Auto · NE Spline · E Linear · SE Stepped · S Flat · SW Plateau · W Clamped · NW Break/Unify; linear list below: Weighted, Lock length, Infinity ▸, Delete |
| `Space` hold | Pane type & camera: N Top · E Side · S Front · W Persp · NE Graph Editor · SE Dope Sheet · NW shotCam · SW Outliner |

### 7.4 Marking-menu spec

- 8 compass slots on a 90 px radius, pill labels (12 px, `--bg-popover`), 14 px dead centre, an optional linear overflow list under the centre (desktop-DCC style), and ▸ sub-menus that open on hover over the outer edge.
- **Gesture selection:** a flick in a direction, released within 250 ms, triggers the slot **without drawing the menu**. This builds muscle memory, as in the desktop DCC. The menu renders only after 120 ms of hold.
- Rendered in a top-level portal (SVG + DOM labels), pointer-captured; `Esc` or releasing in the centre cancels. Slot positions never change between contexts with the same family (all tangent menus share geometry).
- Accessibility: every marking-menu item is also a menu-bar item and a command-palette entry (§11.4).

### 7.5 Deliberate divergences from desktop-DCC defaults

| Desktop DCC | Ekza | Why |
|---|---|---|
| `Ctrl+1` isolate select | `Shift+L` | `Mod+1…9` switch browser tabs |
| `Ctrl+H` hide | `H` | `Cmd+H` hides the browser on macOS; `Ctrl+H` is browser history |
| `Ctrl+Space` full-screen panels | `Shift+Space` | macOS input-source switch (critical for bilingual RU/EN users) |
| `Ctrl+A` Attribute Editor toggle | `Ctrl/Cmd+A` select all | web expectation; Attributes is a tab one click away |
| `Shift+S` + MMB tangent menu | RMB on key/curve | trackpads have no MMB |
| `Alt+←/→` nudge 1 px | not bound | browser history back/forward on Win/Linux |
| `F2`–`F12` menu sets / component modes | not bound | F-keys are media keys on Mac laptops; menu sets replaced by workspaces |

### 7.6 Reserved and risky combinations (never bind by default)

| Platform / browser | Combos | Behaviour |
|---|---|---|
| All (Chrome, Edge, Safari) | `Mod+W`, `Mod+T`, `Mod+N`, `Mod+Shift+N`, `Mod+Shift+T`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+PgUp/PgDn`, `Mod+1…9` | Browser UI shortcuts; Chrome/Safari/Edge do not dispatch them to pages, Firefox dispatches but still acts. Keyboard Lock (`navigator.keyboard.lock()`) works only in JS-initiated fullscreen and only for OS-allowed keys; not a product strategy |
| macOS system | `Cmd+Q`, `Cmd+H`, `Cmd+M`, `Cmd+Tab`, `` Cmd+` ``, `Cmd+Space` (Spotlight), `Ctrl+Space` / `Ctrl+Option+Space` (input source), `Ctrl+←/→/↑/↓` (Spaces/Mission Control), `Cmd+Shift+3/4/5`, `Ctrl+Cmd+F`, `Ctrl+Cmd+Space` (emoji), F-keys without `fn` | OS takes them |
| macOS browser | `Cmd+,` (browser settings), `Cmd+L`, `Cmd+R`, `Cmd+Option+I/J` | keep for the browser |
| Windows / Linux browser | `Alt+←/→` (back/forward), `Alt+Home`, `Alt+D` / `Alt+E` / `Alt+F` (Chrome address bar/menu), `F5`/`Ctrl+R`, `F11`, `F12`, `Ctrl+Shift+I/J/C`, `Alt+F4`, `Alt+Space` (window menu) | browser/OS |
| Linux Chrome | `Alt+1…8` | tab switching |
| Firefox Win/Linux | `Alt+F/E/V/S/B/T/H` are menu access keys | We bind `Alt+V/S/B/T/H` (desktop-DCC parity), so we `preventDefault` on keydown and verify per release in the QA matrix; Chromium is the primary target |
| Linux WMs (some) | `Alt`+drag moves windows | Trackpad profile / remap advice (§5.1) |
| Text editing | `Mod+Z/C/V/X/A` inside inputs | native behaviour wins while an input is focused |

---

## 8. Visual design system

### 8.1 Direction

Desktop-DCC-style neutral greys, cleaned up: flat surfaces, hairline borders, one restrained accent. The Ekza brand enters through the **violet accent `#7c5cff`** used in `ekza-arena-web` (`--accent: #7c5cff`, `--accent-strong: #9b82ff`), which marks chrome only: focus, active tab, primary button, selected list rows. **Semantic animation colours (axes, keys, playhead, Channels panel states, rig sides) never use the accent.** Arena's near-black cinema base (`#050506`) is deliberately *not* reused: a pro tool needs mid-dark surfaces so models' mid-tones and thin curves stay readable for hours. `omoba-ui` (Verdant Crown emerald/gold) is a game skin and is not reused, but its *method* is adopted: a `tokens.json` source of truth, a generated CSS file and a contrast-check script.

### 8.2 Colour tokens

**Surfaces and text** (dark theme, the only theme in the MVP; a high-contrast variant comes later)

| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#1b1c1f` | window background, gaps between docks |
| `--bg-panel` | `#232428` | panel bodies |
| `--bg-header` | `#2a2b30` | panel headers, toolbars, tab strips, menu bar |
| `--bg-field` | `#17181b` | inputs, Channels panel fields, curve-view background |
| `--bg-hover` | `#30323a` | hover rows/buttons |
| `--bg-pressed` | `#3a3d46` | pressed / toggled-on (non-accent) |
| `--bg-selected` | `#3b3270` | selected list rows (accent-tinted) |
| `--bg-popover` | `#2c2e34` + shadow | menus, popovers, marking-menu pills |
| `--viewport-top` / `--viewport-bottom` | `#3e4047` → `#26272b` | default viewport gradient (desktop-DCC-like; the silhouette reads against both ends) |
| `--grid-minor` / `--grid-major` | `#3a3c44` / `#4b4e58` | viewport & graph grid |
| `--border` | `#3a3c44` | hairlines between regions |
| `--border-strong` | `#4b4e58` | field outlines on hover, splitters on hover |
| `--text` | `#e6e7ea` | primary text |
| `--text-2` | `#aeb2bb` | secondary (labels, column headers) |
| `--text-3` | `#969ba6` | muted (hints, units, disabled-looking but readable) |
| `--text-disabled` | `#5d616b` | disabled (exempt from contrast per WCAG) |
| `--accent` | `#7c5cff` | focus ring base, active tab underline, toggles |
| `--accent-fill` | `#6c4ff0` | primary button fill (white text 5.23:1) |
| `--accent-text` | `#a996ff` | accent-coloured text/icons on panels (6.27:1) |
| `--focus-ring` | `2px solid #a996ff` + `1px #17181b` gap | keyboard focus (`:focus-visible` only) |
| `--ok` / `--warn` / `--danger` / `--info` | `#65a878` / `#e3b34a` / `#ef6b6b` / `#5cc8ff` | toasts, validation, badges (ok/warn values shared with `ekza-arena-web`) |

**Animation semantics**

| Token | Value | Use |
|---|---|---|
| `--axis-x` / `--axis-y` / `--axis-z` | `#ff5f69` / `#5fd36e` / `#4f8dff` | manipulators, gizmo, channel swatches, X/Y/Z curves |
| `--axis-w` / `--channel-other` | `#3fd1d9` | quaternion W (inspector), custom channels |
| `--axis-view` | `#c8ccd4` | view ring, screen-plane handle |
| `--axis-active` | `#ffd84d` | hovered/dragged manipulator axis (desktop-DCC yellow) |
| `--key-default` | `#c8ccd4` | unselected keys (graph, dope sheet) |
| `--key-selected` | `#ffd84d` | selected keys (desktop-DCC yellow) |
| `--key-breakdown` | `#3fcf8e` | breakdown keys and ticks |
| `--key-tick` | `#e5484d` | time-slider key ticks (desktop-DCC red) |
| `--tangent` / `--tangent-selected` / `--tangent-broken` | `#9aa0ab` / `#ff9f43` / `#3fd1d9` | handles |
| `--curve-buffer` | `#7d828d` dashed | buffer curve |
| `--playhead` | `#ff8a3d` | playhead in time slider, graph, dope sheet |
| `--range-outside` | `rgba(0,0,0,0.28)` | outside the playback range |
| `--range-select` | `rgba(229,72,77,0.22)` + `#e5484d` edges | Shift-drag time range (desktop-DCC red band) |
| `--autokey` | `#e5484d` | auto-key on indicator |
| `--sel` / `--sel-lead` / `--sel-hover` | `#ffffff` / `#7dff8a` / `#ffe58a` | viewport selection (desktop-DCC white + green lead) |
| `--rig-left` / `--rig-right` / `--rig-center` / `--rig-ik` | `#4f8dff` / `#ff5f69` / `#ffd84d` / `#ff9f43` | control colours by side |
| `--ghost-past` / `--ghost-future` | `#ff8a5c` / `#5cc8ff` | onion skin |
| `--locked-badge` | `#e3b34a` | camera locked badge |
| Channels panel states | see §4.5 | |
| `--presence-1…6` (later) | `#ff5cc8`, `#00c2a8`, `#b18cff`, `#ffb020`, `#8bd450`, `#5cc8ff` | collaborators; always paired with a dashed style and a name chip, never a solid fill, so they cannot be mistaken for semantic colours |

**Colour-blind alternative** (preference "Axis palette: Standard / Colour-blind safe"): Okabe–Ito `X #e69f00`, `Y #56b4e9`, `Z #cc79a7`. Axis letters are always drawn, so neither palette relies on hue alone.

### 8.3 Contrast verification (computed with the WCAG 2.x relative-luminance formula)

| Foreground | on `--bg-app` | on `--bg-panel` | on `--bg-header` | on `--bg-field` | on `--bg-hover` | Requirement |
|---|---|---|---|---|---|---|
| `--text` `#e6e7ea` | 13.78 | 12.54 | 11.42 | 14.36 | 10.34 | 4.5 (text) ✓ |
| `--text-2` `#aeb2bb` | 8.02 | 7.30 | 6.65 | 8.36 | 6.02 | 4.5 ✓ |
| `--text-3` `#969ba6` | 6.11 | 5.56 | 5.07 | — | 4.59 | 4.5 ✓ |
| `--accent-text` `#a996ff` | 6.89 | 6.27 | 5.71 | 7.18 | 5.17 | 4.5 ✓ |
| `--axis-x` `#ff5f69` | 5.75 | 5.24 | 4.77 | — | 4.32 | 3.0 (graphics) ✓ |
| `--axis-z` `#4f8dff` | 5.34 | 4.86 | 4.43 | 5.57 | 4.01 | 3.0 ✓ |
| `--key-tick` `#e5484d` | 4.35 | 3.96 | 3.61 | 4.54 | 3.27 | 3.0 ✓ |
| `--tangent` `#9aa0ab` | 6.48 | 5.90 | 5.37 | 6.75 | 4.86 | 3.0 ✓ |
| `--playhead` `#ff8a3d` | 7.27 | 6.61 | 6.02 | 7.57 | 5.45 | 3.0 ✓ |
| white on `--accent-fill` `#6c4ff0` | 5.23 | | | | | 4.5 ✓ |

Rule: text ≥ 4.5:1 (SC 1.4.3); UI component boundaries and meaningful graphics ≥ 3:1 (SC 1.4.11). `--border` (1.4:1) is decorative; every *interactive* boundary also has a fill change or uses `--border-strong` on hover/focus. The tokens build must re-run this table in CI (port the `omoba-ui` `tokens.py contrast` idea).

### 8.4 Typography

| Style | Font | Size / line | Weight | Use |
|---|---|---|---|---|
| `ui` (base) | Inter Variable | 12 / 16 px | 400 | menus, labels, panels |
| `ui-strong` | Inter | 12 / 16 | 600 | panel titles, active tab, selected object name |
| `ui-dense` | Inter | 11 / 14 | 400 | Outliner, channel list, Dope Sheet rows |
| `numeric` | Inter, `font-feature-settings: "tnum" 1` | 12 / 16 | 400 | all numeric fields, time fields |
| `ruler` | Inter tnum | 10 / 12 | 500 | time ruler, graph axis labels (floor: 10 px) |
| `dialog-body` / `dialog-title` | Inter | 13 / 18 · 15 / 20 | 400 · 600 | dialogs, onboarding |
| `mono` | JetBrains Mono | 12 / 16 | 400 | expressions, console (later) |

Fonts are self-hosted via `@fontsource-variable/inter` 5.3.0 and `@fontsource-variable/jetbrains-mono` 5.3.0 (both OFL-1.1): no third-party font requests and offline-capable. Inter matches `ekza-arena-web`'s body font.

### 8.5 Spacing, sizing, radii, elevation, motion, z-order

| Token | Value |
|---|---|
| Base grid | 4 px (`--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s6` 24; same as `ekza-arena-web`) |
| Row height | 22 px default; density *compact* 20, *comfortable* 26 |
| Field height | 22 px (CB), 24 px (dialogs) |
| Toolbar / header / tab strip | 28 / 22 / 26 px |
| Icon | 16 px (14 px in dense rows); icon button hit area ≥ 24×24 (WCAG 2.2 SC 2.5.8 minimum) |
| Radii | `--r-field` 3 px, `--r-button` 4 px, `--r-popover` 6 px, `--r-dialog` 8 px (tighter than Arena's 6/8/12; dense tool) |
| Elevation | none for docked panels; `0 8px 24px rgba(0,0,0,.45)` for popovers / floating groups / dialogs |
| Motion | 80 ms (hover), 120 ms (popover), 180 ms (dock collapse), 250 ms (camera transitions); `prefers-reduced-motion` → 0 ms except essential progress |
| z-order | canvas 0 · panel chrome 10 · viewport HUD 20 · floating groups 30 · popovers/menus 40 · marking menu 50 · dialogs 60 · toasts 70 · drag ghosts 80 |

### 8.6 Iconography

- **Lucide** (`lucide-react` 1.59.0, ISC) for generic actions (file, folder, eye, lock, search, settings, play family, maximize, undo).
- **Custom animation set** drawn on the same 16 px grid with a 1.5 px stroke and round caps, stored as SVG components in the repo (MIT with the project). Needed glyphs: tangent types (auto, spline, clamped, linear, flat, stepped, stepped-next, plateau, fixed), break, unify, weighted, lock-length, key, breakdown, auto-key, buffer snapshot/swap, normalize, stacked, infinity (constant/linear/cycle/cycle-offset/oscillate), tools (select/move/rotate/scale/pen), spaces (object/world/parent/gimbal), display (wire/shaded/textured/lit/xray/joints/controls/onion/isolate/safe-frame), camera-lock, bookmark, layouts (P1–P6), loop once/loop/ping-pong, mirror pose, copy/paste pose, entity types (character, control, bone, mesh, clip, camera, light), ghost.
- A tangent-type icon *is* its curve shape: a 16 px plot of the segment through a key. Users learn the icons by sight.

### 8.7 Component states

| State | Treatment |
|---|---|
| Default | flat, text `--text` / icon `--text-2` |
| Hover (pointer only) | `--bg-hover`, icon → `--text` |
| Pressed | `--bg-pressed` |
| Toggled on | non-semantic toggles: `--bg-pressed` + 2 px `--accent` underline; semantic toggles (auto-key) use their semantic colour |
| Selected (list) | `--bg-selected`, text `--text` |
| Focus-visible | `--focus-ring` (never shown on mouse focus) |
| Disabled | `--text-disabled`, `cursor: not-allowed`, tooltip says *why* |
| Mixed (multi-edit) | value `—`, italic `--text-3` |
| Invalid | 1 px `--danger` border + tooltip message |
| Dirty | `✱` after the name (clips, project title) |
| Remote-active (later) | 2 px left bar in the presence colour + avatar chip |

### 8.8 Cursors

System cursors where they fit (`default`, `pointer`, `text`, `col-resize`, `row-resize`, `grabbing`, `not-allowed`). Custom 24 px SVG cursors with hotspots: tumble, track, dolly, pen, pen-plus (on curve), scale-keys, scrub (`ew-resize` with frame badge), marquee, eyedropper (later).

---

## 9. Docking, layouts, workspaces, persistence

### 9.1 Docking engine

**`dockview-react` 8.6.0 (MIT, zero runtime deps, React 16.8–19 peer range)** is recommended over `flexlayout-react` 0.11.1 and `react-resizable-panels` 4.14.5. It provides tabbed groups, drag-to-split, **floating groups**, **popout windows**, group maximize, a watermark (empty) component and `api.toJSON()` / `api.fromJSON()` serialization. `react-resizable-panels` stays useful for *fixed* splits inside a panel (e.g. the Graph Editor's channel list | curve view).

Rules:

- Time slider + range slider are **fixed chrome** (not dockable) in the MVP, which keeps them predictable. Phase 2 may expose them as a panel.
- **Viewport panes cannot float or pop out in the MVP.** All panes render through one WebGL canvas with scissoring (§13.3), and a popout window would need its own GL context. Non-3D panels (Graph Editor, Dope Sheet, Outliner, Channels) may float in the MVP and pop out to a second monitor in Phase 2. The Graph Editor is Canvas 2D, so it works in a popout.
- Splitter drag never remounts panels. The WebGL canvas is never resized by React re-render, only by the `ResizeObserver` of each pane surface.

### 9.2 Persistence model

| What | Where | Key / format | Shared with collaborators |
|---|---|---|---|
| Dock layout per workspace | `localStorage` | `ekza-animator:layout:v1:<workspace>` → dockview JSON + `paneConfigs` | no |
| Pane config (type, camera id, display flags, persp camera state, graph view transform) | inside the layout JSON, keyed by panel id | `{ type, cameraId, locked, flags, persp: cameraControlsJSON, graph: {sx, sy, f0, v0, mode} }` | no |
| Preferences (nav profile, hotkey overrides, UI scale, density, axis palette, Space behaviour, arrow behaviour) | `localStorage` | `ekza-animator:prefs:v1` | no |
| Project document (characters, rigs, clips, keys, scene cameras incl. `shotCam`, camera bookmarks, time bookmarks, fps, ranges) | project file + IndexedDB/OPFS autosave | — | **yes** |
| Recent files | IndexedDB (`FileSystemFileHandle` where the File System Access API exists) | — | no |

- Every stored blob carries `schemaVersion`. Migrations are pure functions; an unknown or newer version → fall back to the workspace default and show a toast "Layout reset (newer version)".
- Wrap every storage access in try/catch (private mode, quota); the app must run with no storage at all.
- **Reset workspace** (Windows menu) restores the default JSON for the active workspace only.

### 9.3 Workspaces

Tabs in the menu bar: `Animate | Rig | Review | Model`. A workspace = layout preset + default tool + selection mask + visible status-line groups. Switching is instant and keeps the document, selection and time.

| Workspace | Layout | Defaults |
|---|---|---|
| **Animate** (default) | §2 (P3) | Mask: controls; tools Q/W/E/R; Graph Editor docked |
| **Rig** | Outliner (Skeleton expanded) · single persp (joints on, mesh X-ray) · right: **Control Builder** (shape library, size, colour, constraint type, maintain offset, *Auto control rig (VRM humanoid)*, *Mirror L→R*) + Attributes · bottom: **Validation** list (humanoid mapping gaps, unskinned meshes, scale issues) | Mask: joints + controls |
| **Review** | P6: shotCam large, persp floating thumbnail, timeline only, side docks collapsed | Mask: none (view only); later: comments, playblast (WebM via `canvas.captureStream()` + `MediaRecorder`) |
| **Model** *(future, tab visible but disabled with a "Coming later" tooltip)* | persp + top/front/side, tool strip with curve tools (CV/EP/Bézier), component-mode toggle, Attributes | Proves the shell is generic: new tools, a new selection mode, no shell changes |

### 9.4 Extension points for modeling later

- The tool registry already models *tool = pointer state machine + manipulator + status-line options*; spline tools register the same way.
- The selection model is `{ kind: 'object' | 'component', ids }` from day one, so components (CVs, edit points) need no new store.
- The pane `Show ▾` menu is data-driven (layer registry), so "CVs", "Hulls" and "Edit points" are just new layers.

---

## 10. Onboarding, empty states, import/export

### 10.1 First run / empty viewport

```
┌──────────────────────────── persp (empty) ────────────────────────────┐
│                                                                        │
│                   ⬇  Drop a .glb, .gltf or .vrm here                   │
│                                                                        │
│           [ Open file… ]   [ Try a sample avatar (CC0 VRM) ]           │
│                 Recent:  hero.vrm · fox.glb · robot.vrm                │
│                                                                        │
│   How do you navigate?   (•) Mouse — Alt + drag (DCC standard)         │
│                          ( ) Trackpad — two fingers / pinch            │
│                                                                        │
│                  ? Shortcuts   ·   Getting started guide               │
└────────────────────────────────────────────────────────────────────────┘
```

- The whole app is a drop target: a 2 px dashed `--accent` frame plus the label "Drop to import" while dragging files over it.
- The sample avatar is a CC0 VRM 1.0 model (the VRM 1.0 sample used as a fixture in `ekza-avatar-renderer`, or a CC0 avatar from the Open Source Avatars set). Its licence and attribution are shown in Help › About. CC-BY items need attribution, so only CC0 items ship as built-in samples.
- After the first load, a dismissible **Getting started** card (top-right of the viewport, 4 steps with checkmarks): ① Character loaded ✓ (humanoid detected) → ② *Create control rig* (one click, VRM humanoid) → ③ Pick or create a clip (or *Start from Ekza clip: idle/walk/…*) → ④ Set your first key (`S`) → Export. Coach marks point at the relevant UI and never block input.
- Empty Graph Editor: "Select a control to see its curves" with a mini illustration and the `Auto-load` toggle highlighted. Empty Dope Sheet / Clips get equivalent one-liners with a primary action.

### 10.2 Import dialog (after drop / open)

| Section | Content |
|---|---|
| Summary | file name, format (glTF 2.0 / VRM 0.x / VRM 1.0), size, meshes, bones, morph targets/expressions, embedded clips count |
| Humanoid | **Detected: VRM humanoid (54/55 bones)**, or for plain GLB a heuristic mapping (common auto-rigger skeleton names) with a "Review mapping" link (Rig workspace) |
| Scale & axes | units (m; glTF is Y-up, metres), detected height, "Normalize height" off by default |
| Embedded clips | table: ✓ import, name (editable), duration, fps guess, channels; option *Import as: keep sampled keys / resample to N fps / reduce keys (tolerance)* |
| Control rig | Auto (humanoid) · None · Custom later |
| Licence | VRM meta badge (§10.3) |
| Warnings | unsupported extensions, unskinned meshes, more than 4 influences, non-uniform scale on joints, missing humanoid bones |
| Actions | **Import** (primary), Cancel |

Dropping a `.vrma` or an animation-only `.glb` while a character is loaded opens **Import animation**: target character, retarget mode (VRM humanoid → humanoid automatic; GLB by name map), clip name, conflict policy (*new clip* / *replace* / *merge into active*, later *as layer*).

### 10.3 Licence awareness (VRM meta)

VRM 1.0 `meta` carries `avatarPermission`, `commercialUsage`, `creditNotation`, `allowRedistribution` (default false) and `modification` (`prohibited` default / `allowModification` / `allowModificationRedistribution`). UI rules:

- The Character section and the Import summary show a licence badge, e.g. `Redistribution: no · Modification: prohibited`.
- **"Bake into model file" writes a modified copy of the avatar.** If `modification = prohibited` or `allowRedistribution = false`, the Export dialog shows a warning and requires an explicit acknowledgement ("For personal use; I will not redistribute"). Ekza upload of a baked avatar is disabled for such files. Exporting **separate VRMA** (animation only) is always allowed: it does not contain the avatar.

### 10.4 Export dialog

```
┌ Export ─────────────────────────────────────────────────────────────────────┐
│ ( ) Bake into model file      (•) Separate animation files                  │
│                                                                              │
│ Clips            ✓ walk (1–120, 30 fps)   ✓ idle (1–90)   ☐ wave_wip        │
│ Format           [VRMA ▾]  (VRMA · GLB animation-only · later FBX/BVH)      │
│ File name        {character}_{clip}.vrma      → hero_walk.vrma, hero_idle…  │
│ Range            (•) Clip range  ( ) Playback range  ( ) Custom [  1]–[120] │
│ Sampling         (•) Keep keys where exact  ( ) Bake every [1] frame @30fps │
│ Root motion      (•) Keep hips translation  ( ) In place (zero XZ)          │
│ Include          ✓ Expressions (VRM)  ☐ LookAt  ✓ Loop flag (extras)        │
│                                                                              │
│ ⚠ 3 non-humanoid bones are animated; VRMA will drop them. [Show]            │
│ Estimated size 184 KB · 52 channels · 1 940 keys · ✓ validated by re-import │
│                                                                              │
│                        [Cancel]  [Export & upload to Ekza ⓘ]  [Export]      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Bake into model file** variant: output `.glb` / `.vrm`; choose the clips to embed; existing embedded clips: keep / replace edited ones / remove unchecked; controls are editor-only and are baked down to bones (never exported); licence gate (§10.3).
- **Separate files** variant: one file per clip. VRMA requires a VRM humanoid (the `VRMC_vrm_animation` extension maps nodes to humanoid bones; humanoid bones and expressions are supported). GLB animation-only exports the skeleton nodes plus animation.
- Naming tokens: `{character}`, `{clip}`, `{fps}`, `{date}`; live preview of the output names; invalid characters are replaced and flagged.
- Validation runs on export in a worker: re-import the produced bytes, compare channel counts and sample poses at the keys, report max error. A green check or warnings appear *before* the download.
- Last-used settings are remembered per project.

### 10.5 Ekza upload (stub)

- Button **Export & upload to Ekza** in the Export dialog and **File › Publish to Ekza…**. The MVP state is disabled with tooltip "Coming soon — sign in with Ekza".
- Planned form: title, description, tags, asset kind **Animation** (the Ekza registry currently types assets as `avatar | weapon`, so an `animation` kind is a registry change tracked in the integration doc), compatible rig (VRM humanoid), licence (CC0 / CC-BY 4.0 / custom), thumbnail (auto-captured from `shotCam` at a chosen frame), visibility. Success → link to the asset page.

---

## 11. Accessibility and responsiveness

### 11.1 Accessibility baseline (WCAG 2.2 AA where applicable)

- Contrast per §8.3; focus visible everywhere (`:focus-visible`); hit targets ≥ 24×24 px.
- Keyboard-reachable chrome: `F6` / `Shift+F6` cycle focus between regions (menu bar → status line → left dock → panes → right dock → bottom dock → timeline). Each region exposes ARIA roles: `menubar`, `toolbar`, `tree` (Outliner), `grid` (Channels), `tablist` (docks), `slider` (time slider: `aria-valuenow` = frame, arrow keys step frames while focused), `dialog`.
- Canvas content (viewport, curves) is not screen-reader accessible by nature. Every selection and value is also reachable through the Outliner and Channels panel, and every action is in menus and the command palette. Graph keys get a keyboard path: with the curve view focused, `Tab` cycles keys and the stats fields edit them.
- Never colour alone (§4.5, §5.5, §8.2): axis letters, key glyph shapes, state bars, dashed styles for remote users.
- `prefers-reduced-motion`: no camera transitions, no animated collapses. `prefers-contrast: more`: switch to a high-contrast token set (later).
- UI scale 90/100/110/125/150 % (root `font-size`; all tokens in `rem`), independent from browser zoom, which must also work.

### 11.2 Responsiveness

| Width | Behaviour |
|---|---|
| ≥ 1600 px | default layout; Attributes may sit under the Channels panel |
| 1280–1599 | default layout (§2) |
| 1024–1279 | Left dock collapses to an icon rail (opens as an overlay drawer); right dock 220 px; status-line labels hidden (icons + tooltips) |
| 768–1023 (tablet landscape) | Compact: single viewport, bottom sheet for Graph/Dope Sheet, docks as drawers; touch/pen profile (later) |
| < 768 | **Review only**: playback, orbit, clip switch; editing disabled with a banner "Open on a larger screen to edit" |

Minimum supported for editing: **1024 × 640**. Height < 700 px auto-collapses the bottom dock to its tab strip.

### 11.3 Pen / tablet / touch (later, but designed in)

- Pointer Events from day one: `pointerType` (`mouse` / `pen` / `touch`), `getCoalescedEvents()` for smooth pen drags in the Graph Editor, no mouse-only events.
- Pen: barrel button = RMB (marking menu), hover = pre-select, pressure unused.
- Touch (iPad/Apple Pencil later): one finger = tool, two fingers = tumble/pan/pinch, two-finger tap = undo, three-finger tap = redo, long-press = marking menu. `camera-controls` already supports `touches.one/two/three` actions.

---

## 12. Collaboration affordances (Phase 3, designed now)

State model prerequisite (§13): document state is shared; selection, current time, camera, tool and hover are **per-user ephemeral state** broadcast over a presence channel (Yjs *awareness* is the natural fit when the document is a Yjs doc).

| Surface | Affordance |
|---|---|
| Menu bar | **Presence stack**: avatar chips (initials or Ekza avatar) in each user's presence colour; hover = "Anna — editing Hero › l_wrist_ctl in Graph Editor"; click = **Follow** (your pane mirrors their camera; any navigation stops following) |
| Outliner | coloured dot(s) next to items other users have selected; **character ownership** chip when the session uses "one character per animator" mode |
| Viewport | remote selection: dashed 2 px control outline in the user colour + name chip; remote live drags arrive as normal document updates (no remote manipulator drawn); remote cursors not shown in 3D (noise) |
| Channels | 2 px left bar in the user colour on channels another user is editing right now |
| Graph Editor | **remote cursors** in *graph space* (frame, value), so they land correctly at any zoom; remote key selection = coloured outline ring; name tag on hover |
| Timeline / Dope Sheet | **remote playheads**: thin lines in the user colour with an avatar tab on the ruler; playback is independent per user by default; *Sync playback* toggle for review sessions |
| Soft locks | Starting to drag a control someone else is dragging → amber toast "Anna is moving this — continue?" Otherwise last-writer-wins per key, and overwritten edits show "Restore mine" in a toast |
| Undo | per-user (Yjs `UndoManager` with tracked origins); History panel shows authors |
| Session | "Invite" button (link), roles: editor / viewer; viewer = Review workspace forced |
| Two-animators-one-character ("four hands") | Recommended convention surfaced in the UI: split by **body region or channel set** (e.g. upper/lower body). The Outliner can tag control groups with an owner; non-owners see them dimmed with a "Take over" action |

---

## 13. Implementation: component tree and state ownership

### 13.1 React component tree

```
<App>                                        // Next.js client-only route ('use client'; canvas not SSR'd)
 <Providers>                                 // Theme(tokens), Prefs, CommandRegistry, HotkeyManager, Toasts, Tooltip
  <EditorShell>
   <MenuBar>
     <AppMenus/>                             // Radix Menubar; items = command ids
     <WorkspaceTabs/>
     <PresenceStack/>                        // later
     <ExportButton/>
   </MenuBar>
   <StatusLine>
     <ToolGroup/> <ManipulatorSpaceSelect/> <SnapToggle/> <SelectionMaskToggles/>
     <KeyTargetSelect/> <AutoKeyToggle/> <TweenSlider/> <LayoutPresetPicker/>
   </StatusLine>
   <DockHost>                                // dockview-react; panel registry below
     <OutlinerPanel>   <OutlinerFilterBar/> <OutlinerTree/>            (virtualized)
     <ClipsPanel>      <ClipTable/> <ClipActions/>
     <ViewportPanel>   <ViewportHeader/> <ViewportSurface/>            // DOM rect registered with ViewportManager
                       <ViewportHUD/> <NavGizmo/> <SafeFrameOverlay/> <EmptyDropZone/>
     <GraphEditorPanel><GraphToolbar/> <SplitPane>
                         <ChannelList/>                                 (virtualized)
                         <CurveCanvas/>                                 // Canvas2D, imperative renderer
                       </SplitPane> <RemoteCursorsLayer/>
     <DopeSheetPanel>  <DopeToolbar/> <DopeRows/> <DopeCanvas/>
     <ChannelsPanel> <ChannelsHeader/> <ChannelRows/> <ChannelContextMenu/>
     <AttributesPanel> <ControlSection/> <ConstraintSection/> <BoneSection/> <ClipSection/> <CharacterSection/>
     <RigBuilderPanel/> <ValidationPanel/>                              // Rig workspace
   </DockHost>
   <TimelineBar>
     <TimeSlider/>                           // canvas-drawn ticks + DOM playhead badge
     <RangeSlider/> <ClipSelect/> <FpsSelect/> <PlaybackControls/> <LoopToggle/> <SpeedSelect/>
   </TimelineBar>
   <HelpLine/>
  </EditorShell>
  <GLHost>                                   // ONE <Canvas> (R3F), fixed, behind the DOM, eventSource = shell root
    <SceneRoot>  <Characters/> <ControlRigs/> <Ghosts/> <Grid/> <SceneCameras/>
    <ViewportRenderer/>                      // loops panes: setViewport/setScissor, layers, overrides
    <ManipulatorLayer/>                      // per active pane
  </GLHost>
  <Overlays>                                 // portals
    <MarkingMenu/> <CommandPalette/> <ContextMenus/> <Toasts/>
    <ImportDialog/> <ExportDialog/> <UploadDialog/> <PreferencesDialog/> <HotkeyEditor/>
    <GettingStartedCard/> <ShortcutSheet/>
  </Overlays>
 </Providers>
</App>
```

### 13.2 State ownership (global vs local)

| State | Owner | Scope | Persistence | Collab |
|---|---|---|---|---|
| Document: characters, rigs/controls, clips, curves/keys, scene cameras (`shotCam`), camera & time bookmarks, fps, ranges | `documentStore`, mutated **only** via commands | global | project file + autosave | shared (CRDT later) |
| Undo/redo stacks | `commandBus` | global, per user | session | per-user |
| Selection: objects/controls, keys, tangent handles, highlighted channels, lead item | `selectionStore` | global, per user | session | awareness |
| Time: `currentFrame`, `isPlaying`, speed, loop, playback range (range also in doc) | `timeStore` (transient subscriptions) | global, per user | range in doc; rest session | awareness (remote playheads) |
| Tool: active tool, manipulator spaces, snap, selection mask, key target, auto-key | `toolStore` | global, per user | prefs | no |
| Workspace/layout: active workspace, dockview JSON, pane configs | `workspaceStore` | global, per user | localStorage | no (camera via awareness for Follow) |
| Preferences: nav profile, hotkey overrides, UI scale, density, palettes | `prefsStore` | global, per user | localStorage | no |
| Graph Editor view: transform `sx, sy, f0, v0`, mode, channel filter, auto-load/pin | panel-local (`useRef` + reducer), mirrored to layout JSON on idle | per panel instance | layout | no |
| Viewport pane: camera-controls instance, view history, display flags, lock | `ViewportManager` registry (non-React) keyed by pane id | per pane | layout (persp) / doc (`shotCam`) | camera via awareness |
| Hover, drag-in-progress, marquee rect, pre-drag snapshot, tap/hold timers | refs / interaction state machines | component-local | none | drag "intent" later |
| Menus/dialog open state | component-local or `overlayStore` | local | none | no |
| Heavy caches: decoded GLB, textures, sampled pose cache (onion skin, graph previews) | services (`AssetRegistry`, `PoseCache`) | global | IndexedDB cache | no |

Stores use **zustand 5** (`subscribeWithSelector`). The collaborative document later binds to a Yjs doc behind the same command API; UI code never talks to Yjs directly.

### 13.3 Hot-path and rendering rules

- **No React re-render per frame.** `currentFrame` changes at up to 120 Hz. Viewports, the curve canvas, the time slider and the HUD subscribe with `timeStore.subscribe(selector, cb)` and draw imperatively. Only small leaf components (frame field, playhead badge) re-render, and they use `useSyncExternalStore`.
- **Single canvas, many panes:** one WebGL renderer and one scene. `ViewportRenderer` iterates the registered pane rects (from `ResizeObserver` + `getBoundingClientRect` on layout change only), calls `renderer.setViewport` / `setScissor` / `setScissorTest(true)`, sets `camera.layers` and overrides per pane, and renders. This is the three.js multiple-views technique; drei's `<View>` scissors the same way but gives each view its *own* children scene, while panes here must show *one* shared scene. Use `frameloop="demand"` + `invalidate()` when idle; re-render only dirty panes (camera moved, document changed, time changed).
- Budget: interaction-to-paint ≤ 16 ms; Graph Editor full redraw ≤ 4 ms for 50 curves × 200 keys (Canvas2D, flattened Bézier cache per curve invalidated per edit); time slider ticks cached per selection change.
- Every pointer interaction is a small state machine (`idle → pressed → dragging → committing`). During `dragging` it writes *transient* values (no undo entry) and on release emits **one** command.

### 13.4 Command registry (shared by menus, marking menus, palette, toolbar, hotkeys)

```ts
type CommandId = `${string}.${string}`;            // e.g. 'key.set', 'graph.tangent.flat', 'view.frameSelected'
interface Command<A = void> {
  id: CommandId;
  label: string;                                    // i18n key
  icon?: IconId;
  scope: 'global' | 'viewport' | 'graph' | 'dope' | 'timeline' | 'outliner' | 'channels';
  defaultKeys?: Chord[];                            // physical codes, e.g. { code: 'KeyS', mods: [] }
  enabled?(ctx: CommandContext): boolean;
  run(ctx: CommandContext, args: A): void | UndoableOp;
}
```

### 13.5 Libraries (versions checked 2026-10-17 on npm)

| Package | Version | Licence | Role |
|---|---|---|---|
| `dockview-react` | 8.6.0 | MIT | docking, floating, popout, serialization |
| `react-resizable-panels` | 4.14.5 | MIT | fixed in-panel splits |
| `radix-ui` | 1.8.1 | MIT | accessible primitives: Menubar, DropdownMenu, ContextMenu, Dialog, Popover, Tooltip, Toggle |
| `cmdk` | 1.1.1 | MIT | command palette |
| `camera-controls` | 3.1.2 | MIT | navigation core (wrapped by the profile layer) |
| `@react-three/drei` | 10.7.9 | MIT | helpers (`Line2` wrappers, `Html`); *not* `<View>` / `GizmoHelper` for panes (see §5.5, §13.3) |
| `zustand` | 5.0.15 | MIT | stores |
| `lucide-react` | 1.59.0 | ISC | generic icons |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | 5.3.0 | OFL-1.1 | self-hosted fonts |
| *Not recommended for the main UI* | `leva` 0.10.1 (MIT) | — | its look and density don't match a professional DCC-grade Channels panel; keep it for dev-only debug panels |
| *Custom (≈ 300–500 LOC)* | HotkeyManager | — | needs `event.code`, panel-under-pointer scopes, tap/hold and key+mouse chords, which generic libraries (e.g. `tinykeys` 4.0.1) don't cover |

Reuse from the Ekza codebase: **`ekza-avatar-renderer`** for its CC0 shared clip library (`idle/walk/attack/cast/death`, imported as editable clips) and its VRM test fixture as the sample avatar. Tokens borrow only the accent and the spacing scale from **`ekza-arena-web`**, and only the method from **`omoba-ui`**. **`core`**'s input layer is gameplay-oriented (device-neutral movement), so it is not reused for editor hotkeys.

---

## 14. MVP cut (UI only)

| MVP (must) | Phase 1.5 | Later |
|---|---|---|
| Shell: menu bar, status line, help line, dockview with Animate + Rig workspaces, presets P1–P5, layout persistence + reset | Tween slider, Review workspace (P6), popout Graph Editor | Model workspace, Shelf, script console, high-contrast theme |
| Viewport: single-canvas multi-pane, Alt+drag and Trackpad nav profiles, persp/ortho/shotCam, **lock camera**, bookmarks, view history, SVG nav gizmo, display toggles 4/5/6/7, X-ray, joints, controls, isolate, safe frame | Onion skin (silhouette), background cycle | Motion trails (editable), playblast, Blue Pencil |
| Control rig visuals: circle controls with Line2, side colours, occlusion-aware X-ray, screen-space picking | Shape library beyond circle/square/cube | Custom shapes editor |
| Manipulators W/E/R with Object/World/**Gimbal**, snapping, readouts | Parent space, trackball | — |
| Outliner (tree, filter, sync) + Clips tab | Selection sets | Ownership chips |
| Channels panel with desktop-DCC state colours, virtual sliders, expressions, key/mute/lock menu; Attributes (Control, Constraint, Clip, Character) | Bone section extras | Expression channel |
| Graph Editor: channel list, curves, keys/handles, marquee, move/scale, **pen tool**, 7 tangent types, break/unify, normalize, stacked, buffer snapshot/swap, F/A, snapping, stats fields, tangent marking menu | Weighted tangents UI, Simplify/Smooth/Euler filters popovers, infinity editing | Retime tool, blend-to-buffer slider |
| Dope Sheet: rows, keys, breakdowns, move/scale, ripple, copy/paste | Hold bars | — |
| Time slider + range slider: ticks, scrub, Shift-range edit, bookmarks, clip selector, fps, loop, speed, auto-key | Audio waveform | Time Editor / layers UI |
| Hotkeys: §7.2 defaults, event.code, scopes, tap/hold, cheat sheet, marking menus (W/E/Q/Shift+S/RMB/Space) | Hotkey editor UI | Profiles (alternative keymap preset, open-source-DCC style) |
| Onboarding: empty state, sample avatar, nav-profile choice, Getting-started card; Import dialog; Export dialog (bake vs VRMA/GLB, naming, range, fps, validation); licence gate; Ekza upload stub | — | Ekza upload live |
| Tokens (CSS vars from `tokens.json`), contrast CI check, Inter, Lucide + custom icon set (tangents, tools, display) | Colour-blind palette | Light theme |
| — | — | Collaboration UI (§12) |

---

## 15. Open questions

1. **Space behaviour default:** keep the desktop-DCC tap-maximize/hold-radial (current spec) or default to Space = play for web-native users? (Spec: tap-maximize, with a first-run toggle next to the nav-profile choice.)
2. **Arrow keys:** desktop-DCC pick-walk (spec default) or open-source-DCC-style frame stepping? Owner preference decides; both exist as a preference.
3. **Default shot-camera framing:** fixed 3/4 front at 50 mm, or auto-framed from the character bounds on load (proposed: auto-frame once, then persist)?
4. **Euler-only authoring:** confirm that rotations are always edited as Euler curves (with rotate order per control) and converted on export; affects Channels panel and Graph Editor UX (the curve doc decides).
5. **Workspace "Model" tab** visible but disabled from day one (spec) or hidden until it exists?
6. **Timeline docking:** keep it fixed in the MVP (spec) or allow docking at once for users with vertical monitors?
7. **Brand intensity:** violet accent only for chrome (spec), or also playhead/selection to feel more "Ekza"? Not recommended: it collides with semantic colours.
8. **Collaboration granularity** for "four hands": region/channel ownership (spec suggestion) vs free-for-all with soft locks. Needs a prototype with two users.

---

## 16. Sources

Desktop DCC (vendor documentation; URLs omitted):
- Graph Editor Tangents menu (2025)
- Graph Editor toolbar (2025 / 2024)
- Graph Editor Curves menu (2023)
- `filterCurve` command reference
- `keyTangent` command reference
- Channels panel (2024)
- Time Slider (2024)
- Playback Controls (2025)
- Time Slider preferences
- Full hotkey reference list (2014)
- Isolate Select / Panel Show menu (2026)
- Interface preferences (one/two-button mouse mapping)
- Multi-touch trackpad
- What's New 2025 (Dope Sheet ripple edit, precision mode)
- Previewing animation / Ghosting (2023)

Other animation tools:
- Houdini animation toolbar (Tween/Ease sliders): https://sidefx.com/docs/houdini/anim/animationtoolbar.html
- Open-source DCC: "blend to ease" graph-slider pull request #106519 (URL omitted)
- Open-source DCC: trackpad gestures discussion, task T97925 (URL omitted)

Web platform:
- Keyboard Lock API (fullscreen-only, OS-allowed keys): https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock
- Pointer/Keyboard Lock permission (announced, then not launched): https://developer.chrome.com/blog/keyboard-lock-pointer-lock-permission
- Browser-reserved shortcuts (W3C UI Events discussion): https://lists.w3.org/Archives/Public/public-webapps-github/2016Jan/0255.html
- Chromium PDF viewer gesture detector (ctrl-wheel pinch on Mac): https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/resources/pdf/gesture_detector.ts
- WebKit pinch event bug: https://bugs.webkit.org/show_bug.cgi?id=145214
- MDN `KeyboardEvent.code`: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
- MDN `Keyboard.getLayoutMap()`: https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/getLayoutMap
- MDN Pointer Lock API: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API
- MDN `Element.setPointerCapture()`: https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
- MDN `PointerEvent.getCoalescedEvents()`: https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents
- WCAG 2.2 (1.4.3, 1.4.11, 2.5.8): https://www.w3.org/TR/WCAG22/

Libraries:
- dockview: https://dockview.dev/ · https://dockview.dev/docs/overview/introduction
- drei `View`: https://drei.docs.pmnd.rs/portals/view · `GizmoHelper`: https://drei.docs.pmnd.rs/gizmos/gizmo-helper
- camera-controls README (3.1.2): https://github.com/yomotsu/camera-controls
- three.js multiple views example: https://threejs.org/examples/#webgl_multiple_views
- Yjs awareness: https://docs.yjs.dev/getting-started/adding-awareness
- Lucide licence: https://lucide.dev/license · Inter: https://rsms.me/inter/

Formats:
- VRM 1.0 meta: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/meta.md
- VRM Animation (VRMA): https://vrm.dev/en/vrma/
- Okabe–Ito colour-blind-safe palette: https://jfly.uni-koeln.de/color/
