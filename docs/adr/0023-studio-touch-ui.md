# ADR 0023 — Ekza Studio touch-first shell ("Halo"): a third shell over the same app, with Studio as its Pro layout

- Status: **Proposed** (2026-10-24, with [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) v0.2). v0.1 was reviewed the same
  day by three critics (coverage, feasibility, UX: 75 issues, 5 blockers); the spec's §26 records every issue and its
  resolution. The ADR becomes Accepted when the owner accepts the spec. The contracts (spec §20.4) freeze when the
  input spike T1a and work package T2 have both merged.
- Inputs:
  - The owner's request of 2026-10-24: *"a lightweight version, say for iPad, while keeping all the functionality … a
    universal, modern, even revolutionary UI/UX … keep the current one as 'Studio Pro', present the new one as the same
    thing with the emphasis on simplicity and minimalism"*.
  - The research round of the same day: a 191-row capability inventory at `dev` @ `0512ba88`, an architecture survey,
    a touch and iPad readiness audit, a market survey and ten user journeys.
  - Four concepts (canvas, intent, object, journey), scored by three judges (simplicity, parity, feasibility):
    object 24.8, canvas 22.7, journey 21.6, intent 18.5.
  - The review of v0.1 (spec §26).
  - ADR 0021 (Auto-Rig: the second-shell precedent); ADRs 0006, 0008, 0011, 0013, 0016, 0018.

## Context

Studio is a Maya-style power shell: docked panels, 18 menus, marking menus, a Maya keymap and about 328 live operators
over one document and one undo history. On an iPad it is not usable:
- camera navigation needs Alt chords or a wheel, and the viewport commits every press on `pointerdown`;
- about 30 capabilities need a modifier, a held key, a right or middle click, or hover;
- hit targets are 2–8 px and drag thresholds 2–3 px;
- Rig & Skin is view-only below 1024 px;
- Pencil pressure is never read;
- WebKit, the only engine on iPadOS, is outside the test gate.

Auto-Rig (ADR 0021) proved that a second shell keeps the document, the history and the GL context while showing a much
smaller UI, and its touch navigation already works on tablets. The owner wants the whole studio on iPad, not a subset,
and the current UI kept as "Studio Pro".

Options considered:

1. **Make Pro responsive**: touch density, gestures and sheets inside the dockview shell.
2. **A "Lite" app** with fewer features: the Gravity Sketch iPad route.
3. **Intent-first**: a command line ("make him wave twice") as the main way in, with an offline grammar plus an optional
   LLM.
4. **Journey-first**: the pipeline as the interface (Make → Rig → Move → Look → Share).
5. **Object-first**: a third shell where every touched thing grows its own verbs. Search guarantees reachability and
   the pipeline is a thin orientation bar.

## Decision

1. **A third shell, not a fork (option 5 at the core); one product with two layouts.** `/app` (internal id `halo`,
   package `@ekza-studio/halo`, shell marker `ekza-halo-shell`) mounts in the `(studio)` route group under the same
   `StudioHost`. It runs over the same `EditorApp`, document, history, session, services, operators and files as
   `/editor` and `/autorig`.
   - Every document write is an operator run (ADR 0021 rule 2).
   - The only new operators are thin public wrappers over internal ones (spec §20.3 item 7), `shell.navigate` and a
     poll-failing key shadow. They are registered for every shell, and agents are denied them by default, so the MCP
     toolset does not change.
   - The orchestration Auto-Rig owns today (intake routing, fix order, rig arguments, the motion test, export naming)
     moves into `editor-core/src/autorigFlow`, so both shells emit the same operator sequence.
2. **Names and entry.** The product is **Ekza Studio**, presented as *one studio, two layouts*: the Simple layout (this
   shell) and the Pro layout (`/editor`, titled **Ekza Studio Pro**; its internal id `studio`, routes and storage keys
   stay). The switch reads *▤ Pro layout* / *▤ Simple layout*. A first visit to `/` opens Ekza Studio on every device;
   a remembered choice still wins (owner question OQ-2). Auto-Rig stays at `/autorig` as *Rig a model for me*.
3. **Noun-first grammar.**
   - The first tap on any thing selects it and opens its *Halo*: up to six curated verbs in plain words, plus *⋯ More*.
   - More is derived from a Disclosure Manifest and `poll`, and shows each Pro name and hotkey.
   - A drag manipulates what is already selected, or a handle; anywhere else a finger orbits.
   - A long-press (right-click or hold with a mouse) gives the same verbs as a flick ring, from Pro's `MarkingMenuDef`
     data and controller geometry.
   - Verbs that need a second thing use *verb → target*. Questions the kernel asks (`UiDialog`) become inline cards or
     sheets.
   - The breadcrumb replaces pick-walk and the Outliner hierarchy; the *Numbers* sheet replaces the Channel Box and
     Attributes, with Pro's numbers, units and signs.
4. **One canvas, a thin Path.**
   - *Make · Paint · Rig · Animate* switch workspace, tools and a non-persisted display overlay, never the layout. They
     never gate anything.
   - *Share* is destination-first, mapped to the existing export profiles. *Export … to Files* and *Save project to
     Files* are separate actions.
   - Readiness glyphs, the status pill and Share read one list of check rows and show one count. They never force a
     chunk to load.
5. **Input inside the viewport's own pipeline.**
   - The arbiter is a stage of `ViewportManager`'s pointer path: it buffers a press until slop or long-press decides
     it, then hands the original events, with their coalesced samples, to the tool. Panes are resolved by DOM target.
   - The Pencil acts and fingers navigate; before the first Pencil event, fingers do both. The user can remap this.
   - Only one- and two-finger gestures are used, each has a visible twin, and double-tap frames for every input.
   - One labelled Thumb key works like the iPad's Shift key (tap = once, double-tap = lock, hold). It splits its
     meanings into a tap line and a drag line and carries held keys and the middle button
     (`{shift, mod, alt, held, button}`), so tools keep their semantics.
   - Pick tolerances, slop and double-tap radii depend on the pointer type. A Loupe of named chips resolves crowded
     picks.
6. **Values and modal tools.** After-run *Echo chips* appear only for adjustable operators; every other operator gets
   a pre-run form from Halo-only form data, which Pro, `LastRun` and the MCP schemas never read. Every modal tool shows
   a session bar; leaving a session commits it, and only ✕ discards.
7. **Time.** The *Thread* is a strip with a labelled switch *Timeline · Keys · Curves*: Pro's `DopeSheetController` and
   `GraphEditorController` behind React-free touch adapters, with the curve focus registry and a band source shared
   with Pro. Touch Curves, Dope Sheet, Channels and Weights are release requirements. Rec is Halo's own setting, on by
   default, applied as a removable override of `autoKey`. Reach posing ships in the release.
8. **Parity enforced in a browser.** Every live, non-stub operator, internal ones included, every (operator, arguments)
   pair that Pro or Auto-Rig sends, every `UiDialog` value and every menu item must have a non-search surface, a
   `proOnly` entry from a fixed list of reasons (Pro's docking chrome, keymap editing, many editors at once), or (for
   internal plumbing) an allow-listed entry. The search-only count can only go down.
9. **Shared kernel work comes first and is additive.**
   - The touch navigation moves into `viewport`; the arbiter stage, virtual modifiers and a display overlay are added
     to `ViewportManager`.
   - `ToolPointerEvent` gains pressure, tilt and coalesced samples. Pressure is folded into stamp strength, so
     `skin.weights.paint` arguments stay deterministic.
   - An effective-preferences layer (`device` and `shell` overrides) and a `FileService.save() → SaveTicket` service.
   - The shell-route unions are widened, and `routeHref` maps every route explicitly.
   - Shell-neutral registrations move to the host; `watchRigViewOnly` stays Pro-only.
   - A `@ekza-studio/ui/touch` kit, the `@ekza-studio/editor/models`, `./overlays`, `./toolkit` and `./agent`
     subpaths, and the `@ekza-studio/editor-core/forms` subpath.
10. **iPad Safari is first-class and honest; the bundle is gated and measured.**
    - A `webkit-ipad` Playwright project checks compatibility only; a real-device run with a named owner is part of the
      release gate.
    - A host-level, per-device memory profile (DPR, MSAA, undo budgets, a texture cap at GPU upload only), a two-step
      save through Web Share, byte sniffing, `storage.persist()`, and a web manifest scoped to `/app`.
    - Editing is never locked at any width (Halo never sets the Rig view-only flag, AR-V1).
    - `/app` gets its own gate (proposed 700,000 B, target 660,000 B). `/editor` and `/autorig` gain 0 B from the route.
      The shared extractions are measured by the T1a spike before the ST-B1 allowance is frozen, per package; above
      2,048 B the owner decides.
    - Halo never imports dockview, `PaneView`, `GraphCanvas`, `TimeSliderView` or the editor root.
    - Phone works but is best-effort and outside the release gate (OQ-11).

Pro is not changed to fit Ekza Studio. Its keymap, marking menus, layouts, pane display memory and defaults stay as
they are, and Halo never writes a shared preference (`navProfile`, `autoKey`, `spaceBehaviour`, option defaults,
`uiScale`) except through a visible control; its session settings are overrides removed when it unmounts. AI on iPad
is out of scope until the owner chooses a transport.

## Alternatives rejected

- **Responsive Pro (1).** Dockview, 18 menus and hover-scoped keys would stay on screen and in the bundle. `/editor` has
  6,804 B of eager headroom. Every touch fix would risk changing Pro's behaviour, which the Shapr3D 5.300 lesson warns
  against. Rejected. Pro does still benefit from the shared input fixes.
- **Lite app (2).** "Fewer features" is exactly what the owner ruled out, and cut-down forks drift and die (Gravity
  Sketch iPad). Rejected. The review also rejected v0.1's two-card chooser, because it presented the new shell as the
  lesser product.
- **Intent-first (3).** The offline grammar cannot meet the expectations a blank text field sets: only the `wave`
  reference script is executable today, and the walk, foot and polish plans call motion-analysis functions that throw
  `not-implemented`. Typing on glass is slow, and the soft keyboard covers about half the screen in landscape. Kept as
  an accelerator on the search pill (the *Wave* and *Loop it* recipes at the release, the phrase grammar after it) and
  as receipts in the History ribbon.
- **Journey-first (4) as the whole UI.** The rail risks reading as a wizard, and its MVP sent Curves to an un-touch-ready
  Pro and depended on Peek-hold workspace switches that fight lazy loading on iPad. Kept as the thin Path, the
  destination-first readiness, the labelled Thumb key, the session bar and the generated More list.
- **Eager ParamDef backfill (review option).** Declaring ParamDefs on the animation operators would make Pro's repeat,
  adjust-last and MCP schemas change, and in v0.1's lazy form even depend on load order. Rejected for Halo-only forms;
  making an operator adjustable in Pro stays a separate, per-operator decision (OQ-15).
- **Wrapping the viewport's DOM events (v0.1's arbiter).** Synthetic events cannot be pointer-captured and lose coalesced
  samples, and a geometric pane test lets chrome touches join canvas gestures. Rejected for a stage inside the viewport's
  own pointer path, spiked before the contract freezes.

## Consequences

- Three shells over one app. Every kernel fix reaches all three, and acceptance tests compare export bytes and operator
  logs between them (AS-ST-5).
- The Pro shell gains only its title, a lazy *Simple layout* switch, and the shared input and platform fixes (the
  touch navigation, tolerances, `SaveTicket`, the memory profile), which also help Auto-Rig and Pro on iPad.
- About 100 agent-days to the release gate, in 17 packages (T0, T1a, T1–T4, T5a–T5c, T6a–T6b, T7–T12). The critical
  path is the input spike → the input foundation → the Halo input grammar → Animate → Curves → integration, about 39
  agent-days.
- Capabilities that have no Pro UI today become reachable through human UI:
  - `skin.weights.set`
  - `clip.makeLoop`
  - `pose.transfer`, `pose.setAt` and `pose.goals` (including Reach)
  - `key.adjust` and `key.retime {wrap}`
  - the Auto-Rig-only clip parameters
  - the stand-up and set-height fixes
  - static import outside Auto-Rig
  - multi-part and finger options outside Auto-Rig
  - a History surface
- There is QA cost for a third route, a WebKit project and a real-device run. It is mitigated by the browser parity
  test, shared view models and journey-level e2e.
- Undo history still does not survive a reload or a file open (ADR 0011). That is more visible on iPad, so Halo says
  so plainly; changing it is an owner question.
- Recipes, Auto-Rig's steps and the MCP prompts converge on one registry and one orchestration module. Auto-Rig keeps
  its route until the owner decides (OQ-6).
