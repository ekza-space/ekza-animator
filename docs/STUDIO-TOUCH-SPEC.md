# Ekza Studio — touch-first shell specification ("Halo")

Status: **v0.1 (2026-10-24), draft for the owner.** It becomes binding when the owner accepts it and
[ADR 0023](adr/0023-studio-touch-ui.md) moves to Accepted. The contracts in §20.4 freeze when work package T2 merges.
After that, changing a contract needs a PR that updates this file first. Defaults and owner questions are recorded in
[DECISIONS-OPEN §O](DECISIONS-OPEN.md#o-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24) (`ST-*`).

Owner request (2026-10-24, translated): *"Can we make a lightweight version, say for iPad, while keeping all the
functionality? Design a universal, modern, even revolutionary UI/UX with very simple and convenient interaction. Keep
the current one as 'Studio Pro', and present the new one as essentially the same thing, with the emphasis on simplicity
and minimalism."*

Inputs:
- The research round of 2026-10-24 on `dev` @ `0512ba88` (v0.6.0, M-AI merged). It had five parts:
  - a capability inventory: 191 user-facing rows in 14 groups, 379 operator ids, about 51 deferred stubs;
  - an architecture survey of the host, the shells and the size gates;
  - a touch and iPad readiness audit, with platform facts as of iPadOS 26.x and Safari 26;
  - a market survey of about 25 touch, tablet and AI-native tools, plus the HCI work behind them (§25);
  - ten core user journeys.
- Four competing concepts: *canvas*, *intent*, *object* and *journey*. Three judges scored them for simplicity, parity
  and feasibility. The ranking by summed score was object 24.8, canvas 22.7, journey 21.6, intent 18.5.
- [ADR 0021](adr/0021-autorig-mode.md) and [AUTORIG-SPEC](AUTORIG-SPEC.md), the precedent of a second shell.
- [MCP-SPEC](MCP-SPEC.md) §0.4 and ADR 0018 (the agent bridge).
- ADRs 0006, 0008, 0011, 0013 and 0016.
- [FEATURES.md](FEATURES.md). It still says v0.5.1 and calls MCP "next release"; that is stale against v0.6.0, and T12
  refreshes it.
- [REQUIREMENTS](REQUIREMENTS.md) NFR-03, which supports Chrome/Edge and defers Safari to V1.

Audience: the owner (§0, §1, §9, §24), the integration agent (T2, T12), the implementation agents of T0–T11 and
reviewers.

The rule this spec follows: **Ekza Studio adds no modeling, rigging, animation or export logic of its own.** It is a
third *shell*, a different user interface over the same `EditorApp`, document, undo history, operators and files as
Studio Pro and Auto-Rig. Every document write is an operator run (ADR 0021 rule 2). A shell may add a small number of
thin, public *wrapper* operators (§20.3 item 7); each one calls existing operators and is registered for every shell.

---

## 0. Summary

**Halo** (the working name of the design; the product is called **Ekza Studio**) is one full-screen 3D canvas.

- **Touch anything** — a face, a joint, a forearm, a key dot, a curve, a clip, a colour swatch, a warning on the model —
  and up to six verbs in plain words appear next to it. That ring of verbs is the *Halo*. A **⋯ More** entry lists every
  operator that applies to that thing.
- **Search** is always on screen and reaches every operator by name.
- **A thin bar at the top, the *Path***, shows where you are in the pipeline: Make · Paint · Rig · Animate, then
  **Share**. It also shows how ready the character is for where it is going. It never locks anything.
- **Input**: the Pencil makes things and fingers move the view. One on-screen **Thumb key**, whose label always says
  what it does right now, stands in for every modifier key, held key and middle-click.
- **Numbers** are chips you drag to change.
- **Timing** lives in one strip, the *Thread*. Pull it up and it becomes the Dope Sheet; pull again and it becomes the
  Curves editor. Both run Pro's own controllers.
- **Pro is one tap away** (Pro ↗) and keeps the document, the undo history, the selection, the frame and the camera.

The ten key decisions (ADR 0023 is the record):

| # | Decision |
|---|---|
| D1 | **A third shell, not a fork.** Internal id `halo`, route `/app`, package `@ekza-studio/halo`, in the `(studio)` route group under the same `StudioHost`. In the UI it is "Ekza Studio". `/editor` becomes "Ekza Studio Pro" in UI strings only; its internal id stays `studio`. Auto-Rig stays at `/autorig` and is presented as "Rig a model for me". |
| D2 | **Noun-first grammar.** Tap a thing to select it and open its Halo: up to six curated plain-language verbs, plus ⋯ More, which is derived from the registry and `poll`. Drag a thing to manipulate it. Long-press it (right-click with a mouse) for the same verbs as a flick ring, reusing Pro's marking-menu data and geometry. |
| D3 | **One canvas plus the Path.** Make · Paint · Rig · Animate switch workspace, tools and lighting; they never change the layout and never gate. **Share** is destination-first ("For: OMOBA & Ekza Space"). Readiness glyphs on the Path and health dots on the model come from the same checks (Mesh Check, rig checklist, Validation, export lints). |
| D4 | **Input roles and gestures.** Fingers navigate, the Pencil acts. Before a Pencil is seen, fingers do both. Only one- and two-finger gestures are used, and every gesture has a visible twin button. A labelled **Thumb key** replaces Shift, Ctrl, Alt, held keys, the middle button and right-click finishes. |
| D5 | **Values beside the work.** *Echo chips*: an operator's parameters appear as chips next to its result. Drag one to scrub; move your finger farther away for finer steps; tap for a numpad with minus and expressions. Every modal tool shows a *session bar* with ✕ Cancel and ✓ Done. Esc, Enter, Backspace, PgUp/PgDn and right-click are never required. |
| D6 | **Time on touch, in full.** The *Thread* is a strip in seconds that unfolds into Parts (the Dope Sheet) and then Curves (the Graph Editor), on Pro's `DopeSheetController` and `GraphEditorController` behind touch adapters. Touch Curves, Dope Sheet, Channels and Weights are **release requirements, never Pro hand-offs**. |
| D7 | **Parity is enforced by CI.** A *Disclosure Manifest* gives every live, non-internal, non-stub operator a non-search Ekza Studio path, or an entry in `PRO_ONLY` with a written reason. The count of search-only operators can only go down. Search never counts as parity. |
| D8 | **Shared kernel work first.** Touch navigation moves out of Auto-Rig into the viewport, with a public navigation API, a multi-pointer `PointerArbiter` and `setModifierSource`. Pick radii depend on pointer type. Missing ParamDefs are backfilled as a lazy contribution. Operators only the AI can use today get public wrappers. Shell-neutral registrations move to the host. The route unions are widened. |
| D9 | **iPad Safari is first-class.** A WebKit iPad gate comes before any UI work. Also: an iOS memory profile; two-step "Save to Files" through Web Share; opening files by sniffing their bytes; `storage.persist()` and a Home Screen manifest. Editing is never locked at any width. AI on iPad waits for an owner decision on the transport. |
| D10 | **Bundle discipline.** `/app` gets its own gate (about 700 kB, owner decision). The route adds 0 B to `/editor` and `/autorig`; the shared extractions are measured under one recorded re-baseline (ST-B1). Halo never imports dockview, `PaneView`, `GraphCanvas`, `TimeSliderView` or the `@ekza-studio/editor` root. |

Delivery: 13 work packages, T0–T12, about 71 agent-days. The critical path is T1 → T6 → T7 → T10 → T12, about 32
agent-days (§21). The release gate is the acceptance set in §22, run on a real iPad in Safari.

---

## 1. Name and positioning

### 1.1 Three products, one document

| | **Ekza Studio** (new) | **Ekza Studio Pro** (today's Studio) | **Auto-Rig** |
|---|---|---|---|
| Who | Everyone, and the default front door. Touch and Pencil first; also good with a mouse and keyboard. Phone works. | Animators and modelers who want the Maya-style power shell: docked panels, many editors at once, hotkeys. | People who only want "rig my model and get a file", step by step. |
| What | Everything Pro can do (§15), shown one layer at a time. | Unchanged: menus, docks, workspaces, marking menus, Maya keymap. | The five-step wizard, unchanged. |
| Route / internal id | `/app` / `halo` | `/editor` / `studio` (unchanged) | `/autorig` / `autorig` (unchanged) |
| Shown in the UI as | "Ekza Studio" | "Ekza Studio Pro" | "Rig a model for me" |

The positioning line is: *"Ekza Studio: the whole studio, made simple. Studio Pro: the same studio, every panel at
once."* It is the same studio, the same files and the same history. Nothing is "Lite". Nothing in Pro moves or
changes to fit Ekza Studio (§3 P10).

### 1.2 The chooser at `/`

`/` stays the server-rendered chooser (AUTORIG-SPEC §3.2) and is rebalanced:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◆ Ekza                                                                       │
│                                                                              │
│   ┌──────────────────────────────────────────┐  ┌────────────────────────┐   │
│   │  Ekza Studio                       beta  │  │  Ekza Studio Pro       │   │
│   │  Make, rig and animate characters.       │  │  Maya-style: panels,   │   │
│   │  Touch, Pencil, mouse — start here.      │  │  hotkeys, many editors │   │
│   │                          [ Open ]        │  │  at once.   [ Open ]   │   │
│   └──────────────────────────────────────────┘  └────────────────────────┘   │
│                                                                              │
│   Just want a rigged file?  Rig a model for me ▸            ☐ Remember       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Ekza Studio comes first and is the large card on every device. Studio Pro is the second card. Auto-Rig is a link.
- The remembered choice (`ekza-studio:entry:v1`) gains `'halo'`. `EntryChoice`, `ENTRY_ROUTES`, `REDIRECT_SCRIPT`,
  Studio's `entryChoice.ts`, the first-run dialog's "Open this mode next time", Preferences › Start in and
  `entry-contract.test.ts` change together (T2).
- **Default ST-2: no automatic skip by pointer type.** Coarse-pointer devices see the chooser with Ekza Studio first,
  like every other device. Owner question OQ-2 asks whether an iPad with no remembered choice should go straight to
  Ekza Studio.
- `/?chooser=1` still forces the chooser. Deep links (`/app`, `/editor`, `/autorig`) never redirect.
- Until the release gate (T12), `/app` is reachable by URL only and the chooser shows today's two cards. The card and
  the "Studio Pro" rename land together at T12 (ST-30).

### 1.3 Naming rules (internal)

- `'studio'` keeps meaning Pro everywhere internally: e2e specs, `from=studio`, `MountedShell.kind`, stored entry
  choices and the `ekza-animator:` storage keys all depend on it.
- The new shell's id is `halo`. The shell marker is `ekza-halo-shell` and the e2e family is `ha-`.
- The URL avoids `/studio` while `to:'studio'` means `/editor`, and the id avoids `simple`, which is Auto-Rig's
  navigation name.
- The coined names in this spec are for the people building it, not for users: Halo, Path, Thread, Thumb key, Echo
  chip, Loupe, View puck, session bar. **Users see plain labels**: the Thumb key shows "Add" or "Fine", the Thread is
  just the timeline, a verb reads "Pull", and so on. Help pages may name the parts.

---

## 2. Goals, non-goals and what the research says

### 2.1 Goals

1. Every capability in the 191-row inventory is reachable without a keyboard, hover, right-click, middle-click or
   modifier key. At most 3 deliberate presentation hand-offs go to Pro (§15.15).
2. The 25 most frequent tasks of a game-character artist can be done on an iPad in Safari with fingers and a Pencil,
   each at most two taps deep from the thing it acts on.
3. The same document and history across Ekza Studio, Pro and Auto-Rig. Switching keeps the undo history (AS-ST-6).
4. A calm screen: one canvas, at most three edge zones, no modal on first open, no panel floating over the work.
5. Universal: iPad landscape and portrait, phone, and desktop with mouse, trackpad and keyboard, all with one mental
   model. The layout uses container queries, never device sniffing.

### 2.2 Non-goals (v1)

- No new modeling, rigging, animation or export algorithms (one exception, §12.4: pressure folded into existing stamp
  strength).
- No docking, layout presets or keymap editor in Ekza Studio (§15.15).
- No AI on iPad until the owner chooses a transport (OQ-5).
- Not in v1: performance capture ("Perform"), onion skins and motion trails (M2c), automatic foot-slide fixing
  (motion-analysis P4), and a native app wrapper.
- Pro does not change, except for the "Ekza Studio Pro" strings, one lazy "Switch to Ekza Studio" item and the shared
  input fixes that help every shell (§20.3).

### 2.3 What the research says (digest)

- **Same core, different lens.** Shapr3D is identical across Mac, iPad and Windows, with one licence. Blender's tablet
  project is explicitly "not Blender Lite". Cascadeur Mobile keeps the timeline, ghosts, trajectories and IK/FK. Forks
  died: Gravity Sketch's cut-down iPad app was unlisted.
- **Selection drives the UI** (Shapr3D's Adaptive UI, Valence 3D). **Search guarantees reachability** (Linear, Blender's
  helper overlay). **A radial menu becomes flicks** with practice; the mark is about 3.5× faster than picking from the
  menu (Kurtenbach & Buxton). **The Pencil writes and touch manipulates** (Hinckley, "Pen + Touch = New Tools").
- **A shared gesture set.** Procreate and Nomad use the same one: two-finger tap undo, three-finger tap redo, four-finger
  tap hides the UI. Every gesture needs a visible twin: iOS's three-finger swipe-undo is one of its least-used features,
  and Shapr3D users fear accidental undo on large iPads.
- **Failures to avoid.** Figma rolled back UI3's floating panels; users said they made the canvas smaller and slowed
  them down. Shapr3D 5.300 changed its interaction model without an opt-out and users pushed back. Adobe Aero and
  Toontastic were discontinued. Procreate Dreams recordings flood the timeline with keys and it has no graph editor.
- **The platform.** Every iPad browser runs WebKit. Apple Pencil squeeze, double-tap and barrel roll never reach web
  pages. Pressure, tilt, altitude and azimuth do, and so does hover on hover-capable iPads. Safari fires no
  `contextmenu` on a long-press, may evict IndexedDB after 7 days without a visit, has no save or open file pickers,
  and kills a tab at roughly 1.5–2 GB. Pages render at about 60 Hz even on ProMotion displays.
- **The code.** The kernel is ready: one operator registry with labels, polls, aliases and ParamDefs, menus and marking
  menus as data, and Auto-Rig as proof that a second shell keeps the document and history. The Pro shell is not
  touch-ready:
  - navigation needs Alt chords or the wheel;
  - hit radii are 2–8 px;
  - keyboard scope comes from hover;
  - there are right-click-only menus;
  - Rig & Skin is view-only below 1024 px;
  - Pencil pressure is never read;
  - Safari is outside the test gate.

  Auto-Rig already has touch navigation, 44 px targets and touch e2e tests.

---

## 3. Principles

- **P1 Nouns first.** You touch the thing, then pick a verb; the verbs live on the thing. Every pickable object,
  component, joint, control, key, curve, clip, swatch, warning and history step is a noun with a Halo.
- **P2 Fewer things visible, never fewer things possible.** There is a depth ladder: L0 on screen, L1 one tap, L2 More or
  a sheet, then search, then Pro. CI enforces it (§20.5).
- **P3 One document, one registry, one history.** Ekza Studio is a view over editor-core. It has no fork and no file
  format of its own, and every action is an undoable operator run. The agent, Pro and Auto-Rig see everything it does.
- **P4 The Pencil makes, fingers move the view, the thumb modifies.** Routing depends on pointer type. Settings ›
  Input shows it as a table the user can change.
- **P5 Every gesture has a visible twin; no undo is silent.** Each undo toast names its step.
- **P6 The canvas is the UI.** Parameters, problems, hierarchy and timing appear on or next to the object. Sheets dock
  to an edge and can be resized; they never float over the work. Labels use words, not icons alone.
- **P7 No modifier, hover, right-click or middle button required.** Keyboard, mouse and Pencil hover make things faster
  but never gate anything.
- **P8 Plain words first, Pro words one layer down.** "Pull" appears at L1. More and search show "Pull · Extrude ·
  ⌘E", so Ekza Studio teaches Pro.
- **P9 Every automatic result lands as sparse, labelled, undoable steps.** This covers Rig it, recipes, AI and later
  Perform. Each has a manual fallback.
- **P10 Pro is never changed to fit Ekza Studio.** Halo never rewrites Pro's keymap, marking menus, layouts or defaults.
  Shared preferences are never written implicitly; they change only through a visible control (§16.4).
- **P11 Fluid, never locked.** The layout uses container queries from 320 pt to desktop, and editing is never locked by
  width (Halo never calls `setRigViewOnly`, AR-V1).
- **P12 An honest platform.** The UI never promises what iPad WebKit cannot do (squeeze, barrel roll, the loopback AI
  bridge), and says plainly where a feature does work.

---

## 4. Screen anatomy

### 4.1 The parts (the same on every device)

| Part | Where (right-handed default; Settings › Input › Handedness mirrors it) | What |
|---|---|---|
| **Top bar** (52 pt) | Top edge | `◂ Project • ▾`: project menu with New, Open, Import, Samples, Save to Files, Recover, Settings, Help, Full screen and Home. The dot means unsaved changes. Then the **Path** (§7), `⌕ Do or find…` (§8), `Share ⤴` with a destination badge, and `Pro ↗`. |
| **Canvas** | Full bleed under the bar | One viewport, pane id `pane-single`, so camera memory is shared with Pro. The View sheet adds 2- and 4-pane layouts on wide containers (§15 row 1.6). |
| **Breadcrumb** | Floats above the selection | `Cube Lad › Right arm › Forearm ⓘ ‹ ›`. Tap a crumb to select it; ‹ › step to siblings; ▾ lists children; ⓘ opens the Inspector. |
| **Halo** | Beside the selection, joined to it by a thin line | Up to 6 petals plus ⋯. The petals sit on the side away from the Pencil hand and avoid screen edges (80 pt radius, 144 pt edge margin, the marking-menu geometry). |
| **Echo chips** | Next to the result of the last operation | Parameter chips (§5.6). |
| **Session bar** | Top of the canvas, under the bar | Only during modal tools: `✕ Cancel · tool · hint · ✓ Done`, plus ⌫ (remove last point) and − n + where they apply. |
| **Off-hand column** | Lower corner on the non-Pencil side | `↶ ↷`, and below them the **⊕ Thumb key** (56 pt, §5.5). |
| **View puck** | Lower corner on the Pencil side | An orientation cube. Tap a face for front, side or top; tap the centre to frame the selection; double-tap to frame all; drag to orbit; long-press for the View sheet. |
| **Status corner** | Above the puck | The budget ring (triangles against the destination's budget) and the health dot with a count. |
| **Tray** | Bottom edge | Empty space is a noun too, and the tray is its Halo, docked: the current stage's tools and state chips (component pill, Sym, Soft, Snap; swatch row; brush bar; Rig segment). In Animate the **Thread** sits above it. |
| **Sheets** | Right edge in landscape (360 pt); bottom edge in portrait and on phones | Inspector, More, Scene, Library, Health, Share, History, Settings, View, Ask. Each has peek, half and full heights, set by its grab bar. Scrolling inside a sheet is `touch-action: pan-y`. |

Rules for all parts:
- Targets are at least 44 × 44 pt, and input text is at least 16 px, so iOS never zooms on focus.
- Nothing sits within 20 pt of the bottom edge (the home indicator) or within 12 pt of the side edges.
- The shell sets `touch-action: none`, `user-select: none` and `-webkit-touch-callout: none` everywhere except inside
  text fields and scrolling sheets, and cancels `gesturestart`, so pinching never zooms the page.

### 4.2 iPad landscape (≥ 1024 pt container)

**A. First open: Home.** No modal, no first-run dialog, no recovery dialog, no empty grid. The live canvas renders one
still of a sample behind the cards, then idles at 0 fps.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Ekza Studio                                            ⌕ Do or find…    Pro ↗ │
│                                                                                  │
│               Make, rig and animate 3D characters. Nothing is uploaded.          │
│                                                                                  │
│    ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐      │
│    │ ⇪  Bring a model   │   │ ✎  Make a          │   │ ▶  Try a sample    │      │
│    │ GLB · VRM · saved  │   │    character       │   │ (already moving)   │      │
│    │ project · moves    │   │ 3 starts           │   │ Seed-san ▾         │      │
│    └────────────────────┘   └────────────────────┘   └────────────────────┘      │
│                                                                                  │
│    Continue   [▣ Cube Lad · Rig ◐ · 2 min ago]   [▣ Robo · Tue]        All ▸     │
│                                                                                  │
│    Rig a model for me ▸                                                          │
│    ✎ Pencil edits · ☝ finger moves the view · two-finger tap = undo              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**B. A model loaded, Make stage, two faces selected.** The Halo shows the face verbs. The tray shows Make's tools and
state chips.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│◂ Cube Lad•▾ ( Make● │ Paint○ │ Rig⚠2 │ Animate○ )  ⌕ Do or find…  Share⤴   Pro↗ │
├──────────────────────────────────────────────────────────────────────────────────┤
│                         Cube Lad › Body › 2 faces  ⓘ  ‹ ›                        │
│              (Pull)╲                                                             │
│           (Inset)───╭──────────────╮                                             │
│           (Bevel)───│   ▓▓ ▓▓      │                                             │
│          (Colour)───╰──────────────╯      ( clay shading, wire on the            │
│          (Delete)╱   (⋯ More)               selection, symmetry plane faint )    │
│                                                                                  │
│                                                               ◔ 812 / 3,000 ✓   │
│ ↶  ↷                                                          ● 3 open edges     │
│ ┌────────┐                                                          ┌───┐        │
│ │ ⊕ Add  │                                                          │ F │ View   │
│ └────────┘                                                          └───┘        │
│ [Whole│Points│Edges│Faces●]  Sym X ◉  Soft ○  Snap ○ │ Add ▾  Cut ▾  Reference ▾  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

After **Pull**, the Halo fades, the cap handle appears and the parameters show as Echo chips. Nothing is modal: the
next tap commits the operation, and ↶ undoes it.

```
│                       ┌──┐                                                       │
│                       │▲▲│ ← cap handle   ⟨Distance 0.12 m⟩ ⟨Segments 2⟩ ⟨Smart ○⟩│
│                       └──┘                                 ⟳ Again   Options     │
```

**C. Animate stage, posing.** The right forearm was tapped on the mesh.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│◂ Seed-san•▾ ( Make○ │ Paint○ │ Rig● │ Animate◐ )  ⌕ Do or find…  Share⤴    Pro↗ │
├──────────────────────────────────────────────────────────────────────────────────┤
│                  Seed-san › Right arm › Forearm  ⓘ  ‹ ›                          │
│      (Key ◆)╲                                                                    │
│   (Mirror ▾)─╭──── rotate ring ────╮                                             │
│     (Reset)──│     forearm    ◯    │                                             │
│  (Copy pose)─╰─────────────────────╯                                             │
│     (IK⇄FK)╱  (⋯)   ⟨Bend 34°⟩ ⟨Twist 0°⟩ ⟨Side 5°⟩   ● not keyed · Key · Discard │
│                                                                                  │
│ ↶  ↷               Tween ◀━━━━━━━●━━━━━━━▶ 50 %                     ┌───┐        │
│ ┌────────┐                                                          │ P │ View   │
│ │ ⊕ Add  │                                                          └───┘        │
│ └────────┘ Moves: [Idle] [Walk] [Wave●▾] [+ Move]                    Library ▸   │
│ |◂ ◆◂ ▶ ▸◆ ▸|  ◆+  ●Rec   0s ·◆····◆····┃···◆······◆· 2s   ⟳ 1×         ═══ ▴  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**D. Deep tool: Curves.** The Thread is pulled up to its second layer (§10.5). The canvas keeps at least 45 % of the
height and keeps playing.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│◂ Walk•▾   ( Make○ │ Paint○ │ Rig● │ Animate◐ )   ⌕ Do or find…  Share⤴    Pro↗  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                 O    canvas live, playhead synced · L foot                       │
│                /|\               ▬▬ L foot contact 0.00–0.30 s ▬▬                │
├══════════════════════════════ ═══ grab ═══ ══════════════════════════════════════┤
│ [Walk ▾]  Parts │ Curves●   L foot ▾  Move X● Move Y● Move Z○ Turn…  Keyed only ✓ │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │1.2│       ●╮             ╭●────────●╮        Pencil: keys and handles         │ │
│ │   │  ●────╯ ╰───●────────╯          ╰───●    two fingers: pan · pinch         │ │
│ │0.0│──────────────o====o── 2 keys ───────────────────── ⇆ Before (hold)       │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│ ⟨Frame 12⟩ ⟨Value 0.000 m⟩ ⟨In 0°⟩ ⟨Out 0°⟩   Ease: Smooth Linear Flat● Step ⋯   │
│ Simplify ⟨0.5⟩  Euler  Cycle ▾  Abs│Norm│Stack  Axis: free ▾      Open in Pro ↗   │
│ |◂ ◆◂ ▶ ▸◆ ▸|  0s ··········┃································· 1s   ⟳              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**E. Deep tool: weights.** Rig stage, Skin segment, posed on the frame where the elbow breaks (§12.4).

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ✕ Cancel        Paint weights · Upper arm L · elbow bent 60°            ✓ Done   │
│                                                   ┌────────────────────────────┐ │
│      ( posed character, weight ramp on the mesh ) │ This area follows          │ │
│               ◌ ← Pencil hover: ring + "0.72"     │ ● Upper arm L   0.72  ‹ ›  │ │
│                                                   │ ○ Chest         0.28       │ │
│                                                   │ All bones ▾                │ │
│ ↶  ↷                                              └────────────────────────────┘ │
│ ┌──────────┐                                                        ┌───┐        │
│ │⊕ Smooth  │                                                        │ P │        │
│ └──────────┘                                                        └───┘        │
│ [Replace│Add●│Scale│Smooth] ⟨Size 4 cm⟩ ⟨Strength 0.6⟩ ⟨Value 1.0⟩  Pressure ◉   │
│ Mirror ◉  Flood  Show: ramp ▾  [Bind│Test●│Clip]  Bend elbow ⟨60°⟩  ▶ Play   ⋯   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**F. Share.** A sheet over any stage (§13.3).

```
┌───────────────────────────────── Share ─────────────────────────────────────┐
│ For:  (● OMOBA & Ekza Space)  (Game engine)  (Just the moves)  (Prop)        │
│       (Into the original file)   More formats ▸            Just exploring    │
│ ──────────────────────────────────────────────────────────────────────────── │
│  OMOBA & Ekza Space · VRM 1.0                          2 things to fix ▸     │
│   ⚠ Licence not chosen          → Free for anyone (CC0) ▾                    │
│   ⚠ 2 finger bones missing      → Go fix ▸                                   │
│  Name [Cube Lad      ]   Author [              ]   Thumbnail ▣ automatic     │
│  Moves: Idle ✓  Walk ✓  Run ✓  Wave (no slot) ▸                              │
│  Advanced ▾                                                                  │
│                                                         [ Save to Files ]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 iPad portrait and windowed iPad (700–1023 pt container)

The Path moves under the top row. Sheets rise from the bottom. Halo, Thread, Thumb key and puck stay.

```
┌────────────────────────────────────────────────┐
│◂ Seed-san•▾          ⌕      Share⤴   Pro↗      │
│ ( Make○ │ Paint○ │ Rig● │ Animate◐ )           │
│          Right arm › Forearm ⓘ ‹ ›             │
│  (Key◆)(Mirror▾)(Reset)(Copy)(IK⇄FK)(⋯)        │
│                  o                             │
│               \__|     ⟨Bend 34°⟩ ⟨Twist 0°⟩   │
│                  O                             │
│                 /|\                            │
│ ↶ ↷                                   ┌───┐    │
│ ⊕ Add                                 │ P │    │
│ Moves: [Idle][Walk][Wave●][+]         └───┘    │
│ |◂ ▶ ▸| ◆+ ●Rec 0s ·◆··◆·┃·◆··◆· 2s ⟳   ═══▴   │
│ ═════════════ Inspector (peek) ═════════════   │
│ Forearm R   Bend ⟨34°⟩  Twist ⟨0°⟩  Side ⟨5°⟩  │
└────────────────────────────────────────────────┘
```

Rig & Skin, including weight painting, is fully editable here, unlike Pro's view-only rule below 1024 px (AR-V1). The
Halo arc turns into a horizontal row when the space beside the selection is narrower than 240 pt.

### 4.4 Phone (< 700 pt container)

The same parts, folded for the thumb.

```
┌──────────────────────────────┐
│◂ Wave•    ⌕   Share⤴   ↶ ↷   │
│                              │
│        ( canvas )            │
│   Right arm › Forearm ‹ ›    │
│   ⟨Bend 34°⟩ ⟨Twist 0°⟩      │
│                         (P)  │
│ ──────────────────────────── │
│ (Key◆)(Mirror)(Reset)(⋯)     │ ← the Halo docks as a verb bar
│ ▶ ·◆··┃··◆··◆· 2s   ◆+  ═▴   │ ← Thread (Animate)
│ ⊕ Add                        │
│ Make │ Paint │ Rig │ Animate●│ ← the Path becomes a tab bar
└──────────────────────────────┘
```

- The Halo becomes a verb bar above the Thread, with the same verbs in the same order. Pro ↗ moves into the project
  menu.
- Sheets open at full height. One pane is shown, and a two-pane recipe step becomes a Front | Side toggle.
- Weight and colour painting work with a 40 pt finger offset: the brush sits above the fingertip, as in Nomad. A hint
  says a bigger screen is easier. Quality target: "usable"; iPad is the design target (ST-28).

### 4.5 Desktop (mouse, trackpad, keyboard)

The same anatomy as iPad landscape, with these differences:
- **Click** selects and opens the Halo. Settings › Input › "Halo on click" defaults to on; the alternative "right-click
  only" makes it behave exactly like a Maya marking menu.
- **Right-click** opens the Halo in flick mode at the cursor.
- **Hover** pre-highlights and shows tooltips with the Pro name and hotkey. No feature depends on hover.
- **Navigation** follows the user's own Pro `navProfile`: Maya Alt-drag, trackpad or one-button. Left-drag on empty
  space also orbits; Alt falls through to the profile, as in Auto-Rig's Simple navigation.
- **Keyboard**: the full Maya keymap works through the host `KeyboardAdapter`; Mod+K or `/` focuses the search pill.
- Containers of at least 1600 pt can pin the Inspector as a column. It is still a sheet, not a dock.

### 4.6 Size classes

Layouts switch on **container** width (`@container`), never on viewport width or user agent; iPadOS 26 windows resize
freely.

| Class | Container width | Path | Sheets | Halo | Panes |
|---|---|---|---|---|---|
| Wide | ≥ 1024 pt | in the top bar | right edge, 360 pt (pinnable ≥ 1600) | arc | 1, 2 or 4 (View sheet) |
| Regular | 700–1023 pt | second row | bottom | arc, or a row when cramped | 1 or 2 |
| Compact | < 700 pt | bottom tab bar | bottom, full height | verb bar | 1, with a switcher |

The input mode (touch, pen or mouse) comes from the last `pointerType` and `any-pointer: coarse`, never from the user
agent. iPad Safari reports itself as `MacIntel` (§19).

### 4.7 Stage lighting and breathing chrome

- **Stage lighting** re-lights the same canvas instead of moving panels:
  - Make: clay, with wire on the selection.
  - Paint: lit swatch colours.
  - Rig: mesh x-ray at 40 %, joints and controls emphasised; in Skin, the weight ramp.
  - Animate: shaded, with controls drawn as soft halos and part names.

  It is applied as a shell-scoped display overlay through the existing `providePaneDisplay` port and removed when the
  shell is left. Pro's own pane display settings never change.
- **Breathing chrome**: during a live stroke, drag or playback, every cluster except ↶ and ■ Stop fades to 15 % and
  ignores touches. It returns when the finger or Pencil lifts.
- **Hide UI** (View puck › Hide UI, or the project menu) leaves only the canvas and a faint restore button in the
  corner.

---

## 5. Input: gestures, Pencil, Thumb key, numbers

### 5.1 Input roles and routing

| Routing mode (Settings › Input) | Finger | Pencil | When |
|---|---|---|---|
| **Shared** | One finger on something the active tool claims (manipulator, control, joint, component, the mesh under a paint or marker tool) uses the tool; one finger on empty space orbits (ortho panes pan); two fingers pan and pinch | Same as a finger, with finer tolerances | Default until the first `pointerType: 'pen'` event |
| **Pencil edits** | Navigates, taps to select, long-presses for the Halo, scrubs the Thread and chips. Never paints or drags geometry. | Selects, manipulates, paints, marquees, draws key bands, writes in fields | Switched on by the first pen event, with a toast: *"Pencil found: the Pencil edits, fingers move the view. [Keep] [Change]"* |
| **Pencil only** | Navigates only, and taps chrome | Everything on the canvas | Opt-in |

- **Palm rejection.** While the pen is down, or a pen event arrived in the last 500 ms (hover), touches only navigate.
  Contacts larger than 30 px are ignored once a pen has been seen.
- **Mouse and trackpad** keep the user's Pro profile (§4.5). The trackpad's secondary click opens the Halo ring.
- The Settings table lists each action by input (Finger / Pencil / Mouse), and each cell can be remapped as in Nomad.
  Mappings are a Halo preference (`halo.input`) and never touch Pro's `navProfile`.

### 5.2 Gesture vocabulary

Only one- and two-finger gestures are used. Three-, four- and five-finger gestures and the screen edges belong to
iPadOS and are never used.

| Gesture | Finger | Pencil tip | Mouse / trackpad | Visible twin |
|---|---|---|---|---|
| Tap a thing | Select it, open its Halo | Same | Click (setting §4.5) | Tap its row in the Scene sheet or in search |
| Tap the same spot again | Next overlapping candidate | Same | Same | The Loupe list (§5.4) |
| Tap empty space | Clear the selection; a **Reselect** chip shows for 4 s | Same | Same | ⋯ › Select none / Reselect |
| Drag a thing | Its natural manipulation (Shared mode); orbit (Pencil edits mode) | Its natural manipulation (§6.1) | Left-drag | Echo chips and the numpad |
| Drag empty space | Orbit (perspective) or pan (ortho) | Marquee | Left-drag orbits; profile chords | The puck's drag; tray › Select area |
| Two-finger drag / pinch | Pan / dolly | — | Two-finger scroll and pinch, per profile | Puck drag; puck sheet › Zoom |
| Two-finger tap | **Undo**; a toast names the step; keep both fingers down to keep stepping back | — | — | ↶ (and Redo in the toast, plus ↷) |
| Double-tap a thing | **Frame** it (the finger is for the view) | **Grow to its natural unit**: edge → loop, face → shell, control → limb chain, joint → chain, key → its time column | Double-click = grow | Puck centre (frame); selection chip Loop · Shell · Chain (grow) |
| Double-tap empty space | Frame all | — | — | Puck double-tap |
| Quick pinch-in (< 300 ms, released) | Frame all (Settings toggle, default on) | — | — | Puck double-tap |
| Long-press, 450 ms, ≤ 10 pt movement | The Halo as a flick ring at that point; on a list row, key, swatch, chip or channel, its menu | Press-and-hold: same | Right-click | ⋯ on any Halo or chip |
| Press, drag and release / flick | Run the ring slot you released on, without the ring drawing if you are fast (250 ms / 20 px, the marking-menu controller) | Same | Right-drag | Tap the petal |
| Hover | — | Pre-highlight, brush ring and value, loop-cut preview, faint labels of the selected thing's Halo ("ghost Halo") | Pre-highlight, tooltips | None needed (previews only) |
| Pressure | — | Brush strength (weights, colour) | — | ⟨Strength⟩ chip plus the Pressure toggle |
| Thumb key held while acting | A modifier (§5.5) | — | Shift, Cmd and Alt are the same | The Thumb chooser's latched chips |
| Thread: tap · drag playhead · flick playhead · horizontal pinch · two-finger drag · drag the grab bar | Jump · scrub · play · zoom time · pan time · unfold | Pencil drag on the ruler draws a key band | Click, drag, wheel | The Thread's buttons, range brackets and ▴ |
| *Glue (after GA, T15)*: a finger held on a thing while the Pencil acts | Pin or target that thing | — | — | Thumb chooser › Pin; verb → target |

Pencil squeeze, double-tap and barrel roll are never used, because web pages do not receive them. A native wrapper
could later map squeeze to "Halo at the tip" (OQ-12).

### 5.3 Conflicts and how they are resolved

| # | Conflict | Resolution |
|---|---|---|
| C1 | A two-finger double-tap (to hide the chrome) would undo twice before it registered | Dropped. Hide UI lives in the View puck sheet and the project menu. |
| C2 | Double-tap meant both "frame" and "grow to its natural unit" | Split by input: the finger frames (fingers own the view), the Pencil tip grows. With a mouse, double-click grows and the puck frames. Neither has anything to do with the Pencil's hardware double-tap, which the web does not receive. |
| C3 | Long-press against the start of an orbit or drag | A press that moves more than 10 pt before 450 ms is a drag or orbit and never opens the ring. A press held still for 450 ms opens the ring and cancels the drag. |
| C4 | A vertical pinch to unfold the Thread against a horizontal pinch to zoom time | A pinch on the Thread always zooms time. It unfolds only through its grab bar (drag or tap ▴). |
| C5 | Quick pinch to frame all against dolly | Classified on release: under 300 ms, scale below 0.7 and no pan means frame all. Anything else stays a dolly. Settings › Input can turn it off. |
| C6 | The thumb on the Thumb key plus one finger on the canvas looks like a two-finger tap | The recognizer counts only pointers that start on the canvas. Pointers that start on chrome never form multi-touch gestures. |
| C7 | A palm while drawing | Pen priority and large-contact rejection (§5.1). |
| C8 | Multi-select would reopen the Halo on every tap | While Add, Toggle or Remove is held or latched, taps update the Halo in place. Its header shows "5 parts". |
| C9 | An accidental tap on empty space loses the selection; selection changes are not undo steps (Q-ANIM-3) | A **Reselect** chip shows for 4 s and restores the previous selection. Undo semantics stay as they are. |
| C10 | Safari pinch-zooms or scrolls the page | Shell-wide `touch-action: none` with a `gesturestart` `preventDefault`; inputs of at least 16 px. |
| C11 | Pencil Scribble against drawing on the canvas | Scribble works only in a focused text field. The canvas never turns strokes into text. |
| C12 | Keyboard shortcuts drop to the global scope after a finger lifts (hover-based scope) | For non-mouse pointers the host takes the key scope from `lastPanel` (T2, `createHost.ts:233`). |
| C13 | Three-finger redo | Not used. Redo is ↷, the toast's Redo button, or the History ribbon. |

### 5.4 Picking: tolerances and the Loupe

- **Tolerances by `ToolPointerEvent.pointerType`** (T1; Pro benefits too):

  | | Pick radius | Drag slop | Multi-tap window |
  |---|---|---|---|
  | Touch | 22 px | 10 px | 450 ms |
  | Pen | 9 px | 4 px | 350 ms |
  | Mouse | today's values (`viewport/src/theme.ts` PICK, `ComponentPicker` 6–8 px, Graph 4–6 px) | 2–4 px | 400 ms |

  Manipulator handles grow for touch (`view.manipulatorSize` by pointer type).
- **The Loupe.** When the hit candidates within the radius collide (fingers, the face, overlapping control curves), a
  3× magnifier opens above the finger. It shows named candidate chips built from `ViewportManager.pickCandidates`, for
  example `Index 1 · Index 2 · Hand control · Body mesh`. Tap a chip, or slide onto it and lift.

### 5.5 The Thumb key

One 56 pt button in the off-hand lower corner, `⊕`. **Its label always shows what it does right now** in the current
context. It feeds the new `ViewportManager.setModifierSource()` (and the same hook in the curve-editor controllers), so
tools keep their Shift/Mod/Alt semantics and their code does not change.

- **Hold**: the modifier is active for as long as the thumb stays down.
- **Double-tap**: latch it. The key shows a lock, and a canvas-edge tint plus a chip ("Adding ✕") make the state
  visible.
- **Slide up**: the chooser. It shows only the meanings that apply here. A second meaning can be held while another is
  latched, for example Add latched and Fine held.
- **A hardware keyboard's Shift, Cmd and Alt are the same thing.**

| Context | Default label (hold) | Other meanings in the chooser | Pro equivalent it replaces |
|---|---|---|---|
| Selecting (any stage) | **Add** | Toggle, Remove | Shift+Mod / Shift / Mod click |
| Dragging an Echo chip, a key or a handle outside Make | **Fine** ×0.1 | Coarse ×10 | Shift / Mod during a drag |
| Extrude cap handle | **Smart** | Fine | Shift+drag (smart extrude) |
| Joint drag (Rig › Skeleton) | **Alone** (move the joint without its children) | Orient only, Fine | holding D |
| Move/rotate manipulator in Make | **Snap** ▾ (grid · vertex · increment) | Fine, Coarse, Pivot edit | holding X / V / J; Shift / Mod; holding D |
| Soft selection on | **Radius** (drag anywhere to size it) | — | B+drag |
| Merge drag / Weld to… | **Centre** (weld at the midpoint) | — | MMB / Alt+Shift |
| Multi-Cut | **Snap** | Loop (insert a loop) | Shift-click / Ctrl-click |
| Paint Colour | **Fill** (tap fills the shell) | Pick colour | Shift-click / I |
| Paint weights | **Smooth** | Sample, Who owns this? | Shift-paint / I / Shift+I |
| Thread, ruler | **Band** (drag selects a key band) | — | Shift+drag on the time slider |
| Thread, band body | **Copy** (drag copies the keys) | — | Mod+drag |
| Thread, playhead | **Carry** (scrub carries the pose) | — | MMB scrub |
| Curves | **Axis** (lock to time or value) | Fine | Shift on drag |

The mapping from context to flags and label is one data table (`halo/src/input/modifierMap.ts`) keyed by tool id and
phase. A unit test checks every row against the tool's documented modifier semantics (`keymap/toolModifiers.ts`).

### 5.6 Numbers: Echo chips, distance scrub, numpad

- After any operator that declares ParamDefs, its parameters float as chips beside the result: `⟨Segments 2⟩`,
  `⟨Distance 0.12 m⟩`. A transform does the same with live TRS. They are bound to `edit.adjustLast`; while a modal tool
  runs, they are bound to `NumericTarget`.
- **Distance scrub**: drag a chip sideways to change it. The farther the finger moves away vertically, the finer the
  step: ×0.1 at 80 pt and ×0.01 at 160 pt, as in iOS media scrubbers. The Thumb key's Fine works too. This replaces
  Shift/Ctrl precision, Pointer Lock and the virtual slider.
- **Tap** a chip for the numpad:
  - Pencil-sized, 16 px text;
  - minus, decimal point and expressions (`+ − × ÷ ( )`, `=`);
  - units, and ±1 / ±10 nudges;
  - Next / Done, and Scribble.

  It replaces typed numeric capture, the arrow-key nudges and the iPhone decimal keypad, which has no minus.
- Enums become segmented chips and booleans become toggle chips. ⟳ **Again** runs `edit.repeatLast`. **Options**
  saves the current values as defaults (`prefs.set{modeling.optionDefaults}`).
- **Echo chips depend on ParamDefs.** Today graph, key, clip, palette, pose and time operators declare none. T5
  backfills them as a lazy contribution (§20.3 item 6).

### 5.7 Session bar

Every modal tool session — Multi-Cut, Insert Loop, the extrude session, Quick Rig markers, paint, pivot edit, test pose
— shows the session bar at the top of the canvas:

`✕ Cancel · <tool> · <one-line hint> · ✓ Done`, plus `⌫` (remove the last point), `− n +` (counts, replacing PgUp/PgDn)
and the tool's chips (Snap, Loop).

- It replaces Esc, Enter, Backspace, the right-click finish and PgUp/PgDn.
- With a keyboard, Esc is the same as ✕ and Enter the same as ✓.

### 5.8 Keyboard and mouse

- Halo adds a small keymap scope `halo` on top of the Maya preset:
  - Space = play (Halo always plays; Pro's `spaceBehaviour` pref is untouched);
  - Mod+K or `/` focuses search;
  - Ctrl+1–4 switch Path stages (checked against keys Safari reserves; dropped where they collide);
  - Esc and Enter work the session bar.
- Every other Maya binding works as in Pro. A selection made in Halo is the one Pro's hotkeys act on.

---

## 6. The Halo: contextual verbs per object

### 6.1 Grammar rules

- **Tap = select and open the Halo. Drag = the thing's natural manipulation. Long-press = the same verbs as a flick
  ring.** One rule, everywhere: viewport, Thread, sheets, chips.
- The natural manipulation of each noun:
  - control: rotate about its joint (FK), or move (IK goals, root);
  - joint: move with its children;
  - mesh object: move;
  - component: tweak;
  - key dot: retime;
  - curve key: change time and value;
  - band: move;
  - swatch: drop it on a part to colour it.
- **At most 6 petals plus ⋯.** The petals are curated per noun and stage in `halo/src/verbs/table.ts` (data, about
  4 kB). Where a noun matches one of Pro's marking menus (`model.modes`, `model.tools.*`, `model.convert`,
  `model.merge`, `rig.modes`), the petals keep Pro's slot directions, so flicks carry over from Pro.
- **Slots never move.** How often a verb is used may reorder only the ⋯ More list, never the petals.
- After a repeatable operation, the last petal can temporarily become `⟳ Again: Bevel` (`edit.repeatLast`).
- With several things selected, the header reads "3 parts" and only verbs whose poll passes for the whole selection
  appear. When the selection mixes kinds, the header gets a kind switcher (Meshes · Joints).
- The Halo fades while you orbit and comes back when you stop. A tap on empty space dismisses it (§5.3 C9).
- Petals and More rows say what they do in words. Icons are lucide icons kept inside the Halo package; operators'
  `icon` field stays untouched, so `/editor` gains no bytes.

### 6.2 Verb table (first layer; v1 defaults, curated in T6–T9)

The **Pro name** is shown in grey in More and in search, with the hotkey.

| Noun (how you get it) | Drag does | Halo petals, in slot order | Highlights in ⋯ More (the full list is derived, §6.3) |
|---|---|---|---|
| **Empty space**: tap nothing (docked in the tray) | Orbit / marquee | Make: *Add shape ▾*, *Template ▾*, *Reference ▾*, *Select area*, *Paste*, *Show all*. Paint: *Palette ▾*, *Pick colour*. Rig: *Rig it for me*, *Add skeleton ▾*, *Checks*, *All joints*, *Bind skin*. Animate: *+ Move*, *Library*, *Key all*, *All controls*, *Reset pose* | Select all / invert, Pick only… (selection mask), Snap, Selection options, Show ▾ |
| **Mesh object** (Make) | Move | *Edit shape* (to Faces), *Duplicate*, *Mirror*, *Paint* (go to Paint), *Rig it* (go to Rig), ⋯ — on an imported character mesh the first petal is *Make editable* | Delete, Group, Parent to…, Unparent, Combine (2+ meshes; it moves up to a petal), Separate, Symmetrize, Triangulate, Quadrangulate, Cleanup, Freeze / Reset / Apply transforms, Pivot ▾, UV ▾, Normals ▾, Export selected, Hide, Isolate, Properties |
| **Faces** | Tweak | *Pull* (Extrude ⌘E), *Inset*, *Bevel* (⌘B), *Colour* (active swatch), *Delete*, ⋯ | Bridge (rises when two border loops exist), Extract, Duplicate face, Fill hole, Loop · Ring · Shell · Grow · Shrink, Convert ▾, Select by swatch, UV ▾, Reverse normals |
| **Edges** | Tweak | *Loop cut* (Insert Edge Loop), *Bevel*, *Merge ▾*, *Slide*, *Bridge* (two borders), ⋯ | Smooth / Sharp (soften / harden), Normal angle, Offset loop, Connect, Spin, Collapse, Delete edge & vertices, Loop · Ring · Border |
| **Vertices** | Tweak | *Merge ▾* (merge / to centre / by distance), *Weld to…* (Target Weld), *Slide*, *Connect*, *Delete*, ⋯ | Average, Collapse, Delete edge & vertices, Grow · Shrink, Convert ▾ |
| **Image plane** | Move | *Opacity*, *Size*, *Lock*, *Hide*, *Delete*, ⋯ | Offset, Replace image |
| **Character** (the breadcrumb root, or the mesh in Rig › Character) | — | Animate: *Copy pose*, *Paste ▾*, *Mirror ▾*, *Reset to rest*, *Key all*, ⋯. Rig: *Checks*, *Bind / Bind again*, *Make a character* (on loose meshes), *Parts & fingers*, *About this character*, ⋯ | Pin / Plant / Unpin feet, Mirror cycle, Update control rig, Add limb IK, Apply pose as rest, T-stance, Straighten to T-pose, Reset test pose, Render thumbnail |
| **Control / body part** (tap the mesh in Animate) | Rotate (FK) or move (goal) | *Key ◆*, *Mirror ▾* (flip, L→R, R→L), *Reset*, *Copy pose*, *IK⇄FK* (limbs only), ⋯ | Paste, Paste mirrored, Turn / Move / Scale rings, Space ▾, Select chain, Hold pose until…, Channels (Inspector), Hide controls, Rotate order |
| **Foot / IK goal control** | Move | *Key ◆*, *Plant*, *Pin / Unpin*, *Reset*, *IK⇄FK*, ⋯; foot-roll Echo chips: Heel, Ball, Toe, Bank, Twist | Foot pivots, Match now, Match range, Limb (Inspector) |
| **Joint** (Rig › Skeleton) | Move with children | *Turn* (rotate rest), *Orient*, *Mirror*, *Paint its weights*, *Rename*, ⋯ | Alone (toggle), Orient only, Restore bend, Snap to centre, Symmetry X, Humanoid bone ▾, Rest values (Inspector) |
| **Skin spot** (finger-hold on the skin in Rig › Skin) | — | *Who owns this?* (the top 3 influences as chips with values), *Paint* (that bone), *Smooth here*, ⋯ | Set weight… (numeric), Hold, Mirror weights, Prune |
| **Key dot** (Thread or Parts) | Retime | *Ease ▾* (Smooth / Linear / Flat / Step), *Breakdown ⇄*, *Copy*, *Delete*, *Column* (every key at this time), ⋯ | All 9 tangent types, Break / Unify, Weighted, Lock weight, Paste ▾ (merge / replace / insert), ⟨Frame⟩ ⟨Value⟩ fields |
| **Key band** (Pencil drag, or Thumb *Band* + drag on the ruler) | Move (ends: stretch) | *Move*, *Stretch*, *Copy to…*, *Delete*, *Hold pose*, ⋯ | Insert / Remove time, Ease ▾ for the band, Scale values…, Offset values…, Offset in loop (wrap), Match IK/FK over band |
| **Curve** (Curves layer) | Drag keys / handles | *Ease all ▾*, *Simplify* ⟨tolerance⟩, *Euler fix*, *Cycle ▾* (pre / post infinity), *Insert key*, ⋯ | Key curves here, Buffer (snapshot / swap / clear), Weighted curve, Show only this |
| **Channel chip / row** (Echo chip or Channels sheet) | Scrub the value | *Key this channel*, *Lock*, *Reset to default*, *Show only this*, ⋯ | Unlock, Show in Curves, Copy value |
| **Clip chip** (`[Wave ▾]` in the Moves row) | — | *Play*, *Loop it*, *Rename*, *Duplicate*, *Settings*, ⋯ | Duplicate + swap sides, Mirror cycle (half-cycle offset), Use as… (OMOBA slot), Make active, Delete |
| **Library card** (Library drawer) | — | *Preview*, *Speed*, *Trim*, *Swap sides*, *Add*, ⋯ | Stay in place, Arms out, Add starter set, Search, Category |
| **Swatch** (Paint tray) | Drop onto a part = colour it | *Use*, *Edit colour*, *Finish ▾* (Matte / Shiny), *Select faces*, *Replace with active*, ⋯ | Remove, New material (Lambert / Blinn), Gloss ⟨ ⟩, Specular ⟨ ⟩ |
| **Health dot** (on the model; in the Health sheet) | — | *Fix*, *Show me*, *Why?*, ⋯ | The rule id and profile (for developers) |
| **History step** (History ribbon) | — | *Undo to here*, *Compare* (hold), *Revert this*, *Adjust* (the latest adjustable step only), *Show*, ⋯ | Undo all (an AI or recipe group), Copy as text |
| **Camera** (puck sheet › Cameras, or the Scene sheet) | — | *Look through*, *Copy view here*, *Lock*, *Lens ⟨FOV⟩*, ⋯ | Focal length, Clip planes, Ortho height |
| **Manipulator** (long-press it) | Its handle | *Space ▾* (object / world / gimbal), *Size*, *Pivot ▾*, *Drag anywhere* (replaces MMB-anywhere), ⋯ | Pivot centre / bottom / reset / bake / numeric |

### 6.3 ⋯ More, disabled reasons and Options

- **⋯ More** opens the More sheet. It lists every operator the Disclosure Manifest (§20.5) attaches to this noun and
  stage, grouped by category, with a filter field.
  - Each row reads `plain name · Pro name · hotkey`, for example `Pull · Extrude · ⌘E`.
  - Rows whose poll fails stay listed, greyed, with the poll reason inline.
  - Long-press a row to **Pin to Halo**: a per-noun preference that replaces the last free petal.
  - The footer offers *Open this in Studio Pro ↗* (§16).
- **Disabled petals stay visible and greyed.** Tapping one shows its poll reason in place. When an operator can remove
  the reason, the fix is one tap: *"Needs a bound skin · Bind skin ▸"*. There are no hover tooltips anywhere.
- **Options**: long-press a petal and choose Options for its option box, a form rendered from its ParamDefs (shared
  `ParamField`/`OptionBoxView` logic restyled at touch density). It saves to the option defaults.

### 6.4 Verb → target

Verbs that need a second thing enter a *"now tap the target"* state, drawn as a glowing line from the subject to the
finger or Pencil:
- Parent to…, Bridge to…, Weld to…, Copy pose to…;
- Paste pose at… (a Thread time);
- Match IK/FK…;
- Look at… (an aim goal, after GA).

The session bar shows ✕ Cancel. This replaces HTML5 drag-and-drop, modifiers and Outliner drags for edits that involve
two objects.

### 6.5 Breadcrumb and Scene sheet

- **Breadcrumb** (above every Halo):
  - tap a crumb to select that ancestor (pick-walk up);
  - ‹ › step to siblings, and ▾ lists children;
  - ⇄ selects the opposite side (`select.mirror`);
  - long-press selects the whole branch (Select hierarchy);
  - tap the last crumb's name to rename it.

  This replaces the arrow-key pick-walk and the Outliner's hierarchy picks.
- **Scene sheet** (the empty search pill, or project menu › Scene): the Outliner as a list at touch density.
  - Tap a row to select the thing on the canvas and open its Halo.
  - Reorder and reparent by long-press, lift and drop, a pointer-event recognizer, not HTML5 drag-and-drop. *Parent
    to…* is the alternative.
  - Eye icons show and hide.

### 6.6 Inspector (ⓘ)

One sheet shows the selected noun's full properties, by section:
- **Mesh**: name, faceted, budget preset, handheld grip, colour output.
- **Control**: the Channels list, with every channel as a scrub chip, lock state and key state; long-press a row for
  Key this channel / Lock / Unlock / Reset to default; − / + steppers.
- **Limb**: pole, soft IK, twist, IK/FK blend.
- **Foot**: heel, ball, toe, bank, twists and pivots.
- **Joint**: rest translate and rotate, humanoid bone, orient.
- **Camera**: FOV, focal length, clip planes, ortho height.
- **Image plane**, and **Clip**.

It is the touch Channel Box, Attributes and Rig Toolkit fields together, built over the React-free view models
(`@ekza-studio/editor/models`, §20.3 item 9).

---

## 7. The Path: stages, readiness, destinations

### 7.1 Stages

`( Make │ Paint │ Rig │ Animate )` plus `Share ⤴`. A stage is data: `StageDef {workspace, lighting, tray, defaultTool,
verbOverrides, readiness}` in `halo/src/stages/*/stage.ts`. Tapping a stage:

1. leaves any tool session (as ✕ would) and runs `edit.escape`;
2. runs `workspace.set` when the workspace changes, which lazy-loads the kernel chunks exactly as in Pro;
3. applies the stage's lighting overlay, tray and default tool. These are session state only, never undo steps.

| Stage | Workspace | Default tool and mode | Tray |
|---|---|---|---|
| **Make** | `model` | select (object level); Faces after *Edit shape* | component pill, Sym, Soft, Snap, Add ▾, Cut ▾ (Loop cut, Multi-Cut, Slide), Reference ▾ |
| **Paint** | `model` | Paint Colour tool | swatch row, `+`, palette menu, Pick, Fill, Finish, Smooth / Sharp edges |
| **Rig** | `rig` | segment `[Character │ Skeleton │ Skin]` = `rig.mode` object / skeleton / skin | Rig it for me, Checks ⚠n, Add skeleton ▾, Bind, Pose `[Bind│Test│Clip]` (Skin), brush bar (painting) |
| **Animate** | `animate` | select controls | the Thread, Moves row, Library ▸, Tween chip (between keys) |
| **Share** | (unchanged; a sheet) | — | §13.3 |

- **The stages are never gated.** A missing prerequisite shows an empty state that bridges to the next step instead of a
  lock:
  - Animate on a plain mesh: *"Nothing to animate yet → Rig it for me · Try a library move on a sample"*.
  - Paint on an imported character mesh that is not editable: *"Make editable to paint (keeps the rig)"*.
  - Rig on loose meshes: *"Make a character from these"*.
- **Make and Paint share the `model` workspace.** The parity test (§20.5) checks that every tray verb's operator lists
  the stage's workspace, so a stage can never offer an operator whose poll refuses that workspace.
- Mode follows touch inside Rig: tapping a joint enters Skeleton, *Paint its weights* enters Skin, and tapping a mesh
  enters Character. The segment shows the change.

### 7.2 Readiness glyphs and health dots

Each stage node carries a glyph:

| Glyph | Meaning |
|---|---|
| `○` | untouched |
| `◐` | in progress |
| `●` | ready for the destination |
| `⚠n` | n things to fix |
| `·` | not checked yet: its chunk is not loaded |

Readiness is computed by pure functions over the `EditorApp`, never stored, so undo, reloads and edits made in Pro keep
it right:

| Stage | Source (existing) |
|---|---|
| Make | Mesh Check rows; the triangle budget of the destination's profile |
| Paint | Colours assigned; the colour output mode against the destination |
| Rig | `rigChecklist` + Validation rows (`rig.validation.profile` follows the destination) |
| Animate | The clip slots the destination needs; later, loop-seam and foot-slide checks (motion-analysis P4) |
| Share | The destination's export lints and read-back |

- **Health dots** use the same rows, drawn on the actual joint, mesh or face in 3D, each with Fix, Show me and Why?. The
  Health sheet lists them all; tapping `⚠n` on a stage node opens it filtered to that stage.
- **Readiness never forces a chunk to load.** A stage whose kernel chunk is not loaded shows `·`. When a character
  exists, the rig chunk is prefetched at idle (`requestIdleCallback`).
- Readiness never blocks navigation. Only Share's *Save* is gated, by the existing Validation gate and read-back.

### 7.3 Destination first

- Share's header `For: …` sets the destination, which maps to an existing export profile:

  | Destination | Profile |
  |---|---|
  | OMOBA & Ekza Space (VRM 1.0) | `ekza/space-avatar-v1` |
  | Game engine (GLB with moves) | `local/generic` |
  | Just the moves (VRMA) | `ekza/vrma-humanoid-v1` |
  | Prop for OMOBA (static GLB) | `ekza/omoba-handheld-v1` |
  | Into the original file (bake) | the source's profile |
  | **Just exploring** | none |

- **Default ST-4: "Just exploring"**, which shows only Mesh Check errors and no destination nagging. The first time a
  character is rigged, or Share is opened, a one-line card offers a destination.
- The destination is part of the session mirror and is shown as a badge on `Share ⤴`.
- Changing it re-derives every stage's readiness. Every problem row has **Go fix ▸**, which jumps to its stage and
  selects the offending item.

---

## 8. Search or ask: the command bar

`⌕ Do or find…` is always visible, top right. It is the host command palette (`openOverlay(app, 'commandPalette')`,
its data and ParamDef prompts) restyled for touch: 16 px field, 52 pt rows, a sheet on compact layouts.

- **Result groups**:
  - **Do**: operators, with plain label · Pro label · hotkey · *"on a face's Halo"*.
  - **Things**: bones, body parts, controls, meshes, clips, swatches, cameras. Tap one to select it, frame it and open
    its Halo.
  - **Recipes** (§9.11).
  - **Settings**: every pref key.
  - **Help**.
  - **Opens in Pro ↗**: the deliberate hand-offs of §15.15.
- **An empty query** shows the Scene list plus recent verbs.
- **Parameters**: running an operator that has ParamDefs puts its chips inline, filled with defaults, then ✓.
- **Input**: keyboard, dictation (the iPad keyboard's on-device mic) or Scribble.
- **The guarantee**: every live, non-internal operator and every menu item with arguments is here, at any time. It is
  the safety net, **never** counted as parity (§20.5).
- **Phrases** (T13, after GA): an offline, deterministic matcher on top of the same index. It parses numbers and units
  (`0.2 m`, `30°`, `twice`, `at 1.5 s`), resolves body parts with agent-tools' resolver (`bodyPartOf`, VRM humanoid
  names), uses synonyms per stage ("pull" → `mesh.extrude`; "smooth" → weights in Skin, curves in Animate), and
  matches recipes. It never guesses silently: a weak match shows the three nearest verbs and recipes. Phrases
  accelerate; they are never the main way in.
- **Ask AI**: when nothing matches and an agent is paired, *Ask AI* sends the query to the agent (§14). On iPad the row
  says plainly that the assistant works from a computer for now (OQ-5).

---

## 9. Core journeys, tap by tap

A *touch* is one deliberate tap, one drag, or one filled text field, on an iPad with no keyboard. Orbit, pan and zoom
are not counted. "Today" figures are the research estimates for Auto-Rig / Pro. The targets are acceptance AS-ST-4.

### J1 — Bring a model, rig it, take it to OMOBA (new user)

1. Home › **Bring a model** (1) → pick the file in Files (1). The intake sniffs the bytes and routes static GLB to
   `autorig.intake` / `mesh.importStatic`. The heavy-mesh gate and already-rigged detection run silently.
2. Checks run silently and only failures appear, as chips: *"Lies on its side — Fix"* (0–1).
3. The Path shows `Rig ○`; the Next chip says *Rig it for me ▸* (1). Halo's Rig-it sheet runs `skel.quickRig.start` and
   `skel.quickRig.guess` and shows the guessed dots on the model: *"Dots look right? [Rig it] · Adjust dots ▸"*.
4. **Rig it** (1) runs `autorig.rig {straighten}` with a story line: *"Building skeleton… skinning… straightening
   arms"*. The character plays its motion test.
5. *"Add moves?"* card › **Starter set: Idle · Walk · Run** (1), which runs `autorig.clip.add` with slots.
6. **Share ⤴** (1) → the **OMOBA & Ekza Space** card (1). Preparing the file starts immediately.
7. First time only: Author (1). The licence is prefilled as CC0 and can be changed; the thumbnail is automatic.
8. **Save to Files** (1). This is a fresh tap, so the iOS share sheet opens. Then **Save** in iOS (1).

**10 touches** (9 without moves, 11 with a fix). Today: Auto-Rig ≈ 17, Pro ≈ 30. *Adjust dots ▸* hands off to Auto-Rig
② on the same page and comes back with "Back to Studio ▸" (+2). The native dot editor arrives in T14.

### J2 — Model a low-poly character from a template

1. Home › **Make a character** (1) → **Smooth body** (1). The size chip defaults to Standard and Symmetry X is on.
2. Make stage: component pill **Faces** (1) → tap the arm-stub face (1) → **Pull** (1) → drag the cap (1) →
   ⟨Segments⟩ scrub to 2 (1).
3. **Bevel** petal (1) → drag the bevel handle (1).

**9 touches.** Today in Pro: ≈ 13 per edit. Loops: Pencil double-tap on an edge, or the selection chip.

### J3 — Pose and key a two-second wave

1. Animate on Seed-san: **+ Move** (1) → name it "Wave" (1) → length chip **2 s** (1).
2. Tap the right upper arm on the mesh (1) → drag the ring (1).
3. The first unkeyed tweak asks once: *"Record changes as keys? [Turn on Rec]"* (1). From then on, edits key.
4. Tap 0.5 s on the Thread (1) → tap the forearm (1) → drag (1); tap 1.0 s (1) → drag (1); tap 1.5 s (1) → drag (1).
5. Clip chip (1) › **Loop it** (1) → **▶** (1).

**16 touches** (≈ 15 once Rec is on). Today in Pro: ≈ 35. With the T13 recipe "make him wave twice": 3 touches.

### J4 — Fix foot sliding and polish a walk with curves

1. Tap the L foot control (1) → pull the Thread grab bar to **Curves** (1) → channel chips: **Move Y** only (1).
2. Pencil marquee over the contact keys (1) → key-dot Halo **Ease ▾ › Flat** (2) → ⟨Value⟩ chip: type 0 (1).
3. Hold **⇆ Before** to compare (1). Curve Halo **Cycle ▾ › Cycle** for the loop seam, if needed (2).

**8–10 touches.** Today in Pro: ≈ 25–30 precise touches. The automatic *Check feet* waits for motion-analysis P4.

### J5 — Mix clips from the library

1. Animate tray › **Library** (1) → tap **Walk** (1): it plays on your character → expand the card (1).
2. ⟨Speed⟩ scrub (1) → **Stay in place** (1) → **Add** (1).
3. A left/right pair: long-press the clip chip (1) › **Duplicate + swap sides** (1).

**6 touches** (8 with the pair). Today: Auto-Rig ≈ 8, Pro ≈ 12–15 with parameters missing.

### J6 — Colour with swatches and export a GLB

1. Path › **Paint** (1) → tap a swatch (1) → Pencil strokes; double-tap a part with the Pencil to fill it.
2. Long-press the swatch (1) › **Finish › Shiny** (1).
3. **Share ⤴** (1) → **Game engine** (1) → **Save to Files** (1) → iOS **Save** (1).

**8 touches plus strokes** (+1 for *Make editable* on an imported character). Today in Pro: ≈ 25.

### J7 — Fix weights where the arm bends badly

1. Path › **Rig** (1) → Pose segment **Test** (1) → **▶ Bend test** (1) → pause where it breaks (1).
2. Finger-hold the bad spot (1): *Who owns this?* shows `Upper arm 0.72 · Chest 0.28` → tap **Upper arm** (1), which
   opens Paint weights with that influence.
3. Paint with the Pencil (pressure sets strength; Mirror is on) → **▶ Play again** (1).

**7 touches plus strokes.** Today: Auto-Rig ≈ 6 plus strokes; Pro ≈ 15–20, and refused below 1024 px.

### J8 — Ask the AI agent, then review or undo its steps (desktop Chrome/Edge)

1. Search pill (1) → type or dictate *"make him wave twice"* (1) → **Ask AI** (1).
2. First time: the pairing card shows the code to give the agent, then plain grants: *change my animation ✓ · save files
   ☐ · change what I see ☐* → **Allow** (1).
3. The live line reads *"AI is keying R forearm…"*. The result is one History group, *"AI · Wave twice · 5 steps"*,
   with **Undo all** (1), **Compare** (hold) and Steps ▾.

**4–5 touches.** On iPad: an honest card plus the offline recipe (T13). Live AI on iPad is OQ-5.

### J9 — Continue the same project in Studio Pro

- **Same device**: **Pro ↗** (1). Pro opens on the matching workspace with the same selection, time and camera, and the
  toast *"Same project, all tools · Undo still works"*. Back: Pro › Help › *Switch to Ekza Studio* (2), or its
  status-line button (1).
- **Another device**: project menu › **Save to Files** (2) → on the desktop, drop the file or Open (2). A banner says
  *"Opened 'Cube Lad' from iPad — undo history starts here"* (ADR 0011).

### J10 — Resume after a reload or from autosave

- If the tab reloads while a project is open (iPadOS does this under memory pressure), the session mirror names the
  project and Halo restores it silently: the same stage, time, selection and camera, with the toast *"Back where you
  were · 2 min ago"*. **0 touches.**
- Otherwise Home shows **Continue** (1). There is no Recovery dialog.
- At the first save, a card offers *"Keep projects on this iPad"*: it calls `storage.persist()` and gives an *Add to Home
  Screen* hint.

### 9.11 Recipes (guided flows over the free canvas)

- A recipe is data: steps of `{plan (operator calls), done check (poll / Validation row / progress predicate), view hint,
  hands-on tool, one-sentence reason}`. Every step is an ordinary undoable operator run.
- A running recipe shows a compact stepper card (*"Rig this character · 2 of 4"*) that can be collapsed or left at any
  step. Its progress is mirrored to sessionStorage and a *Resume* chip stays.
- **v1 recipes:**
  - *Rig it for me* (J1);
  - *Add moves* (the starter set);
  - *Make a character* (J2 start);
  - *Fix for OMOBA*: each Share problem with Fix;
  - *Fix where it bends badly* (J7);
  - *Loop it*: `clip.makeLoop`.
- **After GA (T13):**
  - *Wave · Nod · Breathe*, from the deterministic agent-evals reference script (only `wave` is executable today;
    `nod` and `breathe` need small generators);
  - *Walk cycle* and *Polish*, which wait for motion-analysis P4 or an LLM tier.

  Recipes and the MCP prompts share one registry, so a person tapping and an agent calling run the same steps.

---

## 10. Animation UX

### 10.1 Posing

- Tap a body part on the mesh. The existing rule that a mesh click selects its control picks the control. Controls are
  drawn as large, soft halos labelled with part names.
- The breadcrumb names the part in words (*"Right arm › Forearm"*), and the fitting manipulator appears: a rotate ring
  for FK controls, move for IK goals and the root.
- **Drag** the ring or the limb with the Pencil or a finger. Long-press the manipulator for Space (object / world /
  gimbal), Size, Pivot and *Drag anywhere*.
- **Echo channel chips** show the 2–3 dominant channels in plain words: ⟨Bend⟩ ⟨Twist⟩ ⟨Side⟩, or ⟨Pos⟩ for goals. The
  full list is the Inspector's Channels section (§6.6).
- **Pose verbs**: Copy pose, Paste, Paste mirrored, Mirror ▾ (flip / L→R / R→L), Reset, Reset to rest; for feet, Pin,
  Plant and Unpin.
- **IK⇄FK** is a petal on limb controls: `rig.ikFk.switch` with matching. The key mode (auto / seamless / none) is under
  its long-press. Match now and Match range are in More.
- **After GA (T15)**:
  - *Reach*: drag a hand, foot, head or hips and the body follows, through the public wrapper over `pose.goals`. One
    drag is one undo step.
  - *Glue*: a finger held on another part pins it.

### 10.2 Keying

- `◆+` on the Thread and the *Key ◆* petal run `key.set` for the key target. Long-press ◆+ for:
  - Key all / Translate / Rotate / Scale / Attributes;
  - Selected channels;
  - Breakdown;
  - Key target (this part / body part / whole character).
- **`● Rec` is the shared `autoKey` pref, shown as it is.** Halo never turns it on silently, because Pro reads the same
  flag. The first unkeyed tweak in Animate asks once: *"Record changes as keys? [Turn on Rec] [Not now]"* (ST-10,
  OQ-4). While it is on, a red Rec chip and a thin red canvas edge show it.
- **Unkeyed tweaks** (session overrides) show `● not keyed · Key · Discard` beside the part.

### 10.3 The Thread (layer 0)

Halo's own small Canvas2D strip over the timeline view models. It is eager, and it never imports Pro's `TimeSliderView`.

| Element | Behaviour |
|---|---|
| Scale | Seconds first (`0.5 s`). Frames appear as you zoom in; long-press the readout for "Frame 18 · 30 fps". Beat ticks every 0.25 s snap; Thumb *Fine* snaps to single frames. |
| Key dots | Only the selection's keys, plus a faint summary row when nothing is selected. Hollow dots are breakdowns. |
| Playhead | Tap the ruler to jump; drag the playhead to scrub; Thumb *Carry* + drag scrubs while carrying the pose; flick the playhead to play. |
| Buttons | `⏮ ◆◂ ▶ ▸◆ ⏭`: start, previous key, play, next key, end. Long-press ▶ for loop / once / oscillate, play backwards and speed (0.25×–2×). |
| Range | Long-press empty Thread space to show the range brackets: drag them for the playback range; long-press a bracket for *Set as clip range*. |
| Band | A Pencil drag along the ruler, or Thumb *Band* + a finger drag. Drag the body to move, drag the ends to stretch, Thumb *Copy* + drag to copy. The band's Halo is in §6.2. |
| Tween | When the playhead sits between two keys, a ⟨Tween 50 %⟩ chip appears: `key.tween`. A segmented control picks tween / toward neighbour / ease / push-pull / to default; scrub past either end for overshoot. |
| Zoom | Horizontal pinch zooms time; a two-finger drag pans it. |
| Unfold | Drag the `═══ ▴` grab bar up: layer 1 (Parts), then layer 2 (Curves). Tap ▴ to step up. |

### 10.4 Parts (layer 1, the Dope Sheet)

- Rows go Summary → body part → control → channel, each at least 36 pt tall, over Pro's `DopeSheetController` behind a
  touch adapter (§20.3 item 8).
- Fingers scroll the rows and pan or pinch time; the Pencil selects and moves keys, and a Pencil marquee box-selects.
- The header holds a select / move / scale segmented control, a Ripple chip (`key.toggleRipple`), the region bar and
  ‹ › nudges. Double-tap frames.

### 10.5 Curves (layer 2, the Graph Editor)

Pro's `GraphEditorController` behind a touch adapter. Its view state persists through a callback, not dockview panel
params.

- **Channels**: chips such as `Move X ● Move Y ● Turn…`, *Keyed only*, a filter field, and multi-control curves (the
  rows selected in Parts).
- **Gestures**:
  - the Pencil drags keys and tangent handles, and a marquee box-selects;
  - two fingers pan and pinch time and value;
  - the axis locks automatically after 8 pt of travel, and the ⟨Axis⟩ chip or Thumb *Axis* switches between time,
    value and free.
- **Fields**: Echo chips ⟨Frame⟩ ⟨Value⟩ ⟨In angle⟩ ⟨Out angle⟩ ⟨In weight⟩ ⟨Out weight⟩ for the selected keys.
- **Ease**: Smooth (auto), Linear, Flat, Step, plus in More: Spline, Clamped, Plateau, Stepped next, Fixed; Break,
  Unify, Weighted, Lock weight (`graph.tangent.*`, `graph.curve.setWeighted`).
- **Curve tools**: *Simplify* ⟨tolerance⟩, *Euler fix*, *Cycle ▾* (pre/post: constant, linear, cycle, cycle with
  offset, oscillate), *Key curves here*, *Insert key* (a petal on the curve).
- **Compare**: hold *⇆ Before* to see the buffer snapshot taken automatically when Curves opened. Snapshot, Swap and
  Clear are in More.
- **Views**: Abs │ Norm │ Stack. Double-tap frames the selection; double-tap empty space frames all.
- **Paste**: merge / replace / insert from the key or band Halo.
- **Open in Pro ↗** opens Pro's Polish preset framed on the same curves (`then: preset`, §16). It is a convenience
  only: everything above works in Halo.

### 10.6 Clips and the library

- **Moves row**: clip chips above the Thread.
  - Tap a chip to make it active.
  - `+ Move` asks for a name and a length (1, 2 or 4 s).
  - The clip Halo (§6.2) holds Settings: fps (keep seconds or frames), range, scene start, loop, root motion, contact
    frame, tags, provenance and redistribution.
- **Library drawer**: the 14 CC0 clips, with search and categories.
  - Tap a card to play it on your character at once.
  - Expand a card for Speed (a dial), Trim (on the strip), *Swap sides*, *Stay in place* and *Arms out*, all previewed
    live (`library.useClip {params}`, `autorig.clip.add`).
  - *Add*, or *Add starter set* (Idle · Walk · Run, with slots).
  - *+ From file* imports `.vrma` or an animation GLB.
- **Two mirrors, two names**: *Swap sides* is Auto-Rig's left/right swap. *Mirror cycle* is Pro's Mirror Animation with
  its half-cycle offset (`pose.mirrorAnimation`). Each shows its Pro name in More.
- **Loop it**: `clip.makeLoop`, through a public wrapper; it is AI-only today (§20.3 item 7).

### 10.7 Later (designed in, not in GA)

- **Perform** (T16): hold ● on a part, then drag it while time plays at 0.25–1×. Lifting pauses. A pass of the same type
  overwrites; a pass of a different type adds. The take is simplified to sparse keys (`graph.curves.simplify`) and lands
  as one undo step. It needs a new kernel operator for sampled writes.
- **Ghosts and motion trails**: when M2c lands, with the Pencil able to edit a trail.
- **Check feet**: contact bars and slide in cm on the Thread, plus *Fix all slides*, once motion-analysis P4 lands.

---

## 11. Modeling on touch (Make)

- **Component levels**: the tray pill `[Whole │ Points │ Edges │ Faces]` (`select.mode`). A Pencil double-tap grows to
  a loop or a shell. The selection chip offers Loop · Ring · Border · Shell · Grow · Shrink, and Convert ▾ is in More.
- **Create**: tray *Add ▾* for primitives (cube, sphere, cylinder, cone, plane, torus); live parameters appear as Echo
  chips (`mesh.primitive.set`). Templates come from *Add ▾* or Home. *Reference ▾* adds front, side and top image
  planes.
- **Edit**: Pull, Inset and Bevel are face and edge petals with on-canvas handles, plus Echo chips.
  - Extrude keeps its session semantics: cap handles, one undo step per drag, Smart on the Thumb.
  - *Loop cut* previews under Pencil hover. With a finger it previews on press and slide and commits on lift.
  - *Multi-Cut* (tray Cut ▾): taps place points; the session bar has ✓ Done, ⌫ and the Snap / Loop / Centred chips.
  - The Merge family and *Weld to…* (verb → target) have an ⟨At midpoint⟩ chip.
- **Symmetry** is a tray chip, on by default for templates; axis and tolerance are in its options. Every tool mirrors.
- **Snap and pivots**: Thumb *Snap ▾* (grid / vertex / increment; a double-tap makes it sticky). Pivot ▾ is on the
  manipulator's long-press: centre, bottom centre, reset, bake, an edit handle, and numeric values in the Inspector.
- **Health**: the budget ring (`812 / 3,000`) and health dots from Mesh Check on the offending faces and edges, each with
  Fix / Show me / Why?. The poly-count HUD becomes the ring.
- **Scene**: the Scene sheet replaces the Outliner (§6.5). The Inspector holds mesh attributes.
- **Imported character meshes**: the first petal is *Make editable*, and its report opens in a sheet. A static GLB comes
  in through *Bring a model*, the first non-Auto-Rig path for `mesh.importStatic`.

---

## 12. Rig and skin on touch (Rig)

### 12.1 Segments and checks

- `[Character │ Skeleton │ Skin]` is `rig.mode`, and it also follows what you touch (§7.1).
- *Checks ⚠n* lists the rig checklist and Validation rows in plain words, each with Fix. It includes the stand-up,
  set-height and freeze fixes, which today exist only in Auto-Rig and MCP (`autorig.fix`).
- The same rows are health dots on the joints and meshes concerned.

### 12.2 Rig it for me (v1)

1. Runs `skel.quickRig.start` + `skel.quickRig.guess`. The finger-detail preset is a chip: mittens / thumb / all.
2. Draws the guessed dots on Halo's canvas (the Quick Rig marker layer).
3. **Rig it** runs `autorig.rig` (straighten when the input was A-posed, rigid parts when there are several meshes).
4. The motion test plays.

- *Adjust dots ▸* navigates to Auto-Rig ② (`from:'halo'`) on the same page. Auto-Rig shows *Back to Studio ▸*, and the
  document, history and camera survive.
- Parts and rigid separate parts are a chip on the character Halo (*Parts & fingers*).
- T14 replaces the hand-off with dot dragging in Halo: one 3D view plus a side inset pane (`pane-side`) for depth, and
  Re-guess. Recipes and progress come from `editor-core/src/progress` (moved from Auto-Rig in T5), so Halo rigs and
  Auto-Rig rigs stay identical.

### 12.3 Skeleton and joints

- Drag a joint to move it with its children. Thumb *Alone* moves it alone; *Orient only* is a toggle.
- The Turn petal rotates the rest pose; numeric rest values are in the Inspector.
- Orient, Mirror, Symmetry X, Restore bend and Snap to centre are joint verbs. Rename by tapping the crumb; Humanoid
  bone ▾ is in More.
- Skeleton templates: Rig empty state › *Add skeleton ▾*, named Simple / Standard / Full / Full with fingers. The joint
  counts are shown in grey.
- A-pose path: a Fix chip, *Straighten to T-pose*. More holds Apply pose as rest and T-stance.

### 12.4 Weights: the break-finder flow

1. **Find it.** Pose segment **Test**, then ▶ *Bend test*: the motion test, or a ⟨Bend <joint>⟩ scrub chip that replaces
   the E-key ring. In Test, dragging any joint test-rotates it and never writes a key.
2. **Name it.** Finger-hold the bad spot: *Who owns this?* shows the top three influences with their values at that
   point. This covers `skin.influence.pickDominant` and `skin.paint.sample`, without I or Shift+I.
3. **Paint it.** Tap a bone. The brush tray shows:
   - the mode `[Replace │ Add │ Scale │ Smooth]`;
   - ⟨Size⟩ ⟨Strength⟩ ⟨Value⟩, replacing B/M/N + drag;
   - Pressure ◉, Mirror ◉ (on by default), Flood, and Show ▾ (greyscale / ramp / influence colours / off);
   - ⋯ for falloff, surface/volume, front only and paint/select.

   The card *"This area follows: ● Upper arm L · ○ Chest"* swaps between the two bones; ‹ › walks the influence list;
   *All bones* opens the full list with Hold, Hold all and Release all locks.
4. **Check it.** ▶ *Play again*.

- **Pencil pressure** sets stamp strength. Strokes are filled in with coalesced events where present and interpolated
  stamps, so fast strokes at Safari's ~60 Hz leave no gaps. Pressure is folded into `StrokeStamp.strength` at stamp
  time, so `skin.weights.paint` arguments, replay and MCP determinism stay unchanged (T9, AS-ST-16).
- **Fix weights** (More): Mirror, Smooth, Prune small, Normalize, Remove unused. **Set weight…** on a vertex selection
  in paint-select mode opens the numpad (`skin.weights.set`), the first UI for that operator.
- **Bind**: the Skin empty state *Bind skin* (options on long-press), *Bind again*, and Unbind in More.

---

## 13. Paint, shading, export and Share

### 13.1 Paint (colour)

- **The swatch row** is always visible in Paint.
  - Tap a swatch to make it active; `+` adds one.
  - Pencil strokes paint faces; a Pencil double-tap on a part fills its shell (Thumb *Fill* + tap does the same).
  - On a face selection, *Colour* assigns the active swatch.
  - The Pick chip, or the first petal of a finger long-press on the mesh, samples a colour.
- **Swatch Halo**: Edit colour (picker + hex), Finish Matte / Shiny (Lambert / Blinn in grey) with ⟨Gloss⟩ and
  ⟨Specular⟩, Select faces, Replace with active, Remove, New material. There is no right-click.
- **Palette menu** (the name chip): New, Duplicate as variant, Rename, Assign to mesh.
- **Lighting**: Paint is lit by default (Blinn preview). Flat / smooth is in the View sheet.
- **Normals**: edge petals Smooth / Sharp; Normal angle, Reverse and Conform are in More.
- **UVs**: More › UV ▾ (planar / box / cylindrical). There is no UV editor in either shell.

### 13.2 Colour output

Share › card › Advanced › *Colours as*: palette texture / vertex colours / one material per colour. The palette menu
holds the same option.

### 13.3 Share (destination first)

Share is a sheet over any stage (wireframe F).

- **Destination cards** (§7.3):
  - OMOBA & Ekza Space → `file.exportCharacter` VRM 1.0, or `autorig.export`;
  - Game engine → GLB with moves;
  - Just the moves → `file.export` VRMA;
  - Prop for OMOBA → `file.exportModel`;
  - Into the original file → bake;
  - *More formats ▸*: VRM 0.x kept, rigged GLB, OMOBA local test kit (`.zip`), animation-only GLB.
- **Each card** shows `Ready ✓` or `n things to fix ▸`, built from Validation, the export-profile lints and read-back,
  with *Go fix ▸* per row.
- **Fields**: Name, Author (asked once), Licence (prefilled CC0 and changeable, Q-SKIN-3; the user confirms it), an
  automatic thumbnail (`char.renderThumbnail`), and the moves with their slots.
- **Advanced ▾** holds every export option: profile, key reduction, root motion / in place, close loops, Euler filter,
  constant tracks, colour output, lit / unlit, handheld profile and the licence acknowledgement.
- **Saving on iOS takes two steps.** Choosing a card starts the bake or zip at once. *Save to Files* becomes active when
  the file is ready; that tap is a fresh user activation, which `navigator.share({files})` needs. Elsewhere it is a
  download.
- **The gate**: the existing Validation gate and read-back block *Save*, and the reason is shown plainly.
- **Publish to Ekza Hub** stays hidden until M4a, as in Pro.

---

## 14. The AI agent in-app

- **Entry**: `⌕ Do or find…` › *Ask AI* on a no-match query, or project menu › *AI agent*. It opens the **Ask sheet**,
  which reuses the existing Agent panel body (lazy) at touch density.
- **Desktop Chrome/Edge (works today)**:
  - The pairing card shows the one-time code.
  - Grants are plain toggles: *change my animation* = Edit, *save files* = Files + Workspace, *change what I see* =
    View, and Read always.
  - Pause, Resume and Disconnect are in the sheet. Confirm cards appear inline.
  - A live activity line sits under the search pill.
- **History**: every agent call lands as one History group (*"AI · Wave twice · 5 steps"*) with Undo all
  (`edit.revertSteps`; M-AI-INT-7 semantics), Compare and Steps ▾.
- **iPad, today**: the loopback bridge cannot be reached from Safari (https → `ws://` is mixed content, and the agent
  runs on another machine). The Ask sheet says *"The AI assistant runs on your computer for now"*, offers the offline
  recipes (T13), and never shows a broken Connect button.
- **iPad later (OQ-5)**, one of:
  - a `wss` relay with the existing pairing code;
  - an in-app Assistant through an Ekza server proxy (ADR 0018 §7, ADR 0017), which changes the "nothing uploaded"
    promise;
  - desktop-only AI.
- **What the agent can do** is unchanged: the 37 MCP tools and the prompts. Recipes share the prompts' registry
  (§9.11).

---

## 15. Capability coverage map (all 191 inventory rows)

**Depth codes:**

| Code | Meaning |
|---|---|
| **L0** | On screen with no tap, or the gesture itself |
| **L1** | One tap or long-press on the thing or on a visible control: Halo petal, chip, tray, Path, Thread button |
| **L2** | A second step: ⋯ More, a sheet section, or a chip's long-press menu |
| **L3** | Search only. Allowed only for developer items, and listed |
| **Pro** | A deliberate hand-off of a *presentation*. The operators stay runnable from search, marked "Opens in Pro ↗" |
| **n/a** | Not shipped in any shell yet (planned, hidden or unregistered) |

Search reaches every live operator by name at any time and is never counted here. Row numbers follow the inventory of
2026-10-24 (`dev` @ `0512ba88`). The *Pro gap closed* column marks rows that in Pro need a keyboard, hover, right-click,
middle-click or a modifier.

### 15.1 Navigate, view, workspace (22)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 1.1 | Orbit / pan / dolly | One-finger orbit on empty space, two-finger pan and pinch, View puck drag; mouse follows the user's profile | L0 | Alt / MMB / wheel → touch (B1) |
| 1.2 | Frame selection / all | Finger double-tap on the thing / on empty space; puck centre tap / double-tap; quick pinch | L0 | — |
| 1.3 | Look through view preset / shot camera; camera radial | Puck faces (front / side / top / persp); puck long-press › Cameras | L0 / L1 | The Space-hold radial is replaced by the puck |
| 1.4 | Copy view to shot; camera lock | Camera Halo / puck sheet › Cameras | L2 | — |
| 1.5 | Camera settings | Camera Halo › Lens chip; Inspector › Camera | L2 | — |
| 1.6 | Viewport layouts | View sheet › Panes 1 · 2 · 4 (Wide); Rig front/side preset; Compact: 1 pane + switcher | L2 | Rig-markers layout via Rig it (Auto-Rig ② in v1) |
| 1.7 | Maximize pane / panel | In 2- or 4-pane views: ⤢ in the pane corner; sheets have a full height | L1 | Space-over-panel (K+H) is not needed |
| 1.8 | Shading | Stage lighting by default; puck sheet › Look segmented control | L1 | — |
| 1.9 | Display toggles (20) | Puck sheet › Show: essentials (X-ray, Skeleton, Controls, Grid, Joints) at L1, the rest at L2 | L1 / L2 | Joint labels "on hover" become "on selection" for touch |
| 1.10 | Hide / show / isolate | Hide and Isolate in ⋯ More on every noun, in every stage; a state chip *"N hidden · Show all"* | L2 / L0 | Rig's K-or-RMB-only path is closed |
| 1.11 | Manipulator size and space | Size follows pointer type automatically; manipulator long-press › Space, Size | L1 | — |
| 1.12 | Selection mask | Empty-space tray › Pick only…; Loupe filter | L2 | — |
| 1.13 | Workspace switch | The Path | L0 | — |
| 1.14 | Dock panels: show, reset, drag / split / float | Sheets replace docks. `workspace.showPanel` maps panel ids to Halo sheets (meshCheck → Health, clipLibrary → Library, paintWeights → brush, …); docking itself goes to Pro | **Pro** | Docking (§15.15 a) |
| 1.15 | Layout presets | — | **Pro** | §15.15 a |
| 1.16 | Focus, full screen, chrome toggles | Hide UI (puck sheet, project menu); Full screen in the project menu (Home Screen mode recommended on iPad); chrome toggles go to Pro | L1 / L2 / **Pro** | Chrome toggles: §15.15 a |
| 1.17 | Command palette | `⌕ Do or find…` | L0 | Mod+K only → visible pill |
| 1.18 | Marking menus | Halo ring (long-press, right-click, flick) from the same MarkingMenuDef data | L1 | RMB / Shift / Ctrl+RMB → long-press |
| 1.19 | Repeat / adjust last / last tool | ⟳ Again petal, Echo chips, History › Adjust; the tray remembers the last tool | L0 / L1 | G / T / Y in Rig → visible |
| 1.20 | Help, shortcuts, About, Help Line, HUD, modal readout | Project menu › Help (gesture card, Pro shortcut sheet, About); budget ring; Echo chips | L2 / L0 | — |
| 1.21 | Mode chooser and hand-off | `/` chooser; Pro ↗; Rig it for me → Auto-Rig ② | L0 / L1 | — |
| 1.22 | Disabled reasons; menu context | Tap a greyed petal for the reason inline plus a one-tap fix; verbs act on their noun, never on a hovered panel | L1 | Hover tooltips → inline |

### 15.2 Select (15)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 2.1 | Click / marquee select | Tap; Pencil drag on empty space; with a finger, tray › Select area or Thumb *Add* + drag | L0 / L1 | — |
| 2.2 | Add / toggle / remove | Thumb key: hold for Add; the chooser has Toggle and Remove; double-tap latches | L0 | Shift / Mod → Thumb |
| 2.3 | Click-cycling; mesh click → control | Tap again; the Loupe | L0 | — |
| 2.4 | All / none / invert / mirror | Tap empty for none (with Reselect); tray › Select all; More › Invert; breadcrumb ⇄ for mirror | L1 / L2 | — |
| 2.5 | Pick-walk | Breadcrumb ‹ › ▴ ▾ | L1 | Arrow keys → breadcrumb |
| 2.6 | Component mode | Make tray pill; Rig segment | L0 | — |
| 2.7 | Loop / ring / border / shell | Pencil double-tap (loop / shell); selection chip Loop · Ring · Border · Shell; the double-click variants are its long-press options | L0 / L1 | Mod double-click variants → chip |
| 2.8 | Grow / shrink | Selection chip − + | L1 | — |
| 2.9 | Convert selection | More › Convert ▾ | L2 | — |
| 2.10 | Select by swatch; Mesh Check offenders | Swatch Halo › Select faces; health dot › Show me | L1 | — |
| 2.11 | Soft selection | Tray Soft chip + an on-canvas radius ring (Thumb *Radius*); falloff in the chip's options | L1 / L2 | B + drag → Thumb / ring |
| 2.12 | Style, camera-based, backfaces, constraints | More › Selection options | L2 | — |
| 2.13 | Key, curve, channel and time-band selection | Thread, Parts, Curves (Pencil tap and marquee), Channels; band by Pencil or Thumb *Band* | L0 / L1 | Shift band → Pencil / Thumb |
| 2.14 | Selection undo (Model, Rig) | ↶ / two-finger tap | L0 | — |
| 2.15 | Select hierarchy | Breadcrumb long-press › Select branch; Scene row | L1 | RMB-only → long-press |

### 15.3 Model (27)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 3.1 | Primitives with live parameters | Make tray › Add ▾ → Echo chips (`mesh.primitive.set`) | L1 | — |
| 3.2 | Templates | Home › Make a character; Add ▾ › Templates | L1 | — |
| 3.3 | Reference image planes | Reference ▾ (front / side / top); the image plane's Halo (Opacity, Size, Lock, Hide, Delete) and Inspector | L1 / L2 | — |
| 3.4 | Group, parent, unparent, duplicate, rename, delete | Duplicate and Delete petals; More › Group, *Parent to…* (verb → target), Unparent; rename via the crumb; Scene sheet long-press lift | L1 / L2 | Unreliable HTML5 drag-and-drop → recognizer / verb → target |
| 3.5 | Object transform; numeric TRS | Drag = move; Turn / Scale rings in More; Echo TRS chips; Inspector | L0 / L1 | — |
| 3.6 | Component transform, tweak, MMB along last handle | Drag components; manipulator handles; manipulator long-press › *Drag anywhere* | L0 / L1 | MMB → Drag anywhere |
| 3.7 | Fine / coarse drag; typed values while dragging | Thumb *Fine* / *Coarse*; distance scrub; tap the readout for the numpad | L0 / L1 | Shift / Mod / digits → Thumb / numpad |
| 3.8 | Virtual slider | Echo chips | L0 | MMB → chips |
| 3.9 | Extrude session (caps, divisions, smart) | *Pull* petal → cap handles, ⟨Segments⟩; Thumb *Smart* / ⟨Smart⟩ chip | L1 | Shift + drag → Thumb |
| 3.10 | Inset / Bevel | Face and edge petals, handle + chips | L1 | — |
| 3.11 | Bridge / Connect / Fill hole / Average | Bridge petal (two borders); More (Connect, Fill hole, Average) | L1 / L2 | — |
| 3.12 | Insert / offset edge loop | *Loop cut* petal (Pencil hover or press-and-slide preview); More › Offset loop | L1 / L2 | Hover preview → press preview |
| 3.13 | Multi-Cut | Tray Cut ▾ › Multi-Cut; session bar ✓ / ✕ / ⌫; Snap / Loop / Centred chips | L1 | RMB / Enter finish, Backspace, Shift / Ctrl-click → bar |
| 3.14 | Slide edge / vertex | Edge and vertex petal *Slide* | L1 | — |
| 3.15 | Merge family; Target Weld | *Merge ▾* petal; *Weld to…* (verb → target) with ⟨At midpoint⟩ | L1 / L2 | MMB / Alt + Shift → chip |
| 3.16 | Delete components / edge & vertex | *Delete* petal; long-press › Delete edge & vertices | L1 | — |
| 3.17 | Extract, Duplicate face, Flip / Spin edge | More › Edit | L2 | — |
| 3.18 | Combine, Separate, Mirror, Symmetrize, Triangulate, Quadrangulate, Cleanup | *Mirror* petal; *Combine* rises with 2+ meshes; More › Mesh; Cleanup also as a Health fix | L1 / L2 | — |
| 3.19 | Per-mesh symmetry | Tray Sym chip; axis and tolerance in its options | L0 | — |
| 3.20 | Snapping | Thumb *Snap ▾*; tray Snap chip (sticky) | L1 | Held X / V / J → Thumb |
| 3.21 | Pivots | Manipulator long-press › Pivot ▾; Thumb *Pivot edit*; Inspector numeric | L2 | Held D / Insert / Home → Pivot ▾ |
| 3.22 | Freeze / reset / apply transforms | More › Transforms | L2 | — |
| 3.23 | Make Editable (+ report) | First petal on an imported character mesh; Paint empty state | L1 | — |
| 3.24 | Static GLB import | Home › Bring a model; project menu › Import | L1 | Was Auto-Rig-only |
| 3.25 | Mesh attributes | Inspector › Mesh; rename via the crumb | L2 | — |
| 3.26 | Mesh Check + poly-count HUD | Health dots + budget ring (L0); Health sheet with Fix / Show me | L0 / L1 | — |
| 3.27 | Option boxes; modal keys | Long-press a petal › Options; session bar − n + / ✓ / ✕ | L1 / L0 | PgUp / PgDn / Esc / Enter → bar |

### 15.4 UV, shade, colour (11)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 4.1 | UV projections | More › UV ▾ | L2 | No UV editor anywhere |
| 4.2 | Normals | Edge petals Smooth / Sharp; More › Normals (angle, reverse, conform) | L1 / L2 | — |
| 4.3 | Palettes | Paint palette chip › New / Duplicate as variant / Rename / Assign | L1 / L2 | — |
| 4.4 | Swatches: add, edit, remove, replace, remap | `+` (L0); swatch Halo: Edit colour, Replace with active, Remove | L1 | RMB-only Remove / Replace → Halo |
| 4.5 | Active swatch, recents, eyedropper | Swatch row; Pick chip; first petal of a long-press on the mesh in Paint | L0 / L1 | I key → Pick |
| 4.6 | Assign colour to a selection | Face petal *Colour*; tray *Fill selection* | L1 | — |
| 4.7 | Paint brush / Fill shell | Strokes; Pencil double-tap on a part, or Thumb *Fill* + tap | L0 / L1 | Shift-click → Pencil / Thumb |
| 4.8 | Swatch shader (Lambert / Blinn, gloss, specular) | Swatch Halo › Finish ▾ + chips | L1 / L2 | — |
| 4.9 | Assign new material | Swatch Halo › More › New material | L2 | — |
| 4.10 | Colour export mode | Share › Advanced › Colours as; palette menu | L2 | — |
| 4.11 | Flat / smooth / Blinn preview | Paint lit by default; puck sheet › Look | L1 | — |

### 15.5 Rig (17)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 5.1 | Rig modes | Segment, and mode-follows-touch | L0 | — |
| 5.2 | Character from selection; adopt | Mesh petal *Make a character* in Rig; Rig empty state | L0 / L1 | — |
| 5.3 | Model checks and fixes (incl. stand up, set height, freeze) | Health dots, Checks ⚠n, Fix chips (`autorig.fix`) | L0 / L1 | Was Auto-Rig / MCP only |
| 5.4 | Quick Rig markers | *Rig it for me* (guess, dots, Rig it); *Adjust dots ▸* → Auto-Rig ② in v1, native in T14 | L1 | — |
| 5.5 | Skeleton templates; add missing bones | Rig tray › Add skeleton ▾; Fix chip | L2 / L1 | — |
| 5.6 | Create skeleton / one-click auto-rig | *Rig it* | L1 | Mod + Enter → button |
| 5.7 | Joint edits (move with children / alone, rotate rest, re-orient, numeric rest) | Drag; Thumb *Alone* / *Orient only*; *Turn* petal; Inspector | L0 / L1 / L2 | Held D → Thumb |
| 5.8 | Orient, Mirror, Symmetry X, restore flexion, snap to centre | Joint petals (Orient, Mirror); More | L1 / L2 | — |
| 5.9 | Rename joint; map humanoid bone | Crumb name; More › Humanoid bone ▾ | L1 / L2 | — |
| 5.10 | A-pose path | Fix chip *Straighten to T-pose*; More › Apply pose as rest, T-stance | L1 / L2 | — |
| 5.11 | Update control rig; add limb IK | Character Halo (Rig) › More | L2 | — |
| 5.12 | Controls: secondary visibility, size, rotate order | Puck sheet › Show › Secondary; control More › Size, Rotate order | L2 | — |
| 5.13 | Joint display | Puck sheet › Show › Joints (size, x-ray, axes, labels) | L2 | — |
| 5.14 | Validation and the rig checklist | Path glyph, health dots, Checks sheet with profile switch, Share readiness | L0 / L1 | — |
| 5.15 | Joint selection | Tap + Thumb; Rig tray › All joints | L0 / L1 | Mod → Thumb |
| 5.16 | Multi-part characters, rigid parts, finger detail | *Rig it for me* chips; character Halo › Parts & fingers | L1 / L2 | Was Auto-Rig only |
| 5.17 | Hide controls while rigging | Rig stage lighting default; puck sheet › Show | L1 | Was Auto-Rig only |

### 15.6 Skin and weights (12)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 6.1 | Bind skin (+ options) / Rebind | Skin empty state *Bind skin*; character petal *Bind again*; options on long-press | L0 / L1 / L2 | — |
| 6.2 | Unbind; go to bind pose | Pose segment `[Bind│Test│Clip]`; More › Unbind | L0 / L2 | — |
| 6.3 | Paint skin weights (modes, value, opacity, radius, falloff, surface / volume, front only, paint / select) | Joint petal *Paint its weights* → brush tray chips (L0 in the tool); the rest in brush ⋯ | L1 / L2 | B / M / N + drag → chips; Pencil pressure |
| 6.4 | Flood | Brush tray | L0 (in tool) | — |
| 6.5 | X-mirror stroke | Brush tray Mirror chip, on by default | L0 | Alt + R → chip |
| 6.6 | Active influence: list, walk, pick dominant, sample | Two-way card + ‹ ›; *Who owns this?* finger-hold; All bones list | L0 / L1 | Arrows, I, Shift + I → card / hold |
| 6.7 | Hold / hold all / release all | All bones list locks | L2 | — |
| 6.8 | Mirror / Smooth / Prune / Normalize / Remove unused | Brush ⋯ › Fix weights; Health fixes | L2 | — |
| 6.9 | Weight display | Brush tray Show ▾ | L1 | Alt + C → chip |
| 6.10 | Test pose view; reset | Pose segment; character petal Reset test pose | L0 / L1 | — |
| 6.11 | Test-rotate a joint | In Test: drag a joint; ⟨Bend <joint>⟩ chip | L0 | E key → drag / chip |
| 6.12 | Numeric weight (`skin.weights.set`) | Vertex selection › *Set weight…* numpad | L2 | **New UI**: no Pro UI exists |

### 15.7 Pose (12)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 7.1 | Manipulate controls (object / world / gimbal) | Drag the ring or limb; manipulator long-press › Space | L0 / L1 | — |
| 7.2 | Channel numbers, expressions, nudges | Echo channel chips; Inspector › Channels with numpad expressions and − / + steppers | L0 / L2 | Arrow nudges → steppers |
| 7.3 | Virtual slider | Chips | L0 | MMB → chips |
| 7.4 | Lock / unlock channels | Channel row long-press | L2 | — |
| 7.5 | Reset a channel to default | Channel row long-press; channel chip Halo | L2 | RMB-only → long-press |
| 7.6 | Reset pose to rest | *Reset* petal; character Halo | L1 | — |
| 7.7 | Copy / paste / paste mirrored | *Copy pose* petal; Paste ▾ | L1 | — |
| 7.8 | Flip / mirror L→R / R→L | *Mirror ▾* petal | L1 | — |
| 7.9 | Pin / plant / unpin feet | Foot petals; character More | L1 / L2 | — |
| 7.10 | Unkeyed tweaks | `● not keyed · Key · Discard` | L0 | — |
| 7.11 | Pose at a frame, aim, IK goals, transfer | Band petal *Hold pose* (`pose.transfer`); *Paste pose at…* (verb → target, `pose.setAt`); More › *Look at…* / *Place goal* (wrapper over `pose.goals`); drag-to-Reach in T15 | L1 / L2 | **New UI**: AI-only today |
| 7.12 | Pose recipes (wave, nod…), plant contacts | Recipes (T13) once `pose.recipe` / `pose.plantContacts` are registered | n/a | Not registered in the kernel yet |

### 15.8 Keys, curves, timing (25)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 8.1 | Set key (all / T / R / S / attributes; selected channels) | `◆+` and *Key ◆* (L0 / L1); long-press options; channel Halo › Key this channel | L0–L2 | RMB "Key Selected" → channel Halo |
| 8.2 | Auto key and its mode | `● Rec` (L0); mode in Settings | L0 / L2 | — |
| 8.3 | Key target | Long-press ◆+ › Key target | L1 | — |
| 8.4 | Delete key at frame / selected keys | Key dot and band petal *Delete* | L1 | — |
| 8.5 | Breakdowns: set, convert | Long-press ◆+ › Breakdown; key dot *Breakdown ⇄* | L1 | — |
| 8.6 | Tween family, overshoot | Tween chip (L0 between keys); mode segmented control; scrub past the ends | L0 / L1 | — |
| 8.7 | Mirror animation (half-cycle) | Clip Halo › More › *Mirror cycle* | L2 | Distinct name from *Swap sides* |
| 8.8 | Set frame / scrub / carry the pose | Thread tap and drag; Thumb *Carry* | L0 / L1 | MMB scrub → Thumb |
| 8.9 | Step, prev / next key, start / end | Thread buttons | L0 | — |
| 8.10 | Play / stop / backwards / loop modes / speed | ▶ and its long-press | L0 / L1 | — |
| 8.11 | Playback range and clip range | Range brackets (long-press the Thread); clip Settings | L1 / L2 | — |
| 8.12 | Band: select / move / scale / copy / context menu | Pencil or Thumb *Band*; drag body or ends; Thumb *Copy*; band Halo | L0 / L1 | Shift / Mod + drag, RMB → Pencil / Thumb / Halo |
| 8.13 | Insert / remove / delete time | Band More; Thread long-press | L2 | — |
| 8.14 | Ripple edit | Parts header chip | L1 | — |
| 8.15 | Dope Sheet | Parts layer (rows, select / move / scale, region, frame, ‹ › nudge) | L1 | Arrow nudge → chips |
| 8.16 | Graph key and handle edits, insert key, numeric fields | Curves layer: Pencil drags, *Insert key* petal, ⟨Frame⟩ ⟨Value⟩ ⟨In / Out angle⟩ ⟨In / Out weight⟩, Axis chip | L2 | MMB move, Shift axis → Pencil / chip |
| 8.17 | Tangents (all 9, break / unify, weighted, lock weight) | Key dot *Ease ▾* (4 at L1, the rest at L2); Curves chips | L1 / L2 | 1–7, B, U keys → chips |
| 8.18 | Pre / post infinity | Curve petal *Cycle ▾* | L2 | — |
| 8.19 | Euler filter, Simplify, Key curves | Curve petals; More | L2 | — |
| 8.20 | Buffer curves | Hold *⇆ Before*; More › Snapshot / Swap / Clear | L2 | — |
| 8.21 | Views (abs / norm / stack); framing | Curves header segmented control; double-tap | L2 | N / Shift + N → segmented |
| 8.22 | Copy / paste keys (merge / replace / insert) | Key or band petal *Copy*, *Paste ▾* | L1 | Hover-scoped Mod + C / V → petals |
| 8.23 | Graph / Dope pan and zoom | Two fingers in the sheet | L0 | Wheel / Alt + MMB → touch |
| 8.24 | Channel list filter; keyed only | Curves header chips and filter | L2 | — |
| 8.25 | Value scale / offset; offset with wrap | Band More › Scale values…, Offset values…, Offset in loop (wrappers over `key.adjust` / `key.retime {wrap}`) | L2 | **New UI**: AI-only today |

### 15.9 Clips and library (7)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 9.1 | New, duplicate, rename, delete, set active | Moves row; clip Halo | L0 / L1 | RMB → Halo |
| 9.2 | Clip settings | Clip Halo › Settings | L2 | — |
| 9.3 | Library: browse, preview, stop, use | Library drawer | L1 | — |
| 9.4 | Library parameters, search, categories, edit, remove, add many | Expanded card; *Add starter set*; clip Halo › Edit | L1 / L2 | **Was Auto-Rig only** |
| 9.5 | Import VRMA / animation GLB / embedded clips (options) | Bring a model; Library › From file; options sheet | L1 / L2 | — |
| 9.6 | Make loop | Clip petal *Loop it* | L1 | **New UI**: AI-only today |
| 9.7 | OMOBA slot | Clip Halo › Use as…; Share readiness | L2 | — |

### 15.10 IK / FK (7)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 10.1 | Limb attributes (poles, soft IK, twist, blend) | Inspector › Limb | L2 | — |
| 10.2 | Switch IK ↔ FK (+ key mode) | *IK⇄FK* petal; key mode on long-press | L1 / L2 | — |
| 10.3 | Match at the current frame | IK⇄FK long-press › Match now | L2 | — |
| 10.4 | Match a range | Band More › Match IK/FK; limb More | L2 | — |
| 10.5 | Foot roll; foot pivots | Foot Echo chips (L1); Inspector › Foot (L2) | L1 / L2 | — |
| 10.6 | Add limb IK; IK defaults | Character Halo (Rig) › More; Settings | L2 | — |
| 10.7 | AI IK-goal placement | More › Place goal (verb → target); Reach in T15 | L2 | **New UI** |

### 15.11 Import, export, publish (11)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 11.1 | Open / import GLB, VRM (Draco, meshopt, KTX2) with options | Home › Bring a model (byte-sniffed); project menu › Open / Import; Advanced options | L1 / L2 | iOS `accept` problem → sniffing |
| 11.2 | Samples | Home › Try a sample; project menu › Samples (incl. Cube Lad, Polybot T / A) | L1 / L2 | — |
| 11.3 | Intake gates (heavy mesh, already rigged) | Automatic sheet at intake | L0 | — |
| 11.4 | Export animation (bake / VRMA / anim GLB + options) | Share › Just the moves / Game engine / Into the original file; Advanced | L1 / L2 | — |
| 11.5 | Static model GLB | Share › Prop; object More › Export selected | L1 / L2 | RMB "Export Selected" → More |
| 11.6 | Character VRM 1.0 / GLB behind the gate | Share › OMOBA & Ekza Space | L1 | — |
| 11.7 | VRM meta; thumbnail | Share card fields (once); automatic thumbnail; character More › About this character | L1 / L2 | — |
| 11.8 | Auto-Rig export targets (OMOBA kit, VRM 0.x kept, rigged GLB) | Share › More formats | L2 | Was Auto-Rig only |
| 11.9 | Export profiles and lints | Destination → profile; card Details (rule ids, profile switch) | L2 | — |
| 11.10 | Validation gate and read-back | Automatic, with *Go fix ▸* | L0 | — |
| 11.11 | Publish to Ekza Hub | Hidden until M4a, as in Pro | n/a | — |

### 15.12 Project, files, history (9)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 12.1 | New project | Home; project menu | L1 | — |
| 12.2 | Open `.ekzanim` | Bring a model (sniffed); project menu › Open | L1 | — |
| 12.3 | Save, Save As, Save Debug JSON | Project menu › Save to Files (two-step on iOS), Save as; Advanced › Debug JSON | L1 / L2 | — |
| 12.4 | Autosave, recover, recovery point, discard | Silent restore / Continue (L0 / L1); project menu › Recover, Recovery point, Discard | L0–L2 | — |
| 12.5 | Undo / redo | ↶ ↷; two-finger tap; History ribbon | L0 | — |
| 12.6 | Edit copy / paste / delete; Escape | Per-noun petals; ✕ in the session bar; tap empty space | L1 | Hover-dispatched → noun verbs |
| 12.7 | Revert chosen steps; restore document | History ribbon › Revert this / Undo all | L1 / L2 | — |
| 12.8 | Unsaved guard and dirty state | Dirty dot; *"Saved on this iPad · not in Files"*; host leave guard | L0 | — |
| 12.9 | History panel (planned M2c) | History ribbon (long-press ↶): labelled steps, AI groups, Compare, Adjust | L1 | **Arrives in Halo first** |

### 15.13 AI agent (7)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 13.1 | Connect, discovery, pairing | Ask sheet › Connect (desktop Chrome / Edge) | L1 | iPad: OQ-5 |
| 13.2 | Grants | Plain toggles in the pairing card | L1 | — |
| 13.3 | Pause, resume, disconnect | Ask sheet | L2 | — |
| 13.4 | Audit log, undo per step, revert all | History ribbon AI groups | L1 | — |
| 13.5 | Confirm cards | Inline cards | L0 (when raised) | — |
| 13.6 | Live status, toasts | Activity line under the search pill | L0 | — |
| 13.7 | What the agent can do (37 tools, prompts, headless) | Unchanged; prompts shared with recipes | n/a | — |

### 15.14 Preferences (9)

| # | Capability | Ekza Studio surface | Depth | Pro gap closed / notes |
|---|---|---|---|---|
| 14.1 | Start in | Settings › Start in: Ekza Studio / Studio Pro / Auto-Rig / Ask | L2 | — |
| 14.2 | Navigation profile | Settings › Input: the touch / Pencil routing table; mouse profile (Maya / trackpad / one-button) | L2 | — |
| 14.3 | Space key behaviour | Settings › Keyboard › "In Studio Pro, Space…" (Halo always plays) | L2 | Edits Pro's pref explicitly |
| 14.4 | Auto-key mode | Settings › Animation | L2 | — |
| 14.5 | Reduce keys on import | Settings › Import | L2 | — |
| 14.6 | Graph handles | Settings › Animation; Curves ⋯ | L2 | — |
| 14.7 | Prefs with no UI; uiScale | Settings › Advanced, generated from the prefs schema (every key gets a field); *Text & touch size* (uiScale, now read) | L2 | **New UI** |
| 14.8 | First-run dialog | Replaced by Home, the gesture line and one-time coach marks; Pro keeps its dialog | L0 | — |
| 14.9 | Keymap overrides | — | **Pro** | §15.15 c; no UI in either shell yet |

### 15.15 Deliberate Studio Pro hand-offs, and why

a. **Pro's window chrome**: dockview panels (drag, split, float, reset), layout presets (apply, save, rename, delete),
   the chrome toggles (Tool Strip, Help Line, Time Slider), and Pro's focus mode. These operators configure Pro's
   docking window, not the document. Ekza Studio has its own fixed layout, sheets and Hide UI. In the parity test they
   are the `PRO_CHROME` list.

b. **Seeing many editors at once**: the Graph Editor, Dope Sheet, Channel Box, Outliner and Attributes side by side for
   long polish sessions. Every capability of each is in Ekza Studio, one deep layer at a time. Showing them together
   is what Pro is for. *Open in Pro ↗* on the Curves layer is a convenience only.

c. **Keymap customisation**, once it exists: a keyboard power-user feature.

Nothing else is Pro-only. The ~51 deferred stubs ("Arrives after the MVP") stay hidden in both shells.

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

## 16. Switching between Ekza Studio, Studio Pro and Auto-Rig

### 16.1 Same page (the normal case)

- `Pro ↗` calls `host.navigation.go({to: 'studio', workspace, from: 'halo', subject, then?})` directly from the tap
  handler, so a new tab is never treated as a blocked pop-up.
- `leave()` first cancels any session-bar tool (as ✕ would) and stops the library preview. The host then closes its
  palette, dialogs and confirm prompts and resets the keyboard (AUTORIG-SPEC §3.4).
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
| Rig (Character / Skeleton / Skin) | Rig & Skin, same `rig.mode`; Paint Skin Weights if the brush was active |
| Animate | Animate workspace; the Polish preset when the Thread was at Curves (`then: {kind: 'preset', preset: 'polish'}`) |
| Share sheet open | The current workspace, with the Export dialog opened (`then: {kind: 'dialog', dialog: 'export'}`) |

- Pro shows a toast: *"Same project, all tools · Undo still works"*. Its first-run dialog is suppressed for `from=halo`,
  as it is for `from=autorig` (`EditorShell.tsx:93`).
- **Pro → Ekza Studio.** Help › *Switch to Ekza Studio*, File › *Switch to Ekza Studio* and a status-line button. They
  are built like `shell.autoRig` with a lazy switch chunk (`haloSwitch.ts`), so `/editor` pays only for the menu
  items (ST-B1).
  - Mapping back: Model → Make (Paint when the Paint Colour tool is active), Rig & Skin → Rig, Animate → Animate.
  - Selected keys open the Thread at Curves. A selected joint opens its Halo.
- **Halo's shell-local state** is mirrored to `sessionStorage` (`ekza-studio:halo:session:v1`), following
  `autorig/session`: stage, open sheet, Thread layer, latched Thumb modifiers, pinned petals, destination and recipe
  progress. So a reload or a round trip through Pro comes back to the same place.

### 16.2 New tab and other devices

- **New tab.** Long-press `Pro ↗` › *Open in a new tab*. It uses the existing one-shot IndexedDB handoff record, whose
  `HandoffInfo` is widened with `halo` state. Undo history starts fresh there, and a banner says so.
- **Other devices.** Save to Files as `.ekzanim` (with its thumbnail), then Open on the other device. Pro skips its
  first-run dialog when a file is dropped, and a banner says *"undo history starts here"* (ADR 0011). Keeping the
  history in the file is OQ-8.

### 16.3 Auto-Rig

- `/autorig` stays as it is. Halo enters it only through *Adjust dots ▸* (v1) or the Home link *Rig a model for me*.
- Auto-Rig gets a *Back to Studio ▸* control when `from=halo`. Its own *Open in Studio ▸* still goes to Pro.
- The host has one mounted-shell slot, so Halo never embeds `AutoRigShell`; it navigates.
- Folding Auto-Rig into Halo's *Rig it* recipe is OQ-6 (T14).

### 16.4 Shared preferences

Halo never writes these implicitly:
- `navProfile` (Halo's routing lives in `halo.input`);
- `autoKey` (●Rec is the same flag, changed only by its visible control);
- `spaceBehaviour` (Halo always plays and edits Pro's value only through Settings › Keyboard);
- `modeling.optionDefaults` (written only by *Options › Make default*);
- `uiScale` (*Text & touch size*, which now affects both shells).

Stage lighting and the iOS memory profile are session overrides that the shell removes when it unmounts. AS-ST-10
checks Pro's keymap, marking-menu definitions and pref defaults after a round trip.

---

## 17. First open and onboarding

- **No modal on the first paint**: no first-run dialog, no Recovery dialog, no "How do you navigate?", no either/or
  chooser when a choice is remembered.
- **Home** (wireframe A):
  - one sentence;
  - three doors: Bring a model, Make a character, Try a sample (already moving);
  - Continue cards built from the autosave slots;
  - *Rig a model for me*;
  - a single gesture line: *"✎ Pencil edits · ☝ finger moves the view · two-finger tap = undo"*;
  - a quiet `Pro ↗`.
- **Coach marks** appear once per surface, in context, and can be dismissed:
  - the first Halo: *"Hold and flick toward a verb to go faster"*;
  - the first time you hold the Thumb key: *"Hold to add · double-tap to keep it on"*;
  - the first time the Thread is unfolded;
  - the first Pencil touch: the routing toast (§5.1).
- **Never on first open**:
  - the menu bar, docks, workspace tabs or the disabled Review tab;
  - hotkey hints, or RMB / MMB instructions;
  - DCC jargon at the first layer: extrude session, bind pose, influences, tangents, Lambert / Blinn;
  - format names as choices: VRM 0.x / 1.0, VRMA, `.ekzanim`, Draco, KTX2;
  - rule or profile ids;
  - AI plumbing (ports, grants);
  - licence text before Share;
  - a "Chrome and Edge only" banner. A missing capability is checked only when it is needed.
- **The storage card**: the first save offers *"Keep projects on this iPad"*: `navigator.storage.persist()`, plus an *Add
  to Home Screen* hint, because Safari can evict a site's storage after 7 days without a visit and Home Screen web apps
  keep their own storage.
- **Help** (project menu): a gesture card listing every gesture and its twin, the Pro shortcut sheet, About and licences.

---

## 18. Accessibility

Target: **WCAG 2.2 AA** for all chrome.

- **Targets and type**: hit targets of at least 44 × 44 pt (WCAG 2.5.8 asks for 24 px; Apple's HIG for 44 pt). Input
  text of at least 16 px. *Text & touch size* (`uiScale`, 0.85–1.5) scales chrome and targets and is read at last.
- **Gestures**: every gesture has a button twin (§5.2). Settings › Input › *Reduce gestures* turns off two-finger-tap
  undo, quick pinch and flicks; every journey stays doable (AS-ST-9). A Halo-on-tap off switch makes ⋯ on the selection
  chip the only way into verbs.
- **Screen readers**:
  - the Halo is a `menu` with `menuitem`s;
  - Path stages are a `tablist`;
  - sheets are `dialog`s with a focus trap and an accessible name;
  - Echo chips are `slider`s with `aria-valuetext` in units;
  - the Thread exposes play / step / key buttons and the current time as text;
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
| S1 | Every iPad browser is WebKit; Studio supports Chrome / Edge only and no WebKit is in the test gate [C] | A Playwright `webkit-ipad` project (iPad Pro 11 landscape and portrait) as a gate for `/app`, plus a manual device matrix. Halo is supported on Safari 26+ (iPadOS and macOS). NFR-03 is amended for Halo; Pro on Safari stays best-effort (OQ-7). | T0 |
| S2 | No touch navigation in Studio; the viewport is single-pointer [C] | Shared touch navigation in `viewport` with a public `navigate()`, plus a multi-pointer `PointerArbiter` | T1 |
| S3 | Rig & Skin view-only below 1024 px [C] | Halo never calls `setRigViewOnly`; the layout uses container queries (AR-V1) | T6 |
| S4 | No `contextmenu` on a touch long-press (WebKit 213953) [C] | An explicit long-press recognizer (450 ms, 10 pt slop) and `-webkit-touch-callout: none`. No feature depends on `contextmenu`. | T1, T4 |
| S5 | Keyboard scope comes from hover and is lost when a finger lifts [C / V] | Non-mouse pointers take the scope from `lastPanel` | T2 |
| S6 | Hit tolerances of 2–8 px [C] | Tolerances by pointer type, plus the Loupe | T1, T6 |
| S7 | Pencil: pressure, tilt, altitude / azimuth and hover available; squeeze, double-tap, barrel roll and haptics not [C]; ~60 Hz events, coalesced events partial [R] | Pressure folded into stamp strength; coalesced plus interpolated stamps; no design depends on Pencil Pro features. A native wrapper is OQ-12. | T1, T9 |
| S8 | Per-tab memory kill at ~1.5–2 GB [R] | An **iOS memory profile** applied as a session override: undo budget 96 MB (from 256 + 64), DPR capped at 1.5 above 4 MP, MSAA off on containers above 5 MP, textures capped at 2048², triangle warning at 60k and refusal at 200k (Auto-Rig's gate). The context-loss path is kept. | T0 |
| S9 | No save / open pickers; `<a download>` lands in Downloads [C] | A two-step *Save to Files* through Web Share Level 2: prepare first, then a fresh tap calls `navigator.share({files})`. Downloads elsewhere. | T0, T11 |
| S10 | `accept` is unreliable for `.vrm`, `.ekzanim`, `.vrma` [R / V] | No `accept` attribute on iOS; files are sniffed by magic bytes (glTF / GLB / zip / JSON), with a plain error for anything else | T0 |
| S11 | IndexedDB may be evicted after 7 days without a visit; `persist()` is unreliable [R] | The storage card (§17), the Home Screen manifest, *Save to Files* as the backup habit, and a dirty status that says *"Saved on this iPad · not in Files"* | T0, T11 |
| S12 | iOS 26 opens Home Screen sites as web apps with separate storage [C] | `manifest.webmanifest`, `apple-touch-icon`, `viewport-fit=cover`, a theme colour. Home Screen is recommended for full screen. | T0 |
| S13 | Pinch outside the canvases zooms the page; inputs under 16 px zoom on focus [C] | Shell-wide `touch-action` policy, a `gesturestart` `preventDefault`, inputs of at least 16 px | T4, T6 |
| S14 | System gestures (3–5 fingers, edges, home indicator) [R] | One- and two-finger gestures only; a 20 pt bottom clearance; a 12 pt side inset | T6 |
| S15 | Safari reports `MacIntel` [C] | The input mode comes from `pointerType` and `any-pointer: coarse`, never from the user agent | T6 |
| S16 | Pointer Lock only with a mouse or trackpad [R] | Distance scrub never needs Pointer Lock; Pro's virtual slider keeps its pointer-capture fallback | T6 |
| S17 | Element fullscreen exits when an input is focused (iPad), and is missing on iPhone [R] | Hide UI is the primary "full screen"; Home Screen mode is recommended | T6 |
| S18 | The loopback MCP bridge cannot be reached from Safari [C] | An honest card; offline recipes; OQ-5 | T6, T13 |
| S19 | Touch HTML5 drag-and-drop with custom MIME types is unverified [V] | Not used: pointer-event lift-and-drop and verb → target | T6 |
| S20 | Native `dblclick` on touch is uncertain [R] | Halo counts taps itself (the multi-tap windows of §5.4) | T1 |
| S21 | Trackpad pinch on iPad may zoom the page, not reach it [R / V] | The `gesturechange` handler maps pinch to dolly inside the canvas; the page never zooms | T1 |
| S22 | Scribble writes in focused fields [C] | Allowed in numpad and search fields; never on the canvas | T6 |

---

## 20. Architecture

### 20.1 Route, package, dependencies

Halo follows the Auto-Rig pattern (ADR 0021).

- **Route** `apps/web/app/(studio)/app/`:
  - `page.tsx`, with metadata;
  - `HaloEntryIsland.tsx`, using `next/dynamic` with `ssr: false` and `Loading.tsx`;
  - `HaloEntry.tsx`, which calls `useShellEntry({Host: StudioHost, Shell: HaloShell, props: hostProps(router.push)})`.

  Living in the `(studio)` group gives document and history retention across shells for free.
- **Package** `packages/halo` (`@ekza-studio/halo`), imported only by `HaloEntry.tsx`.
  - Shell marker string: `ekza-halo-shell`.
  - **Allowed dependencies**: `anim-core`, `doc`, `editor-core`, `viewport`, `curve-editor` (lazy imports only), `ui`
    (including the new `./touch` subpath), `react`, and the `@ekza-studio/editor` subpaths `./host`, `./bodies` and
    the new `./models`.
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
  - Halo never calls `setRigViewOnly` (AR-V1).

### 20.2 Package layout

```
packages/halo/src/
  index.ts              HaloShell + marker
  shell/                controller.ts (arrival: takeWorkspace / takeSubject / ?stage; host.mount({kind:'halo', leave,
                        handoffState}); session mirror), Frame.tsx (container-query layout), TopBar, ProjectMenu
  canvas/               HaloPane.tsx (WizardPane-style: paneSetup → registerPane; ids pane-single / pane-side),
                        lighting.ts (providePaneDisplay overlay per stage)
  input/                routing.ts (Shared / Pencil edits / Pencil only), modifierMap.ts, thumb/, loupe/
  path/                 Path.tsx, readiness.ts (pure), destinations.ts
  stages/{make,paint,rig,animate}/   stage.ts (StageDef), Tray.tsx — non-initial stages are lazy
  verbs/                nouns.ts (resolveNoun), table.ts (curated petals), derive.ts (More from manifest + poll)
  halo/                 HaloBar, HaloRing (MarkingMenu controller geometry), Breadcrumb, TargetMode (verb → target)
  chips/                EchoChips, scrub.ts (distance scrub), bind.ts (edit.adjustLast, NumericTarget)
  session/              SessionBar
  thread/strip/         layer 0 (eager, own Canvas2D over timeline view models)
  thread/parts/         layer 1 (lazy; curve-editor DopeSheet adapter)
  thread/curves/        layer 2 (lazy; curve-editor Graph adapter)
  sheets/               more, inspector, scene, library, health, share, history, settings (generated from the prefs
                        schema), view, ask — all lazy
  recipes/              rigIt, addMoves, loopIt, fixForOmoba, fixBend (data + runner over operators)
  home/                 Home, Continue, intake/ (byte sniffing → routing)
  manifest/             disclosure.ts, proOnly.ts, searchOnly.baseline.json, labels.ts (plain-language overrides)
  i18n/en.ts
packages/halo/test/     parity, manifest lints, modifierMap, nouns/verbs on fixture apps, readiness, recipes
```

### 20.3 Shared extractions and kernel changes (additive)

| # | Change | Where | Who benefits | WP |
|---|---|---|---|---|
| 1 | **Touch navigation in `viewport`.** Move `autorig/src/nav/{index,touch}.ts` (`simpleGesture`, `toolClaims`, `addNavigationClaim`, two-finger pan / pinch) into `viewport/src/navigation/touch/`; Auto-Rig re-imports it. Add a public `ViewportManager.navigate(paneId, gesture, dx, dy)` (`orbitBy`, `panBy`, `dollyBy`) in place of synthetic PointerEvents; a shot-camera dolly commits once per gesture. Add an internal `touch` NavProfile used by touch shells only. | viewport | Auto-Rig, Halo (Pro later) | T1 |
| 2 | **`PointerArbiter`**: multi-pointer, pen priority, palm rejection, tap / multi-tap / long-press / two-finger tap / quick pinch recognition. Pointers that start on chrome are excluded (C6). | `viewport/src/input/arbiter.ts` | all touch surfaces | T1 |
| 3 | **`setModifierSource()`** on `ViewportManager` and on the Graph, Dope Sheet and Time Slider controllers. Virtual flags merge into `toolEvent` / `ToolKeyEvent` with a provenance bit; `selectModeOf` and tools are unchanged. | viewport, curve-editor | Halo | T1 |
| 4 | **Tolerances by pointer type**: `theme.ts` PICK, `ComponentPicker`, manipulator and extrude handle geometry, `MARKER_PICK_PX`, the curve painters' theme, `DRAG_THRESHOLD_PX`, multi-tap windows. Mouse values stay as today. | viewport, mesh-view, curve-editor, rig | every shell on touch | T1 |
| 5 | **`ToolPointerEvent` additive fields**: `pressure`, `tiltX` / `tiltY`, `altitude`, `azimuth`, `pointerId`, `isPrimary`, `coalesced[]`, `virtualModifiers`. | editor-core `types.ts` | paint tools | T1 |
| 6 | **ParamDef backfill as a lazy contribution.** A new `app.operators.addParams(id, defs)`, a few eager bytes. Modules `editor-core/src/operators/params/{graph,key,clip,palette,pose,time,ik,skin,view}.ts` attach ParamDefs when loaded. Halo loads them at idle after boot; Pro's palette and option boxes load them lazily. `tooling/param-lint.mjs` fails when an operator with non-void `OperatorMap` args lacks ParamDefs and is not on the reasoned allowlist (blobs, internal payloads). | editor-core, tooling | Echo chips, Options, palette prompts, MCP schema | T5 |
| 7 | **Public wrappers for AI-only operators.** In a lazy chunk registered for every shell: `pose.hold` (→ `pose.transfer`), `pose.pasteAt` (→ `pose.setAt`), `pose.placeGoal` / `pose.lookAt` (→ `pose.goals`), `clip.loop` (→ `clip.makeLoop`), `key.scaleValues` / `key.offsetValues` (→ `key.adjust`), `key.offsetInLoop` (→ `key.retime {wrap}`). Each has an undo label, argument validation, ParamDefs and an agent-policy row. Final names are fixed in T5. | editor-core, agent-tools policy | Halo, Pro search, MCP | T5 |
| 8 | **Curve-editor touch adapters**: `curve-editor/src/adapters/{dopesheet,graph}.ts`. React-free glue: arbiter → controller pointer events; two-finger pan / pinch → `setView` / `panView` / `zoomView`; view state persisted through a callback. Pro's `GraphCanvas` and `DopeSheetView` are untouched (they may adopt the adapters later; not in this plan). | curve-editor | Halo | T7 (dopesheet), T10 (graph) |
| 9 | **`@ekza-studio/editor/models`** subpath that re-exports the React-free view models: outliner (`model`, `modelTree`, `sceneSelection`), channel box (`readout`, `states`, `nudge`, `kit/kernel`), timeline (`state`, `placement`), graph `model`, clips `settings`, palette `model`, toolkit `slider`. Measured against `/editor` after each. | editor | Halo | T5 |
| 10 | **Progress models** move from `autorig/src/progress` to `editor-core/src/progress`; Auto-Rig re-imports them. | editor-core | Halo readiness, recipes | T5 |
| 11 | **Route unions and navigation** (§20.4): `ShellRoute` + `'halo'`; `NavigationRequest.from`, `then?`; `HandoffInfo.halo`; `MountedShell.kind`. `routeHref` maps every route explicitly (today any non-`studio` route goes to `/autorig`). `handoff.ts`, test-api params, `DialogHost`, the `EditorShell` first-run suppression, the entry-choice unions, `entry-contract.test`. A host-level `shell.navigate` operator, with `autorig.navigate` kept as an alias for MCP clients. | editor-core, editor, apps/web | all shells | T2 |
| 12 | **Host re-homing** of shell-neutral registrations that only Pro makes today: the marking-menu definitions; rig menu items and `rig.snap.projectedCenter` / `rig.jointSize.set`; the data parts of `registerModelSelectUi` / `registerModelTransformUi`; `promptRecovery`; agent UI hooks; `view.selectionMask`, `view.toggleFullscreen`. They become idempotent, lazy, host-level registrations, so they exist when Pro is not mounted. | editor | Halo, Auto-Rig | T3 |
| 13 | **Key scope from `lastPanel`** for non-mouse pointers (`createHost.ts:233`, `useWindowInput.ts`). | editor host | every shell | T2 |
| 14 | **UI touch kit**: `[data-density=touch]` tokens (rows and hits 44, input text 16); primitives Sheet, Segmented, ScrubChip, Numpad, LongPress, Loupe and a generic radial arc in `@ekza-studio/ui/touch` (so `/editor` pays nothing); the shell `touch-action` policy class; `uiScale` actually read. | ui | Halo, Auto-Rig later | T4 |
| 15 | **Platform services**: `shareOrDownload(blob, name)` (Web Share Level 2, two-step); `sniffFileKind(bytes)`; a `storage.persist()` request; the iOS memory profile as a session override (`host/memoryProfile.ts`); DPR / MSAA tiers in `GLHost`; the web manifest. | editor, apps/web | every shell on iPad | T0 |

### 20.4 Contracts (sketch; normative at T2)

```ts
// editor-core (additive)
export type ShellRoute = 'studio' | 'autorig' | 'halo' | 'chooser';
export type ArrivalAction =
  | { readonly kind: 'preset'; readonly preset: string }      // e.g. 'polish' (Pro)
  | { readonly kind: 'panel'; readonly panel: string }        // e.g. 'validation', 'paintWeights' (Pro)
  | { readonly kind: 'dialog'; readonly dialog: string };     // e.g. 'export'
export interface NavigationRequest {
  readonly to: ShellRoute; readonly from?: Exclude<ShellRoute, 'chooser'>;
  readonly workspace?: WorkspaceId; readonly subject?: AutoRigSubject; readonly newTab?: boolean;
  readonly then?: ArrivalAction;                              // new, optional; ignored by shells that do not know it
}
export interface HaloHandoffState {
  readonly stage: 'make' | 'paint' | 'rig' | 'animate';
  readonly sheet?: string; readonly threadLayer?: 0 | 1 | 2; readonly destination?: string;
}
// HandoffInfo gains `halo?: HaloHandoffState`; MountedShell.kind becomes Exclude<ShellRoute, 'chooser'>.

// ToolPointerEvent (additive; absent = today's behaviour)
//   pressure?, tiltX?, tiltY?, altitude?, azimuth?, pointerId?, isPrimary?,
//   coalesced?: readonly { x: number; y: number; pressure: number; t: number }[], virtualModifiers?: boolean

// viewport (additive)
interface ViewportManager {
  navigate(paneId: string, gesture: 'orbit' | 'pan' | 'dolly', dx: number, dy: number): void;
  setModifierSource(source: ModifierSource | null): Disposer;
  setPointerArbiter(config: ArbiterConfig | null): Disposer;
}
interface ModifierSource { get(): { readonly shift: boolean; readonly mod: boolean; readonly alt: boolean } }

// editor-core operators (additive)
interface OperatorRegistry { addParams(id: OperatorId, params: readonly ParamDef[]): void }

// entry (apps/web + editor dialogs)
export type EntryChoice = 'autorig' | 'studio' | 'halo';
export const ENTRY_ROUTES = { autorig: '/autorig', studio: '/editor', halo: '/app' } as const;
```

### 20.5 Parity CI: the Disclosure Manifest

`halo/src/manifest/disclosure.ts` maps every operator id to exactly one of:

```ts
type Disclosure =
  | { surfaces: SurfaceRef[]; nouns?: NounKind[]; stages?: Stage[]; depth: 0 | 1 | 2; plain?: string }
  | { proOnly: 'PRO_CHROME' | 'KEYMAP' | 'MULTI_EDITOR'; reason: string }
  | { searchOnly: string }             // reason; ratcheted by searchOnly.baseline.json
  | { wraps: OperatorId };             // an internal op reached through a public wrapper (§20.3 item 7)
```

A generator (`pnpm --filter @ekza-studio/halo manifest:draft`) proposes entries from the registry: category → stage,
`flags.selection` and the operator's workspaces → nouns, menu placement → depth. People then curate them; the registry
itself is unchanged. Tests (`packages/halo/test/parity.test.ts`, headless `createEditorApp` with every lazy chunk
loaded):

1. Every live, non-internal operator — except deferred stubs (poll reason "Arrives after the MVP") — has an entry, and
   every entry names a live operator.
2. No entry counts search as its surface. The `searchOnly` count is at most the baseline (target at GA: only
   developer items such as `file.saveJson`). The baseline can only go down.
3. `proOnly` entries come only from the listed reasons. `PRO_CHROME` = the `workspace.*` dock / preset / chrome
   operators and `view.toggleMaximize` (for panels).
4. Every `SurfaceRef` resolves: the verb-table op exists; a stage tray op lists that stage's workspace in `workspaces`
   (or has none); a sheet binding exists.
5. Every operator with a `tool`, or a continuous interaction type, has a hands-on binding: a tray tool, or a petal that
   activates the tool (Intent's "take over" rule).
6. Every `app.menus` item with arguments is in the manifest or reachable through an equivalent surface.
7. `param-lint` (§20.3 item 6) passes for every operator surfaced with Echo chips or Options.

The PR template gains the checkbox *"Ekza Studio path (manifest entry) added or not needed"*.

### 20.6 Lazy loading and the bundle gate

- **Initial (eager) in `/app`**: the shared host floor, plus Frame, top bar and Path, HaloPane, arbiter config, Halo
  bar and ring core, Thumb key, Echo chip core, the Thread's layer 0, Home and the English strings.
- **Lazy**: each stage's tray and verb overrides (prefetched on Path hover or idle), the manifest and More sheet, every
  sheet, Parts and Curves (curve-editor), recipes, Share (export bodies), Ask (Agent panel body), the numpad, the
  Settings generator and the ParamDef contribution (prefetched at idle).
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
- **`/editor` and `/autorig` gain 0 B from the route.** The shared extractions (§20.3 items 1–6, 9, 11–13) and Pro's
  lazy *Switch to Ekza Studio* items are measured after every merge and recorded in one re-baseline row (**ST-B1**,
  AR-B1 pattern). The proposed total allowance is ≤ 2,048 B (OQ-3), against today's 6,804 B of `/editor` eager
  headroom (890,932 B measured; limit 897,736 B) and `/autorig`'s 8,144 B.
- Halo never imports `PaneView`, `GraphCanvas`, `TimeSliderView`, `DopeSheetView` or other modules that `/editor` loads
  eagerly (lesson AR-D3-1: a second importer of a scope-hoisted module costs `/editor` bytes; `PaneView` cost
  +1,444 B).

### 20.7 Test strategy

**Unit** (Vitest, Node):
- arbiter state machines over recorded pointer streams: tap, double-tap, long-press against drag, two-finger tap
  against pinch, quick pinch, pen plus palm, chrome-pointer exclusion;
- `modifierMap` against `toolModifiers.ts`;
- nouns and verbs on fixture apps (Polybot, Seed-san, Cube Lad), with poll filtering;
- parity and lints (§20.5);
- readiness functions;
- sniffing;
- route unions and `routeHref`;
- the entry contract;
- the memory profile.

**Headless integration** (`headless-tests`):
- the operator sequences Halo emits for J1, J2, J3, J5, J6 and J7 produce exports byte-equal to Pro's and Auto-Rig's
  for the same steps (AS-ST-5);
- pressure strokes replay deterministically (AS-ST-16).

**e2e** (Playwright, family `ha-`):

| Project | What |
|---|---|
| `chrome` | Desktop mouse and keyboard; Halo on click, right-click flick |
| `chrome-touch` (new) | `hasTouch`, 1194 × 834 and 834 × 1194; multi-touch through CDP `Input.dispatchTouchEvent` (the `ar-as-12` pattern); Pencil through CDP `Input.dispatchMouseEvent` with `pointerType: 'pen'`, `force`, `tiltX` / `tiltY` |
| `webkit-ipad` (new) | Playwright WebKit with `devices['iPad Pro 11']` and its landscape variant; single touch through `page.touchscreen`; multi-touch through synthetic in-page `PointerEvent` sequences (WebKit has no CDP). Gate for `/app`: smoke, ha-01–05, ha-12, ha-14. |

Specs:
- ha-00 platform;
- ha-01 home and intake;
- ha-02 Halo grammar;
- ha-03 Thumb key and selection;
- ha-04 Echo chips and the session bar;
- ha-05 Path and readiness;
- ha-06 Thread and Parts;
- ha-07 Curves;
- ha-08 Make;
- ha-09 Paint;
- ha-10 Rig and Skin;
- ha-11 Share;
- ha-12 the round trip to Pro;
- ha-13 gestures off;
- ha-14 portrait Rig editing;
- ha-15 axe accessibility;
- ha-J1–J10 journeys, with touch counts asserted through the test API's touch counter.

A marker-free test-API slice `provideHaloTestState` (like `test-api/autorig.ts`) exposes the stage, open sheet, Halo
noun and petals, Thread layer, Thumb state and touch counter.

**Size**: `check-size` and `halo-size.test.ts`; the budgets bench.

**Real devices** (each release, manual; evidence in `docs/evidence/halo/`):
- iPad (A16);
- iPad Air (M-series);
- iPad Pro M4 / M5 with Pencil Pro and a Magic Keyboard;
- iPhone 15 / 16 (Compact);
- Safari 26 on macOS.

Items to verify (D-list):
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
- D11 Web Share to Files;
- D12 the `storage.persist()` result;
- D13 Home Screen storage separation.

---

## 21. Build plan

Sizes: **S** ≤ 2, **M** 3–5, **L** 6–8 agent-days.

- **Branches**: `halo/tN-<name>` from `dev`. Package PRs go into the integration branch `halo/int`, which merges into
  `dev` at T12 (the gitflow of 2026-10-12).
- **Shared-file rule** (as in AUTORIG-SPEC §10.0): every file has one owning WP. Any other WP asks the integration
  agent, who owns T2 and T12.
- **Measurement**: `/editor` and `/autorig` are measured after every merge into `halo/int`.

| WP | Name | Size | Depends on | Owns (files) | Exit test |
|---|---|---|---|---|---|
| **T0** | Platform: WebKit gate and iOS services | M (4) | — | `apps/web/playwright.config.ts` (`chrome-touch`, `webkit-ipad`); `apps/web/e2e/ha-00-*.spec.ts`, `e2e/helpers/touch.ts`; `apps/web/app/layout.tsx`, `apps/web/public/manifest.webmanifest` + icons; `editor/src/services/{files.ts, fileTypes.ts (new), autosave.ts}`; `editor/src/host/memoryProfile.ts` (new); `editor/src/gl/GLHost.tsx`; the `accept` policy through one helper used by `editor/src/dialogs/OpenDialog.tsx` and Auto-Rig's `ModelStep`, `MenuBody` and `AnimationsStep` (one-line edits) | `/editor` and `/autorig` boot on `webkit-ipad`; Auto-Rig's touch e2e green on WebKit; unit tests for sharing, sniffing and the memory profile |
| **T1** | Input foundation | L (7) | — | `viewport/src/navigation/**` (+ `touch/`), `viewport/src/input/arbiter.ts` (new), `viewport/src/manager/ViewportManager.ts`, `viewport/src/theme.ts`, `viewport/src/manipulators/**/geometry.ts`, `mesh-view/src/ComponentPicker.ts`, `rig/src/quickrig/rules.ts` (`MARKER_PICK_PX` only), `editor-core/src/types.ts` (`ToolPointerEvent`, `NavProfile` lines only), curve-editor controllers + `graph/gestures.ts` + `painters/theme.ts` + `dopesheet/layout.ts`, `autorig/src/nav/**` (re-export shim), `autorig/src/shell/controller.ts` (one import) | Arbiter suite green; Auto-Rig `ar-*` e2e green (Chromium and WebKit); Pro e2e green; `/editor` delta recorded in ST-B1 |
| **T2** | Shell contracts and route | M (5) | — | `editor-core/src/types.ts` (route-union lines), `operators/args.ts`, `builtin/rig/wizard/navigate.ts`, `builtin/shellNavigate.ts` (new); `editor/src/host/{navigation,handoff,types,createHost}.ts`, `shell/useWindowInput.ts`; `editor/src/test-api/{params,createTestApi,types,halo}.ts`; `editor/src/dialogs/{DialogHost,entryChoice,FirstRunDialog,PreferencesDialog}`; `editor/src/shell/EditorShell.tsx` (`from=halo`); `apps/web/app/{entry.ts,EntryChooser.tsx,page.tsx}` (card behind `SHOW_HALO_CARD = false`), `apps/web/test/entry-contract.test.ts`; `apps/web/app/(studio)/app/**`; `apps/web/scripts/{check-size.mjs,lib/route-scripts.mjs,size-baseline.json}`, `apps/web/test/halo-size.test.ts`; `tooling/check-deps.mjs`, `.oxlintrc.json`, `apps/web/{next.config.ts,package.json,tsconfig.json}`, root `tsconfig.json`; `packages/halo/{package.json,tsconfig.json,src/index.ts}` | An empty `HaloShell` mounts at `/app` (`chrome`, `webkit-ipad`); Halo → Pro → Halo keeps the undo history (ha-12 skeleton); entry contract green; `/app` measured (unenforced) |
| **T3** | Host re-homing and the Pro switch | M (4) | T2 | `editor/src/overlays/menus/**` (registration seams), `shell/menus/rig.ts`, `shell/rig/{register,operators}.ts`, `panels/viewport/hud/index.tsx` + `ModalReadout.tsx` (registration seams), `shell/autosave.ts`, `shell/StatusLine.tsx` (agent pill hook), `shell/operators.ts`, `editor/src/host/registrations/**` (new), `shell/menuItems.ts` + `shell/haloSwitch.ts` (new), the "Ekza Studio Pro" strings behind a flag | Registrations present with Pro unmounted (unit); all Pro e2e green; `/editor` within ST-B1 |
| **T4** | UI touch kit | M (4) | — | `packages/ui/{tokens.json, css/tokens.css, styles.css, package.json}`, `packages/ui/src/touch/**` (new), `apps/web/app/dev/touch/**` (primitive gallery) | Primitive unit tests; axe green on the gallery; 44 pt / 16 px tokens; `/editor` +0 B |
| **T5** | Kernel parity prep | M (5) | — | `editor-core/src/operators/params/**` (new) + the registry's `addParams`; `editor-core/src/operators/builtin/uiWrappers.ts` (new, lazy) + its registration; agent-tools policy rows for the wrappers; `editor-core/src/progress/**` (moved) + `autorig/src/progress/**` (re-export); `editor/src/models.ts` + `editor/package.json` exports; `tooling/param-lint.mjs` | `param-lint` green; wrapper tests (undo labels, validation, MCP policy) headless; Auto-Rig e2e green; `/editor` +0 B from params (lazy) |
| **T6** | Halo core shell | L (8) | T1, T2, T3, T4 (T5 for chip contents) | `packages/halo/src/{shell,canvas,input,path,verbs,halo,chips,session,manifest,i18n}/**`, `sheets/{more,inspector,scene,view,settings,health}/**`, `home/` (stub), `packages/halo/test/**`; e2e ha-01–05, ha-13–15 | Grammar e2e green on `chrome-touch` and `webkit-ipad`; the parity test runs in ratchet mode with its baseline; `/app` under its gate |
| **T7** | Animate stage | L (8) | T6, T5 | `halo/src/stages/animate/**`, `thread/{strip,parts}/**`, `sheets/{library,clip}/**`, `curve-editor/src/adapters/dopesheet.ts`; e2e ha-06, ha-J3, ha-J5 | J3 ≤ 16 and J5 ≤ 6 touches; Thread gestures on `webkit-ipad` |
| **T8** | Make and Paint stages | L (6) | T6, T5 | `halo/src/stages/{make,paint}/**`, `sheets/palette/**`; e2e ha-08, ha-09, ha-J2, ha-J6 | J2 ≤ 9, J6 ≤ 8 + strokes |
| **T9** | Rig and Skin stage | L (6) | T6, T5, T1 | `halo/src/stages/rig/**`, `sheets/{checks,bones,weights}/**`, `recipes/{rigIt,fixBend}.ts`; `viewport/src/tools/rig/paint/{tool,pick}.ts` (pressure, interpolated stamps); `autorig/src/shell/**` (*Back to Studio*, `from=halo` only); e2e ha-10, ha-14, ha-J1, ha-J7 | J1 ≤ 10, J7 ≤ 7 + strokes; portrait Rig editing; pressure determinism headless |
| **T10** | Curves and History | M (5) | T7 | `halo/src/thread/curves/**`, `curve-editor/src/adapters/graph.ts`, `halo/src/sheets/history/**`; e2e ha-07, ha-J4, ha-J8 (fake agent session) | J4 ≤ 10; Revert this / Undo all on AI groups |
| **T11** | Share, Home, files | M (5) | T6, T0 | `halo/src/{home,intake}/**`, `sheets/share/**`, `recipes/{addMoves,fixForOmoba,loopIt}.ts`; e2e ha-11, ha-J9, ha-J10 | Every destination byte-equal to the Pro / Auto-Rig export (AS-ST-5); two-step save (mocked share on WebKit; device D11) |
| **T12** | Integration and release gate | M (4) | all | `halo/int`; DECISIONS-OPEN §O records (ST-B1, ST-INT-*); enforce `size-baseline.json` `routes.app`; `SHOW_HALO_CARD = true` and the Pro rename flag on; `FEATURES.md` (v0.6.0 + Halo), `ROADMAP.md`, `docs/agents.md` (iPad note); `docs/evidence/halo/` | Everything in §22 green |

**Total ≈ 71 agent-days.**

- **Critical path**: T1 (7) → T6 (8) → T7 (8) → T10 (5) → T12 (4) ≈ **32 agent-days**.
- **In parallel from day 1**: T0, T2 → T3, T4 and T5.
- **In parallel after T6**: T8, T9 and T11.

**Phase exits:**
- **F** (T0–T5): Auto-Rig e2e green; Pro e2e green; `/editor` within ST-B1; an empty `/app` round-trips to Pro with
  the undo history kept on `webkit-ipad`.
- **S** (T6): §5–§8 working on touch and WebKit; parity ratchet active.
- **W** (T7–T11): every stage and every journey.
- **R** (T12): the release as "Ekza Studio (beta)".

**After GA** (each item is its own spec delta; some are owner-gated):

| WP | Name | Size | Gate |
|---|---|---|---|
| T13 | Recipes and phrases (offline matcher, Wave / Nod / Breathe generators) | M (5) | — |
| T14 | Native *Rig it* dots (3D + side inset) and Auto-Rig convergence | L (6) | OQ-6 |
| T15 | Reach posing, glue pins, Peek-hold previews | M (5) | measure memory first |
| T16 | Perform (sampled writes + auto-simplify) | L (8) | a new kernel operator, ADR |
| T17 | AI on iPad | ? | OQ-5 |
| T18 | Undo history kept in autosave and in the project file | ? | OQ-8, ADR 0011 change |

---

## 22. Acceptance scenarios (the release gate)

| ID | Scenario | How verified |
|---|---|---|
| AS-ST-1 | `/app` boots on WebKit iPad (landscape and portrait), loads a sample, plays, edits and saves | `webkit-ipad` ha-00, ha-01; device |
| AS-ST-2 | Parity: every live, non-internal, non-stub operator has a non-search Halo path or a reasoned `proOnly`; `searchOnly` holds only developer items | `parity.test.ts`, manifest lints |
| AS-ST-3 | Each of the 25 most frequent tasks can be done with no keyboard, hover, right-click, middle-click or modifier, at most two taps deep from its noun | Device checklist + `chrome-touch` e2e |
| AS-ST-4 | Touch counts: J1 ≤ 10, J2 ≤ 9, J3 ≤ 16, J4 ≤ 10, J5 ≤ 6, J6 ≤ 8 + strokes, J7 ≤ 7 + strokes, J9 = 1, J10 ≤ 1 | ha-J* with the test-API counter; device spot check |
| AS-ST-5 | Same document: Halo exports (VRM 1.0, GLB, VRMA, static GLB) are byte-equal to Pro's and Auto-Rig's for the same operator sequence | headless-tests |
| AS-ST-6 | Halo → Pro → Halo keeps the undo history, selection, time and `pane-single` camera; Pro arrives on the mapped workspace with `then` applied | ha-12 |
| AS-ST-7 | Rig & Skin, weight painting included, is editable at 744 pt and 834 pt widths; Pro's view-only rule is unchanged | ha-14; Pro e2e |
| AS-ST-8 | `/app` ≤ its gate; `/editor` and `/autorig` +0 B from the route; extractions within ST-B1 | `check-size`, `halo-size.test.ts` |
| AS-ST-9 | With *Reduce gestures* on (no two-finger undo, quick pinch or flicks), every journey is still doable | ha-13 |
| AS-ST-10 | Pro is untouched: keymap, marking-menu definitions and pref defaults identical before and after; a Halo round trip writes no shared pref | snapshot unit test + ha-12 |
| AS-ST-11 | A 60k-triangle character, bound, with 3 clips, in a 30-minute session on an iPad Air (M-series) without a tab reload | device (D7, D8) |
| AS-ST-12 | Pencil pressure changes stamp strength; a fast stroke leaves no gap; palm touches during pen activity never select or orbit | CDP pen e2e; stamp interpolation unit test; arbiter unit test; device |
| AS-ST-13 | Save to Files works in two taps on iPad; `.vrm`, `.ekzanim` and `.vrma` open from Files through sniffing | device (D2, D11); unit tests for sniffing |
| AS-ST-14 | Chrome passes axe (WCAG 2.2 AA rules); every target ≥ 44 pt; every input ≥ 16 px; VoiceOver reads the Halo, Path and Thread | ha-15; device VoiceOver pass |
| AS-ST-15 | Auto-Rig behaviour unchanged after the navigation extraction | `ar-*`, `ar-as-12` e2e |
| AS-ST-16 | Weight-paint strokes with pressure replay identically headless and through MCP | headless-tests |

---

## 23. Defaults chosen

Every default is recorded with its impact and decide-by milestone in
[DECISIONS-OPEN §O](DECISIONS-OPEN.md#o-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24): ST-1…ST-31 and the
measurement row ST-B1 (filled in by T1–T3 and T12). The owner may override any of them.

## 24. Open owner questions

| ID | Question | Default until answered |
|---|---|---|
| OQ-1 | The final name, URL and internal id of the new shell (`/app`, `halo`) | `/app`, `halo`; "Ekza Studio" in the UI |
| OQ-2 | Should coarse-pointer devices with no remembered choice skip the chooser and open Ekza Studio? | No: the chooser, with Ekza Studio first |
| OQ-3 | The `/app` size gate (proposed 700,000 B, target 660,000 B) and the ST-B1 `/editor` re-baseline allowance (proposed ≤ 2,048 B) | As proposed, unenforced until T12 |
| OQ-4 | Auto-key in Ekza Studio: ask once on the first unkeyed tweak (default), or on by default when entering Animate? | Ask once; the shared pref is never flipped silently |
| OQ-5 | AI on iPad: a `wss` relay with the pairing code, an in-app Assistant through an Ekza proxy (changes "nothing uploaded"), or desktop-only | Desktop-only, with an honest card |
| OQ-6 | Auto-Rig's future: keep `/autorig` as its own wizard, or fold it into Ekza Studio's *Rig it* (T14) and redirect | Keep both; Rig it hands off for dot editing |
| OQ-7 | Browser support: amend NFR-03 so Ekza Studio supports Safari 26+; Pro on Safari stays best-effort? | Yes for Halo; Pro best-effort |
| OQ-8 | Keep the undo history across reloads and file opens (ADR 0011 change; matters more on iPad) | No; *"history starts here"* banners |
| OQ-9 | Russian UI strings and phrase synonyms: at GA or after? | English at GA; Russian after |
| OQ-10 | Home Screen web-app branding: app name, icon and theme colour | "Ekza Studio", the current icon |
| OQ-11 | Phone scope: full parity with "usable" quality (default), or iPad and desktop only at GA? | Full parity, "usable" |
| OQ-12 | A thin native iPad wrapper later (WKWebView + `UIPencilInteraction` for squeeze and double-tap)? | Not planned |
| OQ-13 | Device matrix: who owns the real iPads and Pencil Pro for the release checks? | The owner's devices; evidence in `docs/evidence/halo/` |

## 25. Sources

Repository:
- [ADR 0021](adr/0021-autorig-mode.md), [AUTORIG-SPEC](AUTORIG-SPEC.md) §3–§10, [MCP-SPEC](MCP-SPEC.md) §0.4;
- ADRs 0006, 0008, 0011, 0013, 0016, 0018;
- [FEATURES.md](FEATURES.md); [REQUIREMENTS](REQUIREMENTS.md) NFR-03;
- [DECISIONS-OPEN](DECISIONS-OPEN.md) §M (AR-B1, AR-V1, AR-D3-1) and §N.10 (M-AI-INT-11 sizes);
- code on `dev` @ `0512ba88`, at the paths quoted in §19–§21.

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
