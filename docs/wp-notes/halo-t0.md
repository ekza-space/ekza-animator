# Halo T0 — Platform: WebKit compatibility and iOS services: build notes

Branch `halo/t0-platform` from `dev` (`959c587b`; `dev` merged at `d5d123c3` (TM-4), `7af76d0d` and `979d9baa`, the last two docs only). Scope:
[STUDIO-TOUCH-SPEC](../STUDIO-TOUCH-SPEC.md) §21 row T0, with §16.4 (session overrides), §17 (storage card), §19 S1,
S8–S12 and S24, §20.3 items 15–16, §20.4 (`SaveTicket`, `FileService`, `PrefsStore`) and §20.7 (the `chrome-touch` and
`webkit-ipad` projects, ha-00). Decision IDs are `ST-T0-<n>` (DECISIONS-OPEN §P).

## What shipped

| Part | Where |
|---|---|
| **Effective-preferences layer**: `overridePrefs(app.prefs, 'device' \| 'shell', patch) → Disposer`; readers (`getState`, `subscribe`) see base ⊕ device ⊕ shell; `savePrefs` writes only the base (`basePrefs`, a registry in `persist.ts`, so the layer itself stays out of the eager bundle); deep patches; a write under an override lands in the base, a write that carries the shown value back keeps the base's own; the layer installs itself on the store at the first override and leaves it with the last; the legacy-id migration (TM-1, TM-4) is untouched (it runs on load) | `editor-core/src/prefs/overrides.ts` (new), `prefs/persist.ts` (`savePrefs`, `basePrefs`, `rememberBasePrefs`), two export lines in `editor-core/src/index.ts` |
| **Memory profile**: decided once per page at the GL host's first render, before the context exists. iOS WebKit: DPR range `[1, 1.5]` above 4 MP at the native ratio, MSAA off above 5 MP, textures capped at 2048 at GPU upload, `{ modeling: { undoBudgetMB: 96, journalBudgetMB: 24 } }` in the `device` layer (laid from a small lazy chunk right after the decision; `memoryProfileApplied(app)` resolves once it is), triangle warning 60k / limit 200k (for intake surfaces to read). Elsewhere `standard` (today's `[1, 2]`, MSAA on, nothing else). The GL host names it (`data-memory-profile`). e2e builds force either with `?memoryProfile=ios\|standard` | `editor/src/host/memoryProfile.ts` (new), `editor/src/host/deviceOverride.ts` (new, the lazy chunk), `editor/src/gl/GLHost.tsx` |
| **Texture cap at GPU upload**: lowers `renderer.capabilities.maxTextureSize`; three.js then draws a larger image smaller while it uploads it; the image, the document and the exports keep their bytes | `viewport/src/gl/textureCap.ts` (new), one export line in `viewport/src/index.ts` |
| **SaveTicket** (§20.4): `ready`, `state`, `deliver()` (share through `canShare` + `share({files})` where the platform prefers it, else `<a download>`; ~10 s share timeout → download; a dismissed sheet leaves the ticket ready; a refused share → download); the page's save queue; the browser's share platform. A lazy chunk: only iOS pages and `save()` callers load it | `editor/src/services/saveTicket.ts` (new) |
| **FileService**: `download()` immediate off iOS (as before); on iOS WebKit with Web Share for files (`sharePreferred()`) it loads the ticket chunk, offers a ticket to the page's save queue and shows the save prompt (when either chunk fails, the file downloads). `save(file) → SaveTicket` (synchronous; the ticket is 'preparing' until its chunk and its bytes are there) for callers with their own button (Halo's Share, T11). The e2e export recorder sees every file when its bytes are ready. `hasSaveTickets(files)` until the contract carries `save` | `editor/src/services/files.ts` |
| **Save prompt**: one card at the bottom centre for the oldest waiting file — "*name* is ready · Save to Files · ✕"; "Preparing *name*…" while baking; after a share "Shared · iPad does not confirm where it went", after a download "Saved to Downloads"; 44 pt targets, 16 px text. Renders in-tree when a host mounts `<SavePrompt queue>`, else the file service mounts it in its own root on `<body>` once per page | `editor/src/host/SavePrompt.tsx` (new) |
| **File types**: `sniffFileKind(bytes)` (`vrm`, `vrma`, `glb`, `gltf`, `project` = zip whose first entry is `manifest.json`, `projectJson`, `zip`, `json`, `unknown`), `nameForKind(name, kind)` (the name a sniffed file opens under), `UNSUPPORTED_FILE_TEXT`, `isIosWebKit()` (iPhone/iPad UA, or "Macintosh" with touch points: iPadOS Safari reports MacIntel), `pickerAccept(accept)` (undefined on iOS) | `editor/src/services/fileTypes.ts` (new) |
| **`accept` policy** in the four pickers (one-line edits) | `editor/src/dialogs/OpenDialog.tsx`, `autorig/src/steps/model/ModelStep.tsx`, `autorig/src/shell/MenuBody.tsx`, `autorig/src/steps/animations/AnimationsStep.tsx`; `pickerAccept` exported from `@ekza-studio/editor/host` (one line in `editor/src/host/index.ts`) |
| **Autosave on iOS**: the store keeps the page's own snapshot through a clean end (save, new, open, a clean unload) — the next write replaces it; after a reload it is an orphan like any other (Recovery in Pro, Continue in Halo). `requestPersistentStorage()` for the storage card (S11, D12) | `editor/src/services/autosave.ts` |
| **Web manifest** (S12): `id`/`start_url` `/app`, `scope` `/`, `display: standalone`, theme `#1b1c1f`; icons 192/512/maskable 512 and the 180 px `apple-touch-icon.png`, rendered from the app glyph (`app/icon.svg`). Not linked from the root layout (a unit test checks it); the `/app` segment's layout links it (T2) | `apps/web/public/manifest.webmanifest`, `public/icons/*`, `public/apple-touch-icon.png`, `apps/web/test/halo-manifest.test.ts` |
| **Playwright projects** `chrome-touch` (Chrome, touch, 1194 × 834 @2x) and `webkit-ipad` (`devices['iPad Pro 11 landscape']`; portrait through `test.use`), both on the `ha-*` family only. The WebKit executable: `EKZA_WEBKIT_PATH`, else Playwright's own build, else the newest installed `webkit-<rev>/pw_run.sh` (nothing is downloaded). The default local run = `chrome` + `chrome-touch` + `webkit-ipad` (`EKZA_E2E_WEBKIT=0` leaves WebKit out); CI keeps SwiftShader alone | `apps/web/playwright.config.ts` |
| **ha-00** (7 tests × 3 projects, project-specific ones skip elsewhere): `/editor` and `/autorig` boot with no page error, render (a drawn Polybot, the Auto-Rig stage) and name their profile; WebKit portrait; a 13-inch iPad (1366 × 1024 @2x) gets DPR 1.5 and no MSAA; the device override never reaches stored prefs; pickers follow the accept policy; on the iPad a saved file waits for the save prompt and leaves on a tap through a mocked share (elsewhere it downloads); export bytes identical with the profile on and off with a 4096-wide texture (Chrome, the cap proven by three.js's resize warning) | `apps/web/e2e/ha-00-platform.spec.ts` |
| Unit tests | `editor-core/test/kernel/prefs-overrides.test.ts` (9), `editor/test/halo-t0-files.test.tsx` (18: sniffing on the fixtures and synthetic bytes, names, accept policy, SaveTicket iOS / non-iOS / dismissed / refused / timeout / baking / failed, the service, the prompt), `editor/test/halo-t0-memory.test.tsx` (7: decisions per iPad size, device facts, applied once, never stored, the GL context from the profile), `editor/test/halo-t0-autosave.test.ts` (3), `viewport/test/halo-t0-texture-cap.test.ts` (3, a real three.js upload), `apps/web/test/halo-manifest.test.ts` (3) |

## Exit test (§21 T0)

| Exit test | Result |
|---|---|
| `/editor` and `/autorig` boot and render on `webkit-ipad` | **green**: ha-00 on `webkit-ipad` — `/editor` (landscape and portrait) and `/autorig` boot with no page error, render (a drawn Polybot; the Auto-Rig stage) and name the `ios` profile; a 13-inch iPad gets DPR 1.5 and no MSAA; the save prompt and the device override hold. 6 tests (the export test is Chrome-only) |
| Unit tests: `SaveTicket`, sniffing, memory profile, override layer | **green**: 9 + 19 + 7 + 3 + 3 + 3 tests (files above) |
| Export bytes identical with the profile on and off | **green**: ha-00 on `chrome` — the same baked VRM (a 4096 × 256 texture, a keyed wave) has the same SHA-256 with `?memoryProfile=ios` and `standard`; the `ios` run's GPU copy was resized (three.js's warning `from (4096x256) to (2048x128)`), the `standard` run's was not |

**Gate** `EKZA_E2E_PORT=3162 pnpm run ci` at `5d72bcaa` (dev `7af76d0d` merged; the later dev merge `979d9baa` is docs only): **exit 0**.
format, lint, typecheck, deps, fixtures, licences green; unit tests: editor-core 1,703, editor 644 (+1 skipped), viewport
284 (+1), autorig 112, io 381, headless 223, curve-editor 209 (+3), web 87 and the rest, all green; e2e **380 passed,
30 skipped, 0 failed, 0 flaky** in 3.5 min (`chrome` 370, `chrome-touch` 4, `webkit-ipad` 6).

| Route | dev (`d5d123c3`) | this branch | Δ | Gate |
|---|---:|---:|---:|---:|
| `/editor` | 891,790 B | **893,421 B** | **+1,631 B** | 900,000 B (headroom 6,579 B) |
| `/autorig` | 652,528 B | **654,180 B** | **+1,652 B** | 660,000 B (headroom 5,820 B) |

The first cut was +2,188 B / +2,200 B; the ticket code, the share platform, the save prompt and the override layer were
then moved into lazy chunks (ST-T0-10). Earlier gate runs on this branch failed only on timing under a machine load of
80–175 (other agents' gates): Chrome specs `ar-as-01` (a 300 ms budget), `m2a-01`, `m2a-25`, the M2a demo walkthrough,
unit tests with screenshot timeouts, and WebKit losing a fresh WebGL context while every Chrome worker used the GPU;
each passed when rerun alone. The `webkit-ipad` project therefore runs one worker with one retry (none was needed in
the green run).

## Decisions and deviations

The rows are in [DECISIONS-OPEN §P](../DECISIONS-OPEN.md) as `ST-T0-1` … `ST-T0-10`; in short:

| ID | Decision |
|---|---|
| ST-T0-1 | `overridePrefs(app.prefs, layer, patch)` as a function until T2 types `app.prefs.override`; deep patches; writes under an override land in the base; a carried-back shown value keeps the base |
| ST-T0-2 | iOS WebKit by user agent + touch points; megapixels at the native ratio over the larger of screen and window; 96 MB undo (journal bytes included) + 24 MB journal cap; decided at the GL host's first render; `?memoryProfile=` in e2e builds |
| ST-T0-3 | The texture cap lowers `renderer.capabilities.maxTextureSize`; three.js resizes at upload only; KTX2 and data textures are not resized |
| ST-T0-4 | iOS downloads become tickets for the host's save prompt (its own `<body>` root unless a host renders it in-tree); 10 s share timeout → Downloads; a dismissed sheet keeps the ticket |
| ST-T0-5 | On iOS the autosave store keeps the page's own snapshot through every clean end; the flush on `pagehide` / `visibilitychange` is T3's line patch |
| ST-T0-6 | `pickerAccept` leaves `accept` out on iOS in the four model/project/animation pickers; the image-plane picker keeps its list; routing Pro's pipeline through the sniffer is a patch for `shell/files.ts` |
| ST-T0-7 | The default local Playwright run adds `chrome-touch` and `webkit-ipad` (ha-* only); WebKit falls back to the newest installed build (2370 here; Playwright 1.63 expects 2359), never downloaded; `EKZA_WEBKIT_PATH`, `EKZA_E2E_WEBKIT=0`; CI unchanged |
| ST-T0-8 | Manifest `id`/`start_url` `/app`, `scope` `/`, `display: standalone`; icons from the app glyph; linked from `/app` only |
| ST-T0-9 | Three barrel edits outside the row (`editor-core`, `viewport`, `editor/host` index files) and one new file beside the row's (`host/deviceOverride.ts`) |
| ST-T0-10 | Bundle: `/editor` +1,631 B, `/autorig` +1,652 B over dev; no ST-B1 allowance was set for T0 — owner / T12 |

Deviations from the T0 row:
- **Barrel lines** (ST-T0-9): the row's modules are used across packages (GLHost → viewport's cap, the memory profile → editor-core's override layer, Auto-Rig → `pickerAccept`), which needs one export statement in each package's barrel. They are additive.
- **The memory profile is read by the GL host, not by `StudioHost`** (§20.3 item 15 says "read by StudioHost before GLHost mounts"): `StudioHost.tsx` is outside every row; the GL host decides it at its first render, which is still before its context and on every route. Moving the call into `boot()` is an optional integration patch below.
- **The save prompt mounts itself** (a root on `<body>`, once per page) instead of being rendered by `StudioHost`, for the same reason; a host that renders `<SavePrompt queue>` in its tree takes over (the queue counts attached prompts).
- **The device override is applied a chunk-load later** than the decision (to keep the override layer out of the eager bundle): before any user action, and the budgets only matter once 96 MB of history exist.
- **Playwright's own WebKit build (2359) is not installed** on this machine; the config launches the installed 2370 (as the design prototypes did). `webkit-ipad` is desktop WebKit with an iPad user agent: it checks compatibility only.

## Patches needed from other work packages

Line patches for files outside the T0 row; nothing in T0 depends on them to work.

| Owner | File | Patch |
|---|---|---|
| T2 | `editor-core/src/types.ts` | `FileService` gains `save(file: SaveFile): SaveTicket`; move the `SaveFile`, `SaveTicket`, `SaveTicketState`, `SaveDelivery` interfaces from `editor/src/services/saveTicket.ts` into the contract (that file then imports them; `hasSaveTickets` can go). `EditorApp.prefs` becomes `StoreApi<Prefs> & { override(layer: PrefsLayer, patch: PrefsPatch): Disposer }` |
| T2 | `editor-core/src/app/kernel.ts` | after the prefs store is created: `Object.assign(prefs, { override: (layer, patch) => overridePrefs(prefs, layer, patch) })` (the §20.4 `app.prefs.override`; `get()` is `getState()`, already effective) |
| T2 | `apps/web/app/(studio)/app/layout.tsx` | `metadata`: `manifest: '/manifest.webmanifest'`, `appleWebApp: { capable: true, title: 'Ekza Studio', statusBarStyle: 'black-translucent' }`, `icons: { apple: '/apple-touch-icon.png' }`; `viewport`: `{ viewportFit: 'cover', themeColor: '#1b1c1f', colorScheme: 'dark' }` — `/app` only (S12) |
| T2 (optional) | `editor/src/test-api/params.ts` | move the e2e switch `memoryProfile` into `EditorParams` (today `host/memoryProfile.ts` reads it from the URL when `params.e2e`) |
| T3 | `editor/src/shell/autosave.ts` | S24: in `startShellAutosave`, flush on `pagehide` and on `visibilitychange` to hidden: `const flush = (): void => { void controller.writeNow().catch(() => {}); }` with both listeners and their disposers (iPad Safari never shows `beforeunload`'s prompt). The clean on `beforeunload` can stay: on iOS the store keeps the page's own snapshot anyway |
| integration (unowned `editor/src/shell/files.ts`) | `openFile` | S10, sniff before resolving: `const routed = nameForKind(name, sniffFileKind(bytes));` then `resolveImporter(app.importers, routed, bytes)`, and `throw new Error(UNSUPPORTED_FILE_TEXT)` when none takes it (today: "No importer for …"); pass `routed` on as the file's name |
| integration (unowned `editor/src/host/StudioHost.tsx`, optional) | `ReadyHost` | `<SavePrompt queue={pageSaveQueue()} />` after `<Toaster …/>` renders the prompt in the host's tree (the service's own `<body>` root then never mounts); a `boot()`-time `memoryProfileOf({ app, params })` right after the app is created would apply the device override before any shell renders (today: the GL host's first render, still before any user action) |
| T11 / Pro import (intake owners) | intake | read `memoryProfileOf(host).triangles` (null off iOS): warn above `warn`, refuse above `limit` with *"Too heavy for this iPad · open it on a computer"* (§15.0); Auto-Rig already gates at the same 60k / 200k |
| T11 | Share, Home | `files.save({ name, mime, bytes: bakePromise })` and deliver from the button's tap (`hasSaveTickets` until T2's contract patch); the storage card calls `requestPersistentStorage()`; Home's intake uses `sniffFileKind` / `nameForKind` |
| T7 | Rec | `overridePrefs(app.prefs, 'shell', { autoKey })`, disposed on unmount (unit-tested: Pro's stored Auto Key is never written) |
| T1 | `apps/web/playwright.config.ts` (T0's) | when the ported touch helpers land, widen the touch projects' `testMatch` from `HALO_FAMILY` to the `ha-*` and `ar-*` families (§20.7) |
