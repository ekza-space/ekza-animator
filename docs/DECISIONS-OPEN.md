# Open owner decisions — defaults chosen

Status: 2026-10-18, M1 integrated (rev. 4; section E gained the integration decisions, the acceptance rounds, the
WP-10 e2e and budget decisions and the consolidated build deviations of WP-1…WP-9). Every item below has a **default chosen** so that work can
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
| Q-MOD-1 | Modeling | **Not in the MVP.** Cheap path kept: `SplineSet` shared by control shapes and future splines, `TableDef` and tool registries, component-capable selection (ADR 0004, ADR 0008). | — | M6 |
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
| Q-UI-1 | Model workspace tab | **Hidden** in the MVP (R09 suggested visible-but-disabled). | Cosmetic. | M2c |
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
