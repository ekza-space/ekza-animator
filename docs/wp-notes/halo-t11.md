# Halo T11 — Share, Home and files (`halo/t11-share-home`)

Work package T11 of [STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 (v0.2, [ADR 0023](../adr/0023-studio-touch-ui.md)):
Home and its intake (§4.2 A, §17, §9 J1 step 1, J2 step 1, J10), the Share sheet (§7.3, §13.3, wireframe F),
*Save project to Files* and the storage card (§13.3, §17, S9–S12, S24), the recipes *Add animations*, *Fix for OMOBA*,
*Loop it* and *Wave* (§8, §9.11), e2e ha-01, ha-11, ha-J9 and ha-J10. Branch from `dev` `582aa335` (T0–T6-INT, the
whole phase S as one shell at `/app`). Decisions:
[DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24) rows
`ST-T11-1` … `ST-T11-17`.

## What landed

| Part | Files | What |
|---|---|---|
| Home | `home/{Home.tsx,model.ts,start.ts,resume.ts,save.ts,slice.ts}` | The real Home (replaces T6a's stub): one sentence; **Continue** cards from the orphaned autosave slots, first and filled when they exist (✕ removes one, `file.discardRecovery`); three doors — *Try a sample* (Polybot; ▾ Seed-san, or the Cube Lad as a model to rig), *Bring a model*, *Make a character* (Smooth body, Blocky body, Cube Lad); *Rig a model for me ▸* (`shell.navigate {to: 'autorig'}`); the gesture line; ▤ Pro layout. Files dropped on Home are brought in too. `start.ts` installs Halo's recovery hook, the silent resume and the Share sheet; `save.ts` is *Save project to Files* and the storage card; `slice.ts` the test API's `t11` slice |
| Intake | `intake/{intake.ts,flowHost.ts}` | *Bring a model* (Home, the project menu's Open and Import): the bytes are sniffed (T0's `sniffFileKind`; a GLB named `scan.bin` opens as a model), models and projects go through `editor-core/autorigFlow` (`freshDocument`, `intakeModel` → `autorig.intake`: Rig & Skin, one import, the 200k gate, the already-rigged detection, `routeIntake`), an animation goes onto the active character (`file.importAnimation`), glTF text and a project's debug JSON go through the host's pipeline, anything else says so (`UNSUPPORTED_FILE_TEXT`). On an iPad a model above 60k triangles (the report's `heavy` tier, the memory profile's warning number) gets a warning. `flowHost.ts` is Halo's flow host with one flow state per app, so Rig it (T9) rigs what the intake recorded (the subject, the start pose) |
| Share | `sheets/share/{ShareSheet.tsx,GameTarget.tsx,model.ts,bake.ts,index.ts}` | Destination first: `For:` (the six destinations; the Rig checks' profile follows, as in Health), the card (*Ready ✓* / *n things to fix* from the one readiness list; the licence as an explicit choice, the author asked once, the name, *About this character ▸*, the animations with their slots; hands-on rows say *Go fix ▸*), *Made for a game* on the OMOBA card (bind to an OMOBA hero, unbind, newer list, the hero's slots with *Make it*), Advanced ▾ (format, profile and the options Pro's dialog has for that call), More formats ▸, the export button that names its file, the footer (the project's state, *Save project to Files*, the storage card). `model.ts` maps each destination to Studio Pro's or Auto-Rig's own call (table below); `bake.ts` is the two-step save |
| Recipes | `recipes/{recipe.ts,addAnimations.ts,fixForOmoba.ts,loopIt.ts,wave.ts,index.ts}` | The recipe contract (plans of operator calls, a step's arguments from earlier results, progress toasts, *Undo all*) and four recipes, offered by search phrases (*wave twice with the right hand*, *loop it*, *add animations*, *fix for omoba*) |
| Words | `i18n/en.ts` | `home.*`, `intake.*`, `ago.*`, `share.*`, `recipes.*` |
| Manifest | `manifest/{types,sheets}.ts`, `searchOnly.baseline.json` | `BUILT_OWNERS` + T11; Share's sections (`destination`, `card`, `advanced`, `moreFormats`, `footer`); the baseline lowered to the target, **100** |
| Tests | `halo/test/{share-bytes,t11-share-home}.test.ts`; `apps/web/e2e/{ha-01-home-intake,ha-11-share,ha-J9-continue-in-pro,ha-J10-resume}.spec.ts`, `e2e/helpers/halo-share.ts` | below |

### What each destination runs (AS-ST-5)

| Destination | Subject | Call |
|---|---|---|
| OMOBA & Ekza Space | a model character **made for an OMOBA hero** | `target.exportPackage {character}` — C2's hero package (`ekza/omoba-humanoid-v2`, the target's slot animations, the slot map). Answers T6b's open question (P-T6B-5) |
| | a model character | `file.exportCharacter` with Studio Pro's Character section defaults (`ekza/space-avatar-v1`, VRM 1.0, slot animations, stored thumbnail) |
| | an imported VRM (1.0 or 0.x) | `autorig.export {target: 'ekza-vrm'}` (Auto-Rig ⑤: the bake through `ekza/space-avatar-v1`) |
| Game engine | a model character, an imported glTF | `autorig.export {target: 'glb'}` (one GLB, `local/generic`, every animation) |
| Just the animations | any character | `autorig.export {target: 'vrma'}` (one VRMA, several as a zip) |
| Prop for OMOBA | the scene's meshes (the selection first) | `file.exportModel` with Pro's Static section request, `ekza/omoba-handheld-v1` |
| Into the original file | an imported character | `file.export {kind: 'bake-into-model'}` with Pro's Export dialog defaults |
| More formats | VRM 0.x kept · rigged GLB · OMOBA test kit · animations only · static model | the bake of a VRM 0.x · Pro's Character section, `local/generic`, GLB · `autorig.export {target: 'omoba-kit'}` (made for a hero: `target.exportPackage {devZip: true}`, the developer zip) · `file.export {kind: 'animation-glb'}` · `file.exportModel`, `local/generic` |

Where a card cannot export (no character, a VRM for Game engine, a character made here for *Into the original file*),
it says why in one sentence and offers where to go (a stage or another destination).

### The two-step save, as built

- Choosing a card **prepares its file at once**: the card's operator runs with the file service's `download` held (the
  `captureDownloads` pattern of agent-tools), so its bytes stay in the page; the operator's own *Exported …* toasts are
  held too (other toasts are passed on). A `SaveTicket` (`FileService.save`, T0) holds the file.
- The export button names the file (*Export Cube_Lad.vrm to Files*) and **delivers it from its own tap**: on iOS WebKit
  the share sheet (`canShare` + `share({files})`, a download after ~10 s or a refusal), elsewhere a download. A host
  without tickets (Node, harnesses) downloads.
- The file is prepared again when the call changes (destination, More formats row, Advanced) or the document changes
  (the key is the operator, its arguments and the store version); a selection or time change prepares nothing.
- **An export never clears the unsaved dot.** Its toast says *Exported …* (iOS: *Shared · iPad does not confirm where it
  went*) and offers *Also save the project*.
- *Save project to Files* (Share's footer, the project menu) is `file.save`, the only thing that clears the dot. Off iOS
  it downloads; on iOS T0's host save prompt holds the `.ekzanim` until its *Save to Files* tap shares it (ST-T11-4).

## Byte equality (AS-ST-5)

`halo/test/share-bytes.test.ts`, headless on the production kernel: Halo's call is built by Share's own model
(`destinationChoice`, `moreFormatChoice`, default options) and run through Share's own capture (`holdingFiles`); the
references are written in the test independently — Studio Pro's requests as its Export dialog builds them and Auto-Rig
⑤'s `autorig.export` targets. `EKZA_SHARE_BYTES=<file>` writes the table. Every row equal:

| Subject | Destination | Halo | Pro | Auto-Rig | Bytes | SHA-256 |
|---|---|---|---|---|---|---|
| Cube Lad rigged (model) | OMOBA & Ekza Space | `Cube_Lad.vrm` | `Cube_Lad.vrm` | `cube-lad.vrm` | 61,844 | `92f71fb2ca674477…` |
| | Game engine | `cube-lad.glb` | `Cube_Lad.glb` (Character section, `local/generic`, GLB, Walk) | (= Halo) | 51,424 | `793341bdc5ab3716…` |
| | Just the animations | `cube-lad-walk.vrma` | `Cube_Lad_walk.vrma` | (= Halo) | 25,972 | `5a05ec30ae5c2ff6…` |
| | More › rigged GLB | `Cube_Lad.glb` | (= Halo) | `cube-lad.glb` | 51,424 | `793341bdc5ab3716…` |
| | More › animations only | `Cube_Lad_walk.glb` | `Cube_Lad_walk.glb` | — | 24,928 | `30ab18403433febe…` |
| | More › OMOBA test kit | `cube-lad-omoba-kit.zip` | — | `cube-lad-omoba-kit.zip` | 33,032 | `1b73d1cb3c23cab9…` |
| same, made for Wildspark (C2) | OMOBA (hero package) | `cube-lad.vrm` | `Cube_Lad.vrm` (*OMOBA character* profile) | `cube-lad.vrm` (`omoba-hero`) | 57,468 | `96153540c248f724…` |
| | More › developer zip | `cube-lad-omoba-dev.zip` | `cube-lad-omoba-dev.zip` (*Developer zip*) | `cube-lad-omoba-dev.zip` (`omoba-kit`) | 36,994 | `4bee9c41e0f57b7c…` |
| Polybot (imported VRM 0.x) | OMOBA & Ekza Space | `polybot.vrm` | `Polybot.vrm` (bake, `ekza/space-avatar-v1`) | (= Halo) | 1,029,552 | `def4a67552b277c6…` |
| | Into the original file | `Polybot.vrm` | `Polybot.vrm` | — | 1,029,552 | `def4a67552b277c6…` |
| | Just the animations | `polybot-walk.vrma` | `Polybot_walk.vrma` | (= Halo) | 25,776 | `b13090b064ac41d4…` |
| UAL mannequin (imported glTF) | Game engine | `quaternius-ual.glb` | `quaternius-ual.glb` (bake, `local/generic`) | (= Halo) | 3,324,884 | `7130214bc464b027…` |
| | Into the original file | `quaternius-ual.glb` | `quaternius-ual.glb` | — | 3,324,884 | `7130214bc464b027…` |
| Hand-held prop (static) | Prop for OMOBA | `Handheld.glb` | `Handheld.glb` (Static section, `ekza/omoba-handheld-v1`) | — | 2,800 | `b47dd22009289ee2…` |
| | More › static model | `Handheld.glb` | `Handheld.glb` (`local/generic`) | — | 2,800 | `b47dd22009289ee2…` |

In the browser, `ha-11` checks it again end to end: Polybot's OMOBA file delivered by the export button equals the
same document's Studio Pro bake (`file.export`, `ekza/space-avatar-v1`) run through the test API right after, and the
Cube Lad's OMOBA file (after the licence and author were chosen in the card) equals Pro's Character section export.

## Journeys and touch counts (AS-ST-4)

Counted by the test API's counter (`halo().touches`) while Halo is mounted, plus the tap that leaves for Pro, which the
spec counts itself.

| Journey | Target | Measured | Where |
|---|---|---|---|
| J9 same page, touch-only iPad | ≤ 2 | **2** (▤ Pro layout, *Open anyway*) on `chrome-touch` and `webkit-ipad` | `ha-J9` |
| J9 same page, mouse and keyboard | 1 | **1** on `chrome` | `ha-J9` |
| J9 another device | (2) | **2** (project menu, *Save project to Files*), then Studio Pro opens the file with the same document | `ha-J9` |
| J10 after a reload | 0 | **0**: the same document, stage, time and selection, *Back where you were*, no Recovery dialog | `ha-J10` (all three projects) |
| J10 from autosave | ≤ 1 | **1**: Home › Continue | `ha-J10` (all three projects) |
| J1 step 1 (Home's part) | 2 | **2**: *Bring a model* (counted) and the file in Files | `ha-01` |
| J2 step 1 (Home's part) | 2 | **2**: *Make a character*, *Smooth body* | `ha-01` |
| J1 step 6 / J6 step 3 (Share ⤴) | 1 each | Share ⤴ counts one touch; a destination, the licence, a filled field and the export button one each | `ha-11` |

## Exit test (§21 T11 row)

| Check | Result |
|---|---|
| Every destination byte-equal to the Pro / Auto-Rig export (AS-ST-5) | **Green**: every destination and every More formats row, headless (table above), and in the browser for OMOBA on an imported VRM and on a model character (`ha-11`) |
| The two-step save (mocked share on WebKit; device D11) | **Green** on `webkit-ipad` with a mocked Web Share: choosing *Just the animations* prepares `polybot-walk.vrma` and nothing leaves the page; the export button's tap shares it (*Shared · iPad does not confirm where it went*); *Save project to Files* goes through the host's save prompt, its tap shares the `.ekzanim`, the dot clears and the storage card offers *Keep projects on this iPad*. The real share sheet and Files are device check D11 (T12's device run) |
| An export never clears the unsaved dot | **Green**: `ha-11` (Chrome and WebKit: the dot and `state().dirty` stay after the export; only the project save clears them) and the unit test |
| J9 ≤ 2 touches on iPad | **2** (`chrome-touch`, `webkit-ipad`); 1 with a mouse (`chrome`) |
| ha-01 and ha-11 green on `chrome-touch`, booting on `webkit-ipad` | **Green** on `chrome-touch` and `chrome`; on `webkit-ipad` ha-01 boots Home, loads a sample, sniffs a picked file (the picker has no `accept` on iOS) and makes a character; ha-11 runs Share and the two-step save |
| `searchOnly` drops to the T11 target | **100** (target 100): explicit 4, pending 96; reachable without search 241 → **250** of 352 live operators |

Unit tests: `halo` 180 (20 files; T11's own: `share-bytes` 4, `t11-share-home` 19 — the baker, the destination calls,
Advanced's defaults, Home's model, the resume record, the intake routing, the storage card, the recipes with a headless
wave on Polybot and its *Undo all*, the OMOBA profile of a character made for a game).

Screenshots (production e2e build, Chrome with touch @2x; in the session's scratchpad `halo/`, not committed):
`t11-{ipad-landscape,ipad-portrait,phone}-{home,home-starts,share-exploring,share-omoba,share-ready}.png`.

## Parity

`ha-parity` at `/app` (chrome), the baseline regenerated with `EKZA_HALO_PARITY_WRITE=1`:

| | before (T6-INT) | T11 |
|---|---|---|
| `searchOnly` total | 114 (4 explicit, 110 pending) | **100** (4 explicit, 96 pending) |
| by stage | make 1 · paint 12 · rig 18 · animate 52 · all 31 | make 1 · paint 12 · rig 18 · animate 52 · **all 17** |
| reachable without search | 241 | **250** |
| left the list | — | `autorig.export`, `autorig.intake`, `autorig.navigate {to: autorig…}`, `file.export`, `file.exportCharacter`, `shell.navigate {to: autorig, chooser}`, `target.bind`, `target.unbind`, `target.update`, `target.slot.create`, `target.exportPackage`, `ui.open {export}`, `ui.open {firstRun}`, `workspace.showPanel {target}` |

Each of these now has the surface the manifest names: Share's cards and More formats (the export operators), Share's
*Made for a game* (`target.*`, Pro's Target panel), Home (`autorig.intake`, *Rig a model for me*, Pro's first-run
dialog), the frame's sheet slot (`ui.open {export}` opens Share).

## Gate and sizes

@@GATE@@

## Lines outside the row (each a seam, listed for the integration)

| File (owner) | Lines | Why |
|---|---|---|
| `halo/src/shell/controller.ts` (T6a, T6-INT) | 2 imports; `disposers.push(startHome(controller))` in `start()`; `t11: homeSlice(controller)` in the test API's slices; one line in `proLayout` (the touch counter) | P-T6A-4: the recovery hook, the resume, the Share sheet; J9's count |
| `halo/src/shell/TopBar.tsx` (T6a) | Share ⤴ counts one touch; the destination's badge on it (`halo-share-badge`) | §7.3 badge; J1 step 6, J6 step 3 |
| `halo/src/shell/ProjectMenu.tsx` (T6a) | *Save project to Files* saves (was: opens Share); *Recover…* shows Home; Open and Import go through T11's intake (Open = a new project, Import = add) | J9 another device (2 touches); S10 sniffing for the menu's files |
| `halo/src/palette/Palette.tsx` (T6a) | a *Recipes* group above *Do* (`matchRecipes`, the offer's run); Enter runs the first recipe | §8 recipe phrases |
| `halo/src/path/readiness.ts` (T6b) | `profileFor`: the OMOBA destination checks `ekza/omoba-humanoid-v2` for a character made for a game | P-T6B-5 |
| `halo/src/manifest/{types,sheets}.ts`, `searchOnly.baseline.json` (T6b) | `BUILT_OWNERS` + T11; `SHEET_SECTIONS.share`; the baseline (100) | P-T6B-5, §21 |
| `halo/test/rules.test.ts` (T6a) | the vocabulary lint admits *animation* in `home.`, `intake.`, `share.`, `recipes.` | Share's destinations and slots, Continue's counts |
| `editor/src/host/index.ts` (T0, T2) | re-exports: `sniffFileKind`, `nameForKind`, `UNSUPPORTED_FILE_TEXT`, `isIosWebKit`, `FileKind`, `sharePreferred`, `requestPersistentStorage` | Halo reaches the editor only through `./host` (see sizes for what sharing these modules costs `/editor`) |

## Patches for other packages

| # | File (owner) | Patch | Why |
|---|---|---|---|
| P-T11-1 | `halo/src/recipes/rigIt.ts` (T9) | Run *Rig it* over `haloFlowHost(ctx)` from `intake/flowHost.ts` (one flow state per app): Home's intake recorded the subject, the intake report and the start pose there, which `rigRunArgs` reads (straighten). Add `rigIt` / `fixBend` to `SEARCH_RECIPES` (`recipes/index.ts`) with `searchable(...)` if search should offer them | One subject from intake to rig (AS-ST-5's J1 log) |
| P-T11-2 | the frame (T7, T12) | A recipe stepper card above the tray (*Rig this character · 2 of 4*, a *Resume* chip from sessionStorage, §9.11) is not built: T11's recipes are short and say their progress in one toast with *Undo all*. T9's *Rig it* may want it; `RecipeOutcome` and the step ids are there for it | §9.11 |
| P-T11-3 | `viewport` (T1's owner) | A camera getter/setter for a pane's view (`viewCamera(paneId)` / `setViewCamera(paneId, {position, quaternion})`): J10's silent resume restores the document, stage, time and selection, but the view camera comes back framed, not where it was (the viewport keeps no camera across a reload) | J10 "the same … camera" |
| P-T11-4 | Studio Pro's `EditorShell` arrival (T12, T3's follow-up) | Pro's toast *Same project, every panel at once · Undo still works* on arrival `from=halo` (§16.1, J9) is still missing; ha-J9 checks the document, history, selection, time and workspace instead | J9's wording |
| P-T11-5 | `halo/src/manifest/disclosure.ts` (T6b, T12) | `file.saveJson` stays explicit `searchOnly`; the spec's *Share › Advanced › Debug JSON* (§15 row 12.3) can be added to Advanced when the owner wants developers to find it there (the ratchet then goes to 99) | §20.5 "developer items only" |
| P-T11-6 | T7 (`sheets/library`, `stages/animate`) | T7's Library *Add starter set* and T11's *Add animations* recipe both run `autorig.clip.add` × idle / walk / run; the Library may call `addAnimationsRecipe` (`recipes/addAnimations.ts`) so both stay one list | One starter set |
| P-T11-7 | `docs/STUDIO-TOUCH-SPEC.md` §20.2 (T12) | The files as built: `home/{model,start,resume,save,slice}.ts`, `intake/{intake,flowHost}.ts` (the spec has `home/intake/`), `sheets/share/{model,bake,GameTarget}`, `recipes/{recipe,index}.ts` | The spec follows the code |

## Follow-ups

- The real share sheet, Files and `storage.persist()` are device checks D11 and D12 (T12's device run); WebKit here
  runs a mocked Web Share.
- *Try a sample · already moving* (§4.2 A) loads Polybot without playing a library preview: previews are T7's (the
  Library), and a preview started on Home would have to be stopped by every surface that edits.
- Share's *Advanced* shows the options Pro's dialog offers for the call; Auto-Rig ⑤'s targets and C2's package take
  none (their bytes are Auto-Rig's exactly), so Advanced lists only their format and profile.
- *Go fix ▸* switches to the row's stage and runs its *Show me*; the *Back to Share ▸* chip that §7.3 shows until Share
  is reopened is not built (a frame chip, T12 with the Next chip's owner).
- Advanced lists what Studio Pro's dialog offers for the card's call: key reduction, close loops, unchanging channels
  and the licence acknowledgement (`file.export`), materials (`file.exportCharacter`), colours and materials
  (`file.exportModel`). *Root motion / in place* and *fix flips* are clip settings and curve verbs (T7, T10), not export
  options, so Share does not repeat them.
