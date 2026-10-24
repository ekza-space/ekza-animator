# Ekza Studio — touch-first shell specification ("Halo")

Status: **v0.2 (2026-10-24), draft for the owner.** v0.2 answers the review of v0.1: three critics (coverage,
feasibility, UX) raised 75 issues, 5 of them blockers. Every issue and what was done about it is listed in §26. The
spec becomes binding when the owner accepts it and [ADR 0023](adr/0023-studio-touch-ui.md) moves to Accepted. The
contracts in §20.4 freeze when the input spike T1a and work package T2 have both merged. After that, changing a
contract needs a PR that updates this file first. Defaults and owner questions are recorded in
[DECISIONS-OPEN §O](DECISIONS-OPEN.md#o-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24) (`ST-*`).

Owner request (2026-10-24, translated): *"Can we make a lightweight version, say for iPad, while keeping all the
functionality? Design a universal, modern, even revolutionary UI/UX with very simple and convenient interaction. Keep
the current one as 'Studio Pro', and present the new one as essentially the same thing, with the emphasis on simplicity
and minimalism."*

Inputs:
- The research round of 2026-10-24 on `dev` @ `0512ba88` (v0.6.0, M-AI merged). It had five parts:
  - a capability inventory: 191 user-facing rows in 14 groups (it is §15 of this spec), 379 operator ids, about 51
    deferred stubs;
  - an architecture survey of the host, the shells and the size gates;
  - a touch and iPad readiness audit, with platform facts as of iPadOS 26.x and Safari 26;
  - a market survey of about 25 touch, tablet and AI-native tools, plus the HCI work behind them (§25);
  - ten core user journeys.
- Four competing concepts: *canvas*, *intent*, *object* and *journey*. Three judges scored them for simplicity, parity
  and feasibility. The ranking by summed score was object 24.8, canvas 22.7, journey 21.6, intent 18.5.
- The review of v0.1 (§26), with code reads at `0512ba88`.
- [ADR 0021](adr/0021-autorig-mode.md) and [AUTORIG-SPEC](AUTORIG-SPEC.md), the precedent of a second shell.
- [MCP-SPEC](MCP-SPEC.md) §0.4 and ADR 0018 (the agent bridge).
- ADRs 0006, 0008, 0011, 0013 and 0016.
- [FEATURES.md](FEATURES.md). It still says v0.5.1 and calls MCP "next release"; that is stale against v0.6.0, and T12
  refreshes it.
- [REQUIREMENTS](REQUIREMENTS.md) NFR-03, which supports Chrome/Edge and defers Safari to V1.

Audience: the owner (§0, §1, §9, §24, §26), the integration agent (T2, T12), the implementation agents of T0–T11 and
reviewers.

The rule this spec follows: **Ekza Studio adds no modeling, rigging, animation or export logic of its own.** It is a
third *shell*, a different user interface over the same `EditorApp`, document, undo history, operators and files as
Studio Pro and Auto-Rig. Every document write is an operator run (ADR 0021 rule 2). A shell may add a small number of
thin, public *wrapper* operators (§20.3 item 7); each one calls existing operators and is registered for every shell.
Orchestration that Auto-Rig owns today (intake routing, fix order, rig arguments, the motion test, export naming) moves
into `editor-core` so that both shells run the same code (§20.3 item 10).

---

## 0. Summary

**Ekza Studio is one studio with two layouts.** The *Simple* layout is this spec (working name **Halo**). The *Pro*
layout is today's Studio, shown as **Ekza Studio Pro**. Both open the same project, with the same undo history,
operators and files, and one tap switches between them.

The Simple layout is one full-screen 3D canvas:
- **Touch anything** — a face, a joint, a forearm, a key dot, a curve, an animation, a colour swatch, a warning on the
  model — and up to six verbs in plain words appear next to it. That ring of verbs is the *Halo*. **⋯ More** lists every
  operator that applies to the thing, with its Pro name and hotkey.
- **Search** is always on screen and reaches every operator by name, in any stage.
- **A thin bar at the top, the *Path***, shows where you are: Make · Paint · Rig · Animate, then **Share**. It shows how
  ready the character is for where it is going, from one source of checks. It never locks anything.
- **Input**: the Pencil makes things and fingers move the view. A finger drag moves what is already selected, or a
  handle; anywhere else it orbits. One on-screen **Thumb key** works like the iPad's Shift key (tap = next action only,
  double-tap = lock, hold = while held). Its label says what the next tap and the next drag will do, and it carries
  every modifier, held key and middle-click that Pro's tools read.
- **Numbers** are chips beside the result. They show the same numbers, units and signs as Pro.
- **Timing** lives in one strip, the *Thread*, with a labelled switch: Timeline · Keys · Curves. Keys and Curves run
  Pro's own Dope Sheet and Graph Editor controllers. Rec is on by default in this layout, as its own setting; Pro's
  Auto Key is untouched.
- **New in the release**: *Reach* posing (drag a hand and the arm follows), rig dots you drag in place, and the *Wave*
  and *Loop it* recipes in search.
- **Pro is one tap away** (▤ Pro layout) and keeps the document, the undo history, the selection, the frame and the
  camera. On touch-only devices one line first says that Pro is laid out for a mouse and keyboard.

The ten key decisions (ADR 0023 is the record):

| # | Decision |
|---|---|
| D1 | **A third shell, not a fork; one product with two layouts.** Internal id `halo`, route `/app`, package `@ekza-studio/halo`, in the `(studio)` route group under the same `StudioHost`. `/editor` keeps its id `studio` and is titled "Ekza Studio Pro". A first visit to `/` opens Ekza Studio; a remembered choice still wins (OQ-2). Auto-Rig stays at `/autorig` as *Rig a model for me*. |
| D2 | **Noun-first grammar.** The first tap on any thing selects it and opens its Halo: up to six curated verbs in plain words, plus ⋯ More, derived from the registry and `poll`. A drag manipulates. A long-press (right-click with a mouse) gives the same verbs as a flick ring, from Pro's marking-menu data. Pro names appear one layer down. |
| D3 | **One canvas plus the Path.** Make · Paint · Rig · Animate switch workspace, tools and a non-persisted display overlay; they never change the layout and never gate. Readiness glyphs, the status pill and Share's card read the same check rows and show one count. The destination is asked on the Rig-it card. |
| D4 | **Input is a stage of the viewport's own pointer path.** The arbiter buffers a press until slop or long-press decides it, then hands the original event (with its coalesced samples) to the tool. A finger drag manipulates only what is selected or a handle. Double-tap frames for every input. The Thumb key carries held keys and the middle button, and splits its meanings by gesture (tap / drag). |
| D5 | **Values beside the work, honestly.** After-run Echo chips only for adjustable operators; every other operator gets a pre-run form (✓ to run) from Halo-only form data. Leaving a tool session commits it (Done); only ✕ discards. |
| D6 | **Time on touch, in full.** Thread → Keys (Dope Sheet) → Curves (Graph Editor), with the focus registry and band source shared with Pro. Rec is a Halo session setting (`halo.rec`, default on), applied as a removable override. Reach posing ships in the release. |
| D7 | **Parity is enforced in a browser.** Every live, non-stub operator — internal ones too — every argument shape that Pro or Auto-Rig sends, every `UiDialog` value and every menu item has a non-search Halo surface, a reasoned `proOnly`, or (internal only) a `plumbing` entry from a short allowlist. The search-only count can only go down. |
| D8 | **Shared kernel work first, all additive.** The arbiter stage, virtual modifiers with held keys, a display overlay, an effective-preferences layer, a `SaveTicket` file service, Auto-Rig's orchestration in `editor-core`, the curve focus registry in `curve-editor`, Halo-only forms and agent-denied wrappers. Pro's behaviour does not change. |
| D9 | **iPad Safari is first-class and honest.** The `webkit-ipad` project checks compatibility only; a real-device gate with a named owner is part of the release gate. A host-level, per-device memory profile. *Export* and *Save project* are separate actions. Home Screen mode is suggested only after a Files backup. Phone works but is best-effort. |
| D10 | **Bundle discipline, measured first.** `/app` gets its own gate (about 700 kB, owner decision). The route adds 0 B to `/editor` and `/autorig`. The shared extractions are measured by a spike before ST-B1 is frozen, with an allowance per package; above 2,048 B the owner decides. |

Delivery: 17 work packages (T0, T1a, T1–T4, T5a–T5c, T6a–T6b, T7–T12), about **100 agent-days**. The critical path is
T1a → T1 → T6a → T7 → T10 → T12, about **39 agent-days** (§21). The release gate is the acceptance set in §22, including
a real iPad in Safari.

---

## 1. Name and positioning

### 1.1 One studio, two layouts

| | **Simple layout** (new) | **Pro layout** (today's Studio) | **Auto-Rig** |
|---|---|---|---|
| Who | Everyone, and the default front door. Touch and Pencil first; also good with a mouse and keyboard. | Animators and modelers who want the Maya-style power shell: docked panels, many editors at once, hotkeys. | People who only want "rig my model and get a file", step by step. |
| What | Everything Pro can do (§15), one layer at a time. | Unchanged: menus, docks, workspaces, marking menus, Maya keymap. | The five-step wizard, unchanged. |
| Route / internal id | `/app` / `halo` | `/editor` / `studio` (unchanged) | `/autorig` / `autorig` (unchanged) |
| Title in the UI | "Ekza Studio" | "Ekza Studio Pro" | "Rig a model for me" |
| Switch shown as | ▤ *Pro layout* | ▤ *Simple layout* | *Back to Studio ▸* when entered from Halo |

The positioning line is: *"Ekza Studio — one studio, two layouts. Simple: one thing at a time, by touch. Pro: every
panel at once."* There is no product tier and no "Lite": both layouts open the same file, and every capability is in
both (§15). Pro keeps its name, as the owner asked, but the UI presents it as a layout of the same studio, not as the
"real" product above a cut-down one. Nothing in Pro moves or changes to fit Ekza Studio (§3 P10).

### 1.2 The entry at `/`

v0.1 kept a two-card chooser ("Ekza Studio (beta)" next to "Ekza Studio Pro"). The review found that it reads as Lite
against Pro, the framing the owner ruled out. v0.2:

- **A first visit opens Ekza Studio's Home**, on every device. Home has a quiet *▤ Pro layout* link and *Rig a model
  for me ▸*. There is no either/or screen.
- **A remembered choice wins.** The key `ekza-studio:entry:v1` gains `'halo'`; stored `'studio'` and `'autorig'` values
  keep redirecting as today, so returning Pro users land in Pro. Using the layout switch updates the remembered entry
  (the same key the chooser's *Remember* writes); Settings › Start in can pin one.
- `/?chooser=1` still shows the chooser (three rows, for support links). Deep links (`/app`, `/editor`, `/autorig`)
  never redirect.
- `EntryChoice`, `ENTRY_ROUTES`, `REDIRECT_SCRIPT`, Studio's `entryChoice.ts`, the first-run dialog's "Open this mode
  next time", Preferences › Start in and `entry-contract.test.ts` change together (T2).
- **Default ST-2 (changed in v0.2).** Owner question OQ-2: confirm that a first visit on a desktop also opens Ekza
  Studio (the alternative keeps today's chooser for fine-pointer first visits).
- Until the release gate (T12), `/app` is reachable by URL only and `/` behaves as today. The new entry and the "Ekza
  Studio Pro" title land together at T12 (ST-30).

### 1.3 Naming rules

Internal:
- `'studio'` keeps meaning Pro everywhere internally: e2e specs, `from=studio`, `MountedShell.kind`, stored entry
  choices and the `ekza-animator:` storage keys all depend on it.
- The new shell's id is `halo`. The shell marker is `ekza-halo-shell` and the e2e family is `ha-`.
- The URL avoids `/studio` while `to:'studio'` means `/editor`, and the id avoids `simple`, which is Auto-Rig's
  navigation name.
- The coined names in this spec are for the people building it, not for users: Halo, Path, Thread, Thumb key, Echo
  chip, Loupe, View puck, session bar. Help pages may name the parts.

**User vocabulary: one word, one kind of thing.** The catalogue `halo/src/i18n/en.ts` is the only source of strings,
and a lint fails when one word labels two kinds of noun or verb:

| Word | Means only | Never used for |
|---|---|---|
| **Animation** | a clip (the *Animations* row, `+ New`, Library cards) | — (v0.1's "Move" for clips is gone) |
| **Move** | translation (the Move ring, Move X / Y / Z) | clips |
| **Turn** | rotation (the turn ring, Turn X / Y / Z in Numbers) | — |
| **Add** | putting new content into the project (Add skeleton, Add animation, Add starter set, Add thumbs) | selection |
| **Select more / Pick or unpick / Unselect** | the Thumb key's selection meanings | — |
| **New shape** | a primitive (Make tray *New shape ▾*) | — |
| **Key** | a keyframe, and the verb that sets one | — |
| **Numbers** | the Inspector (Channel Box, Attributes and Rig Toolkit fields) | — |
| **Other side** | the mirrored part (`select.mirror`) | — |
| **Export … to Files** | writing a baked file for a destination (VRM, GLB, VRMA, zip) | saving the project |
| **Save project** | writing the editable `.ekzanim` | exports |

---

## 2. Goals, non-goals and what the research says

### 2.1 Goals

1. Every capability in the 191-row inventory (§15) is reachable without a keyboard, hover, right-click, middle-click or
   modifier key. Deliberate Pro hand-offs exist only for *presentation* (§15.15). The few per-platform exceptions are
   listed in §15.0 for the owner to sign off.
2. The 25 most frequent tasks of a game-character artist (below) can be done on an iPad in Safari **with fingers
   alone** (the Pencil is optional), each at most two taps deep from the thing it acts on.
3. The same document and history across Ekza Studio, Pro and Auto-Rig. Switching keeps the undo history and commits
   any open tool session (AS-ST-6).
4. A calm screen: one canvas, at most three edge zones, no modal on first open, no floating panel that covers the
   selection (a layout test, AS-ST-18), and a visible-target budget per stage (§4.8, AS-ST-17).
5. Universal: iPad landscape and portrait and desktop with mouse, trackpad and keyboard at the release, with one mental
   model. Phone works, but is best-effort and not part of the release gate (OQ-11). The layout uses container
   queries, never device sniffing.

**The 25 tasks** (AS-ST-3 checks each one, finger-only, on a device):

| # | Task | # | Task |
|---|---|---|---|
| 1 | Open a GLB or VRM from Files | 14 | Change the ease of keys |
| 2 | Try a sample | 15 | Edit a curve key's value and tangent |
| 3 | Fix an intake problem (stand up, scale) | 16 | Copy, paste and mirror a pose |
| 4 | Rig a humanoid automatically | 17 | Select faces and pull them out |
| 5 | Adjust the guessed rig dots | 18 | Bevel, inset or loop-cut |
| 6 | Add the starter animations | 19 | Add a shape and change its inputs |
| 7 | Add a library animation with speed and in place | 20 | Colour faces, fill a part |
| 8 | Make a new animation with a length | 21 | Find and fix a bad bend in the weights |
| 9 | Turn a body part | 22 | Check health and fix a problem |
| 10 | Reach-pose a hand or a foot | 23 | Export for OMOBA (VRM) to Files |
| 11 | Key a pose at a time | 24 | Save the project to Files and open it again |
| 12 | Scrub, play and loop | 25 | Undo, redo and look through the history |
| 13 | Retime keys | | |

### 2.2 Non-goals (v1)

- No new modeling, rigging, animation or export algorithms (one exception, §12.4: pressure folded into existing stamp
  strength).
- No docking, layout presets or keymap editor in Ekza Studio (§15.15).
- No AI on iPad until the owner chooses a transport (OQ-5).
- Not in v1: performance capture ("Perform"), onion skins and motion trails (M2c), automatic foot-slide fixing
  (motion-analysis P4), the full phrase grammar (T13), glue pins (T15) and a native app wrapper.
- No phone-specific work package at the release (OQ-11).
- Pro does not change, except for its title, one lazy "Simple layout" switch and the shared input fixes that help every
  shell (§20.3).

### 2.3 What the research says (digest)

- **Same core, different lens.** Shapr3D is identical across Mac, iPad and Windows, with one licence. Blender's tablet
  project is explicitly "not Blender Lite". Cascadeur Mobile keeps the timeline, ghosts, trajectories and IK/FK. Forks
  died: Gravity Sketch's cut-down iPad app was unlisted.
- **Selection drives the UI** (Shapr3D's Adaptive UI, Valence 3D). **Search guarantees reachability** (Linear, Blender's
  helper overlay). **A radial menu becomes flicks** with practice: with a mouse, the mark is about 3.5× faster than
  picking from the menu (Kurtenbach & Buxton). On touch the ring waits for the 450 ms long-press, so that speed-up
  applies to right-drag with a mouse, not to the long-press. **The Pencil writes and touch manipulates** (Hinckley,
  "Pen + Touch = New Tools").
- **A shared gesture set.** Procreate and Nomad use the same one: two-finger tap undo, three-finger tap redo, four-finger
  tap hides the UI. Every gesture needs a visible twin: iOS's three-finger swipe-undo is one of its least-used features,
  and Shapr3D users fear accidental undo on large iPads.
- **Failures to avoid.** Figma rolled back UI3's floating panels; users said they made the canvas smaller and slowed
  them down. Shapr3D 5.300 changed its interaction model without an opt-out and users pushed back. Adobe Aero and
  Toontastic were discontinued. Procreate Dreams recordings flood the timeline with keys and it has no graph editor.
- **The platform.** Every iPad browser runs WebKit. Apple Pencil squeeze, double-tap and barrel roll never reach web
  pages. Pressure, tilt, altitude and azimuth do, and so does hover on hover-capable iPads. Safari fires no
  `contextmenu` on a long-press, never shows a `beforeunload` prompt, may evict IndexedDB after 7 days without a visit,
  has no save or open file pickers, and kills a tab at roughly 1.5–2 GB. A Home Screen web app has storage separate from
  the Safari tab. Pages render at about 60 Hz even on ProMotion displays.
- **The code.** The kernel is ready: one operator registry with labels, polls, aliases and ParamDefs, menus and marking
  menus as data, and Auto-Rig as proof that a second shell keeps the document and history. The Pro shell is not
  touch-ready:
  - navigation needs Alt chords or the wheel, and the viewport commits a press on `pointerdown`;
  - hit radii are 2–8 px and drag thresholds 2–3 px;
  - keyboard scope comes from hover;
  - there are right-click-only menus;
  - Rig & Skin is view-only below 1024 px;
  - Pencil pressure is never read;
  - Safari is outside the test gate.

  Auto-Rig already has touch navigation, 44 px targets and touch e2e tests.

---

## 3. Principles

- **P1 Nouns first.** You touch the thing, then pick a verb; the verbs live on the thing. Every pickable object,
  component, joint, control, key, curve, animation, swatch, warning, history step and the playhead is a noun with a
  Halo.
- **P2 Fewer things visible, never fewer things possible.** There is a depth ladder: L0 on screen, L1 one tap, L2 More or
  a sheet, then search, then Pro. CI enforces it (§20.5), and each stage has a visible-target budget (§4.8).
- **P3 One document, one registry, one history.** Ekza Studio is a view over editor-core. It has no fork and no file
  format of its own, and every action is an undoable operator run. The agent, Pro and Auto-Rig see everything it does.
- **P4 The Pencil makes, fingers move the view, the thumb modifies.** Routing depends on pointer type. Settings ›
  Input shows it as a table the user can change.
- **P5 Every gesture has a visible twin; no undo is silent.** Each undo toast names its step, including selection steps
  (§5.3 C9).
- **P6 The canvas is the UI.** Parameters, problems, hierarchy and timing appear on or next to the object. Sheets dock
  to an edge. Floating items are anchored to what they edit and never cover the selection. Labels use words, not icons
  alone.
- **P7 No modifier, hover, right-click or middle button required.** Keyboard, mouse and Pencil hover make things faster
  but never gate anything.
- **P8 Plain words first, Pro words one layer down.** "Pull" appears at L1. More and search show "Pull · Extrude ·
  ⌘E", so Ekza Studio teaches Pro. DCC jargon never appears at L0 or L1 (§17).
- **P9 Every automatic result lands as sparse, labelled, undoable steps.** This covers Rig it, recipes, Reach, AI and
  later Perform. Each has a manual fallback.
- **P10 Pro is never changed to fit Ekza Studio.** Halo never rewrites Pro's keymap, marking menus, layouts, pane
  display memory or defaults. Shared preferences are never written implicitly; Halo's session settings are removable
  overrides (§16.4).
- **P11 Fluid, never locked.** The layout uses container queries from 320 pt to desktop, and editing is never locked by
  width (Halo never calls `setRigViewOnly`, AR-V1).
- **P12 An honest platform.** The UI never promises what iPad WebKit cannot do (squeeze, barrel roll, the loopback AI
  bridge, a confirmed save to Files), and says plainly where a feature does work.
- **P13 One concept, one state.** A mode shown in two places is one flag and lights in both places; v1 never shows a
  duplicate control with its own state.
- **P14 Same numbers as Pro.** A value shown with a plain label has exactly Pro's number, unit and sign (§10.1).
- **P15 Leaving keeps your work.** Switching stage or layout commits an open tool session; only an explicit ✕ discards,
  and it says what it discards.

---

## 4. Screen anatomy

### 4.1 The parts (the same on every device)

| Part | Where (right-handed default; Settings › Input › Handedness mirrors it) | What |
|---|---|---|
| **Top bar** (52 pt) | Top edge | `◂ Project • ▾`: project menu with New, Open, Import, Samples, **Save project to Files**, Recover, Scene, History, Settings, Help, Full screen and Home. The dot means unsaved changes. Then the **Path** (§7), `⌕ Do or find…` (§8), `Share ⤴` with a destination badge, and `▤ Pro layout`. |
| **Canvas** | Full bleed under the bar | One viewport, pane id `pane-single`, so camera memory is shared with Pro. The View sheet adds 2- and 4-pane layouts on wide containers (§15 row 1.6). |
| **Breadcrumb** (the selection chip) | Floats above the selection, never over it | At rest: `Cube Lad › Right arm › Forearm · Numbers`. Tap a crumb to select it; tap *Numbers* for the Inspector. Long-press the last crumb for ‹ › siblings, ▾ children, *Other side*, *Select branch* and *Rename*. On desktop with the Halo off-by-default it also shows `⋯ Verbs`. In Make it carries the *Select ▾* chip (Loop · Ring · Shell · Grow · Shrink · Select area). |
| **Halo** | Beside the selection, joined to it by a thin line; in Keys and Curves, docked in the layer header | Up to 6 petals plus ⋯. The petals sit on the side away from the Pencil hand and avoid screen edges (80 pt radius, 144 pt edge margin, the marking-menu geometry). |
| **Echo chips** | Next to the result of the last operation, never over the selection | Parameter chips (§5.6). |
| **Session bar** | Top of the canvas, under the bar | Only during modal tools: `✕ Cancel · tool · hint · ✓ Done`, plus ⌫ (remove last point) and − n + where they apply. |
| **Off-hand column** | Lower corner on the non-Pencil side | `↶` (long-press it for the History ribbon, which holds Redo), and below it the **Thumb key** (56 pt, §5.5), shown only when it means something here. |
| **View puck** | Lower corner on the Pencil side | An orientation cube. Tap a face for front, side or top; tap the centre to frame the selection; double-tap to frame all; drag to orbit; long-press for the View sheet. |
| **Status corner** | Above the puck | Shown only when there is something to say: the problem count for the current destination (`● 2 to fix ▸`) and, when the destination has a triangle budget, the budget ring (`812 / 3,000`). |
| **Tray** | Bottom edge | Empty space is a noun too, and the tray is its Halo, docked: the current stage's tools and state chips (component pill, Mirror edits, Falloff, Snap; swatch row; brush bar; Rig segment). The last item is always `⋯`, pinned, so it never scrolls away. In Animate the **Thread** sits here. |
| **Sheets** | Right edge in landscape (360 pt); bottom edge in portrait and on phones | Numbers, More, Scene, Library, Health, Share, About this character, History, Settings, View, Help, Ask. Each has peek, half and full heights, set by its grab bar. Scrolling inside a sheet is `touch-action: pan-y` with `overscroll-behavior: contain`. |

Rules for all parts:
- Targets are at least 44 × 44 pt, and input text is at least 16 px, so iOS never zooms on focus.
- Nothing sits within 20 pt of the bottom edge (the home indicator) or within 12 pt of the side edges.
- While Halo is mounted, the shell sets `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none` and
  `overscroll-behavior: none` on `html` and `body` (except inside text fields and scrolling sheets) and cancels
  `gesturestart`, so pinching never zooms the page and pull-to-refresh never reloads it. The policy is registered by
  the shell controller with a disposer, so Pro on the same page zooms and scrolls as before (ha-12).
- Text fields that are always visible (the search pill, chip values) are buttons that turn into inputs only when
  tapped, and back on blur, so Pencil Scribble never captures a stroke that starts near them.
- A row that does not fit wraps to a second line or folds its lowest-priority items into its pinned `⋯`. Nothing is
  cut off at an edge.

### 4.2 iPad landscape (≥ 1024 pt container)

**A. First open: Home.** No modal, no first-run dialog, no recovery dialog, no empty grid. The live canvas renders one
still of a sample behind the cards, then idles at 0 fps. With no Continue cards, the primary (filled) door is *Try a
sample*, because a new user may have no model file. With Continue cards, the Continue row comes first.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Ekza Studio                                       ⌕ Do or find…   ▤ Pro layout │
│                                                                                  │
│               Make, rig and animate 3D characters. Nothing is uploaded.          │
│                                                                                  │
│    ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐      │
│    │ ▶  Try a sample    │   │ ⇪  Bring a model   │   │ ✎  Make a          │      │
│    │ already moving     │   │ GLB · VRM · saved  │   │    character       │      │
│    │ Polybot ▾          │   │ project · animation│   │ 3 starts           │      │
│    └────────────────────┘   └────────────────────┘   └────────────────────┘      │
│                                                                                  │
│    Just want a rigged file?  Rig a model for me ▸                                │
│    ✎ Pencil edits · ☝ finger moves the view · two-finger tap = undo              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**B. A model loaded, Make stage, two faces selected.** The Halo shows the face verbs. The tray shows Make's tools and
state chips. The status corner shows a problem; there is no budget ring because the destination is *Just exploring*.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│◂ Cube Lad•▾ ( Make⚠1 │ Paint○ │ Rig○ │ Animate○ ) ⌕ Do or find…  Share⤴  ▤ Pro │
├──────────────────────────────────────────────────────────────────────────────────┤
│                    Cube Lad › Body › 2 faces · Numbers · Select ▾                │
│              (Pull)╲                                                             │
│           (Inset)───╭──────────────╮                                             │
│           (Bevel)───│   ▓▓ ▓▓      │                                             │
│          (Colour)───╰──────────────╯      ( clay shading, wire on the            │
│          (Delete)╱   (⋯ More)               selection, symmetry plane faint )    │
│                                                                                  │
│                                                               ● 1 to fix ▸       │
│ ↶                                                                   ┌───┐        │
│ ┌──────────────────┐                                                │ F │ View   │
│ │ ⊕ Select more    │                                                └───┘        │
│ └──────────────────┘                                                             │
│ [Whole│Points│Edges│Faces●] Mirror edits ◉ Falloff ○ Snap ○ │ New shape ▾ Cut ▾ ⋯│
└──────────────────────────────────────────────────────────────────────────────────┘
```

After **Pull**, the cap handle appears, the parameters show as Echo chips, and a reduced Halo stays next to them, so
the next face verb is still one tap away. Nothing is modal: the next tap elsewhere commits, and ↶ undoes it.

```
│                       ┌──┐ ← cap handle (drag to change the distance)            │
│                       │▲▲│   ⟨Distance 0.12 m⟩ ⟨Segments 2⟩                      │
│                       └──┘   (Pull again) (Bevel) (Inset) · Options              │
```

**C. Animate stage, posing.** The right forearm was tapped on the mesh. Rec is on (this layout's default), so the
drag already wrote a key; there is no question card and no "not keyed" pill.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│◂ Seed-san•▾ ( Make○ │ Paint● │ Rig● │ Animate◐ )  ⌕ Do or find…  Share⤴   ▤ Pro │
├──────────────────────────────────────────────────────────────────────────────────┤
│                  Seed-san › Right arm › Forearm · Numbers                        │
│      (Key ◆)╲                                                                    │
│   (Mirror ▾)─╭──── turn ring ──────╮                                             │
│     (Reset)──│     forearm    ◯    │   ⟨Bend 34°⟩ ⟨Twist 0°⟩ ⟨Side −5°⟩          │
│  (Copy pose)─╰─────────────────────╯                                             │
│ (Hand leads)╱  (⋯)                                                               │
│                                                                                  │
│ ↶        Animations: [Idle] [Walk] [Wave ▾] [+ New]                  Library ▸   │
│ ⊕ ≈ Fine  ▶ 0.50 s ·◆····◆····┃···◆······◆· 2 s  ● Rec  [Timeline│Keys│Curves]   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**D. Deep tool: Curves.** The Thread is switched to *Curves* (§10.5). The canvas keeps at least 45 % of the height and
keeps playing. At 1180 pt and wider, Numbers is pinned as a 300 pt column beside the curves, so curves and channels are
visible together. The key Halo is docked in the layer header, not over the keys.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│◂ Walk•▾   ( Make○ │ Paint○ │ Rig● │ Animate◐ )   ⌕ Do or find…  Share⤴   ▤ Pro  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                 O    canvas live, playhead synced · L foot                       │
├─────────────────────────────────────────────────────────────┬────────────────────┤
│ [Walk ▾] [Timeline│Keys│Curves●]  L foot ▾  Move Y● Move Z○ ⋯│ Numbers · L foot   │
│ [Select│Move│Insert│Scale]   Key: Ease ▾ · In-between · Delete│ Move X   0.000 m   │
│ ┌─────────────────────────────────────────────────────────┐ │ Move Y   0.000 m ◆ │
│ │1.2│       ●╮             ╭●────────●╮                    │ │ Move Z   0.104 m   │
│ │   │  ●────╯ ╰───●────────╯          ╰───●                │ │ Turn X   0.0°      │
│ │0.0│──────────────o====o── 2 keys ──────────────          │ │ Heel ⟨0°⟩ Ball ⟨0°⟩│
│ └─────────────────────────────────────────────────────────┘ │                    │
│ ⟨Time 0.40 s⟩ ⟨Value 0.000 m⟩ ⟨In 0°⟩ ⟨Out 0°⟩   Fewer keys · Fix flips · Cycle ▾ ⋯│
│ ▶ 0.40 s ··········┃································· 1 s   ● Rec                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**E. Deep tool: weights.** Rig stage, Skin segment, posed on the frame where the elbow breaks (§12.4). The influence
card is docked to the right edge, away from the elbow.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ✕ Cancel        Paint weights · Upper arm L · elbow bent 60°            ✓ Done   │
│                                                   ┌────────────────────────────┐ │
│      ( posed character, weight ramp on the mesh ) │ This area follows          │ │
│               ◌ ← Pencil hover: ring + "0.72"     │ ● Upper arm L   0.72  ‹ ›  │ │
│                                                   │ ○ Chest         0.28       │ │
│                                                   │ All bones ▾                │ │
│ ↶                                                 └────────────────────────────┘ │
│ ┌───────────────────────┐                                           ┌───┐        │
│ │⊕ tap: sample          │                                           │ P │        │
│ │  drag: brush size     │                                           └───┘        │
│ └───────────────────────┘                                                        │
│ [Replace│Add●│Scale│Smooth] ⟨Size 4 cm⟩ ⟨Strength 0.6⟩ ⟨Value 1.0⟩  Pressure ◉  ⋯ │
│ Mirror ◉  Flood  Show: ramp ▾  [Bind│Test●│Clip]  Bend elbow ⟨60°⟩  ▶ Play         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**F. Share.** A sheet over any stage (§13.3). The export button names the file it writes. The project is saved
separately, and its state is shown at the bottom.

```
┌───────────────────────────────── Share ─────────────────────────────────────┐
│ For:  (● OMOBA & Ekza Space)  (Game engine)  (Just the animations)  (Prop)   │
│       (Into the original file)   More formats ▸            Just exploring    │
│ ──────────────────────────────────────────────────────────────────────────── │
│  OMOBA & Ekza Space                                       2 things to fix    │
│   ⚠ Licence — choose one:  (Free for anyone · CC0) (Credit me · CC BY)       │
│                            (Personal use only) (Custom…)                     │
│   ⚠ 2 thumb bones missing                                 [ Add thumbs ]     │
│  Name [Cube Lad      ]   Author [              ]   Thumbnail ▣ automatic     │
│  Animations: Idle ✓  Walk ✓  Run ✓  Wave (no slot) ▸                         │
│  Advanced ▾  (format VRM 1.0, profile, key reduction, colours as …)          │
│                                     [ Export Cube Lad.vrm to Files ]         │
│  Project: saved on this iPad, not in Files           Save project to Files ▸ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 iPad portrait and windowed iPad (700–1023 pt container)

The Path moves under the top row. Sheets rise from the bottom. Halo, Thread, Thumb key and puck stay.

```
┌────────────────────────────────────────────────┐
│◂ Seed-san•▾          ⌕     Share⤴   ▤ Pro      │
│ ( Make○ │ Paint● │ Rig● │ Animate◐ )           │
│          Right arm › Forearm · Numbers         │
│  (Key◆)(Mirror▾)(Reset)(Copy pose)(⋯)          │
│                  o                             │
│               \__|     ⟨Bend 34°⟩ ⟨Twist 0°⟩   │
│                  O                             │
│                 /|\                            │
│ ↶                                     ┌───┐    │
│ ⊕ ≈ Fine                              │ P │    │
│ Animations: [Idle][Walk][Wave ▾][+]   └───┘    │
│ ▶ 0.5 s ·◆··◆·┃·◆··◆· 2 s  ●Rec  [Tl│Keys│Crv] │
│ ═════════════ Numbers (peek) ══════════════    │
│ Forearm R   Bend ⟨34°⟩  Twist ⟨0°⟩  Side ⟨−5°⟩ │
└────────────────────────────────────────────────┘
```

Rig & Skin, including weight painting, is fully editable here, unlike Pro's view-only rule below 1024 px (AR-V1). The
Halo arc turns into a horizontal row when the space beside the selection is narrower than 240 pt.

### 4.4 Phone (< 700 pt container) — best-effort

The same parts, folded for the thumb. Phone is not part of the release gate (OQ-11): it gets the Compact layouts below
and a smoke test, nothing more, until the owner decides otherwise.

```
┌──────────────────────────────┐
│◂ Wave•   ⌕   Share⤴     ↶    │
│                              │
│        ( canvas )            │
│   Right arm › Forearm        │
│   ⟨Bend 34°⟩ ⟨Twist 0°⟩      │
│                         (P)  │
│ ──────────────────────────── │
│ (Key◆)(Mirror)(Reset)   (⋯)  │ ← the Halo docks as a verb bar; ⋯ is pinned
│ ▶ ·◆··┃··◆··◆· 2s  [Tl│K│C]  │ ← Thread (Animate)
│ ⊕ ≈ Fine                     │
│ Make │ Paint │ Rig │ Animate●│ ← the Path becomes a tab bar
└──────────────────────────────┘
```

- The Halo becomes a verb bar above the Thread, with the same verbs in the same order. `⋯` is pinned at its right end;
  verbs that do not fit fold into it. ▤ Pro layout moves into the project menu. *Share* keeps its word.
- Sheets open at full height. One pane is shown, and a two-pane step (the rig dots) becomes a Front | Side toggle.
- The weights influence card becomes a tray row. Weight and colour painting work with a 40 pt finger offset: the brush
  sits above the fingertip, as in Nomad. A hint says a bigger screen is easier.

### 4.5 Desktop (mouse, trackpad, keyboard)

The same anatomy as iPad landscape, with these differences:
- **With a fine pointer and a keyboard**, Settings › Input › *Halo opens on* defaults to **right-click or hold**: a click
  selects, the breadcrumb shows `⋯ Verbs` as the visible way in, and right-click opens the Halo as a flick ring at the
  cursor, like a Maya marking menu. *Every click* is the alternative. A touch-first device keeps *every tap*.
- **Hover** pre-highlights and shows tooltips with the Pro name and hotkey. No feature depends on hover.
- **Navigation** follows the user's own Pro `navProfile`: Maya Alt-drag, trackpad or one-button. Left-drag on empty
  space also orbits; Alt falls through to the profile, as in Auto-Rig's Simple navigation.
- **Keyboard**: the Maya keymap works through the host `KeyboardAdapter`, except the chords that arrange Pro's window
  (§5.8); Mod+K or `/` focuses the search pill.
- **The Thumb key hides** after the first hardware Shift, Cmd or Alt press (Settings › Input › Thumb key: Auto · Always
  · Never).
- Numbers can be pinned as a column on any container of at least 1180 pt while the Thread shows Curves, and on any
  container of at least 1600 pt at all times. It is still a sheet, not a dock.

### 4.6 Size classes

Layouts switch on **container** width (`@container`), never on viewport width or user agent; iPadOS 26 windows resize
freely.

| Class | Container width | Path | Sheets | Halo | Panes |
|---|---|---|---|---|---|
| Wide | ≥ 1024 pt | in the top bar | right edge, 360 pt (Numbers pinnable ≥ 1180 with Curves, ≥ 1600 always) | arc; docked in Keys and Curves | 1, 2 or 4 (View sheet) |
| Regular | 700–1023 pt | second row | bottom | arc, or a row when cramped | 1 or 2 |
| Compact | < 700 pt | bottom tab bar | bottom, full height | verb bar with pinned ⋯ | 1, with a switcher |

The input mode (touch, pen or mouse) comes from the last `pointerType` and `any-pointer: coarse`, never from the user
agent. iPad Safari reports itself as `MacIntel` (§19).

### 4.7 Stage lighting and breathing chrome

- **Stage lighting** re-lights the same canvas instead of moving panels:
  - Make: clay, with wire on the selection.
  - Paint: lit swatch colours.
  - Rig: mesh x-ray at 40 %, joints and controls emphasised; in Skin, the weight ramp.
  - Animate: shaded, with controls drawn as soft halos and part names.

  It is applied through a new, non-persisted **display overlay** (`ViewportManager.setDisplayOverlay`, §20.4), merged
  at render time and removed when the shell unmounts. Halo never calls `providePaneDisplay` and never writes the pane
  display memory that Pro reads after a switch (AS-ST-10). The overlay can set the x-ray opacity, which is a constant
  (0.5) in Pro's theme today.
- **Breathing chrome**: while a finger or the Pencil is down on the canvas for a stroke or a drag, every cluster except
  ↶ fades to 15 % and ignores touches. It returns on lift. **Playback never fades or locks the chrome**: during playback
  every control stays live, and a tap on the canvas or the ruler pauses.
- **Hide UI** (View puck › Hide UI, or the project menu) leaves only the canvas and a faint restore button in the
  corner.

### 4.8 Visible-target budget

Each stage has a budget for the interactive targets visible at L0 on an iPad landscape container, asserted in ha-05
(AS-ST-17). v0.1's Animate screen had about 50.

| State | Budget | Example (Animate) |
|---|---|---|
| At rest (nothing selected) | ≤ 22 | top bar 8 · Thread 7 (▶, time readout, ruler, Rec, the three-way layer switch) · Animations row 5 · ↶ 1 · puck 1 |
| With a selection and its Halo | ≤ 36 | the above, plus breadcrumb 4 · petals 6 · channel chips 3 · Thumb key 1 |

The rules that keep it there:
- The status corner appears only for a problem or a budget.
- Redo leaves L0: it is in the undo toast and in the History ribbon (long-press ↶).
- The breadcrumb's ‹ › ▾ and *Other side* live on a long-press of the last crumb.
- The Thread's transport is collapsed to ▶ and the time readout; tapping the readout shows start, previous and next
  key, previous and next frame, end, loop mode, speed and the range brackets (§10.3).
- The Thumb key appears only when it means something for the next tap or drag (§5.5).

---

## 5. Input: gestures, Pencil, Thumb key, numbers

### 5.1 Input roles and routing

| Routing mode (Settings › Input) | Finger | Pencil | When |
|---|---|---|---|
| **Shared** | A one-finger drag manipulates what is **already selected**, or a handle (manipulator, turn ring, cap handle, a key dot on the Thread). With a brush tool active (weight paint, Paint Colour), the mesh under the finger is claimed, and the stroke starts only after 10 pt of travel or 120 ms; if a long-press fires first, the stroke preview is rolled back. Anywhere else a one-finger drag orbits (ortho panes pan). Two fingers pan and pinch. | Same as a finger, with finer tolerances | Default until the first `pointerType: 'pen'` event |
| **Pencil edits** | Navigates, taps to select, long-presses for the Halo, scrubs the Thread and chips. Never paints or drags geometry. | Selects, manipulates any visible thing (selected or not), paints, marquees, draws key bands, writes in fields | Switched on by the first pen event, with a toast: *"Pencil found: the Pencil edits, fingers move the view. [Keep] [Change]"* |
| **Pencil only** | Navigates only, and taps chrome | Everything on the canvas | Opt-in |

- Why "already selected": in close-ups the mesh fills the screen, and in v0.1 every hit on it was claimed, so a finger
  could no longer orbit and navigation attempts became tweaks. Selecting first costs one tap, which every journey makes
  anyway (J2, J3).
- **The brush claim set** includes the Paint Colour tool. Auto-Rig's `MESH_TOOLS` lacks it today, so the extraction in
  T1 adds it.
- **Palm rejection.** While the pen is down, or a pen event arrived in the last 500 ms (hover), touches only navigate.
  When WebKit reports a contact size for touches (device check D14), contacts larger than 30 px are ignored once a pen
  has been seen; without a reported size this rule is off.
- **Pressure** is read only when `pointerType === 'pen'`. Finger strokes use the Strength chip as it is (touch pressure
  reads 0.5 and would halve every stroke).
- **Mouse and trackpad** keep the user's Pro profile (§4.5). The trackpad's secondary click opens the Halo ring.
- The Settings table lists each action by input (Finger / Pencil / Mouse), and each cell can be remapped as in Nomad.
  Mappings are a Halo preference (`halo.input`) and never touch Pro's `navProfile`.

### 5.2 Gesture vocabulary

Only one- and two-finger gestures are used. Three-, four- and five-finger gestures and the screen edges belong to
iPadOS and are never used.

| Gesture | Finger | Pencil tip | Mouse / trackpad | Visible twin |
|---|---|---|---|---|
| Tap a thing | Select it and open its Halo | Same | Click selects; the Halo opens per §4.5 | Tap its row in the Scene sheet or in search |
| Tap a selected thing again | Reopen its Halo | Same | Same | ⋯ Verbs on the breadcrumb |
| Overlapping candidates | The Loupe opens when candidates collide (§5.4); after any tap, *Next ›* on the breadcrumb steps to the next candidate under that point | Same | Same | The Loupe list |
| Tap empty space | Clear the selection (an undo step in Make and Rig, §5.3 C9); in Animate a **Reselect** chip shows for 4 s | Same | Same | ⋯ › Select none / Reselect |
| Drag a thing | Selected thing or handle: its manipulation; anything else: orbit (Shared) | Its manipulation (§6.1), selected or not | Left-drag | Echo chips and the numpad |
| Drag empty space | Orbit (perspective) or pan (ortho); a marquee while the Thumb key's *Select more* is on | Marquee | Left-drag orbits; profile chords | The puck's drag; *Select ▾ › Select area* |
| Two-finger drag / pinch | Pan / dolly | — | Two-finger scroll and pinch, per profile | Puck drag; puck sheet › Zoom |
| Two-finger tap | **Undo** one step; the toast names it and offers Redo. Fingers that rest do nothing more | — | — | ↶; Redo in the toast and the History ribbon |
| Double-tap a thing / empty space | **Frame** it / frame all — the same for finger, Pencil and mouse | Same | Double-click | Puck centre / puck double-tap |
| Quick pinch-in (< 300 ms, released) | Frame all (Settings toggle, default on) | — | — | Puck double-tap |
| Long-press, 450 ms, ≤ 10 pt movement | The Halo as a flick ring at that point; on a list row, key, swatch, chip or channel, its menu | Press-and-hold: same | Right-click, or hold (§4.5) | ⋯ on any Halo or chip |
| Press, drag and release / flick | Run the ring slot you released on (250 ms / 20 px, the marking-menu controller) | Same | Right-drag | Tap the petal |
| Hover | — | Pre-highlight, brush ring and value, loop-cut preview, faint labels of the selected thing's Halo ("ghost Halo") | Pre-highlight, tooltips | None needed (previews only) |
| Pressure | — | Brush strength (weights, colour) | — | ⟨Strength⟩ chip plus the Pressure toggle |
| Thumb key | §5.5 | — | Shift, Cmd and Alt are the same | The latch chip |
| Thread (§10.3) | Tap the ruler: jump · drag the playhead: scrub · long-press the ruler then drag: key band · horizontal pinch: zoom time · two-finger drag: pan time | Drag on the ruler draws a key band | Click, drag, wheel | The layer switch, the expanded transport |
| *Glue (after GA, T15)*: a finger held on a thing while the Pencil acts | Pin or target that thing | — | — | Thumb chooser › Pin; verb → target |

Growing a selection (loop, ring, shell) and filling a part are **not** double-taps any more: they are on the
breadcrumb's *Select ▾* chip and on Paint's *Fill part*, so each gesture has one meaning for every input.

Pencil squeeze, double-tap and barrel roll are never used, because web pages do not receive them. A native wrapper
could later map squeeze to "Halo at the tip" (OQ-12).

#### 5.2.1 Finger-only routes per surface

Most teenagers have no Pencil, and phones never do. Every Pencil gesture has a finger route and a labelled chip twin.
Finger-only variants of ha-J4 and ha-J6 are in the release gate.

| Surface | One finger on empty space | One finger on a thing | Long-press, then drag | Two fingers |
|---|---|---|---|---|
| 3D canvas | Orbit (ortho: pan); marquee with *Select more* on | Selected thing or handle: manipulate; otherwise orbit | The ring, then a slot | Pan and pinch |
| Thread ruler | Scrub | Key dot: retime | Key band over the dragged range | Pan and zoom time |
| Keys layer (Dope Sheet) | Marquee | Key: retime | Key band | Scroll rows; pan and zoom time |
| Curves | Marquee | Key or tangent handle: move | The key's menu | Pan; pinch time and value |
| Sheets and lists | Scroll | — | The row's menu (lift-and-drop to reparent in Scene) | — |
| Chips | — | Scrub; tap for the numpad | The chip's menu | — |

Chip twins: *Select ▾* (Select area · Loop · Ring · Shell · Grow · Shrink) on the breadcrumb in Make; *Fill part* in
the Paint tray; *Select area* in the Keys and Curves headers.

### 5.3 Conflicts and how they are resolved

| # | Conflict | Resolution |
|---|---|---|
| C1 | A two-finger double-tap (to hide the chrome) would undo twice before it registered | Dropped. Hide UI lives in the View puck sheet and the project menu. |
| C2 | Double-tap meant "frame" for a finger and "grow" for the Pencil and the mouse | One meaning: double-tap frames, for every input. Grow and fill moved to chips (§5.2). |
| C3 | Long-press against the start of an orbit or drag | A press that moves more than 10 pt before 450 ms is a drag or orbit and never opens the ring. A press held still for 450 ms opens the ring; the tool never saw the press (§20.4 arbiter stage). |
| C4 | A vertical pinch to unfold the Thread against a horizontal pinch to zoom time | A pinch on the Thread always zooms time. The layer changes only through the labelled switch. |
| C5 | Quick pinch to frame all against dolly | Classified on release: under 300 ms, scale below 0.7 and no pan means frame all. Anything else stays a dolly. Settings › Input can turn it off. |
| C6 | The thumb on the Thumb key plus one finger on the canvas looks like a two-finger tap | A pointer belongs to a pane only when its event target is inside that pane's element (DOM containment, honouring stacking order). Pointers on chrome — petals, chips, trays, the Thumb key — never join a canvas gesture. |
| C7 | A palm while drawing | Pen priority and, where WebKit reports it, large-contact rejection (§5.1). |
| C8 | Multi-select would reopen the Halo on every tap | While a selection meaning of the Thumb key is on, taps update the Halo in place. Its header shows "5 parts". |
| C9 | An accidental tap on empty space loses the selection | Selection undo follows the shared `prefs.modeling.undoSelection` (`model: true, animate: false, rig: true`). In Make, Paint and Rig a selection change is an undo step: the toast names it (*"Undid: select 2 faces"*), and the History ribbon folds selection steps into the next document step. In Animate selection is not an undo step, so the **Reselect** chip restores it. |
| C10 | Safari pinch-zooms, scrolls or pulls to refresh | The shell-wide policy of §4.1 (`touch-action`, `overscroll-behavior`, `gesturestart`), installed and removed by the shell controller. |
| C11 | Pencil Scribble against drawing on the canvas | Scribble works only in a focused text field. Always-visible fields are buttons until tapped, so a stroke that starts near the top bar never becomes text (D-list D15). |
| C12 | Keyboard shortcuts drop to the global scope after a finger lifts (hover-based scope) | For non-mouse pointers the host takes the key scope from `lastPanel` (T2, `createHost.ts:233`). |
| C13 | Three-finger redo | Not used. Redo is in the undo toast and the History ribbon. |
| C14 | Two fingers resting before a pan or pinch | They do nothing; there is no hold-to-repeat undo. Several undos are several taps, or the History ribbon. |
| C15 | A finger pinch also fires iOS `gesturechange`, so the trackpad-pinch handler would dolly twice | `gesturechange` is ignored while the arbiter tracks two or more touch pointers (S21). |
| C16 | A brush stroke against a long-press on the same mesh | In Shared mode a stroke starts after 10 pt or 120 ms; a long-press that fires first rolls back the stroke preview (§5.1). |
| C17 | Model's select tool treats two presses within 500 ms and 4 px as a loop or shell select, for any pointer | The arbiter absorbs the second tap of a double-tap and frames instead; the tool never sees it. The double-click window and radius scale with the pointer type (§5.4). |
| C18 | Playback against chrome | Chrome stays live during playback; only a pointer down on the canvas fades it (§4.7). |

### 5.4 Picking: tolerances and the Loupe

- **Tolerances by `ToolPointerEvent.pointerType`** (T1; Pro benefits too):

  | | Pick radius | Drag slop | Multi-tap window | Double-tap radius | Cycle radius |
  |---|---|---|---|---|---|
  | Touch | 22 px | 10 px | 450 ms | 24 px | 24 px |
  | Pen | 9 px | 4 px | 350 ms | 8 px | 8 px |
  | Mouse | today's values (`viewport/src/theme.ts` PICK, `ComponentPicker` 6–8 px, Graph 4–6 px) | 2–4 px | 400 ms | 4 px (`DOUBLE_CLICK_PX`) | 3 px (`PICK.cycleRadiusPx`) |

- **Manipulator size** grows for touch at render time, by a pointer-type scale inside the manipulator kit, with
  hysteresis (it switches after two presses in a row of the other type). It never writes `tools.manipulatorSize`, the
  session value Pro shares, so Pro never inherits big handles.
- **The Loupe** (v1: chips only). When the hit candidates within the radius collide (fingers, the face, overlapping
  control curves), a list of named candidate chips opens above the finger, built from `ViewportManager.pickCandidates`:
  `Index 1 · Index 2 · Hand control · Body mesh`. Tap a chip, or slide onto it and lift. A magnified view needs either
  `preserveDrawingBuffer` (memory on iPad) or a second scissored render; neither is in v1.

### 5.5 The Thumb key

One 56 pt key in the off-hand lower corner. It works like the iPad keyboard's Shift key, which teenagers already know:

- **Tap**: the meaning applies to the **next** action only, then turns off. The key shows a filled arrow.
- **Double-tap**: lock it. The key shows a lock, and a canvas-edge tint plus a chip ("Select more · on ✕") make the state
  visible.
- **Hold**: active for as long as the thumb stays down.
- **Slide up**: the chooser, with the other meanings that apply here.
- **A hardware keyboard's Shift, Cmd and Alt are the same thing**; after the first one is seen, the key hides (§4.5).

**Meanings are split by gesture class**, because a meaning such as "Fine" applies to drags and "Select more" to taps,
and the next touch could be either. The key shows both lines while either applies — `⊕ select more` / `≈ fine` — and
each meaning has its own glyph. It is **hidden** when neither line would change the next tap or drag (nothing selected
and no drag meaning; the Share sheet open; a recipe card waiting).

| Context | Tap meaning (glyph) | Drag meaning (glyph) | In the chooser | Pro equivalent |
|---|---|---|---|---|
| Something selected (any stage) | **Select more** (⊕) | — (on empty space: marquee) | Pick or unpick (⊙), Unselect (⊖) | Shift+Mod / Shift / Mod click |
| Echo chip, key or handle (outside Make transforms) | Select more | **Fine** ×0.1 (≈) | Coarse ×10 | Shift / Mod during a drag |
| Extrude cap handle | Select more | **Smart** (✦), read at drag start | Fine | Shift at drag start |
| Joint drag (Rig › Skeleton) | Select more | **Alone** (◌): the joint without its children | Orient only, Fine | held D |
| Move or turn manipulator in Make | Select more | **Snap** ▾ (grid · vertex · increment) | Fine, Coarse, Pivot edit | held X / V / J; Shift / Mod; held D |
| Falloff (soft selection) on | Select more | **Falloff size** (drag anywhere to size it) | — | held B + drag |
| Merge drag / Weld to… | — | **Centre** (weld at the midpoint) | — | middle button / Alt+Shift |
| Multi-Cut session | **Snap point** | — | Loop (insert a loop) | Shift-click / Ctrl-click |
| Paint Colour | **Fill part** (tap fills the shell) | — | Pick colour | Shift-click / held I |
| Paint weights session | **Sample value** | **Brush size** | Pick bone (tap), Strength, Value (drag) | held I / Shift+I; held B / M / N + drag |
| Thread ruler | — | **Band** (drag selects a key band) | — | Shift+drag on the time slider |
| Thread band body | — | **Copy** (drag copies the keys) | — | Mod+drag |
| Thread playhead | — | **Carry pose** (scrub carries the pose) | — | middle-button scrub |
| Keys layer, Curves | Select more | **Axis** (lock to time or value) | Fine | Shift on drag |

- **One state** (P13). Where a sticky session state already exists, the Thumb key's lock *is* that state, not a copy:
  locking *Snap* turns on the tray's Snap chip, locking *Fill part* turns on the Paint tray's Fill toggle,
  *Pivot edit* is `model.pivotEdit`, *Falloff size* acts on soft selection. The two controls light together. v0.1's
  *Smart* Echo chip and the Thumb meaning *Smooth* in weight painting are gone (Smooth is a brush mode in the tray).
- **How it reaches the tools.** The key feeds `ViewportManager.setModifierSource()`. The source carries
  `{shift, mod, alt, held, button}` (§20.4): `held` is the set of virtual held key codes (X, V, J, D, B, M, N, I), and
  `button` stands in for the middle button. The viewport merges virtual holds into the tools' `ToolKeyEvent` down/up
  stream and into `isHeld()` (the transform runtime's `held` flags, the rig runtime's `Held`, the paint tool's held
  set), with a provenance bit. Tools keep their semantics; the only tool-side change is one internal virtual-key hook
  in `rig/runtime`'s `Held` (T1).
- **The mapping is one data table**, `halo/src/input/modifierMap.ts`, keyed by tool id, phase and gesture class. Its
  unit test drives each row through the real tool (fixture apps) and checks the result, not prose. Before T1,
  `keymap/toolModifiers.ts` gains the rows it lacks today (the joint D hold, the skin B/M/N/I holds, Quick Rig's X,
  the Graph's Shift axis lock, the time slider's Shift band and Mod copy), and the conformance test covers every
  `TOOL_HOLD_CODES` entry.
- **Coach text comes from the same row**: *"Tap ⊕ once to select more with your next tap · double-tap to keep it on"*,
  or *"Hold ≈ while dragging for fine steps"*.

### 5.6 Numbers: Echo chips, forms, distance scrub, numpad

- **After-run chips** appear only after an operator whose runs can be adjusted (`flags.adjustable`, the existing
  `edit.adjustLast` contract). Its parameters float as chips beside the result: `⟨Segments 2⟩`, `⟨Distance 0.12 m⟩`.
  A transform does the same with live TRS. While a modal tool runs, chips are bound to `NumericTarget`.
- **Pre-run forms** for everything else. Many operators cannot be adjusted after the run (`graph.curves.simplify`,
  `time.insertTime`, `time.deleteTime`, `key.tween`, `graph.infinity.set`, `pose.mirrorAnimation`, `clip.new`,
  `rig.ikFk.matchRange`, `mesh.cleanup`, …), and the animation operators declare no ParamDefs at all. For these the
  verb opens its parameters as chips *before* the run, filled with the defaults, with ✓ to run: *Fewer keys
  ⟨tolerance 0.5⟩ ✓*. The form's values come from **Halo-only form data** (`@ekza-studio/editor-core/forms`, §20.3
  item 6): Pro, `LastRun` and the MCP schemas never read it, so Pro's repeat, adjust-last and palette behave exactly as
  today. Operators whose arguments depend on session state show it read-only in the form (*"at 0.50 s · Forearm R"*).
- **Anchoring.** Chips sit next to the result and never over the selection. The numpad opens anchored to its chip.
- **Same numbers as Pro.** A chip shows Pro's value, unit and sign; the numpad header names the Pro channel
  (*"Side · Rotate Z"*), §10.1.
- **Distance scrub**: drag a chip sideways to change it. The farther the finger moves away vertically, the finer the
  step: ×0.1 at 80 pt and ×0.01 at 160 pt, as in iOS media scrubbers. The Thumb key's Fine works too. This replaces
  Shift/Ctrl precision, Pointer Lock and the virtual slider.
- **Tap** a chip for the numpad:
  - Pencil-sized, 16 px text;
  - minus, decimal point and expressions (`+ − × ÷ ( )`, `=`);
  - units, and ±1 / ±10 nudges;
  - Next / Done, and Scribble.

  It replaces typed numeric capture, the arrow-key nudges and the iPhone decimal keypad, which has no minus.
- Enums become segmented chips and booleans become toggle chips. ⟳ **Again** runs `edit.repeatLast` (adjustable and
  repeatable operators only). **Options** saves the current values as defaults (`prefs.set{modeling.optionDefaults}`),
  only through *Make default*.

### 5.7 Session bar

Every modal tool session — Multi-Cut, Insert Loop, the extrude session, the rig dots, paint, pivot edit, test pose —
shows the session bar at the top of the canvas:

`✕ Cancel · <tool> · <one-line hint> · ✓ Done`, plus `⌫` (remove the last point), `− n +` (counts, replacing PgUp/PgDn)
and the tool's chips (Snap, Loop).

- It replaces Esc, Enter, Backspace, the right-click finish and PgUp/PgDn.
- With a keyboard, Esc is the same as ✕ and Enter the same as ✓.
- **Leaving commits** (P15). Tapping a Path stage, ▤ Pro layout, Share, Home or anything that ends the session runs ✓
  Done. Only ✕ discards. When ✕ would discard more than three steps it asks, naming them: *"Discard 14 strokes?
  [Discard] [Keep]"*. ha-10 and ha-12 check that strokes survive a stage switch and a round trip to Pro.

### 5.8 Keyboard and mouse

- Halo adds a small keymap scope `halo` on top of the Maya preset:
  - Space = play (Halo always plays; Pro's `spaceBehaviour` pref is untouched);
  - Mod+K or `/` focuses search;
  - Ctrl+1–4 switch Path stages (checked against keys Safari reserves; dropped where they collide);
  - Esc and Enter work the session bar;
  - T focuses the first Echo chip (Pro's Last-op card); G is ⟳ Again.
- **The chords that arrange Pro's window are shadowed**: Alt+1–4 (`workspace.preset.apply`), Ctrl+Space and Alt+0
  (`workspace.toggleFocus`) and the other `PRO_CHROME` chords run a poll-failing operator in the `halo` scope (as
  `model.animateOnly` does for Animate-only keys), whose reason reads *"That shortcut arranges Studio Pro's panels ·
  Pro layout ▸"*. They never write Pro's layout state from Halo.
- Every other Maya binding works as in Pro. A selection made in Halo is the one Pro's hotkeys act on.

---

## 6. The Halo: contextual verbs per object

### 6.1 Grammar rules

- **Tap = select and open the Halo. Drag = the thing's natural manipulation (once selected, §5.1). Long-press = the
  same verbs as a flick ring.** One rule, everywhere: viewport, Thread, sheets, chips.
- **The first tap is enough** on every noun, including list items: tapping an inactive swatch, animation chip or key
  makes it active *and* opens its Halo. There is no "Use" petal and no "tap again for verbs".
- The natural manipulation of each noun:
  - control: turn about its joint (FK), or move (IK goals, root); hands, feet, head and hips also *Reach* (§10.1);
  - joint: move with its children;
  - mesh object: move;
  - component: tweak;
  - key dot: retime;
  - curve key: change time and value;
  - band: move;
  - swatch: drop it on a part to colour it;
  - rig dot: move it (§12.2).
- **At most 6 petals plus ⋯.** The petals are curated per noun and stage in `halo/src/verbs/table.ts` (data, about
  4 kB). Where a noun matches one of Pro's marking menus (`model.modes`, `model.tools.*`, `model.convert`,
  `model.merge`, `rig.modes`), the petals keep Pro's slot directions, so flicks carry over from Pro.
- **Slots never move.** How often a verb is used may reorder only the ⋯ More list, never the petals.
- **A petal may change its verb in place** when the next step is obvious; the slot stays:
  - after a repeatable operation, the last petal becomes `⟳ Again: Bevel` (`edit.repeatLast`);
  - after *Copy pose* or *Copy* (keys), that petal becomes *Paste ▾* (with *Copy again* inside) until the clipboard is
    replaced.
- **After a face or edge operation** (Pull, Inset, Bevel), a reduced Halo stays beside the Echo chips: *Pull again ·
  Bevel · Inset*. The next face verb is one tap away without re-tapping the cap.
- With several things selected, the header reads "3 parts" and only verbs whose poll passes for the whole selection
  appear. When the selection mixes kinds, the header gets a kind switcher (Meshes · Joints).
- The Halo fades while you orbit and comes back when you stop. A tap on empty space dismisses it (§5.3 C9).
- Petals and More rows say what they do in words. Icons are lucide icons kept inside the Halo package; operators'
  `icon` field stays untouched, so `/editor` gains no bytes.

### 6.2 Verb table (first layer; v1 defaults, curated in T6a–T9)

Petal names are plain words (P8). The **Pro name** is shown in grey in More and in search, with the hotkey. The
"Drag does" column applies once the thing is selected (§5.1).

| Noun (how you get it) | Drag does | Halo petals, in slot order | Highlights in ⋯ More (the full list is derived, §6.3) |
|---|---|---|---|
| **Empty space**: tap nothing (docked in the tray) | Orbit / marquee | Make: *New shape ▾*, *Template ▾*, *Reference ▾*, *Select area*, *Paste*, *Show all*. Paint: *Palette ▾*, *Pick colour*, *Fill part*. Rig: *Rig it for me*, *Add skeleton ▾*, *Checks*, *All joints*, *Bind skin*. Animate: *+ New animation*, *Library*, *Key all*, *All controls*, *Reset pose* | Select all / invert, Pick only… (selection mask), Snap, Selection options, Show ▾ |
| **Mesh object** (Make) | Move | *Edit shape* (to Faces), *Duplicate*, *Mirror*, *Paint* (go to Paint), *Rig it* (go to Rig), ⋯ — on an imported character mesh the first petal is *Make editable* | Delete, Group, Parent to…, Unparent, Combine (2+ meshes; it moves up to a petal), Separate, Symmetrize, Triangulate, Quadrangulate, Cleanup, Freeze / Reset / Apply transforms, Turn / Move / Scale rings, Pivot ▾, UV ▾, Normals ▾, Export selected…, Hide, Isolate, Numbers |
| **Faces** | Tweak | *Pull* (Extrude ⌘E), *Inset*, *Bevel* (⌘B), *Colour* (active swatch), *Delete*, ⋯ | Bridge (rises when two border loops exist), Extract, Duplicate face, Fill hole, Select ▾ (Loop · Ring · Shell · Grow · Shrink), Convert ▾, Select by swatch, UV ▾, Flip normals |
| **Edges** | Tweak | *Loop cut* (Insert Edge Loop), *Bevel*, *Merge ▾*, *Slide*, *Bridge* (two borders), ⋯ | Smooth / Sharp (soften / harden), Normal angle, Offset loop, Connect, Spin, Collapse, Delete edge & vertices, Select ▾ (Loop · Ring · Border) |
| **Vertices** | Tweak | *Merge ▾* (merge / to centre / by distance), *Weld to…* (Target Weld), *Slide*, *Connect*, *Delete*, ⋯ | Average, Collapse, Delete edge & vertices, Grow · Shrink, Convert ▾ |
| **Image plane** | Move | *Opacity*, *Size*, *Lock*, *Hide*, *Delete*, ⋯ | Offset, Replace image… (a T5a wrapper: delete then import, one undo step), Numbers › Image plane |
| **Character** (the breadcrumb root, or the mesh in Rig › Character) | — | Animate: *Copy pose* (→ *Paste ▾*), *Mirror ▾*, *Reset to rest*, *Key all*, ⋯. Rig: *Checks*, *Bind / Bind again*, *Make a character* (on loose meshes), *Parts & fingers*, *About this character*, ⋯ | Pin / Plant / Unpin feet, Mirror cycle, Update control rig, Add limb IK, Apply pose as rest, T-stance, Straighten to T-pose, Reset test pose, Render thumbnail, Make active (scenes with several characters) |
| **Control / body part** (tap the mesh in Animate) | Turn (FK) or move (goal); Reach on hands, feet, head and hips | *Key ◆* (long-press: what to key), *Mirror ▾* (flip, L→R, R→L), *Reset*, *Copy pose* (→ *Paste ▾*), *Hand leads* / *Foot leads* (limbs only; IK/FK), ⋯ | Paste mirrored, Turn / Move / Scale rings, Space ▾, Select chain, Hold pose until…, Look at…, Place goal, Numbers, Hide controls, Rotate order, Control size |
| **Foot / IK goal control** | Move | *Key ◆*, *Plant*, *Pin / Unpin*, *Reset*, *Foot leads*, ⋯; foot-roll Echo chips: Heel, Ball, Toe, Bank, Twist | Foot pivots, Match now, Match range (each key / every frame), Limb (Numbers) |
| **Joint** (Rig › Skeleton) | Move with children | *Turn* (rotate rest), *Orient*, *Mirror*, *Paint its weights*, *Rename*, ⋯ | Orient only, Restore bend, Snap to centre, Symmetry X, Humanoid bone ▾, Rest values (Numbers), Joint size |
| **Skin spot** (finger-hold on the skin in Rig › Skin) | — | *Who owns this?* (the top 3 influences as chips with values), *Paint* (that bone), *Smooth here*, ⋯ | Set weight… (numeric), Hold, Mirror weights, Prune |
| **Key dot** (Thread or Keys) | Retime | *Ease ▾* (Smooth / Linear / Flat / Step), *In-between ⇄*, *Copy* (→ *Paste ▾*), *Delete*, *All keys here*, ⋯ | All 9 tangent types, Break / Unify, Weighted, Lock weight, Paste ▾ (merge / replace / insert), ⟨Time⟩ ⟨Value⟩ fields |
| **Key band** (Pencil drag, or long-press then drag on the ruler) | Move (ends: stretch) | *Move*, *Stretch*, *Copy* (→ *Paste ▾*), *Delete*, *Hold pose*, ⋯ | Insert / Remove time, Ease ▾ for the band, Scale values…, Offset values…, Offset in loop (wrap), Match IK/FK over band |
| **Playhead / ruler** (tap the time readout, or long-press the playhead) | Scrub | *Paste keys ▾* (merge / replace / insert, at the playhead), *Insert frame*, *Remove frame*, *Delete time…*, *Set range*, ⋯ | Carry pose, Go to time…, Set as animation range |
| **Curve** (Curves layer) | Drag keys / handles | *Ease all ▾*, *Fewer keys* (Simplify; a form with ⟨tolerance⟩), *Fix flips* (Euler filter), *Cycle ▾* (pre / post infinity), *Insert key*, ⋯ | Key curves here, Compare (snapshot / swap / clear), Weighted curve, Show only this, View: Real · Fit · Stacked (abs / norm / stack) |
| **Channel row** (Numbers or the Keys layer) | Scrub the value | *Key this channel*, *Lock*, *Reset to default*, *Show only this*, ⋯ | Unlock, Show in Curves, Copy value. With several rows selected (Thumb *Select more*): *Key selected channels* and a group scrub |
| **Animation chip** (`[Wave ▾]` in the Animations row) | — | *Play*, *Loop it*, *Rename*, *Duplicate ▾* (plain, or + swap sides), *Settings*, ⋯ | Mirror cycle (half-cycle offset), Use as… (OMOBA slot), Make active, Delete |
| **Library card** (Library drawer) | — | *Preview*, *Speed*, *Trim*, *Swap sides*, *Add*, ⋯ | Stay in place, Arms out, Stop preview, Add starter set, Search, Category |
| **Swatch** (Paint tray) | Drop onto a part = colour it | *Edit colour*, *Finish ▾* (Matte / Shiny), *Select faces*, *Replace with active*, *Rename*, ⋯ | Remove, New material, Gloss ⟨ ⟩, Specular colour, Recent colours |
| **Health dot** (on the model; in the Health sheet) | — | *Fix*, *Show me*, *Why?*, ⋯ | The rule id and profile (for developers) |
| **History step** (History ribbon) | — | *Undo to here*, *Compare* (hold), *Revert this*, *Adjust* (the latest adjustable step only), *Show*, ⋯ | Undo all (an AI or recipe group), Redo, Copy as text |
| **Camera** (puck sheet › Cameras, or the Scene sheet) | — | *Look through*, *Copy view here*, *Lock*, *Lens ⟨FOV⟩*, ⋯ | Focal length, Clip planes, Ortho height |
| **Manipulator** (long-press it) | Its handle | *Space ▾* (object / world / gimbal), *Size*, *Pivot ▾*, *Drag anywhere* (replaces middle-drag anywhere), ⋯ | Pivot centre / bottom / reset / bake / numeric |
| **Rig dot** (Rig it, Adjust dots session) | Move it | *Re-guess*, *Mirror to other side*, *Remove*, ⋯ | Snap to centre, Pick from view |

### 6.3 ⋯ More, disabled reasons and Options

- **⋯ More** opens the More sheet. It lists every operator the Disclosure Manifest (§20.5) attaches to this noun and
  stage, grouped by category, with a filter field.
  - Each row reads `plain name · Pro name · hotkey`, for example `Pull · Extrude · ⌘E`.
  - Rows whose poll fails stay listed, greyed, with the poll reason inline.
  - Operators that the menus call with different arguments (`view.layout`, `ui.open`, `workspace.showPanel`,
    `time.setSpeed`, `view.display.set`) get one row per argument value (§20.5 per-argument entries).
  - **Options**: a row whose operator has an option box (an adjustable operator's ParamDefs, or a Halo form) carries a
    trailing ⚙ *Options*. Long-press a row for its menu: *Pin to Halo · Options*. Pin to Halo is a per-noun preference
    that replaces the last free petal.
  - The footer offers *Open this in the Pro layout ▸* (§16).
- **Disabled petals stay visible and greyed.** Tapping one shows its poll reason in place. When an operator can remove
  the reason, the fix is one tap: *"Needs a bound skin · Bind skin ▸"*. There are no hover tooltips anywhere.
- **Options on petals**: long-press a petal and choose Options for its option box, rendered from its ParamDefs or form
  (the React-free `ParamField` / `OptionBoxView` logic through the `./toolkit` subpath, restyled at touch density). It
  saves to the option defaults only through *Make default*.
- **Lint**: every operator that has an option box in Pro (Rig Toolkit *options* buttons such as Mirror, Smooth and Prune
  skin weights; Merge by distance, Freeze transforms, Cleanup, UV projections, Symmetrize) has an Options surface in
  Halo.

### 6.4 Verb → target

Verbs that need a second thing enter a *"now tap the target"* state, drawn as a glowing line from the subject to the
finger or Pencil:
- Parent to…, Bridge to…, Weld to…, Copy pose to…;
- Paste pose at… (a Thread time);
- Match IK/FK…;
- Look at… and Place goal (wrappers over `pose.goals`, v1, T5a);
- Replace image… (picks a file, then the plane).

The session bar shows ✕ Cancel. This replaces HTML5 drag-and-drop, modifiers and Outliner drags for edits that involve
two objects.

### 6.5 Breadcrumb and Scene sheet

- **Breadcrumb** (above every Halo, never over the selection):
  - tap a crumb to select that ancestor (pick-walk up);
  - *Numbers* opens the Inspector;
  - long-press the last crumb for ‹ › siblings, ▾ children, *Other side* (`select.mirror`), *Select branch* (Select
    hierarchy) and *Rename*;
  - with the Thumb key's *Select more* on, ‹ › and ▾ extend the selection (`select.pickWalk {add: true}`, Pro's
    Shift+arrows);
  - *Next ›* steps to the next pick candidate under the last tap (§5.2).

  This replaces the arrow-key pick-walk and the Outliner's hierarchy picks.
- **Scene sheet** (the empty search field, or project menu › Scene): the Outliner as a list at touch density.
  - Tap a row to select the thing on the canvas and open its Halo.
  - Character rows set the active character in scenes with several characters.
  - Reparent by long-press, lift and drop onto another row (`scene.parent`), a pointer-event recognizer, not HTML5
    drag-and-drop. *Parent to…* is the alternative. Rows cannot be reordered among siblings: `scene.parent` takes no
    index, and Pro has no reorder either.
  - Eye icons show and hide.

### 6.6 Numbers (the Inspector)

One sheet shows the selected noun's full properties, by section. It is the touch Channel Box, Attributes and Rig
Toolkit fields together, built over the React-free view models (`@ekza-studio/editor/models`, §20.3 item 9).

- **Transform**: translate, rotate and scale as chips (`scene.object.transform`), with − / + steppers.
- **Pivot**: numeric pivot (`mesh.pivot.set`), plus centre, bottom, reset and bake.
- **Shape inputs** (primitives): the live inputs of a primitive, at any later time (`mesh.primitive.set`), as Pro's
  Channel Box INPUTS show them; not only right after the last operation.
- **Mesh**: name, faceted, material preset, triangle target, budget preset, handheld grip, colour output.
- **Character**: format, source file, height, licence and credits (read-only here; edited in About this character,
  §6.8).
- **Control**: the Channels list, every channel a scrub chip with its lock and key state. Rows can be selected (with
  the Thumb key's *Select more* for several), then group-scrubbed or keyed with *Key selected channels*. Long-press a
  row for Key this channel / Lock / Unlock / Reset to default. Edits apply to every selected control in one undo step
  (`channel.setValues` per control).
- **Limb**: pole, soft IK, twist, IK/FK blend.
- **Foot**: heel, ball, toe, bank, twists and pivots.
- **Joint**: rest translate and rotate, humanoid bone, orient, joint size.
- **Camera**: FOV, focal length, clip planes, ortho height.
- **Image plane**: name, image, opacity, size, offset, camera and depth (`imagePlane.set`).
- **Animation**: the clip settings (§10.6).

Each value shows Pro's number, unit and sign, with the Pro channel name in grey (§10.1).

### 6.7 Questions the kernel asks (`UiDialog` → Halo surfaces)

Kernel operators open Pro's dialogs through `session.dialog`: for example `skin.bind` on a bound mesh sets
`'rebindSkin'` and returns *asked*. A Halo controller watches `session.dialog` and maps every value to a Halo surface.
A unit test fails when a `UiDialog` value has no handler (AS-ST-20); an unknown value shows a toast with *Open in the
Pro layout ▸* rather than dead-ending.

| `UiDialog` | Raised by | Halo surface |
|---|---|---|
| `rebindSkin` | `skin.bind` on a bound mesh | Inline confirm card at the *Bind again* petal: *"Binding again replaces the painted weights · Bind again / Cancel"*; it re-runs `skin.bind {confirm: true}` |
| `unbindSkin` | `skin.unbind` (its poll then waits for the answer) | Inline confirm card: *"Unbind removes the weights; the skeleton stays · Unbind / Cancel"* → `{confirm: true}` |
| `applyPoseAsRest` | `skel.pose.applyAsRest` | Inline confirm card at the Fix chip or the More row → `{confirm: true}` |
| `imagePlaneImport` | `imagePlane.import` without bytes (`ui.open`) | The Reference picker (Files) |
| `vrmMeta` | Validation fix *Edit VRM Meta…*, `ui.open` | About this character (§6.8) |
| `export` | the rig checklist, Mod+E, `ui.open` | The Share sheet |
| `open` / `import` | Mod+O / Mod+I | Project menu › Open / Import (Files, with sniffing) |
| `recovery` | the host's `promptRecovery` | Home › Continue. Halo installs its own recovery hook; it never shows the Recovery dialog (§17) |
| `makeEditableReport` | Make editable finishing | The Make editable report sheet |
| `shortcuts` / `about` | Shift+/, Help | The Help sheet (gesture card, Pro shortcut sheet, About) |
| `preferences` | Mod+, | The Settings sheet |
| `firstRun` | Pro's first boot | No-op in Halo (Home replaces it) |
| `layoutPresets` | Pro's window chrome | `PRO_CHROME`: *Open in the Pro layout ▸* |
| `makeCharacterEditable`, `attachProp` | deferred M6b stubs | Hidden in both shells until they ship; the test lists them as deferred |

### 6.8 About this character (VRM meta)

An L2 sheet, from the character Halo (Rig), the Share card's *About* link, `ui.open {vrmMeta}` and the Validation fix
*Edit VRM Meta…*. It renders every field of `CharacterVrmMeta` (`doc/records.ts`) from the VRM Meta dialog's React-free
model:

- name, version, authors, copyright, contact, references;
- licence preset: *Free for anyone (CC0)*, *Credit me (CC BY 4.0)*, *Personal use only*, *Custom…* (with
  `otherLicenseUrl`); none is pre-selected (Q-SKIN-3);
- who may use it as an avatar, commercial use, credit, redistribution, modification;
- the four usage flags (excessively violent, excessively sexual, political or religious, antisocial or hate);
- third-party licences;
- the thumbnail, with *Render thumbnail* (`char.renderThumbnail`).

---

## 7. The Path: stages, readiness, destinations

### 7.1 Stages

`( Make │ Paint │ Rig │ Animate )` plus `Share ⤴`. A stage is data: `StageDef {workspace, lighting, tray, defaultTool,
verbOverrides, readiness}` in `halo/src/stages/*/stage.ts`. Tapping a stage:

1. **commits** any open tool session (✓ Done, never ✕; §5.7) and runs `edit.escape`;
2. runs `workspace.set` when the workspace changes, which lazy-loads the kernel chunks exactly as in Pro;
3. applies the stage's display overlay, tray and default tool. These are session state only, never undo steps.

| Stage | Workspace | Default tool and mode | Tray |
|---|---|---|---|
| **Make** | `model` | select (object level); Faces after *Edit shape* | component pill, Mirror edits, Falloff, Snap, New shape ▾, Cut ▾ (Loop cut, Multi-Cut, Slide), Reference ▾, ⋯ |
| **Paint** | `model` | Paint Colour tool | swatch row, `+`, palette menu, Pick, Fill part, Finish, Smooth / Sharp edges, ⋯ |
| **Rig** | `rig` | segment `[Character │ Skeleton │ Skin]` = `rig.mode` object / skeleton / skin | Rig it for me, Checks ⚠n, Add skeleton ▾, Bind, Pose `[Bind│Test│Clip]` (Skin), brush bar (painting), ⋯ |
| **Animate** | `animate` | select controls | the Thread, Animations row, Library ▸, Blend chip (between keys) |
| **Share** | (unchanged; a sheet) | — | §13.3 |

- **The stages are never gated.** A missing prerequisite shows an empty state that bridges to the next step instead of a
  lock:
  - Animate on a plain mesh: *"Nothing to animate yet → Rig it for me · Try a library animation on a sample"*.
  - Paint on an imported character mesh that is not editable: *"Make editable to paint (keeps the rig)"*.
  - Rig on loose meshes: *"Make a character from these"*.
- **Make and Paint share the `model` workspace.** The parity test (§20.5) checks that every tray verb's operator lists
  the stage's workspace, so a stage can never offer an operator whose poll refuses that workspace.
- Mode follows touch inside Rig: tapping a joint enters Skeleton, *Paint its weights* enters Skin, and tapping a mesh
  enters Character. The segment shows the change.

### 7.2 Readiness: one source, one number

Each stage node carries a glyph, explained by a legend at the top of the Health sheet:

| Glyph | Meaning |
|---|---|
| `○` | untouched (Paint stays `○` until a colour is assigned) |
| `◐` | in progress |
| `●` | ready for the destination |
| `⚠n` | n things to fix for the destination |
| `·` | not checked yet: its chunk is not loaded |

**One source.** Readiness is a pure function over the `EditorApp` that returns one list of problem rows for the current
destination, never stored, so undo, reloads and edits made in Pro keep it right. Every surface reads that list:

- the stage glyphs show the rows of each stage;
- the status pill shows the **total** (`● 2 to fix ▸`), never a per-stage filter, and never "All good" while any row
  exists;
- the Share card shows the same rows and the same count;
- the budget ring appears only when the destination has a triangle budget.

| Stage | Source (existing) |
|---|---|
| Make | Mesh Check rows; the triangle budget of the destination's profile |
| Paint | Colours assigned; the colour output mode against the destination |
| Rig | `rigChecklist` + Validation rows (`rig.validation.profile` follows the destination) |
| Animate | The clip slots the destination needs; later, loop-seam and foot-slide checks (motion-analysis P4) |
| Share | The destination's export lints and read-back |

- **Health dots** use the same rows, drawn on the actual joint, mesh or face in 3D, each with Fix, Show me and Why?. The
  Health sheet lists them all; tapping `⚠n` on a stage node opens it scrolled to that stage.
- **Readiness never forces a chunk to load.** A stage whose kernel chunk is not loaded shows `·`. When a character
  exists, the rig chunk is prefetched at idle (`requestIdleCallback`).
- Readiness never blocks navigation. Only Share's export is gated, by the existing Validation gate and read-back.
- **One Next chip.** A single dismissible chip above the tray follows readiness: *Rig it for me ▸* → *Add animations ▸*
  → *Share for OMOBA ▸* (the destination's name). It never shows while a card or sheet is open.

### 7.3 Destination first

- Share's header `For: …` sets the destination, which maps to an existing export profile:

  | Destination | Profile |
  |---|---|
  | OMOBA & Ekza Space (VRM 1.0) | `ekza/space-avatar-v1` |
  | Game engine (GLB with animations) | `local/generic` |
  | Just the animations (VRMA) | `ekza/vrma-humanoid-v1` |
  | Prop for OMOBA (static GLB) | `ekza/omoba-handheld-v1` |
  | Into the original file (bake) | the source's profile |
  | **Just exploring** | none |

- **Default ST-4: "Just exploring"**, which shows only Mesh Check errors and no destination nagging.
- **The destination is asked where it matters**: on the first line of the Rig-it card (*"For: OMOBA & Ekza Space ·
  Game engine · Just exploring"*), because it decides the finger detail (OMOBA → thumbs) and the checks; and on Share's
  header. v0.1's separate *"Where is it going?"* card is gone.
- The destination is part of the session mirror and is shown as a badge on `Share ⤴`.
- Changing it re-derives every stage's readiness. A problem that one operator fixes is fixed in place in Share's row
  (*Add thumbs*, the licence choice); only hands-on fixes say *Go fix ▸*, which jumps to the stage, selects the
  offending item and shows *Back to Share ▸* until Share is reopened.

---

## 8. Search or ask: the command bar

`⌕ Do or find…` is always visible, top right. It is a button until tapped (§4.1). It is **Halo's own touch palette
view** over the host's palette controller and data (`openOverlay(app, 'commandPalette')` is not restyled, so Pro's
palette does not change): 16 px field, 52 pt rows, a sheet on compact layouts.

- **Result groups**:
  - **Do**: operators, with plain label · Pro label · hotkey · *"on a face's Halo"*.
  - **Things**: bones, body parts, controls, meshes, animations, swatches, cameras. Tap one to select it, frame it and
    open its Halo.
  - **Recipes** (§9.11).
  - **Settings**: every pref key.
  - **Help**.
  - **Opens in the Pro layout ▸**: the deliberate hand-offs of §15.15.
- **An empty query** shows the Scene list plus recent verbs.
- **Parameters**: running an operator that has ParamDefs or a form puts its chips inline, filled with defaults, then ✓.
- **Input**: keyboard, dictation (the iPad keyboard's on-device mic) or Scribble.
- **The guarantee**: every operator with a manifest surface is listed, **in every stage**: search ignores
  `OperatorDef.workspaces`, and a result from another stage carries a note (*"switches to Rig"*) and switches when run.
  Search is the safety net, **never** counted as parity (§20.5).
- **Recipe phrases at the release** (a small, deterministic matcher, not the T13 grammar): *wave* (once / twice, which
  hand) and *loop it*. A weak match shows the three nearest verbs and recipes; it never guesses silently.
- **Phrases** (T13, after GA): an offline matcher on top of the same index. It parses numbers and units (`0.2 m`,
  `30°`, `twice`, `at 1.5 s`), resolves body parts with agent-tools' resolver (`bodyPartOf`, VRM humanoid names), uses
  synonyms per stage ("pull" → `mesh.extrude`; "smooth" → weights in Skin, curves in Animate) and matches recipes.
  Phrases accelerate; they are never the main way in.
- **Ask AI**: when nothing matches and an agent is paired, *Ask AI* sends the query to the agent (§14). On iPad the row
  says plainly that the assistant works from a computer for now (OQ-5).

---

## 9. Core journeys, tap by tap

A *touch* is one deliberate tap, one drag, or one filled text field, on an iPad with no keyboard and **no Pencil**.
Orbit, pan and zoom are not counted. The counts use the **real defaults** (§20.7: ha-J* start from a fresh project,
not from a curated state). "Today" figures are the research estimates for Auto-Rig / Pro. The targets are AS-ST-4.

### J1 — Bring a model, rig it, take it to OMOBA (new user)

1. Home › **Bring a model** (1) → pick the file in Files (1). The intake sniffs the bytes and routes a static GLB to
   `autorig.intake` / `mesh.importStatic` through `editor-core/autorigFlow`. The heavy-mesh gate and already-rigged
   detection run silently.
2. Checks run silently and only failures appear, as chips: *"Lies on its side — Fix"* (0–1).
3. The Next chip says *Rig it for me ▸* (1). The Rig-it card runs `skel.quickRig.start` and `skel.quickRig.guess` and
   shows the guessed dots on the model.
4. The card's first line: **For: OMOBA & Ekza Space** (1). The finger detail follows (Thumb for OMOBA). *"Dots look
   right? [Rig it] · Adjust dots"* → **Rig it** (1) runs the shared rig flow (`autorig.rig {straighten}` and its
   argument rules) with a story line: *"Building skeleton… skinning… straightening arms"*. The character plays its
   motion test.
5. *"Add animations?"* › **Starter set: Idle · Walk · Run** (1), which runs `autorig.clip.add` with slots.
6. **Share ⤴** (1). The OMOBA card is already selected and preparing the file starts immediately.
7. First time only: **Author** (1) and the **licence** (1): one tap on a segmented row, *Free for anyone (CC0)* listed
   first but not selected (Q-SKIN-3). The thumbnail is automatic.
8. **Export Polybot.vrm to Files** (1). This is a fresh tap, so the iOS share sheet opens. Then **Save** in iOS (1).

**11 touches** (10 without animations, 12 with a fix). Today: Auto-Rig ≈ 17, Pro ≈ 30. *Adjust dots* is a session on
the same canvas (§12.2): drag a dot (1 per dot), ✓ Done (1); no other UI opens.

### J2 — Model a low-poly character from a template

1. Home › **Make a character** (1) → **Smooth body** (1). The size chip defaults to Standard and Mirror edits is on.
2. Make stage: component pill **Faces** (1) → tap the arm-stub face (1) → **Pull** (1) → drag the cap handle (1) →
   ⟨Segments⟩ scrub to 2 (1).
3. **Bevel** in the reduced Halo beside the chips (1) → drag the bevel handle (1).

**9 touches.** Today in Pro: ≈ 13 per edit. Loops: *Select ▾ › Loop* on the breadcrumb.

### J3 — Pose and key a two-second wave

1. Animate on Seed-san: **+ New** (1) → name it "Wave" (1) → length chip **2 s** (1).
2. Tap the right upper arm on the mesh (1) → drag the ring (1). Rec is on, so this is a key at 0 s.
3. Tap 0.5 s on the ruler (1) → tap the forearm (1) → drag (1); tap 1.0 s (1) → drag (1); tap 1.5 s (1) → drag (1).
4. Tap the *Wave* chip (1) › **Loop it** (1) → **▶** (1).

**15 touches.** Today in Pro: ≈ 35. With the *wave twice* recipe in search: 3 touches.

### J4 — Fix foot sliding and polish a walk with curves (finger-only)

1. Tap the L foot control (1) → layer switch **Curves** (1) → channel chips: **Move Y** only (1).
2. One-finger drag on empty Curves space: marquee over the contact keys (1) → the docked key Halo **Ease ▾ › Flat** (2)
   → ⟨Value⟩ chip: numpad 0, Done (1).
3. Hold **⇆ Before** to compare (1). Curve Halo **Cycle ▾ › Cycle** for the loop seam, if needed (2).

**8–10 touches**, the same with fingers or the Pencil. Today in Pro: ≈ 25–30 precise touches. The automatic *Check feet*
waits for motion-analysis P4.

### J5 — Mix animations from the library

1. Animate tray › **Library** (1) → tap **Walk** (1): it plays on your character, and the chrome stays live → expand the
   card (1).
2. ⟨Speed⟩ scrub (1) → **Stay in place** (1) → **Add** (1).
3. A left/right pair: tap the new chip (1) › **Duplicate ▾** (1) › **+ swap sides** (1).

**6 touches** (9 with the pair). Today: Auto-Rig ≈ 8, Pro ≈ 12–15 with parameters missing.

### J6 — Colour with swatches and export a GLB

1. Path › **Paint** (1) → tap a swatch (1): it becomes active and its Halo opens → strokes on the model. To fill a part
   with a finger: **Fill part** (1) → tap the part (1).
2. In the open swatch Halo: **Finish ▾ › Shiny** (2).
3. **Share ⤴** (1) → **Game engine** (1) → **Export Cube Lad.glb to Files** (1) → iOS **Save** (1).

**8 touches plus strokes**, 10 with a finger fill (+1 for *Make editable* on an imported character). Today in Pro:
≈ 25.

### J7 — Fix weights where the arm bends badly

1. Path › **Rig** (1) → Pose segment **Test** (1) → **▶ Bend test** (1) → pause where it breaks (1).
2. Finger-hold the bad spot (1): *Who owns this?* shows `Upper arm 0.72 · Chest 0.28` → tap **Upper arm** (1), which
   opens Paint weights with that influence.
3. Paint (with the Pencil, pressure sets strength; with a finger, the Strength chip; Mirror is on) → **▶ Play again**
   (1).

**7 touches plus strokes.** Today: Auto-Rig ≈ 6 plus strokes; Pro ≈ 15–20, and refused below 1024 px.

### J8 — Ask the AI agent, then review or undo its steps (desktop Chrome/Edge)

1. Search pill (1) → type or dictate *"make him wave twice"* (1) → **Ask AI** (1).
2. First time: the pairing card shows the code to give the agent, then plain grants: *change my animation ✓ · save files
   ☐ · use my agent's workspace folder ☐ · change what I see ☐* → **Allow** (1).
3. The live line reads *"AI is keying R forearm…"*. The result is one History group, *"AI · Wave twice · 5 steps"*,
   with **Undo all** (1), **Compare** (hold) and Steps ▾.

**4–5 touches.** On iPad: an honest card plus the *wave* recipe. Live AI on iPad is OQ-5.

### J9 — Continue the same project in Studio Pro

- **Same device, desktop**: **▤ Pro layout** (1). Pro opens on the matching workspace with the same selection, time and
  camera, and the toast *"Same project, every panel at once · Undo still works"*. Back: Pro's status-line *▤ Simple
  layout* (1), or Help › *Switch to the Simple layout* (2).
- **Same device, touch-only iPad**: **▤ Pro layout** (1) → one line: *"Studio Pro is laid out for a mouse and keyboard ·
  Open anyway · Save project to Files to continue on a computer"* → **Open anyway** (1). 2 touches.
- **Another device**: project menu › **Save project to Files** (2) → on the desktop, drop the file or Open (2). A banner
  says *"Opened 'Cube Lad' from iPad — undo history starts here"* (ADR 0011).

### J10 — Resume after a reload or from autosave

- If the tab reloads while a project is open (iPadOS does this under memory pressure), the session mirror names the
  project and Halo restores it silently: the same stage, time, selection and camera, with the toast *"Back where you
  were · 2 min ago"*. **0 touches.**
- Otherwise Home shows **Continue** (1). There is no Recovery dialog.
- After the first **Save project to Files**, a card offers *"Keep projects on this iPad"*: it calls `storage.persist()`.
  The *Add to Home Screen* hint follows only after that Files backup exists, and says *"The Home Screen app has its own
  storage: open your file there"* (§17, S12).

### 9.11 Recipes (guided flows over the free canvas)

- A recipe is data: steps of `{plan (operator calls), done check (poll / Validation row / progress predicate), view hint,
  hands-on tool, one-sentence reason}`. Every step is an ordinary undoable operator run.
- A running recipe shows a compact stepper card (*"Rig this character · 2 of 4"*), docked above the tray, that can be
  collapsed or left at any step. Its progress is mirrored to sessionStorage and a *Resume* chip stays.
- **v1 recipes:**
  - *Rig it for me* (J1), over `editor-core/autorigFlow`, so it runs the same steps as Auto-Rig ①–⑤;
  - *Add animations* (the starter set);
  - *Make a character* (J2 start);
  - *Fix for OMOBA*: each Share problem with its fix;
  - *Fix where it bends badly* (J7);
  - *Loop it*: `clip.makeLoop`, through its wrapper;
  - *Wave* (once or twice, either hand), from the deterministic agent-evals reference script, which is executable
    today. It is offered by search phrases (§8).
- **After GA (T13):** *Nod* and *Breathe* (they need small generators), *Walk cycle* and *Polish* (they wait for
  motion-analysis P4 or an LLM tier).

  Recipes and the MCP prompts share one registry, so a person tapping and an agent calling run the same steps.

---

## 10. Animation UX

### 10.1 Posing

- Tap a body part on the mesh. The existing rule that a mesh click selects its control picks the control. Controls are
  drawn as large, soft halos labelled with part names.
- The breadcrumb names the part in words (*"Right arm › Forearm"*), and the fitting manipulator appears: a turn ring
  for FK controls, move for IK goals and the root.
- **Drag** the ring or the selected limb with the Pencil or a finger. Long-press the manipulator for Space (object /
  world / gimbal), Size, Pivot and *Drag anywhere*.
- **Reach** (in the release, T7). With a hand, foot, head or hips selected, dragging the part itself moves its IK goal
  and the body follows (two-bone limbs; the spine for head and hips). The drag previews as session overrides; on lift
  it runs the public wrapper `pose.reach` over `pose.goals` once (T5a): **one drag is one undo step**, and with Rec on
  it keys every control it moved at the playhead. Dragging the turn ring still turns the joint (FK).
- **Echo channel chips** show the 2–3 dominant channels with plain labels: ⟨Bend⟩ ⟨Twist⟩ ⟨Side⟩, or ⟨Move⟩ for goals.
  The full list is the Channels section of Numbers (§6.6).
- **Plain labels show Pro's numbers** (P14). The table is normative; a plain label is only a name:

  | Plain label | Pro channel | Unit | Sign and value |
  |---|---|---|---|
  | Bend | Rotate X | ° | identical to the Channel Box |
  | Twist | Rotate Y | ° | identical |
  | Side | Rotate Z | ° | identical; the right side is **not** flipped to read "outward" (v0.1's prototype did) |
  | Move X / Y / Z | Translate X / Y / Z | m | identical |
  | Scale X / Y / Z | Scale X / Y / Z | × | identical |
  | Heel, Ball, Toe, Bank, Twist (feet) | the foot-roll attributes of the same names | ° | identical |
  | Hand leads / Foot leads | IK/FK Blend (on = IK) | — | identical |

  A control role may rename a label (`halo/src/i18n/channels.ts`), never change a value. The numpad and Numbers show
  the Pro name in grey (*"Side · Rotate Z"*), and the Curves axis uses the same numbers. A unit test checks that every
  chip value equals the Channel Box readout for every control on Polybot and Seed-san (AS-ST-19).
- **Pose verbs**: Copy pose (then Paste ▾ in the same slot), Paste mirrored, Mirror ▾ (flip / L→R / R→L), Reset, Reset to
  rest; for feet, Pin, Plant and Unpin; Look at… and Place goal (verb → target, v1).
- **Hand leads / Foot leads** is the IK/FK petal on limb controls: `rig.ikFk.switch` with matching. Its long-press holds
  the key mode (auto / seamless / none), *Match now* and *Match range* (each key, or every frame).
- **After GA (T15)**: *Glue*, a finger held on another part to pin it.

### 10.2 Keying and Rec

- **`● Rec` is Ekza Studio's own setting**, `halo.rec`, **default on**. While Halo is mounted and an animation is
  active, Halo applies it to the kernel as a shell-layer override of `autoKey` through the effective-preferences layer
  (§16.4). Pro's stored Auto Key is never written, and the override is removed when the shell unmounts, so Pro behaves
  exactly as its own setting says after a switch (AS-ST-10). While Rec is on, a red Rec chip and a thin red canvas edge
  show it.
- With Rec on, every pose change writes a key at the playhead, one undo step per drag. Undo is the discard. New users
  are never asked what a key is before their first pose.
- With Rec off, changes are unkeyed overrides: the Key petal shows a dot (*Key ◆ · changed*) and the changed chips are
  tinted. There is no question card and no separate "not keyed" pill.
- **One Key control.** The *Key ◆* petal runs `key.set` for the key target. Long-press it for:
  - Key all / Turn / Move / Scale / Attributes;
  - Selected channels;
  - In-between (breakdown);
  - Key target (this part / body part / whole character).

  The Thread has no separate ◆+ button. With nothing selected, the Animate tray's *Key all* keys the character.
- OQ-4 asks the owner to confirm the default (the alternative is v0.1's "ask once").

### 10.3 The Thread (Timeline)

Halo's own small Canvas2D strip. Its time and key data come from editor-core queries (Pro's `timeline/state.ts` and
`placement.ts` are React hooks, so Halo does not import them). Its band and key-drag behaviour reuse curve-editor's
`timeline/band.ts` and `keyDrag.ts` models from a lazy chunk, and it registers the timeline operators through a *focused
band source* (§20.3 item 18), so Halo runs the same `time.selectBand` and `timeline.context.*` operators as Pro. It
never imports Pro's `TimeSliderView`.

| Element | Behaviour |
|---|---|
| At rest (L0) | ▶ · the time readout · the ruler · ● Rec · the layer switch `[Timeline │ Keys │ Curves]` |
| Scale and units | Seconds by default; Settings › Time: *Seconds · Frames* applies to the Thread, every chip and the Curves axis. Keys always land on whole frames. Beat ticks every 0.25 s snap to the whole frame nearest each beat; when the fps does not divide 0.25 s (30 fps gives 7.5 frames), the ticks are drawn at those whole frames, so Halo and Pro always show the same timing. |
| Expanded transport | Tap the time readout: start, previous key, previous frame, next frame, next key, end (`time.step` ±1 for the frame steps, Pro's Alt+, / Alt+.); Speed: *Realtime · Every frame · Half · Double* (the four `PlaybackSpeed` values; a 0.25× for Perform would be a new kernel value, T16); *Range* shows the range brackets. Tap outside to collapse. |
| ▶ | Tap: play / pause. Long-press: loop / once / oscillate, and play backwards. |
| Key dots | Only the selection's keys, plus a faint summary row when nothing is selected. Hollow dots are in-betweens. |
| Playhead | Tap the ruler to jump; drag the playhead to scrub; with the Thumb key's *Carry pose*, a drag scrubs while carrying the pose. Long-press the playhead for its Halo (§6.2): Paste keys ▾, Insert frame, Remove frame, Delete time…, Set range. |
| Range | The brackets from *Range* in the expanded transport: drag them for the playback range; long-press a bracket for *Set as animation range*. |
| Band | A Pencil drag along the ruler, or a finger long-press on the ruler and then a drag. Drag the body to move, drag the ends to stretch, Thumb *Copy* + drag to copy. The band's Halo (§6.2) has Copy and Paste ▾. |
| Blend | When the playhead sits between two keys of the selection, a ⟨Blend 50 %⟩ chip appears. Scrubbing previews; lifting runs `key.tween` with that value as one undo step (a pre-run form, because `key.tween` is not adjustable). Its long-press picks blend / toward a neighbour / ease / push-pull / to default; scrub past either end to overshoot. |
| Zoom | Horizontal pinch zooms time; a two-finger drag pans it. |
| Layers | The labelled switch replaces v0.1's unlabelled grab bar. The sheet's own grab bar only resizes the height. |

### 10.4 Keys (layer 1, the Dope Sheet)

- Rows go Summary → body part → control → **channel**, each at least 36 pt tall, over Pro's `DopeSheetController`
  behind a touch adapter (§20.3 item 8).
- A finger or the Pencil: a drag on empty space is a marquee, a drag on a key retimes it, a long-press then a drag draws
  a band. Two fingers scroll the rows and pan or pinch time.
- The header holds a *Select · Move · Scale* segmented control, *Push later keys* (`key.toggleRipple`), *Select area*,
  the region bar and ‹ › one-frame nudges. **The key Halo is docked in the header**, never over the rows it edits.
  Double-tap frames.

### 10.5 Curves (layer 2, the Graph Editor)

Pro's `GraphEditorController` behind a touch adapter. Its view state persists through a callback, not dockview panel
params. The focus registry (`attachGraphEditor` / `focusGraphEditor`) moves into curve-editor (§20.3 item 18), so the
adapter registers `graph.frame`, `select.curveKeys` and `graph.view.setMode` exactly as Pro's view does.

- **Channels**: chips such as `Move X ● Move Y ● Turn…`, *Only animated* (keyed only), a filter field, and the curves of
  **every control selected in the Keys layer** (several controls at once, v1).
- **Tools**: a *Select · Move · Insert · Scale* segmented control in the header. Scale is `graph.keys.scale` with a
  region box (Pro's R in the Graph).
- **Gestures**:
  - one finger or the Pencil: a drag on empty space is a marquee; a drag on a key or a tangent handle moves it;
  - two fingers pan, and pinch time and value;
  - the axis locks automatically after 8 pt of travel, and the ⟨Axis⟩ chip or Thumb *Axis* switches between time,
    value and free.
- **Fields**: Echo chips ⟨Time⟩ ⟨Value⟩ ⟨In angle⟩ ⟨Out angle⟩ ⟨In weight⟩ ⟨Out weight⟩ for the selected keys, in the
  units of Settings › Time.
- **Ease**: Smooth (auto), Linear, Flat, Step, plus in More: Spline, Clamped, Plateau, Stepped next, Fixed; Break,
  Unify, Weighted, Lock weight (`graph.tangent.*`, `graph.curve.setWeighted`).
- **Curve tools**: *Fewer keys* (`graph.curves.simplify`, a pre-run form with ⟨tolerance⟩), *Fix flips* (Euler filter),
  *Cycle ▾* (pre/post: constant, linear, cycle, cycle with offset, oscillate), *Key curves here*, *Insert key* (a petal
  on the curve).
- **Compare**: hold *⇆ Before* to see the buffer snapshot taken automatically when Curves opened. Snapshot, Swap and
  Clear are in More.
- **Views**: *Real · Fit · Stacked* (abs / norm / stack) in More. Double-tap frames the selection; double-tap empty space
  frames all.
- **Numbers beside the curves**: at 1180 pt and wider, Numbers is pinned as a 300 pt column (wireframe D), so an
  animator sees curves and channels together on an iPad.
- **Paste**: merge / replace / insert from the key, band or playhead Halo.
- **Open in the Pro layout ▸** opens Pro's Polish preset framed on the same curves (`then: preset`, §16). It is a
  convenience only: everything above works in Halo.

### 10.6 Animations and the library

- **Animations row**: animation chips above the Thread.
  - The first tap on a chip makes it active and opens its Halo.
  - `+ New` asks for a name and a length (1, 2 or 4 s).
  - The animation Halo (§6.2) holds Settings: fps (keep seconds or frames), range, scene start, loop, root motion,
    contact frame, tags, provenance and redistribution.
- **Library drawer**: the 14 CC0 animations, with search and categories.
  - Tap a card to preview it on your character at once; *Stop preview* (`library.stop`) is on the card and in its Halo.
  - Expand a card for Speed (a dial), Trim (on the strip), *Swap sides*, *Stay in place* and *Arms out*, all previewed
    live (`library.useClip {params}`, `autorig.clip.add`).
  - *Add*, or *Add starter set* (Idle · Walk · Run, with slots).
  - *+ From file* imports `.vrma` or an animation GLB.
- **Two mirrors, two names**: *Swap sides* is Auto-Rig's left/right swap. *Mirror cycle* is Pro's Mirror Animation with
  its half-cycle offset (`pose.mirrorAnimation`, a pre-run form). Each shows its Pro name in More.
- **Loop it**: `clip.makeLoop`, through a public wrapper; it is AI-only today (§20.3 item 7).

### 10.7 Later (designed in, not in GA)

- **Perform** (T16): hold ● on a part, then drag it while time plays at 0.25–1×. Lifting pauses. A pass of the same type
  overwrites; a pass of a different type adds. The take is simplified to sparse keys (`graph.curves.simplify`) and lands
  as one undo step. It needs a new kernel operator for sampled writes, and a 0.25× playback value.
- **Pose cards** (T15, to explore): each key shown as a small thumbnail on the Thread that you drag to retime, a model a
  teenager understands without the word "key". It needs an offscreen render per key, so iPad memory is measured first.
- **Ghosts and motion trails**: when M2c lands, with the Pencil able to edit a trail.
- **Check feet**: contact bars and slide in cm on the Thread, plus *Fix all slides*, once motion-analysis P4 lands.

---

## 11. Modeling on touch (Make)

- **Component levels**: the tray pill `[Whole │ Points │ Edges │ Faces]` (`select.mode`). The breadcrumb's *Select ▾*
  chip offers Loop · Ring · Border · Shell · Grow · Shrink · Select area, and Convert ▾ is in More.
- **Create**: tray *New shape ▾* for primitives (cube, sphere, cylinder, cone, plane, torus); their inputs appear as
  Echo chips right after, and stay editable later in Numbers › Shape inputs (`mesh.primitive.set`). Templates come from
  *New shape ▾* or Home. *Reference ▾* adds front, side and top image planes through the Reference picker.
- **Edit**: Pull, Inset and Bevel are face and edge petals with on-canvas handles, plus Echo chips; after each, the
  reduced Halo offers *Pull again · Bevel · Inset* (§6.1).
  - Extrude keeps its session semantics: cap handles, one undo step per drag, *Smart* as the Thumb key's drag meaning.
  - *Loop cut* previews under Pencil hover. With a finger it previews on press and slide and commits on lift.
  - *Multi-Cut* (tray Cut ▾): taps place points; the session bar has ✓ Done, ⌫ and the Snap / Loop / Centred chips.
  - The Merge family and *Weld to…* (verb → target) have an ⟨At midpoint⟩ chip.
- **Mirror edits** (per-mesh symmetry) is a tray chip, on by default for templates; axis and tolerance are in its
  options. Every tool mirrors.
- **Snap and pivots**: Thumb *Snap ▾* (grid / vertex / increment); locking it is the tray's Snap chip (one state).
  Pivot ▾ is on the manipulator's long-press: centre, bottom centre, reset, bake, an edit handle, and numeric values in
  Numbers › Pivot.
- **Health**: health dots from Mesh Check on the offending faces and edges, each with Fix / Show me / Why?. The budget
  ring (`812 / 3,000`) appears when the destination has a budget.
- **Scene**: the Scene sheet replaces the Outliner (§6.5). Numbers holds transform, pivot, shape inputs and mesh
  attributes.
- **Imported character meshes**: the first petal is *Make editable*, and its report opens in a sheet. A static GLB comes
  in through *Bring a model*, the first non-Auto-Rig path for `mesh.importStatic`.

---

## 12. Rig and skin on touch (Rig)

### 12.1 Segments and checks

- `[Character │ Skeleton │ Skin]` is `rig.mode`, and it also follows what you touch (§7.1).
- *Checks ⚠n* lists the rig checklist and Validation rows in plain words, each with Fix. It includes the stand-up,
  set-height and freeze fixes, which today exist only in Auto-Rig and MCP (`autorig.fix`), in Auto-Rig's fix order
  (`autorigFlow`).
- The same rows are health dots on the joints and meshes concerned.
- Operators that ask a question (*Bind again*, *Unbind*, *Apply pose as rest*) show an inline confirm card (§6.7).

### 12.2 Rig it for me (v1, all in Halo)

1. **The card's first line asks the destination** (§7.3). The finger detail follows from it and stays a chip: Mittens ·
   **Thumb** (the default, and OMOBA's requirement) · All fingers.
2. It runs `skel.quickRig.start` + `skel.quickRig.guess` and draws the guessed dots on Halo's canvas (the Quick Rig
   marker layer): *"Dots look right? [Rig it] · Adjust dots · ⋯"*.
3. **Adjust dots** is a session on the same canvas, not a hand-off: the session bar reads *✕ Cancel · Adjust dots ·
   drag a dot · ✓ Done*.
   - Drag a dot to move it (`skel.quickRig.setMarker`); *Pick from view* is `skel.quickRig.pick`.
   - A dot's Halo: *Re-guess*, *Mirror to other side*, *Remove* (`skel.quickRig.clear`).
   - *Front · Side*: on Wide containers a side inset pane (`pane-side`) shows depth next to the front view, using the
     rig marker layouts (`view.layout rig-side`); on Regular and Compact it is a toggle.
   - ✕ runs `skel.quickRig.cancel`.
4. **Rig it** runs the shared rig flow from `editor-core/src/autorigFlow` (T5b): straighten when the input was A-posed,
   rigid parts when there are several meshes, the rebind confirm. **Skeleton only** (in the card's ⋯) runs
   `skel.quickRig.commit`: skeleton and control rig without binding, Pro's *Create Skeleton*.
5. A story line shows progress (*"Building skeleton… skinning… straightening arms"*) with *Cancel* (`autorig.cancel` or
   `skel.quickRig.cancel`).
6. The motion test plays; *Test with: Walk · Sword · Dance* picks the clip. The next card offers *Add animations*.

- Because the orchestration lives in `editor-core`, Halo and Auto-Rig emit the same operator sequence for the same
  model. A journey test records the operator logs of Halo J1 and Auto-Rig ①–⑤ and requires them to be equal
  (AS-ST-5).
- Parts and rigid separate parts are a chip on the character Halo (*Parts & fingers*).
- Auto-Rig is no longer needed for dot editing. It stays at `/autorig` as *Rig a model for me* (Home), and whether it
  later folds into Halo is OQ-6 (T14).

### 12.3 Skeleton and joints

- Drag a selected joint to move it with its children. The Thumb key's drag meaning *Alone* moves it alone; *Orient
  only* is a toggle.
- The Turn petal rotates the rest pose; numeric rest values are in Numbers.
- Orient, Mirror, Symmetry X, Restore bend and Snap to centre (`rig.snap.projectedCenter`) are joint verbs. Joint size
  (`rig.jointSize.set`), control size and rotate order (`rig.setControlSize`, `rig.setRotateOrder`) are in More.
  Rename by tapping the crumb; Humanoid bone ▾ is in More.
- Skeleton templates: Rig empty state › *Add skeleton ▾*, named Simple / Standard / Full / Full with fingers. The joint
  counts are shown in grey.
- A-pose path: a Fix chip, *Straighten to T-pose*. More holds Apply pose as rest (with its confirm card) and T-stance.

### 12.4 Weights: the break-finder flow

1. **Find it.** Pose segment **Test**, then ▶ *Bend test*: the motion test, or a ⟨Bend <joint>⟩ scrub chip that replaces
   the E-key ring. In Test, dragging any joint test-rotates it and never writes a key.
2. **Name it.** Finger-hold the bad spot: *Who owns this?* shows the top three influences with their values at that
   point. This covers `skin.influence.pickDominant` and `skin.paint.sample`, without I or Shift+I.
3. **Paint it.** Tap a bone. The brush tray shows:
   - the mode `[Replace │ Add │ Scale │ Smooth]`;
   - ⟨Size⟩ ⟨Strength⟩ ⟨Value⟩, replacing B/M/N + drag;
   - Pressure ◉ (Pencil only), Mirror ◉ (on by default), Flood, and Show ▾ (greyscale / ramp / influence colours / off);
   - ⋯ for falloff, surface/volume, front only and paint/select.

   The card *"This area follows: ● Upper arm L · ○ Chest"*, docked to the right edge (a tray row on Compact), swaps
   between the two bones; ‹ › walks the influence list; *All bones* opens the full list with its filter and sort, and
   Hold, Hold all and Release all locks. The Thumb key: tap *Sample value* or *Pick bone*; drag *Brush size*,
   *Strength* or *Value*.
4. **Check it.** ▶ *Play again*.

- **Pencil pressure** sets stamp strength. Strokes are filled in with coalesced events where present and interpolated
  stamps, so fast strokes at Safari's ~60 Hz leave no gaps. Pressure is folded into `StrokeStamp.strength` at stamp
  time, so `skin.weights.paint` arguments, replay and MCP determinism stay unchanged (T9, AS-ST-16).
- **Fix weights** (More, each with Options): Mirror, Smooth, Prune small, Normalize, Remove unused. **Set weight…** on a
  vertex selection in paint-select mode opens the numpad (`skin.weights.set`), the first UI for that operator.
- **Bind**: the Skin empty state *Bind skin* (options on long-press), *Bind again* and Unbind in More, both with their
  confirm cards (§6.7).

---

## 13. Paint, shading, export and Share

### 13.1 Paint (colour)

- **The swatch row** is always visible in Paint.
  - The first tap on a swatch makes it active and opens its Halo; `+` adds one.
  - Pencil or finger strokes paint faces (a finger stroke starts after slop, §5.1).
  - *Fill part* fills a part's shell with a tap. Its toggle in the tray and the Thumb key's *Fill part* are one state.
  - On a face selection, *Colour* assigns the active swatch.
  - The Pick chip, or the first petal of a finger long-press on the mesh, samples a colour.
- **Swatch Halo**: Edit colour (picker, hex field, Name field and the Recent row), Finish Matte / Shiny (Lambert / Blinn
  in grey) with ⟨Gloss⟩ and a Specular colour, Select faces, Replace with active, Rename, Remove, New material. There
  is no right-click.
- **Palette menu** (the name chip): New, Duplicate as variant, Rename, Assign to mesh.
- **Lighting**: Paint is lit by default (Blinn preview). Flat / smooth is in the View sheet.
- **Normals**: edge petals Smooth / Sharp; Normal angle, Reverse and Conform are in More.
- **UVs**: More › UV ▾ (planar / box / cylindrical). There is no UV editor in either shell.

### 13.2 Colour output

Share › card › Advanced › *Colours as*: palette texture / vertex colours / one material per colour. The palette menu
holds the same option.

### 13.3 Share (destination first)

Share is a sheet over any stage (wireframe F).

- **Destination cards** (§7.3), with plain subtitles; format names appear only in Advanced:
  - OMOBA & Ekza Space — *"your avatar with its animations"* → `file.exportCharacter` VRM 1.0, or `autorig.export`;
  - Game engine — *"one file with the model and its animations"* → GLB;
  - Just the animations — *"for any humanoid"* → `file.export` VRMA;
  - Prop for OMOBA — *"a thing to hold"* → `file.exportModel`;
  - Into the original file — *"put the animations back into your file"* → bake;
  - *More formats ▸*: VRM 0.x kept, rigged GLB, OMOBA local test kit (`.zip`), animation-only GLB, and **Static model
    (GLB)** — the whole model, with the colour-output and lit / unlit options, profile `local/generic`.
- **Each card** shows `Ready ✓` or `n things to fix`, from the one readiness list (§7.2). A problem that one operator
  fixes is fixed in its row (*Add thumbs*, the licence); only hands-on problems say *Go fix ▸*.
- **Fields**: Name, Author (asked once), **Licence — an explicit choice** (*Free for anyone (CC0)* listed first, none
  pre-selected; `licensePreset: null` blocks the export, Q-SKIN-3, OQ-14), an automatic thumbnail
  (`char.renderThumbnail`), the animations with their slots, and *About this character ▸* for the other VRM fields
  (§6.8).
- **Advanced ▾** holds the format name and every export option: profile, key reduction, root motion / in place, close
  loops, Euler filter, constant tracks, colour output, lit / unlit, handheld profile and the licence acknowledgement.
- **Export is not saving.** The button names the file it writes: *Export Polybot.vrm to Files*. An export never clears
  the unsaved dot; its toast offers *Also save the project (.ekzanim)*. *Save project to Files* stays in the project
  menu and in Share's footer, which shows the project state (*"saved on this iPad, not in Files"*).
- **Saving on iOS takes two steps** (the `SaveTicket` service, §20.4). Choosing a card starts the bake or zip at once.
  The export button becomes active when the file is ready; that tap is a fresh user activation. It checks
  `navigator.canShare({files})`, then calls `navigator.share({files})`. If `canShare` fails, or `share()` has not
  resolved within about 10 s (some iOS versions never resolve it after *Save to Files*, WebKit 234187), it falls back
  to `<a download>` and says *"Saved to Downloads"*. Elsewhere it is a download.
- **After a share** the toast says *"Shared · iPad does not confirm where it went"*. A shared project clears the unsaved
  dot (it was a project save), but on iOS the autosave snapshot is kept whatever the dirty state (§16.4, S24).
- **The gate**: the existing Validation gate and read-back block the export, and the reason is shown plainly.
- **Publish to Ekza Hub** stays hidden until M4a, as in Pro.

---

## 14. The AI agent in-app

- **Entry**: `⌕ Do or find…` › *Ask AI* on a no-match query, or project menu › *AI agent*. It opens the **Ask sheet**,
  which reuses the existing Agent panel body (lazy, through the measured `./agent` subpath) at touch density.
- **Desktop Chrome/Edge (works today)**:
  - The pairing card shows the one-time code.
  - Grants are plain toggles: *change my animation* = Edit; *save files* = Files and, under it, *use my agent's
    workspace folder* = Workspace folder (off: exports download in the browser, as in Pro's grants dialog);
    *change what I see* = View; Read always.
  - Pause, Resume and Disconnect are in the sheet. Confirm cards appear inline.
  - A live activity line sits under the search pill.
- **History**: every agent call lands as one History group (*"AI · Wave twice · 5 steps"*) with Undo all
  (`edit.revertSteps`; M-AI-INT-7 semantics), Compare and Steps ▾.
- **iPad and Safari on macOS, today**: the loopback bridge cannot be reached from Safari (https → `ws://` is mixed
  content, and the agent runs on another machine). The Ask sheet says *"The AI assistant runs on your computer for
  now"*, offers the recipes, and never shows a broken Connect button. These rows are listed as platform exceptions in
  §15.0.
- **iPad later (OQ-5)**, one of:
  - a `wss` relay with the existing pairing code;
  - an in-app Assistant through an Ekza server proxy (ADR 0018 §7, ADR 0017), which changes the "nothing uploaded"
    promise;
  - desktop-only AI.
- **What the agent can do** is unchanged: the 37 MCP tools and the prompts. Halo's wrappers and `shell.navigate` are
  denied to agents by default, so the toolset `1.0.0-mvp.1` and the generated reference do not change (§20.3 items 7
  and 11). Recipes share the prompts' registry (§9.11).

---

## 15. Capability coverage map (all 191 inventory rows)

**Depth codes:**

| Code | Meaning |
|---|---|
| **L0** | On screen with no tap, or the gesture itself |
| **L1** | One tap or long-press on the thing or on a visible control: Halo petal, chip, tray, Path, Thread button |
| **L2** | A second step: ⋯ More, a sheet section, or a chip's long-press menu |
| **L3** | Search only. Allowed only for developer items, and listed |
| **Pro** | A deliberate hand-off of a *presentation*. The operators stay runnable from search, marked "Opens in the Pro layout ▸" |
| **n/a** | Not shipped in any shell yet (planned, hidden or unregistered) |

This map is the committed inventory (T6b adds the matching FEATURES.md row id to each row). Search reaches every operator with a manifest surface by name, in every stage, and is never counted here. Row numbers follow the inventory of
2026-10-24 (`dev` @ `0512ba88`). The *Pro gap closed* column marks rows that in Pro need a keyboard, hover, right-click,
middle-click or a modifier.

### 15.0 Availability by platform

Every row below is available on an iPad in Safari 26+, on a desktop in Chrome, Edge or Safari 26+, and (best-effort,
OQ-11) on a phone, **unless this table lists an exception**. The owner signs off this list (OQ-16); any new exception
needs a row here and a reason.

| Rows | iPad (Safari) | Phone | Desktop | Why, and what the user sees |
|---|---|---|---|---|
| 13.1–13.6 (the AI agent) | no (OQ-5) | no | Chrome / Edge: yes; Safari: no | Safari cannot reach the loopback bridge. The Ask sheet says so and offers the recipes. |
| 11.1, 11.3 (heavy models) | up to 200k triangles; a warning from 60k | lower limits (iPhone memory) | any | The iOS memory profile (S8). Above the limit: *"Too heavy for this iPad · open it on a computer"*. Pro on iPad has the same limit, because the profile is per device. |
| 1.14, 1.15, the chrome toggles of 1.16, 14.9, §15.15 b (Pro presentations) | Pro layout, not touch-ready | Pro layout, not touch-ready | yes | Pro is laid out for a mouse and keyboard and is best-effort on Safari (OQ-7). ▤ Pro layout warns first on touch-only devices (§16.1). |
| Pro's Rig & Skin below 1024 pt | view-only in Pro | view-only in Pro | yes | Pro's AR-V1 rule is unchanged. Arriving in Pro's Rig & Skin narrower than 1024 pt shows *"View-only at this width · Back to the Simple layout"*. Halo edits at every width. |
| 3.12 (loop-cut preview) | hover preview only with a hover-capable Pencil | press-and-slide preview | hover | Hover does not exist for fingers; the press-and-slide preview is the same operator. |
| 12.3, 11.4–11.8 (files) | two-step share, no confirmed location | two-step share | download | Web Share Level 2 (§13.3). |

### 15.1 Navigate, view, workspace (22)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 1.1 | Orbit / pan / dolly | One-finger orbit on empty space, two-finger pan and pinch, View puck drag; mouse follows the user's profile | L0 | Alt / MMB / wheel → touch (B1) |
| 1.2 | Frame selection / all | Double-tap (any input) on the thing / on empty space; puck centre tap / double-tap; quick pinch | L0 | — |
| 1.3 | Look through view preset / shot camera; camera radial | Puck faces (front / side / top / persp); puck long-press › Cameras | L0 / L1 | The Space-hold radial is replaced by the puck |
| 1.4 | Copy view to shot; camera lock | Camera Halo / puck sheet › Cameras | L2 | — |
| 1.5 | Camera settings | Camera Halo › Lens chip; Numbers › Camera | L2 | — |
| 1.6 | Viewport layouts | View sheet › Panes 1 · 2 · 4 (Wide); rig dots: Front · Side, with a `pane-side` inset on Wide (`view.layout rig-side`); Compact: 1 pane + switcher | L2 | Rig-markers layouts are native in *Adjust dots* (§12.2) |
| 1.7 | Maximize pane / panel | In 2- or 4-pane views: ⤢ in the pane corner (`view.toggleMaximize` for panes, a per-argument entry; its panel use is `PRO_CHROME`); sheets have a full height | L1 | Space-over-panel (K+H) is not needed |
| 1.8 | Shading | Stage lighting by default; puck sheet › Look segmented control | L1 | — |
| 1.9 | Display toggles (20) | Puck sheet › Show: essentials (X-ray, Skeleton, Controls, Grid, Joints) at L1, the rest at L2 | L1 / L2 | Joint labels keep Pro's values: none / on hover (Pencil or mouse hover) / all |
| 1.10 | Hide / show / isolate | Hide and Isolate in ⋯ More on every noun, in every stage; a state chip *"N hidden · Show all"* | L2 / L0 | Rig's K-or-RMB-only path is closed |
| 1.11 | Manipulator size and space | Size scales with the pointer type at render time (never written to the shared `tools.manipulatorSize`); manipulator long-press › Space, Size | L1 | — |
| 1.12 | Selection mask | Empty-space tray › Pick only…; Loupe filter | L2 | — |
| 1.13 | Workspace switch | The Path | L0 | — |
| 1.14 | Dock panels: show, reset, drag / split / float | Sheets replace docks. `workspace.showPanel` maps each panel id to a Halo sheet with per-argument entries (meshCheck → Health, clipLibrary → Library, paintWeights → brush, …); docking itself goes to Pro | **Pro** | Docking (§15.15 a) |
| 1.15 | Layout presets | — | **Pro** | §15.15 a |
| 1.16 | Focus, full screen, chrome toggles | Hide UI (puck sheet, project menu); Full screen in the project menu (Home Screen mode suggested only after a Files backup, §17); chrome toggles go to Pro | L1 / L2 / **Pro** | Chrome toggles: §15.15 a |
| 1.17 | Command palette | `⌕ Do or find…`, Halo's own touch view over the host palette controller (Pro's palette is not restyled) | L0 | Mod+K only → visible pill |
| 1.18 | Marking menus | Halo ring (long-press, right-click, flick) from the same MarkingMenuDef data | L1 | RMB / Shift / Ctrl+RMB → long-press |
| 1.19 | Repeat / adjust last / last tool | ⟳ Again petal; after-run Echo chips (adjustable operators); pre-run forms (the rest); History › Adjust; T focuses the first chip; the tray remembers the last tool | L0 / L1 | G / T / Y in Rig → visible |
| 1.20 | Help, shortcuts, About, Help Line, HUD, modal readout | Help sheet (gesture card, Pro shortcut sheet, About; also `ui.open {shortcuts, about}`); budget ring; Echo chips | L2 / L0 | — |
| 1.21 | Mode chooser and hand-off | `/` opens Ekza Studio (a remembered choice wins; `/?chooser=1`); ▤ Pro layout; Home › Rig a model for me → Auto-Rig | L0 / L1 | — |
| 1.22 | Disabled reasons; menu context | Tap a greyed petal for the reason inline plus a one-tap fix; verbs act on their noun, never on a hovered panel | L1 | Hover tooltips → inline |

### 15.2 Select (15)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 2.1 | Click / marquee select | Tap; marquee: Pencil drag on empty space, a finger drag with *Select more* on, or *Select ▾ › Select area* | L0 / L1 | — |
| 2.2 | Add / toggle / remove | Thumb key tap meaning *Select more* (tap = once, double-tap = lock, hold); the chooser has *Pick or unpick* and *Unselect* | L0 | Shift / Mod → Thumb |
| 2.3 | Click-cycling; mesh click → control | *Next ›* on the breadcrumb; the Loupe (chips) | L0 / L1 | Tap-again cycling (3 px radius) is not used on touch |
| 2.4 | All / none / invert / mirror | Tap empty for none (Reselect chip in Animate; an undo step in Make and Rig); tray › Select all; More › Invert; breadcrumb long-press › *Other side* | L1 / L2 | — |
| 2.5 | Pick-walk | Crumbs (up); long-press the last crumb for ‹ › ▾; with *Select more* on, ‹ › ▾ extend the selection (`select.pickWalk {add: true}`) | L1 / L2 | Arrow / Shift+arrow keys → breadcrumb |
| 2.6 | Component mode | Make tray pill; Rig segment | L0 | — |
| 2.7 | Loop / ring / border / shell | *Select ▾* chip on the breadcrumb (Loop · Ring · Border · Shell); the double-click variants are its long-press options | L1 | Mod double-click variants → chip; double-tap always frames |
| 2.8 | Grow / shrink | *Select ▾* › Grow / Shrink | L1 | — |
| 2.9 | Convert selection | More › Convert ▾ | L2 | — |
| 2.10 | Select by swatch; Mesh Check offenders | Swatch Halo › Select faces; health dot › Show me | L1 | — |
| 2.11 | Soft selection | Tray *Falloff* chip + an on-canvas radius ring (Thumb drag meaning *Falloff size*); falloff curve in the chip's options | L1 / L2 | B + drag → Thumb / ring |
| 2.12 | Style, camera-based, backfaces, constraints | More › Selection options | L2 | — |
| 2.13 | Key, curve, channel and time-band selection | Thread, Keys, Curves (finger or Pencil marquee), channel rows in Numbers and Keys; band by a Pencil drag or a finger long-press then drag on the ruler | L0 / L1 | Shift band → Pencil / long-press |
| 2.14 | Selection undo (Model, Rig) | ↶ / two-finger tap; the toast names the selection step; the History ribbon folds selection steps into the next document step | L0 | Follows `prefs.modeling.undoSelection` (§5.3 C9) |
| 2.15 | Select hierarchy | Breadcrumb long-press › *Select branch*; Scene row | L1 | RMB-only → long-press |

### 15.3 Model (27)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 3.1 | Primitives with live parameters | Make tray › *New shape ▾* → Echo chips; later at any time: Numbers › Shape inputs (`mesh.primitive.set`) | L1 / L2 | — |
| 3.2 | Templates | Home › Make a character; Add ▾ › Templates | L1 | — |
| 3.3 | Reference image planes | *Reference ▾* (front / side / top) through the Reference picker (`imagePlaneImport`); the image plane's Halo (Opacity, Size, Lock, Hide, Delete, Replace image…); Numbers › Image plane (name, camera, depth) | L1 / L2 | — |
| 3.4 | Group, parent, unparent, duplicate, rename, delete | Duplicate and Delete petals; More › Group, *Parent to…* (verb → target), Unparent; rename via the crumb; Scene sheet: reparent by lift and drop (no sibling reorder, as in Pro) | L1 / L2 | Unreliable HTML5 drag-and-drop → recognizer / verb → target |
| 3.5 | Object transform; numeric TRS | Drag = move (once selected); Turn / Move / Scale rings in More; Echo TRS chips; Numbers › Transform (`scene.object.transform`) | L0 / L1 / L2 | — |
| 3.6 | Component transform, tweak, MMB along last handle | Drag components; manipulator handles; manipulator long-press › *Drag anywhere* | L0 / L1 | MMB → Drag anywhere |
| 3.7 | Fine / coarse drag; typed values while dragging | Thumb *Fine* / *Coarse*; distance scrub; tap the readout for the numpad | L0 / L1 | Shift / Mod / digits → Thumb / numpad |
| 3.8 | Virtual slider | Echo chips | L0 | MMB → chips |
| 3.9 | Extrude session (caps, divisions, smart) | *Pull* petal → cap handle, ⟨Segments⟩; Thumb drag meaning *Smart*; reduced Halo *Pull again · Bevel · Inset* | L1 | Shift + drag → Thumb |
| 3.10 | Inset / Bevel | Face and edge petals, handle + chips | L1 | — |
| 3.11 | Bridge / Connect / Fill hole / Average | Bridge petal (two borders); More (Connect, Fill hole, Average) | L1 / L2 | — |
| 3.12 | Insert / offset edge loop | *Loop cut* petal (Pencil hover or press-and-slide preview); More › Offset loop | L1 / L2 | Hover preview → press preview |
| 3.13 | Multi-Cut | Tray Cut ▾ › Multi-Cut; session bar ✓ / ✕ / ⌫; Snap / Loop / Centred chips | L1 | RMB / Enter finish, Backspace, Shift / Ctrl-click → bar |
| 3.14 | Slide edge / vertex | Edge and vertex petal *Slide* | L1 | — |
| 3.15 | Merge family; Target Weld | *Merge ▾* petal; *Weld to…* (verb → target) with ⟨At midpoint⟩ | L1 / L2 | MMB / Alt + Shift → chip |
| 3.16 | Delete components / edge & vertex | *Delete* petal; long-press › Delete edge & vertices | L1 | — |
| 3.17 | Extract, Duplicate face, Flip / Spin edge | More › Edit | L2 | — |
| 3.18 | Combine, Separate, Mirror, Symmetrize, Triangulate, Quadrangulate, Cleanup | *Mirror* petal; *Combine* rises with 2+ meshes; More › Mesh; Cleanup also as a Health fix | L1 / L2 | — |
| 3.19 | Per-mesh symmetry | Tray *Mirror edits* chip; axis and tolerance in its options | L0 | — |
| 3.20 | Snapping | Thumb drag meaning *Snap ▾*; locking it is the tray Snap chip (one state) | L1 | Held X / V / J → Thumb |
| 3.21 | Pivots | Manipulator long-press › Pivot ▾; Thumb *Pivot edit* (= `model.pivotEdit`); Numbers › Pivot (`mesh.pivot.set`) | L2 | Held D / Insert / Home → Pivot ▾ |
| 3.22 | Freeze / reset / apply transforms | More › Transforms | L2 | — |
| 3.23 | Make Editable (+ report) | First petal on an imported character mesh; Paint empty state | L1 | — |
| 3.24 | Static GLB import | Home › Bring a model; project menu › Import | L1 | Was Auto-Rig-only |
| 3.25 | Mesh attributes | Numbers › Mesh (name, faceted, material preset, triangle target, budget, grip, colour output) and › Character (format, file, height, licence, credits); rename via the crumb | L2 | — |
| 3.26 | Mesh Check + poly-count HUD | Health dots + budget ring (L0); Health sheet with Fix / Show me | L0 / L1 | — |
| 3.27 | Option boxes; modal keys | Long-press a petal › Options; ⚙ on More rows; session bar − n + / ✓ / ✕ | L1 / L0 | PgUp / PgDn / Esc / Enter → bar |

### 15.4 UV, shade, colour (11)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 4.1 | UV projections | More › UV ▾ | L2 | No UV editor anywhere |
| 4.2 | Normals | Edge petals Smooth / Sharp; More › Normals (angle, reverse, conform) | L1 / L2 | — |
| 4.3 | Palettes | Paint palette chip › New / Duplicate as variant / Rename / Assign | L1 / L2 | — |
| 4.4 | Swatches: add, edit, remove, replace, remap | `+` (L0); swatch Halo (first tap): Edit colour (picker, hex, name), Replace with active, Rename, Remove | L1 | RMB-only Remove / Replace → Halo |
| 4.5 | Active swatch, recents, eyedropper | Swatch row (first tap); the Recent row in Edit colour; Pick chip; first petal of a long-press on the mesh in Paint | L0 / L1 | I key → Pick |
| 4.6 | Assign colour to a selection | Face petal *Colour*; tray *Fill part* on a selection | L1 | — |
| 4.7 | Paint brush / Fill shell | Strokes (finger strokes start after slop); *Fill part* toggle, or the Thumb tap meaning *Fill part* + a tap (one state) | L0 / L1 | Shift-click → Fill part |
| 4.8 | Swatch shader (Lambert / Blinn, gloss, specular) | Swatch Halo › Finish ▾ + ⟨Gloss⟩ and a Specular colour | L1 / L2 | — |
| 4.9 | Assign new material | Swatch Halo › More › New material | L2 | — |
| 4.10 | Colour export mode | Share › Advanced › Colours as; palette menu | L2 | — |
| 4.11 | Flat / smooth / Blinn preview | Paint lit by default; puck sheet › Look | L1 | — |

### 15.5 Rig (17)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 5.1 | Rig modes | Segment, and mode-follows-touch | L0 | — |
| 5.2 | Character from selection; adopt | Mesh petal *Make a character* in Rig; Rig empty state | L0 / L1 | — |
| 5.3 | Model checks and fixes (incl. stand up, set height, freeze) | Health dots, Checks ⚠n, Fix chips (`autorig.fix`, in Auto-Rig's fix order from `autorigFlow`) | L0 / L1 | Was Auto-Rig / MCP only |
| 5.4 | Quick Rig markers | *Rig it for me* (guess, dots); the *Adjust dots* session: drag (`skel.quickRig.setMarker`), Re-guess, Mirror, Remove (`clear`), Pick from view (`pick`), Front · Side, ✕ (`cancel`) | L1 / L2 | Native in v1 (v0.1 handed off to Auto-Rig ②) |
| 5.5 | Skeleton templates; add missing bones | Rig tray › Add skeleton ▾; Fix chip | L2 / L1 | — |
| 5.6 | Create skeleton / one-click auto-rig | *Rig it*; *Skeleton only* (`skel.quickRig.commit`) in the card's ⋯ | L1 / L2 | Mod + Enter → button |
| 5.7 | Joint edits (move with children / alone, rotate rest, re-orient, numeric rest) | Drag (once selected); Thumb drag meanings *Alone* / *Orient only*; *Turn* petal; Numbers › Joint | L0 / L1 / L2 | Held D → Thumb |
| 5.8 | Orient, Mirror, Symmetry X, restore flexion, snap to centre | Joint petals (Orient, Mirror); More (Symmetry X, Restore bend, Snap to centre = `rig.snap.projectedCenter`, Joint size) | L1 / L2 | — |
| 5.9 | Rename joint; map humanoid bone | Crumb name; More › Humanoid bone ▾ | L1 / L2 | — |
| 5.10 | A-pose path | Fix chip *Straighten to T-pose*; More › Apply pose as rest (inline confirm card, `applyPoseAsRest`), T-stance | L1 / L2 | — |
| 5.11 | Update control rig; add limb IK | Character Halo (Rig) › More | L2 | — |
| 5.12 | Controls: secondary visibility, size, rotate order | Puck sheet › Show › Secondary; control More › Control size (`rig.setControlSize`), Rotate order (`rig.setRotateOrder`) | L2 | — |
| 5.13 | Joint display | Puck sheet › Show › Joints (size, x-ray, axes, labels: none / on hover / all) | L2 | — |
| 5.14 | Validation and the rig checklist | Path glyphs, health dots, Checks sheet with profile switch, Share readiness — one list (§7.2); *Edit VRM Meta…* opens About this character | L0 / L1 | — |
| 5.15 | Joint selection | Tap + Thumb; Rig tray › All joints | L0 / L1 | Mod → Thumb |
| 5.16 | Multi-part characters, rigid parts, finger detail | *Rig it for me* chips; character Halo › Parts & fingers | L1 / L2 | Was Auto-Rig only |
| 5.17 | Hide controls while rigging | Rig stage lighting default; puck sheet › Show | L1 | Was Auto-Rig only |

### 15.6 Skin and weights (12)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 6.1 | Bind skin (+ options) / Rebind | Skin empty state *Bind skin*; character petal *Bind again* with its inline confirm card (`rebindSkin`); options on long-press | L0 / L1 / L2 | — |
| 6.2 | Unbind; go to bind pose | Pose segment `[Bind│Test│Clip]`; More › Unbind with its inline confirm card (`unbindSkin`) | L0 / L2 | — |
| 6.3 | Paint skin weights (modes, value, opacity, radius, falloff, surface / volume, front only, paint / select) | Joint petal *Paint its weights* → brush tray chips (L0 in the tool); the rest in brush ⋯ | L1 / L2 | B / M / N + drag → chips; Pencil pressure |
| 6.4 | Flood | Brush tray | L0 (in tool) | — |
| 6.5 | X-mirror stroke | Brush tray Mirror chip, on by default | L0 | Alt + R → chip |
| 6.6 | Active influence: list, walk, pick dominant, sample | Two-way card + ‹ ›; *Who owns this?* finger-hold; Thumb tap meanings *Sample value* / *Pick bone*; All bones list (filter, sort) | L0 / L1 | Arrows, I, Shift + I → card / hold / Thumb |
| 6.7 | Hold / hold all / release all | All bones list locks | L2 | — |
| 6.8 | Mirror / Smooth / Prune / Normalize / Remove unused | Brush ⋯ › Fix weights, each with ⚙ Options; Health fixes | L2 | — |
| 6.9 | Weight display | Brush tray Show ▾ | L1 | Alt + C → chip |
| 6.10 | Test pose view; reset | Pose segment; character petal Reset test pose | L0 / L1 | — |
| 6.11 | Test-rotate a joint | In Test: drag a joint; ⟨Bend <joint>⟩ chip | L0 | E key → drag / chip |
| 6.12 | Numeric weight (`skin.weights.set`) | Vertex selection › *Set weight…* numpad | L2 | **New UI**: no Pro UI exists |

### 15.7 Pose (12)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 7.1 | Manipulate controls (object / world / gimbal) | Drag the ring or the selected limb; Reach on hands, feet, head and hips; manipulator long-press › Space | L0 / L1 | — |
| 7.2 | Channel numbers, expressions, nudges | Echo channel chips (Pro's numbers and signs); Numbers › Channels with numpad expressions, − / + steppers, several rows at once | L0 / L2 | Arrow nudges → steppers |
| 7.3 | Virtual slider | Chips | L0 | MMB → chips |
| 7.4 | Lock / unlock channels | Channel row long-press | L2 | — |
| 7.5 | Reset a channel to default | Channel row long-press; channel chip Halo | L2 | RMB-only → long-press |
| 7.6 | Reset pose to rest | *Reset* petal; character Halo | L1 | — |
| 7.7 | Copy / paste / paste mirrored | *Copy pose* petal, which then becomes *Paste ▾* (paste, paste mirrored, copy again) | L1 | — |
| 7.8 | Flip / mirror L→R / R→L | *Mirror ▾* petal | L1 | — |
| 7.9 | Pin / plant / unpin feet | Foot petals; character More | L1 / L2 | — |
| 7.10 | Unkeyed tweaks | Rec on (default): every change is a key, undo discards; Rec off: the Key petal's *changed* dot and tinted chips | L0 | — |
| 7.11 | Pose at a frame, aim, IK goals, transfer | Band petal *Hold pose* (`pose.transfer`); *Paste pose at…* (verb → target, `pose.setAt`); *Look at…* and *Place goal* (verb → target, wrappers over `pose.goals`); Reach drags | L0 / L1 / L2 | **New UI**: AI-only today |
| 7.12 | Pose recipes (wave, nod…), plant contacts | Recipes (T13) once `pose.recipe` / `pose.plantContacts` are registered | n/a | Not registered in the kernel yet |

### 15.8 Keys, curves, timing (25)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 8.1 | Set key (all / T / R / S / attributes; selected channels) | *Key ◆* petal (L1); its long-press (L2); channel Halo › Key this channel; *Key selected channels* on selected rows | L1 / L2 | RMB "Key Selected" → channel rows |
| 8.2 | Auto key and its mode | `● Rec` (Halo's own setting, default on, applied as a removable override); Pro's Auto Key mode in Settings › Animation | L0 / L2 | — |
| 8.3 | Key target | Long-press *Key ◆* › Key target | L2 | — |
| 8.4 | Delete key at frame / selected keys | Key dot and band petal *Delete* | L1 | — |
| 8.5 | Breakdowns: set, convert | Long-press *Key ◆* › In-between; key dot *In-between ⇄* | L1 / L2 | — |
| 8.6 | Tween family, overshoot | *Blend* chip (L0 between keys; lifting runs `key.tween`); its long-press for the mode; scrub past the ends | L0 / L1 | — |
| 8.7 | Mirror animation (half-cycle) | Animation Halo › More › *Mirror cycle* (a pre-run form) | L2 | Distinct name from *Swap sides* |
| 8.8 | Set frame / scrub / carry the pose | Thread tap and drag; Thumb drag meaning *Carry pose* | L0 / L1 | MMB scrub → Thumb |
| 8.9 | Step, prev / next key, start / end | Expanded transport (tap the time readout): start, previous key, previous frame, next frame, next key, end | L1 | Alt+, / Alt+. → buttons |
| 8.10 | Play / stop / backwards / loop modes / speed | ▶ (L0); its long-press: loop / once / oscillate, backwards; Speed in the expanded transport: Realtime · Every frame · Half · Double | L0 / L1 | — |
| 8.11 | Playback range and clip range | Range brackets (expanded transport › Range); animation Settings | L1 / L2 | — |
| 8.12 | Band: select / move / scale / copy / context menu | A Pencil drag, or a finger long-press then drag, on the ruler; drag body or ends; Thumb drag meaning *Copy*; band Halo (Copy, Paste ▾) | L0 / L1 | Shift / Mod + drag, RMB → long-press / Thumb / Halo |
| 8.13 | Insert / remove / delete time | Playhead Halo (long-press the playhead): Insert frame, Remove frame, Delete time… (forms); band More › Insert / Remove time | L1 / L2 | — |
| 8.14 | Ripple edit | Keys header chip *Push later keys* | L1 | — |
| 8.15 | Dope Sheet | Keys layer (rows down to channels, Select · Move · Scale, region, frame, ‹ › nudge, the key Halo docked in the header) | L1 | Arrow nudge → chips |
| 8.16 | Graph key and handle edits, insert key, numeric fields | Curves layer: finger or Pencil drags, Select · Move · Insert · Scale tools, *Insert key* petal, ⟨Time⟩ ⟨Value⟩ ⟨In / Out angle⟩ ⟨In / Out weight⟩, Axis chip | L1 / L2 | MMB move, Shift axis, R scale → drags / chips / tools |
| 8.17 | Tangents (all 9, break / unify, weighted, lock weight) | Key dot *Ease ▾* (4 at L1, the rest at L2); Curves chips | L1 / L2 | 1–7, B, U keys → chips |
| 8.18 | Pre / post infinity | Curve petal *Cycle ▾* | L2 | — |
| 8.19 | Euler filter, Simplify, Key curves | Curve petals *Fix flips*, *Fewer keys* (a pre-run form); More › Key curves here | L2 | — |
| 8.20 | Buffer curves | Hold *⇆ Before*; More › Snapshot / Swap / Clear | L2 | — |
| 8.21 | Views (abs / norm / stack); framing | Curves More › View: Real · Fit · Stacked; double-tap | L2 | N / Shift + N → More |
| 8.22 | Copy / paste keys (merge / replace / insert) | Key, band or playhead petals: *Copy* → *Paste ▾* in the same slot | L1 | Hover-scoped Mod + C / V → petals |
| 8.23 | Graph / Dope pan and zoom | Two fingers in the sheet | L0 | Wheel / Alt + MMB → touch |
| 8.24 | Channel list filter; keyed only | Curves header chip *Only animated* and the filter | L2 | — |
| 8.25 | Value scale / offset; offset with wrap | Band More › Scale values…, Offset values…, Offset in loop (wrappers over `key.adjust` / `key.retime {wrap}`) | L2 | **New UI**: AI-only today |

### 15.9 Clips and library (7)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 9.1 | New, duplicate, rename, delete, set active | Animations row (`+ New`); animation Halo on the first tap | L0 / L1 | RMB → Halo |
| 9.2 | Clip settings | Animation Halo › Settings | L2 | — |
| 9.3 | Library: browse, preview, stop, use | Library drawer (preview on tap, *Stop preview*, Add) | L1 | — |
| 9.4 | Library parameters, search, categories, edit, remove, add many | Expanded card; *Add starter set*; animation Halo › Edit | L1 / L2 | **Was Auto-Rig only** |
| 9.5 | Import VRMA / animation GLB / embedded clips (options) | Bring a model; Library › From file; options sheet | L1 / L2 | — |
| 9.6 | Make loop | Animation petal *Loop it*; the *loop it* search phrase | L1 | **New UI**: AI-only today |
| 9.7 | OMOBA slot | Animation Halo › Use as…; Share readiness | L2 | — |

### 15.10 IK / FK (7)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 10.1 | Limb attributes (poles, soft IK, twist, blend) | Numbers › Limb | L2 | — |
| 10.2 | Switch IK ↔ FK (+ key mode) | *Hand leads* / *Foot leads* petal; key mode on its long-press | L1 / L2 | — |
| 10.3 | Match at the current frame | *Hand leads* long-press › Match now | L2 | — |
| 10.4 | Match a range | Band More › Match IK/FK; limb More | L2 | — |
| 10.5 | Foot roll; foot pivots | Foot Echo chips (L1); Numbers › Foot (L2) | L1 / L2 | — |
| 10.6 | Add limb IK; IK defaults | Character Halo (Rig) › More; Settings | L2 | — |
| 10.7 | AI IK-goal placement | Reach drags on hands, feet, head and hips (L0 once selected); More › Place goal (verb → target) | L0 / L2 | **New UI** |

### 15.11 Import, export, publish (11)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 11.1 | Open / import GLB, VRM (Draco, meshopt, KTX2) with options | Home › Bring a model (byte-sniffed); project menu › Open / Import; Advanced options | L1 / L2 | iOS `accept` problem → sniffing |
| 11.2 | Samples | Home › Try a sample; project menu › Samples (incl. Cube Lad, Polybot T / A) | L1 / L2 | — |
| 11.3 | Intake gates (heavy mesh, already rigged) | Automatic sheet at intake (routing from `autorigFlow`); on iPad the memory profile refuses models above 200k triangles (§15.0) | L0 | — |
| 11.4 | Export animation (bake / VRMA / anim GLB + options) | Share › Just the animations / Game engine / Into the original file; Advanced | L1 / L2 | — |
| 11.5 | Static model GLB | Share › Prop for OMOBA; Share › More formats › *Static model (GLB)* (whole model, colour output, lit / unlit, `local/generic`); object More › Export selected… | L1 / L2 | RMB "Export Selected" → More |
| 11.6 | Character VRM 1.0 / GLB behind the gate | Share › OMOBA & Ekza Space | L1 | — |
| 11.7 | VRM meta; thumbnail | Share fields (name, author, licence as an explicit choice); About this character (every `CharacterVrmMeta` field, Render thumbnail), also opened by `ui.open {vrmMeta}` and Validation's *Edit VRM Meta…* | L1 / L2 | — |
| 11.8 | Auto-Rig export targets (OMOBA kit, VRM 0.x kept, rigged GLB) | Share › More formats | L2 | Was Auto-Rig only |
| 11.9 | Export profiles and lints | Destination → profile; card Details (rule ids, profile switch) | L2 | — |
| 11.10 | Validation gate and read-back | Automatic, with *Go fix ▸* | L0 | — |
| 11.11 | Publish to Ekza Hub | Hidden until M4a, as in Pro | n/a | — |

### 15.12 Project, files, history (9)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 12.1 | New project | Home; project menu | L1 | — |
| 12.2 | Open `.ekzanim` | Bring a model (sniffed); project menu › Open | L1 | — |
| 12.3 | Save, Save As, Save Debug JSON | Project menu › *Save project to Files* (two-step on iOS), Save as; Share footer › Save project; Advanced › Debug JSON. Exports are separate (*Export … to Files*) | L1 / L2 | — |
| 12.4 | Autosave, recover, recovery point, discard | Silent restore / Continue (L0 / L1); project menu › Recover, Recovery point, Discard | L0–L2 | — |
| 12.5 | Undo / redo | ↶; two-finger tap; Redo in the toast and in the History ribbon (long-press ↶) | L0 / L1 | — |
| 12.6 | Edit copy / paste / delete; Escape | Per-noun petals; ✕ in the session bar; tap empty space | L1 | Hover-dispatched → noun verbs |
| 12.7 | Revert chosen steps; restore document | History ribbon › Revert this / Undo all | L1 / L2 | — |
| 12.8 | Unsaved guard and dirty state | Dirty dot, cleared only by a project save; *"saved on this iPad, not in Files"*; iPad Safari never shows a leave prompt, so the autosave flushes on `pagehide` / `visibilitychange` and its snapshot is kept on iOS | L0 | — |
| 12.9 | History panel (planned M2c) | History ribbon (long-press ↶): labelled steps, selection steps folded, AI groups, Compare, Adjust, Redo | L1 | **Arrives in Halo first** |

### 15.13 AI agent (7)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 13.1 | Connect, discovery, pairing | Ask sheet › Connect (desktop Chrome / Edge) | L1 | iPad and Safari: §15.0, OQ-5 |
| 13.2 | Grants | Plain toggles in the pairing card: *change my animation*, *save files* and under it *use my agent's workspace folder*, *change what I see* | L1 | — |
| 13.3 | Pause, resume, disconnect | Ask sheet | L2 | — |
| 13.4 | Audit log, undo per step, revert all | History ribbon AI groups | L1 | — |
| 13.5 | Confirm cards | Inline cards | L0 (when raised) | — |
| 13.6 | Live status, toasts | Activity line under the search pill | L0 | — |
| 13.7 | What the agent can do (37 tools, prompts, headless) | Unchanged; prompts shared with recipes | n/a | — |

### 15.14 Preferences (9)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 14.1 | Start in | Settings › Start in: Ekza Studio / Studio Pro / Auto-Rig / Ask; the layout switch updates it | L2 | — |
| 14.2 | Navigation profile | Settings › Input: the touch / Pencil routing table; mouse profile (Maya / trackpad / one-button) | L2 | — |
| 14.3 | Space key behaviour | Settings › Keyboard › "In Studio Pro, Space…" (Halo always plays) | L2 | Edits Pro's pref explicitly |
| 14.4 | Auto-key mode | Settings › Animation (Pro's Auto Key mode); Halo's Rec is its own setting (`halo.rec`) | L2 | — |
| 14.5 | Reduce keys on import | Settings › Import | L2 | — |
| 14.6 | Graph handles | Settings › Animation; Curves ⋯ | L2 | — |
| 14.7 | Prefs with no UI; uiScale | Settings › Advanced, generated from a prefs descriptor table (label, unit, range, section; T6b, with a test that every `Prefs` key has one); *Text & touch size* (uiScale, now read) | L2 | **New UI** |
| 14.8 | First-run dialog | Replaced by Home, the gesture line and one-time coach marks; Pro keeps its dialog | L0 | — |
| 14.9 | Keymap overrides | — | **Pro** | §15.15 c; no UI in either shell yet |

### 15.15 Deliberate Studio Pro hand-offs, and why

a. **Pro's window chrome**: dockview panels (drag, split, float, reset), layout presets (apply, save, rename, delete),
   the chrome toggles (Tool Strip, Help Line, Time Slider), and Pro's focus mode. These operators configure Pro's
   docking window, not the document. Ekza Studio has its own fixed layout, sheets and Hide UI. In the parity test they
   are the `PRO_CHROME` list.

b. **Seeing many editors at once**: the Graph Editor, Dope Sheet, Channel Box, Outliner and Attributes side by side for
   long polish sessions. Every capability of each is in Ekza Studio, one deep layer at a time. Showing them together
   is what Pro is for. *Open in the Pro layout ▸* on the Curves layer is a convenience only. On touch-only devices the Pro layout is not touch-ready (§15.0), so these are presentations, never the only path.

c. **Keymap customisation**, once it exists: a keyboard power-user feature.

Nothing else is Pro-only, and nothing is handed to Auto-Rig: v0.1's *Adjust dots* hand-off is native in v1 (§12.2). The ~51 deferred stubs ("Arrives after the MVP") stay hidden in both shells.

**Nine capabilities that have no Pro UI today get one in Ekza Studio:**
- `skin.weights.set`
- `clip.makeLoop`
- `pose.transfer`, `pose.setAt` and `pose.goals`
- `key.adjust` and `key.retime {wrap}`
- the Auto-Rig-only clip parameters
- the stand-up and set-height fixes
- static GLB import outside Auto-Rig
- multi-part and finger options outside Auto-Rig
- a History surface

---

## 16. Switching between the layouts and Auto-Rig

### 16.1 Same page (the normal case)

- `▤ Pro layout` calls `host.navigation.go({to: 'studio', workspace, from: 'halo', subject, then?})` directly from the
  tap handler, so a new tab is never treated as a blocked pop-up.
- **On a device with only a coarse pointer**, the tap first shows one line, anchored to the button: *"Studio Pro is
  laid out for a mouse and keyboard · Open anyway · Save project to Files to continue on a computer"*. *Open anyway*
  navigates; the line is not shown again in that session.
- `leave()` first **commits** any session-bar tool (✓ Done, §5.7) and stops the library preview. The host then closes
  its palette, dialogs and confirm prompts and resets the keyboard (AUTORIG-SPEC §3.4). Halo's session overrides
  (stage lighting, Rec, §16.4) are removed.
- The `(studio)` layout stays mounted, so everything below survives (AR-D1-1):
  - the `EditorApp`: document, undo history, session (selection, time, tools, overrides, workspace, per-workspace
    viewport layout);
  - prefs;
  - the `ViewportManager` and its camera memory (Halo registers its main pane as `pane-single` and its side inset as
    `pane-side`, Pro's ids);
  - the GL context;
  - the autosave slot;
  - the agent session;
  - the loaded chunks.

| Halo stage | Pro arrives at |
|---|---|
| Make | Model workspace, same component mode |
| Paint | Model workspace, with the Paint Colour tool still active |
| Rig (Character / Skeleton / Skin) | Rig & Skin, same `rig.mode`; Paint Skin Weights if the brush was active. Below 1024 pt Pro shows its view-only line with *Back to the Simple layout* |
| Animate | Animate workspace; the Polish preset when the Thread was at Curves (`then: {kind: 'preset', preset: 'polish'}`) |
| Share sheet open | The current workspace, with the Export dialog opened (`then: {kind: 'dialog', dialog: 'export'}`) |

- Pro shows a toast: *"Same project, every panel at once · Undo still works"*. Its first-run dialog is suppressed for
  `from=halo`, as it is for `from=autorig` (`EditorShell.tsx:93`).
- **Pro → Ekza Studio.** A status-line button *▤ Simple layout*, plus Help › and File › *Switch to the Simple layout*.
  They are built like `shell.autoRig` with a lazy switch chunk (`haloSwitch.ts`), so `/editor` pays only for the menu
  items (ST-B1).
  - Mapping back: Model → Make (Paint when the Paint Colour tool is active), Rig & Skin → Rig, Animate → Animate.
  - Selected keys open the Thread at Curves. A selected joint opens its Halo.
- **Halo's shell-local state** is mirrored to `sessionStorage` (`ekza-studio:halo:session:v1`), following
  `autorig/session`: stage, open sheet, Thread layer, Thumb key lock, pinned petals, destination, Rec and recipe
  progress. So a reload or a round trip through Pro comes back to the same place.
- `watchRigViewOnly` stays a Pro-only registration (T3 does not move it to the host), so Halo mounted at 834 pt can
  still edit after a round trip to Pro (a unit test, AS-ST-7).

### 16.2 New tab and other devices

- **New tab.** Long-press `▤ Pro layout` › *Open in a new tab*. It uses the existing one-shot IndexedDB handoff record,
  whose `HandoffInfo` is widened with `halo` state. Undo history starts fresh there, and a banner says so. In Home
  Screen mode (`display-mode: standalone`) this item is hidden: a new tab would open in Safari, whose storage cannot
  read the handoff record.
- **Other devices.** Save project to Files as `.ekzanim` (with its thumbnail), then Open on the other device. Pro skips
  its first-run dialog when a file is dropped, and a banner says *"undo history starts here"* (ADR 0011). Keeping the
  history in the file is OQ-8.

### 16.3 Auto-Rig

- `/autorig` stays as it is. Halo enters it only through the Home link *Rig a model for me*; dot editing no longer
  needs it (§12.2).
- Auto-Rig gets a *Back to Studio ▸* control when `from=halo`. Its own *Open in Studio ▸* still goes to Pro.
- When entered from Halo, `HandoffInfo` carries the subject (the character or mesh), Halo's destination and its finger
  preset, so Auto-Rig ① starts with the same choices. Auto-Rig runs its normal ① flow; it never has to accept a start
  pose it did not record.
- The host has one mounted-shell slot, so Halo never embeds `AutoRigShell`; it navigates.
- Both shells run the orchestration in `editor-core/src/autorigFlow` (§20.3 item 10). Folding Auto-Rig into Halo is
  OQ-6 (T14).

### 16.4 Shared preferences and session overrides

Halo never writes these implicitly:
- `navProfile` (Halo's routing lives in `halo.input`);
- `autoKey` (Halo's Rec is its own setting `halo.rec`, applied as an override, below);
- `spaceBehaviour` (Halo always plays and edits Pro's value only through Settings › Keyboard);
- `modeling.optionDefaults` (written only by *Options › Make default*);
- `uiScale` (*Text & touch size*, which now affects both shells, changed only by that control);
- the pane display memory (`<workspace>:pane-single`), written only by the View sheet's own Look and Show controls.

**Session overrides** go through one new mechanism, the effective-preferences layer (§20.4): `app.prefs.override(layer,
patch) → Disposer`. Readers get the effective value; persistence writes only the base value.

| Override | Layer | Set by | Removed |
|---|---|---|---|
| Stage lighting | — (the viewport display overlay, not prefs) | Halo's stage | on stage change and unmount |
| Rec → `autoKey: true / false` | `shell` | Halo, while mounted and an animation is active | on unmount |
| iOS memory profile → undo and journal budgets | `device` | the host, before the first `GLHost`, on every route | never during the page's life (it describes the device) |

AS-ST-10 checks Pro's keymap, marking-menu definitions, pref defaults and stored prefs, and the pane display memory,
before and after a Halo round trip.

**Autosave on iOS.** Halo flushes the autosave on `pagehide` and `visibilitychange`, because iPad Safari fires
`beforeunload` but never shows its prompt (WebKit r269983). On iOS the snapshot is kept even when the project is clean,
because a share that resolved does not prove the file reached Files.

---

## 17. First open and onboarding

- **No modal on the first paint**: no first-run dialog, no Recovery dialog, no "How do you navigate?", no either/or
  chooser.
- **Home** (wireframe A):
  - one sentence;
  - three doors: *Try a sample* (primary when there are no Continue cards), *Bring a model*, *Make a character*;
  - Continue cards built from the autosave slots, first when they exist;
  - *Rig a model for me*;
  - a single gesture line: *"✎ Pencil edits · ☝ finger moves the view · two-finger tap = undo"*;
  - a quiet `▤ Pro layout`.
- **Coach marks** appear once per surface, in context, and can be dismissed:
  - the first Halo: *"Hold on the model and flick toward a verb to go faster"*;
  - the first time the Thumb key appears: the text of its current `modifierMap` row (§5.5), so it always matches the
    label;
  - the first time the Thread switches to Keys or Curves;
  - the first Pencil touch: the routing toast (§5.1).
- **The Next chip** (§7.2) is the only standing guidance: *Rig it for me ▸ → Add animations ▸ → Share for … ▸*.
- **Never on first open**:
  - the menu bar, docks, workspace tabs or the disabled Review tab;
  - hotkey hints, or RMB / MMB instructions;
  - DCC jargon at L0 or L1: extrude, breakdown, tween, ripple, Euler, tangents, IK/FK, influences, bind pose, Lambert /
    Blinn, "tris" (§6.2 uses plain words; Pro names appear at L2);
  - format names as choices: VRM 0.x / 1.0, VRMA, `.ekzanim`, Draco, KTX2 (they are in Share › Advanced);
  - rule or profile ids;
  - AI plumbing (ports, grants);
  - licence text before Share;
  - a "Chrome and Edge only" banner. A missing capability is checked only when it is needed.
- **The storage card**: after the first *Save project to Files*, a card offers *"Keep projects on this iPad"*
  (`navigator.storage.persist()`). Only then does it mention *Add to Home Screen* for full screen, with the warning
  *"The Home Screen app keeps its own projects: open your file there"*, because on iOS 26 a Home Screen web app has
  storage separate from the Safari tab and would show no Continue cards.
- **Help** (project menu): a gesture card listing every gesture and its twin, the glyph legend, the Pro shortcut sheet,
  About and licences.

---

## 18. Accessibility

Target: **WCAG 2.2 AA** for all chrome.

- **Targets and type**: hit targets of at least 44 × 44 pt (WCAG 2.5.8 asks for 24 px; Apple's HIG for 44 pt). Input
  text of at least 16 px. *Text & touch size* (`uiScale`, 0.85–1.5) scales chrome and targets and is read at last.
- **Gestures**: every gesture has a button twin (§5.2). Settings › Input › *Reduce gestures* turns off two-finger-tap
  undo, quick pinch and flicks; every journey stays doable (AS-ST-9). *Halo opens on* (§4.5) can be set to *right-click or
  hold*, which leaves ⋯ Verbs on the breadcrumb as the visible way into verbs.
- **Screen readers**:
  - the Halo is a `menu` with `menuitem`s;
  - Path stages are a `tablist`;
  - sheets are `dialog`s with a focus trap and an accessible name;
  - Echo chips are `slider`s with `aria-valuetext` in units;
  - the Thread exposes play, the expanded transport, Rec and the layer switch, and the current time as text;
  - the Thumb key is a toggle button whose accessible name is its current meaning (*"Select more, for the next tap"*);
  - canvas selections are announced through a live region (*"Selected Right forearm. 5 verbs."*).
- **Full keyboard access**: Tab and arrows reach every chrome element; the Halo opens on Enter for the selection.
- **Colour independence**: readiness glyphs use shape and count (`○ ◐ ● ⚠2`); health dots carry a count and an icon.
  Destination problems are listed as text.
- **Motion**: under `prefers-reduced-motion`, chrome breathing becomes instant, the Halo appears without its arc
  animation, and flicks still work.
- **Handedness**: mirrors the off-hand column, the Halo arc side and the sheet side.
- **Language**: plain-language strings live in one catalogue (`halo/src/i18n/en.ts`); Russian is OQ-9.

---

## 19. iPad Safari constraints and how each is handled

Tags: **[C]** confirmed, **[R]** reported, **[V]** to verify on a device (tracked in §20.7 D-list).

| # | Constraint | Handling | WP |
|---|---|---|---|
| S1 | Every iPad browser is WebKit; Studio supports Chrome / Edge only and no WebKit is in the test gate [C] | A Playwright `webkit-ipad` project (iPad Pro 11 landscape and portrait). It is desktop WebKit: it checks JS, CSS and WebGL **compatibility only**, not iOS touch, gestures, Web Share, Files, memory or Pencil. Those are checked on real devices, and that check is a hard part of the release gate with a named owner (§20.7, OQ-13). Halo is supported on Safari 26+ (iPadOS and macOS). NFR-03 is amended for Halo; Pro on Safari stays best-effort (OQ-7). | T0, T12 |
| S2 | No touch navigation in Studio; the viewport is single-pointer and commits a press on `pointerdown` [C] | Shared touch navigation in `viewport` with a public `navigate()`, and the arbiter as a stage inside `ViewportManager`'s own pointer path (§20.4) | T1a, T1 |
| S3 | Rig & Skin view-only below 1024 px [C] | Halo never calls `setRigViewOnly`; `watchRigViewOnly` stays Pro-only; the layout uses container queries (AR-V1) | T3, T6a |
| S4 | No `contextmenu` on a touch long-press (WebKit 213953) [C] | An explicit long-press stage in the arbiter (450 ms, 10 pt slop) and `-webkit-touch-callout: none`. No feature depends on `contextmenu`. D16 checks that a long-press raises no `pointercancel` or callout. | T1 |
| S5 | Keyboard scope comes from hover and is lost when a finger lifts [C / V] | Non-mouse pointers take the scope from `lastPanel` | T2 |
| S6 | Hit tolerances of 2–8 px; drag thresholds of 2–3 px [C] | Tolerances, slop, double-tap and cycle radii by pointer type, plus the Loupe | T1, T6a |
| S7 | Pencil: pressure, tilt, altitude / azimuth and hover available; squeeze, double-tap, barrel roll and haptics not [C]; ~60 Hz events, coalesced events partial [R] | Pressure folded into stamp strength (pen only); the arbiter hands tools the original events with their coalesced samples; interpolated stamps; no design depends on Pencil Pro features. A native wrapper is OQ-12. | T1, T9 |
| S8 | Per-tab memory kill at ~1.5–2 GB [R] | A host-level **memory profile**, decided per device before the first `GLHost` on every route: DPR capped at 1.5 above 4 MP, MSAA off on containers above 5 MP (the context is created once, so this cannot be switched later), undo budget 96 MB (from 256 + 64) through the `device` override layer, textures resized at GPU upload only above 2048² (document textures and exports unchanged; a test compares export bytes with the profile on and off), triangle warning at 60k and refusal at 200k (Auto-Rig's gate). The context-loss path is kept. | T0 |
| S9 | No save / open pickers; `<a download>` lands in Downloads; user activation is gone by the time an export finishes [C] | `FileService.save() → SaveTicket` (§20.4): the ticket holds the file until a host-level button is tapped, which calls `canShare` and `share({files})`; a fallback to `<a download>` when `canShare` fails or `share()` has not resolved in ~10 s (WebKit 234187). Pro, Auto-Rig, MCP-triggered exports and the e2e recorder all go through it. | T0, T11 |
| S10 | `accept` is unreliable for `.vrm`, `.ekzanim`, `.vrma` [R / V] | No `accept` attribute on iOS; files are sniffed by magic bytes (glTF / GLB / zip / JSON), with a plain error for anything else | T0 |
| S11 | IndexedDB may be evicted after 7 days without a visit; `persist()` is unreliable [R] | *Save project to Files* as the backup habit; the storage card after the first project save; a status that says *"saved on this iPad, not in Files"*; exports never clear the unsaved dot | T0, T11 |
| S12 | iOS 26 opens Home Screen sites as web apps with storage separate from the Safari tab [C] | `manifest.webmanifest` (`start_url: '/app'`, `scope: '/'`), `apple-touch-icon` and `viewport-fit=cover` scoped to the `/app` segment (its own layout and viewport export), so Pro's status line never sits under the home indicator and a Pro page added to the Home Screen does not launch `/app`. Home Screen mode is suggested only after a Files backup, with the separate-storage warning (§17). *Open in a new tab* is hidden in standalone mode (§16.2). | T0 |
| S13 | Pinch outside the canvases zooms the page; pull-to-refresh reloads it; inputs under 16 px zoom on focus [C] | The shell-wide policy of §4.1 (`touch-action`, `overscroll-behavior`, `gesturestart`), with a disposer; inputs of at least 16 px | T4, T6a |
| S14 | System gestures (3–5 fingers, edges, home indicator) [R] | One- and two-finger gestures only; a 20 pt bottom clearance; a 12 pt side inset | T6a |
| S15 | Safari reports `MacIntel` [C] | The input mode comes from `pointerType` and `any-pointer: coarse`, never from the user agent | T6a |
| S16 | Pointer Lock only with a mouse or trackpad [R] | Distance scrub never needs Pointer Lock; Pro's virtual slider keeps its pointer-capture fallback | T6a |
| S17 | Element fullscreen exits when an input is focused (iPad), and is missing on iPhone [R] | Hide UI is the primary "full screen"; Home Screen mode after a Files backup | T6a |
| S18 | The loopback MCP bridge cannot be reached from Safari [C] | An honest card; recipes; OQ-5; listed in §15.0 | T6b |
| S19 | Touch HTML5 drag-and-drop with custom MIME types is unverified [V] | Not used: pointer-event lift-and-drop and verb → target | T6b |
| S20 | Native `dblclick` on touch is uncertain [R] | The arbiter counts taps itself (the multi-tap windows of §5.4) | T1 |
| S21 | Trackpad pinch on iPad may zoom the page, not reach it [R / V]; `GestureEvent`s also fire for touchscreen pinches [C] | A `gesturechange` handler maps a trackpad pinch to dolly inside the canvas, and is ignored while the arbiter tracks two or more touch pointers (§5.3 C15) | T1 |
| S22 | Scribble writes near any editable field, focused or not [C] | Always-visible fields are buttons until tapped (§4.1); D15 checks that a Pencil stroke started 5 mm from the top bar never becomes text | T6a |
| S23 | Long-lived tabs and Home Screen apps meet a redeploy; a lazy chunk then fails to load [R] | Halo prefetches all its small lazy chunks at idle after boot and on network change; one host-level banner for chunk failures (*"A new version is ready — reload; your work is autosaved"*); deployment skew protection considered at T12 | T6a, T12 |
| S24 | `beforeunload` fires but never prompts; `share()` resolving does not prove the file reached Files [C] | Autosave flushes on `pagehide` / `visibilitychange`; on iOS the snapshot is kept whatever the dirty state; the toast after a share says *"iPad does not confirm where it went"* (§16.4) | T0, T11 |
| S25 | Touch contact size (`width` / `height`) may be meaningless in WebKit [V] | Contact-size palm rejection runs only when D14 confirms a usable size (§5.1) | T1 |

---

## 20. Architecture

### 20.1 Route, package, dependencies

Halo follows the Auto-Rig pattern (ADR 0021).

- **Route** `apps/web/app/(studio)/app/`:
  - `page.tsx`, with metadata, and its own `layout.tsx` with the `/app`-only viewport export (`viewport-fit=cover`) and
    the manifest link (S12);
  - `HaloEntryIsland.tsx`, using `next/dynamic` with `ssr: false` and `Loading.tsx`;
  - `HaloEntry.tsx`, which calls `useShellEntry({Host: StudioHost, Shell: HaloShell, props: hostProps(router.push)})`.

  Living in the `(studio)` group gives document and history retention across shells for free.
- **Package** `packages/halo` (`@ekza-studio/halo`), imported only by `HaloEntry.tsx`.
  - Shell marker string: `ekza-halo-shell`.
  - **Allowed dependencies**: `anim-core`, `doc`, `editor-core` (including the new `./forms` subpath and
    `src/autorigFlow`), `viewport`, `curve-editor` (lazy imports only), `ui` (including the new `./touch` subpath),
    `react`, and the `@ekza-studio/editor` subpaths `./host`, `./bodies`, `./models`, plus three new, measured
    subpaths: `./overlays` (the marking-menu controller geometry), `./toolkit` (the `ParamField` / `OptionBoxView`
    logic) and `./agent` (the Agent panel body, lazy).
  - **Never**: `autorig`, `mesh-core`, `rig`, `io`, `mesh-view`, `dockview`, or the `@ekza-studio/editor` root, which
    pulls in `StudioShell` and dockview.
  - Enforced by `tooling/check-deps.mjs` and an `.oxlintrc.json` `no-restricted-imports` block like Auto-Rig's.
- **Registration points**:
  - `apps/web/next.config.ts` `transpilePackages`;
  - `apps/web/package.json`;
  - the root and `apps/web` `tsconfig.json` references;
  - the `@source` line in `packages/ui/styles.css`.
- **Rules**:
  - Every document write is an operator run (ADR 0021 rule 2). A unit test greps `packages/halo/src` for store writes
    and kernel imports.
  - Halo never calls `setRigViewOnly` (AR-V1) or `providePaneDisplay`, and never writes a shared preference except
    through a visible control; session settings go through the override layer (§16.4).

### 20.2 Package layout

```
packages/halo/src/
  index.ts              HaloShell + marker
  shell/                controller.ts (arrival: takeWorkspace / takeSubject / ?stage; host.mount({kind:'halo', leave,
                        handoffState}); session mirror; touch-action / overscroll policy with a disposer; recovery
                        hook), Frame.tsx (container-query layout), TopBar, ProjectMenu, prefetch.ts (idle chunk prefetch)
  canvas/               HaloPane.tsx (WizardPane-style: paneSetup → registerPane; ids pane-single / pane-side),
                        overlay.ts (stage display overlay through vm.setDisplayOverlay)
  input/                arbiter.ts (ArbiterConfig + handlers), routing.ts (Shared / Pencil edits / Pencil only),
                        modifierMap.ts, thumb/, loupe/
  path/                 Path.tsx, readiness.ts (pure, one list), destinations.ts, nextChip.ts
  stages/{make,paint,rig,animate}/   stage.ts (StageDef), Tray.tsx — non-initial stages are lazy
  verbs/                nouns.ts (resolveNoun), table.ts (curated petals), derive.ts (More from manifest + poll)
  halo/                 HaloBar, HaloRing (./overlays geometry), Breadcrumb, TargetMode (verb → target)
  chips/                EchoChips, forms.ts (pre-run forms), scrub.ts (distance scrub), bind.ts (edit.adjustLast,
                        NumericTarget)
  session/              SessionBar (leave = Done)
  dialogs/              watcher.ts (session.dialog → Halo surfaces, §6.7)
  thread/strip/         layer 0 (eager, own Canvas2D over editor-core queries)
  thread/band/          band + key-drag models from curve-editor (lazy), the focused band source
  thread/keys/          layer 1 (lazy; curve-editor DopeSheet adapter)
  thread/curves/        layer 2 (lazy; curve-editor Graph adapter)
  sheets/               more, numbers, scene, library, health, share, about, history, settings (from the prefs
                        descriptor table), view, help, ask — all lazy
  palette/              Halo's touch palette view over the host palette controller
  recipes/              rigIt (over editor-core autorigFlow), addAnimations, loopIt, wave, fixForOmoba, fixBend
  home/                 Home, Continue, intake/ (byte sniffing → autorigFlow routing)
  manifest/             disclosure.ts, proOnly.ts, plumbing.ts, searchOnly.baseline.json, labels.ts
  i18n/en.ts, i18n/channels.ts
packages/halo/test/     parity helpers, manifest lints, vocabulary lint, modifierMap (real tools), nouns/verbs on
                        fixture apps, readiness, dialogs map, channel values, recipes, layout
```

### 20.3 Shared extractions and kernel changes (additive)

| # | Change | Where | Who benefits | WP |
|---|---|---|---|---|
| 1 | **Touch navigation in `viewport`.** Move `autorig/src/nav/{index,touch}.ts` (`simpleGesture`, `toolClaims`, `addNavigationClaim`, two-finger pan / pinch) into `viewport/src/navigation/touch/`; Auto-Rig re-imports it. Add the Paint Colour tool to the brush claim set. Add a public `ViewportManager.navigate(paneId, gesture, dx, dy)` (`orbitBy`, `panBy`, `dollyBy`) in place of synthetic PointerEvents; a shot-camera dolly commits once per gesture. An internal `touch` NavProfile for touch shells only. Port Auto-Rig's touch e2e helpers (`ar-as-12` drives CDP touch, which WebKit lacks). | viewport, autorig | Auto-Rig, Halo (Pro later) | T1 |
| 2 | **The arbiter as a stage of `ViewportManager`'s pointer path** (§20.4): press buffering until slop or long-press, the original events with their coalesced samples handed to the tool, a no-move press delivered to the select tool as a click, double-tap absorbed, two-finger gestures, pen priority and palm rejection; panes resolved by DOM containment, not `paneAt` geometry. Spiked first in T1a (as AR-D0 spiked its layout), with `/editor`'s delta measured and the full Pro e2e suite run against it. | `viewport/src/input/arbiter.ts`, `viewport/src/manager/ViewportManager.ts` | all touch surfaces | T1a, T1 |
| 3 | **Virtual modifiers with held keys**: `setModifierSource()` with `{shift, mod, alt, held, button}`. Virtual holds merge into the `ToolKeyEvent` down/up stream (the path `KeyboardAdapter.viewportTool` already bridges) and into `isHeld()`, with a provenance bit; one internal virtual-key hook in `rig/runtime`'s `Held`. The curve controllers get no setter: the touch adapters merge the flags into the `ToolPointerEvent`s they build. | viewport | Halo | T1 |
| 4 | **Tolerances by pointer type**: `theme.ts` PICK (including `cycleRadiusPx`), `ComponentPicker`, manipulator and extrude handle geometry, `MARKER_PICK_PX` (`viewport/src/tools/rig/quickRig/rules.ts`), the curve painters' theme, `DRAG_THRESHOLD_PX`, `DOUBLE_CLICK_MS` / `DOUBLE_CLICK_PX` (model select runtime), multi-tap windows. Manipulators scale by pointer type at render time with hysteresis, never through `tools.manipulatorSize`. Mouse values stay as today. | viewport, mesh-view, curve-editor | every shell on touch | T1 |
| 5 | **`ToolPointerEvent` additive fields**: `pressure`, `tiltX` / `tiltY`, `altitude`, `azimuth`, `pointerId`, `isPrimary`, `coalesced[]`, `virtual`. | editor-core `types.ts` (owned by T2; T1 sends line patches) | paint tools | T2 |
| 6 | **Halo-only forms.** `editor-core/src/forms/**`, exported as `@ekza-studio/editor-core/forms` and imported only by Halo: a `FormDef` per operator (ParamDefs, plus the session values it reads), typed against `OperatorMap` with `satisfies`. Pro, `LastRun` and the MCP schema generator never read it, so no operator becomes repeatable or adjustable and Pro's behaviour does not depend on load order. `tooling/param-lint.mjs` checks §20.5 test 9. There is no `addParams`. Making an operator adjustable in Pro is a separate change per operator, with tests and an owner decision (OQ-15). | editor-core, tooling | Echo chips, forms, Options | T5a |
| 7 | **Public wrappers for AI-only operators.** In a lazy chunk registered for every shell: `pose.hold` (→ `pose.transfer`), `pose.pasteAt` (→ `pose.setAt`), `pose.placeGoal`, `pose.lookAt` and `pose.reach` (→ `pose.goals`), `clip.loop` (→ `clip.makeLoop`), `key.scaleValues` / `key.offsetValues` (→ `key.adjust`), `key.offsetInLoop` (→ `key.retime {wrap}`), `imagePlane.replace` (delete then import, one step). Each has an undo label, argument validation and a form. **Agent policy: denied** by default, so the MCP toolset (`1.0.0-mvp.1`) and the generated agent reference do not change; agents keep `pose.setAt`, `pose.goals` and the rest. Final names are fixed in T5a. | editor-core, agent-tools policy | Halo, Pro search | T5a |
| 8 | **Curve-editor touch adapters**: `curve-editor/src/adapters/{dopesheet,graph}.ts`. React-free glue: arbiter → controller pointer events (merging the Thumb flags); two-finger pan / pinch → `setView` / `panView` / `zoomView`; view state persisted through a callback. Pro's `GraphCanvas` and `DopeSheetView` are untouched. | curve-editor | Halo | T7 (dopesheet), T10 (graph) |
| 9 | **`@ekza-studio/editor/models`**, a subpath that re-exports the React-free view models: outliner (`model`, `modelTree`, `sceneSelection`), channel box (`readout`, `states`, `nudge`, `kit/kernel`), graph `model`, clips `settings`, palette `model`, toolkit `slider`, the VRM Meta dialog model. Not `timeline/state.ts` or `placement.ts`, which are React hooks. Measured against `/editor` after each; the T1a spike decides between re-export and a React-free package (§20.6). | editor | Halo | T5c |
| 10 | **Auto-Rig's orchestration and progress into `editor-core`.** `editor-core/src/autorigFlow`: intake routing and the first-fix order (stand up → scale → freeze → centre → face), the `runAutoRig` argument rules (straighten from the recorded start pose, rigid parts, the rebind confirm, busy and progress), the motion-test driver, and export target naming (from `autorig/src/steps/{model,rig,motion,export}`). `autorig/src/progress` moves to `editor-core/src/progress`. Auto-Rig re-imports both (AS-ST-15). | editor-core, autorig | Halo readiness, recipes, Auto-Rig | T5b (flow), T5c (progress) |
| 11 | **Route unions and navigation** (§20.4): `ShellRoute` + `'halo'`; `NavigationRequest.from`, `then?`; `HandoffInfo.halo`; `MountedShell.kind`. `routeHref` maps every route explicitly (today any non-`studio` route goes to `/autorig`). `handoff.ts`, test-api params, `DialogHost`, the `EditorShell` first-run suppression, the entry-choice unions, `entry-contract.test`. A host-level `shell.navigate` operator, agent-denied; `autorig.navigate` stays with its agent schema unchanged. | editor-core, editor, apps/web | all shells | T2 |
| 12 | **Host re-homing** of shell-neutral registrations that only Pro makes today: the marking-menu definitions; rig menu items and `rig.snap.projectedCenter` / `rig.jointSize.set`; the data parts of `registerModelSelectUi` / `registerModelTransformUi`; agent UI hooks; `view.selectionMask`, `view.toggleFullscreen`. `promptRecovery` moves to the host with a hook each shell provides (Pro: its Recovery dialog; Halo: Home › Continue; Auto-Rig: as today). `watchRigViewOnly` stays Pro-only. They become idempotent, lazy, host-level registrations. | editor | Halo, Auto-Rig | T3 |
| 13 | **Key scope from `lastPanel`** for non-mouse pointers (`createHost.ts:233`, `useWindowInput.ts`). | editor host | every shell | T2 |
| 14 | **UI touch kit**: `[data-density=touch]` tokens (rows and hits 44, input text 16); primitives Sheet, Segmented, ScrubChip, Numpad, LongPress, Loupe (chips) and a generic radial arc in `@ekza-studio/ui/touch` (so `/editor` pays nothing); the shell `touch-action` / `overscroll-behavior` policy class; `uiScale` actually read. | ui | Halo, Auto-Rig later | T4 |
| 15 | **Platform services**: `FileService.save() → SaveTicket` and a host-level `SavePrompt` (§20.4); `sniffFileKind(bytes)`; a `storage.persist()` request; `host/memoryProfile.ts`, read by `StudioHost` before `GLHost` mounts, on every route (DPR cap, `antialias`); the texture cap at GPU upload (`viewport/src/gl/textureCap.ts`, new); the web manifest scoped to `/app`. | editor, viewport, apps/web | every shell on iPad | T0 |
| 16 | **Effective-preferences layer**: `app.prefs.override('device' \| 'shell', patch) → Disposer`; `get()` returns base ⊕ device ⊕ shell; persistence writes only the base. The mesh kernel reads its undo and journal budgets through it (`mesh/impl.ts:556–560`). | editor-core prefs | the memory profile, Halo's Rec | T0 |
| 17 | **Display overlay**: `ViewportManager.setDisplayOverlay(paneId, overlay) → Disposer`, merged at render time, never written to pane memory or the `PaneDisplayPort`; it can set the x-ray opacity (today the constant `XRAY_OPACITY = 0.5`). | viewport | Halo stage lighting | T1 |
| 18 | **Curve-editor sharing**: the focus registry (`attachGraphEditor` / `focusGraphEditor`) moves from `editor/src/panels/graph/focus.ts` into `curve-editor/src/focus.ts` (Pro re-imports it); the timeline contributions (`time.selectBand`, `timeline.context.*`) take a *focused band source* that Pro's `TimeSliderController` and Halo's Thread each provide. | curve-editor, editor | Halo, Pro unchanged | T7 (band source), T10 (focus) |
| 19 | **Prefs descriptor table**: label, unit, range and section for every `Prefs` key, with a test that every key has one; Settings › Advanced is generated from it. | editor-core prefs | Halo Settings, Pro later | T6b |
| 20 | **Tool-modifier rows**: `keymap/toolModifiers.ts` gains the rows it lacks (joint D, skin B/M/N/I, Quick Rig X, Graph Shift axis, time-slider Shift band and Mod copy); the conformance test covers every `TOOL_HOLD_CODES` entry. | editor-core keymap | modifierMap tests, docs | T1 (first day) |

### 20.4 Contracts (sketch; normative after T1a and T2)

```ts
// editor-core (additive) — owned by T2
export type ShellRoute = 'studio' | 'autorig' | 'halo' | 'chooser';
export type ArrivalAction =
  | { readonly kind: 'preset'; readonly preset: string }      // e.g. 'polish' (Pro)
  | { readonly kind: 'panel'; readonly panel: string }        // e.g. 'validation', 'paintWeights' (Pro)
  | { readonly kind: 'dialog'; readonly dialog: string };     // e.g. 'export'
export interface NavigationRequest {
  readonly to: ShellRoute; readonly from?: Exclude<ShellRoute, 'chooser'>;
  readonly workspace?: WorkspaceId; readonly subject?: AutoRigSubject; readonly newTab?: boolean;
  readonly then?: ArrivalAction;                              // optional; ignored by shells that do not know it
}
export interface HaloHandoffState {
  readonly stage: 'make' | 'paint' | 'rig' | 'animate';
  readonly sheet?: string; readonly threadLayer?: 0 | 1 | 2; readonly destination?: string;
  readonly fingers?: 'mittens' | 'thumb' | 'all';             // read by Auto-Rig ① when entered from Halo
}
// HandoffInfo gains `halo?: HaloHandoffState`; MountedShell.kind becomes Exclude<ShellRoute, 'chooser'>.

// ToolPointerEvent (additive; absent = today's behaviour)
//   pressure?, tiltX?, tiltY?, altitude?, azimuth?, pointerId?, isPrimary?,
//   coalesced?: readonly { x: number; y: number; pressure: number; t: number }[], virtual?: boolean

// viewport (additive) — spiked in T1a, built in T1
interface ViewportManager {
  navigate(paneId: string, gesture: 'orbit' | 'pan' | 'dolly', dx: number, dy: number): void;
  setModifierSource(source: ModifierSource | null): Disposer;
  setPointerArbiter(config: ArbiterConfig | null): Disposer;  // a stage inside pointerDown/Move/Up, not a DOM wrapper
  setDisplayOverlay(paneId: string, overlay: DisplayOverlay | null): Disposer;
}
interface VirtualModifiers {
  readonly shift: boolean; readonly mod: boolean; readonly alt: boolean;
  readonly held: ReadonlySet<'KeyX' | 'KeyV' | 'KeyJ' | 'KeyD' | 'KeyB' | 'KeyM' | 'KeyN' | 'KeyI'>;
  readonly button?: 0 | 1 | 2;                                // 1 stands in for the middle button
}
interface ModifierSource { get(): VirtualModifiers; subscribe(onChange: () => void): Disposer }
interface ArbiterConfig {
  readonly buffered: readonly ('touch' | 'pen')[];            // mouse stays eager, as in Pro
  readonly slopPx: { readonly touch: number; readonly pen: number };
  readonly longPressMs: number;                               // 450
  readonly multiTapMs: { readonly touch: number; readonly pen: number };
  routing(): 'shared' | 'pencilEdits' | 'pencilOnly';
  claims(paneId: string, hit: PickCandidate | null, type: 'touch' | 'pen'): 'tool' | 'navigate';
  onTap(tap: ArbiterTap): 'select' | 'consumed';              // 'select': delivered to the select tool as a click
  onDoubleTap(tap: ArbiterTap): void;                         // frames; the second tap never reaches the tool
  onLongPress(tap: ArbiterTap): void;                         // the Halo ring; the tool never saw the press
  onTwoFingerTap(paneId: string): void;                       // undo
}
type DisplayOverlay = Partial<DisplayFlags> & { readonly xrayOpacity?: number; readonly shading?: ShadingMode };

// editor services (additive) — T0
interface SaveTicket {
  readonly fileName: string; readonly mime: string;
  readonly state: 'preparing' | 'ready' | 'delivered' | 'failed';
  readonly ready: Promise<void>;
  deliver(): Promise<'shared' | 'downloaded' | 'cancelled'>; // call from a fresh user activation on iOS
}
interface FileService {
  save(file: { name: string; mime: string; bytes: Uint8Array | Promise<Uint8Array> }): SaveTicket;
  download(name: string, bytes: Uint8Array, mime: string): void; // kept: save(file).deliver() where no activation is needed
}

// editor-core prefs (additive) — T0
interface PrefsStore {
  get(): Prefs;                                               // effective: base ⊕ device ⊕ shell
  override(layer: 'device' | 'shell', patch: Partial<Prefs>): Disposer;
}

// @ekza-studio/editor-core/forms (Halo-only) — T5a
export interface FormDef<K extends OperatorId> {
  readonly id: K; readonly params: readonly ParamDef[];
  readonly fromSession?: readonly ('time' | 'target')[];      // shown read-only in the form
}

// entry (apps/web + editor dialogs) — T2
export type EntryChoice = 'autorig' | 'studio' | 'halo';
export const ENTRY_ROUTES = { autorig: '/autorig', studio: '/editor', halo: '/app' } as const;
```

**Arbiter semantics (normative after T1a):**
- It is the first step of `ViewportManager.pointerDown` for buffered pointer types, before the navigation override,
  profile gestures, the marking menu, the pointer layer and the tool. Pro installs no arbiter, so Pro is unchanged.
- The pane is the one whose element contains the event target (`elementFromPoint` at the down point, honouring
  stacking). Pointers whose target is chrome never enter it (§5.3 C6).
- The manager captures the pointer on the real `pointerdown` and holds that event and the following moves, with their
  `getCoalescedEvents()`.
- Travel beyond the slop: the original down and the held moves are replayed into the normal pipeline in order, with
  `coalesced` filled, so the tool sees every Pencil sample. Still at 450 ms: `onLongPress`, nothing is delivered. Up
  before the slop: a tap (delivered to the select tool as a click, or consumed) or the second tap of a double-tap.
- A second pointer that starts in the same pane while the first is held makes a two-finger gesture; the first pointer
  is never delivered.
- `claims()` implements the Shared-mode rule of §5.1 (selected thing, handle or brush → tool; else navigate) and the
  brush delay.

### 20.5 Parity CI: the Disclosure Manifest

`halo/src/manifest/disclosure.ts` maps every operator id to one entry, or to several entries split by argument:

```ts
type Disclosure =
  | { surfaces: SurfaceRef[]; nouns?: NounKind[]; stages?: Stage[]; depth: 0 | 1 | 2; plain?: string; when?: ArgPredicate }
  | { proOnly: 'PRO_CHROME' | 'KEYMAP' | 'MULTI_EDITOR'; reason: string; when?: ArgPredicate }
  | { plumbing: string }               // internal operators only, from PLUMBING_ALLOWLIST, with a reason
  | { searchOnly: string }             // reason; ratcheted by searchOnly.baseline.json
  | { wraps: OperatorId };             // an internal op reached through a public wrapper (§20.3 item 7)
type ManifestEntry = Disclosure | readonly Disclosure[]; // several entries need disjoint `when` predicates
```

A generator (`pnpm --filter @ekza-studio/halo manifest:draft`) proposes entries from the registry: category → stage,
`flags.selection` and the operator's workspaces → nouns, menu placement → depth, the call-site scan → argument
predicates. People then curate them; the registry itself is unchanged.

**The tests run in a browser** (`ha-parity`, Playwright through the test API): the host is mounted, then Halo, then Pro,
then Auto-Rig, every lazy chunk is loaded, and the operator lists of all mounts are joined. A headless run would miss
about 70 ids that exist only while UI is mounted (viewport contributions such as `view.frame` and `view.layout`, the
curve-editor focus contributions, Pro's shell operators, the host's `prefs.set`, `ui.open` and `ui.close`).

1. **Every live operator except deferred stubs — internal ones included — has an entry**, and every entry names a live
   operator. Internal operators may use `{plumbing}` only from `PLUMBING_ALLOWLIST` (`model.animateOnly`,
   `rig.animateOnly`, `ui.close`, `ui.markingMenu`, `halo.proOnlyKey`, the agent bookkeeping operators), each with a
   reason. The internal operators that Pro's panels reach — `clip.delete` / `duplicate` / `rename` / `setActive` /
   `setSettings`, `channel.setValues`, `graph.keys.move` / `scale` / `setFields`, `graph.key.insert`,
   `palette.setSwatch` / `rename` / `setActive`, `imagePlane.set`, `mesh.setAttributes`, `mesh.primitive.set`,
   `mesh.paint.remap`, `library.preview` / `useClip`, `rig.setRotateOrder` / `setControlSize` / `validation.profile`,
   `rig.jointSize.set`, `rig.snap.projectedCenter`, `view.camera.setSettings`, `skel.joint.move` / `rotateRest`,
   `skel.quickRig.setMarker` / `pick` / `setPreset`, `skin.influence.*`, `skin.paint.set` / `mode` / `sample`,
   `skin.weights.paint`, `time.setFrame` / `setPlaybackRange`, `select.channels` / `keys` / `controls`, `prefs.set`,
   `ui.open` and the agent operators — need real surfaces.
2. **The call-site scan.** A static scan of the `runOperator`, `runFromUi`, `run(` and `op:` call sites in
   `packages/editor/src/{panels,overlays,shell,dialogs}` and `packages/autorig/src` lists every (operator, argument
   shape) pair that Pro or Auto-Rig sends. Each pair needs a matching entry.
3. Every `UiDialog` value has a Halo handler (§6.7) or is listed as deferred.
4. Every `app.menus` item with arguments has an entry for that argument value.
5. No entry counts search as its surface. The `searchOnly` count is at most the baseline (target at GA: only developer
   items such as `file.saveJson`), and the baseline can only go down. Each stage WP has an exit target on the count.
6. `proOnly` entries come only from the listed reasons. `PRO_CHROME` = the `workspace.*` dock / preset / chrome
   operators, the panel arguments of `view.toggleMaximize`, and the Pro-only arguments of `ui.open` and
   `workspace.showPanel`.
7. Every `SurfaceRef` resolves: the verb-table op exists; a stage tray op lists that stage's workspace in `workspaces`
   (or has none); a sheet binding exists.
8. Every operator with a `tool`, or a continuous interaction type, has a hands-on binding: a tray tool, or a petal that
   activates the tool.
9. `param-lint`: every operator surfaced with after-run chips is `adjustable`; every operator surfaced with a form has
   a `FormDef` that type-checks; every operator with a Pro option box has an Options surface.
10. Search lists every operator that has an entry, in every stage.

§15 is the committed inventory; T6b adds the FEATURES.md row id to each row. The PR template gains the checkbox *"Ekza
Studio path (manifest entry) added or not needed"*.

### 20.6 Lazy loading and the bundle gate

- **Initial (eager) in `/app`**: the shared host floor, plus Frame, top bar and Path, HaloPane, arbiter config, Halo
  bar and ring core, Thumb key, Echo chip core, the Thread's layer 0, Home and the English strings.
- **Lazy**: each stage's tray and verb overrides, the manifest and More sheet, every sheet, Keys and Curves
  (curve-editor), the band models, recipes, Share (export bodies), Ask (Agent panel body), the numpad, the Settings
  generator and the forms. **All of Halo's small lazy chunks are prefetched at idle after boot and again on `online`**,
  so a long-lived iPad tab does not meet a chunk-load error on its first tap after a redeploy; the host shows one
  banner if a chunk still fails (S23).
- Kernel chunks (rig workspace, model operators, mesh kernel, clip library, skin worker) already load on
  `workspace.set`, `app.rig.load()` and `app.library.load()`.
- **`check-size`** (`apps/web/scripts/check-size.mjs`, `lib/route-scripts.mjs`):
  - `ROUTES` += `'app'`;
  - `ROUTE_LIMITS.app = {gate: 700_000, target: 660_000, firstVisit: []}` (ST-19, OQ-3);
  - `ROUTE_BOUNDARIES.app` bans `dv-dockview`, `ekza-studio-shell`, `ekza-autorig-shell` and the curve-editor markers
    from the initial set;
  - `ekza-halo-shell` is banned from `editor` and `autorig`;
  - `ROUTE_INITIAL_MARKERS.app = ['ekza-studio-host', 'ekza-halo-shell']`;
  - `size-baseline.json` `routes.app` is an unenforced placeholder at T2 and enforced at T12 (the Auto-Rig D0→D7
    pattern);
  - `apps/web/test/halo-size.test.ts` is modelled on `ar-size.test.ts`, and the route is added to `budgets.bench.ts`.
- **`/editor` and `/autorig` gain 0 B from the route.** The shared extractions and Pro's lazy *Simple layout* items are
  measured after every merge and recorded in one re-baseline row (**ST-B1**, AR-B1 pattern).
- **ST-B1 is measured before it is frozen.** AR-D3-1 showed that a second importer of a module that `/editor` loads
  eagerly costs `/editor` bytes, because Turbopack stops scope-hoisting it into one group (`PaneView`: +1,444 B). The
  models subpath re-exports several such modules. So the T1a spike measures an empty HaloShell + the models subpath +
  the arbiter hook + Pro's switch items against `/editor` first, and the allowance is then set **per package** (T1
  viewport, T2 routes and strings, T3 host re-homing, T5c models, the Pro switch items), as AR-B1 did. Today's
  headroom is 6,804 B on `/editor` (890,932 B measured; limit 897,736 B) and 8,144 B on `/autorig`. If the spike needs
  more than 2,048 B in total, the owner chooses (OQ-3): a larger allowance, or moving those view models into a
  React-free package that `/editor` also imports, measured again.
- Halo never imports `PaneView`, `GraphCanvas`, `TimeSliderView`, `DopeSheetView`, `timeline/state.ts`,
  `timeline/placement.ts` or other modules that `/editor` loads eagerly, except through the measured subpaths.

### 20.7 Test strategy

**Unit** (Vitest, Node):
- arbiter state machines over recorded pointer streams: tap, double-tap (the second tap absorbed), long-press against
  drag, two-finger tap against pinch, two fingers resting, quick pinch, pen plus palm, chrome pointers excluded by DOM
  target, `gesturechange` during a touch pinch, the brush delay and its rollback;
- `modifierMap` rows driven through the real tools on fixture apps (not against prose);
- nouns and verbs on fixture apps (Polybot, Seed-san, Cube Lad), with poll filtering;
- manifest lints, the vocabulary lint (one word, one kind) and the dialog map (every `UiDialog`);
- readiness (one list; the status pill's count equals Share's);
- channel labels: every chip value equals the Channel Box readout (AS-ST-19);
- sniffing; `SaveTicket` on the iOS and non-iOS paths, with the fallback timer;
- route unions and `routeHref`; the entry contract;
- the memory profile and the preference override layer;
- `watchRigViewOnly`: Halo mounted at 834 pt edits after a round trip to Pro.

**Headless integration** (`headless-tests`):
- the operator sequences Halo emits for J1, J2, J3, J5, J6 and J7 produce exports byte-equal to Pro's and Auto-Rig's
  for the same steps, **and** the operator log of Halo J1 equals Auto-Rig ①–⑤'s for the same model (AS-ST-5);
- export bytes are identical with the memory profile on and off;
- pressure strokes replay deterministically (AS-ST-16).

**e2e** (Playwright, family `ha-`):

| Project | What |
|---|---|
| `chrome` | Desktop mouse and keyboard; the Halo on right-click or hold; flicks |
| `chrome-touch` (new) | `hasTouch`, 1194 × 834 and 834 × 1194; multi-touch through CDP `Input.dispatchTouchEvent`; the Pencil through CDP with `pointerType: 'pen'`, `force`, `tiltX` / `tiltY`; one phone smoke spec at 390 × 844 (best-effort, not gating) |
| `webkit-ipad` (new) | **Compatibility only**: Playwright's desktop WebKit with `devices['iPad Pro 11']` and its landscape variant boots `/app`, `/editor` and `/autorig`, renders, and runs ha-00, ha-01, ha-05 and ha-12 with single touches through `page.touchscreen`. It proves nothing about iOS gestures, Web Share, Files, memory or the Pencil. |

To keep the local gate (CI is off for this repository) affordable, `chrome-touch` and `webkit-ipad` run only the `ha-*`
and `ar-*` families.

Specs:
- ha-00 platform;
- ha-01 home and intake (T11);
- ha-02 Halo grammar;
- ha-03 Thumb key and selection (selection undo per workspace; with the key held, tapping a second control selects
  two);
- ha-04 Echo chips, forms and the session bar (leaving commits);
- ha-05 Path, readiness and the visible-target budget;
- ha-06 Thread and Keys;
- ha-07 Curves;
- ha-08 Make;
- ha-09 Paint;
- ha-10 Rig and Skin (strokes survive a stage switch);
- ha-11 Share (an export never clears the unsaved dot);
- ha-12 the round trip to Pro (pane display memory identical; Pro zooms and scrolls as before; strokes survive);
- ha-13 gestures off;
- ha-14 portrait Rig editing (T9);
- ha-15 axe and layout: no floater intersects the selection's on-screen box; every surface's ⋯ and primary actions
  are inside the viewport at 1194, 834 and 390 pt;
- ha-J1–J10 journeys from fresh projects with the real defaults, plus finger-only ha-J4f and ha-J6f, with touch counts
  from the test API's touch counter. The counts guard against regressions; whether a journey is minimal is judged in
  design review, not by the counter.

A marker-free test-API slice `provideHaloTestState` (like `test-api/autorig.ts`) exposes the stage, open sheet, Halo
noun and petals, Thread layer, Thumb state, visible-target count and touch counter.

**Size**: `check-size` and `halo-size.test.ts`; the budgets bench.

**Real devices — a hard part of the release gate.** Each release, with a named owner who is decided before T6a starts
(OQ-13); evidence in `docs/evidence/halo/`:
- iPad (A16);
- iPad Air (M-series);
- iPad Pro M4 / M5 with Pencil Pro and a Magic Keyboard;
- Safari 26 on macOS;
- iPhone 15 / 16 (smoke only, best-effort).

They run AS-ST-1, AS-ST-11, AS-ST-12, AS-ST-13 and the D-list:
- D1 `pointerleave` after a lift and the key scope;
- D2 the Files picker with sniffing;
- D3 trackpad secondary click;
- D4 trackpad pinch delivery;
- D5 the Pencil move rate and coalesced samples;
- D6 Pointer Lock with a trackpad;
- D7 MSAA / DPR memory;
- D8 the jetsam limit on 8 / 12 / 16 GB iPads;
- D9 drop from the Files app;
- D10 that 3- and 4-finger taps never reach Halo;
- D11 Web Share to Files for `.glb`, `.vrm`, `.vrma`, `.ekzanim` and `.zip` (`canShare`, `share()` resolution, the
  fallback);
- D12 the `storage.persist()` result;
- D13 Home Screen storage separation, and *Open in a new tab* hidden in standalone mode;
- D14 touch contact size (`width` / `height`) for palm rejection;
- D15 a Pencil stroke started 5 mm from the top bar never becomes text;
- D16 a long-press raises no `pointercancel` and no callout;
- D17 `GestureEvent`s during a touchscreen pinch.

---

## 21. Build plan

Sizes: **S** ≤ 2, **M** 3–5, **L** 6–8, **L+** 9–10 agent-days. v0.1 planned 71 agent-days with a 32-day critical path;
the review found missing work (the input spike, the orchestration move, the file, preference and display services)
and overloaded packages. v0.2 re-plans at about **100 agent-days**.

- **Branches**: `halo/tN-<name>` from `dev`. Package PRs go into the integration branch `halo/int`, which merges into
  `dev` at T12 (the gitflow of 2026-10-12). T1a is a spike branch that is not merged; its findings land in T1.
- **Shared-file rule** (as in AUTORIG-SPEC §10.0): every file has one owning WP. Any other WP sends a line patch through
  the integration agent, who owns T2 and T12. `editor-core/src/types.ts` has a single owner, T2.
- **Measurement**: `/editor` and `/autorig` are measured after every merge into `halo/int`.
- **Each stage WP has an exit target on the `searchOnly` count**, recorded in `searchOnly.baseline.json`.

| WP | Name | Size | Depends on | Owns (files) | Exit test |
|---|---|---|---|---|---|
| **T0** | Platform: WebKit compatibility and iOS services | M (5) | — | `apps/web/playwright.config.ts` (`chrome-touch`, `webkit-ipad`); `apps/web/e2e/ha-00-*.spec.ts`; `apps/web/public/manifest.webmanifest` + icons; `editor/src/services/{files.ts, fileTypes.ts (new), saveTicket.ts (new), autosave.ts}`; `editor/src/host/{memoryProfile.ts, SavePrompt.tsx}` (new); `editor/src/gl/GLHost.tsx`; `viewport/src/gl/textureCap.ts` (new); `editor-core/src/prefs/{persist.ts, overrides.ts (new)}`; the `accept` policy through one helper used by `OpenDialog.tsx` and Auto-Rig's `ModelStep`, `MenuBody` and `AnimationsStep` (one-line edits) | `/editor` and `/autorig` boot and render on `webkit-ipad`; unit tests for `SaveTicket`, sniffing, the memory profile and the override layer; export bytes identical with the profile on and off |
| **T1a** | Input spike | S (2) | — | a spike branch only: the arbiter stage inside `ViewportManager`, an empty HaloShell stub, the models re-exports, Pro's switch items | `docs/wp-notes/halo-t1a.md`: the measured `/editor` delta, the full Pro e2e suite run against the spike, the §20.4 arbiter contract confirmed or amended, and a proposed ST-B1 allowance per package |
| **T1** | Input foundation | L+ (10) | T1a | `viewport/src/navigation/**` (+ `touch/`), `viewport/src/input/arbiter.ts` (new), `viewport/src/manager/ViewportManager.ts`, `viewport/src/theme.ts`, `viewport/src/manipulators/**/geometry.ts`, `viewport/src/tools/rig/quickRig/rules.ts` (`MARKER_PICK_PX` only), `viewport/src/tools/model/select/runtime.ts` (double-click constants), `viewport/src/rig/runtime.ts` (the `Held` hook), `mesh-view/src/ComponentPicker.ts`, curve-editor controllers' tolerances + `graph/gestures.ts` + `painters/theme.ts` + `dopesheet/layout.ts`, `editor-core/src/keymap/toolModifiers.ts` (rows), `autorig/src/nav/**` (re-export shim), `autorig/src/shell/controller.ts` (one import), `apps/web/e2e/helpers/touch.ts` (ported from `ar-as-12`) | Arbiter suite green; display overlay and virtual-modifier unit tests; Auto-Rig `ar-*` e2e green on Chromium, and booting on WebKit; Pro e2e green; `/editor` delta recorded in ST-B1 |
| **T2** | Shell contracts and route | M (5) | — | `editor-core/src/types.ts` (all lines), `operators/args.ts`, `builtin/rig/wizard/navigate.ts`, `builtin/shellNavigate.ts` (new); `editor/src/host/{navigation,handoff,types,createHost}.ts`, `shell/useWindowInput.ts`; `editor/src/test-api/{params,createTestApi,types,halo}.ts`; `editor/src/dialogs/{DialogHost,entryChoice,FirstRunDialog,PreferencesDialog}`; `editor/src/shell/EditorShell.tsx` (`from=halo`); `apps/web/app/{entry.ts,EntryChooser.tsx,page.tsx}` (the new default behind `HALO_ENTRY = false`), `apps/web/test/entry-contract.test.ts`; `apps/web/app/(studio)/app/**` (with its layout and viewport export); `apps/web/scripts/{check-size.mjs,lib/route-scripts.mjs,size-baseline.json}`, `apps/web/test/halo-size.test.ts`; `tooling/check-deps.mjs`, `.oxlintrc.json`, `apps/web/{next.config.ts,package.json,tsconfig.json}`, root `tsconfig.json`; `packages/halo/{package.json,tsconfig.json,src/index.ts}` | An empty `HaloShell` mounts at `/app` (`chrome`, `webkit-ipad`); Halo → Pro → Halo keeps the undo history (ha-12 skeleton); entry contract green; `/app` measured (unenforced) |
| **T3** | Host re-homing and the Pro switch | M (4) | T2 | `editor/src/overlays/menus/**` (registration seams), `shell/menus/rig.ts`, `shell/rig/operators.ts` (not `register.ts`'s `watchRigViewOnly`), `panels/viewport/hud/index.tsx` + `ModalReadout.tsx` (registration seams), `shell/autosave.ts`, the recovery hook, `shell/StatusLine.tsx` (agent pill hook, *Simple layout* button), `shell/operators.ts`, `editor/src/host/registrations/**` (new), `shell/menuItems.ts` + `shell/haloSwitch.ts` (new), the "Ekza Studio Pro" title behind a flag | Registrations present with Pro unmounted (unit); `watchRigViewOnly` still Pro-only (unit); all Pro e2e green; `/editor` within ST-B1 |
| **T4** | UI touch kit | M (4) | — | `packages/ui/{tokens.json, css/tokens.css, styles.css, package.json}`, `packages/ui/src/touch/**` (new), `apps/web/app/dev/touch/**` (primitive gallery) | Primitive unit tests; axe green on the gallery; 44 pt / 16 px tokens; `/editor` +0 B |
| **T5a** | Forms, lint and wrappers | L (7) | — | `editor-core/src/forms/**` (new) + the `./forms` export; `editor-core/src/operators/builtin/uiWrappers.ts` (new, lazy) + its registration; agent-tools policy rows (denied); `tooling/param-lint.mjs` | `param-lint` green; wrapper tests (undo labels, validation, agent policy) headless; the generated agent reference unchanged; `/editor` +0 B |
| **T5b** | Auto-Rig orchestration into editor-core | M–L (6) | — | `editor-core/src/autorigFlow/**` (new); `autorig/src/steps/{model,rig,motion,export}/**` (re-import seams only) | AS-ST-15 (`ar-*` e2e green); the headless operator log of Auto-Rig ①–⑤ recorded for Polybot and Cube Lad |
| **T5c** | Models subpath and progress move | S (2) | — | `editor/src/models.ts` + the `./models`, `./overlays`, `./toolkit`, `./agent` exports; `editor-core/src/progress/**` (moved) + `autorig/src/progress/**` (re-export) | `/editor` within the T5c ST-B1 allowance; Auto-Rig e2e green |
| **T6a** | Halo input grammar | L (7) | T1, T2, T3, T4 | `packages/halo/src/{shell,canvas,input,halo,chips,session,dialogs,palette,i18n}/**`, `home/` (stub), their tests; e2e ha-02, ha-03, ha-04, ha-13 | Grammar e2e green on `chrome-touch`, booting on `webkit-ipad`; the visible-target counter in the test API |
| **T6b** | Manifest, parity and sheets | L (7) | T2, T5a (mounts into T6a's frame at integration) | `packages/halo/src/{manifest,verbs,path}/**`, `sheets/{more,numbers,scene,view,settings,health,help,about}/**`; the prefs descriptor table (`editor-core/src/prefs/descriptors.ts`, new); `tooling/halo-callsites.mjs` (the call-site scan); `apps/web/e2e/ha-parity.spec.ts`; the FEATURES.md ids in §15; e2e ha-05, ha-15 | Browser parity in ratchet mode with its baseline; every `UiDialog` handled; per-stage `searchOnly` targets recorded |
| **T7** | Animate stage | L+ (10) | T6a, T6b, T5a, T5c | `halo/src/stages/animate/**`, `thread/{strip,band,keys}/**`, `sheets/library/**`, `curve-editor/src/adapters/dopesheet.ts`, the band-source seam in `curve-editor/src/timeline/contributions.ts`; e2e ha-06, ha-J3, ha-J5 | J3 ≤ 15 and J5 ≤ 6 touches; Reach is one undo step; Rec override removed on unmount (ha-12) |
| **T8** | Make and Paint stages | L (6) | T6a, T6b, T5a; the cap handle prototyped first | `halo/src/stages/{make,paint}/**`, `sheets/palette/**`; e2e ha-08, ha-09, ha-J2, ha-J6, ha-J6f | J2 ≤ 9; J6 ≤ 8 + strokes (≤ 10 finger-only) |
| **T9** | Rig and Skin stage | L+ (9) | T6a, T6b, T5a, T5b, T1 | `halo/src/stages/rig/**`, `sheets/{checks,bones,weights}/**`, `recipes/{rigIt,fixBend}.ts`; `viewport/src/tools/rig/paint/{tool,pick}.ts` (pressure, interpolated stamps) and the quick-rig marker tool's touch seams (after T1 merges); `autorig/src/shell/**` (*Back to Studio*, `from=halo` only); e2e ha-10, ha-14, ha-J1, ha-J7 | J1 ≤ 11 with the real defaults; J7 ≤ 7 + strokes; native *Adjust dots*; Halo's J1 operator log equals Auto-Rig's; portrait Rig editing; pressure determinism headless |
| **T10** | Curves and History | M (5) | T7 | `halo/src/thread/curves/**`, `curve-editor/src/adapters/graph.ts`, `curve-editor/src/focus.ts` (moved, with Pro's one-line re-import), `halo/src/sheets/history/**`; e2e ha-07, ha-J4, ha-J4f, ha-J8 (fake agent session) | J4 ≤ 10 finger-only; Revert this / Undo all on AI groups |
| **T11** | Share, Home, files | M (6) | T6a, T6b, T0, T5b | `halo/src/{home,intake}/**`, `sheets/share/**`, `recipes/{addAnimations,fixForOmoba,loopIt,wave}.ts`; e2e ha-01, ha-11, ha-J9, ha-J10 | Every destination byte-equal to the Pro / Auto-Rig export (AS-ST-5); the two-step save (mocked share on WebKit; device D11); an export never clears the unsaved dot |
| **T12** | Integration and release gate | M (5) | all | `halo/int`; DECISIONS-OPEN §O records (ST-B1, ST-INT-*); enforce `size-baseline.json` `routes.app`; `HALO_ENTRY = true` and the Pro title flag on; `FEATURES.md` (v0.6.0 + Halo), `ROADMAP.md`, `docs/agents.md` (iPad note); `docs/evidence/halo/`; the real-device run with its owner | Everything in §22 green, including the device gate |

**Total ≈ 100 agent-days.**

- **Critical path**: T1a (2) → T1 (10) → T6a (7) → T7 (10) → T10 (5) → T12 (5) ≈ **39 agent-days**.
- **In parallel from day 1**: T0, T2 → T3, T4, T5a → T6b, T5b and T5c.
- **In parallel after T6a**: T8, T9 and T11.
- **If the owner puts phones in the gate (OQ-11)**: add a Compact WP (M, 5: verb bar, tab-bar Path, full-height sheets,
  finger-offset painting, the weights tray row), a phone e2e project and an iPhone memory run.

**Phase exits:**
- **F** (T0–T5c, T1a): the spike report; Auto-Rig e2e green; Pro e2e green; `/editor` within ST-B1; an empty `/app`
  round-trips to Pro with the undo history kept.
- **S** (T6a, T6b): §5–§8 working on touch; browser parity in ratchet mode.
- **W** (T7–T11): every stage and every journey.
- **R** (T12): the release as "Ekza Studio", with a beta note in Help › About.

**After GA** (each item is its own spec delta; some are owner-gated):

| WP | Name | Size | Gate |
|---|---|---|---|
| T13 | Phrases (the offline matcher, the Nod / Breathe generators) | M (5) | — |
| T14 | Auto-Rig convergence: keep `/autorig` or fold it into Halo | M (4) | OQ-6 |
| T15 | Glue pins, Peek-hold previews, pose cards (explore) | M (5) | measure memory first |
| T16 | Perform (sampled writes, auto-simplify, 0.25× playback) | L (8) | a new kernel operator, ADR |
| T17 | AI on iPad | ? | OQ-5 |
| T18 | Undo history kept in autosave and in the project file | ? | OQ-8, ADR 0011 change |

---

## 22. Acceptance scenarios (the release gate)

| ID | Scenario | How verified |
|---|---|---|
| AS-ST-1 | `/app` boots on an iPad in Safari (landscape and portrait), loads a sample, plays, edits, exports and saves the project | device (hard gate); `webkit-ipad` ha-00, ha-01 for compatibility |
| AS-ST-2 | Parity: every live, non-stub operator (internal included) has a non-search Halo path, a reasoned `proOnly` or an allow-listed `plumbing` entry; every (operator, arguments) pair Pro or Auto-Rig sends is covered; `searchOnly` holds only developer items | `ha-parity` in a browser, the call-site scan, manifest lints |
| AS-ST-3 | Each of the 25 tasks of §2.1 can be done finger-only, with no keyboard, hover, right-click, middle-click or modifier, at most two taps deep from its noun | device checklist + `chrome-touch` e2e |
| AS-ST-4 | Touch counts from fresh projects with the real defaults: J1 ≤ 11, J2 ≤ 9, J3 ≤ 15, J4 ≤ 10 (finger-only), J5 ≤ 6, J6 ≤ 8 + strokes (≤ 10 finger-only), J7 ≤ 7 + strokes, J9 ≤ 2 on iPad (1 on desktop), J10 ≤ 1 | ha-J* with the test-API counter; device spot check |
| AS-ST-5 | Same document: Halo exports (VRM 1.0, GLB, VRMA, static GLB) are byte-equal to Pro's and Auto-Rig's for the same operator sequence, and Halo's J1 emits the same operator log as Auto-Rig ①–⑤ for the same model | headless-tests |
| AS-ST-6 | Halo → Pro → Halo keeps the undo history, selection, time and `pane-single` camera, and commits an open tool session; Pro arrives on the mapped workspace with `then` applied | ha-12 |
| AS-ST-7 | Rig & Skin, weight painting included, is editable at 744 pt and 834 pt widths, also after a round trip to Pro; Pro's view-only rule is unchanged | ha-14; unit; Pro e2e |
| AS-ST-8 | `/app` ≤ its gate; `/editor` and `/autorig` +0 B from the route; extractions within the per-package ST-B1 allowances | `check-size`, `halo-size.test.ts` |
| AS-ST-9 | With *Reduce gestures* on (no two-finger undo, quick pinch or flicks), every journey is still doable | ha-13 |
| AS-ST-10 | Pro is untouched: keymap, marking-menu definitions, pref defaults, stored prefs and the pane display memory identical before and after a Halo round trip; Halo's overrides are gone after it unmounts | snapshot unit test + ha-12 |
| AS-ST-11 | A 60k-triangle character, bound, with 3 animations, in a 30-minute session on an iPad Air (M-series) without a tab reload | device (D7, D8) |
| AS-ST-12 | Pencil pressure changes stamp strength; a fast stroke leaves no gap; palm touches during pen activity never select or orbit | CDP pen e2e; stamp interpolation unit test; arbiter unit test; device |
| AS-ST-13 | On iPad, *Export … to Files* and *Save project to Files* each take two taps; an export never clears the unsaved dot; `.vrm`, `.ekzanim` and `.vrma` open from Files through sniffing | device (D2, D11); unit tests for sniffing and `SaveTicket` |
| AS-ST-14 | Chrome passes axe (WCAG 2.2 AA rules); every target ≥ 44 pt; every input ≥ 16 px; VoiceOver reads the Halo, Path, Thread and Thumb key | ha-15; device VoiceOver pass |
| AS-ST-15 | Auto-Rig behaviour unchanged after the navigation extraction and the `autorigFlow` move | `ar-*`, `ar-as-12` e2e |
| AS-ST-16 | Weight-paint strokes with pressure replay identically headless and through MCP | headless-tests |
| AS-ST-17 | The visible-target budget of §4.8 holds in every stage (≤ 22 at rest, ≤ 36 with a Halo) | ha-05 |
| AS-ST-18 | No floating item intersects the selection's on-screen box; every surface's ⋯ and primary actions are inside the viewport at 1194, 834 and 390 pt | ha-15 |
| AS-ST-19 | Every chip value equals the Channel Box readout, sign included, for every control on Polybot and Seed-san | unit |
| AS-ST-20 | Every `UiDialog` value has a Halo handler or is listed as deferred | unit |
| AS-ST-21 | The real-device run (AS-ST-1, 11, 12, 13 and the D-list) is done by its named owner and its evidence is in `docs/evidence/halo/` | T12 checklist |

---

## 23. Defaults chosen

Every default is recorded with its impact and decide-by milestone in
[DECISIONS-OPEN §O](DECISIONS-OPEN.md#o-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24): ST-1…ST-40 and the
measurement row ST-B1 (filled in by T1a, T1–T3, T5c and T12). v0.2 changed ST-2, ST-6, ST-8, ST-9, ST-10, ST-13,
ST-16, ST-17, ST-20, ST-21, ST-22, ST-28 and ST-B1, and added ST-32…ST-40. The owner may override any of them.

## 24. Open owner questions

| ID | Question | Default until answered |
|---|---|---|
| OQ-1 | The final name, URL and internal id of the new shell (`/app`, `halo`) | `/app`, `halo`; "Ekza Studio" in the UI |
| OQ-2 | A first visit to `/` opens Ekza Studio: on every device, or only on touch devices (desktop first visits keep today's chooser)? | **Every device (changed in v0.2)**; a remembered choice always wins |
| OQ-3 | The `/app` size gate (700,000 B, target 660,000 B) and the ST-B1 allowance on `/editor` | As proposed; the allowance is set per package from the T1a measurement, and a total above 2,048 B comes back to you |
| OQ-4 | Rec in Ekza Studio: on by default as its own setting (applied as a removable override, Pro's Auto Key untouched), or ask once on the first unkeyed change? | **On by default (changed in v0.2)** |
| OQ-5 | AI on iPad: a `wss` relay with the pairing code, an in-app Assistant through an Ekza proxy (changes "nothing uploaded"), or desktop-only | Desktop-only, with an honest card |
| OQ-6 | Auto-Rig's future: keep `/autorig` as its own wizard, or fold it into Ekza Studio's *Rig it* and redirect (T14) | Keep both; Ekza Studio no longer hands off to it |
| OQ-7 | Browser support: amend NFR-03 so Ekza Studio supports Safari 26+; Pro on Safari stays best-effort? | Yes for Ekza Studio; Pro best-effort |
| OQ-8 | Keep the undo history across reloads and file opens (ADR 0011 change; matters more on iPad) | No; *"history starts here"* banners |
| OQ-9 | Russian UI strings and phrase synonyms: at GA or after? | English at GA; Russian after |
| OQ-10 | Home Screen web-app branding: app name, icon and theme colour | "Ekza Studio", the current icon |
| OQ-11 | Phone: best-effort and not in the release gate, or in the gate (+ a Compact WP of about 5 days, a phone e2e project and an iPhone memory run)? | **Best-effort, not gating (changed in v0.2)** |
| OQ-12 | A thin native iPad wrapper later (WKWebView + `UIPencilInteraction` for squeeze and double-tap)? | Not planned |
| OQ-13 | Who owns the real iPads, the Pencil Pro and the release-device run? **Needed before T6a starts.** | The owner's devices and the owner; evidence in `docs/evidence/halo/` |
| OQ-14 | Pre-select CC0 in Ekza Studio's Share (one touch fewer in J1), which reopens Q-SKIN-3? | No: an explicit choice, CC0 listed first |
| OQ-15 | Make some animation operators adjustable after the run in both shells (a Pro behaviour change, per operator, with tests)? | No: Ekza Studio uses pre-run forms; Pro unchanged |
| OQ-16 | Sign off the platform exceptions of §15.0 (AI not on iPad; the 200k-triangle iPad limit; Pro presentations not touch-ready) | As listed |

## 25. Sources

Repository:
- [ADR 0021](adr/0021-autorig-mode.md), [AUTORIG-SPEC](AUTORIG-SPEC.md) §3–§10, [MCP-SPEC](MCP-SPEC.md) §0.4;
- ADRs 0006, 0008, 0011, 0013, 0016, 0018;
- [FEATURES.md](FEATURES.md); [REQUIREMENTS](REQUIREMENTS.md) NFR-03;
- [DECISIONS-OPEN](DECISIONS-OPEN.md) §M (AR-B1, AR-V1, AR-D3-1) and §N.10 (M-AI-INT-11 sizes);
- code on `dev` @ `0512ba88`, at the paths quoted in §5–§21 (the v0.2 review read `prefs/defaults.ts`, `types.ts`
  (`UiDialog`, `PlaybackSpeed`), `operators/builtin/lastop.ts`, `rig/bind.ts`, `rig/restPose.ts`, `ViewportManager.ts`,
  `workspaces/ports.ts`, `viewport/src/theme.ts`, `GLHost.tsx`, `services/files.ts`, `doc/records.ts` and
  `keymap/toolModifiers.ts`, among others).

Platform:
- WebKit WWDC25 news: <https://webkit.org/?p=16993>
- WebKit bug 296943 (Pencil Pro twist and hover tilt): <https://bugs.webkit.org/show_bug.cgi?id=296943>
- Apple forums on Pencil Pro events: <https://developer.apple.com/forums/thread/760238>, <https://developer.apple.com/forums/thread/776468>
- MDN `altitudeAngle` / `azimuthAngle`: <https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/azimuthAngle>
- WebKit bug 213953 (no `contextmenu` on iOS): <https://bugs.webkit.org/show_bug.cgi?id=213953>
- WebKit storage policy: <https://webkit.org/?p=14403>
- `persist()` returning false: <https://bugs.webkit.org/show_bug.cgi?id=271401>
- `showSaveFilePicker` support: <https://caniuse.com/mdn-api_window_showsavefilepicker>
- `accept` with custom extensions: <https://bugs.webkit.org/show_bug.cgi?id=190982>
- https → localhost blocked: <https://bugs.webkit.org/show_bug.cgi?id=173161>
- Memory limits: <https://bugs.webkit.org/show_bug.cgi?id=219845>, <https://discourse.threejs.org/t/memory-limit-crash-on-ios-26/86978>
- 120 Hz flag: <https://bugs.webkit.org/show_bug.cgi?id=294338>
- `share()` not resolving after Save to Files: <https://bugs.webkit.org/show_bug.cgi?id=234187>
- No `beforeunload` prompt on iOS: <https://trac.webkit.org/r269983>
- Input auto-zoom: <https://weblog.west-wind.com/posts/2023/Apr/17/Preventing-iOS-Textbox-Auto-Zooming-and-ViewPort-Sizing>
- iOS 26 Home Screen web apps: <https://heise.de/-10749652>
- Alternative browser engines: <https://developer.apple.com/support/alternative-browser-engines>

Market and research:
- Nomad interface, history and tips: <https://nomadsculpt.com/manual/interface>, <https://nomadsculpt.com/manual/history>, <https://nomadsculpt.com/manual/tips>
- Procreate gestures and QuickMenu: <https://help.procreate.com/procreate/handbook/interface-gestures/gestures>, <https://help.procreate.com/procreate/handbook/interface-gestures/quickmenu>
- Procreate Dreams timeline and performing: <https://help.procreate.com/dreams/handbook/interface-and-gestures/timeline>, <https://help.procreate.com/dreams/handbook/1.0/keyframes-and-performing/performing>
- A Procreate Dreams review: <https://www.provideocoalition.com/review-procreate-dreams/>
- Shapr3D Adaptive UI, the UI refresh and the 5.300 discussion: <https://support.shapr3d.com/hc/en-us/articles/7644593398172>, <https://www.shapr3d.com/blog/refreshing-the-shapr3d-user-interface>, <https://discourse.shapr3d.com/t/5-300-maximize-your-efficiency-with-the-new-context-menus/23668?page=2>
- Feather 1.1: <https://www.cgchannel.com/?p=165635>
- Cascadeur Mobile: <https://www.cgchannel.com/2024/12/nekki-releases-cascadeur-mobile/>
- Blender, "Beyond mouse and keyboard": <https://code.blender.org/2025/07/beyond-mouse-keyboard/>
- Gravity Sketch iPad support changes: <https://help.gravitysketch.com/hc/en-us/articles/19076757067037-Changes-to-iPad-app-support>
- Figma UI3: <https://www.figma.com/blog/our-approach-to-designing-ui3/>
- Rive animate mode: <https://rive.app/docs/editor/animate-mode/animate-mode-overview>
- Hinckley, "Pen + Touch = New Tools": <https://www.microsoft.com/en-us/research/publication/pen-touch-new-tools/>
- Kurtenbach & Buxton on marking menus: <https://www.billbuxton.com/MMUserLearn.html>
- Apple HIG, Apple Pencil: <https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble>
- Dontcheva et al., layered acting: <https://history.siggraph.org/?p=115882>

---

## 26. Review record (v0.1 → v0.2)

Three critics reviewed v0.1 on 2026-10-24: **coverage** (24 issues), **feasibility** (22) and **UX** (29). The table
lists each issue in the order it was raised, with what v0.2 did. *Accepted* means the critic's fix, or an equivalent
one, is in the spec; *Partly* means part of the fix was taken and the rest was rejected for the reason given;
*Rejected* means no change, with the reason. Blockers: 5, all accepted. Majors: 43, of which 40 accepted and 3 partly
accepted. Minors: 27, of which 26 accepted and 1 partly accepted.

| # | Sev. | Critic | Issue | Resolution | Where |
|---|---|---|---|---|---|
| R1 | blocker | coverage | Parity CI skipped internal operators, so Pro panel capabilities could miss a Halo surface | **Accepted.** Every live non-stub operator, internal included, needs an entry; `plumbing` only from an allowlist; a static scan of Pro and Auto-Rig call sites covers every (operator, arguments) pair | §20.5 tests 1–2 |
| R2 | blocker | coverage | Kernel-raised dialogs (`UiDialog`) had no Halo surface | **Accepted.** A `UiDialog` → Halo table (inline confirm cards, About, Share, pickers, Help, Settings), a watcher, a test for every value, and Halo's own recovery hook | §6.7, §20.3 item 12, AS-ST-20 |
| R3 | major | coverage | `ModifierSource` could not carry held letter keys | **Accepted** (with R26): `{shift, mod, alt, held, button}`, merged into `ToolKeyEvent` and `isHeld()` | §5.5, §20.3 item 3, §20.4 |
| R4 | major | coverage | Thumb *Smooth* claimed a Shift-paint that does not exist; `toolModifiers.ts` lacked rows | **Accepted.** *Smooth* dropped (it is a brush mode); the missing rows are added on T1's first day | §5.5, §20.3 item 20 |
| R5 | major | coverage | C9 said selection is never an undo step; in Make and Rig it is | **Accepted.** C9 follows `undoSelection` per workspace; the toast names selection steps; History folds them; Reselect only in Animate | §5.3 C9, row 2.14, ha-03 |
| R6 | major | coverage | Licence "prefilled as CC0" contradicted Q-SKIN-3 | **Accepted.** An explicit choice, CC0 listed first and not selected; J1 is 11 touches; OQ-14 asks whether to reopen Q-SKIN-3 | §13.3, J1, AS-ST-4, OQ-14 |
| R7 | major | coverage | Rig dot editing handed off to Auto-Rig; *Create Skeleton* and marker layouts missing | **Accepted.** Dot editing is a native Halo session with Front · Side; *Skeleton only* runs `skel.quickRig.commit`; no Auto-Rig hand-off remains | §12.2, rows 1.6, 5.4, 5.6 |
| R8 | major | coverage | Echo chips used `edit.adjustLast`, which refuses non-adjustable operators | **Accepted.** After-run chips only for adjustable operators; pre-run forms for the rest; `param-lint` checks it | §5.6, §20.5 test 9 |
| R9 | major | coverage | The Inspector lacked transform, pivot, shape inputs, material, triangle target, character info and image-plane fields | **Accepted.** Numbers has all of them | §6.6, rows 3.1, 3.5, 3.21, 3.25 |
| R10 | major | coverage | VRM meta: 19 fields, only 4 in Share | **Accepted.** *About this character* renders every `CharacterVrmMeta` field; `ui.open {vrmMeta}` and the Validation fix open it | §6.8, row 11.7 |
| R11 | major | coverage | No per-platform view of "all functionality on iPad" | **Accepted**, as an exceptions table rather than a column on 191 rows (a row with no exception is available everywhere); the Pro switch warns on touch; Pro's view-only arrival is explained | §15.0, §16.1, OQ-16 |
| R12 | minor | coverage | No Options for ⋯ More rows | **Accepted.** A trailing ⚙ and a long-press menu (Pin · Options); a lint for Pro option boxes | §6.3 |
| R13 | minor | coverage | No single-frame step; wrong speed values | **Accepted.** Frame steps and the four real `PlaybackSpeed` values in the expanded transport | §10.3, rows 8.9, 8.10 |
| R14 | minor | coverage | Beat snapping at 0.25 s made fractional frames | **Accepted.** Snap to the whole frame nearest each beat | §10.3 |
| R15 | minor | coverage | Long-press on empty Thread space defined twice; no playhead noun; no band copy / paste | **Accepted.** A Playhead noun with its Halo; range brackets on their own control; Copy / Paste on the band | §6.2, §10.3, rows 8.11, 8.13, 8.22 |
| R16 | minor | coverage | No multi-channel selection; no pick-walk with add | **Accepted.** Selectable channel rows with group scrub and *Key selected channels*; *Select more* + ‹ › ▾ extends | §6.5, §6.6, row 2.5 |
| R17 | minor | coverage | Curves had no Scale tool | **Accepted.** *Select · Move · Insert · Scale* | §10.5, row 8.16 |
| R18 | minor | coverage | One disclosure per operator id could not split by arguments | **Accepted.** Per-argument entries with `when` predicates | §6.3, §20.5 |
| R19 | minor | coverage | Pro's window chords and T in Halo | **Accepted.** `PRO_CHROME` chords shadowed by a poll-failing operator; T focuses the first chip | §5.8 |
| R20 | minor | coverage | No whole-model static GLB export | **Accepted.** *Static model (GLB)* in More formats | §13.3, row 11.5 |
| R21 | minor | coverage | Behaviour Pro does not have (joint labels on selection, Scene reorder, Replace image, Look at milestone) | **Accepted.** Labels none / on hover / all; no reorder; *Replace image* as a wrapper; *Look at* in v1 | §6.4, §6.5, rows 1.9, 3.3, 7.11 |
| R22 | minor | coverage | Files and Workspace folder grants merged | **Accepted.** Two toggles | §14, J8, row 13.2 |
| R23 | minor | coverage | Unspecified sheet contents (influence filter, swatch name and recents, specular colour, `library.stop`, cancel during Rig it, motion-test clip, Match range every frame, active character, character rows) | **Accepted.** Each added to its sheet | §6.2, §6.5, §10.6, §12.2, §12.4, §13.1 |
| R24 | minor | coverage | Settings › Advanced had no schema; `watchRigViewOnly` would follow re-homing | **Accepted.** A prefs descriptor table with a test; `watchRigViewOnly` stays Pro-only, with a unit test | §20.3 items 12, 19, §16.1, AS-ST-7 |
| R25 | blocker | feasibility | The arbiter could not wait for tap or long-press in front of a viewport that commits on `pointerdown`; synthetic events lose capture and coalesced samples; `paneAt` was geometric | **Accepted.** The arbiter is a stage inside `ViewportManager`'s pointer path that buffers and replays the original events; DOM-target pane resolution; a T1a spike before the contract freezes; T1 is L+ (10) | §20.3 item 2, §20.4, §21 |
| R26 | major | feasibility | Same as R3, from the tools' side (transform `held`, rig `Held`, paint held set) | **Accepted** (with R3); one internal hook in `Held`; sticky states mapped to existing session state; rows tested through the real tools | §5.5, §20.3 item 3 |
| R27 | major | feasibility | `providePaneDisplay` is the single display port and writes Pro's pane memory; x-ray opacity is a constant | **Accepted.** A non-persisted `setDisplayOverlay` with `xrayOpacity`; Halo never calls the port; AS-ST-10 checks pane memory | §4.7, §20.3 item 17, AS-ST-10 |
| R28 | major | feasibility | Headless parity misses about 70 UI-registered ids; the inventory and the 25 tasks were not committed | **Accepted.** Parity runs in a browser across all mounts; §15 is the committed inventory (FEATURES ids in T6b); the 25 tasks are listed | §2.1, §15, §20.5 |
| R29 | major | feasibility | Halo may not import Auto-Rig's orchestration, so it would fork it | **Accepted.** T5b moves it into `editor-core/autorigFlow`; Auto-Rig re-imports it; a test compares operator logs; `HandoffInfo` fields for `from='halo'` | §12.2, §16.3, §20.3 item 10, AS-ST-5 |
| R30 | major | feasibility | Exports save inside `apply`, after the tap's activation is gone; `share()` may not resolve | **Accepted.** `FileService.save() → SaveTicket` with a host-level button, `canShare`, a 10 s fallback, D11 cases | §13.3, S9, §20.4 |
| R31 | major | feasibility | Undo budgets are stored prefs; MSAA is fixed at context creation; texture caps would change exports | **Accepted.** A host-level per-device profile before `GLHost`; the `device` override layer; texture caps at GPU upload only; a byte test | S8, §16.4, §20.3 items 15–16 |
| R32 | major | feasibility | ParamDef backfill would change Pro's repeat / adjust and MCP by load order; adjust-last for time-dependent operators undefined; T5 overloaded | **Accepted with a different mechanism**: Halo-only forms that Pro, `LastRun` and MCP never read, so Pro does not change; session values shown read-only in forms; T5 split into T5a / T5b / T5c. Promoting operators to adjustable is OQ-15 | §5.6, §20.3 item 6, §21 |
| R33 | major | feasibility | ST-B1's 2,048 B was not measured; second importers cost `/editor` bytes; wrong item-9 list; non-allowed subpaths used; palette restyle changes Pro | **Accepted.** The T1a spike measures first; allowances per package; item 9 corrected; `./overlays`, `./toolkit`, `./agent` added and measured; Halo's own palette view. The "move to a React-free package" option is the owner's alternative after measurement, because moving a module does not by itself remove the second-importer cost | §8, §20.1, §20.3 item 9, §20.6, OQ-3 |
| R34 | major | feasibility | Band and context operators register only with Pro's time slider; the focus registry lives in the editor; `setModifierSource` on curve controllers unnecessary | **Accepted.** A focused band source; the focus registry moves to curve-editor; adapters merge the flags; T7 grows to 10 days | §10.3, §10.5, §20.3 items 3, 8, 18 |
| R35 | major | feasibility | Double-tap against loop-select and tap-again cycling; Shared mode lost one-finger orbit; hold-to-repeat undo; double dolly from `gesturechange` | **Accepted** all four: second tap absorbed and Next ›; a finger manipulates only what is selected or a handle; no repeat; `gesturechange` ignored during touch pinches; radii by pointer type | §5.1, §5.2, §5.3 C14–C17, §5.4 |
| R36 | major | feasibility | Shared-mode brushes paint before the long-press; chrome locked during playback; contact size unverified; finger pressure halves strokes; Paint Colour missing from claims | **Accepted** all: the 120 ms / slop delay with rollback; chrome fades only while a pointer is down; contact size gated by D14; pressure only for pens; Paint Colour in the claim set | §4.7, §5.1, §5.3 C16, S25 |
| R37 | major | feasibility | Exit tests in the wrong WPs, `types.ts` with three owners, T6 overloaded, 71 days not credible | **Accepted.** T6 split into T6a / T6b; ha-14 → T9, ha-01 → T11; T0's exit is "boots on webkit-ipad"; Auto-Rig touch helpers ported in T1; one owner for `types.ts`; ≈ 100 days, critical path ≈ 39 | §21 |
| R38 | major | feasibility | `webkit-ipad` cannot prove iOS behaviour; touch counts are self-counted; phone untested; device ownership open | **Accepted.** `webkit-ipad` is compatibility only; a hard device gate with a named owner decided before T6a; counts are regression guards; phone flipped to best-effort (OQ-11) | §2.1, §20.7, AS-ST-21, OQ-11, OQ-13 |
| R39 | major | feasibility | Home Screen storage is separate; new tabs open in Safari; root-level manifest and `viewport-fit` would hit Pro | **Accepted.** Home Screen only after a Files backup, with a warning; *Open in a new tab* hidden in standalone; manifest and viewport scoped to `/app` | §16.2, §17, S12 |
| R40 | minor | feasibility | Share resolving does not prove a save; no leave prompt on iOS | **Accepted.** "Not confirmed" wording; snapshot kept on iOS; `pagehide` / `visibilitychange` flushes | §13.3, §16.4, S24, row 12.8 |
| R41 | minor | feasibility | Lazy chunks fail on long-lived tabs after a redeploy | **Accepted.** Idle prefetch of all small chunks; one host banner; skew protection considered at T12 | §20.6, S23 |
| R42 | minor | feasibility | Selection undo; search scope by workspace; flick speed claim on touch | **Accepted.** C9 (R5); search ignores `workspaces` with a "switches to" note; the speed claim qualified | §2.3, §5.3, §8 |
| R43 | minor | feasibility | Scribble on unfocused inputs | **Accepted.** Always-visible fields are buttons until tapped; D15 | §4.1, §5.3 C11, S22 |
| R44 | minor | feasibility | Overscroll and pull-to-refresh; the policy must be removed on unmount | **Accepted.** `overscroll-behavior` and a disposer; ha-12 checks Pro zooms and scrolls | §4.1, §5.3 C10, S13 |
| R45 | minor | feasibility | Manipulator size is shared session state; the Loupe cannot copy WebGL pixels; a wrong path | **Accepted.** Render-time scale with hysteresis; the Loupe is chips-only in v1; the path corrected | §5.4, §20.3 item 4 |
| R46 | minor | feasibility | Wrappers and `shell.navigate` would change the MCP toolset | **Accepted.** Agent-denied by default; `autorig.navigate` unchanged; no toolset bump | §14, §20.3 items 7, 11 |
| R47 | blocker | UX | "Save to Files" meant both a project save and an export; an export cleared the unsaved dot | **Accepted.** *Export … to Files* and *Save project to Files* are separate; exports never clear the dot; the export toast offers the project save | §1.3, §4.2 F, §13.3, AS-ST-13 |
| R48 | blocker | UX | Leaving a tool session discarded it like ✕ | **Accepted.** Leaving commits (Done); only ✕ discards, with a named confirmation above three steps; ha-10 / ha-12 | P15, §5.7, §7.1, §16.1 |
| R49 | major | UX | Plain channel names showed different numbers and signs from Pro | **Accepted.** A normative label table with Pro's numbers and signs, the Pro name in grey, a unit test | §10.1, AS-ST-19 |
| R50 | major | UX | The Thumb key's meaning depended on a gesture that had not happened yet | **Accepted.** Meanings split into tap and drag lines, both shown; ha-03 checks selecting two controls with the key held | §5.5, ha-03 |
| R51 | major | UX | One glyph for every meaning; single tap did nothing; shown where meaningless; coach text hard-coded | **Accepted.** The iPad Shift-key model (tap once, double-tap lock, hold); a glyph per meaning; hidden when meaningless and after a hardware modifier; coach text from the same row | §5.5, §4.5, §17 |
| R52 | major | UX | "Add" meant both selection and new content | **Accepted.** *Select more / Pick or unpick / Unselect*; *New shape ▾*; "Add" only for content | §1.3, §5.5, §11 |
| R53 | major | UX | "Move" meant both clips and translation | **Accepted**: clips are *Animations*; *Move* is translation only; a vocabulary lint | §1.3, §10.6 |
| R54 | major | UX | Duplicate controls with conflicting state (Fill, Smart, Smooth) | **Accepted.** One state per concept (P13); the Smart chip and Thumb Smooth removed | P13, §5.5 |
| R55 | major | UX | Path, status pill and Share showed three different counts; a budget ring with no budget | **Accepted.** One readiness list, one total; never "All good" with problems; the ring only with a budget | §7.2, §4.1 |
| R56 | major | UX | J1's real defaults (Mittens, no destination card, Go fix round trips) made it ≈ 16 touches | **Partly accepted.** The destination is asked on the Rig-it card, Thumb is the default, one-operator fixes run inline, ha-J1 starts from a fresh project. The proposed CC0 prefill is rejected (R6, Q-SKIN-3), so J1 is 11, not 10 | §7.3, §9 J1, §12.2, §13.3 |
| R57 | major | UX | Box-select in Curves, key bands, loop / shell and fill needed a Pencil | **Accepted.** A finger route per surface; labelled chip twins; finger-only ha-J4f / ha-J6f in the gate | §5.2.1, §20.7 |
| R58 | major | UX | Breathing chrome locked every control during playback | **Accepted.** Chrome fades only while a pointer is down on the canvas; playback keeps it live | §4.7, §5.3 C18 |
| R59 | major | UX | Single rows cut off at the edge; ⋯ More off-screen on phones | **Accepted.** ⋯ pinned; rows wrap or fold into ⋯; ha-15 checks every surface at 1194, 834 and 390 pt | §4.1, §4.4, AS-ST-18 |
| R60 | major | UX | Floating UI covered the work (key Halo, Rec card, weights card, chips, numpad) | **Accepted.** The key Halo docks in the layer header; cards dock; the weights card docks or becomes a tray row; chips and numpad anchored; a layout test against the selection box | §4.1, §5.6, §10.4, §12.4, AS-ST-18 |
| R61 | major | UX | Four ways to key at once and a Rec question before the first pose | **Accepted.** Rec is Halo's own setting, on by default, applied as a removable override; no question card, no "not keyed" pill, one Key petal; OQ-4 updated | §10.2, §16.4, OQ-4 |
| R62 | major | UX | Pro jargon at L1 | **Accepted.** Plain words at L1 (*Hand leads*, *In-between*, *All keys here*, *Blend*, *Push later keys*, *Fewer keys*, *Fix flips*, *Mirror edits*, *Falloff*), Pro names at L2, no "tris", format names in Advanced | §6.2, §13.3, §17 |
| R63 | major | UX | Unclear icons (grab bar, ◆+, ⟳ 1×, ⓘ, ⇄, ↗, icon-only phone bar) | **Accepted.** A labelled *Timeline · Keys · Curves* switch; *Numbers*; *Other side*; ◆+ removed; loop and speed split; *Share* keeps its word; ▤ layout icon instead of ↗ | §4.1, §4.4, §10.3 |
| R64 | major | UX | Pro ↗ sent touch users into a shell that is not touch-ready; the arrival toast implied missing tools | **Accepted.** A one-line warning on coarse-pointer devices; *"Same project, every panel at once"* | §16.1, J9 |
| R65 | major | UX | The two-card chooser and the Pro button read as Lite against Pro | **Accepted**, keeping the owner's "Studio Pro" name: no chooser on a first visit, "one studio, two layouts", a *Pro layout / Simple layout* switch; OQ-2 | §0, §1.1, §1.2, OQ-2 |
| R66 | major | UX | About 50 targets in Animate; not calmer than Pro | **Partly accepted.** A per-stage budget asserted in ha-05, the status corner only when needed, the breadcrumb's extras on long-press, the transport collapsed, Redo off L0. Rejected: moving ↶ into the top bar (it stays under the thumb, next to the Thumb key) and the ≤ 20 figure (the Path and Share alone take 8 targets); the budget is ≤ 22 at rest and ≤ 36 with a Halo | §4.8, AS-ST-17 |
| R67 | major | UX | No way to see curves and channels together on an iPad; mixed seconds and frames; Curves one control at a time | **Accepted.** Numbers pinned at ≥ 1180 pt with Curves; Settings › Time; curves for every control selected in Keys; channel rows in Keys | §4.2 D, §10.3–§10.5 |
| R68 | major | UX | Not yet revolutionary: every differentiator after GA | **Partly accepted.** In the release: Reach posing, the *Wave* and *Loop it* recipes in search, native rig dots. Pose cards are recorded as a T15 exploration, because a thumbnail per key needs offscreen renders whose iPad memory cost is unmeasured | §0, §8, §9.11, §10.1, §10.7, §12.2 |
| R69 | minor | UX | *Adjust dots* sent beginners into a third UI | **Accepted** (R7) | §12.2 |
| R70 | minor | UX | Copy at L1 but Paste at L2 | **Accepted.** The Copy petal becomes *Paste ▾* in the same slot | §6.1, rows 7.7, 8.22 |
| R71 | minor | UX | After Pull the Halo closed; no cap handle in the prototype | **Accepted.** A reduced Halo beside the chips; the prototype has a cap handle; T8 starts from it | §4.2 B, §6.1, §21 T8 |
| R72 | minor | UX | Swatch and clip chips needed two taps; the *Use* petal did nothing | **Accepted.** The first tap activates and opens the Halo; *Use* removed | §6.1, §13.1 |
| R73 | minor | UX | Paint showed "in progress" untouched; glyphs unexplained; no next step after the starter set; Home's primary door unusable without a file | **Accepted.** Paint `○` until coloured; a glyph legend; one Next chip from readiness; *Try a sample* primary without Continue cards | §4.2 A, §7.2, §17 |
| R74 | minor | UX | Double-tap meant different things by input | **Partly accepted.** Double-tap frames for every input; grow and fill moved to chips. Rejected: a Pencil press-and-hold for grow, because press-and-hold is already the Halo ring for every input | §5.2, §5.3 C2 |
| R75 | minor | UX | Halo-on-click noisy for Maya users; the Thumb key redundant with a keyboard | **Accepted.** With a fine pointer and a keyboard the Halo opens on right-click or hold, with ⋯ Verbs on the breadcrumb; the Thumb key hides after a hardware modifier | §4.5 |
