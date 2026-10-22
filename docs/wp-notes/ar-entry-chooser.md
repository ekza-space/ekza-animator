# Auto-Rig D2 — entry chooser, remembered choice and Studio's switches: build notes

Branch `autorig/entry-chooser` (from `autorig/mvp` at `04e2c54`, D1's `autorig/studio-host` merged at `e1e72e0`).
Scope: [AUTORIG-SPEC §10 D2](../AUTORIG-SPEC.md#d2--entry-chooser) with §3.2 (the chooser), §3.3 (the remembered
choice), §3.4 (Studio's switches, the first-run answer), §5.2 (the Cube Lad credit) and §7.0 (D2's `/editor`
allowance). Decision IDs below are `AR-D2-<n>`. The work package prompt named these notes
`autorig-entry-chooser.md`; the spec's D2 Dirs name `ar-entry-chooser.md`, which this file follows (as D0 and D1 did).

## What shipped

| Part | Where |
|---|---|
| **Chooser** at `/`: heading, two cards — Auto-Rig first (the newcomer path), Studio second — as plain `<a href>` links (`data-entry`), so they work without JavaScript, open in new tabs and are keyboard-reachable; stacked below 720 px (Auto-Rig on top), side by side above; the privacy line; the credits (now with the Cube Lad, §5.2) and the third-party notice link kept | `apps/web/app/page.tsx` |
| **Remembered choice**: `localStorage['ekza-studio:entry:v1'] = {"choice": "autorig" \| "studio", "at": <ms>}`; parse/read/write/forget with every access in `try`/`catch` (blocked, throwing or malformed storage = Ask); `entryHref` (a card or the redirect keeps the page's query, `chooser` dropped); `redirectHref` (the rule); `REDIRECT_SCRIPT` (the same rule as a self-contained inline script) | `apps/web/app/entry.ts` |
| **Redirect**: `REDIRECT_SCRIPT` is an inline `<script>` at the top of `/`, run while the page is parsed (before the first paint): a remembered choice and no `?chooser=1` → `location.replace('/autorig' or '/editor' + the query)`. The chooser is rendered underneath, so a blocked script or no JavaScript still shows it. A back/forward visit never redirects (Navigation Timing `back_forward`; no history trap). Deep links never redirect (only `/` carries the script) | `apps/web/app/page.tsx`, `entry.ts` |
| **`EntryChooser`** (client island): *Remember my choice on this device* — disabled until hydrated (it could remember nothing without JS), ticked when a choice is remembered (`/?chooser=1`), unticking forgets at once; a capture-phase click/auxclick listener remembers the followed card while ticked; the cards' `href` get the page's query once hydrated (e2e switches travel to the app) | `apps/web/app/EntryChooser.tsx` |
| **File › Auto-Rig This Model…** (`shell.file.autoRig`, group `export`) and **Help › Switch to Auto-Rig** (`shell.help.autoRig`, the operator's label) run **`shell.autoRig {subject?, remember?}`**, a small eager operator of the Studio shell registered with its menu items: its `prepare` awaits the small lazy switch chunk (below; prefetched when the menu opened), then calls the host's navigation port directly — `hostNavigation(app).go({to: 'autorig', from: 'studio', subject?})`. The Rig & Skin chunk is never fetched (E2E-AR-02). Both items hand the subject over when there is one (§3.4's shared row). File's item passes `subject: true`, which is disabled ("Nothing to auto-rig") only when the document has no mesh and no character (§3.4's enablement); Help's is always enabled. Not undoable, `internal` (the palette lists `autorig.navigate`); without a port (a harness) it does nothing | `packages/editor/src/shell/menuItems.ts` |
| **Subject** (§3.4): the scene meshes under the selected objects — a selected group gives its descendant meshes (Ctrl+G groups, an import's group node, as `char.fromModel` reads its objects) —, else the active character, else every visible scene mesh (neither the mesh nor any ancestor hidden, as `objectsDrawnIn` reads it), else null. One depth-first walk down `store.query.childrenOf` (which breaks parent cycles), so the meshes come in the Outliner's order (AR-D2-3, AR-D2-4, AR-D2-11) | `packages/editor/src/shell/autoRigSwitch.ts` (`autoRigSubject`, lazy) |
| **Lazy switch chunk** `shell/autoRigSwitch.ts` (625 B gzip): the subject rule and `writeEntryChoice` (re-exported from `dialogs/entryChoice`). The operator's poll — run when a menu showing one of the items opens — starts its import (intent prefetch, M2A-SPEC §5.21.2), so a menu click does not wait for it; if it cannot load, the switch still happens, without a subject or the remembered choice (AR-D2-11) | `autoRigSwitch.ts`, `menuItems.ts` |
| **First-run third answer** "Auto-rig a character (simple mode)": the button reads "Start Auto-Rig"; with it selected, "Open this mode next time" (uncontrolled checkbox) appears; the button runs `shell.autoRig {remember}` (same page, document kept), which writes the remembered choice only when ticked. Closing the dialog otherwise keeps Studio (AR-D2-5) | `packages/editor/src/dialogs/FirstRunDialog.tsx` |
| **Preferences › Start in: Ask / Auto-Rig / Studio** — the landing's record read on open, written on change, forgotten by Ask; after a change the select shows what is stored (read back), so blocked storage shows Ask and a failed write keeps the old choice | `packages/editor/src/dialogs/PreferencesDialog.tsx`, `dialogs/entryChoice.ts` |

## Decisions and deviations

| ID | Decision | Why / evidence |
|---|---|---|
| AR-D2-1 | *Remember* is **unticked by default** (the wireframe draws it ticked) | AS-AR-8 says "tick *Remember*, pick Auto-Rig"; a newcomer who tries Studio once should not lose the chooser silently. The owner may flip it: one `useState` default in `EntryChooser.tsx` |
| AR-D2-2 | The redirect is an **inline script** generated from `entry.ts` (`REDIRECT_SCRIPT`), not the client island | it runs while `/` is parsed, before React or any chunk, so the chooser never flashes; the island alone could redirect only after hydration. `entry-redirect.test.ts` runs the script in a VM against `redirectHref` over the same cases (blocked storage, malformed records, `chooser=0/1`, back/forward, no Navigation Timing). 309 B gzip inline |
| AR-D2-3 | §3.4's "else the only character" is the **active character**: the session keeps one active whenever a character exists (`repairSession`), so the rule reads *selected scene meshes, else the active character, else every visible scene mesh*. With several characters and none selected, the active one is the subject | the invariant makes the "only character" branch unreachable; checked in `ar-entry-switches.test.ts` |
| AR-D2-4 | ~~"Visible" = neither the mesh nor its parent is hidden~~ — **superseded in fix round 1**: visible = neither the mesh nor **any ancestor** is hidden, as `objectsDrawnIn` reads it, without importing it (the walk down the hierarchy carries the hidden flag) | importing the Model operators chunk's `objectsDrawnIn` put the Model operators and the component selection service into `/editor`'s initial route (+13 kB, measured in the first cut); the own walk in the lazy switch chunk costs `/editor` nothing (AR-D2-11) |
| AR-D2-5 | The first-run answer switches **only from its button**; Esc or the close button marks the first run done and keeps Studio. Studio's start workspace (`lastWorkspace`) becomes Animate with the Auto-Rig answer | a dismissal is not a request to leave Studio; Studio still needs a start workspace for its next page load |
| AR-D2-6 | **Start in is not a `Prefs` field**: it reads and writes the landing's `localStorage` record (so no `PREF_KEYS` row in `host/operators.ts`, which AR-D1-4 anticipated) | `/` reads the choice before any app code loads, and `Prefs` is a closed contract type (D0). Studio's copy of the record code is `dialogs/entryChoice.ts`; `apps/web/test/entry-contract.test.ts` holds it (used by Preferences and, through `shell/autoRigSwitch.ts`, by the first-run answer) and the landing's `entry.ts` to one key and one record |
| AR-D2-7 | ~~The first-run dialog writes the record inline~~ — **superseded in fix round 1**: the dialog passes `remember` to `shell.autoRig`, whose lazy switch chunk writes it with Preferences' `writeEntryChoice` (one copy of the record code in Studio) | the inline line cost the `FIRST_VISIT` chunk ≈ 70 B and the same line eager ≈ 65 B (measured); in the lazy chunk it costs `/editor` nothing |
| AR-D2-8 | The cards **carry the page's query** (`/?e2e=1` → `/autorig?e2e=1`), as the redirect does; `chooser` is dropped | the host keeps the page's switches across shells (`routeHref`, AR-D1); e2e specs reach the app with the test API |
| AR-D2-9 | The wireframe's **"Source code"** link is not shown | no public repository URL is recorded in the docs yet; one line in `page.tsx` when there is |
| AR-D2-10 | ~~`/editor` delta +490 B, 42 B over D2's 448 B, for D7's approval~~ — **resolved in fix round 1 without D7's approval: +414 B ≤ 448 B** (sizes below; no bytes of D1's allowance taken). The fix is §7.0 rule 5 (move code lazy): AR-D2-11 | measured on the fix-round head: `/editor` 896,741 B = eager 889,763 B + First-run 6,978 B |
| AR-D2-11 | **The subject rule and the remembered-choice write are a small lazy chunk** (`shell/autoRigSwitch.ts`, 625 B gzip), awaited by `shell.autoRig` before it calls the port and **prefetched by the operator's poll**, i.e. when a menu showing File › Auto-Rig This Model… or Help › Switch to Auto-Rig opens. **Deviation from §3.4's "no chunk load before the push"** in its letter, kept in its intent: the chunk is never the Rig & Skin (`rig-workspace`) chunk (E2E-AR-02 asserts it is not fetched), it is normally already loaded when the item is clicked (the menu had to open), and only the first-run answer's button fetches it on the click (≈ 0.6 kB, one request). If it fails to load (offline after a deploy), the switch still happens, without a subject or the remembered choice. For D7 to accept or to price into a re-baseline | §7.0 rule 5: the eager subject rule alone measured 155–179 B, more than the 448 B allowance leaves after the items, the operator and the first-run answer; the remembered-choice line cost ≈ 65–70 B wherever it was eager. A prefetch from `prefetchForMenuItems` (`shell/prefetch.ts`) measured +32 B to +95 B more than the poll's one line, so the poll starts it (polls run when the menu content mounts, `MenuBar.tsx`) |
| AR-D2-12 | **Both menu items hand the subject over** (fix round 1; first cut: Help passed none), and so does the first-run answer — §3.4's row gives one Effect for both controls ("the subject is the selection … else …"). Help stays enabled without a subject (empty document) | §3.4. In an empty document no subject exists and Auto-Rig starts at its Model step; with a model in the document the first-run answer and Help both pick it up |
| AR-D2-13 | **File › Auto-Rig This Model… is enabled whenever the document has a mesh or a character** (fix round 1; first cut: disabled when no subject, e.g. every scene mesh hidden and nothing selected). With every scene mesh hidden and nothing selected it switches **without a subject** | §3.4's enablement ("enabled when the scene has meshes or a character"). The poll counts any mesh record (`store.list('meshes')`) or an active character: a character's meshes are only there with a character, which the second check covers anyway |

**Shared files touched outside the D2 Dirs** (for D7's approval): `packages/editor/src/dialogs/entryChoice.ts` (new:
Studio's copy of the record code, used by Preferences and the switch chunk), `packages/editor/src/shell/autoRigSwitch.ts`
(new, fix round 1: the lazy half of `shell.autoRig`, AR-D2-11), `packages/editor/test/ar-entry-switches.test.tsx` (new, the
editor unit tests), `apps/web/test/tsconfig.json` (`include` gains `../app/entry.ts`, so the Node tests type-check
the module they import). D1's `host/operators.ts` is **not** touched (AR-D2-6).

## Sizes (production build, `check:size`, gzip -9)

Measured against this branch's base, D1's head (`/editor` 896,327 B = eager 889,473 B + First-run dialog 6,854 B,
identical to D1's final number; `/autorig` 655,590 B).

| Build | `/editor` | eager | First-run | delta vs D1 |
|---|---:|---:|---:|---:|
| first cut (visibility through `objectsDrawnIn`) | 909,430 B | 902,148 B | 7,282 B | +13,103 B (Model operators + component selection service pulled eager: **FAIL**) |
| own visibility walk, `entryChoice` eager | 897,127 B | 890,082 B | 7,045 B | +800 B |
| subject/operator compacted, record line in the operator | 896,947 B | 889,917 B | 7,030 B | +620 B |
| literal subject rule (AR-D2-3), smaller first-run finish | 896,864 B | 889,875 B | 6,989 B | +537 B |
| record write in the dialog, poll through the subject | 896,838 B | 889,778 B | 7,060 B | +511 B |
| parent-only visibility (AR-D2-4), shorter reason | 896,825 B | 889,765 B | 7,060 B | +498 B |
| lazy `import('./entryChoice')` in the dialog (reverted, AR-D2-7) | 896,854 B | 889,762 B | 7,092 B | +527 B |
| first submission: inline record line, module-private helpers, `export` group, uncontrolled checkbox | 896,817 B | 889,757 B | 7,060 B | +490 B (eager +284 B, First-run +206 B): **over by 42 B** |
| *fix round 1* — group-aware subject (parent map + ancestor walk), record line moved from the dialog into the eager operator | 896,863 B | 889,876 B | 6,987 B | +536 B |
| … the subject as one walk down `childrenOf`, a template-string record, `setStart(value as Start)` | 896,825 B | 889,847 B | 6,978 B | +498 B |
| … (probe) subject rule stubbed out | 896,684 B | 889,697 B | 6,987 B | +357 B (the eager rule = 155–179 B) |
| … (probe) record line removed | 896,614 B | 889,627 B | 6,987 B | +287 B (the eager record line ≈ 70 B) |
| … rule and record write lazy (`autoRigSwitch.ts`), prefetch from `prefetchForMenuItems` (loader exported by `menuItems`) | 896,842 B | 889,864 B | 6,978 B | +515 B |
| … the same, loader in `prefetch.ts` | 896,779 B | 889,801 B | 6,978 B | +452 B |
| … the same, no prefetch | 896,747 B | 889,769 B | 6,978 B | +420 B |
| **shipped (fix round 1)**: lazy rule and write, **prefetch from the operator's poll**, spec enablement poll | **896,741 B** | **889,763 B** | **6,978 B** | **+414 B ≤ 448 B** (eager +290 B, First-run +124 B; 34 B left) |

`/autorig` 655,589 B (unchanged: D2 adds nothing to it). AR-B1 after fix round 1: **+1,053 B** over 895,688 B (limit
+2,048 B; first submission +1,129 B). The lazy switch chunk `shell/autoRigSwitch.ts` is 625 B gzip (the subject rule,
`readEntryChoice`/`writeEntryChoice`), loaded only on intent (a menu with one of the items opened) or by the first-run
answer's button.

**Landing `/`**: the `EntryChooser` client chunk is **1,058 B** gzip (≤ 1.5 kB, §10 D2) and the inline redirect script
**309 B** gzip; the landing no longer imports `next/link` (plain links).

## Tests

- Unit (apps/web, Node): `test/entry-choice.test.ts` (key and routes; parse cases incl. `toString`/`__proto__`,
  non-objects and broken JSON; write/read/forget; blocked and missing storage = Ask; `redirectHref` and `entryHref`
  cases), `test/entry-redirect.test.ts` (the inline script in a VM context against `redirectHref`: every case,
  malformed records, a throwing `localStorage` accessor, back/forward and reload, no Navigation Timing, no globals
  left, size), `test/entry-contract.test.ts` (Studio's copies and the page use the landing's key, record, routes and
  card order).
- Unit (editor, Chrome): `test/ar-entry-switches.test.tsx` — the subject through `shell.autoRig` and a recording port
  and through `autoRigSubject` directly (empty → disabled; selected, else visible scene meshes; a hidden mesh, a hidden
  parent and a hidden grandparent group; a selected group gives its descendant meshes, nested groups, a selected mesh
  inside a selected group once; two models with one selected; a selected empty group falls back; a parent cycle ends
  the walk; the active character; a selected mesh over the character), the two menu items, the operator's poll (empty,
  a mesh, every mesh hidden still enabled, a character only), every mesh hidden switches without a subject, the port
  request from File and Help with the subject and no undo step, the harness without a port; the first-run third answer (switches from its button,
  remembers only when ticked, Esc keeps Studio, Animate/Model unchanged); Preferences › Start in (shows, writes
  Auto-Rig/Studio, Ask forgets, blocked storage = Ask without an error and the select shows Ask after the failed write,
  a failed write keeps showing the stored choice, malformed records = Ask).
- E2E-AR-02 (AS-AR-8, complete): `apps/web/e2e/ar-02-chooser-landing.spec.ts` — the two link cards, order, credits,
  privacy line, Tab order, no console warnings and same-origin GETs only; *Remember* + Auto-Rig → the next `/` lands on
  `/autorig` (with the query), `/?chooser=1` shows the chooser ticked, unticking forgets; *Remember* + Studio; deep links
  never redirect; back/forward shows the chooser; blocked storage shows the chooser and the cards work without a page
  error; without JavaScript the chooser shows despite a remembered choice and its links work; side by side at 1440 px,
  stacked at 390 px with a 16 px gutter and no horizontal scroll. `apps/web/e2e/ar-02-chooser-switches.spec.ts` — File ›
  Auto-Rig This Model… disabled on an empty document, then with the Cube Lad switching on the same page (page mark,
  undo history, `?from=studio`); Help › Switch to Auto-Rig from an empty document without fetching the rig chunk; the
  first-run third answer with and without the tick; Preferences › Start in Studio / Auto-Rig / Ask against `/`.

## Gates

On `f5fae18` (+ this notes commit): `EKZA_E2E_PORT=3163 pnpm run ci` — format, lint, typecheck, check:deps,
check:fixtures, check:licenses, every package's unit tests (editor 588 passed / 1 skipped, editor-core 1,498, web 84,
…), clean build, **check:size green** (`/editor` 896,817 B ≤ 900,000 B, AR-B1 +1,129 B ≤ 2,048 B; `/autorig`
655,589 B; every boundary holds) — and the full e2e suite on local Chrome: 275 passed, 24 skipped (the stretch
`fixme`s), **1 failed**: `m6b-skin-02-paint-fix-undo` (`__EKZA_UPLOADS__` 72,576 B instead of 0: a late GPU buffer
upload under the parallel load, Rig & Skin paint, untouched by D2). It passed 4/4 alone (`--repeat-each=4`), and a
second full run `EKZA_E2E_PORT=3163 pnpm run test:e2e` was **green: 276 passed, 24 skipped, 0 failed**. The D2 specs
(13 tests) passed in both full runs and alone.

**Not met**: D2's own `/editor` allowance (+490 B against 448 B) — for D7's approval, AR-D2-10.
