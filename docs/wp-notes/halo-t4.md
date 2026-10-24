# Halo T4 — UI touch kit: build notes

Branch `halo/t4-uikit` (from `dev` at `959c587b`; `dev` merged again at `d5d123c3`, TM-4). Scope:
[STUDIO-TOUCH-SPEC §21 T4](../STUDIO-TOUCH-SPEC.md#21-build-plan) with §4.1 (parts and rules for all parts), §4.4
(Compact), §5.2–§5.6 (gestures, long-press, Thumb key, numbers), §6.1–§6.3 (the Halo, More), §18 (accessibility), §20.3
item 14 and §20.6 (bundle). Decision IDs below are `ST-T4-<n>`; the integration agent copies them into
[DECISIONS-OPEN §P](../DECISIONS-OPEN.md#p-ekza-studio-touch-shell-halo-defaults-chosen-2026-10-24) (line patch at the
end).

Exit test (T4 row): primitive unit tests · axe green on the gallery · 44 pt / 16 px tokens · `/editor` +0 B — results
under [Gates](#gates).

## What shipped

| Part | Where |
|---|---|
| Touch tokens: `size-touch-{hit 44, key 56, bar 52, sheet 360, numpad 296}`, `space-{gutter 16, edge-side 12, edge-bottom 20, touch-gap 8}`, type `touch-{ui 15, label 13, value 14, input 16, title 18}`, radii `r-touch{,-inner,-card,-pill}`, `elevation-{touch,sheet}`, `motion-{touch,toast}` (zeroed under reduced motion by the generator), colours `accent-soft`, `touch-surface`, `toast-bg`, `on-toast`; three contrast rows | `packages/ui/tokens.json` → `css/tokens.css` (regenerated, generator unchanged) |
| The touch scope `[data-density="touch"]`: `--touch-hit`, `--touch-key`, `--touch-text`, `--touch-input-text` read with `--ui-scale`; Studio's shared `--size-row/-hit/-field/-field-dialog` → 44 px and `--type-ui-size` → touch text inside a scope; inputs ≥ 16 px; safe-area insets `--touch-inset-{left,right,top,bottom}` (16 px gutters, 20 px bottom clearance); the focus ring; reduced motion; `[data-touch-scroll]` lists | `packages/ui/styles.css` |
| The shell policy class `html.ekza-touch-policy` (§4.1, C10, S13) and `installTouchPolicy(doc) → disposer` (counted installs, cancels `gesturestart`) | `styles.css`, `src/touch/policy.ts` |
| Tailwind names for the kit: `bg-accent-soft`, `bg-touch-surface`, `bg-toast`, `text-on-toast`, `rounded-touch{,-inner,-card}`, `shadow-{touch,sheet}`, `text-touch{,-label,-value,-title}` | `styles.css` `@theme inline` |
| The subpath `@ekza-studio/ui/touch` (never re-exported from the root) | `packages/ui/package.json` `exports["./touch"]`, `src/touch/index.ts` |
| Scope and surfaces: `TouchRoot`, `touchScopeProps(uiScale)`, `clampUiScale` (0.85–1.5), `TouchButton` (default / primary / ghost / danger), `TouchIconButton` (44 / 48 px, named), `Cluster` (frosted edge surface) | `src/touch/{constants.ts,surfaces.tsx}` |
| LongPress: `createPressRecognizer` (pure: tap with count, 450 ms long-press, slop by pointer type 10 / 4 / 3, drag start / move / end, cancel) and `useLongPress` (pointer capture, timer, right-click = long-press, callout suppressed) | `src/touch/{press.ts,use-long-press.ts}` |
| Chips: `ValueChip` (ScrubChip: `role="slider"`, distance scrub ×1 / ×0.1 at 80 px / ×0.01 at 160 px, the Thumb key's modifier, tap → numpad, long-press → menu, arrows / Page / Home / End, keyed and altered states, `aria-valuetext` "−5°, Rotate Z"), `ToggleChip` (`aria-pressed` with a switch), `ActionChip`; the pure scrub model (`createScrub`, `scrubFactor`, `keyStep`, `formatValue` with a true minus) | `src/touch/{chips.tsx,scrub.ts}` |
| `Segmented` (radio group or tab list, roving focus, neutral or accent; each segment a full 44 px target) and `Stepper` (`− n +`, a spinbutton, hold to repeat, stops at the range) | `src/touch/{segmented.tsx,stepper.tsx}` |
| `Numpad` (labelled panel, `inputmode="none"` field ≥ 28 px, `( ) ± ÷ · 7 8 9 × · 4 5 6 − · 1 2 3 + · 0 . = ⌫ · −10 −1 +1 +10`, spoken key names, live result, Next / Done, Escape cancels) over `evaluateExpression` (recursive descent, no `eval`) and `numpadReduce` | `src/touch/{numpad.tsx,numpad-model.ts}` |
| Sheets and drawers: `Sheet` (Radix Dialog in place; right 360 px or bottom with peek / half / full detents, grab bar tap and drag with flick snapping; modal or docked; `pan-y` + `overscroll-behavior: contain` body; footer with the bottom inset), `SheetRow` (52 px, title + detail + trailing; greyed with its reason), `SheetGroup` | `src/touch/sheet.tsx`, `layout.ts` (`snapDetent`, `nextDetent`, `detentHeights`) |
| The verb ring and verb bar: `Petal` (44 px pill, word + icon, Pro name in the accessible name, disabled-with-reason, ▾, toggle switch, changed outline), `VerbRing` (`menu`; arc beside the selection or the long-press compass ring; at most 6 petals + ⋯ More; connector line; roving focus; Escape), `VerbBar` (one row with ⋯ pinned, overflow folds into it and is handed to `onMore`) over the pure `arcLayout`, `ringLayout`, `ringSlots`, `slotToward`, `fitRow`, `rovingIndex` | `src/touch/{verbs.tsx,layout.ts}` |
| `ThumbKey` (56 px, two lines `⊕ select more` / `≈ fine`, tap / double-tap / hold / slide-up chooser, toggle button named by its meaning) over `thumbReduce` and `useThumbKey` | `src/touch/{thumb-key.tsx,thumb-model.ts}` |
| Toasts: `createToastStore` (max 3, replace by key, hold on hover / focus, 4 s) and `ToastRegion` (named region, polite live list, inverse pill, one 44 px action) | `src/touch/{toast-store.ts,toasts.tsx}` |
| `LoupeChips` (v1 chips: named candidates above the finger, tap or slide-and-lift through `pickAt`) | `src/touch/loupe.tsx` |
| Glyphs the kit draws itself (inline SVG; verb icons are the caller's) | `src/touch/glyphs.tsx` |
| `prefersReducedMotion()`, `slopFor(pointerType)`, the `TOUCH` constants (44 / 56 / 52 / 360 / 16 / 12 / 20, long-press 450 ms, double-tap 450 ms / 24 px, scrub 80 / 160 px, 6 petals, pitch 52, arc room 240, ring 80 / 144, flick 250 ms / 20 px, toast 4 s) | `src/touch/constants.ts` |
| Unit tests (Node): models, markup (static render), tokens and isolation | `packages/ui/test/touch/{models,render,tokens-and-isolation}.test.ts` |
| The gallery `/dev/touch` (dev / e2e builds only): a mock canvas laid out like the Simple layout — top bar with the Path, breadcrumb, the Halo beside a selected face, Echo chips and the numpad, off-hand column with ↶ and the Thumb key, tray, toasts, the More sheet; the Compact layout below 700 px (verb bar, tab-bar Path) — and a card per primitive; the Text & touch size switch (85–150 %) | `apps/web/app/dev/touch/{page.dev.tsx,TouchGallery.tsx}` |
| The gallery's e2e spec: 44 px / 16 px in every state and at 85 % and 150 %, scrub and numpad input, the Halo menu and its placement off the selection, roving focus and the focus ring, the long-press ring, the Thumb key, segmented and stepper keys, the policy class on and off, reduced motion, touch taps | `apps/web/e2e/dev-touch.spec.ts` |

### For T6a and the stage packages: how to use the kit

- The shell root spreads `touchScopeProps(prefs.uiScale)` (or renders `TouchRoot`); anything portalled out of it (a
  sheet with `portal`, a numpad in a top layer) carries `data-density="touch"` itself. `Sheet` renders in place by
  default, so a docked sheet keeps the scope and positions inside the frame (`position: absolute` against it).
- The shell controller calls `installTouchPolicy()` on mount and the disposer on unmount (§4.1 "registered by the
  shell controller with a disposer"; ha-12 checks Pro zooms and scrolls after). Scrolling lists inside it carry
  `data-touch-scroll` (sheet bodies already do).
- `VerbRing` needs the selection's box and the frame size in the same coordinates (container px). Pass the chrome to
  avoid as `insetTop` (top bar, breadcrumb) and `insetBottom` (tray, Thread); `prefer` is the side away from the
  pen hand (handedness mirrors it). Long-press: `mode="ring"` with `center`; flicks themselves stay with the marking-menu
  controller (`./overlays`, T5c), whose geometry `slotToward` mirrors.
- `ValueChip` is controlled: `onChange` while scrubbing, `onCommit` once at the end (one undo step); feed the Thumb
  key's drag meaning into `modifier` (×0.1 Fine, ×10 Coarse) and dispatch `{type: 'consume'}` after the action.
- The numpad is placed by the caller next to its chip, clear of the selection and other chips (the gallery shows one
  placement); `onNext` moves to the next chip.
- Toasts: one store per shell (`createToastStore()`), `push({text, key: 'undo', action: {label: 'Redo', run}})`.

## Decisions and deviations

| ID | Decision | Why / evidence |
|---|---|---|
| ST-T4-1 | **Touch tokens are entries in the existing token groups** (`size`, `space`, `type`, `radius`, `shadow`, `motion`, `color`), so `scripts/build-tokens.mjs` writes them unchanged and the generated-file test covers them; the `[data-density="touch"]` overrides live in `styles.css`, the file T4 owns. | The generator writes only `:root` groups; a new group would have needed a change outside the row. |
| ST-T4-2 | **The Text & touch size (`uiScale`) is read through `--ui-scale`, clamped to 0.85–1.5 (§18), and scales text and targets up but never a target below 44 px or an input below 16 px** (`max(44px, 44px × scale)`). Pro's stored range (0.5–3) is clamped on read. | A plain multiplication at 85 % puts targets at 37 px, under the spec's 44 pt rule (§4.1, AS-ST-14). e2e: 85 % keeps every target ≥ 44 px and the field at 16 px; 150 % gives 66 px targets and 24 px input text. |
| ST-T4-3 | **The kit is its own subpath and nothing outside `src/touch` imports it**; it imports only `react`, the Radix Dialog primitive (already in the host floor both routes share) and `cn`. Its styles are Tailwind utilities scanned through the existing `@source "./src"` plus the scope / policy rules in `styles.css`. | `/editor` +0 B by construction (no normal-build page imports it; the gallery is a `.dev.tsx` page); a unit test fails if the root barrel or any non-touch file imports `touch`, or the kit imports anything else. The utilities add CSS bytes to every route's stylesheet (measured under [Gates](#gates); CSS is not size-gated). |
| ST-T4-4 | **Each segment of a segmented control is a full 44 px target** (the track is 48 px), not the prototype's 38 px buttons inside a 44 px track. | §4.1 "Targets are at least 44 × 44 pt"; axe `target-size` and the e2e size check. |
| ST-T4-5 | **Filled accent surfaces use `accent-fill` (#6c4ff0, 5.23:1 with white), never `accent` (#7c5cff, 4.35:1)**; `text-3` and `accent-text` are never set on `bg-pressed` (3.89:1 / 4.39:1). Contrast rows added for the toast pair and the popover / pressed pairs the kit uses. | WCAG 2.2 AA 1.4.3 (§18). |
| ST-T4-6 | **`Sheet` is a Radix Dialog rendered in place (no portal by default).** A modal sheet (Share, Settings) traps focus behind a scrim and closes on an outside tap; a docked sheet (`modal={false}`: Numbers, More, Scene) does not trap focus and does not close on outside taps, so the canvas and chrome stay live (P6). Escape closes both; the title names the dialog. | §18 "sheets are dialogs with a focus trap" read as the modal case: trapping focus in a docked sheet would cut the canvas off from the keyboard while it stays usable by touch. |
| ST-T4-7 | **The numpad's field is a text input with `inputmode="none"`** (hardware keys and handwriting write in it, the on-screen keyboard stays away), ≥ 28 px; `±` negates a plain number or wraps an expression (`-(…)`); a digit replaces the fresh value, an operator extends it; nudges evaluate first. | §5.6 (Scribble, minus, expressions, nudges); C11 (always-visible fields are buttons — the numpad field exists only while the numpad is open). |
| ST-T4-8 | **The long-press ring's drawn radius starts at the marking menus' 80 px and grows in 8 px steps until no two petals touch**; each petal's near edge (a corner on the diagonals) sits on the radius; the drawn centre stays 144 px inside. A verb keeps its compass slot; others and ⋯ More take the free slots in compass order. | 44 px pills with words overlap at 80 px (the marking menus draw 22 px rows). Flicks are measured by direction from the press (`slotToward`), so the drawn radius never changes what a flick picks. |
| ST-T4-9 | **The Halo arc follows the prototype's geometry**: a column at a 52 px pitch on the preferred side when that side has at least max(240 px, widest petal + 30) of room, bowed away from the selection (push 30 + 34 t² px, the middle petal nearest), else the other side, else a row below the selection (above when there is no room below) that wraps at the gutters. | §4.1 (petals beside the selection, never over it, away from the screen edges), §4.3 (row below 240 pt of room). e2e: no petal overlaps the selection's box. |
| ST-T4-10 | **The Thumb key's reducer**: release after 450 ms, or after an action used it while held, turns it off; a tap on a lock unlocks; a tap on a once-meaning outside the double-tap window turns it off; a keyboard or assistive-technology activation (click with `detail 0`) is a tap. The caller owns the state, so a lock can be the tray chip's own state (§5.5 "one state"). | §5.5. |
| ST-T4-11 | **The kit draws its own few glyphs and imports no icon module**; verb icons come in as props. | §6.1 keeps the Halo's lucide icons in the Halo package; importing `../icons` (Pro's eager barrel) from a second route group would split modules `/editor` hoists today (AR-D3-1). |
| ST-T4-12 | **Toasts have their own small store** (not Radix Toast): at most three, a newer toast with the same key replaces the older in place (repeated undos update one toast), timers hold while a pointer or focus rests on the region, 4 s by default, one 44 px action. | §3 P5, §5.3 C9; Radix Toast's swipe and viewport hotkey are desktop conventions Pro keeps. |
| ST-T4-13 | **axe was run on the gallery with axe-core 4.12.1 from a local copy, through Playwright, not from a repository dependency**: `axe-core` is not in the workspace or the offline store and the spec lists no package (T4 rule: no new dependencies). Result below; the in-repo spec checks sizes, roles and input. **Proposal for T6b / T12 (ha-15)**: add `axe-core` (or `@axe-core/playwright`) as a web devDependency when the registry is reachable, and run it in `dev-touch.spec.ts` and ha-15. | — |
| ST-T4-14 | **`TouchGallery.tsx` imports `@ekza-studio/ui/touch` under an inline `no-restricted-imports` exception** with a pointer to this note, because the dev-route allow-list in `.oxlintrc.json` (T2's file) does not list the subpath yet. | Line patch below; remove the exception when it lands. |
| ST-T4-15 | **Two new file sets outside the T4 row**: `packages/ui/test/touch/**` (the package's Vitest only reads `test/**/*.test.ts`) and `apps/web/e2e/dev-touch.spec.ts` (the gallery's spec, named like `dev-panels` / `dev-shell`). New files only; no shared file changed. | The T4 exit test needs them. |
| ST-T4-16 | **Compact in the gallery only**: below a 700 px container the gallery docks the Halo as a `VerbBar` with ⋯ pinned and moves the Path to a tab bar (§4.4); the kit itself has no width logic beyond `arcLayout`'s row fallback and `VerbBar`'s folding. | Container queries belong to the Halo frame (T6a). |
| ST-T4-17 | **The kit's utilities compile into the shared stylesheet, like the Halo's own classes will** (§20.1 registers `@source "../halo/src"` in `styles.css`). Measured (Tailwind 4.3.3, the build's `base`, minified, gzip -9): `dev` 18,575 B → this branch 21,113 B, **+2,538 B on every route's stylesheet** (tokens and the scope / policy rules ≈ +700 B, the kit's utilities ≈ +1,900 B; the gallery's own page now adds ≈ 0 since its one-off looks are inline styles). JS is unchanged (`/editor` +0 B). | CSS has no size gate; a per-route touch stylesheet (a second Tailwind entry with `@source not "./src/touch"` in `styles.css`) was tried and dropped: Tailwind 4.3's reference-only imports still pulled other sources into it, and it would need an import in T2's `/app` layout. Revisit if CSS gets a budget. |

## Line patches for other owners

1. **`.oxlintrc.json`** (T2): in the `apps/web/app/dev/**` override add `"!@ekza-studio/ui/touch"` to the group list and
   to its message; in the `packages/halo/src/**` override T2 creates, allow `@ekza-studio/ui/touch`. Then delete the
   `oxlint-disable-next-line no-restricted-imports` line in `apps/web/app/dev/touch/TouchGallery.tsx`.
2. **`packages/ui/styles.css`** (T4's file; the registration point §20.1 names): once `packages/halo` exists, add
   `@source "../halo/src";` after the Auto-Rig line, so the Halo's own Tailwind classes compile.
3. **`docs/DECISIONS-OPEN.md` §P** (T12): one row — `ST-T4 | UI touch kit decisions | ST-T4-1…17 in
   docs/wp-notes/halo-t4.md (tokens in existing groups; uiScale scales up but never below 44 px / 16 px; kit off Pro's
   routes; full 44 px segments; accent-fill for filled surfaces; in-place sheets, focus trap only when modal; numpad
   inputmode none; ring radius grows; prototype arc geometry; Thumb key reducer; own glyphs; own toast store; axe from
   a local copy, axe-core devDependency proposed for ha-15; kit utilities in the shared stylesheet, +2.5 kB gzip CSS) |
   Default | T4`.
4. **ST-B1 (T1a / T6a)**: when `packages/halo` imports the kit, the modules it shares with `/editor`'s eager graph are
   `react`, `radix-ui`'s Dialog (already in the host floor `/autorig` shares) and `packages/ui/src/cn.ts`; measure
   `/editor` after the first Halo import (AR-D3-1 pattern).

## Gates

| Check | Result |
|---|---|
| Unit tests | `packages/ui`: 155 passed (104 before + 51 for the kit: 33 models, 14 markup, 4 tokens and isolation) |
| 44 pt / 16 px tokens | `size-touch-hit` 44 px, `type-touch-input` 16 px, `space-gutter` 16 px, `space-edge-side` 12 px, `space-edge-bottom` 20 px in `tokens.json`; the scope's `max()` rules; asserted by `tokens-and-isolation.test.ts` and in the browser by `dev-touch.spec.ts` (every target ≥ 44 × 44 px and every input ≥ 16 px at rest, with the More sheet, with the numpad, at 85 % and 150 %) |
| axe (WCAG 2.0 / 2.1 / 2.2 A + AA and best-practice tags), axe-core 4.12.1, production e2e build, Chrome | **0 violations** in 8 states: rest with the Halo arc (1280 px), More sheet open, numpad open, long-press ring, bottom sheet open (modal), Loupe open, Text & touch size 150 %, phone 390 px (touch). 35–41 rules pass per state. Incomplete (needs review, not violations): `color-contrast` where text sits on the frosted / gradient canvas layers (`bgOverlap`, background image) or is a glyph (`nonBmp`) — those pairs are the token pairs in the contrast table (`text`, `text-2` on `bg-panel` / `bg-header` / `bg-field`, `on-accent` on `accent-fill`); `aria-hidden-focus` behind the modal bottom sheet (Radix hides the rest of the page while it is open, as Pro's dialogs do). Reduced motion: petal `transition-duration` 0 s. No page errors. Script: Playwright + `axe.min.js` injected (ST-T4-13). |
| `dev-touch.spec.ts` | 10 tests, green in the gate and alone, and 4 × repeated against the dev server |
| `/editor` | **891,790 B** — `dev` 891,790 B: **+0 B** (gate 900,000 B; AR-B1 limit 897,736 B) |
| `/autorig` | **652,528 B** — `dev` 652,528 B: **+0 B** (gate 660,000 B) |
| Stylesheet (every route, not gated) | +2,538 B gzip (ST-T4-17) |
| `EKZA_E2E_PORT=3164 pnpm run ci` | see the gate record below |
