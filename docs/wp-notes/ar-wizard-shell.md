# Auto-Rig D3 — wizard shell: frame, progress, session store, Simple navigation and ① Model: build notes

Branch `autorig/wizard-shell` (from `autorig/mvp` at `04e2c54`, D1's `autorig/studio-host` merged at `b985501`). Scope:
[AUTORIG-SPEC §10 D3](../AUTORIG-SPEC.md#d3--wizard-shell-frame--model) with §4.1–§4.3 (frame, progress, session),
§5.1–§5.2 (frame, ① Model), §6.1–§6.2 (the ① rows), §8.1–§8.4 (keys, Simple navigation, accessibility, devices,
strings). Decision IDs below are `AR-D3-<n>`. The work package prompt named these notes `autorig-wizard-shell.md`; the
spec's D3 Dirs name `ar-wizard-shell.md`, which this file follows (as D0 and D1 did).

## What shipped

| Part | Where |
|---|---|
| `ViewportManager.setNavigationOverride(o)` (the eager hook, consulted on press before `pointerGesture`; null falls back to the profile) and the `NavigationOverride` type | `viewport/src/manager/ViewportManager.ts`, `viewport/src/navigation/override.ts`, one export line in `viewport/src/index.ts`; test `viewport/test/navigation-override.test.ts` |
| `autorig.sample` (static fixtures from `<samplesPath>`, VRM samples through `file.loadSample`), `autorig.intake` (content sniff → one of `mesh.importStatic {dropSkin}`, `file.importModel`, `file.openProject`; refusals before importing), `autorig.inspect` (C2's `rigGeometry` + `quickRigStartChecks` + `guessMarkers`, the upright/size rows, the tiers; U), `autorig.fix` (`center`, `face`, `standUp`, `scale`, `freeze`: one inner operator each) | `editor-core/src/operators/builtin/rig/wizard/intake.ts` (rig-workspace chunk); tests `editor-core/test/autorig/{intake,dropskin}.test.ts` |
| The three static samples in `public/samples/` | `apps/web/scripts/copy-assets.mjs` |
| Session store: `patch(slice, partial)`, `set`, `resetSubject`, `load`; the `sessionStorage['ekza-studio:autorig:v1']` mirror (try/catch; blocked storage skips it) | `autorig/src/session/index.ts` |
| Derived progress (§4.3 table): `progressOf` (pure), `autoRigProgress(app, session)`, `resolveSubject`, `landingStep` | `autorig/src/progress/index.ts` |
| Simple navigation: `simpleGesture` (the arbitration table), `installSimpleNavigation(app, vm)`, `addNavigationClaim` (for D4's markers), `toolClaims`; two-finger pan and pinch zoom on touch screens (`twoFingerStep`, `installTouchNavigation`; lazy, loaded only where touch points exist; fix round 1) | `autorig/src/nav/index.ts`, `nav/touch.ts` |
| Wizard controller: arrival (handoff record, Studio hand-over, `?step=`, `?sample=`, the mirror), step navigation and the §4.2 entry order (serialized: `entryQueue`, fix round 1), the mounted-shell slot (`leave`, `handoffState`), the test API's `autorig()`, the `autorig` keys, file drops, Simple navigation on/off | `autorig/src/shell/controller.ts`, `entry.ts`, `keys.ts`, `store.ts`, `context.ts` |
| The frame: header (mark, subject name with rename, undo/redo with step labels (off while a composition runs), *Open in Studio ▸* with the new-tab flow on a middle or modified click, `⋯`), stepper (`nav` + the step's `h1`, `aria-current="step"`, ✓ / blocked reasons), `main` (pane grid + step panel / bottom sheet; from ③ on the panes draw the pose view and library preview badges), footer (Back, status line, one primary) | `autorig/src/shell/Frame.tsx`, `Pane.tsx`, `PaneBadges.tsx` (lazy), `Menu.tsx` (the button) + `MenuBody.tsx` (lazy), `KeysSheet.tsx` (lazy), `steps.ts` (step registry), `index.tsx` |
| ① Model: drop zone (picker, samples, Continue where you left off, rigged-other choice, project characters), strip after a load; report panel (lazy) with the check rows and their fixes, Pose, Transforms, parts, weight notes, From Studio. Lazy since fix round 1: the ① actions (`flow.ts`, `parts.ts`), the cards a fresh profile never shows (`Extras.tsx`) | `autorig/src/steps/model/{ModelStep.tsx,ui.ts,Extras.tsx,Report.tsx,flow.ts,fixes.ts,checks.ts,parts.ts}` |
| Derived progress's checklist chunk (`rigChecklist`, loaded with the first model; AR-D3-21) | `autorig/src/progress/checklist.ts` |
| Strings and keys | `autorig/src/i18n/en/{frame,model}.ts`, `autorig/src/keymap/steps/{frame,model}.ts` |
| a11y helpers | `autorig/src/a11y/index.ts` |
| `/autorig`'s shell | `apps/web/app/(studio)/autorig/AutoRigEntry.tsx` |

### For D4–D6: the step view contract (AR-D3-8)

The frame renders ① itself and, for ②–⑤, whatever the step package's `steps/<step>/index.ts` exports (additive):

```ts
export const stepView: () => Promise<{ default: ComponentType<StepViewProps> }>; // lazy: its own chunk
export const stepPanes: (session: AutoRigSession) => readonly StepPane[];         // the pane grid (default: persp)
export const stepEnter: (ctx: WizardContext) => Promise<void> | void;           // the step's own start (§4.2)
```

`StepViewProps = { ctx, slot }`: the view renders twice, `slot: 'overlay'` over the panes and `slot: 'panel'` in the
side panel (a bottom sheet below 1024 px); the panel instance sets the footer (`ctx.setFooter({status, tone,
primary})`). Until a package lands its view the frame shows a placeholder. `ctx.go(step)` navigates (refused when the
step is not reachable; never undoes), `ctx.run(op, args)` runs an operator for the UI (failures toast and show in the
footer), `ctx.session.patch(slice, partial)` writes the step's slice, `useProgress(ctx)` / `useSession(...)` read.
Panes are `WizardPane`s (`id`, `size`; AR-D3-1): they register with the ViewportManager as `PaneView` does and,
from ③ on, draw the pose view (`BIND POSE` / `TEST POSE`) and library preview (`PREVIEW <clip>`) badges with Studio's
test ids (`hud-badge-pose-<pane>`, `hud-badge-preview-<pane>`). They draw **no** modal readout, camera name, `LOCKED`
badge or frame counter: D4's ③ *Adjust joints* shows the dragged joint's values in its own panel (or asks D7 for a
host export of the readout, measured against `/editor`). R-Markers is `[{id: 'pane-front', size: 40}, {id: 'pane-side', size: 30},
{id: 'pane-persp', size: 30}]`. A step's own claim of a press under Simple navigation: `addNavigationClaim(app, fn)`.
The model and the frame strings live in `i18n/en/{frame,model}.ts`; a step's own go in its table.

## Decisions and deviations

| ID | Decision | Why / evidence |
|---|---|---|
| AR-D3-1 | **Auto-Rig's panes are `WizardPane`s, not the shipped `PaneView`** (proposed in DECISIONS-OPEN §M for D7; fix round 1 added the pose and preview badges, see the step view contract): a DOM surface registered with the page's ViewportManager exactly as PaneView registers its own (`paneSetup` → `registerPane`, `unregisterPane` on unmount), tagged `data-ekza-panel="viewport"` / `data-ekza-pane` for the host's hover tracking (the viewport key scope: `F`). No header (no camera menu, no display toggles: §5.1's minimal chrome); the canvas draws behind it and the viewport tools work in it unchanged | **Importing `PaneView` from `/autorig` costs `/editor` +1,444 B gzip** (measured: a shell that renders only `PaneView` vs one that only reads the host, both builds otherwise equal): Turbopack scope-hoists PaneView's subtree (PaneView, PaneMenu, CameraRadial, the overlay slots, `usePaneState`, the display defaults) into its single importer in `/editor`, and a second importer anywhere in the app (another route's chunk group) splits those modules into separate factories. That alone exceeds D3's 128 B and the whole AR-B1 limit (897,736 B). Same for `routeHref`, the `Check` icon and `RIG_MARKER_PANES` (each hoisted in `/editor`): Auto-Rig writes `/editor?ws=…` (the click goes through the navigation port, which builds the real URL), a text ✓ and the literal `'pane-persp'` |
| AR-D3-2 | Progress reads the Validation rows through `app.rig.validation.rows(character, 'ekza/space-avatar-v1')` (the contract's `RigValidationService`) and uses `rigChecklist`'s ① and ③ glyphs; ④'s "a clip exists" is the checklist's own rule written out (its ⑤ also counts a previewed clip) | importing `rigValidation` from the editor-core root pulled the Validation service (rows, rules, io lints) into `/autorig`'s initial route: **+14.5 kB** measured |
| AR-D3-3 | ① stays where it is until the first model: the switch to Rig & Skin (Object mode) runs with the first file, sample or From Studio, so the rig-workspace chunk loads then (§7.2 per-step loads) | ① with an empty document has nothing to rig; the first-visit route stays the frame |
| AR-D3-4 | ①'s report panel and its fixes (`Report.tsx`, `fixes.ts`) are a lazy chunk, loaded with the first model (or a waiting Studio hand-over); fix round 1 also made lazy the ① actions (`flow.ts` with `parts.ts`: loaded by the first file, sample, drop, `?sample=` or Continue) and the cards a fresh profile never shows (Continue, the rigged-other choice, a project's characters: `Extras.tsx`). A chunk that does not arrive (offline after a redeploy) shows "Couldn't load the model step…" in the footer and the next action tries again | first visit = the frame and the drop zone (§7.0 rule 5) |
| AR-D3-5 | Simple navigation overrides presses only (the spec's hook is "consulted on press"): the wheel is the user's profile's (Maya: zoom; trackpad: two-finger scroll orbits, pinch zooms); left on empty space in a persp pane tumbles, right **and middle** track (§8.1 names the right button; the middle one tracks too so a three-button mouse is not dead — for D7's sign-off), ortho never tumbles, `Alt`/`Shift`/`Ctrl`/`Cmd` fall through to the profile and the tool. **Touch (fix round 1)**: one finger is a left press; two fingers pan (the midpoint) and pinch-zoom (the spread, towards the midpoint) — `nav/touch.ts`, a lazy chunk loaded only where `navigator.maxTouchPoints > 0`. It needs no ViewportManager API beyond the press hook: the second finger cancels the first one's gesture with a `pointercancel` (a tool drag it began is cancelled, not committed), then the pair drives the pane's own navigation with synthetic presses whose gesture the override forces (`track` at the midpoint; for a spread change a `dolly` press moved by `ln(spread ratio) / 0.005` px, so the camera distance scales by the inverse ratio); the fingers' own events stop at the document (capture phase) | a wheel override would need a second eager hook; the 128 B allowance went to the press hook (+33 B measured); multi-touch through the press hook adds 0 B to `/editor` |
| AR-D3-6 | "The tool claims the press" = a non-mesh pick at the point (`pickCandidates`: manipulator, control, joint), the mesh under a painting or Quick Rig marker tool (`isOverMesh`), or a step's own claim (`addNavigationClaim`, for ②'s markers in the persp pane) | `ViewportPointerLayer` has no side-effect-free hit test |
| AR-D3-7 | The mirror holds the subject and the intake as well as the step, the start pose and the five slices; a Studio hand-over of another subject than the mirror's starts fresh (the From Studio card) | returning to the step needs the subject's ids; the ids survive `file.recover` |
| AR-D3-9 | `⋯ › Preferences` and `⋯ › About & credits` open the shipped host dialogs (Preferences shows every row, not only §5.1's navigation profile — for D7's sign-off); `⋯ › Keyboard shortcuts` is Auto-Rig's own sheet (lazy) listing `AUTORIG_KEYMAP` and the kept shipped keys; `⋯ › Open project…` is a file picker into ①'s intake | the host dialogs exist on both routes; Studio's shortcuts dialog lists Studio's keymap |
| AR-D3-10 | The frame's key rows (capture phase, before the host's adapter): `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` (refused while a composition runs, §4.5), `Mod+Enter`, `Alt+1…5` (Studio's layout presets prevented), and Studio's `Mod+K` (palette: through `⋯`), `Alt+0`, `Ctrl+Space` turned off. `Esc`, `F`, `Shift+F` stay the shipped rows; `Esc` also stops a library preview | §5.1 "no command palette key"; §8.1 |
| AR-D3-11 | A VRM / rigged-humanoid report: `meshes: []`, the height from the imported runtime's skeleton, triangles and `textured` from the file's JSON, the start checks reported as passed (they are the static meshes' rows) and `pose: null` | the contract's report shape |
| AR-D3-12 | `rigged-humanoid` = a skinned GLB whose `skeletonFromGltf(...).humanoid` maps every VRM-required bone; the shipped importer maps the humanoid only from the VRM extensions, so today it arises only for a `.glb` with them (and such a file sniffs as `vrm`); a skinned GLB without imports nothing (`rigged-other`): *Re-rig from scratch* (`dropSkin`) or *Open in Studio* (`file.importModel`, then the switch) | §5.2 table |
| AR-D3-13 | `.gltf` is "unsupported" with the GLB hint | the shipped importer reads binary GLB only (`parseGlb`) |
| AR-D3-14 | *Upright* is the bounds rule (Z extent ≤ 1.5 × height); the "no feet band" probe is not used (C2's `toesToward` is not exported) — for D7's sign-off | a lying model fails *Faces +Z* too |
| AR-D3-15 | *Center and ground* is C2's operator: it moves x and y and leaves z; AS-AR-5's guess check compares against the truth moved along z by the bounds' centre. **Flagged for D7 / C2's owner**: after AS-AR-5's three fixes the ×100 off-centre Cube Lad passes every check but stands at z ≈ 72.975 m (its placement `t = [0, 0, 72.975]`), so its export would sit 73 m in front of the origin; the fix belongs in C2's operator (centre z too), not in an Auto-Rig workaround | C2's rule (§0.4.2) |
| AR-D3-16 | A ① failure stays in the footer (an assertive line) until the next ① action; the host's `runFromUi` also toasts it | §6.3 |
| AR-D3-17 | Files dropped anywhere go to the wizard: a capture-phase `drop` listener routes them to ① (the host's drop goes to Studio's import dialog) | §5.2 drop zone |
| AR-D3-18 | `?step=` and `?sample=` are read once at the arrival and dropped from the URL; a step requested before its document exists (a reload before Continue, a sample still loading) waits until reachable; at the arrival a document that cannot reach it lands on the furthest reachable step | §3.1, §4.3 |
| AR-D3-19 | The `⋯` menu is a small menu button of its own (`aria-haspopup`, arrows, Home/End, Esc/Tab close, focus back); since fix round 1 its list, the project picker and the shortcuts sheet are a lazy chunk (`MenuBody.tsx`) loaded by the first press | no Radix menu on `/autorig`'s first visit |
| AR-D3-20 | The ① *Size* row reads the Y extent: a Z-up centimetre model reads "huge" before it stands up (AS-AR-5's three fixes run stand up → size → centre, the order the footer names) | the row is about the model's height in Y |
| AR-D3-21 | The progress checklist (`rigChecklist` and its inputs, +1.9 kB on `/autorig`) is a lazy chunk (`progress/checklist.ts`). `progressOf` takes it as an input (`checklist`, null while loading); the controller loads it as soon as the document holds something (a retry at the next change if it fails). Without it a subject **character's** skeleton and binding are unknown: ② and ③ are not done and ③/④/⑤ say "Checking the rig…" (scene meshes need no checklist) | the first visit has no model; the checklist is there long before Create Skeleton |
| AR-D3-22 | Step entries are serialized (`entryQueue` in `shell/entry.ts`): every entry waits for the previous one; a later request skips a queued entry and stops a running one before its workspace switch, mode and step start (`enterStep(…, current)`), so ②'s `stepEnter` can never run after ③'s session end | §4.2's order with quick changes (Alt+2 then Alt+3) |
| AR-D3-23 | `placementsAfter` in `wizard/intake.ts` repeats C2's nested-mesh walk and world→local conversion from `fixOperator.apply` (`operators/builtin/rig/quickRig.ts`, outside D3's Dirs). **D7 follow-up**: one shared helper (e.g. `placementsAfterDelta(view, meshes, delta)`) used by both | the shared-file rule (§10.0) |
| AR-D3-24 | The header's Undo/Redo buttons are disabled while a composition runs (`session.busy` or `app.session.busy`), as the keys are (§4.5) | the buttons and the keys agree |

## Fix round 1 (the verifier's findings at `17be2894`)

| Finding | Outcome |
|---|---|
| blocker: `/autorig` 672,585 B over the 660,000 B gate | lazy ① actions and cards, `⋯` list and checklist: **669,088 B**; the rest is not the wizard's — escalated with a measured lever (`TooltipProvider` per shell: 655,798 B) as AR-D3-G in DECISIONS-OPEN §M (see Sizes). **Not met inside D3's Dirs** |
| major: `WizardPane` instead of `PaneView`, no overlays | proposed as AR-D3-1 in DECISIONS-OPEN §M with the measured +1,444 B; the panes draw the pose and preview badges from ③ on (lazy; e2e); the step contract says what D4 does for the modal readout |
| major: no two-finger pan/pinch on touch | built (`nav/touch.ts`, lazy, 0 B on `/editor`); unit and E2E-AR-12 (tablet, phone) |
| minor: step entries not serialized | `entryQueue` + `enterStep(…, current)` (AR-D3-22); unit tests |
| minor: `placementsAfter` duplicates C2's walk | D7 follow-up (AR-D3-23; noted at the function) |
| minor: `setNavigationOverride` between `setPointerLayer` and its comment | moved |
| minor: stale comments (Frame's `PaneView`, the nav disposer) | Frame's header fixed; the disposer's comment now says it clears the hook unconditionally (one override at a time: the controller disposes the old one first) |
| minor: Preferences, middle button, feet band, header Undo/Redo while busy | the three deviations proposed for D7's sign-off (AR-D3-S); Undo/Redo disabled while busy (AR-D3-24) |
| minor: six files outside the Dirs | listed below for D7 (now seven: DECISIONS-OPEN §M) |
| minor: C2's Center and Ground leaves z (73 m along +Z) | flagged to D7 / C2 (AR-D3-15, AR-D3-S) |

## Sizes (production build, `check:size`, gzip -9)

| Build | `/editor` (eager + First-run) | D3 delta vs D1 (896,327 B) | `/autorig` |
|---|---:|---:|---:|
| D1 head (merge `b985501`) | 896,327 B | — | 655,590 B (D1) |
| + the ViewportManager hook (`7b3820c`) | 896,360 B | +33 B | — |
| + the ① compositions (`e6aedea`; rig chunk) | 896,375 B | +48 B | — |
| frame with `PaneView`, `rigValidation`, `routeHref`, `Check` (first cut) | 898,136 B | +1,809 B (FAIL, AR-B1) | 694,779 B |
| `WizardPane`, no `rigValidation`, lazy report (AR-D3-1/2/4) | 896,390 B | +63 B | 672,426 B |
| first round's final (`17be2894`) | 896,390 B | +63 B | 672,585 B |
| fix round 1: lazy ① actions and cards, lazy `⋯` list, lazy checklist (AR-D3-4/19/21) | 896,390 B | +63 B | 669,088 B |
| **fix round 1 final** (+ badges, touch, entry queue; the CI run below) | **896,390 B** | **+63 B** | **669,088 B** |
| measured lever, **not committed** (outside the Dirs): the host's `TooltipProvider` moved into `StudioShell` | 896,350 B | +23 B | **655,798 B** |

`/editor`: D3's eager change is the press hook in the ViewportManager (+33 B) and +30 B of chunk drift; within D3's
128 B. `/autorig`: **669,088 B, 9,088 B over the 660,000 B gate** after fix round 1 (reported, not enforced until D7
records the route, §7.2). **D3's DoD item "/autorig within its gate" is not met inside D3's Dirs** — see
*The `/autorig` gate* below. Attribution (`STUDIO_SOURCE_MAPS=1`, per package): the wizard package (frame, ① drop zone, controller,
session, progress, nav, strings) ≈ 16.6 kB of it (43.6 kB raw: Frame 8.5, ModelStep 6.6, controller 5.1, flow 3.7,
Menu 3.0, the strings 4.6); editor-core 102.8 kB (D1: 100.9; +1.9: `rigChecklist` and its inputs), rig 36.8, io 5.7,
the rest as D1 measured. D1's headroom warning stands: the overrun is the host's (+20.7 kB over §7.1, mostly the Radix
tooltip/toast providers) and editor-core's eager operators (+15.9 kB over §7.1), against a frame of ≈ 16.6 kB (§7.1
budgeted ≈ 25 kB for it). Levers left for D7 (outside D3's Dirs): the host's `TooltipProvider` per shell (≈ 14 kB;
Auto-Rig's chrome uses `title` attributes, no Radix tooltip); a lazy `⋯` menu (≈ 1 kB). **For D7 / the owner**: the
`/autorig` gate question of §7.2 with these numbers.

### The `/autorig` gate (fix round 1; for D7, then the owner under Q-AR-17)

Fix round 1 moved everything a fresh profile's first visit does not show into lazy chunks: the ① actions and the
cards, the `⋯` list, the checklist (−3,497 B; source-map attribution: `autorig` 16.0 → 14.1 kB, `editor-core`
102.9 → 100.7 kB). What is left of the wizard on the first visit is the frame, the stepper, the panes, the drop zone,
the footer, the controller (arrival, keys, drops, progress, Simple navigation), the session store and the strings:
**≈ 14.1 kB of the route's 669.1 kB**, below §7.1's ≈ 25 kB. The other 9.1 kB over the gate are not the wizard's:
D1 left `/autorig` at 655,590 B (4,410 B headroom; D1's own warning: the host +20.7 kB over §7.1, mostly the Radix
tooltip/toast layers, and editor-core's eager operators +15.9 kB). Making the frame itself lazy would only move bytes
every first visit loads anyway (§7.2 rule 4 counts the shell group as initial), so it was not done.

**Measured lever, outside D3's Dirs (D1's `editor/src/host/StudioHost.tsx` and `editor/src/shell/EditorShell.tsx`):
the host's `TooltipProvider` moved into `StudioShell`** (Studio's tooltips keep their shared provider; a tooltip in a
host dialog creates its own, the `Tooltip` primitive's documented fallback). Measured on this branch with a production
build and `check:size`, then reverted (not committed): **`/autorig` 655,798 B (−13,290 B, 4,202 B under the gate),
`/editor` 896,350 B (−40 B)**. The change:

```diff
--- packages/editor/src/host/StudioHost.tsx
-import { ToastProvider, TooltipProvider } from '@ekza-studio/ui';
+import { ToastProvider } from '@ekza-studio/ui';
-        <TooltipProvider>
           <ToastProvider swipeDirection="right" label="Notifications">
 …
           </ToastProvider>
-        </TooltipProvider>
--- packages/editor/src/shell/EditorShell.tsx
+import { TooltipProvider } from '@ekza-studio/ui';
 …
-    <ShellProvider shell={shell}>
+    <TooltipProvider>
+      <ShellProvider shell={shell}>
         …
-    </ShellProvider>
+      </ShellProvider>
+    </TooltipProvider>
```

D7 either approves it (recorded here and in DECISIONS-OPEN §M, AR-D3-G) and lands it at the merge, or takes the
measured numbers to the owner (§7.2: the gate is never raised silently; Q-AR-17). Until then D3 does not count as
done on this DoD item.

## Tests

- Unit, viewport (Chrome): `navigation-override.test.ts` — a plain drag tumbles only while the override says so,
  right tracks, null falls back to the profile (Alt+RMB dolly), removing it restores the profile, `navProfile` untouched.
- Unit, editor-core (Node): `test/autorig/intake.test.ts` (sniffing, tiers, static/VRM/rigged-other/dropSkin intakes,
  refusals before import, AS-AR-5 three fixes = three undo steps then the guess within 0.05 H, face, freeze, samples)
  and `test/autorig/dropskin.test.ts` (CR-AR-6); the P-C6 rows of the four ① ids are `checked` (keys hash unchanged).
- Unit, autorig (Node): `progress.test.ts` (§4.3 over document fixtures incl. `xform.scale` blocking ③ and
  `animations.skipped`; fix round 1: the checklist chunk not loaded yet — a character's skeleton and binding unknown,
  "Checking the rig…", scene meshes unaffected — and `autoRigProgress` after `loadChecklist()`), `session.test.ts`
  (store and mirror), `nav.test.ts` (the table, install/remove, claims, no prefs write; fix round 1: the two-finger
  step — pan by the midpoint, pinch by the ln of the spread ratio, no sub-pixel zoom), `entry.test.ts` (fix round 1:
  the entry queue — a superseded running entry stops, a queued one is skipped, a failing one does not block — and
  `enterStep`'s order and its stop before the workspace switch), `keys.test.ts`, `steps/model/model.test.ts` (fix
  order, parts), `contracts.test.ts` (updated).
- E2E-AR-03 (`ar-03-model-intake.spec.ts`, `ar-03-model-session.spec.ts`, helper `helpers/ar-model.ts`): AS-AR-5;
  the ① halves of AS-AR-7 (250k refused with the hint, 80k warns, Next asks once) and AS-AR-6 (the sword unticked,
  out of the subject, the checks the body's); AS-AR-4's ① routing of a VRM to ④ with the already-rigged reasons;
  the ① part of AS-AR-9 (reload → Continue on ① → back to the mirrored step; Start over); `?sample=` / `?step=`;
  From Studio; the keys; Simple navigation and Studio's profile after a switch; Open in Studio on the same page;
  rename; refusals; (fix round 1) the panes' badges from ③ on — `BIND POSE`, `TEST POSE` after `rig.pose.view`,
  `PREVIEW Walk` while `library.preview` plays, none on ①.
- E2E-AR-12 (`ar-12-layouts.spec.ts`): the frame on ① and on a placeholder step at 1440×900, 1024×768 touch and
  390×844 touch (landmarks, no horizontal scroll, side panel vs bottom sheet, stepper labels, ≥ 44 px targets); (fix
  round 1) on both touch sizes, through CDP touch events: a two-finger spread zooms in (the view direction unchanged,
  the distance to the body < 0.8×), two fingers moved together pan (the camera moves across the view, not along it),
  one finger orbits.

**Shared files touched outside the D3 Dirs** (for D7's approval): `packages/ui/styles.css` (one `@source
"../autorig/src";` line — D0's note: Tailwind scans only `editor/src` and `ui/src`), `packages/editor-core/test/autorig/
glb.ts` (new: the GLB variants the two D3 test files share), `packages/editor-core/test/autorig/composition.test.ts` and
`apps/web/e2e/ar-00-foundation.spec.ts` (the four ① ids now refuse with their own argument polls instead of "Arrives
with Auto-Rig"; the placeholder page is the wizard), `apps/web/e2e/ar-01-host-switch.spec.ts` (`autorig()` answers the
wizard's state instead of null), `packages/editor-core/test/m6b/keys-hash.test.ts` (the D3 rows `checked`), and (fix
round 1) `docs/DECISIONS-OPEN.md` §M (D7's section: the D3 rows proposed there, AR-D3-1 and AR-D3-G, marked as awaiting
D7). D7 records the approval of each, or moves the change to its owner, at the merge.

## Gates

Final run on `autorig/wizard-shell` (after `fix(ui)`): `EKZA_E2E_PORT=3164 pnpm run ci` — format, lint, typecheck,
check:deps, fixtures, licences, every package's unit tests (autorig 37, editor-core 1,512, viewport 274, editor 573,
headless 201, …), clean build, check:size (`/editor` 896,390 B, AR-B1 eager delta +702 B ≤ 2,048 B, enforced, pass;
`/autorig` 672,585 B, reported over the 660,000 B gate, see Sizes) — and the full e2e suite on local Chrome:
**277 passed, 24 skipped (the stretch `fixme`s), 1 failed**: `shading-01-blinn` (a Model-workspace pixel poll, untouched
by D3; D1's notes list it among the load-timing flakes of a full run), which passes alone 3/3 (`--repeat-each=3`).
Every Auto-Rig spec (`ar-00`, `ar-01-*`, `ar-03-*`, `ar-12`) with `--repeat-each=3`: 72/72. An earlier run of the gate
failed `ui`'s `tokens.test.ts` (it pins the first three lines of `styles.css`): the `@source "../autorig/src"` line now
follows them.
