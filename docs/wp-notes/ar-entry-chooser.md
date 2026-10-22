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
| **File › Auto-Rig This Model…** (`shell.file.autoRig`, group `export`) and **Help › Switch to Auto-Rig** (`shell.help.autoRig`, the operator's label) run **`shell.autoRig {subject?}`**, a small eager operator of the Studio shell registered with its menu items: its `prepare` calls the host's navigation port directly — `hostNavigation(app).go({to: 'autorig', from: 'studio', subject?})` — so nothing loads before the push (the rig chunk is never fetched: E2E-AR-02). File's item passes `subject: true` and is disabled ("Nothing to auto-rig") without a subject; Help's passes none. Not undoable, `internal` (the palette lists `autorig.navigate`); without a port (a harness) it does nothing | `packages/editor/src/shell/menuItems.ts` |
| **Subject** (§3.4): the selected scene meshes, else the active character, else every visible scene mesh (neither the mesh nor its parent hidden), else null (AR-D2-3, AR-D2-4) | `menuItems.ts` (`autoRigSubject`, module-private) |
| **First-run third answer** "Auto-rig a character (simple mode)": the button reads "Start Auto-Rig"; with it selected, "Open this mode next time" (uncontrolled checkbox) appears; the button writes the remembered choice only when ticked, then runs `shell.autoRig` (same page, document kept). Closing the dialog otherwise keeps Studio (AR-D2-5) | `packages/editor/src/dialogs/FirstRunDialog.tsx` |
| **Preferences › Start in: Ask / Auto-Rig / Studio** — the landing's record read on open, written on change, forgotten by Ask; blocked storage reads as Ask and writes nothing | `packages/editor/src/dialogs/PreferencesDialog.tsx`, `dialogs/entryChoice.ts` |

## Decisions and deviations

| ID | Decision | Why / evidence |
|---|---|---|
| AR-D2-1 | *Remember* is **unticked by default** (the wireframe draws it ticked) | AS-AR-8 says "tick *Remember*, pick Auto-Rig"; a newcomer who tries Studio once should not lose the chooser silently. The owner may flip it: one `useState` default in `EntryChooser.tsx` |
| AR-D2-2 | The redirect is an **inline script** generated from `entry.ts` (`REDIRECT_SCRIPT`), not the client island | it runs while `/` is parsed, before React or any chunk, so the chooser never flashes; the island alone could redirect only after hydration. `entry-redirect.test.ts` runs the script in a VM against `redirectHref` over the same cases (blocked storage, malformed records, `chooser=0/1`, back/forward, no Navigation Timing). 309 B gzip inline |
| AR-D2-3 | §3.4's "else the only character" is the **active character**: the session keeps one active whenever a character exists (`repairSession`), so the rule reads *selected scene meshes, else the active character, else every visible scene mesh*. With several characters and none selected, the active one is the subject | the invariant makes the "only character" branch unreachable; checked in `ar-entry-switches.test.ts` |
| AR-D2-4 | "Visible" = neither the mesh nor **its parent** is hidden (Model's Hide), not the whole ancestor chain | the Model operators chunk's `objectsDrawnIn` (full chain) is lazy: importing it put the Model operators and the component selection service into `/editor`'s initial route (+13 kB, both boundaries broken, measured). An import's meshes sit under one group, which the parent check covers; deeper hierarchies are the rare case, and Auto-Rig ①'s *From Studio* list shows the subject before anything runs |
| AR-D2-5 | The first-run answer switches **only from its button**; Esc or the close button marks the first run done and keeps Studio. Studio's start workspace (`lastWorkspace`) becomes Animate with the Auto-Rig answer | a dismissal is not a request to leave Studio; Studio still needs a start workspace for its next page load |
| AR-D2-6 | **Start in is not a `Prefs` field**: it reads and writes the landing's `localStorage` record (so no `PREF_KEYS` row in `host/operators.ts`, which AR-D1-4 anticipated) | `/` reads the choice before any app code loads, and `Prefs` is a closed contract type (D0). Studio's copy of the record code is `dialogs/entryChoice.ts`; `apps/web/test/entry-contract.test.ts` holds it, the first-run line and the landing's `entry.ts` to one key and one record |
| AR-D2-7 | The first-run dialog writes the record **inline** (one line, `try`/`catch`) instead of importing `entryChoice` | it is a `FIRST_VISIT` chunk: a lazy import of the module measured +32 B more there than the inline line (7,092 B vs 7,060 B) |
| AR-D2-8 | The cards **carry the page's query** (`/?e2e=1` → `/autorig?e2e=1`), as the redirect does; `chooser` is dropped | the host keeps the page's switches across shells (`routeHref`, AR-D1); e2e specs reach the app with the test API |
| AR-D2-9 | The wireframe's **"Source code"** link is not shown | no public repository URL is recorded in the docs yet; one line in `page.tsx` when there is |
| AR-D2-10 | **`/editor` delta +490 B against D1's head, 42 B over D2's 448 B** (below). **For D7's approval:** take 42 B of D1's unused 813 B (§7.0 rule 2; the AR-B1 total stays +1,129 B of 2,048 B, `/editor` 896,817 B under the 897,736 B limit). Every lever that keeps the spec's behaviour is applied (table below); the remaining bytes are the subject rule (≈ 150 B), the operator and its poll (≈ 120 B), the two items (≈ 35 B) and the first-run answer (radio ≈ 26 B, checkbox ≈ 50 B, the record line ≈ 70 B, the finish ≈ 60 B) | the 448 B estimate (§7.0) priced the menu items and the dialog answer, not the subject rule; moving it lazy would load a chunk before the push, which §3.4 forbids |

**Shared files touched outside the D2 Dirs** (for D7's approval): `packages/editor/src/dialogs/entryChoice.ts` (new:
Studio's copy of the record code, used by Preferences), `packages/editor/test/ar-entry-switches.test.tsx` (new, the
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
| **shipped**: inline record line, module-private helpers, `export` group, uncontrolled checkbox | **896,817 B** | **889,757 B** | **7,060 B** | **+490 B** (eager +284 B, First-run +206 B) |

`/autorig` 655,590 B (unchanged: D2 adds nothing to it). AR-B1: +1,129 B over 895,688 B (limit +2,048 B).

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
  (empty → disabled; selected, else visible scene meshes; a hidden mesh and a hidden parent; the active character;
  a selected mesh over the character), the two menu items, the operator's poll, the port request with and without
  the subject and no undo step, the harness without a port; the first-run third answer (switches from its button,
  remembers only when ticked, Esc keeps Studio, Animate/Model unchanged); Preferences › Start in (shows, writes
  Auto-Rig/Studio, Ask forgets, blocked storage = Ask without an error, malformed records = Ask).
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

See the final section below (filled by the last run).
