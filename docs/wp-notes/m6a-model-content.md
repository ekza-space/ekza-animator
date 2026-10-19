# M6a B13 — Content: Outliner, palette, Paint Colour, primitives UI, templates, image planes, Make editable UI, export UI: build notes

Branch `m6a/model-content` (from `m6a/spec` at `ec541b4`, with its dependsOn merged: `m6a/mesh-kernel` (B1) at
`6d0253b`, `m6a/mesh-runtime-doc` (B7) at `778cd1f`, `m6a/mesh-io` (B8) at `447cf8b`, `m6a/shell-workspaces` (B9) at
`19fc312`, which carry B0a and B0b). Scope:
[M6A-SPEC §9 B13](../M6A-SPEC.md#b13--content-outliner-palette-paint-colour-primitives-ui-templates-image-planes-make-editable-ui-export-ui)
with §5.13 (scene operators), §5.16, §5.19, §5.21 (UI), §5.26, §8.8 and E2E-MOD-11, -13, -27, -29. Decision IDs below
are `M6A-B13-<n>`. B10 (component selection, hilite) and B11 (registered `mesh.*` operators, Last-op card, INPUTS) are
not merged here: they gate the parts that need them (§9 table "Unit READY gates").

## What landed (by spec responsibility)

| B13 item | Where |
|---|---|
| Paint ops `mesh.paint`, `mesh.paint.fillShell`, `mesh.paint.remap` (kernel) | `mesh-core/src/ops/paint/index.ts` (tests `mesh-core/test/ops/paint`) |
| Humanoid body generator (`smooth` 494 tris, `segmented` 560; closed, manifold, X-symmetric, T-pose, grounded, hexagonal hand and foot caps) | `mesh-core/src/templates/humanoidBody.ts` (tests `mesh-core/test/templates`) |
| `palette.*`, `select.mesh.bySwatch` (§5.19: default palette "Ekza Default 16" with deterministic ids on the first modeling action, slots never reused, variants by duplicate, Replace Swatch over `mesh.paint.remap`, the active swatch) | `editor-core/src/operators/builtin/palette.ts` (definitions, polls) + `contentApply.ts` (bodies, M6A-B13-10) |
| `mesh.create.template` (prop, handheld, humanoid guides, humanoid body into a selected template group) and `mesh.primitive.set` (live parameters, the freeze rule) | `editor-core/src/operators/builtin/templates.ts` + `contentApply.ts` |
| `scene.group/parent/unparent/duplicate/delete/rename`, `mesh.setAttributes` | `editor-core/src/operators/builtin/scene.ts` + `contentApply.ts` |
| `imagePlane.import/set/delete` (PNG/JPEG as a `reference-image` asset; without bytes the menu path opens the import dialog) | `editor-core/src/operators/builtin/imagePlane.ts` + `contentApply.ts` |
| Image planes drawn (records → decoded images → B9's `setImagePlanes`, lazy until a plane exists) | `viewport/src/imageplanes/{index,binding}.ts` |
| Template guides: humanoid proportion lines per preset, the handheld grip gizmo (helpers layer, Model only, never picked or exported) | `viewport/src/guides/{index,draw,levels}.ts` |
| Paint Colour tool (`ToolDef.keys` `KeyI`, `Enter`; click, drag stroke, Shift fill, `I` eyedropper, `Enter` on the selection) | `viewport/src/tools/model/paint/{index,tool,pick}.ts`, registered in `viewport/src/manager/contributions.ts` |
| Model Outliner (Scene hierarchy, characters › Meshes with `⊘ asset` rows and the inline Make editable button, Reference planes; badges; hilite on click in component modes; drag to reparent; RMB menu; inline rename) | `editor/src/panels/outliner/{ModelOutliner.tsx,modelTree.ts,planeSelection.ts,sceneSelection.ts}`; `OutlinerPanel.tsx` switches by workspace |
| Palette panel (`palette-*` test ids) | `editor/src/panels/palette/**` (registered in `panels/index.ts`) |
| Attributes › Mesh, Primitive, Pivot, Handheld grip, Image plane (`attr-*` test ids) | `editor/src/panels/attributes/ModelSections.tsx`; `AttributesPanel.tsx` shows it in Model |
| Model start card, Getting started card (pane overlay slots `emptyState`, `gettingStarted`) | `editor/src/panels/viewport/{modelOverlays.tsx,ModelEmptyState.tsx,GettingStarted.tsx,ownPointer.ts}` |
| Make editable report dialog, reference image import dialog | `editor/src/dialogs/{MakeEditableReport,ImagePlaneImport}.tsx` (the B0a `PendingDialog.tsx` placeholder is gone) |
| Export dialog › Static model (GLB) | `editor/src/dialogs/ExportStaticSection.tsx`, mode switch in `ExportDialog.tsx` |
| First-run question "Animate an avatar / Model something new" | `editor/src/dialogs/FirstRunDialog.tsx` |
| Test API `palettes()`, `activeSwatch()`, `imagePlanes()` | `editor/src/test-api/m6a/model-content.ts` |
| Reference image fixtures (CC0, generated) | `fixtures/images/reference-{front,side}.png` by `tooling/make-reference-images.mjs` |
| e2e | `apps/web/e2e/m6a-content.spec.ts` (B13 checks, ungated), `m6a-11-palette-recolour-export.spec.ts` (`test.fixme('b10: …')`), `m6a-13-handheld-sword.spec.ts` (`'b3, b4, b12a: …'`), `m6a-27-primitive-freeze.spec.ts` (`'b10, b11, b12a: …'`), `m6a-29-reference-planes.spec.ts` (`'b10: …'`); helpers `helpers/m6a-model-content.ts` (`buildSword`, face finders, the Create › Reference Image flow, GLB accessor / palette PNG / zip readers) |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M6A-B13-1 | **The Outliner switches by workspace**: Animate keeps the shipped tree byte for byte; Model renders the Model variant (a lazy chunk). The Model tree is not virtualized (low-poly scenes hold tens of objects). Groups `⊞`, meshes `▢`, planes `▣`; a template group shows its kind unless its name says it. | §3 rule 10; §8.8 "Outliner (Model variant)". |
| M6A-B13-2 | **Image planes are selected in the panels**, not in the session: `panels/outliner/planeSelection.ts` keeps one selected plane per app (U state); a Reference row, the RMB menu or a fresh import selects it and clears the object selection; selecting objects clears it. Attributes shows the Image plane section for it. | Planes are never picked in the viewport (§5.26) and `SessionState` is closed; the e2e needs `attr-plane-*` right after Create › Reference Image. |
| M6A-B13-3 | **`mesh.setAttributes` also takes a group id** for the fields a group has (`name`, `budget`, `handheld`): the Attributes panel edits a template root's grip and budget through it. | §6.2 lists the operator for meshes; template roots are groups (§5.16). |
| M6A-B13-4 | **Outliner selection runs B10's `select.objects`**; while it is B0a's stub (poll "not available yet", this branch) the panels write `selection.objects` directly (`sceneSelection.ts`), as selection-only U state allows. With B10 merged the operator (and its "Select" step) always runs; the fallback is then dead code INT may drop. | Keeps the Outliner, Attributes, Palette and the Static export usable and testable before B10. |
| M6A-B13-5 | **Paint Colour picks faces itself**: a ray from the pane's camera snapshot (`ViewportManager.camera`, `paneRect`) against each paintable mesh's kernel triangulation in world space, nearest hit; hidden objects, objects outside the pane's isolate list and hidden faces are skipped. A stroke is previewed through `app.meshes.beginOp` and committed on release as one `mesh.paint {faces}` run with `source: 'tool'` (the matching session commits); Shift+click runs `mesh.paint.fillShell`; `I` held makes the slot under the pointer the active swatch (a swatch of the mesh's palette); `Enter` runs `mesh.paint {slot}` on the selected faces. Refusals (no active swatch, asset-backed meshes) are toasted. | Works without mesh-view (B6) or B10's `MeshDisplay`; INT may switch to `MeshDisplay.pick` without changing the behaviour. |
| M6A-B13-6 | **`attr-plane-offset` is one field** taking "right, up" metres (`0, 0.9`; commas or spaces). Size and opacity are number fields; a locked plane shows its fields read-only and takes only Lock and Visible. | §8.10 names one `attr-plane-<field>` per field; E2E-MOD-29 types into `attr-plane-offset`. |
| M6A-B13-7 | **Model start card and Getting started** draw in one pane: the maximized pane, else `pane-persp` (every Model quad has it), else the layout's first pane. The start card shows on an empty Model scene (no character, mesh, group or image plane); **in Model the Animate drop zone never shows** (`ViewportPanel.tsx`, one line; the start card has Import mesh… and the sample). Getting started shows in Model until dismissed (per browser, `localStorage` `ekza-animator:model-getting-started:v1`); steps ① ② ③ ④ tick from the document and the session (a mesh exists, face mode used, an Extrude ran, a symmetry is on) and stay ticked; keys come from `shortcutFor(app.keymap, …)` with the Model viewport scope chain (`⌘E`/`Ctrl+E`, Export `⇧⌘E`/`Ctrl+Shift+E`). Both cards stop the pane's native `pointerdown` (as B11's Last-op card does): the pane surface captures the pointer and would retarget their clicks. | §8.8; §5.17 key labels; B10's branch also edits the drop-zone line (see Hand-over). |
| M6A-B13-8 | **Export dialog**: an Animation / Static model (GLB) choice (`export-animation`, `export-static`) shows when the project has meshes or in Model; Static is the default in Model or without a character. Roots: the topmost selected objects, else every scene root. A single handheld root defaults to `ekza/omoba-handheld-v1` (§5.16), else `local/generic`; colour output and material default to each mesh's own; Drop tangents shows only when a made-editable mesh's glTF primitives carried `TANGENT`. Results show the size, lints and the validator's counts (or "Validator not run"). | §8.8 Export dialog; Animate without meshes is unchanged. |
| M6A-B13-9 | **`prefs.set` accepts `lastWorkspace` and `modeling`** (`editor/src/shell/operators.ts` `PREF_KEYS`): the first-run start choice and the palette recents (`prefs.modeling.paletteRecents`, eight, most recent first). | Both are §4.6 preferences without another writer. |
| M6A-B13-10 | **B13's operator bodies are a lazy chunk** (`operators/builtin/contentApply.ts`, loaded by `contentLoad.ts`): definitions, metadata and polls stay eager (menus, keymaps, the command palette); every scene, palette, template and image-plane operator awaits the chunk in `prepare` and runs its body from it; the default palette table and the attribute and plane patch checks live there too (those polls run the checks once the chunk has loaded — the runner polls again after `prepare`, so a bad patch still cancels with its reason, never fails). `mesh.create.*` (B7) gets the default palette through the same chunk in its `prepare`. Without this the merged branch's initial route was 902,305 B (> the 900,000 B gate). | §5.27 eager budget; M6A-B9-16's lazy-by-default rule. |
| M6A-B13-11 | **Guides**: each proportion line is a square outline (half width 0.3 × height) at its height so it reads in front, side and top views, plus two height lines and the +Z facing arrow; colours from the §8.9 tokens (`--sym-plane` blue; grip ring rig-centre yellow, shaft axis-Y green, fingers axis-Z blue), 75 % opacity, no depth test, Model workspace only, hidden with their group. `stylized` levels match the body generator at 1.6 m (chin 1.46, shoulder 1.33, hip 0.82 m); `chibi` is a three-heads figure, `blocky` five. | §5.16 "proportion guides … from the preset's proportions"; no numbers given. |
| M6A-B13-12 | **Make editable from the Mesh menu** (`mesh.makeEditable` without arguments) poll-fails "Use Make editable on a mesh row in the Outliner" (one line in B8's `makeEditable.ts`); the Outliner's button passes `{character, meshIndex}`, opens the report on success, and a licence refusal (§5.21 step 1) toasts the reason with a "Show licence" action (Attributes, the licence badge) instead of running. | §8.3 lists Mesh › Make Editable without arguments. |
| M6A-B13-13 | **Palette panel details**: the swatch grid is a `fieldset` of 20 px buttons (`aria-pressed`, a ✓ glyph and ring on the active one); `palette-hex` commits on Enter or blur (never per keystroke: `#ff0` would be a valid 3-digit colour half-way through `#ff0000`); double-click opens a popover with a colour picker, the hex field and the name; RMB on a swatch: Make Active, Edit Colour…, Replace with <active> (`palette.replaceSwatch`), Remove. Apply paints the selected faces in face mode, or every face of the selected meshes in object mode. "Assign" appears when the shown palette is not the selected mesh's. | §8.8 lists the controls, not their behaviour. |
| M6A-B13-14 | **Reference image fixtures** are generated silhouettes (`tooling/make-reference-images.mjs`, deterministic, 256 × 512 RGB), CC0, recorded in `fixtures/LICENSES.md` prose: `check-fixtures` accepts table rows only under `models/` and `animations/`. | §9 B13 "generated, CC0". |
| M6A-B13-15 | **Merge fixes** (each a literal update named in its commit): `editor-core/test/mesh/ready.ts` gains `READY.primitives` (B1's primitives without B3's extrude); B7's asset-row case uses the fixture's asset character (B8's `assetMeshRows` lists live asset characters only); the M6a foundation tests list B13's landed operators; the viewport tool list gains `paint`; the test API's B13 group answers instead of throwing. | Merging B1, B7, B8 and B9 into this branch. |

## Hand-over

- **B10**: the Outliner runs `select.objects {ids, mode}` (Shift toggles, Mod removes, Mod+Shift adds) and, in a
  component mode, `model.hilite {meshes, mode: 'add'}` (Mod: `'remove'`); drop M6A-B13-4's fallback if you like.
  `ViewportPanel.tsx`: B10 shows the drop zone in Model "while the scene has no mesh either"; this branch hides it in
  Model altogether (the start card owns the empty Model scene) — at merge keep B13's line. The Outliner's lint dot
  reads `checkMesh` (B5) through the kernel and appears once B5 is in. Paint Colour may pick through
  `MeshDisplay.pick` later (M6A-B13-5).
- **B11**: `mesh.paint` from a menu or marking menu carries no `slot` (Edit Mesh › Assign Colour › Active Swatch,
  `model.modes`/`model.tools.face` "Assign Colour ▸"), so it paints slot 0. §6.1 says "UI passes the active swatch's
  slot": the registered `mesh.paint` should take `slot` from `session.model.activeSwatch` when the args omit it (the
  Palette panel's Apply and the Paint Colour tool pass it already). Paint strokes run with `source: 'tool'` and the
  tool id `paint` (`MESH_OP_TOOLS`), so `G` re-activates the tool.
- **B12a**: Attributes › Pivot runs `mesh.pivot.set {id, pivot}`; `buildSword` places objects with
  `scene.object.transform`; the freeze-rule case "pivot edits keep the parameters" is gated on `mesh.pivot.set`
  (`editor-core/test/m6a/content/templates.test.ts`).
- **INT**: READY flag `b13`; lift the gates of E2E-MOD-11 (`b10`), -13 (`b3, b4, b12a`), -27 (`b10, b11, b12a`), -29
  (`b10`). `PANEL` should gain `palette` (B9's M6A-B9-13). Eager route: see "Eager route". Not done here (spec
  mentions, no operator or menu row exists): **Create › New model** — the start card already shows on any empty
  Model scene.

## Eager route (§5.27)

Production build, `check:size` (gzip -9, first visit): with every B13 operator body eager the branch measured
902,305 B; after M6A-B13-10 **898,226 B** (gate 900,000 B, headroom 1,774 B; the +20,480 B
allowance stays unenforced, M6A-B9-14). Per-file attribution (source-map build) of B13's eager code: the operator
definitions and polls `palette.ts` 2.4 kB, `scene.ts` 1.8 kB, `imagePlane.ts` 1.3 kB, `templates.ts` 1.3 kB, the
loader 0.15 kB; Model overlay slots 0.65 kB, the lazy-body boundary 0.44 kB, the Paint Colour definition 0.42 kB, the
guide and image-plane loaders 0.38 + 0.29 kB, the Palette panel wrapper and registration 0.4 kB. Everything else
(Model Outliner, Palette view, Attributes sections, cards, dialogs, the paint behaviour and picking, the plane
binding, the guides drawing, the operator bodies) is lazy.

## DoD status

| DoD item | Status |
|---|---|
| CI green | Local gates green (below); the full e2e suite once at the end. |
| READY flag `b13` | Set by INT at merge. |

## Gates (this branch)

Filled in after the final gate run (see the last commit of these notes).
