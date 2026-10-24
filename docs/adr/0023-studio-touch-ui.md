# ADR 0023 — Ekza Studio touch-first shell ("Halo"): a third shell over the same app, with Studio renamed Studio Pro

- Status: **Proposed** (2026-10-24, with [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) v0.1). It becomes Accepted when
  the owner accepts the spec. The contracts (spec §20.4) freeze when work package T2 merges.
- Inputs:
  - The owner's request of 2026-10-24: *"a lightweight version, say for iPad, while keeping all the functionality … a
    universal, modern, even revolutionary UI/UX … keep the current one as 'Studio Pro', present the new one as the same
    thing with the emphasis on simplicity and minimalism"*.
  - The research round of the same day: a 191-row capability inventory at `dev` @ `0512ba88`, an architecture survey,
    a touch and iPad readiness audit, a market survey and ten user journeys.
  - Four concepts (canvas, intent, object, journey), scored by three judges (simplicity, parity, feasibility):
    object 24.8, canvas 22.7, journey 21.6, intent 18.5.
  - ADR 0021 (Auto-Rig: the second-shell precedent); ADRs 0006, 0008, 0011, 0013, 0016, 0018.

## Context

Studio is a Maya-style power shell: docked panels, 18 menus, marking menus, a Maya keymap and about 328 live operators
over one document and one undo history. On an iPad it is not usable:
- camera navigation needs Alt chords or a wheel;
- about 30 capabilities need a modifier, a held key, a right or middle click, or hover;
- hit targets are 2–8 px;
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

1. **A third shell, not a fork (option 5 at the core).** `/app` (internal id `halo`, package `@ekza-studio/halo`, shell
   marker `ekza-halo-shell`) mounts in the `(studio)` route group under the same `StudioHost`. It runs over the same
   `EditorApp`, document, history, session, services, operators and files as `/editor` and `/autorig`.
   - Every document write is an operator run (ADR 0021 rule 2).
   - The only new operators are thin public wrappers over internal ones (spec §20.3 item 7) and `shell.navigate`. They
     are registered for every shell.
2. **Names.** In the UI the new shell is **Ekza Studio**. `/editor` becomes **Ekza Studio Pro** in UI strings only; its
   internal id `studio`, its routes and its storage keys stay. Auto-Rig stays at `/autorig` and is shown as *Rig a
   model for me*. The chooser at `/` puts Ekza Studio first, then Studio Pro, with Auto-Rig as a link. The remembered
   choice gains `'halo'`.
3. **Noun-first grammar.**
   - Tap a thing to select it and open its *Halo*: up to six curated, plain-language verbs, plus *⋯ More*.
   - More is derived from a Disclosure Manifest and `poll`, and shows each Pro name and hotkey.
   - Drag a thing to manipulate it.
   - Long-press it (right-click with a mouse) to get the same verbs as a flick ring, reusing Pro's `MarkingMenuDef`
     data and controller geometry.
   - Verbs that need a second thing use *verb → target*.
   - The breadcrumb replaces pick-walk and the Outliner hierarchy; the Inspector sheet replaces the Channel Box and
     Attributes.
4. **One canvas, a thin Path.**
   - *Make · Paint · Rig · Animate* switch workspace, tools and lighting (through the `providePaneDisplay` port), never
     the layout. They never gate anything.
   - *Share* is destination-first, mapped to the existing export profiles.
   - Readiness glyphs on the Path and health dots on the model come from the existing Mesh Check, rig checklist,
     Validation and lint rows. They never force a chunk to load.
5. **Input.**
   - The Pencil acts and fingers navigate; before the first Pencil event, fingers do both. The user can remap this.
   - Only one- and two-finger gestures are used, and each has a visible twin.
   - One labelled Thumb key feeds a new `ViewportManager.setModifierSource()` and replaces Shift, Ctrl, Alt, held keys,
     the middle button and right-click finishes. Tools are unchanged.
   - Pick tolerances and drag slop depend on the pointer type.
   - A Loupe resolves crowded picks.
6. **Values and modal tools.** Parameters appear as *Echo chips* next to the result: drag to scrub, with distance-based
   precision, or tap for a numpad. Every modal tool shows a session bar (Cancel, Done, remove point, ± count). Missing
   ParamDefs are backfilled as a lazy contribution (`operators.addParams`), so `/editor` pays no eager bytes.
7. **Time.** The *Thread* is a strip in seconds that unfolds into Parts (Pro's `DopeSheetController`) and then Curves
   (Pro's `GraphEditorController`), both behind React-free touch adapters. Touch Curves, Dope Sheet, Channels and Weights
   are release requirements; they are not handed off to Pro.
8. **Parity enforced in CI.** Every live, non-internal, non-stub operator must have a non-search surface in the
   manifest, or a `proOnly` entry from a fixed list of reasons:
   - Pro's docking chrome;
   - keymap editing;
   - many editors at once.

   The search-only count can only go down. Every continuous-interaction operator needs a hands-on binding.
9. **Shared kernel work comes first and is additive.**
   - Auto-Rig's touch navigation moves into `viewport`, with a public `navigate()` and a multi-pointer `PointerArbiter`
     (pen priority, palm rejection, long-press).
   - `ToolPointerEvent` gains pressure, tilt and coalesced samples. Pressure is folded into stamp strength, so
     `skin.weights.paint` arguments stay deterministic.
   - The shell-route unions are widened, and `routeHref` maps every route explicitly.
   - Shell-neutral registrations move to the host, so they exist without Pro.
   - The key scope comes from `lastPanel` for non-mouse pointers.
   - A `@ekza-studio/ui/touch` kit and an `@ekza-studio/editor/models` subpath are added.
10. **iPad Safari is first-class; the bundle is gated.**
    - A WebKit iPad Playwright gate and a device matrix come before the UI work.
    - An iOS memory profile (a session override), a two-step *Save to Files* through Web Share, opening files by
      sniffing their bytes, `storage.persist()` and a web manifest.
    - Editing is never locked at any width (Halo never sets the Rig view-only flag, AR-V1).
    - `/app` gets its own gate (proposed 700,000 B, target 660,000 B).
    - `/editor` and `/autorig` gain 0 B from the route. The shared extractions sit under one measured re-baseline
      (ST-B1).
    - Halo never imports dockview, `PaneView`, `GraphCanvas`, `TimeSliderView` or the editor root.

Pro is not changed to fit Ekza Studio. Its keymap, marking menus, layouts and defaults stay as they are, and Halo never
writes a shared preference (`navProfile`, `autoKey`, `spaceBehaviour`, option defaults) except through a visible control.
AI on iPad is out of scope until the owner chooses a transport.

## Alternatives rejected

- **Responsive Pro (1).** Dockview, 18 menus and hover-scoped keys would stay on screen and in the bundle. `/editor` has
  6,804 B of eager headroom. Every touch fix would risk changing Pro's behaviour, which the Shapr3D 5.300 lesson warns
  against. Rejected. Pro does still benefit from the shared input fixes.
- **Lite app (2).** "Fewer features" is exactly what the owner ruled out, and cut-down forks drift and die (Gravity
  Sketch iPad). Rejected.
- **Intent-first (3).** The offline grammar cannot meet the expectations a blank text field sets: only the `wave`
  reference script is executable today, and the walk, foot and polish plans call motion-analysis functions that throw
  `not-implemented`. Typing on glass is slow, and the soft keyboard covers about half the screen in landscape. The
  slots depend on ParamDefs that animation operators do not have. Its parity floor is the existing palette. Kept only
  as an accelerator on the search pill, plus receipts in the History ribbon; phrases come after GA.
- **Journey-first (4) as the whole UI.** The rail risks reading as a wizard, and its MVP sent Curves to an un-touch-ready
  Pro and depended on Peek-hold workspace switches that fight lazy loading on iPad. Kept as the thin Path, the
  destination-first readiness, the labelled Thumb key, the session bar and the generated More list.

## Consequences

- Three shells over one app. Every kernel fix reaches all three, and an acceptance test compares export bytes between
  them (AS-ST-5).
- The Pro shell gains only the "Studio Pro" strings and a lazy *Switch to Ekza Studio* entry. The input foundation
  (touch navigation, tolerances, arbiter) also improves Auto-Rig and can later improve Pro.
- About 71 agent-days to the release gate, in 13 packages (T0–T12). The critical path is the input foundation → the
  Halo core → Animate → Curves → integration, about 32 agent-days.
- Nine capabilities that have no Pro UI today become reachable through human UI:
  - `skin.weights.set`
  - `clip.makeLoop`
  - `pose.transfer`, `pose.setAt` and `pose.goals`
  - `key.adjust` and `key.retime {wrap}`
  - the Auto-Rig-only clip parameters
  - the stand-up and set-height fixes
  - static import outside Auto-Rig
  - multi-part and finger options outside Auto-Rig
  - a History surface
- There is QA cost for a third route and a WebKit project. It is mitigated by the manifest, shared view models and
  journey-level e2e.
- Undo history still does not survive a reload or a file open (ADR 0011). That is more visible on iPad, so Halo says
  so plainly; changing it is an owner question.
- Recipes, Auto-Rig's steps and the MCP prompts can converge on one registry later (T13, T14). Auto-Rig keeps its
  route until the owner decides.
