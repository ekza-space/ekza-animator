# WP-9 — data panels: build notes

Status: 2026-10-18 (complete; resumed and reviewed after an interruption), branch `wp/wp-9`. Scope: MVP-SPEC §7 WP-9 (Outliner, Clips, Channels, Attributes), built
against the shared test kit while WP-2/4/7a/7b/8 are built in parallel. This file records what landed, the
deviations taken, the contract changes requested from other packages, and what the integration step (WP-10) has to
do. Shared docs (MVP-SPEC, DECISIONS-OPEN, ROADMAP, README) are untouched.

## What landed

| Panel | Directory | Highlights |
|---|---|---|
| Outliner | `packages/editor/src/panels/outliner/` | Virtualized ARIA tree (TanStack Virtual) of Character → Rig (control hierarchy, side-coloured rings, humanoid name as secondary text) / Skeleton (read-only joints and humanoid bones, collapsed by default; clicking a bone selects the control that drives it) / Clips (active marker, inline rename). Filter on names, template keys, VRM humanoid names, bone and clip names; matches keep their ancestors. Click / Shift / Mod / Mod+Shift → `select.controls` replace / toggle / remove / add (Mod = Cmd on macOS). Follows the session both ways: selected rows, lead bar, and a selection made elsewhere is revealed (ancestors expanded, scrolled into view). Hover writes the pre-highlight request (R-2). RMB: Select Hierarchy (walks through hidden secondary controls, as the tree does), Frame Selection (`view.frame`), Reset Pose (`pose.resetToRest`), Show Secondary Controls (`rig.toggleSecondary`); clip rows: Set Active, Rename, Duplicate, Delete. Keyboard: ↑/↓/PgUp/PgDn/Home/End, ← collapse or parent, → expand or first child, Enter select, F2 rename clip, `/` filter, `F` scroll to the lead (Space is left to the global keymap, D-11). |
| Clips | `packages/editor/src/panels/clips/` | Clips of every character (grouped when there are several) with the active radio, name, range and length, fps, loop, source and a settings button. New (then inline rename of the new clip), Duplicate, Delete; row keys F2 (Enter on macOS) rename, Mod+D duplicate, Delete. Inline rename validates ≤ 64 chars of `[A-Za-z0-9 _.-]`, unique per character ignoring case, and shows the reason in a message under the field. Settings popover (`ClipSettingsForm`): fps presets + custom (NTSC decimals become n·1000/1001) with keep-seconds / keep-frames, range (whole frames, start < end), scene start, loop, root motion, Ekza slot (vocabulary v1, no `tpose`), contact frame (inside the range, empty = none), tags (lowercase `[a-z0-9_-]`, ≤ 8, deduplicated), provenance sources with a licence picker (SPDX presets, `LicenseRef-VRM-PL-1.0`, `proprietary`, `unknown`, other SPDX id) and SHA-256, and the redistributable state with a badge, plus a non-blocking hint when a clip marked redistributable has an `unknown`, `proprietary` or no-derivatives (`-ND`) source. Live validation; Apply sends one `clip.setSettings` with exactly the changed fields. |
| Channels | `packages/editor/src/panels/channels/` | Lead header (name, `+N` others, read-only rotate order), TRS rows filtered by the lead's `keyable`, values in degrees for rotations, `—` for mixed values. Channel-state fills (keyed, changed, locked, as in a leading commercial desktop DCC) come from `evaluation.channelState` plus a non-colour cue (solid / thin / dashed bar, lock glyph) and a tooltip ("Keyed at f24"). Typed values and relative expressions go through `channel.setValues` (`key: 'auto'`), per selected control (relative expressions relative to each control) and to every selected channel name when the edited channel is one of them. Enter commits and leaves the field (so `S` keys next), Esc reverts, a rejected expression shows its reason under the field (the field drops its state colours while a draft is typed, D-12), a locked channel's field is read-only and typing or nudging it shows one warning toast per focus (FR-CB-04), Tab / Shift+Tab cycle the editable fields, ↑/↓ nudge (Shift ×10, Alt ×0.1; 1° or 0.01). Channel names select (click, Shift, Mod, Mod+Shift, drag for a range) into `Selection.channels`. RMB: Key Selected (`key.set {channels:'selected'}`), Reset to Default (`channel.setValues` with 0/1), Lock/Unlock Selected (`channel.toggleLock`). |
| Attributes | `packages/editor/src/panels/attributes/` | Collapsible sections. Control: name and key, side and group, rotate order (read-only; becomes editable by itself when `rig.setRotateOrder` is registered and polls true), shape kind, shape size (`rig.setControlSize`), binding, mirror partner. Clip: name (rename) and the same `ClipSettingsForm`. Character: name, format, file and size, height (skeleton, mesh or joint estimate), licence badge from VRM meta (`readVrmLicense`; warns when modification or redistribution is not allowed), credits. Cameras: projection, lock (`view.toggleCameraLock`), focal length ↔ vertical FOV on a 24 mm sensor (editable once R-3 lands), ortho height, clip planes. |

Shared code of the four panels lives in `packages/editor/src/panels/channels/kit/` (see D-4).

**DoD (Channels panel updates).** Values live in a `ChannelReadout` outside React. Document batches (previews
included), clock, override, evaluation and character events only mark it dirty; it recomputes at most once per
animation frame and hands every row a cell object that keeps its identity while nothing visible changed. The panel
itself does not subscribe to time. Test: six time changes → no commit; next frame → exactly one commit; frames on a
control without keys → no commit at all.

## Deviations (smallest sane ones, each reversible)

| # | What | Why | Undo / follow-up |
|---|---|---|---|
| D-1 | `channels/kit/kernel.ts` wraps the kernel helpers the panels call — `parseNumericInput`, `formatChannelValue`, `toDisplayValue`, `fromDisplayValue`, `beginChannelEditGesture` (editor-core, WP-7a), `defaultChannelValue`, `isRotationChannel` (doc, WP-2) and `readVrmLicense` (io, WP-4). Each adapter calls the real export and switches once, for good, to a fallback written from the same spec text when the export throws `EkzaError('not-implemented')`. Without the gesture, a nudge burst is shown in the field and written by one `channel.setValues` when it ends. | On this branch those exports are WP-0a stubs; without the adapters the Channels panel could not render in the `/dev/panels` harness or in tests (WP-0b DoD: "each UI WP can mount its panel … on day 1"). The WP-7a DoD forbids private re-implementations, so the panels always prefer the real helper. | After WP-2, WP-4 and WP-7a merge: delete the fallbacks (and `fallbackParseNumericInput`'s own test), keep the thin calls. The Channels panel nudge test of the gesture path is `it.runIf(kernelReady)` and switches on by itself; the deferred-path test is `it.skipIf(kernelReady)`. |
| D-2 | Geometry the virtualizer depends on (panel root flex column, scroller `flex: 1 1 0; overflow: auto`, absolutely positioned rows) is set inline, not with Tailwind classes. | Vitest browser mode loads no stylesheet; inline geometry keeps the virtualized Outliner correct in tests and before CSS loads. | None needed. |
| D-3 | Context menu (`kit/menu.tsx`), popover (`kit/popover.tsx`, a non-modal `<dialog>`), numeric fields (`kit/fields.tsx`) and 14 px icons (`kit/icons.tsx`) are local stand-ins. | `@ekza-studio/ui` exports no primitives yet (WP-8 builds them in parallel) and `editor` may not import `radix-ui` directly (ARCHITECTURE §3). | Swap for the `ui` ContextMenu / Popover / NumberField / icons when WP-8 lands; the call sites are few (one `useContextMenu`, one `Popover`, `ExpressionField`/`NumberField`). |
| D-4 | The four panels' shared code is under `channels/kit/`, and Clips' `ClipNameInput` / `ClipSettingsForm` are imported by the Outliner and Attributes. | WP-9 owns exactly these four directories; a fifth shared directory would be outside them. | Move `kit/` to a neutral `panels/data-kit/` (or into `ui`) when ownership allows. |
| D-5 | Channel-name selection writes `session.selection.channels` directly (`kit/run.ts` `setChannelSelection`); the Outliner writes the hovered control into the session as an untyped `hoverControl` field (`outliner/hover.ts`). | No `select.channels` operator and no hover field exist in the contracts (R-1, R-2). Both are per-user U state that never enters undo, so a direct session write is safe. | Switch to the operator / typed field when R-1 / R-2 land. |
| D-6 | Lens fields are read-only unless an operator `view.camera.setSettings` is registered and polls true (`runUntyped`). | The catalog has no undoable camera-settings operator (R-3); a raw `store.transact` from a panel would bypass the runner and the editor history (ADR 0008). | Nothing to change in the panel once R-3 lands. |
| D-7 | A nudge "burst" is the run of ↑/↓ key-downs (auto-repeat included) until the arrow is released (or Enter, Tab, blur; Esc cancels): one gesture, one history step. Separate taps are separate steps. | "↑/↓ nudge (coalesced)" needs a boundary; key release is deterministic and matches one-gesture-one-step (research 09 §6.3). | — |
| D-8 | Colour state and tooltip show the **lead's** state; the value shows `—` when the selected controls disagree (relative tolerance 1e-9). | Desktop-DCC behaviour; FR-CB-01/02. | — |
| D-9 | Custom attribute channels (`@name`) are not listed. | `ControlRecord.attrs` is empty in the MVP and `ChannelValues`/`channelValues()` cover TRS only. | Add rows when attrs land (V1). |
| D-10 | A panel reports the operator runs it starts that do not finish: `failed` as an error toast, `cancelled` (poll reason, "gesture in progress") as a warning (`kit/run.ts`). | The runner never throws (§4.11.0) and no contract says who surfaces a refused run. | Drop it if the shell (WP-8) reports runs globally. |
| D-11 | The Outliner tree does not take Space (the ARIA tree pattern's optional "Space selects"); Enter selects. | Space is the global maximize key (`view.toggleMaximize` tap, §4.10); a focused tree swallowing it would break maximizing the Outliner. | — |
| D-12 | A numeric field shows the state colours only while no draft is typed; a draft is shown on the neutral field colour (the state bar stays). | The desktop DCC's edit field; a typed draft or its red invalid border is unreadable on the keyed red or changed pink. | — |

## Contract changes requested

| # | Package / owner | Request |
|---|---|---|
| R-1 | editor-core `OperatorMap` (WP-7b, operator freeze) | `'select.channels': { args: { readonly refs: readonly ChannelRef[]; readonly mode: SelectMode }; result: void }` — Channels panel and the Graph channel list highlight the same refs; keymaps and the test API could then select channels. |
| R-2 | editor-core `SessionState` (WP-7a) + viewport (WP-5) | `readonly hoverControl: ControlId \| null` (default `null`), written by the Outliner on hover, read by the viewport's control renderer for the `--sel-hover` pre-highlight (FR-OUT-03, research 09 §4.3). The Outliner already writes it (untyped). |
| R-3 | editor-core `OperatorMap` (WP-7b or WP-5) | `'view.camera.setSettings': { args: { readonly camera: CameraId; readonly fovY?: number; readonly near?: number; readonly far?: number; readonly aspect?: number \| null }; result: void }`, undoable, patches `CameraRecord`. Attributes' focal length ↔ FOV fields use it as soon as it is registered. |
| R-4 | ui `tokens.json` / `styles.css` (WP-8) | Channels panel state tokens `--cb-keyed-on`, `--cb-keyed-off`, `--cb-altered`, `--cb-locked` and their `-text` pairs (research 09 §4.5 values), and CSS variables for the tokens the panels use with fallbacks today: `--bg-field`, `--bg-hover`, `--bg-pressed`, `--bg-selected`, `--bg-popover`, `--border-strong`, `--text-disabled`, `--ok`, `--warn`, `--danger`, `--rig-left/right/center`, `--sel-lead`, `--locked-badge`. |
| R-5 | editor input adapter (WP-8) | Ignore `keydown` events whose `defaultPrevented` is set. The data panels prevent the keys they consume (Enter/Esc/Tab/↑/↓ in fields, tree navigation, menu keys); otherwise Esc in a field would also run `edit.escape`. The popover closes on an Esc nobody prevented. |

## Dependencies on other work packages

- **WP-7b operators** used: `select.controls`, `clip.new/rename/duplicate/delete/setActive/setSettings`,
  `channel.setValues`, `channel.toggleLock`, `key.set`, `pose.resetToRest`, `rig.setControlSize`,
  `rig.toggleSecondary`, `rig.setRotateOrder` (stretch), `view.frame` (WP-5), `view.toggleCameraLock` (WP-5). In
  the fake app none is registered: runs are recorded and reported as a warning toast ("unknown operator …").
- **WP-7a** helpers behind D-1 and `EvaluationService.channelValues/channelState/clipFrame` (the fake app's are used
  in tests).
- **WP-8**: ui primitives (D-3), tokens (R-4), input adapter (R-5); the shell mounts the panels through
  `registerBuiltinPanels`.
- **WP-5**: reads `hoverControl` (R-2).

## Tests

`packages/editor/test/panels/` (Vitest browser mode, real Chrome, the shared test kit's fake app over
`fixtures/synthetic/wave-doc.json` + `humanoid-skeleton.json`; real CDP input through `userEvent` inside `act`, plus
synthetic events where a macOS host would turn a Ctrl+click into a context click):

| File | Covers |
|---|---|
| `kit.test.tsx` | kernel adapters and the fallback switch, the numeric grammar (spec examples + research 09 §6.4), formatting, modifier → selection mode per platform, `ExpressionField` / `NumberField` commit / revert / blur / Tab, the validation message (placement, `aria-describedby`), state colours dropped while drafting, read-only fields reporting value keys once per focus, context menu keyboard and dismissal |
| `outliner.test.tsx` | a seeded invariant test of the model (300 random filters / expansion states / secondary visibility: unique keys, parents first and expanded, every match shown and marked, no unmatched row without a match below; mutation-checked), tree structure and counts, side colours, skeleton bones → driving control, empty and not-loaded states, secondary controls, filter (names, keys, humanoid names, character), selection modes, session sync and reveal, hover request, context menu actions, clip activation and rename, ARIA keyboard navigation (Space passes through), virtualization (2,000 controls) with scroll-to-lead, model helpers |
| `clips.test.tsx` | listing, activation, new / duplicate / delete, rename validation and its message, the redistribution hint, context menu and row keys, settings popover (all fields in one `clip.setSettings`, validation of each rule, provenance), the pure rules |
| `channels.test.tsx` | rows and header, mixed values, the colour-state mapping table and every state live, expressions (absolute, relative per control, invalid with its message, Esc), the locked-channel toast, Tab order, nudge bursts (deferred path now; gesture path auto-enabled with WP-7a), channel-name selection incl. drag and multi-control refs, RMB menu, the once-per-frame commit (DoD) and the readout's coalescing |
| `attributes.test.tsx` | control section, size edits, rotate order enabled by a registered operator, clip section, character section, licence summaries, camera lock and lens fields, lens maths |
| `registration.test.tsx` | the four `register*Panel` functions, `registerBuiltinPanels`, every panel mounted in the `/dev/panels` harness |

Run: `pnpm --filter @ekza-studio/editor test`.

## E2E support (WP-10)

Stable test ids of §4.8: `outliner-filter`, `outliner-row-<controlId>`, `clips-new`, `clips-row-<clipId>`,
`clips-rename-input` (double-click a row's name or the row, F2, or RMB → Rename), `clips-settings-<clipId>`,
`cb-field-<channel>` (always an `<input>`: Playwright `fill()` then `press('Enter')`; Enter leaves the field so a
following `S` over the Channels panel keys), `cb-name-<channel>`, `cb-menu-key-selected`, `cb-menu-reset`,
`cb-menu-lock`. Additional ids: `outliner-tree`, `outliner-character-<id>`, `outliner-group-<rig|skeleton|clips>-<characterId>`,
`outliner-bone-<characterId>-<node>`, `outliner-clip-<clipId>`, `outliner-toggle-secondary`, `outliner-menu-*`,
`clips-active-<clipId>`, `clips-name-<clipId>`, `clips-duplicate`, `clips-delete`, `clips-menu-*`,
`clips-settings-popover`, `clip-settings-*` (form fields, `-apply`, `-reset`, `-error-<field>`), `cb-lead-name`,
`cb-rotate-order`, `cb-more`, `cb-field-<channel>-message`, `clips-rename-message`, `clip-settings-redistribution-hint`,
`attr-*`. The Outliner is virtualized: a row far down a long rig is in the DOM only
when scrolled into view — type into `outliner-filter` first, or select the control (the Outliner then reveals it).

## Checklist for integration

1. After WP-2/4/7a: remove the D-1 fallbacks; the gesture nudge test runs (expect it green).
2. After WP-8: replace the D-3 stand-ins with `ui` primitives; adopt R-4 tokens (drop the `var(…, fallback)`s).
3. Land R-1…R-3, R-5 (or decide against them); then drop D-5/D-6 workarounds.
4. E2E-07 and E2E-15 drive the Channels panel and Clips panels through the ids above.
