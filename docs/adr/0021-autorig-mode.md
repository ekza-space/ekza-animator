# ADR 0021 — Auto-Rig mode: a second shell over the same app and document

- Status: Proposed (2026-10-22, with [AUTORIG-SPEC](../AUTORIG-SPEC.md) v0.1; refreshed with v0.2 against the merged
  M6b MVP, `v0.4.0`; v0.3 applied the spec review round); becomes Accepted when the owner accepts the spec.
- Implemented: 2026-10-22 on `autorig/mvp` (A0, D0…D7; [AUTORIG-SPEC §17](../AUTORIG-SPEC.md#17-integration-record-d7-2026-10-22)).
  The shared `(studio)` layout shipped (undo history kept across the switch); `/autorig` 658,122 B under its 660,000 B
  gate; an Auto-Rig export is byte-equal to Studio's (AS-AR-1, AS-AR-2, AS-AR-4).
- Inputs: the owner's request of 2026-10-22 ("on opening choose the full interface or a simplified auto-rig built on
  the interfaces we already have — like Mixamo … Studio must become a universal combine"); the owner's decision on
  Q-AR-4 (build the A-pose path in this milestone); M6B-SPEC v1.5 §0 and ADR 0020 (the M6b MVP cut, merged on `dev`);
  ADRs 0006, 0008, 0010, 0013; the market survey in AUTORIG-SPEC §2 (Mixamo, AccuRIG, Cascadeur, Tripo, Meshy).

## Context

The M6b MVP gives Studio everything a Mixamo-style flow needs — Quick Rig markers with a One-Click guess, Create
Skeleton, Bind Skin, weight painting, a CC0 clip library with preview and Use Clip, and a VRM 1.0 writer whose lints
are OMOBA's runtime rules — but inside a Maya-style workspace with docked panels, menus and a checklist. Newcomers who
only want "upload, rig, see it move, get a file for OMOBA" meet the whole package at once. The owner wants a choice on
opening: the full Studio, or a simple auto-rig made from the same parts, and wants Studio to grow into a "universal
combine".

Four ways to build that were considered:

1. **A separate app** (its own package and site) calling the M6b kernels directly.
2. **A new workspace tab** (`autorig`) inside Studio's dockview shell.
3. **A layout preset** ("Simple") of the Rig & Skin workspace that hides panels.
4. **A second shell** over the same `EditorApp`: a wizard UI that drives the existing workspaces, modes, tools and
   operators, on its own route.

## Decision

1. **Auto-Rig is a second shell (option 4).** The `/autorig` route mounts a wizard (Model → Markers → Rig →
   Animations → Export) over the same `EditorApp`, document, history, session, services and operators as `/editor`.
   It switches the shipped workspaces (`rig`, `animate`) and the M6b modes headlessly, and lays out the shipped
   viewport panes (`PaneView`) in its own grid instead of dockview.
2. **No second implementation.** Every document write from Auto-Rig runs an operator that Studio has (shipped or M6b)
   or one of a few new *composition* operators (`autorig.sample`, `autorig.intake`, `autorig.inspect`, `autorig.fix`,
   `autorig.rig`, `autorig.cancel`, `autorig.clip.add`, `autorig.export`, `autorig.navigate`) that only call existing
   ones, live in the lazy `rig-workspace` chunk and are registered for every shell. Auto-Rig never writes the store or
   calls a kernel directly; a test enforces it. The only new non-UI code is pure and small: the
   clip-parameter transform (speed, trim, mirror, arm space) applied before Use Clip, cross-checked against the shipped
   mirror, and the intake sniffing.
3. **One document, handed over in place.** `/autorig` and `/editor` sit under one Next route-group layout that hosts the
   app and the GL canvas once per page load, so switching between them keeps the document, the undo history and the
   WebGL context. New tabs and reloads hand over through a one-shot handoff record (`?handoff=<id>`, not the autosave
   slot). A spike in D0 measures the layout split on `/editor` first; if it breaks the budget, the plan of record is
   two islands with record handoff only, and the owner gets the measured number.
4. **Entry**: the landing page `/` becomes a chooser (Auto-Rig, Studio) with an optional remembered choice; deep links
   `/autorig` and `/editor` never redirect; each mode links to the other.
5. **Lighter route, gated; `/editor` does not grow by accident**: `/autorig` excludes dockview, the curve editor, the
   panel registry, menus, command palette, marking menus and the first-run dialog from its initial scripts (gate
   660,000 B gzip, target 620,000 B); the M6b chunks load per step. `/editor` had 25 B left in the M6b eager allowance,
   so every Auto-Rig byte is lazy except four listed exceptions (2,048 B in all) under a re-baseline recorded with
   measured numbers in DECISIONS-OPEN (AR-B1).
6. **Deliverables**: the Ekza VRM 1.0 (Space and OMOBA, the M6b `ekza/space-avatar-v1` profile with an in-browser
   checklist built from the Validation rows), a GLB with clips, VRMA clips, and an OMOBA local test kit; "Publish to
   Ekza Hub" is reserved and stays absent until the Hub upload (M4a T3) exists.
7. **Private by construction**: no telemetry and same-origin network only, tested end to end.
8. **A-posed models become T-pose VRMs in Studio first**: M6b's deferred A-pose path is built as a Studio feature (A0):
   fit and bind in the mesh's own A-pose, then *Straighten to T-Pose* (Apply Pose as Rest with a computed T-Stance)
   converts the document's rest, so Validation, painting, clips and the one VRM writer all see a VRM T-pose; Auto-Rig
   runs it automatically after the bind when the **input** was A-posed (never because a T-posed body trips
   `skel.tpose`: that is a joint placement to adjust, not a pose to bake).

## Alternatives rejected

- **Separate app (1)**: would duplicate the shell's services, autosave, input and GL host, and tempt direct kernel calls
  that drift from Studio's operators; handing work to Studio would need a file round trip. Rejected.
- **Workspace tab (2)**: keeps dockview, menus and the Studio chrome on screen and in the bundle, and duplicates C7's
  mode, scope and test-pose logic keyed on the `rig` workspace. Rejected; Auto-Rig uses the `rig` and `animate`
  workspaces as they are.
- **Layout preset (3)**: cannot turn a Maya-style toolkit into a guided flow (one primary action per step, plain-language
  checks, progress) and does not make the route lighter. Rejected; Studio's presets stay as they are.

## Consequences

- Every fix or improvement to an M6b operator reaches both modes; Auto-Rig cannot diverge from Studio's output (an
  acceptance test compares export bytes from both).
- The editor package is split into a host part (services, app, GL host, input, autosave) and the Studio shell; that
  refactor (D1) is the main risk and is gated by `/editor`'s size budget.
- Six contract requests (CR-AR-1…6: panel bodies usable outside dockview, clip params on preview and Use Clip, bind
  progress, pure start checks, checklist export, `dropSkin` on static import) were sent to M6b; the merged MVP
  satisfied the start checks, the checklist export, most panel bodies, the pane ids and `dropSkin` (untyped); the rest
  — the paint-weights body, the plain-grid test, clip params, `replace` and the in-memory preview — is Auto-Rig
  package work (AUTORIG-SPEC §9).
- The "one app, several shells" rule makes later simple modes (pose and render, AI model → avatar after M7) cheap.
- A-posed models reach the OMOBA VRM through A0 in both modes; the straightened mesh is an LBS bake of the A-pose bind,
  so armpit and shoulder shapes follow the auto weights (paint fixes them, as in Studio), and a later rebind computes
  weights on the T-posed mesh (Q-AR-19).
- Auto-Rig's composition operators extend the `rig-workspace` chunk rather than adding eager code, so the Studio route
  pays only for its entry points.
