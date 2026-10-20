# Open owner decisions — defaults chosen

Status: 2026-10-19, M2a merged into `dev` (rev. 8; rev. 8 revised section G after the modeling plan's design review
(MODELING-PLAN v0.2 §12); rev. 7 added section G: the owner decisions of the modeling
iteration M6a–M7 planned in [MODELING-PLAN](MODELING-PLAN.md), with defaults; rev. 5 added section F: the M2a build
deviations, the integration decisions and
the owner review items of M2a; section E holds M1's integration decisions, acceptance rounds, WP-10 e2e and budget
decisions and the consolidated build deviations of WP-1…WP-9). Every item below has a **default chosen** so that work can
start; **the owner may override any of them**. "Decide by" is the latest milestone at which a change is still
cheap. Items marked **override** are cases where a coordinator default was replaced on evidence. Research
references: `R01`…`R09` = [`research/0N-*.md`](research/). Section D records how the design review was resolved,
including the points that were rejected or only partly accepted.

## A. Coordinator defaults (recorded as given)

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-NAME-1 | Product name, repository and package scope | **Ekza Animator**, repository `ekza-animator`, private workspace scope `@ekza-animator/*` (unpublished). Never romanized as "Exo" (ExoTools exists, R05 §5c). `.eza` is avoided (EZ-Animator). | Renaming packages is mechanical before M2; brand change touches docs and UI strings. | M2a |
| Q-LIC-1 | Licence | **MIT + DCO** sign-off (checked in CI); Apache-2.0 headers kept on the AnimX port files; fixtures under their own licences; no GPL/AGPL code or runtime dependencies (ADR 0009). | Apache-2.0 for the whole repo is the fallback if a contributor needs an explicit patent grant; switch before the first external contribution. | before first external PR |
| Q-TIME-1 | Default frame rate | **30 fps** scene and new-clip default; per clip 24/25/30/48/50/60/custom (rational). Imported clips keep their detected source rate (UAL: 24). | Only new-clip defaults change. | any time |
| Q-PROJ-1 | Project file | **`.ekzanim`** zip (`manifest.json`, `project.json`, `assets/<sha256>`) plus a plain JSON debug variant `.ekzanim.json`; exports are derived artifacts (ADR 0011). | Switching to an "authoring GLB" container needs a registered `EKZA_` vendor prefix. | M2a |
| Q-HK-1 | Default keymap and Space | **Maya-style preset** with a trackpad navigation profile; **Space tap = maximize the pane or panel under the pointer**, first-run toggle "Space plays" (R09 §15 Q1). Space-hold radial and the one-button macOS profile are M1-stretch. | Presets are data; changing defaults is trivial. | M2a |
| Q-COL-1 | Collaboration in the MVP | **Not implemented.** The MVP ships the store boundary (transactions with per-field changes, preview sessions, stable IDs, D/U/P split, partitions with `open/close`, async assets, scene clock, per-user undo per merge unit) and the conformance suite. The production store is the plain in-house store; a **private, test-only Yjs store (`packages/doc-yjs`, yjs 13.6.33) runs the full suite in CI from M1** (ADR 0002). | A Yjs production store from day one would add async `open` and Yjs debugging to the MVP for no user value; the evidence it would provide is gathered by `doc-yjs` anyway. | M3 |
| Q-MOD-1 | Modeling | **Not in the MVP.** Cheap path kept: `SplineSet` shared by control shapes and future splines, `TableDef` and tool registries, component-capable selection (ADR 0004, ADR 0008). **2026-10-18: planned as M6a–M7, polygons first; decisions in [§G](#g-modeling-iteration-m6am7-defaults-chosen-2026-10-18).** | — | M6 |
| Q-EKZA-1 | Ekza upload | **Not in the MVP.** Integration contract defined: typed kind `ekza:animation:<uuid>`, profile `universal / vrma-humanoid-v1`, tiers T0–T3, `ekza_animation_v1` metadata with provenance, export profiles as data, Studio deep link and embed protocol; MVP = Tier 0 export compatibility (ADR 0010). | Upload needs registry/SDK/game changes in other repos (M4a). | M4a |
| Q-EKZA-2 | Reuse of `@ekza/avatar-renderer` | **No runtime dependency** (peer `three <0.186`, not on npm, CDN Draco). Small MIT helpers are copy-adapted with attribution headers (ARCHITECTURE §13). | A "Preview as Ekza Space" panel first emulates Space; using the real renderer needs decoder injection, npm publication and peer `<0.187` upstream. | M2c |
| Q-ASSET-1 | Bundled sample avatars | **override.** Coordinator default: NeonGlitch86 VRM 1.0 fixture from `ekza-avatar-renderer` + 100Avatars "Polybot". The NeonGlitch86 file's own VRM meta says `allowRedistribution: false`, `modification: prohibited`, `commercialUsage: personalNonProfit`, and it embeds a Mixamo clip, so it **cannot** ship in an MIT repository. **Chosen**: Seed-san (VRM 1.0, VRM Public License 1.0: redistribution, modification and commercial use allowed, credit required) + Polybot (VRM 0.x, CC0) + Quaternius UAL (generic GLB, CC0), credited in [`fixtures/LICENSES.md`](../fixtures/LICENSES.md) and the About dialog (ADR 0012, with an erratum to research 03). | The owner may provide a CC0 VRM 1.0 avatar to replace Seed-san as the default sample. | M1 |

## B. Architect defaults the owner should know about

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-RIG-5 | **Leg IK in M1?** | **No — FK legs plus `Pose → Pin Feet / Plant Feet`** (two-bone solve written as FK keys, one undo step per key). The solver math and its tests ship in M1; leg IK controls, the `ik2` op and IK/FK match are M2a item 1 (ADR 0004 §12). M1 is said plainly to target in-place loops, upper-body emotes and blocking with planted feet. | Pulling leg IK into M1 costs ≈ 5 agent-days (WP-3 +4, WP-5 +1) and pushes the alpha by about 2 days on the critical path. | M1 start |
| Q-RIG-6 | COG / hips split | `cog` is a pure space (t+r); `fk.hips` rotates the pelvis; spine under `cog`, legs under `fk.hips`; imports put hips motion on `cog` (Maya convention). | Template keys are baked into control IDs and pose clipboards: decide before projects exist. | M1 |
| Q-TOOL-1 | TypeScript version | **override of research 04.** **TypeScript 6.0.3**, not 7.0.2: `typescript@7.0.2` exports only `lib/version.cjs` (no JS API), which Next.js and API-based tools need. tsconfig kept TS-7-clean and `types: []`-aware (ADR 0001, MVP-SPEC §2). | Moving to TS 7 is a version bump once Next/tooling declare support. | M2a |
| Q-TOOL-2 | Package manager and test runner | **pnpm 10.32.1** (installed; no corepack on Node 25) and **Vitest 4.1.11** (engines include Node 25); Node 24 LTS in CI. | pnpm 11 / Vitest 5 are drop-in upgrades later. | any time |
| Q-ANIM-1 | Default tangent type and weights | **Auto** (AnimX legacy auto with clamp: smooth, never overshoots; Maya 2025 default). Tangent weights **locked** by default on weighted curves. | Preference-level change. | any time |
| Q-ANIM-2 | Unkeyed pose edits | Key-less channels store a per-clip **static value** (undoable, saved, exported); keyed channels edited with auto-key off get a **session override**, discarded on frame change, **undoable through the editor history** (ADR 0013). Maya keeps static values scene-wide; ours are per clip because clips are self-contained. | Scene-wide statics would need a per-character pose record. | M1 |
| Q-ANIM-3 | Selection and undo | Selection changes are **not** undo steps; each history step restores the selection it was made with (R04 Q5, R08 §5.1). | Maya-style "selection in undo queue" can be a preference later. | M2a |
| Q-ANIM-4 | Maya licence for golden fixtures | AnimX goldens cover Auto/AutoMix/AutoEase, flat, linear, step and infinities exactly. Spline/Clamped ship as documented approximations (R01 §5.4); the numeric weight-field unit is pinned when a Maya `.anim` fixture exists. | With a Maya licence: export `.anim` fixtures and calibrate. | M2a |
| Q-ANIM-5 | Import defaults | Clip fps = **detected source rate** (24/25/30/48/50/60), keys on integer frames; irregular sources are resampled at the scene fps; **key reduction on by default for dense clips** (0.1°, 0.5 mm); constant-default curves not created. | Users can force source times or disable reduction per import; preference `reduceOnImport`. | any time |
| Q-ANIM-6 | Tangent types without an oracle | **Spline and Clamped stay in M1 core** (the coordinator's list; a few lines each over the AnimX machinery, covered by property tests); **Plateau is M1-stretch** ("if cheap"). | Removing Spline/Clamped from M1 saves < 0.5 agent-day. | M1 |
| Q-TIME-2 | Scene clock and ruler units | A shared scene clock (`sceneFps`, `sceneFrame`, clip `sceneStart`); **the ruler and Graph Editor show the active clip's frames** and the HUD shows scene seconds (ADR 0003). | Showing scene frames on the ruler would put keys of a 24 fps clip in a 30 fps scene on fractional ticks. | M1 |
| Q-EXP-1 | Loop closure convention | For `loop: true` clips the exporter writes the first pose at the last sample (`closeLoop`, default on), as OMOBA's loop processing does (R02 §6.3, R03 §6.4). | Some consumers prefer omitting the duplicate sample; the option stays per export. Confirm for OMOBA/Bevy and Space. | M1 |
| Q-EXP-2 | Root motion default | `hips` (translation on hips only, root folded in) for VRMA and Space; `in-place` available per clip and recommended for OMOBA (R07 §13). | Per-clip setting. | M2a |
| Q-EXP-3 | Embed editable curves in exported GLBs | **Off** (V1 option `extras.ekza_animator_curves_v1`); the project file is the editable source (R02 §13 Q6, R07 Q6). | Privacy/size trade-off for uploads. | M2c |
| Q-EXP-4 | Animation-only GLB for Blender | Skeleton nodes + clips, no meshes/skins (R02 §13 Q4: Blender may import unskinned joints as empties). | Alternative: include a minimal skin. Needs a Blender test. | M2c |
| Q-EXP-5 | VRM spring bones and node constraints | Preview-only, **never baked** into VRM exports (R01 Q7, R02 §5.3); the export dialog warns plain-GLB consumers about node constraints. | A "bake simulation/constraints" option for non-VRM consumers is possible later. | M5 |
| Q-EXP-6 | Animated `matrix` nodes in a surgeon bake | **Refuse** with `surgeon.matrix-node` (animation-only GLB and VRMA still work); decomposition into TRS with an allowed-diff entry is V1. | Decomposing now would be an edit outside the preservation invariant. | M2c |
| Q-VP-1 | Camera lock scope | Lock is a **document flag on shot cameras** (a locked shot is locked for every collaborator); view cameras are per user (R01 VP-04 over R09 §5.3). Navigating an unlocked shot camera persists without an undo entry. | Per-pane lock could be added as a user preference. | M1 |
| Q-VP-2 | Default layout and shot framing | **Split**: left pane = `shotCam` (auto-framed once on the first character: 50 mm, 3/4 front, chest height; then persisted), right pane = free perspective (R09 §15 Q3). | — | any time |
| Q-VP-3 | Default navigation profile | Trackpad on macOS, Maya elsewhere; chosen explicitly in the first-run dialog (e2e builds force Maya). | — | any time |
| Q-VP-4 | Default rotate manipulator space | **Object**, with **Gimbal** one click away in the status line; the choice is remembered per user. | Maya animators often prefer Gimbal by default; preference-level. | any time |
| Q-RIG-1 | Rotate-order defaults | Research 07 table: root/cog/hips/torso/head `zxy`, shoulder/upper arm `yxz`, lower arm `xzy`, hand/fingers `xyz`, legs/feet `yzx` (supersedes research 01's spine/leg suggestion). Needs validation by animators; data-driven autotune later. | Changing defaults affects only new rigs; existing rigs convert pose-preservingly (when the stretch item lands). | M2a |
| Q-RIG-2 | IK defaults (M2a) | Legs IK, arms FK; arm IK space `root` (R07 Q1). | — | M2a |
| Q-RIG-3 | Right-side control frames | **World-aligned** (consistent axes; mirroring via the mirror tool), not Maya "behaviour-mirrored" (R07 Q3). | Behaviour mirroring changes the meaning of right-side channels; decide before many projects exist. | M2a |
| Q-RIG-4 | Secondary controls | Generated for non-humanoid skin joints except spring-bone joints and node-constraint destinations; **hidden by default**; parented to the control driving the nearest driven ancestor. | — | any time |
| Q-UI-1 | Model workspace tab | **Hidden** in the MVP (R09 suggested visible-but-disabled). **Closes when M6a package B9 lands the workspace tabs (Q-MOD-UI-5, §G).** | Cosmetic. | M2c |
| Q-UI-2 | Arrow keys | Pick-walk (M2a, Maya); frame stepping stays on `Alt+,`/`Alt+.` (R09 §15 Q2). | Preference. | M2a |
| Q-UI-3 | Brand accent | Violet accent for chrome only; never for semantic animation colours (R09 §15 Q7). | Cosmetic. | any time |
| Q-DEPLOY-1 | Hosted demo | Vercel (dynamic) for the demo, with `sharp` never installed; static export also supported for GitHub Pages / IPFS (R04 Q2), verified manually in M1. | Hosting choice only. | M2a |
| Q-DEPLOY-2 | Desktop wrapper (Tauri) | Not planned before M5 (R04 Q4, R08 Q8). | Would lift browser-reserved shortcuts and allow multi-window WebGL. | M5 |
| Q-NAME-2 | npm publication scope (when packages are published) | Undecided; candidates `@ekza/animator-*` (claim the unclaimed `@ekza` scope now, R05 §5c) or a neutral scope. | Publishing is M2+. | M2c |
| Q-NAME-3 | Trademark clearance | Run a USPTO/EUIPO/WIPO search for "Ekza Animator" (R05 §5c item 4) **before the M1 public alpha**. | A conflict would force a rename before the first public tag. | M1 alpha |
| Q-FMT-1 | Register the `EKZA` glTF vendor prefix | Register before any file carries an `EKZA_*` extension (curves, authoring container) (R08 §9.7). Not needed for the MVP (`extras` only). | — | M6 |
| Q-LIC-2 | Licence exceptions in the build toolchain | Allow `caniuse-lite` (CC-BY-4.0, build-time data) and `lightningcss` (MPL-2.0, unmodified build tool) via `tooling/license-exceptions.json`; ignore Next's optional `sharp` (LGPL libvips) (ADR 0009). | Replacing Tailwind or Next to avoid them is disproportionate. | M1 |

## C. Ecosystem decisions (other repositories)

| ID | Question | Recommendation | Impact | Decide by |
|---|---|---|---|---|
| Q-EKZA-3 | `ekza-avatar-renderer` skips its shared idle/walk library when any clip is embedded | Drop the `embedded.length === 0` gate (merge by name) (R02 §5.5). Until then the export dialog warns. | Baking only `wave` into a VRM removes Space's idle/walk. | M1 (warning) / M2c (fix) |
| Q-EKZA-4 | Cross-runtime humanoid clip format | Standardize on **VRMA** for Space, OMOBA and the registry; retire bespoke JSON formats over time (R02 Q3, R03 §7). | Game-side VRMA loaders needed (OMOBA). | M4a |
| Q-EKZA-5 | Licences of `ekza-registry` and `ekza-rust-server` | Add licence files (MIT suggested) so small helpers can be shared (R03 Q5). | Until then: reference only, no copying. | M4a |
| Q-EKZA-6 | First integration tier and profile ownership | T1 standalone `ekza:animation` (protocol-owned profile accepted by Space and OMOBA) before T2 avatar animation sets; OMOBA cosmetic slots first (R03 Q1–Q3). | Defines registry and game work. | M4a |
| Q-EKZA-7 | Store `.ekzanim` projects in the registry as private source objects | Not in T1; revisit with T3 (R03 Q4). | Needs a new `studio.objects` kind. | M4a |
| Q-EKZA-8 | Device-flow scope for one-click publish | New `studio-upload` scope (R03 Q6). | Registry account change. | M4a |
| Q-EKZA-9 | `ekza-avatar-renderer` ships `test/fixtures/vrm1-sample.vrm` (NeonGlitch86) in an MIT repository | Replace it with a redistributable VRM 1.0 (e.g. Seed-san with credit) or strip it; or re-source the original CC0 NeonGlitch86 VRM with correct meta and no Mixamo clip. Its meta forbids redistribution and its `name`/`authors` read `undefined` (ADR 0012 erratum). | Licence exposure for the renderer repository. | now |
| Q-EKZA-10 | Studio ↔ Animator embedding | Adopt the `ekza-animator-embed/v1` iframe protocol and the hash-verified deep link (ADR 0010 §8), jointly owned with Ekza Studio. | Studio stays on React 18 behind the iframe. | M4a |
| Q-EKZA-11 | Renderer packaging for a real "Preview as Ekza Space" | Injectable `DRACOLoader`/decoder path (no gstatic CDN), npm publication or tagged tarballs, three peer `<0.187` (ADR 0010 §7). | Until then the preview is an emulation. | M2c |
| Q-COL-2 | Sync hosting, anonymous share links, hard permissions | Separate Hocuspocus service (not inside `ekza-rust-server`); share links allowed for review; character-scoped hard permissions in P2 (R06 §18). | Ops cost and data residency. | M3 |
| Q-COL-3 | "Four hands" on one character | Per-user animation layers + region claims, usage-driven (R06 §16); headline collaboration = two characters in one scene + review. | Avoids building free co-editing of the same curves. | M5 |

## D. Design review outcomes (2026-10-17)

Four reviews (animator UX, IO/math correctness, implementability, future OSS/Ekza) raised 51 issues: 5 blockers
(two of them the same tangent-test defect), 27 major and 19 minor. All blockers and majors, and the minor issues,
are resolved in MVP-SPEC v0.2, the ADRs and REQUIREMENTS. Points that were **rejected or only partly accepted**:

| Review point | Outcome | Reason | Where |
|---|---|---|---|
| Add IK-only legs to M1 (animator UX, preferred fix) | **Partly accepted** — the reviewer's fallback was taken: FK legs + Plant Feet, the `ik2` solver math in M1, plain statement of M1's target; leg IK is M2a item 1 | Coordinator scoped IK to V1; M1 already grew by the review; the solver ships now so M2a only adds controls and the op | ADR 0004 §12, Q-RIG-5 |
| Ruler and playback range in scene frames (OSS/Ekza) | **Partly accepted** — scene clock added; ruler shows active-clip frames, HUD shows scene seconds | Keys of a 24 fps clip in a 30 fps scene would sit on fractional ruler ticks | ADR 0003, Q-TIME-2 |
| Move Spline/Clamped tangents to M1-stretch (implementability) | **Rejected** for Spline/Clamped, accepted for Plateau | They are in the coordinator's MVP list and cost little; property tests cover them | Q-ANIM-6 |
| Decompose animated `matrix` nodes in the surgeon (IO, option) | **Rejected for M1** — refuse with a lint instead | An edit outside the preservation invariant; V1 with an explicit allowed-diff entry | ADR 0005, Q-EXP-6 |
| Adopt research 07's per-track sub-frame refinement for large rotation steps (IO, option) | **Deferred** — M1 lints a warning at > 90° | Smaller change; refinement is V1 | ADR 0005 §2 |
| Time-slider plain click selects keys at a tick (animator UX wording) | **Adjusted to Maya**: plain click scrubs, Shift+click selects the frame band, Shift+drag a range | Maya muscle memory; the requested test (tick at 10 dragged to 14, one undo) is kept as E2E-23 | MVP-SPEC §4.11.17 |
| Pay for retiming by moving the quad layout to V1 (animator UX) | **Rejected** — the quad layout stays (coordinator scope); the Space-hold radial and one-button profile became stretch instead | Coordinator listed 4-view as IN | MVP-SPEC §1.2 |
| Make unknown tables writable with the full typed API (OSS/Ekza) | **Accepted with a typing caveat**: unknown tables are opaque but transactable; typed access comes through `Tables` declaration merging plus a `TableDef` | Keeps the built-in API strictly typed | MVP-SPEC §4.2, ADR 0008 |
| Synthetic 300k-vertex, 60-morph VRM must pass the budget (IO) | **Accepted with a realistic shape**: 60 morph targets on a 20k-vertex face mesh | Full-mesh morphs on 300k vertices would be 36 M accessor elements, above any sane browser budget | MVP-SPEC §4.11.14 |

## E. Build deviations (WP-0a, 2026-10-17)

Smallest sane deviations from MVP-SPEC v0.2 taken while building the scaffold (task rule: record, never diverge
silently). Each is reversible by the integration agent.

| # | What | Why | Where |
|---|---|---|---|
| B-1 | The gate script is run as **`pnpm run ci`**, not `pnpm ci`. | pnpm 10 reserves `ci` as a built-in command and answers `ERR_PNPM_CI_NOT_IMPLEMENTED`; the root script `ci` itself is as specified. | root `package.json`, README quickstart, CONTRIBUTING |
| B-2 | `pnpm-workspace.yaml` gains `overrides: { "ndarray-pixels>sharp": "link:./tooling/sharp-stub" }`. | `@gltf-transform/functions` 4.5.1 → `ndarray-pixels` 5.2.0 declares `sharp` as a **regular** dependency (so `ignoredOptionalDependencies` cannot drop it) and imports it eagerly in Node. The MIT stub keeps `import '@gltf-transform/functions'` working in Node while no LGPL libvips is installed (ADR 0009). Texture decoding through ndarray-pixels throws in Node, which nothing in the design needs. `check:licenses` rejects any registry `sharp` / `@img/sharp-*` in the lockfile. | `pnpm-workspace.yaml`, `tooling/sharp-stub/`, `tooling/check-licenses.mjs` |
| B-3 | `playwright` 1.63.0 is also a devDependency of `viewport`, `curve-editor` and `editor`. | It is a required peer of `@vitest/browser-playwright` (§2 lists `playwright` for root and `apps/web` only); pinning it avoids pnpm auto-installing a different version. | those `package.json` files, `check-deps` allow-lists |
| B-4 | `tsconfig.base.json` adds `emitDeclarationOnly: true`; every project sets `outDir` to `<package>/.tsbuild/<project>` (git-ignored). A package `tsconfig.json` is a solution file referencing `src/` and `test/` (plus `io/src/three`, `io/src/worker`, `editor/src/workers`); test configs use array `extends` (`["../src/tsconfig.json", ".../tooling/tsconfig/test.json"]`) and include the package's `vitest.config.ts`. | `composite` projects built by `tsc -b` must emit; declarations only keep JS out of `src/`. Solution files let editors and oxlint's type-aware mode find the right project for every file. | `tsconfig*.json` |
| B-5 | `apps/web/tsconfig.json` extends `tooling/tsconfig/browser.json`; `next-env.d.ts` is git-ignored and outside the program (`apps/web/env.d.ts` references Next's ambient types instead); `next.config.ts` sets `typescript.ignoreBuildErrors: true`. | Next.js leaves an extending tsconfig untouched; `next-env.d.ts` imports `.next/` build output, so type checks would depend on a prior build; `pnpm typecheck` (`tsc -b`) is the single type gate (research 04 §2.3). | `apps/web` |
| B-6 | Root `test` is `turbo run test test:tooling`; `test:tooling` (root task `//#test:tooling`) runs `node --test` on `tooling/test/`. | The WP-0a test "check-deps rejects a deliberate violation fixture" (and tests of the other gates) live in `tooling/`, which is not a workspace package. | root `package.json`, `turbo.json` |
| B-7 | `turbo.json` sets `"agentGuidance": false` and `next.config.ts` sets `agentRules: false`. | Turborepo 2.11 and `next dev` 16.3 otherwise write managed `AGENTS.md` / `CLAUDE.md` files into the repository root and `apps/web` whenever an AI agent runs them. | `turbo.json`, `apps/web/next.config.ts` |
| B-8 | Playwright's default project is `chrome` locally and `chromium-swiftshader` when `CI` is set; `--project` selects either. The web server also runs the asset scripts before `next build`, with `NEXT_PUBLIC_EKZA_E2E=1` passed through `env`. | Playwright has no "default project"; later scenarios need `/samples/`. | `apps/web/playwright.config.ts` |
| B-9 | The Tailwind smoke test (convention 11) is the Playwright spec `apps/web/e2e/tailwind-smoke.spec.ts`. | It checks the CSS the production build actually serves (and the computed style) for a class used only in `packages/editor`; no unit-level runner sees the built CSS. | `apps/web/e2e` |
| B-10 | `check-deps` also fails when `three`, `react`, `react-dom` or `@pixiv/three-vrm*` resolve to more than one version in the lockfile. | ADR 0001 / ARCHITECTURE §3 rule 4 ("CI checks `pnpm why`") had no named job; the lockfile scan is deterministic. | `tooling/check-deps.mjs` |
| B-11 | `quatToEuler` uses the direct quaternion method (Bernardes & Viollet 2022) instead of three.js's matrix extraction, and `eulerNear` pins the reference inner angle below \|cos(middle)\| < 1e-9 instead of research 07's 1e-6. | three.js's matrix extraction zeroes the inner angle once \|sin(middle)\| > 0.9999999, dropping up to about 1e-3 rad of rotation; with the direct method the split is accurate to rounding, so the pinning threshold only needs to sit above rounding noise (rotation error ≤ 4e-9 rad instead of ≤ 3e-6). Outputs match three.js away from gimbal lock (tests). | `packages/anim-core/src/math/euler.ts` |
| B-12 | Constants in §7 *Public API* blocks cannot throw, so their stubs carry values: real data where the spec or a token table fixes it (`HUMAN_BONE_NAMES` in contract order, `HUMAN_BONE_PARENT`, `VRM_REQUIRED_BONES`, `VRM0_BONE_ALIASES` per VRM 1.0 / three-vrm 3.5.5, `AUTORIG_VERSION`, `DEFAULT_DISPLAY` from §4.5, `CHANNEL_COLORS` from research 09 §8.2, `SCHEMA_VERSION`), empty lists for catalogs a WP fills (`MAYA_KEYMAP`, `BUILTIN_IMPORTERS/EXPORTERS/MENU_ITEMS`, `BUILTIN_EXPORT_PROFILES`); `curveEngine`'s methods throw. Stub classes throw from their constructors. | Rule of §7 ("stubs throw … registration functions are no-ops") applied to values. | stubs |
| B-13 | The `ui` fonts (`@fontsource-variable/*`, §2) are not imported yet. | Convention 11 fixes the head of `styles.css` (Tailwind import, then the two `@source` lines); WP-8 wires the fonts with the token build. | `packages/ui/styles.css` |

### Build deviations (WP-0b, 2026-10-17)

| # | What | Why | Where |
|---|---|---|---|
| B-14 | The panel harness component is `PanelHarness` in `packages/editor/src/testing/`, exported as the new subpath **`@ekza-animator/editor/testing`**; `.oxlintrc.json` lets that directory import `@ekza-animator/editor-core/testing` and lets `apps/web/app/dev/**` import `@ekza-animator/editor/testing`. | `apps/web` may import only `editor` and `ui` (ARCHITECTURE §3), so the route cannot create the fake app itself; the harness is test-only code and stays out of the editor's main entry. | `packages/editor/package.json`, `packages/editor/src/testing/`, `.oxlintrc.json` |
| B-15 | `/dev/panels` is `apps/web/app/dev/panels/page.dev.tsx` (§3 names `page.tsx`): `next.config.ts` adds the page extension `dev.tsx` only in the `next dev` phase or when `NEXT_PUBLIC_EKZA_E2E=1` at build time, so other builds have no such route (404) and bundle none of the test kit, and a static export writes no `out/dev/` page. The page imports `fixtures/synthetic/{wave-doc,humanoid-skeleton}.json` at build time and hands them to a client island (`next/dynamic`, `ssr: false`). The harness adds its own diagnostic panel `dev.state` (not in `registerBuiltinPanels`) and exposes `window.__EKZA_DEV_PANELS__ = { app, panels }` while mounted. | A runtime `notFound()` gate still compiled the harness chunk (~48 KB of fake app) into every production build, and a static export wrote a not-found `dev/panels.html` that static hosts serve with status 200. The browser has no file system, so the document must be bundled; until WP-5/6/6t/9 register real panels, `dev.state` is what proves the route, the hooks and the fake app work end to end (e2e `dev-panels.spec.ts`). The e2e-only route `e2e/vrma-check` (§3) can use the same mechanism. | `apps/web/next.config.ts`, `apps/web/app/dev/panels/`, `apps/web/e2e/dev-panels.spec.ts` |
| B-16 | **`SkeletonDesc` node order is defined**: Kahn's algorithm over the glTF node hierarchy that always emits the smallest ready glTF index (`skeletonNodeOrder` in `@ekza-animator/io/testing`). Parent-first files (Polybot, Seed-san) keep their glTF order; Quaternius UAL (children first) is reordered. WP-4's `skeletonFromGltf` must produce the same order (or move the helper into `io/src/skeleton` and re-export it). | §4.3 says only "topological order", but `loadGltfInNode(bytes)` must return objects by `SkeletonDesc` index without a skeleton argument, so the order has to be a function of the file alone. | `packages/io/src/testing/nodeOrder.ts` |
| B-17 | `loadGltfInNode` loads with three-vrm's default plugin options (`autoUpdateHumanBones: true`) and stubs `self` and `createImageBitmap` only while a load runs (restored afterwards). | The parity gate calls `vrm.humanoid.update()`, which is a no-op with `autoUpdateHumanBones: false` (that setting stays the rule for `io/three`); scoped stubs keep other Node tests free of fake browser globals. | `packages/io/src/testing/loadGltf.ts` |
| B-18 | `@ekza-animator/editor-core/testing` exports more than `createFakeEditorApp`/`FakeEditorApp`: `createFakeServices` (records downloads and toasts), `createNaiveStore` and `naiveCurveEngine`. The fake app's documented defaults: `strictPut` on, first character active with every character's first clip active, `firstRunDone: true`, platform `other`, no operators registered (unknown ids resolve to `cancelled: "unknown operator '<id>'"`), runtimes only when a `skeleton` is given (shared by all characters). | Convention 12 makes the kit the only source of fakes, so its building blocks are reusable; the defaults make a loaded fake app immediately usable by panels. | `packages/editor-core/src/testing/` |
| B-19 | The naive curve engine is **not AnimX**: auto/autoEase/autoMix/clamped/plateau tangents are clamped Catmull-Rom slopes (flat at end keys and extremes), spline is Catmull-Rom, weights are ignored (weighted curves evaluate as Hermite). Exact on the wave clip (all keys are extremes); approximate elsewhere. | It stands in for WP-1 until the AnimX port lands; tests that need exact Maya values use the real engine. | `packages/editor-core/src/testing/curves.ts` |
| B-20 | `wave-doc.json` uses fixed readable IDs (`chr_SyntheticWave001`, `k_SynthWave001`, …; valid formats) and a placeholder asset record without bytes (`id` = SHA-256 of the empty byte string, `size: 0`). `fixtures/synthetic/` is excluded from Biome; the generator's `--check` mode and a tooling test guard the files instead. | Stable, greppable IDs in tests; a synthetic skeleton has no model file; the generator, not a formatter, owns the JSON layout. | `tooling/make-synthetic-fixtures.mjs`, `biome.json` |
| B-21 | Vitest browser mode in `packages/editor` pre-bundles React, R3F and zustand (`optimizeDeps.include`), and `.gitignore` ignores Vitest's `__screenshots__/` and `.vitest-attachments/` failure artifacts. | Vite otherwise discovers those dependencies mid-run and reloads the page under a running test. | `packages/editor/vitest.config.ts`, `.gitignore` |
| B-22 | The Turborepo `test` task hashes `fixtures/**` as an input. | Tests in `doc`, `io`, `editor-core`, `editor` and `headless-tests` read fixtures outside their package; without the input a fixture change would replay stale cached results. | `turbo.json` |
| B-23 | The fake operator runner (§4.11.0 rule 7) attributes a doc undo entry to a run only if a `local` batch committed during `apply` created it or was coalesced into it in place (same `txId`, new entry object); undo/redo batches and `undoable: false` commits never count. A run whose `apply` called `history.undo()`/`redo()` records no step at all (the fake history counts navigations). **For WP-7a**: rule 7 as written ("a new top entry, or `session.overrides` changed") would make `edit.undo`/`edit.redo` record a step, attaching an older doc entry or the restored overrides, and clear the redo stack; the spec should state this exception for the real runner. | Without it, redo is lost after any history-navigating operator, while the doc `UndoManager` still has redo. | `packages/editor-core/src/testing/operators.ts`, `packages/editor-core/src/testing/history.ts` |
| B-24 | `NodeGltf` (the `loadGltfInNode` result) gains `animations: readonly AnimationClip[]` (three's `gltf.animations`). Additive to the §7 WP-4 signature. | The §6.3 io gate "`readAnimations` vs three `GLTFLoader` in Node on UAL (1e-6)" needs three's clips from this harness, and GLTFLoader does not attach them to `scene`. | `packages/io/src/testing/loadGltf.ts` |

### Integration decisions (WP-10 part 1, v0.3 integration, 2026-10-18)

Every cross-package request in `docs/wp-notes/wp-*.md` was decided when WP-1…WP-9 were merged into `dev`. Accepted
contract changes are in the contract files **and** in MVP-SPEC (marked *v0.3 integration*). "Source" names the
work package and the item in its notes.

| # | Request (source) | Decision | Where |
|---|---|---|---|
| INT-1 | Facing check threshold fails on Polybot (WP-8 R-4, WP-3 request 5) | **Accepted, yaw-only**: `f.z / hypot(f.x, f.z) > 0.999`. The full `f·(0,0,1)` also measures the head leaning 2.8° ahead of the hips (0.99882); the yaw still gives −1 for a missing π-yaw and 0 for a quarter turn. | MVP-SPEC §4.11.9, E2E-03 row, US-02; REQUIREMENTS FR-IO-02; `e2e/03-drop-vrm0.spec.ts` |
| INT-2 | Test-API probes not wired (WP-6 note 2, WP-6t notes, WP-8 contract item 5) | **Done**: the GL host registers `viewportTestApi(vm)` and disposes it with the manager; `createShell` registers `graphTestHooks(app)` and the time-slider helpers once per shell (they follow the focused panel). | `editor/src/gl/GLHost.tsx`, `editor/src/shell/createShell.ts`, §4.8 |
| INT-3 | `prefs.set`, `workspace.reset`, `workspace.showPanel`, `view.selectionMask` (WP-8 R-1/W-1) | **Accepted** into `OperatorMap` and §4.9 (owner 8); declaration merging removed. | `editor-core/src/operators/args.ts`, §4.5, §4.9 |
| INT-4 | `select.channels`, `view.camera.setSettings` (WP-9 R-1, R-3; registered by WP-7b) | **Accepted** into `OperatorMap` and §4.9 (owner 7b). The Channel Box and Graph channel list keep writing `selection.channels` directly (WP-9 D-5, WP-6 G-9): it is per-user U state that never enters undo, panel tests run on the fake app without operators, and a drag-range selection needs synchronous feedback. | `args.ts`, §4.9 |
| INT-5 | `SessionState.hoverControl` (WP-9 R-2) | **Accepted**: default `null`, repaired when the control disappears; the viewport draws it with the hover style while the pointer hovers no control in a pane. | `editor-core/src/types.ts`, `viewport/src/manager/ViewportManager.ts`, `panels/outliner/hover.ts`, §4.5 |
| INT-6 | Channel Box and panel tokens (WP-9 R-4, WP-6, WP-6t) | **Already done** by WP-8 (`ui/css/tokens.css`). Swapping the panels' local stand-ins (WP-6 `panels/graph/controls.tsx`, WP-9 D-3 menu/popover/fields/icons) for `ui` primitives is **deferred** (cosmetic, no behaviour change). | — |
| INT-7 | Input adapter ignores `keydown` with `defaultPrevented` (WP-9 R-5) | **Already done** by WP-8 (`shell/useWindowInput.ts`). | — |
| INT-8 | Samples base URL (WP-8 R-2) | **Accepted**: optional `EditorServices.samplesPath` (default `/samples/`), set from `EditorProps.samplesPath`; `file.loadSample` fetches from it. | §4.5, §4.9, §7 WP-8 |
| INT-9 | `renderedFrames()` counts the editor canvas; `panes()[].camera` may be `'unknown'` (WP-8 R-3) | **Accepted** as §4.8 wording. | §4.8 |
| INT-10 | `file.new` must confirm over unsaved work (WP-7b B7-1 request to WP-8) | **Done in the shell**: `runFromUi` asks before `file.new` when `session.dirty` (menu, keymap, palette); the operator stays headless. B7-2 and B7-3 are stated in §4.9. | `editor/src/shell/createShell.ts`, `commands.test.ts`, §4.9 |
| INT-11 | `setKeyHandle` clamps a free weighted handle by scaling it (WP-6 G-21) | **Accepted**: only `dt` is clamped to `(0, span]`, `dv` kept (§4.11.4 wording, the Graph Editor's drag rule). The kernel test expected the scaled handle and was corrected. | `editor-core/src/edit/keys.ts`, `test/kernel/edit-keys.test.ts` |
| INT-12 | Per-key scale (`*`, `/`) for mixed Graph Editor field values (WP-6 G-14) | **Rejected for M1**: `KeyFieldsArgs` keeps set/add; the panel refuses ×/÷ on mixed values with a message. Revisit with the Graph Editor scale tool (V1). | — |
| INT-13 | WP-7a runner/history clarifications, `OperatorDef.coalesce`, load-origin batches (WP-7a requests) | **Accepted**: rule 3 exempts `edit.escape`; rule 7 skips history-navigating runs and records override deltas only at an unchanged location; direct local commits become steps; `OperatorDef.coalesce` is part of the contract (`CoalescingOperatorDef` stays as an alias); partition visibility batches use origin `'load'`. | §4.11.0, §4.5, `types.ts`, `runner.ts` |
| INT-14 | `PartitionLookup`, "undo never orphans", canonical-curve queries, `missingPartitions` (WP-2 requests 1–3; WP-3 request 1) | **Accepted** (contract files already had them). | §4.2, §4.11.0 store rules 4 and 6, §7 WP-2 |
| INT-15 | `strictPut` in production builds (WP-2 D2-11, WP-8 W-14) | **Keep `strictPut: true`** (the `createEditorApp` default): a buggy `put` over an existing record fails its operator (rolled back, toast) instead of silently merging. Revisit with collaboration (M3). | — |
| INT-16 | Finger lollipops as `custom` shapes (WP-3 R-1/request 2) | **Accepted**, and the head now **faces along the finger** (plane of the dorsal normal and the hand's lateral axis): with heads facing sideways the §4.11.15 acceptance (6 px pick separation in a framed three-quarter hand view) failed on Seed-san (5.1 px); now every finger has ≥ 6.5 px on both fixtures. The browser test also stopped assuming ten fingers per hand (Polybot has five one-segment fingers); it requires a control per finger bone. | `rig/src/autorig/shapes.ts`, `viewport/test/fingers.test.ts` |
| INT-17 | `RigWarning.code` for unpaired sided controls (WP-3 R-5/request 3) | **Accepted**: `'unpaired-mirror'`. | §4.3, `rig/src/types.ts` |
| INT-18 | ADR 0004 says 4×4 matrices; the kernel composes similarity transforms (WP-3 R-4/request 4) | **Accepted**: ADR 0004 "Consequences" amended. | `docs/adr/0004-rig-model.md` |
| INT-19 | `EkzaBakeMarkerV1.generatorAdded` (WP-4 contract addition) | **Accepted**. | §4.4, §4.11.11 rules 8–9 |
| INT-20 | `ekza.unique-names` local severity, single `source_too_large` code (WP-4 W4-1, W4-2) | **Accepted**; ADR 0010 table updated. | ADR 0010 §4, §4.11.13 |
| INT-21 | `opts` on `resolveKeyHandles`/`insertKeyPreservingShape`; `frozen` superset (WP-1 W1-1, W1-2) | **Accepted**. | §7 WP-1 |
| INT-22 | Insert exactness at AnimX's snapping thresholds (WP-1 W1-22) | **Accepted as a documented deviation** from the 1e-12 insert gate: in three narrow bands (Hermite straight-line short-circuit, Bézier handles near the thirds, the monotonic-X margin) a split half re-snaps; measured ≤ 5e-8 relative, invisible (E2E-11 checks 1e-6). Exactness there would need a deviation from AnimX, which the goldens forbid. | — |
| INT-23 | `TimeSliderController.cancel()`, `dragging`, menu items in `registerTimelineContributions` (WP-6t) | **Accepted**. | §7 WP-6t |
| INT-24 | Stub fallbacks left from the parallel build (WP-9 D-1, WP-5 shape stand-in) | **Removed**: the panels call the kernel helpers directly; the deferred nudge path is gone. Inert "stubbed dependency" tests elsewhere (curve-editor edit plumbing, the Graph panel's tangent-field notice, a viewport press-routing case) stay: they skip themselves and document the failure path. | `panels/channel-box/kit/kernel.ts`, `nudge.ts`, `viewport/src/controls/shapes.ts` |
| INT-25 | Two numeric grammars: editor-core accepted only `45`, `+=10`, `*2`, units; WP-9's fallback had research 09 §6.4 expressions (and WP-6 G-14 assumed a leading `=`) | **One grammar** in editor-core `parseNumericInput`: `[=]expr` with `+ - * / ( )`, one sign per operand, units after numbers or groups, relative `+=`/`-=`/`*=`/`/=` and short `*x`/`/x`, decimal comma, U+2212; a scale takes no unit. Used by the Channel Box, the Graph Editor fields and the other numeric fields. | `editor-core/src/edit/numeric.ts` |
| INT-26 | Escape in a dialog while a toast is shown closed the toast, not the dialog (smoke run) | **Fixed in `ui`**: a Radix toast is a dismissable layer above the dialog; the `Toast` primitive hands Escape to the topmost open dialog's close button (same semantics as its ×) and keeps the toast. | `ui/src/primitives/{toast,dialog}.tsx`, `editor/test/ui-primitives.test.tsx` |
| INT-27 | Importing after reopening a project in `?e2e=1` failed with `use-patch` (smoke run) | **Fixed**: a seeded ID source replays its sequence per page load; new record IDs (kernel and the viewport's shot camera) skip IDs the document already uses (O(1) check, bounded retries). | `editor-core/src/app/internals.ts`, `viewport/src/manager/contributions.ts`, `test/kernel/ids.test.ts` |
| INT-28 | A constant-track VRMA from Seed-san on Polybot raised 21 "no control" warnings in a toast (smoke run) | **Fixed**: one warning lists the dropped bones, and only tracks that leave the rest pose count. | `rig/src/import/humanoid.ts` |
| INT-29 | Time-slider key-drag tests failed once WP-7a landed | **Test fixed**: the fixture's setup commits are `undoable: false`; since WP-7a decision 3 every local commit is a history step, so "no undo step after a cancelled drag" saw the setup. | `curve-editor/test/timeline/fixture.ts` |
| INT-30 | The Graph Editor framed a new curve set before it had keys (smoke run: a channel edit creates the curve with a static value first, so the first keys landed off screen) | **Changed**: the view follows the shown curves — framed when a new set appears and again after document edits made elsewhere (keys set from the viewport or the Channel Box) — until the user works in the Graph Editor (press, wheel, pan, zoom or F/A); the next new set restarts it. Like the viewport's untouched cameras (WP-5 V-8). | `curve-editor/src/graph/GraphEditorController.ts`, `test/controller.test.ts` |
| INT-31 | The Import file picker and the model import summary both used `data-testid="import-dialog"` (smoke run) | **Fixed**: the picker dialogs are `open-picker` / `import-picker` (with `-choose`, `-file-input`, `-sample-<id>`); `import-dialog` stays the §4.8 import summary. | `editor/src/dialogs/OpenDialog.tsx` |

### Acceptance round 1 (2026-10-18)

An independent tester ran the owner demo script (MVP-SPEC §8.3) and the basics in real Chrome: every step passed
except §8.3-12 (one major bug); six minor bugs and fourteen UX notes were reported. Each fix has a unit test and a
real-input e2e check in `apps/web/e2e/acceptance-round1.spec.ts`.

| # | Report | Decision | Where |
|---|---|---|---|
| INT-32 | **Major** (§8.3-12): after keying a typed, unkeyed edit, undo removed the key, then skipped the edit (an older action was undone) and the typed value stayed as an override no step owned | **Fixed, spec amended**: keying no longer drops earlier steps' override parts. The key step records the consumed overrides in its own delta (override → none), so undo follows Maya: key, then the edit, then older actions; undoing N actions returns to the start. Supersedes WP-7a note 4's "earlier steps lose their override parts". | `editor-core/src/operators/runner.ts`, `edit/channels.ts`; §4.11.0 rule 7 and history, §4.11.1 rule 5, ADR 0013 decision 4; `test/builtin/key.test.ts` (incl. a ten-action undo/redo walk), `kernel/runner.test.ts`, `kernel/edit-channels.test.ts` |
| INT-33 | Graph Editor "More ▾" popup stayed open over the key fields and wrapped its labels; Simplify gave no feedback (on a curve already reduced at import it silently did nothing) | **Fixed**: the menu is the `ui` Radix dropdown (closes on a choice, Esc, an outside click; one line per label). Simplify gets a tolerance choice (`ge-simplify-tolerance`: 0.1°, 0.25°, 0.5°, 1°, 2°; translation and scale scale with it) and reports "N → M keys (K removed within T)" or "nothing to remove within T … choose a larger tolerance" (toast from the toolbar, help line from menus and the keymap). | `editor/src/panels/graph/{GraphToolbar.tsx,simplify.ts,run.ts}`, `shell/createShell.ts` |
| INT-34 | Shift+LMB drag on a selected key toggled it off on press (no move); an Insert-tool click, `Q` and a click on the new key within the double-click time selected the whole curve | **Fixed**: a press on a selected part changes the selection on release only, Shift included (drag = axis-locked move, click = toggle off). A double-click needs both presses on the same tool. | `curve-editor/src/graph/{press.ts,GraphEditorController.ts}`, §4.11.18 |
| INT-35 | The context-loss warning toast stayed after the restore; `/editor`'s help line kept the hover hints while the context was lost | **Fixed**: the lost state is the help line's text; on restore the warning is dismissed (`ToastNotifier.dismissWhere`) and "The 3D view was restored." is shown. | `editor/src/gl/GLHost.tsx`, `shell/HelpLine.tsx`, `services/notify.ts` |
| INT-36 | A corrupt `.glb` opened the import summary ("the import may still work") with an enabled Import button | **Fixed**: summary errors the import would hit too (`not-glb`, `malformed-gltf`, `vrm-both`, `budget-exceeded`) end in an error toast "Cannot import <name>: …" without a dialog; other summary errors keep the dialog with its warning. | `editor/src/shell/files.ts` |
| INT-37 | UX: `F` on a selected hand framed only the hand's circle (three distal fingers off-screen on Seed-san) | **Changed**: a selected control frames with the visible controls below it (Maya transform bounds). | `viewport/src/manager/ViewportManager.ts`, §4.9 `view.frame`; `viewport/test/fingers.test.ts` |
| INT-38 | UX: UAL imports with "0 of 46 selected" and an empty clip; the Export dialog checked only the active clip for bake-into-model; the Clips panel read "NameRange" at the default width; the rotate order is editable although §1.2 said read-only | **Partly changed**: the import default stays "none when > 8 clips" (46 clips are slow and the demo picks one), but the button reads `Import without clips` and the count says so. Bake-into-model and animation-only GLB check every clip by default (VRMA keeps the active clip: one file per clip). The Clips table pads its header and shows the duration and Source columns only when the dock is wide enough (container query). §1.2 and FR-CB-06 now record the built stretch items, the rotate-order change among them. | `editor/src/dialogs/{ImportDialog,ExportDialog}.tsx`, `panels/clips/ClipsPanel.tsx`, §1.2, §4.11.6, §4.11.10 rule 7 |

UX notes **not changed** (owner may revisit):

- *Graph Editor shows every animated curve of the active character with nothing selected* (WP-6 G-4): kept for M1.
  Right after an import nothing is selected and the curves are the quickest check that the clip arrived; Maya's
  empty view needs a selection first. The "Animated" filter and the channel list eyes trim the view. Recommendation:
  revisit with a "show curves of: selection / character" toggle in V1.
- *Unkeyed (pink) edits are dropped on a clip switch or frame change, and undoing "New Clip" does not bring them
  back*: as specified (§4.11.2, ADR 0013 lifetime) and Maya-like; overrides belong to one frame of one clip.
- *Default import reduction makes a bake → re-import round trip differ by up to 0.073° between keys*: by design (the
  0.1° tolerance); with "Reduce keys" off the round trip is exact (4e-8 rad). The bake and VRMA writers are lossless.
- *The Channel Box refreshes about one frame after Enter*: human-invisible; scripts wait for the value.
- *A world-space rotate drag changes all three Euler channels*: correct `eulerNear` output for a world-axis rotation;
  the Graph Editor's Euler Filter is one click. An automatic filter would rewrite keys the user did not touch.
- *e2e mode auto-confirms File › New*: intentional (scenarios reload); production confirms (checked by the tester).
- *"THREE.Clock: This module has been deprecated" on every load*: emitted by `@react-three/fiber` 9.8.1 (its store
  creates a `THREE.Clock`); our code uses no `Clock`. Disappears with an R3F release on `THREE.Timer`.
- *Bundled samples are fetched lazily, so they fail offline (with a clear toast)*: user files work fully offline;
  precaching samples (a service worker or bundling) is a V1 decision about download size.

### Acceptance round 2 (2026-10-18)

The tester re-ran the owner demo script in real Chrome: all 12 steps and every round-1 fix (INT-32…INT-38) held.
The round failed on two major bugs, both keyboard focus stealing Maya hotkeys; five minor bugs and twelve UX notes
were reported. Each fix has a unit test and a real-input e2e check in `apps/web/e2e/acceptance-round2.spec.ts`.

| # | Report | Decision | Where |
|---|---|---|---|
| INT-39 | **Major**: after choosing a value in any dropdown (`<select>`: clip, fps, speed, rotate order, infinity, Simplify tolerance) the keymap was skipped while the dropdown kept focus, and Chrome's type-ahead changed its value (S switched the clip, Z the rotate order, 2 opened the fps dialog) | **Fixed, spec amended** (§4.10 "Keyboard focus"): a dropdown is no longer text entry. While it has focus it keeps type-ahead and navigation only when it is under the pointer; otherwise keys follow the hovered panel, Mod chords always reach the keymap, and printable keys never type ahead (default prevented). Arrow keys, PageUp/Down, Enter and Tab stay with it for keyboard users. A value chosen with the pointer hands the focus back (the dropdown blurs after `change`, outside dialogs). | `editor/src/input/{focus.ts,keyboard.ts}`, `shell/useWindowInput.ts`; `test/input.test.ts` |
| INT-40 | **Major**: a Graph Editor key field kept focus after Enter, so Mod+Z ran the browser's text undo and a tangent digit typed into it was committed as an expression on blur (`4-10` → −6) | **Fixed**: like the Channel Box, Enter commits and blurs (an invalid entry keeps the focus and its red border); Esc reverts and blurs. Esc used to commit the draft, because the blur it caused ran the stale commit. | `editor/src/panels/graph/controls.tsx`; `test/panels/graph.test.tsx` |
| INT-41 | After a click in the Outliner, F, Home and End pressed over the viewport or time slider were taken by the focused tree | **Fixed**: the tree handles its ARIA keys only while the Outliner is hovered (or the pointer is outside the window). | `editor/src/panels/outliner/OutlinerPanel.tsx`; `test/panels/outliner.test.tsx` |
| INT-42 | A click exactly on a control's own pick point selected a neighbour in 11/33 (Polybot) and 32/53 (Seed-san) cases: depth was sorted before screen distance, so a near-camera ring up to 6 px away won; Shift/Mod+Shift clicks repeated at one spot cycled | **Changed, spec amended** (§4.11.16): candidates sort by screen distance (1 px buckets), then depth (1 cm buckets), then size. Cycling applies to repeated plain clicks only and keeps the order of the cycle's first click; modifier clicks act on the nearest control (a second Shift+click toggles it back). | `viewport/src/picking/picker.ts`, `tools/selectTool.ts`; `test/picking.test.ts`, `test/fingers.test.ts` |
| INT-43 | Bake into model of Toka.glb (clip names with `:` and `|`, sanitized on import) kept the original animation and appended a renamed duplicate; an imported clip whose source moved only a non-joint node (0 curves) was checked by default and exported as rest-pose tracks | **Fixed, spec amended** (§4.11.10 steps 7–8): in a bake into the model, a clip imported from one of the model's own animations and not renamed or given a slot since keeps the animation's original name, so the surgeon replaces it in place (a renamed clip is a new animation). Clips without a single key start unchecked in the Export dialog (bake, animation GLB) unless all clips are empty. | `editor-core/src/workflows/export.ts` (`exportNameOf`), `editor/src/dialogs/ExportDialog.tsx`; `headless-tests/test/ops.export.test.ts`, `editor/test/dialogs.test.tsx` |
| INT-44 | UX: dragging a Graph Editor key past a neighbour clamped it at neighbour − 1e-3 and the snapped release landed it on the neighbour, deleting that key without notice | **Changed, spec amended** (§4.11.3): with snapping, a key dragged past a non-moved neighbour stops on the last whole frame before it (drag and release); only an exact landing on the neighbour's frame replaces it (Maya's overwrite). Without snapping the `± 1e-3` rule is unchanged. Applies to time-slider band moves and scales too (one kernel). | `editor-core/src/edit/keys.ts`; `test/kernel/edit-keys.test.ts` |
| INT-45 | UX: a plain click inside a selected time-slider band did nothing (it started a band move) | **Changed, spec amended** (§4.11.17): a press on the band middle released without moving the keys clears the band and sets the time there, like a click outside it. | `curve-editor/src/timeline/TimeSliderController.ts`; `test/timeline/{time-slider,key-drag}.test.ts` |
| INT-46 | UX: a rotate-order change is exact at key times only; between keys the motion changed noticeably (Polybot hand up to 17.9 cm) with no warning | **Changed**: the operator says so in an info toast when the control has a rotation curve with two or more keys; the Attributes tooltip and the operator description no longer promise unchanged motion. A "bake every frame" option is V1. | `editor-core/src/operators/builtin/rig.ts`, `editor/src/panels/attributes/AttributesPanel.tsx`, §4.11.5; `test/builtin/rig.test.ts` |
| INT-47 | UX: Outliner rows at the default 240 px: deep finger rows read "L …" and at depth 10 the expand chevron sat mid-row | **Changed**: levels below the fourth indent by 5 px instead of 12 (depth 10: 82 px instead of 124), and a row's secondary text (template key, humanoid name) gives way before its name. | `editor/src/panels/outliner/OutlinerPanel.tsx` (`rowIndentPx`); `test/panels/outliner.test.tsx` |
| INT-48 | Clips panel truncated ordinary names ("Idle_Lo…") at the default dock width (INT-38 leftover); the pane header's display toggles wrapped ("X-ray") and were cut ("Sp") at 1024 px | **Fixed**: the Range, fps and loop columns shrink to their content, so the name takes the rest. Pane headers hide the toggles that do not fit (never wrapped or cut) and list them in a "»" menu (`pane-display-more-<pane>`, check items); at 1440 px HUD and Springs move there, at 1024 px more. | `editor/src/panels/clips/ClipsPanel.tsx`, `panels/viewport/{PaneView,PaneMenu}.tsx`; `apps/web/e2e/acceptance-round2.spec.ts` |
| INT-49 | UX: Polybot rests in an A-pose, so a VRMA from Seed-san lands its arms about 38° lower (three-vrm-animation gives the identical result in Node) | **Documented**: the asset, not the retarget. The Open dialog (`sample-note-polybot`), the empty-state sample button tooltip ("VRM 0.x · A-pose") and the README credits say so. | `editor/src/dialogs/{samples.ts,OpenDialog.tsx}`, `panels/viewport/EmptyState.tsx`, `README.md` |

UX notes of round 2 **not changed** (owner may revisit):

- *The shot camera's default placement ignores scene-like files* (ashton.glb puts the locked shot inside the scene
  geometry): the shot frames the character from its skinned bounds (§4.11.6 step 8), which is right for the
  character files the MVP targets. Framing the whole scene would make the character tiny. Workaround: unlock the
  shot (Alt+L) and frame, or Copy view to shot camera. Recommendation: V1 option "frame the scene".
- *Positive notes and the known `THREE.Clock` console warning*: nothing to change (see round 1).

### Acceptance round 3 (2026-10-18)

The tester re-ran the owner demo script in real Chrome: all 12 steps, every round-1 fix (INT-32…INT-38) and every
round-2 fix (INT-39…INT-49) held, and the e2e suite passed 34/34. The round failed on one major bug, keyboard focus
again (a menu trigger kept the focus after its menu closed); one minor bug and eight UX notes were reported. Each
fix has a unit or browser test and a real-input e2e check in `apps/web/e2e/acceptance-round3.spec.ts`.

| # | Report | Decision | Where |
|---|---|---|---|
| INT-50 | **Major**: after a menu bar menu or the Graph Editor's More ▾ menu was used (a choice, or just opened and closed), its trigger kept the focus; Space over the viewport reopened that menu and a second Space ran its first item (Undo, New Clip, Select All, New Project, Stepped Next); Enter and ArrowDown reopened it too | **Fixed, spec amended** (§4.10 "Keyboard focus"): the `ui` Menubar and DropdownMenu hand the focus back to the page when a menu opened with the pointer closes (choice, Esc, outside click), and a click on a trigger never focuses it; a keyboard-opened menu still returns the focus to its trigger (WAI-ARIA). A focused trigger of a closed menu keeps Enter, the arrows and Tab unless it is under the pointer (where it keeps every key); every other key is taken on the document in the capture phase and goes to the hovered panel's keymap before the trigger's own handler. | `ui/src/primitives/menu.tsx`, `editor/src/input/focus.ts` (`isClosedMenuTrigger`, `menuTriggerKeyRoute`), `editor/src/shell/useWindowInput.ts`; `editor/test/{ui-primitives.test.tsx,shell.test.tsx,input.test.ts}` |
| INT-51 | Graph Editor: a click on a key and a press-drag on it within the double-click time selected the whole curve on press, and the drag did nothing | **Fixed, spec amended** (§4.11.18): the second press of a double-click on a key is a key press (a drag moves the selection, as in Maya) whose release without a drag selects the curve; on a curve segment it selects the curve's keys at once and a drag moves them. | `curve-editor/src/graph/press.ts`; `test/edits.test.ts` |
| INT-52 | UX: the time slider's RMB menu without a band offered Paste only (WP-6t note 9); Maya acts on the current frame | **Changed, spec amended** (§4.11.17): without a band, opening the menu selects the current frame as a 1-frame band (what Shift+click there does) and offers Delete, Copy, Paste, Tangent and Select; without an active clip it offers Paste only. The band stays visible, so the target of the menu is shown. | `curve-editor/src/timeline/TimeSliderController.ts` (`contextMenu`); `test/timeline/time-slider.test.ts` |

UX notes of round 3 **not changed** (owner may revisit):

- *Outliner arrow keys move the focused row only; Enter selects* (ARIA tree, WP-9): kept. The tree walks
  character, group, bone and clip rows too, and selection following the focus would switch the active clip while
  walking past the clips. Recommendation: V1 option "arrows select control rows" together with Maya's pickwalk
  in the viewport.
- *At the default full-body framing, 15 of Seed-san's 53 controls (all fingers) select a neighbour on the first
  click*: their pick points are under 1 px apart (INT-42); repeated plain clicks cycle, and after `F` on the hand
  every finger picks first time. Not changed for M1; a picker for overlapping controls (a hand inset or a pick
  list under the pointer) is a V1 candidate.
- *A quad pane switched to the shot camera crops the character compared with the split view*: the shot camera
  keeps its aspect from the pane. A resolution or film gate overlay is V1.
- *The Polybot bake writes `-0` translations as `0`*: `JSON.stringify` drops the sign of zero; the values are
  equal and the file validates. Byte-identical JSON outside the appended arrays would need a custom serializer
  for one sign bit; not worth it in the MVP.
- *Known and accepted*: the `THREE.Clock` warning (round 1), bundled samples offline (round 1), Polybot's A-pose
  (INT-49).

### WP-10 final: e2e scenarios and budgets (2026-10-18)

E2E-02…E2E-27 were written in four parallel groups (branches `e2e-g1`…`e2e-g4`, merged into `dev`) against the
integrated editor with real pointer and keyboard input at test-API coordinates; group helpers are
`apps/web/e2e/helpers/g{1,2,3,4}-*.ts`. Every scenario passed as specified once written: no product bug surfaced and
one §6.2 row changed (INT-53). The full gate `pnpm run ci` is green in real Chrome, and the suite is green in the
`chromium-swiftshader` CI project after INT-58. Budgets: ROADMAP "M1 budgets", method in
`docs/wp-notes/wp-10-budgets.md`.

| # | What | Decision | Where |
|---|---|---|---|
| INT-53 | E2E-25 selected the arm and clicked `status-rotate-space-gimbal`, but the ring manipulator belongs to the rotate tool and the status line's space toggle does not switch tools (e2e-g1) | **Spec amended**: the row presses `E` first. The scenario also runs on an arm posed in Y and Z, where object space would change every channel. | MVP-SPEC §6.2 E2E-25; `e2e/25-gimbal-rotate.spec.ts` |
| INT-54 | `--project=<name>` (B-8) failed every test with "Project … not found in the worker process": workers load the config without the runner's argv (found by e2e-g1 and e2e-g3 independently) | **Fixed in the config**: the runner hands its choice to the workers in `EKZA_E2E_ALL_PROJECTS`. The two identical fixes merged into one. | `apps/web/playwright.config.ts` |
| INT-55 | The pre-integration gates (WP-8 W-15) still turned a stub, an unregistered operator, a placeholder panel or a kernel that did not start into a **skipped** scenario | **Changed**: every work package has landed, so each gate now fails the test with the piece and its owner (`expectKernelStarted`, `expectPanelRegistered`, `failIfBlocked`); the inline gates in E2E-01/E2E-03 and the shell specs became assertions. The unbuilt M1-stretch items (FR-IO-10, FR-GE-17, the in-app validator worker, the NFR-09 static/offline e2e) are declared in `stretch.spec.ts` as `test.fixme` with the requirement and reason (MVP-SPEC §1.2), the only fixme tests in the suite. | `apps/web/e2e/helpers/test-api.ts`, `e2e/stretch.spec.ts` |
| INT-56 | `/e2e/vrma-check` (§3) and how E2E-17 gets the editor's `humanLocal` | **Accepted as built** (e2e-g4): `app/e2e/vrma-check/page.dev.tsx` uses the B-15 mechanism (e2e and dev builds only, 404 in production) and plays a VRMA on Seed-san and Polybot with `@pixiv/three-vrm-animation`. The test API has no `humanLocal()`, so E2E-17 derives it from `boneWorld` per §4.11.9 (`D_b = q(W_b)·q(W⁰_b)⁻¹`, `N_b = D_hp⁻¹·D_b`), with the rest pose from the character's empty default clip; it requires both models with the expected `metaVersion`. Measured 5.2e-8 rad (limit 1e-3). | `apps/web/app/e2e/vrma-check/`, `e2e/16-17-export-bake-vrma.spec.ts`, `helpers/g4-export.ts` |
| INT-57 | Where the §14 budgets are measured | **Accepted**: a report-only Playwright bench, `pnpm --filter web bench:budgets` (`e2e/bench/playwright.config.ts`: the e2e build at DPR 2, one worker, not part of `test:e2e`), plus the packages' existing Vitest benches. Three misses got owners in ROADMAP: M-1 the 1,000-key drag (5.1 ms vs 4 ms, WP-6 with WP-2), M-2 the editor route JS at the 900 kB limit (WP-8), M-3 the anim-core 2,200-curve bench (0.32–0.35 ms vs 0.3 ms, WP-1, re-measure first). No public tracker exists yet; the IDs become issues when the repository is published. | `apps/web/e2e/bench/`, `docs/ROADMAP.md` |
| INT-58 | Under SwiftShader with parallel workers, the round-1 check "More ▾ closes on an outside click" failed 3 of 4 runs | **Test fixed, product unchanged**: Radix arms its outside-click listener in a 0 ms timer after a menu opens, and Chrome dispatches input ahead of timers on a busy main thread, so the synthetic click could arrive first (no person clicks that fast). The spec lets the page's pending timers run before the outside click; the assertion is unchanged (6 of 6 then). | `e2e/acceptance-round1.spec.ts` |

Scenario readings **accepted as built** (no §6.2 change; each is the row's intent made concrete):

- E2E-04: the generic GLB goes through the import dialog (`loadFile` without `auto`); the spec unchecks every clip and
  checks only the Idle_Loop index read from the GLB. "Source sample count of curves with ≥ 20 source keys" counts the
  samples of the source tracks those curves map to (532 keys vs 2,928 samples).
- E2E-05: `Mod+Z` is `Meta+Z` with `platform=mac`. E2E-12: the clip fps is asserted to be 30, which the `k` in the
  slope formula assumes. E2E-10: "keeps the handle length" is Maya's weight `3·hypot(|dt|/fps, dv·k)` (1e-6).
- E2E-07: "loop wraps" samples playback started at frame 50 every animation frame and requires every frame in
  `[0, 60)`. E2E-14: `mirror()` is the world-aligned rule (`rx`, −`ry`, −`rz`) of §4.11.20.
- E2E-15: the rename uses the Clips row menu, because the first click of a double-click on a row makes that clip
  active, which would undo the switch to `clip1` the row asks for first. UX note for the owner: double-clicking a
  clip name to rename it also activates the clip (Maya-like; not changed).
- E2E-21: "gets `staticValue`, not a key" is checked as rotation curves with 0 keys, no override and the same value
  at every frame. E2E-27: each character is keyed at clip frames 0/24/48 so that frame 24 shows its own key.
- E2E-26: the cycling spot is the midpoint of the two closest drawn controls of the framed hand; they must be under
  11 px apart so both are inside the 6 px pick tolerance (6.5 px apart on Seed-san).

### Final acceptance (2026-10-18)

The independent final acceptance test passed and reported three minor bugs. Each fix has a unit or browser-mode
regression test.

| # | Report | Decision | Where |
|---|---|---|---|
| INT-59 | A rotate drag on a ring whose channel is locked gave no feedback, added an empty history step in object space and, in world space, turned the control with the two unlocked channels | **Fixed, spec amended** (§4.11.16, Maya): an axis handle whose channel is locked on the lead control (rotate ring, translate arrow) is drawn dimmed but stays pickable; a drag on it opens no gesture (no change, no history step, no selection) and shows a warning toast "Rotate X is locked. Unlock it in the Channel Box to drag this handle." once the pointer moves (a click stays silent). In a multi-selection a ring leaves every control whose channel of that ring is locked untouched, in every space. | `viewport/src/manipulators/{ManipulatorKit,drag}.ts` (`lockedHandles`, `rotateEdits`), `tools/{host,transformTool}.ts` (`lockedChannel`), `manager/ViewportManager.ts`; `viewport/test/manipulators.test.ts` |
| INT-60 | The Export dialog result read "1 clips" | **Fixed**: the result line counts with the right number ("1 clip · 3 channels · 1 key"); the node-constraint warnings, the read-back lint ("1 channel read") and the bake lint "does not animate N track(s)" agree with their counts too. The `file.export` toast already did. | `editor/src/dialogs/ExportDialog.tsx` (`count`, `statsLine`), `editor-core/src/workflows/export.ts`, `io/src/surgeon/bakeIntoModel.ts`; `editor/test/dialogs.test.tsx`, `editor-core/test/builtin/workflows.test.ts` |
| INT-61 | Graph Editor: the bottom value label looked cut by the frame-number strip ("-2" instead of "-20") | **Fixed**: the "-2" was the frame number at the left edge, sitting where value labels go. Each axis now keeps out of the other's labels: a value label is drawn only when its glyphs clear the frame-number strip by 3 px (measured from the font, not a fixed 12 px), and frame numbers that would reach into the value-label column are skipped, so the bottom-left corner stays empty. | `curve-editor/src/painters/grid.ts`; `curve-editor/test/painters.test.ts` |

### Build deviations of WP-1 … WP-9 (consolidated at the v0.3 integration)

Each work package recorded its interpretations in `docs/wp-notes/wp-*.md` (kept as history, with the reasoning and
tests). All are **accepted as built** unless the status column says otherwise; IDs are the notes' own.

**WP-1 anim-core** — W1-1/W1-2 optional `cycleAwareAuto` and the `frozen` superset (INT-21); W1-3 linear/step
inserts still freeze shaping neighbours; W1-4 inserts outside the key range take the infinity value and slope, an
empty curve throws (`insertKeyOnCurve` keys the static value); W1-5 plateau = AnimX legacy auto; W1-6 cycle-aware
auto behind a compile option (off by default); W1-7 spline/clamped approximations (Q-ANIM-4); W1-8 linear end
sides continue into linear infinity; W1-9 non-weighted fixed handles keep \|dt\| ≥ 1e-6; W1-10 single-key curves
evaluate to the key under any infinity; W1-11 cyclic times snap onto keys within the rounding bound instead of
Maya ticks; W1-12 document content is repaired, never rejected; W1-13 extra fields on `CompiledAnimCurve`; W1-14
slopes are right derivatives, limited near vertical; W1-15 `segmentControlPoints` for every span kind; W1-16
`visibleKeyRange`/`keyIndexAt` semantics; W1-17 numeric tangent field clamps; W1-18 `reduceKeys` keeps a subset of
keys and their tangent types; W1-19 Euler filter negates middle-axis fixed handles on the flipped branch; W1-20
error codes; W1-21 straight-line short-circuit spans export with the chord slope; W1-22 insert exactness bands
(INT-22).

**WP-2 doc, doc-yjs** — requests 1–3 accepted (INT-14); D2-1 extra exports (`MemoryDocumentStore`,
`PatchUndoManager`, testing helpers); D2-2 local writes open their partition, remote ones never; D2-3 reentrancy
guards; D2-4 validation of introduced problems only, `remove` refuses referenced targets; D2-5 sliding coalescing
window; D2-6 fully skipped undo still moves the entry; D2-7 listener errors never interrupt a commit, undo entry
recorded before subscribers run; D2-8 no-op `applyChanges` emits nothing; D2-9 per-store `txId` counters; D2-10
read-only rules; D2-11 `strictPut: true` default (INT-15); D2-12 query tie-breaks; D2-13 JSON semantics for
`undefined`/`NaN`; D2-14 snapshot text format; D2-15 migrations repair; D2-16 `deriveMigratedId` shapes; D2-17
extra validation rules; D2-18 conformance suite without fast-check; D2-19 per-merge-unit value-based foreign-write
check; D2-20 `doc-yjs` design (one `Y.Doc` per partition, remote batches as `user: 'remote'`); D2-21 "keep
seconds" fps change vs a concurrent key edit keeps one side's key (structural edits need a claim, M3).

**WP-3 rig** — R-1 `custom` finger lollipops, R-2 root `arrow4 + circle` as one custom shape (INT-16); R-3 jaw
sized like hands; R-4 similarity transforms (INT-18); R-5 unpaired sided controls (now `unpaired-mirror`, INT-17);
R-6 the sampler keeps the canonical curve; R-7 rig functions accept any `RigProgram`; R-8 registered rig-op slot
semantics; R-9 CUBICSPLINE translation tangents from solved channels; R-10 constant-at-default detection
tolerances; R-11 caller errors throw `unsupported`; R-12 eyes, constraint destinations, springs and unreachable
joints are not rigged (motion dropped with a warning); R-13 mirror semantics for centre and bone-aligned controls;
R-14 humanoid step schedule over the normalized parent chain; R-15 Plant Feet treats twist bones as rigid; R-16
`reached` in soft IK.

**WP-4 io** — `generatorAdded` (INT-19); W4-1/W4-2 lint severity and code (INT-20); W4-3 JSON-chunk and provenance
lint details; W4-4 lint scope (slot names on our clips, uniqueness on all); W4-5 structural index/joint range checks;
W4-6 `parseGlb` limits and tolerances; W4-7 format detection by root extension objects; W4-8 VRM licence mapping;
W4-9 bone radii fallbacks; W4-10 `readAnimations` repairs; W4-11 VRMA reader versions and ignored channels;
W4-12 bake thresholds; W4-13 surgeon details (rollback-only re-bake, `replaced` kept); W4-14 `ExportArtifact.bytes`
is one `Uint8Array` (a `Blob` is V1); W4-15 VRMA writer root and skipped tracks; W4-16 `validation` is null from
writers (the stretch worker validates); W4-17 `.ekzanim` zip layout and limits; W4-18 `CompressedDataError`; W4-19
meshopt decoder imported statically. Extra exports (`importProvenance`, `inspectVrma`, `setGltfValidator`, lint rule
table, `io/worker`) accepted.

**WP-5 viewport** — V-1 every visible pane redraws when anything is dirty; V-2 extra public API; V-3 stable pane
ids; V-4 shot-binding fallback; V-5 pick-candidate ordering (depth buckets); V-6 ring-drag mapping; V-7 programmatic
camera-controls, pinch dollies, orthographic views do not tumble; V-8 untouched views re-frame when characters
change; V-9 the panel hosts its own canvas only without a model loader (fake app); V-10 test pre-bundling; V-11
x-ray via per-pane material flips; V-12 no safe-frame masks or bookmarks yet; V-13 mesh-pick candidate rules
(stretch, done); V-14 camera radial (stretch, done); V-15 orthographic shot zoom stored as `orthoHeight`; V-16
self-enabling gated tests. The unit-circle stand-in for a stubbed shape library is removed (INT-24).

**WP-6 Graph Editor** — G-1 painters read compiled handle arrays (cross-checked against `segmentControlPoints`);
G-2 display scale from `channelDisplayScale`; G-3 local scene→clip mapping for the range shading (same formula as
doc's); G-4 with no selection the channel list shows the active character's animated controls; G-5 Move tool =
Select; G-6 single click on a curve clears, double-click selects its keys; G-7 empty marquee selects handles; G-8
locked curves dashed and inert; G-9 channel rows write `selection.channels` (INT-4); G-10 dense unselected keys are
not drawn; G-11 Alt+MMB/RMB in every profile; G-12 hit values in display units; G-13 null points outside the
canvas; G-14 field grammar (INT-25) and the mixed-value ×/÷ refusal (INT-12); G-15/G-16 test config; G-17 overlap
resolution to the curve drawn on top; G-18 near-thirds weighted spans drawn with the thirds; G-19 per-curve set
updates; G-20 Shift axis lock on handle drags; G-21 free weighted handle clamp (INT-11); G-22 handle hit candidates
near the pointer.

**WP-6t time slider** — band cells `[start − ½, end + ½)`; target keys = selected controls (all when none); the
drag recomputes band keys at press; one drag = one step, the band stays; scale pivots at the opposite end (factor ≥
0.01); `time.selectBand {band: null}` clears; scrub snapping and clamping; slider spans clip ∪ playback range with
drawn-only range brackets; RMB menu without a band offers only Paste (superseded by INT-52: it acts on the current
frame); frame-field grammar; transport cycling Once →
Loop → Oscillate; ←/→ on the focused slider step. `cancel()`/`dragging` accepted (INT-23).

**WP-7a kernel** — 1 `KernelDeps` seam; 2 the fake app runs the real kernel; 3 every local undoable commit is a
history step (INT-13); 4 override lifetime is a kernel invariant; 5 runner rule 7 clarifications (INT-13); 6
session repair after every batch; 7 playback details (floor in the play direction, loop wraps into `[start, end)`);
8 keymap precedence and auto-repeat set; 9 `services.models` waits for `setRenderer`; 10 edit-kernel
interpretations (no toasts from `applyChannelEdits`, Maya weight lengths, block moves, locked curves skipped —
the free-weighted clamp changed by INT-11); 11 numeric display units (grammar widened by INT-25); 12 the app's ID
source seeds doc's default while it lives (collisions with loaded documents avoided by INT-27); 13 local channel
facts; 14 platform default `'other'`; 15 document loads vs partition batches; 16 `coalesce` (now in the contract,
INT-13); 17 coalescing recognised by entry identity; 18 `edit.escape` during gestures; 19 step label = final entry
label; 20 a throwing gesture commit ends like a cancel; 21 override deltas hold the active character's controls only.

**WP-7b operators and workflows** — B7-1 confirmations are the shell's (INT-10); B7-2 a model already in the
project imports as another character; B7-3 compressed animation data imports the model without clips by default;
B7-4 embedded-clip default = the dialog's (all when ≤ 8); B7-5 `loop` from the clip name; B7-6 the first character
sets the scene clock; B7-7 placement along +X and the locked `shotCam`; B7-8 reduction and key-time defaults; B7-9
display names from VRM meta; B7-10 pose tools write only changed channels; B7-11 curve-level operators' target
rule; B7-12 unify keeps computed sides computed; B7-13 numeric-field semantics; B7-14 `time.setFrame` units and key
jumps; B7-15 `channel.setValues` does not coalesce; B7-16 duplicate/delete details; B7-17 fps rescale rounding and
clip-settings validation; B7-18 `clip.new` becomes active; B7-19 export licence gate, preflight, unions,
`{clip}` token; B7-20 host validation turns violations into error lints; B7-21 samples relative to the page origin
(base URL now `samplesPath`, INT-8); B7-22 JSON projects open without their model bytes; B7-23 `edit.*` and
`file.open` dispatch rules; B7-24 `edit.escape` order; B7-25 selection operators record no step; B7-26 `view.tool`
without registered tools; B7-27 animation-only GLB import by content sniffing; B7-28 technical rig notes stay out
of the import toast; B7-29 saving opens every partition first; B7-30 only wanted animations are decoded; B7-31 locks
respected everywhere; B7-32 a failed read-back blocks the download; B7-33 Mixamo rule for VRMA provenance; B7-34
clip switch keeps selection consistent; B7-35 `rig.setRotateOrder` is structural. `select.channels` and
`view.camera.setSettings` moved into the contract (INT-4).

**WP-8 shell, ui, web** — W-1 shell operators (INT-3); W-2 versioned layout storage; W-3 `renderedFrames` counts
canvas frames (INT-9); W-4 "editor could not start" fallback; W-5 `/dev/shell` harness and synthetic model loader;
W-6/W-7 extra dialog controls and defaults; W-8 `runFromUi` reporting; W-9 held-chord defaults; W-10 Space tap
under `spaceBehaviour: 'play'`; W-11 ordered, sequential, dialog-waiting file pipeline; W-12 fonts self-hosted,
vendored dockview CSS; W-13 `samplesPath` (now used, INT-8) and the stretch validator worker not wired; W-14
`strictPut` (INT-15); W-15 e2e fixme gates (inert now that every package landed); W-16 keyboard while dialogs own
it; W-17 `data-ekza-motion` on `<html>`. R-4 decided by INT-1.

**WP-9 data panels** — D-1 adapters removed (INT-24); D-2 inline virtualizer geometry; D-3 local menu, popover,
fields and icons (swap deferred, INT-6); D-4 shared kit under `channel-box/kit/`; D-5 direct channel-selection and
hover writes (selection kept, hover now typed: INT-4, INT-5); D-6 lens fields enabled by polling
`view.camera.setSettings`; D-7 nudge bursts end on key release; D-8 lead state colours, `—` for mixed values; D-9
custom attributes not listed; D-10 panels report refused runs; D-11 the Outliner leaves Space to the keymap; D-12
state colours hidden while drafting.

## F. M2a build deviations (2026-10-18)

M2a was built in six packages (A0 contracts and foundation, A1 rig IK, A2 IK editor, A3 Dope Sheet and timing, A4
Graph Editor and posing, A5 platform), integrated on `m2a/integration` ([M2A-SPEC](M2A-SPEC.md) v0.3) and merged into
`dev` (M2A-INT-19). Each
package recorded its interpretations in `docs/wp-notes/m2a-*.md` with the reasoning and tests; the integration's are
in [`wp-notes/m2a-integration.md`](wp-notes/m2a-integration.md). IDs are `M2A-<package>-<n>`. All are **accepted as
built** (and the contract changes among them ratified into M2A-SPEC v0.3) unless the status says otherwise; the owner
may override any of them.

### Package records (consolidated 2026-10-20)

Every package decision is recorded with its reasoning and tests in its wp-note and is accepted as built unless a row
below says otherwise; this index points to them. Owner items and decisions that change behaviour across packages are
repeated below.

| Package | Record | IDs |
|---|---|---|
| B0a contracts, schema v3, stubs | [m6a-contracts-foundation](wp-notes/m6a-contracts-foundation.md) | M6A-B0A-1…29 (incl. the eager-allowance decision request) |
| B0b keymap, menus | [m6a-keymap-menus](wp-notes/m6a-keymap-menus.md) | M6A-B0B-1…16 |
| B1 mesh kernel | [m6a-mesh-kernel](wp-notes/m6a-mesh-kernel.md) | M6A-B1-1…17 |
| B2 selection, symmetry maps | [m6a-mesh-select](wp-notes/m6a-mesh-select.md) | M6A-B2-1…18 |
| B3 core ops | [m6a-mesh-ops-core](wp-notes/m6a-mesh-ops-core.md) | M6A-B3-1…27 |
| B4 shape ops | [m6a-mesh-ops-shape](wp-notes/m6a-mesh-ops-shape.md) | M6A-B4-1…24 |
| B5 bevel, Mesh Check, UV | [m6a-mesh-bevel-check-uv](wp-notes/m6a-mesh-bevel-check-uv.md) | M6A-B5-1…16 |
| B6 mesh view, picking | [m6a-mesh-view](wp-notes/m6a-mesh-view.md) | M6A-B6-1…26 |
| B7 runtime, blobs, undo budget | [m6a-mesh-runtime-doc](wp-notes/m6a-mesh-runtime-doc.md) | M6A-B7-1…27 |
| B8 io, marker v2 | [m6a-mesh-io](wp-notes/m6a-mesh-io.md) | M6A-B8-1…17 |
| B9 shell, workspaces | [m6a-shell-workspaces](wp-notes/m6a-shell-workspaces.md) | M6A-B9-1…27 |
| B10 modes, selection UI | [m6a-model-select-ui](wp-notes/m6a-model-select-ui.md) | M6A-B10-1…24 |
| B11 operators UI | [m6a-model-ops-ui](wp-notes/m6a-model-ops-ui.md) | M6A-B11-1…27 |
| B12a transform tools | [m6a-model-transform-tools](wp-notes/m6a-model-transform-tools.md) | M6A-B12A-1…19 |
| B12b topology tools | [m6a-model-topology-tools](wp-notes/m6a-model-topology-tools.md) | M6A-B12B-1…20 |
| B13 content | [m6a-model-content](wp-notes/m6a-model-content.md) | M6A-B13-1…21 |
| INT | [m6a-integration](wp-notes/m6a-integration.md) | M6A-INT-1…33 |

### Owner review items

These trade a stated M2a promise for something measured, or need a product call. Each is built and tested as
described; the alternative is named.

| ID | Item | Built | Alternative |
|---|---|---|---|
| M2A-A1-3 | **Hyperextended rest limbs** (both fixtures' arms: Seed-san −1.4°, Polybot −4.9°) cannot be rest-exact (1e-7) and bend in flexion only with a continuous solution | Continuous amendment C: below the rest reach the bend passes to the flexion branch through a C¹ band in which the hand passes its IK target by ≤ 0.57 mm (Polybot, within 2.1 mm of the rest reach; Seed-san ≤ 0.07 mm within 0.28 mm); matching places the IK control so switches stay exact; the rig warns with the band | Flexion only: the elbow pops by 2T (5.7 mm Seed-san, 12.4 mm Polybot) when an IK hand crosses the rest reach, and rest exactness fails on those arms |
| M2A-A5-3, M2A-INT-3 | **Export reduction gate** "hand-keyed clips shrink 3–10×" (FR-EXP-12; the requirement keeps that criterion and is marked partial until this is decided) | ≥ 3× asserted on linear blocking (E2E-M2A-21b); on smooth hand-keyed clips (the wave, the acceptance walk) the reduced file is within the per-node tolerances and never larger — in samples, and since fix round 1 in bytes (a reduction is kept only where it pays for its own time accessor, M2A-INT-22) — but keeps (nearly) every sample: R02's tolerances (0.2 mm × H/1.7) are below what dropping one 30 fps sample of smooth motion costs | Loosen the tolerances (breaks the bound the reduction promises), or count constant tracks differently (they are already 2 samples) |
| M2A-A5-10 | **Lazy chunks offline** (M-2) | A dialog or pipeline whose chunk cannot load closes with a toast; the next open retries. Offline after page load, import/export/save/open and unloaded dialogs fail gracefully | Static export only: prefetch the lazy groups at idle (≈ 216 kB); or a service worker precache |
| M2A-INT-4 | **M-2 target** | 850,000 B for M2a (the spec's ceiling for a recorded reason): the merged route is 843,270 B (A5 alone 785,248 B; A1…A4 add ≈ 58 kB eager); gate 900,000 B in CI | Cut to 800,000 B in M2b: IK operator bodies behind `prepare`, the Dope Sheet controller behind its lazy panel, Next client navigation, `camera-controls` until the first tumble |
| M2A-INT-13 (M-4) | **Dope Sheet drag of 1,000 keys** (§5.22, report only) | Miss: 21.2 / 26.1 ms on 213 curves (the Graph Editor's M-1 gate, 30 curves, is met at p95 3.1–3.4 ms); per-curve recompile and re-evaluation dominate | M2b: recompile only the moved span, defer re-evaluating curves whose current-frame segment did not change |
| M2A-INT-11 | **Ball roll and the seamless switch** (A2 open issue 1; narrowed by fix round 1, M2A-INT-20) | The ball roll pivots at the toes joint now, so IK → FK matches the toes exactly; FK → IK with `@roll` in the ball range keeps the chain exact and warns with the toes' turn (the toes rule counter-rotates the ball roll); `f − 1` stays exact | The IK-side match also sets `fk.toes` (or zeroes the roll) |
| M2A-INT-21 | **Root motion "In place" removes the travel, not the hips' X/Z** (fix round 1; MVP-SPEC §4.11.10 step 3 amended) | The in-place node's X/Z displacement from the first to the last frame is removed linearly; sway and bob stay, so planted IK feet stay planted in the file and a clip that ends where it starts exports the editor's motion (M1 locked X/Z to rest: the acceptance walk's feet slid 1.5 cm sideways in its VRMA) | Lock X/Z to rest as M1 (feet slide by the sway), or remove the mean velocity by a least-squares fit, or a third mode next to both |
| M2A-INT-33 | **Version of M2a files** (fix round 1) | Exports, projects and autosave write `0.2.0`; About shows `0.2.0-dev` | The tag step sets the released number and drops `-dev` |
| M2A-INT-12 | **Cyclic `@ikFk` curves with keys** (A2 open issue 4) | §5.23 unchanged: a curve keyed once at 0 on a loop clip cycles over its key range after a switch at 10 (frames 11…19 read the old mode) | `@ikFk` curves never cycle, or cycle over the clip range (a §5.23 contract change) |
| M2A-INT-1, -2 | **Acceptance fixtures**: E2E-M2A-23's hips are lowest at the contacts, E2E-M2A-24 starts and ends in a ready stance 5 cm down | Polybot's and Seed-san's legs are (nearly) straight at rest, so with the hips at rest the specified IK feet are out of reach and lift off their targets | — (geometry); every assertion of §9.1 is kept |
| M2A-A2-12, -13 | **E2E-M2A-02, -05 rows** (fixture geometry) | The pole step asserts the knee offset's turn (Polybot's rest knee sits outward of its hip→foot line); the arm is bent 30° before the IK switch (Seed-san's T-pose arm is straight) | — |

### Integration decisions (M2a)

| # | What | Decision | Where |
|---|---|---|---|
| M2A-INT-1…3 | Acceptance scenario readings | Above (owner items); `apps/web/e2e/m2a-23-24-acceptance.spec.ts` authors both clips with real input (viewport and Outliner picks, Channel Box typing with `S`, a time-slider band with `4`, the Pose menu, Dope Sheet drags, the status-line Tween bar, the Export dialog) and proves "no Plant Feet" with an undo walk back to the clip setup and a redo | M2A-SPEC §9.1 |
| M2A-INT-4 | M-2 | Above | M2A-SPEC §5.21.2 |
| M2A-INT-5 | `moveKeys` wrote a key at −0 after a snapped sub-half-frame move left of 0 (A3's clamp skips a zero shift; M1 always added it) | **Fixed**: placements normalise −0; A4's drag-equals-`moveKeys` test passes again; property test added | `editor-core/src/edit/keys.ts`; `test/kernel/m2a-integration.test.ts` |
| M2A-INT-6 | A4's M-1 cut (the time slider skips key updates that keep time and curve) vs A3's green breakdown ticks | **Fixed in the merge**: a changed breakdown flag rebuilds the ticks | `curve-editor/src/timeline/TimeSliderController.ts`; `test/timeline/m2a-integration-ticks.test.ts` |
| M2A-INT-7 | E2E-M2A-14 (first run at integration) clicked then pressed keys, which the Graph Editor's 400 ms multi-click window turned into a curve selection when two scenario steps hit one pixel | **Test fixed**: one press-drag per key, polled key points, frame all before a key beyond the view; assertions unchanged | `e2e/m2a-14-breakdown-retime.spec.ts` |
| M2A-INT-8 | E2E-27 failed every run in `chromium-swiftshader` on the merged build: the Outliner's reveal scroll swapped the found row out | **Test fixed**: `clickOutlinerRow` waits for the scroll to settle and finds a swapped-out row again | `e2e/helpers/g3-input.ts` |
| M2A-INT-9 | anim-core properties failed now and then (A2 open issue 3) | **Test fixed**: samples rounded one ulp past the last key into the next cycle; clamped to the key, the two seeds pinned as explicit cases; the engine is unchanged | `anim-core/test/curve/evaluate.test.ts` |
| M2A-INT-10 | Contract PRs of A1…A5 | **Ratified** into M2A-SPEC v0.3 (A1 C-1…C-7, A2's rows and switch rules, A4-10/13/14, A5-3) and here | M2A-SPEC §5.2, §5.3, §5.6, §5.14, §5.16, §8 A1, §9.1 |
| M2A-INT-11, -12 | A2 open issues 1 and 4 | Above (owner items) | M2A-SPEC §5.6 |
| M2A-INT-13 | Dope Sheet drag | Above (M-4) | ROADMAP M2a budgets |
| M2A-INT-14 | README GIFs | Recorded from the e2e build by `apps/web/scripts/record-readme-media.mjs` into `docs/media/` (Polybot, CC0) | README |
| M2A-INT-15 | Owner demo script (§10.3) | **Run by the integration** once in sequence on one page in real Chrome, scripted: `e2e/m2a-demo-walkthrough.spec.ts` (kept in the suite, 11 s; also SwiftShader). All ten steps pass. Readings: step 2 picks the IK foot in the Outliner after moving the pole (in the viewport the selected pole's move manipulator wins the click, MVP-SPEC §4.11.16); step 3 switches back to IK at frame 15 and lowers `cog` by 2 cm (the script names neither; E2E-M2A-03's frame); step 5 and the neighbour move of step 6 are undone so the loop stays 24 frames; step 10's "size" is the sample count the dialog and toast show (§5.16). The owner's own run stays open | M2A-SPEC §10.3, §10.4 |
| M2A-INT-16 | The walkthrough's recovery step: frozen tangent handles carried −0 into the document (a half-cycle mirror freezes the seam keys' resolved handles; a flat side resolved to `0 × (−dt)` = −0), and recovery (JSON) brought them back as +0, so the recovered document differed from the autosaved one by the sign of zero | **Fixed** at the source: anim-core's resolved (computed) handles write `0 + x`, A4's weighted handle reader likewise; the anim-core test that pinned −0 for a flat end key now pins +0; a property over every tangent type, and the mirrored keys' JSON round trip | `anim-core/src/curve/resolve.ts`; `test/curve/tangents.test.ts`; `editor-core/test/kernel/m2a-integration.test.ts` |
| M2A-INT-17 | Fix round 1 (verifier): the hand-offs of M2A-A4-12 | **Resolved**: (a) `graph.keys.scale {valuePivot, valueFactor}` scales values through `scaleKeyValues` in the time scale's step — the package gate `VALUE_SCALE_AVAILABLE` (A3) had survived the integration and is removed, and the "no stub" test now runs the changed key operators with their M2a arguments and fails on any "not available yet" wording; (b) the Dope Sheet's Tween bar mount — done by A3; (c) the Graph Editor's key fields, `graph.keys.setFields` and the handle metrics use the channel's unit (§5.1 rule 5): an `@roll` key at 20° read 0.349 and typing 30 wrote 49.65°, now 20.000 and 30°, the angle fields match the drawn slopes; (d) the time slider's per-batch tick set — value-only batches and breakdown flags handled (M2A-A4-16, M2A-INT-6), batches that move keys in time still rebuild it (part of M-4, M2b) | `editor-core/src/operators/builtin/graph.ts`, `edit/keys.ts`; `editor/src/panels/graph/model.ts`; tests `m2a-timing-operators`, `m2a-operators`, `m2a-angle-units` (Node), `m2a-graph-angle-units` (browser) |
| M2A-INT-18 | M2a-stretch (§1.2) and its fallbacks | The six items are `test.fixme` in `e2e/stretch.spec.ts` with an `M2a-stretch` annotation (item, fallback, acceptance); a test there checks the fallbacks the test API reaches. The mesh-pick fallback hint was not built and now is: a mesh pick of an FK control on a limb in IK says "IK limb: pick the IK control" — as an info toast, because viewport tools reach the notifier, not the shell's help line (§1.2 amended); §1.2's stepped-tangent key is `6`, not `Digit5` | `viewport/src/tools/selectTool.ts`; `viewport/test/m2a-mesh-pick-hint.test.ts`; M2A-SPEC §1.2 |
| M2A-INT-19 | Merge into `dev` (2026-10-18) | Each branch merged `--no-ff`, signed off, in the order A0, A1, A2, A3, A4, A5, then `m2a/integration` (the integration branch had merged them in the §10.1 order A0, A4, A5, A1, A2, A3). Conflicts only in the files the packages' merge notes name: the adjacent ROADMAP status rows (each package's own row), A0's stub lists (every package's removals kept; with A5 they become "no M2a operator is a stub" checks), `importModel.ts` imports (A2's `importLimbWarnings`, A5's names import), and — in the A4 merge — `TimeSliderController.ts` (with M2A-INT-6), `SceneSync.ts` and `m2a-foundation.test.ts`, taken from the integration branch because neither A5 nor its later commits touch them. After A5 the tree equals the integration's all-packages merge (`ccdab84`) byte for byte, and after `m2a/integration` it equals the branch head (`9a8e3d0`). A2's review finding (a switch to the limb's current mode re-matched and moved the pose) was fixed on A2's branch before the merge (M2A-A2-23) and is covered by `m2a-a2-ik.test.ts`, `ops.ik.test.ts` and E2E-M2A-03. Gates and budgets re-run on `dev` | `docs/wp-notes/m2a-integration.md` "Merge into `dev`"; ROADMAP M2a budgets |

Turned into failures (§3 rule 4, as INT-55 did for M1): every `READY` flag (`editor-core/test/ready.ts` removed,
`READY_A1` in the headless tests), the e2e A1 gate (`expectLimbIk`), the `test.fixme` of E2E-M2A-10b, -14, -15,
-22b and -25, the A0 stub lists, the export path's tolerance of a stubbed rig, and — in fix round 1, after the
verifier found it still on — A3's `VALUE_SCALE_AVAILABLE` gate of `graph.keys.scale` (M2A-INT-17). The only
`test.fixme` tests left are the stretch items in `apps/web/e2e/stretch.spec.ts`: three M1-stretch and six
M2a-stretch entries (M2A-INT-18).

### Acceptance fix round 1 (M2a on `dev`, 2026-10-19)

The M2a acceptance round on `dev` (`f4ddcf5`: a Polybot walk and a Seed-san attack authored through the UI in real
Chrome, exported and sampled in Node) found two major and twelve minor defects; all are fixed with regression tests
that fail without the fix. Details, numbers and tests:
[`wp-notes/m2a-integration.md`](wp-notes/m2a-integration.md#acceptance-fix-round-1-on-dev-m2a-int-2033).

| # | What | Decision | Where |
|---|---|---|---|
| M2A-INT-20 | Ball roll pulled the toes joint off the foot (8 mm at 30° on Seed-san; bakes wrote a toes translation and linted `ekza.hips-only-translation`) | **Fixed**: the ball roll pivots at the toes joint (the ground ball at the toes joint's rest height); IK → FK now exact (owner item M2A-INT-11 narrowed) | `rig/src/limb/foot.ts`, `ik2.ts` (`limbFootRoll`), `match.ts`; M2A-SPEC §5.2.3, §5.3, §5.3.1, §5.6 |
| M2A-INT-21 | "In place" deleted the hip sway: planted IK feet slid 1.5 cm in the exported walk | **Fixed** by removing only the travel (owner item above) | `io/src/bake/bake.ts`; MVP-SPEC §4.11.10, FR-EXP-10 |
| M2A-INT-22 | "Reduce keys" made files larger (per-track time accessors) | **Fixed**: a reduction is kept only where it saves bytes, time accessor included | `io/src/bake/reduce.ts`; M2A-SPEC §5.16 |
| M2A-INT-23 | Recovery reopened the first clip | **Fixed**: slot info records the active character and clips; recovery returns to them | `editor-core/src/app/autosave.ts`, `operators/builtin/autosave.ts`; M2A-SPEC §4.5, §5.20 |
| M2A-INT-24 | Whole-character mirror: a ~1,000-character warning toast | **Fixed**: unpaired controls summarised in one line (count, three names) | `editor-core/src/workflows/mirrorAnimation.ts`, `operators/builtin/pose.ts`; M2A-SPEC §5.14 |
| M2A-INT-25 | Mirror flip left key-less curves; flip twice ≠ identity | **Fixed**: no source curve removes the target curve | `mirrorAnimation.ts`; M2A-SPEC §5.14 |
| M2A-INT-26 | Time-slider arrow nudge left the band behind | **Fixed**: the band follows the keys' real offset | `editor-core/src/operators/builtin/graph.ts`; M2A-SPEC §4.9 |
| M2A-INT-27 | Channel Box LMB slider: fractional clientX in the first increment (+10.1667° for +10°) | **Fixed**: movementX only | `editor/src/panels/channel-box/ChannelBoxPanel.tsx`; M2A-SPEC §5.18 |
| M2A-INT-28 | Match Range to IK at key times changed in-betweens silently (3.5 cm) | **Fixed**: the operator measures the in-betweens and warns above 1 mm; menu item "… to IK (Every Frame)" | `editor-core/src/workflows/ik.ts`, `operators/builtin/ik.ts`, `menus.ts`; M2A-SPEC §5.6 |
| M2A-INT-29 | Seamless switch hold keys with −0 handles (lost by JSON); −0 in auto-rig shape quaternions | **Fixed**: `0 ± x` | `anim-core/src/curve/insert.ts`, `rig/src/autorig/shapes.ts` |
| M2A-INT-30 | "Stray marquee" over the Dope Sheet after closing a toast: the empty toast viewport's focus ring | **Fixed**: no ring on an empty viewport; focus returns to the page | `ui/src/primitives/toast.tsx`, `ui/styles.css`, `editor/src/shell/Toaster.tsx` |
| M2A-INT-31 | Remove Frame disabled without a reason | **Fixed**: disabled time-slider menu items show the poll reason as their tooltip | `editor/src/panels/timeline/TimelineMenu.tsx` |
| M2A-INT-32 | Channel Box labels "Translat..." with the IK/FK row | **Fixed**: the switch button gets a sized column | `ChannelBoxPanel.tsx` |
| M2A-INT-33 | Exports said 0.1.0 | **Fixed**: `0.2.0` (owner item above for the tag) | `editor-core/src/workflows/samples.ts`, `editor/src/dialogs/samples.ts` |

New e2e spec `apps/web/e2e/m2a-r1-fixes.spec.ts` (toast focus ring, nudge band, Channel Box names); assertions added
to E2E-M2A-03, -04, -21, -23 and the owner demo walkthrough.

### Acceptance fix round 2 (M2a final acceptance on `dev`, 2026-10-19)

The final M2a acceptance passed and reported one major and one minor defect; both are fixed with regression tests
that fail without the fix (checked against the unfixed build: both e2e tests and the two browser tests fail).

| # | What | Decision | Where |
|---|---|---|---|
| M2A-INT-34 | **Major**: a one-pane viewport (a Space-maximized pane, the Single layout) filled about 40 % of the Viewport panel — at 1440 × 900 a maximized pane ended at x = 626 px, the panel at 1160 px — and the GL viewport and input surface with it. The one-pane grid is a row flex container, where the pane's `<section>` (no width) took its header's content width; split and quad panes sit in block boxes and filled them. **Not an M2a regression**: the grid and pane markup are unchanged since the viewport panel was built (WP-5, `f5a0b0d`, in `v0.1.0`); E2E-05 checked only the maximize state, and the browser panel tests run without Tailwind | **Fixed**: the pane fills the box its layout gives it (`w-full`); split and quad unchanged | `editor/src/panels/viewport/PaneView.tsx`; e2e `m2a-r2-fixes.spec.ts` (DOM boxes and the manager's pane rectangle in split, a maximized split pane, quad, a maximized quad pane and Single) |
| M2A-INT-35 | Minor: the Graph Editor and the Dope Sheet listed attribute channels by raw id in alphabetical order ('bank', 'heelTwist', 'ikFk', …), unlike the Channel Box | **Fixed**: one helper pair in editor-core's `channelMeta` — `channelDisplayLabel` (TRS names, `AttrDef.label`, else the title-cased name) and `sortChannelsForDisplay` (TRS in Maya order, attributes in `attrs` order, `@ikFk` after them where the Channel Box shows the IK/FK row, attributes the control does not define last by id) — used by the Channel Box, the Graph Editor's channel list and stacked lanes, the Dope Sheet's rows and the virtual slider's step label (the three TRS name tables became one); curve-editor's `channelLabel(channel, control?)` delegates | `editor-core/src/edit/channelMeta.ts`; `curve-editor/src/channel-tree/`, `dopesheet/rows.ts`, `graph/GraphEditorController.ts`; `editor/src/panels/channel-box/ChannelBoxPanel.tsx`; M2A-SPEC §5.1 rule 5; tests `curve-editor/test/channel-tree.test.ts`, `dopesheet/rows-holds.test.ts` (browser), e2e `m2a-r2-fixes.spec.ts` (Channel Box, Graph Editor and Dope Sheet show the same names in the same order) |

### Build deviations of A0 … A5 (consolidated)

**A0 contracts and foundation** — A0-1 `time.insertTime {at?}` and `time.deleteTime` (menu items without a frame);
A0-2 Rig › IK/FK as one sub-menu with a group per limb; A0-3 no stub implemented early; A0-4 `key.set` refused
body-part and breakdown keys until A2; A0-5 probe-map keys and the hidden-tab rule (a panel in an inactive dock tab
reads null); A0-6 test-API reads flush the scheduler first, `curveSlope` exact one-sided slopes; A0-7 scheduler
replacement, nesting and error rules; A0-8 attribute slots repair, never reject; A0-9 a throwing `compile` skips the
op (`isRigOpSkipped`, `ikFk` reads 0); A0-10 attribute sampling in the curve cache; A0-11 `ensureCurve` is the one
loop-clip curve creator, rotate-order conversion keeps sibling infinities; A0-12 `ns` and `storage=blocked`; A0-13
layout v1 → v2 through the dockview API; A0-14 M2a prefs load field by field, `'ghost'` and the Recovery dialog
poll-failed until built; A0-15 owners of what A0 left; A0-16 `--rig-pole-line`; A0-17 the FR-GE-17 stretch entry
passes; A0-18 `view.tool` with an unregistered built-in tool says "not available yet"; A0-19 cycle-aware Simplify
(`ReduceOptions.cycleAwareAuto`).

**A1 rig IK** — A1-1 the knee hinge from the lower leg (C-1); A1-2 the match pole rule relative to the IK's own mid
joint (C-4, C-5); A1-3 amendment B always and the continuous amendment C (C-3, owner item above); A1-4 the off-hinge
rest pole (C-2); A1-5 the foot region of the mesh (C-6); A1-6 `matchIkToFk` matches the IK side only; A1-7
influencing curves skip limbs inactive over the clip (M1 rigs export byte-identical); A1-8 Plant Feet on IK legs
(attributes from the channel buffer); A1-9 import-to-IK key times and tangents; A1-10 duplicate-binding and
asymmetric-rest warnings; A1-11 the toes rule at `0 < w < 1` without a slerp; A1-12 no allocation per evaluation,
checked by count; A1-13 the pole-travel gate replaced (C-7); A1-14 `ik2` reads the IK control, pole and parent node
only.

**A2 IK editor** — A2-1 one seam to the rig's limb math (`setLimbKit`, test-only); A2-2 limb fixtures in the test kit;
A2-3 the keyAll rule's explicit channels are the selected Channel Box channels (the IK/FK proxy row); A2-4 body part
on a generic rig keys the selection and says so once; A2-5 pick-walk through hidden controls, arrow labels follow
`prefs.arrowKeys`; A2-6 switch key policies never overwrite a key at `f − 1`; A2-7 match warning texts; A2-8
`matchRange` frames; A2-9 import limb warnings first; A2-10 virtual slider details; A2-11 additive exports; A2-12/13
E2E rows (owner items above); A2-14 withdrawn; A2-15 E2E-M2A-07 names nodes from the source VRM; A2-16 `pose.mirror`
hands the rig the attribute values; A2-17 Channel Box attribute rows; A2-18 M1-rig tests import with `autoRigIk` off;
A2-19 seamless hold keys at `f − 1` (ratified); A2-20 toes warnings on both sides; A2-21 reset and the pose clipboard
never touch `keyAll: false` attributes unless selected; A2-22 no per-frame work for the IK/FK display; A2-23 a switch
to the current mode is refused (ratified); A2-24 the curves a seamless switch starts get constant infinities
(ratified).

**A3 Dope Sheet and timing** — A3-1 ripple control sets registered per panel kind; A3-2 paste inserts with ripple on;
A3-3 insert/delete time targets and refusals; A3-4 retiming details (floating breakdowns, exact times on rounding
collisions, the M1 clamp when retiming would cross an edited breakdown); A3-5 the key-by-key scale clamp keeps order;
A3-6 `copyKeys` collisions; A3-7 pressing a fully selected glyph keeps the selection; A3-8 region-bar handles on
narrow bars; A3-9 the Dope Sheet's lazy boundary and persisted Show/expansion; A3-10 MMB carry is one `Carry Pose`
step; A3-11 key edits place only the slice they can change (differential fuzz); A3-12 cached row data and cheap
glyphs.

**A4 Graph Editor and posing** — A4-1 the notes file is `m2a-graph-posing.md`; A4-2 the tween plans once and evaluates per amount, `key.tween` clamps the amount;
A4-3 the `'frame'` target's channels; A4-4 runs use visible keys; A4-5 the Tween bar's target toggle and DOM-written
label (idle rule); A4-6 buffer curve targets and swap; A4-7 mirror animation details; A4-8 view mapping details; A4-9
Scale tool details; A4-10 E2E-M2A-17 at the float32 pointer precision (ratified); A4-11 additive exports; A4-12
owners of what A4 left (resolved: M2A-INT-17); A4-13 half-cycle seam keys keep step flags (ratified); A4-14 working-copy refinements
(ratified); A4-15 key-edit gestures record override changes; A4-16 M-1 changes outside A4's directories; A4-17 the
value-only drag path (M-1).

**A5 platform** — A5-1 the measured route is a first visit (the First-run dialog counts); A5-2 the import pipelines
are a lazy chunk; A5-3 the reduction gate (owner item above); A5-4 the keep set without A1 (superseded: the gate is a
failure since integration); A5-5 autosave details; A5-6 sibling check on trial merges; A5-7 M-3 mechanisms (segment
hint, once-bound imports); A5-8 the export pipeline is its own lazy chunk; A5-9 M1 bytes without `reduce`; A5-10
offline lazy chunks (owner item above); A5-11 the Export dialog passes `prefs.exportReduce`'s tolerances.

## G. Modeling iteration (M6a–M7), defaults chosen (2026-10-18)

The modeling iteration is planned in [MODELING-PLAN.md](MODELING-PLAN.md) on research
[10](research/10-maya-poly-modeling.md)–[16](research/16-model-workspace-ui.md) (`R10`…`R16`), with ADRs
[0014](adr/0014-mesh-kernel.md)–[0017](adr/0017-ai-generation-boundary.md) (0014–0016 accepted on 2026-10-19 with
[M6A-SPEC](M6A-SPEC.md) v1.0, which applies these defaults and lists its refinements in §12.2; 0017 proposed, its
provenance items accepted with M6a). Every item has a **default
chosen** so that the M6a spec can be written and B0a can start; **the owner may override any of them**. Items marked
**override** replace a research note's recommendation on evidence (MODELING-PLAN §11 lists all twenty-six research
conflicts and their resolutions; §12 lists the forty design-review findings of 2026-10-19 and what was done with
each, including the rejected and partly applied ones). IDs from the research notes are kept where they exist.

### G.1 Direction, scope and order

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-MOD-DIR-1 | **Maya or Blender** for modeling? | **Maya's interaction model** (component modes, marking menus, Maya keys and names) with **Blender's semantics** (adjust last operation, typed numbers in tools, live preview with clean cancel, symmetry remembered per mesh) and a **BMesh-style kernel**; a complete Blender keymap later as a data pack (ADR 0016, MODELING-PLAN §1) | A Blender paradigm would redefine `S`/`R`/`G`/RMB inside a product whose Animate side is Maya; cheap to change only before marking menus and the `model.*` keymap ship | M6a spec |
| Q-MOD-DIR-2 | Order of the next iterations | **M2a release → M6a → M6b (overlapping) → turnkey release → "Publish avatar" (M4a T3 slice) ‖ M7 G1 → M7 G2 ‖ M6c → M2b + rest of M2c → V1 → M4a T1 → M3 → M4b → M5 → M8** (MODELING-PLAN §9). Estimate (2026-10-19): M6a ≈ 108 agent-days + a fix round, critical path ≈ 28 working days (≈ 31 with the fix round); turnkey release ≈ 40–45 working days after B0a starts with 8–10 agents in parallel | Collaboration first delays the turnkey tool and would build sync before mesh storage settles; AI before M6b yields unrigged, uncleanable generations | before M6a starts |
| Q-MOD-DIR-3 | What the base leaves out | NURBS surfaces, sculpting, construction history, booleans, subdivision/smooth preview, UV editor and unwrap (M6c), texture painting, normal/AO bakes, LODs, retopology/Quad Draw, decimation (M7) (MODELING-PLAN §2.3) | Each item is roughly a milestone package of its own | M6a spec |
| Q-MOD-DIR-4 | M6c (UV editor, unwrap, image textures, decals, ramps) | **Optional, by demand**, in parallel with M7 | Skipping it keeps the palette-only workflow (enough for the OMOBA/Space low-poly style) | after M6b |
| Q-MOD-DIR-5 | Shell items planned for M2c | **Marking menus, command palette and workspaces move into M6a** (packages B0b and B9); the hotkey editor stays in M2c | Leaving them in M2c blocks every modeling surface | M6a spec |
| Q-MOD-DIR-6 | Release tags | `v0.3.0` = modeling base (M6a), `v0.4.0` = turnkey (M6b) | Naming only | each release |

### G.2 Interaction and keymap (ADR 0016, R10, R11, R16)

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-MOD-UI-1 | Compass positions of the RMB mode menu and Shift+RMB tool menus (Autodesk documents the items, not the positions) | **The owner checks once on Maya 2026/2027**; until then R16 §5.4/§6.1 as **provisional** slots (S Extrude, W Multi-Cut, SW Delete = Maya's plain Delete with Delete Edge/Vertex in the list) | Changing positions after release breaks gesture memory | M6a spec freeze |
| Q-MOD-UI-2 | Component-mode keys | `F8`; `F9`/`1` vertex; `F10`/`2` edge; `3` face; the active digit again returns to object mode; **F11 and F12 never bound in web builds** (R10 Q-MOD-10-3, R11 Q1, R16 Q-MOD-UI-2/-12) | F-keys only: unusable on Mac laptops and in browsers for F11/F12 | M6a |
| Q-MOD-UI-3 | `Ctrl+E` | **Extrude** in `model.viewport.component`; Export keeps `Mod+E` elsewhere and gains `Mod+Shift+E` everywhere (R10 Q-MOD-10-2, R11 Q2, R16 Q-MOD-UI-3). *Widened by M6A-SPEC v1.1 S17 to the whole Model workspace (`model` scope), as the default was presented to the owner: in Model, Export is `Mod+Shift+E`; Animate keeps `Mod+E`* | Extrude only by menu and Shift+drag | M6a |
| Q-MOD-UI-4 | Bevel, Multi-Cut and merge keys (Maya has no defaults) | `Mod+B`, `K`, `M` (Blender Industry Compatible habits; R11 Q3) | Menu-only like Maya | any time (keymap data) |
| Q-MOD-UI-5 | Workspaces | Tabs `Model › Rig & Skin › Animate › Review` with status glyphs; no default switch hotkey; Model layout four-view with persp maximized; timeline hidden in Model (R16 Q-MOD-UI-5/-7/-8/-11) | Cosmetic; closes Q-UI-1 | M6a |
| Q-MOD-UI-6 | `Delete` on edges | **override of R16 Q-MOD-UI-6** (dissolve): **Maya behaviour** — `Delete` merges the edge's faces and keeps the end vertices; `Mod+Delete`/`Mod+Backspace` = Delete Edge/Vertex (clean); the Shift+RMB SW slot runs plain Delete with Delete Edge/Vertex in its list; R16 §6.1, §19.3 and §19.4 are marked superseded; a stray-vertex lint offers a one-click fix (R10 Q-MOD-10-5) | Dissolve by default: breaks the owner's Maya habit and can change shapes (a cube edge → a prism) | M6a |
| Q-MOD-UI-7 | Parameters after an operation | **Last operation only** (card + Channel Box INPUTS, `T`), `G` repeat; no per-mesh history list (R16 Q-MOD-UI-4). **Extrude session**: after `Ctrl+E` the manipulator's own drags and `W`/`E`/`R` drags on the cap stay inside the same adjustable extrude (Maya `polyExtrudeFace` local translate/rotate/scale) until the selection changes or another operator runs; `localTranslateZ` is the primary field. `G` on tool-only operations (Multi-Cut, Target Weld, Slide) re-activates the tool | A history list needs construction history (ADR 0014 §8); without the session `Ctrl+E` then `R` would scale the original faces | M6a |
| Q-MOD-UI-8 | Numeric capture | **Narrow window** (`numericCapture: 'auto'`): armed during a drag, and right after a keyboard-invoked operator until the first pointer move, click or non-numeric key; **`T`** opens the card with the primary field focused at any time; outside the window `1`–`7` keep mode/shading meanings; preference `explicit` = `T` only (design review over R11 Q6's "armed while the manipulator is live") | A wide window turns `3` (leave face mode) into "3 m of thickness" while a manipulator stays up | any time |
| Q-MOD-UI-9 | Live Mirror (Blender Mirror-modifier semantics) | **M6a-stretch**; Symmetry mode + Mirror (cut, merge) are base, and **every base tool mirrors** under Symmetry (MODELING-PLAN §3.14: edge/face partner maps, `t`/`1−t`, seam rules). If the per-tool table overruns B12b by more than two agent-days at its midpoint, Live Mirror moves to base as the character path and Symmetry mode narrows to transforms and soft select (R10 Q-MOD-10-6, R11 Q4) | In base now: +2–3 agent-days and an evaluated-mesh layer in picking and export | M6a spec (fallback at B12b midpoint) |
| Q-MOD-UI-10 | Blender keymap preset | **V1 or later**, as a complete data pack, tested by a Blender user (R11 Q7) | Earlier: +1 modal transform operator and a second QA matrix during M6 | V1 |
| Q-MOD-UI-11 | Primitive defaults | **Low poly** (sphere 12×8 = 168 tris, cylinder and cone 8 sides, torus 12×6, plane 1×1) with a "Maya defaults" preference (R10 Q-MOD-10-4; R16's 8×6 sphere not taken) | — | any time |
| Q-MOD-UI-12 | Faceted or smooth new meshes | **Faceted** (all edges hard; record flag `faceted`); every op follows one hard-flag rule: edges inside a former all-hard face stay hard, side/strip edges use the op's `smoothingAngle`, default 0° on faceted meshes and 30° otherwise; Set Normal Angle is a one-shot operator, not a live modifier (R11 Q5, R12 §5.1) | 30° smoothing by default; without the rule, gentle extrudes would leave smooth patches in flat-shaded models | any time |
| Q-MOD-UI-13 | Undoable selection | **On in Model, off in Animate** (preference per workspace): consecutive selection gestures coalesce into one "Select" step in `EditorHistory`, session-only, never in the document or CRDT (Maya records selection in its undo queue by default; corrects R09 §6.3). *Refined by M6A-SPEC v1.1 S3: one step per discrete gesture, as Maya records each click; only auto-repeated grow/shrink keys and continuous drags coalesce* | Off: a stray click on empty space loses a hand-built loop selection with no way back | M6a |
| Q-MOD-UI-14 | MMB-drag in the viewport | **Maya rule**: with W/E/R active, MMB-drag anywhere moves/rotates/scales the selection (last-picked handle axis, or the view plane); when Channel Box channels or an INPUTS field are selected it stays the virtual slider (shipped M2a condition) | Without it there is no fast way to push components without grabbing a handle | M6a |
| Q-MOD-UI-15 | Meshes outside the hilite set in component mode | **Opaque and unpickable**; "Dim unhilited" as a per-pane option (R16 §5.3 proposed 70 % opacity) | Fading hides fitting problems (helmet on head, eyes in sockets) and adds sorting artefacts | any time |
| Q-MOD-UI-16 | Hide and isolate | `H` hide selected, `Shift+H` show all, `Alt+H` hide unselected (components and objects), `Shift+L` isolate per pane; Maya's `Ctrl+H`/`Ctrl+1` unbound (browser); hiding is session state, not saved | Keymap data | any time |
| Q-MOD-UI-17 | When primitive parameters freeze | At the **first component edit of any kind** (a vertex nudge included); object transforms keep them live | Freezing only at topology edits loses or misplaces vertex tweaks when segments change | M6a |
| Q-MOD-UI-18 | Tweak selection style and reference image planes | **Both in the M6a base**; Tweak is a Move tool option, off by default as in Maya | Stretch: no fast vertex pushing; freehand blockout without front/side concept art | M6a spec |

### G.3 Kernel and storage (ADR 0014, ADR 0015, R13)

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-MOD-K-1 | Construction history | **None**: destructive modeling, adjust last operation, primitive parameters live until the first topology edit; history only for M8 curve generators (R13 Q4) | Maya-style history needs per-op dirty propagation, per-node undo and a finer collaboration model | M6a spec |
| Q-MOD-K-2 | Partition of mesh records | **override of R13 K7/Q1**: the **owner's partition** (`char:<id>` for character meshes, `scene` for props); mesh claims are record-scoped; no `mesh:<id>` partition | A per-mesh partition changes the closed `Partition` union, opens one document per prop and splits joint-delete + weight-move across documents; it can come later by migrating one table if per-document modeler ACLs are needed | M3 (M4b for ACLs) |
| Q-MOD-K-3 | Where skin weights live | **override of R14 D8**: **layers in the mesh revision** (`skin.joints` u16×4, `skin.weights` f32×4, joint palette in the manifest and copied into `data.joints` of the same field value for `referencesOf`; weights on a vanished joint fold to its nearest ancestor with `skin.dangling-joint`), the binding a mesh-record field; morph names only in the manifest; `ekza.skin.v1` survives as the layer encoding and export codec (R13 Q9) | A separate skin blob: two refs that drift, two undo steps or stale checks after topology edits | M6a spec (B0a) |
| Q-MOD-K-4 | Adjust-last mechanism | **Undo + re-run** (`edit.adjustLast` dispatcher); no amend option in the store or `EditorHistory` (R11 §6.2 over R13 §9.4 and R16 §8.3) | An amend option is a store/ADR 0013 contract change for the same behaviour | M6a spec |
| Q-MOD-K-5 | Skin influences | **4, always normalized** (three.js and Bevy read one set of four) (R13 Q2, R14 Q-SKIN-4) | 8 internally with export pruning: not WYSIWYG | M6a |
| Q-MOD-K-6 | `robust-predicates` (Unlicense, outside `ALLOWED_LICENSES`) | **Reviewed entry in `tooling/license-exceptions.json`** (public-domain dedication, OSI-approved) (R13 Q8) | Port Shewchuk's four predicates ourselves (~1 agent-day) | M6a B0a |
| Q-MOD-K-7 | Booleans | **After M7**, `manifold-3d` (Apache-2.0) in a lazy worker (R10 §3.7, R13 Q5) | In base: +3 agent-days, ~205 kB gz WASM, needs closed manifolds | after M7 |
| Q-MOD-K-8 | Bevel in M6a | Edges, **1–3 segments**, corners of ≥ 3 beveled edges filled with a fan + warning; vertex bevel and patch corners later (R10 §4.3 over R13 §5.3's 1–8) | 1–8 segments with patch corners: more days and risk | M6a spec |
| Q-MOD-K-9 | Quad recovery on Make editable | **On request** (Quadrangulate); automatic only in M7's AI intake preset (R13 Q3) | Automatic: silently changes imported topology | M6a |
| Q-MOD-K-10 | Chunk size of mesh revisions | **~32 KiB**, confirmed after B7's benchmarks with real modeling sessions (R13 Q10) | Manifest size vs upload size per commit | M6a B7 |
| Q-MOD-K-11 | Imports above 200k triangles | **Read-only in component mode** until Reduce (M7 G-a) decimates them | — | M7 |
| Q-MOD-K-12 | Undo memory for meshes | **Byte budget**: chunks and journals reachable only from history ≤ 256 MB (journals ≤ 64 MB) by default, oldest steps dropped with a toast; GC roots derived from undo/redo entries, never pinned | Unbounded: hundreds of MB on morph-heavy imports (Seed-san head: 129 targets) | M6a B7 |
| Q-MOD-K-13 | Edited primitives whose original had `TANGENT` | **Refused at export with the reason**, unless the user ticks "Drop tangents" (renderers derive MikkTSpace); a generator arrives with mesh-wasm in M7 | Generate in M6a: a MikkTSpace WASM dependency for a case neither fixture has | M6a |
| Q-MOD-K-14 | Concurrent offline modeling of one mesh (M3) | `data.base` in schema v3 now; in M3 a forked peer keeps its head as a **conflicted copy** and notifies | Plain last-writer-wins: hours of work lost without a trace | M3 (field: M6a B0a) |

### G.4 Low-poly content, colour and export (R12)

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-LP-0 | Colour truth and default export | **Per-face palette slot**; export as a palette PNG with collapsed UVs by default, **forced for VRM** (MToon ignores vertex colours); `COLOR_0` and one-material-per-colour as options (R12 L2–L3, R16 Q-MOD-UI-9) | Vertex colours by default would vanish on Space avatars | M6a |
| Q-LP-1 | Default material preset | **Unlit palette** (props, OMOBA heroes); **toon palette** (MToon) for Space avatars once the MToon writer exists (M6b-stretch), unlit until then | — | M6b |
| Q-LP-2 | Budget presets | R12 §2.2 (hero 1,500–3,000 tris, warn > 5,000; NPC 300–1,000; handheld 100–600; small prop 50–300), **advisory** warnings, never export blockers; runtime limits (> 4 influences, > 256 joints) stay errors | Blocking budgets would fight imports and AI drafts | any time |
| Q-LP-7 | Ramp swatches and the decal region | **M6a-stretch**, otherwise M6c | — | M6a spec |
| Q-LP-11 | `COLOR_0` encoding | **float32 linear** (exact sRGB EOTF conversion) | unorm8 linear loses dark colours (≈ 2.7/255 error at sRGB 10), failing the 1/255 round-trip test | M6a |
| Q-LP-12 | Mitten hands mapped to which finger chain | **override of R14** (index): the **middle**-finger bones (R12 §8.1); pointing gestures then curl the mitten into a fist | Index chain: mittens stay open during pointing gestures | M6b spec |
| Q-LP-4 | OMOBA runtime palette swap (team colours) | Ask the OMOBA owner; exports stay one file per variant meanwhile | Game-side work | later |
| Q-LP-6 | Advisory mobile budgets in registry profiles | Propose upstream after AS-LP data | Registry change | after M6b |

### G.5 Characters from own models (M6b, R14)

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-SKIN-1 | Native character format and rest pose | **VRM 1.0**, bind = rest = VRM T-pose for humanoids, Apply Pose as Rest for A-pose models; **no VRM 0.x export** (R12 Q-LP-5) | VRM 0.x export: a second writer and humanoid map | M6b spec |
| Q-SKIN-2 | Licence gate on VRMs with `modification: prohibited` | **Block** Make editable, weight edits and Apply Pose as Rest, with the reason; animation-only exports stay allowed (R16 Q-MOD-UI-10) | Allow with acknowledgement for private use | M6a (Make editable) |
| Q-SKIN-3 | Licence preset for the user's own models in the export dialog | **Explicit choice required**, "Open — CC0" listed first | Pre-selected CC0: users publish without noticing | M6b |
| Q-SKIN-5 | Rigid/segmented skinning as a first-class style | **Yes**: "Auto (low-poly)" binds fitting islands rigidly; stiffness and rigidify cover smoother styles | — | M6b |
| Q-SKIN-6 | "Publish avatar to Ekza" (T3) before the animation kind (T1) | **Yes**: needs only the `studio-upload` scope (Q-EKZA-8) | T1 first needs a registry migration | after M6b |
| Q-SKIN-7 | Default skeleton preset | **Standard 33** (mitten hands); Lite 17, Core 21 and Full 52 offered (R12 Q-LP-3) | Full fingers by default: more joints to fit and weight | M6b spec |

### G.6 AI generation (M7, R15, ADR 0017)

| ID | Question | Default chosen | Impact if changed | Decide by |
|---|---|---|---|---|
| Q-GEN-1 | Who pays for generation | **Self-hosted (operator's env keys) and BYO key** until Ekza accounts exist (M4b); a hosted platform key only with M4b and written provider consent to their resale terms (R15 Q1) | Platform key earlier: Ekza pays per call and risks breaching Meshy's resale clauses | M7 spec |
| Q-GEN-2 | Default providers | **Tripo for characters** (native low-poly, VRM-named rig, no training on paid users' data), **Meshy for props** (cheapest clean low-poly) (R15 Q2) | One provider: simpler, but the contract is tested against one API only | M7 spec |
| Q-GEN-3 | Hunyuan3D | Open weights **off by default**, operator opt-in with a territory gate and the licence NOTICE; the cloud API as a later adapter (R15 Q3) | Default-on would exclude EU, UK and South Korea users | M7 G2 |
| Q-GEN-4 | Provider confirmations in writing | Ask Meshy and Tripo before any platform-key mode **and before BYO keys on a hosted Ekza gateway** (Tripo: keys may not be transferred); ask Meshy whether reduce/palette bake may alter its invisible AI marks (provenance records `aiMarksMayBeAltered` meanwhile) (R15 Q4, design review) | — | before G3 |
| Q-GEN-5 | Prompt text in exported provenance | **Hash only**; text on the user's opt-in (R15 Q5) | Text by default leaks prompts into published files | M7 |
| Q-GEN-6 | Registry changes | Propose a `prop` kind and AI-provenance fields with a Studio badge upstream after G1 (R15 Q6) | Ecosystem work in the registry repository | after G1 |
| Q-GEN-7 | Self-hosted GPU worker | Decided at G2 (Ekza infrastructure, rented GPU or the owner's machine); none before (R15 Q7) | — | G2 |
| Q-GEN-8 | Rig for generated humanoids | **Provider rig when it uses VRM bone naming** (Tripo rig `v3.0-20260909`, `spec: "vrm"`, verified 2026-10-18), otherwise Quick Rig + Auto (low-poly); geodesic voxel binding in G2 (R15 Q8, R14 Q-SKIN-8) | Own rig always: weaker on polygon soup until voxel binding exists | M7 spec |
| Q-GEN-9 | Provider tier of a generation | The user **attests paid tier** in the Generate panel (the API cannot tell); `ekza.provenance-free-tier` is an error for a T3 publish without the attestation | Warning only: free-tier outputs (owned by Tripo, CC BY at Meshy) could be published as the user's own | M7 spec |
| Q-GEN-10 | Gateway exposure | **Default deny**: mounted only with `GEN_GATEWAY_ENABLED=1` and an auth or a loopback-only bind; refuses to start with keys and no auth; server-side daily/monthly caps from env; the app's first CSP lands in G-b before BYO keys | Optional auth: any reachable server build with a key set spends the operator's credits | M7 spec |

## H. Naming: Ekza Studio and Ekza Hub (2026-10-19)

| ID | Decision | Owner choice | Notes |
|---|---|---|---|
| NAME-1 | The editor (this repository) is renamed from **Ekza Animator** to **Ekza Studio**: it now covers modeling, rigging, animation and the AI agent bridge. | Chosen by the owner | GitHub repository renamed to `ekza-space/ekza-studio`; the code rename runs after M6a and M-AI merge (TODO "Rename"). |
| NAME-2 | The publishing site currently called "Ekza Studio" (`studio.ekza.io`, `ekza-registry/web`) becomes **Ekza Hub**: create in Studio, publish in Hub. | Chosen by the owner | Production change: new domain `hub.ekza.io` with redirects from `studio.ekza.io`, registry UI branding, public docs and in-game links. Deploy only with the owner's OK. |
| NAME-3 | Research 05 advised against reusing "Ekza Studio" because of the registry UI; NAME-2 resolves that conflict instead of picking another editor name. | Superseded advice | Trademark check before a public launch still applies (research 05 §5). |

## I. M6a build deviations (2026-10-20)

M6a was built in sixteen packages (B0a, B0b, B1…B13 with B12a/B12b) on `m6a/<slug>` branches and integrated on
`m6a/integration` ([M6A-SPEC](M6A-SPEC.md) v1.1, §11.1 merge order). Each package recorded its interpretations in
`docs/wp-notes/m6a-*.md` with the reasoning and tests; the integration's are in
[`wp-notes/m6a-integration.md`](wp-notes/m6a-integration.md). IDs are `M6A-<package>-<n>`. All are **accepted as
built** (contract changes among them are in M6A-SPEC, marked "INT") unless the status says otherwise; the owner may
override any of them. Merged into `dev` on 2026-10-20; not tagged: `v0.3.0` waits for the owner's review below.

### Owner review items

| ID | Item | Built | Alternative |
|---|---|---|---|
| M6A-B0A (Decision requested), M6A-B9-14, M6A-INT-32 | **The M6a eager allowance** (§5.27: +20,480 B over the M2a baseline 845,267 B) | Option C as far as it goes: the Model-only operators, their menus and the component selection service load with their chunk on the first Model entry (M6A-INT-13, -14). The route is under the 900,000 B gate (see the integration notes' "Size") but about +50 kB over M2a, above options A (+40,960), B and C; `size-baseline.json` keeps `enforce: false` | Record the measured delta as the allowance and cut in M2b (IK operator bodies, the Dope Sheet controller, `camera-controls`, M2A-INT-4); or move the descriptors' param tables lazy too (a §2 change) |
| M6A-INT-33 | **Marquee with occlusion** (§5.27 ≤ 16 ms for 10k vertices, report-only) | Miss: 65 ms for 4,452 vertices in the editor bench including a frame (B6's package bench met its row); hover, enter-component-mode, drags and soft drags are within budget; a typical topology op end to end sits at the 16 ms line (extrude 100 faces 14.9 ms, loop on a 200-quad ring 16.2 ms) | M6b: a screen-space grid for marquee candidates (M6A-B6-20 named it), occlusion tested on the BVH in one batch |
| M6A-B5-4, -6, -15, -16 | **Bevel limits**: partial chamfers on folds leave non-planar strips (Mesh Check reports them); strips across a UV seam take one side's values; Roundness > 0.5 can cross profiles near corners; tents at sharp apexes | Built as §5.9 states, every case reported by Mesh Check and covered by `clamp.test.ts` | Limit the effective roundness per corner like the width clamp; a triangle cap for in-line vertices |
| M6A-B6-22, -26 | **Characters in Model**: ModelLoader's (not made editable) character meshes are not occluders for component picks; component hides of a character mesh are not drawn outside Model where ModelLoader draws it | Not built (props and made-editable meshes are complete) | A `PickOccluder` over ModelLoader's meshes in bind pose (M6b, when characters stay on screen while modeling) |
| M6A-B13-17 | Palette › Apply in object mode is one `mesh.paint` run per selected mesh (N steps) | Built | A whole-mesh form of `mesh.paint` or coalescing |
| B12a feel check | Capture case (b) (a digit right after `⌘E`) and Component vs Maya's per-component Normal (§1.2, §12.1) | As specified; the owner's feel check is open | Per the owner |
| §11.3 | **Owner demo script** | Not run by the owner yet; its steps are covered by E2E-MOD-01, -04, -05, -06, -10, -11, -12, -17, -18 and AS-LP-S | — |
| B8 hand-over (m6a-mesh-io, open items 1–2) | **glTF validator and compressed meshes in the app**: `services.validate` is `null` in the browser (the validator worker is not wired), and Make editable refuses Draco/meshopt meshes because editor-core has no decoder service | Not wired; io's half is built and tested with an injected validator and decoder | Wire the validator worker (and decide whether animation exports validate too) and add a `decodeMesh` service field (a contract change) — M6b or a fix round |
| B4/B5 hand-over | Local symmetry helpers in B4 and B5 instead of B2's maps (M6A-B4-2, M6A-B5-7) | Kept: same semantics, verified on B2's maps | A refactor onto B2's helpers in M6b |
| B13 hand-over | Create › New model menu item | Not built: the start card shows on any empty Model scene | Add the menu item |

### Decisions copied from the packages (accepted as built)

| ID | Decision | Where |
|---|---|---|
| M6A-B13-16 | Swatch ids are derived for every palette (`derivedId('swatch', 'palette.swatch', [palette], '', slot)`), not only the default one; slots are never reused, so (palette, slot) is a stable key and two peers adding the same slot converge | `editor-core/src/operators/builtin/palette.ts` |
| M6A-B13-17 | Above (owner item) | `PaletteView.apply` |
| M6A-B13-18 | A swatch paints only meshes of its own palette (Paint Colour, Palette › Apply and, since INT, Assign Colour without a slot, M6A-INT-24) | `paintRules.ts`, `operators/builtin/mesh/index.ts` |
| M6A-B13-19 | `mesh.create.template`'s `height` is nullable (auto: a body created into Humanoid guides takes their height) | `templates.ts` |
| M6A-B13-20 | Getting started ticks ② to ⑥ for the session | `modelProgress.ts` |
| M6A-B13-21 | Static export roots hold a mesh in their subtree (mesh-less groups are not roots) | `exportModel.ts` |

### Integration decisions (M6a)

| # | What | Decision | Where |
|---|---|---|---|
| M6A-INT-1, -2 | Merge order; READY/`test.fixme` gates | §11.1 order, `--no-ff`; every gate is a failure; only stretch items stay `test.fixme` | integration notes |
| M6A-INT-3, -4 | E2E-MOD-01/-02 vs §5.8 | Rows amended: `Esc` ends the session before the one undo; the card names `⌘E` as its tooltip/header | M6A-SPEC §10.1 |
| M6A-INT-13, -14 | Size | Model operators and the selection service load lazily | `modelOpsChunk.ts`, `modelManifest.ts` |
| M6A-INT-16 | Merge to Center under symmetry merged both arms' caps into one point | Fixed (groups by the mirror plane) | `mesh-core/src/ops/merge` |
| M6A-INT-17 | Test API | `setExpression`; additive `pixels`, `displayNodeWorld`, `displayModel` | M6A-SPEC §4.8 |
| M6A-INT-18…25 | Package hand-overs | Separate names and Combine's palette action; mirror helpers +0; `PANEL` kinds; one `MeshLayerHost`; the anim-core −0 flake; the pixel probe; Assign Colour's active swatch; `PickOptions.wire` | integration notes |
| M6A-INT-26 | Meshes on one palette wrote one material each | Fixed: one material per palette (one per used swatch with material-per-colour) | `exportModel.ts` |
| M6A-INT-28…30 | Scenario readings (E2E-MOD-15 tapered legs, E2E-MOD-31's "original file", the AS-LP-S twin) | As in the integration notes | `apps/web/e2e` |

## J. M6a acceptance fix round 1 (on `dev`, 2026-10-20)

The M6a acceptance round on `dev` (`c0e402f`: the Model workspace driven by hand in real Chrome) found one blocker,
four major and four minor defects. Fixed ones have regression tests that fail without the fix (the blocker's e2e test
was checked against the unfixed build). New e2e spec `apps/web/e2e/m6a-r1-fixes.spec.ts`.

| # | What | Decision | Where |
|---|---|---|---|
| M6A-INT-34 | **Blocker**: a moved mesh (Channel Box, W drag, redo, Combine, a moved ✎ mesh) kept drawing at its old transform while picking, the manipulator, `F` and export used the new one. The scene's `matrixWorldAutoUpdate` is off and SceneSync's world pass runs only for character poses; mesh-view roots (`matrixAutoUpdate = false`) only flagged `matrixWorldNeedsUpdate` | **Fixed**: `ViewportManager.render` updates every mesh host's world matrices before drawing dirty panes | `viewport/src/manager/ViewportManager.ts`; e2e (pixels before/after the move and after undo) |
| M6A-INT-35 | **Major**: Combine moved the result's object origin to the bounds centre, so Object X mirrored about x = 0.253 (unmatched 140/140) | **Fixed**: `mesh.combine`'s default `pivot` is `'first'` (the lead's placement); `'center'` and `'origin'` stay | `mesh-core/src/ops/combine/`; M6A-SPEC §5.13; `setops.test.ts` |
| M6A-INT-36 | **Major**: double-click loop selection worked only with Q: with W/E/R the first click put the manipulator on the edge and the second press hit it | **Fixed**: the last component click is shared by every tool's Model pointer; a press completing a double-click goes to the manipulator as usual, and when it is released without moving, selection takes it (the loop); a drag still drags (`DoubleClickPress`, so a quick click-then-drag of a handle is kept). A double-click on an edge that was already selected before the first click still lands on its manipulator, as before | `viewport/src/tools/model/select/runtime.ts`, `selectTool.ts`, `transformTool.ts`; e2e (W, E, R) |
| M6A-INT-37 | **Major**: the status-line Symmetry select stayed disabled after a cube was created (and after File › Open) | **Fixed**: status-line poll reasons re-read on every session change and every mesh/group write | `editor/src/shell/statusGroups.tsx`; e2e |
| M6A-INT-38 | **Major**: under symmetry the one-sided Bridge (arm onto the +X hole) could not be selected: Select › Edge Loop stored the mirrored −X loop, and Bridge saw three loops | **Fixed** per §5.6 ("additive gestures store the picked side only"): walkers (loop, ring, grow, shrink, convert, border, shell, the loop table) store the part of their result reachable from the stored picks; an additive pick of a derived partner stores nothing. Ops, the HUD and the drawing still read the expanded set | `editor-core/src/operators/builtin/selectMesh.ts`, `selection/component/service.ts`; `select/operators.test.ts` |
| M6A-INT-39 | Minor: in Model the Channel Box kept Animate's control selection (Polybot "Head") | **Fixed**: in Model the selected (or hilited) mesh/group object leads | `editor/src/panels/channel-box/ChannelBoxPanel.tsx`; e2e |
| M6A-INT-40 | Minor: Mesh Check docked with zero height | **Fixed**: a click on the tab of a group collapsed to its tab bar opens it by 220 px (the default stays collapsed, §8.2) | `editor/src/shell/WorkspaceHost.tsx`; e2e |
| M6A-INT-41 | Minor: symmetry lost on Save → Open | **Fixed (default derived)**: symmetry stays session state (§5.14), but a load or open gives meshes directly in a Humanoid template group Object X again unless the session already has an entry; other meshes stay off | `editor-core/src/session/repair.ts` (`templateSymmetry`), `keeper.ts`, `app/kernel.ts`; `select/operators.test.ts` |
| M6A-INT-42 | Minor UI (a): the Handheld template's card showed the humanoid args; (e): Insert Edge Loop showed Number of Loops in Relative mode | **Fixed**: the Last-op card shows the fields that apply to the recorded args (templates by kind; Insert Edge Loop: weight for Relative/Equal, Number of Loops for Multiple). Adjusts still coerce against every param | `editor-core/src/operators/builtin/lastop.ts`, `lastopEngine.ts`; `templates.test.ts`, `kernel-ops.test.ts` |
| M6A-INT-43 | Minor UI (c): "Mirror…" and "Set Normal Angle…" opened no dialog | **Fixed**: labels without the ellipsis (they run at once; args in the Last-op card) | `modelMenus.ts`, `editor/src/overlays/menus/tools.ts`; M6A-SPEC §8.3 tables |

**Deferred** (recorded in [TODO](../TODO.md); no regression, each needs more than a fix round):

| # | What | Why deferred | Next step |
|---|---|---|---|
| M6A-INT-44 | (b) Offset Edge Loop without a selection is disabled ("Select components first") | Needs a drag tool like Insert Edge Loop (a new `ToolDef`, hover preview, symmetric pointer rule) | A B12b-style tool in M6b's first fix round |
| M6A-INT-45 | (d) Static GLB export shows "Validator not run" | `services.validate` is `null` in the browser (owner item "glTF validator … in the app" in §I) | Wire the validator worker (lazy chunk; size budget) |
| M6A-INT-46 | (f) `F` in edge mode right after a Bevel frames the bevel handle very close | The framing reads the post-bevel component selection (tiny new edges); needs a framing rule for a live topology-tool session | Frame the hilited mesh when the selection's bounds are below a minimum size |
| M6A-INT-47 | (g) The quad layout's large HUD covers the model in each pane | A layout/design decision (compact HUD per pane size) | Compact HUD below a pane size, or HUD in the maximized pane only |
