# WP-6t — time slider and Timeline panel: build notes

Status: implemented on `wp/wp-6t` (2026-10-17). Scope: MVP-SPEC §7 WP-6t, §4.11.17, §4.11.3 (time-slider part),
§4.8 (`timeline-*` test ids). No M1-stretch item belongs to this WP.

## What is where

| Path | Content |
|---|---|
| `packages/curve-editor/src/timeline/TimeSliderController.ts` | The controller (§7 Public API), gesture state machine, drawing schedule, RMB menu, `registerTimelineContributions` |
| `…/timeline/band.ts` | Band arithmetic: cells, move deltas, scale factors (pure) |
| `…/timeline/layout.ts` | Frame ↔ x mapping, label strip, 1-2-5 ruler steps (pure) |
| `…/timeline/keys.ts` | Target controls, tick collection, band keys, `applyBandSelection` (the `time.selectBand` body) |
| `…/timeline/keyDrag.ts` | One preview per drag → one doc undo entry → one `history.record` step; failure handling |
| `…/timeline/context.ts` | Active character/clip, scene ↔ clip frames (§4.11.8), slider range |
| `…/timeline/painter.ts`, `theme.ts` | Canvas2D painters; colours from CSS tokens with tokens.json fallbacks |
| `…/timeline/contributions.ts` | `time.selectBand` operator and the `timeline.context` menu items |
| `packages/editor/src/panels/timeline/` | `registerTimelinePanel`, the panel (canvas view, frame field, range slider, clip/fps, transport, loop/speed, auto-key, scene time), RMB menu, popover placement, mounted-slider host and e2e screen-point helpers |
| `packages/curve-editor/test/timeline/`, `packages/editor/test/panels/timeline/` | Browser-mode tests (Vitest + Chrome) |

## Dependencies on other WPs (tested against the shared test kit until they merge)

- **WP-7a edit kernel**: band move/scale call `moveKeys`, `scaleKeys` and `selectionSnapshot`. Until the kernel lands
  a drag fails cleanly (preview cancelled, error toast `Move Keys failed: …`, document untouched). The five drag tests
  in `curve-editor/test/timeline/key-drag.test.ts` are `it.skipIf(!editKernelReady())`: they switch on by themselves
  once the kernel stops throwing `not-implemented` (§8.1 "blocked by WP-7a"). They were run locally against a
  throw-away §4.11.3 reference kernel injected with `vi.mock` (not committed, convention 12) and passed.
- **WP-7a keymap**: `Digit1…6`, `Delete`, `Mod+C/V` in scope `timeline` (§4.10 "T") act on the band's keys because
  the band selects them in `Selection.keys`; the panel declares `keyScope: 'timeline'`.
- **WP-7b operators** the panel and the menu run: `time.setFrame` (unit `clip`), `time.step`, `time.prevKey/nextKey`,
  `time.goToStart/goToEnd`, `time.play/stop`, `time.setLoop`, `time.setSpeed`, `time.setPlaybackRange` (scene
  frames), `clip.setActive`, `clip.setSettings` (`fps` + `fpsMode`, `range`), `key.toggleAutoKey`,
  `graph.keys.delete/copy/paste`, `graph.tangent.set`. Menu items poll their operator and stay disabled while it is
  missing.
- **WP-2**: `doc`'s `sceneToClipFrame`/`clipToSceneFrame` are stubs, so the §4.11.8 formula is used locally
  (`curve-editor/src/timeline/context.ts`, `editor/src/panels/timeline/input.ts`). Same formula; the call sites can
  switch to `doc` after WP-2 merges. `activeClip`/`activeClipFrame` (WP-7a stubs) are not used: the slider reads the
  session, the store and `evaluation.clipFrame`.

## Notes for the integration agent (WP-8 / WP-10)

- **Test API (§4.8)**: `screenOfFrame(f)` = `screenOfTimelineFrame(app, f)` and `screenOfTick(f)` =
  `screenOfTimelineTick(app, f)`, exported by `packages/editor/src/panels/timeline` (viewport CSS px of the focused
  slider; null without a mounted timeline). `state().band` is `session.time.band`.
- **Registration**: the first mounted Timeline panel registers `time.selectBand` and the `timeline.context` menu
  items (`host.ts`), the last one to unmount removes them. A shell that wants them registered with no panel mounted
  calls `registerTimelineContributions(app, () => focusedTimeSlider(app)?.slider ?? null)` first; the panel then
  leaves the registration alone.
- **Frame loop**: the panel redraws its controller from R3F `addAfterEffect` (same frame as the viewport during
  playback) and from its own `requestAnimationFrame` when state changes while R3F is idle. The current-frame field,
  the scene-time readout and the canvas ARIA value are written to the DOM from store subscriptions, so playback
  commits no React render (test: Profiler over 30 frames).
- **Popovers** (RMB menu, fps question) render in a portal on `document.body` with fixed positions: above the
  anchor, below when there is no room. Dock groups that clip overflow do not hide them.
- **Tokens** read by the canvas through `getComputedStyle`: `--bg-field`, `--range-outside`, `--grid-major`,
  `--text-2`, `--text-3`, `--key-tick`, `--sel`, `--range-select`, `--range-select-edge`, `--playhead`, `--bg-app`,
  `--autokey`, `--font-mono`. Missing ones fall back to the tokens.json values; WP-8's generated `styles.css` should
  define them. The panel otherwise uses only theme classes that exist today (`bg-app`, `bg-panel`, `bg-header`,
  `border-line`, `text-fg*`, `accent*`).
- **WP-7b**: the `timeline.context` menu (ids `timeline.context.*`) is owned here; `BUILTIN_MENU_ITEMS` should not
  add items with those ids.

## Behaviour decisions where the spec is silent

1. **Band cells.** `time.band = {start, end}` (active-clip frames, inclusive) covers the cells
   `[start − ½, end + ½)`: a key whose tick is drawn inside the band is a key of the band. Bands snap to whole frames
   when `snapToFrames` is on. A 1-frame band has no scale handles; its whole cell moves it (E2E-23 grabs it at
   `screenOfFrame(10)`).
2. **Target keys.** Ticks and bands use the selected controls of the active character, or all of its controls when
   none is selected, on the base layer of the active clip. Band keys leave out keys of locked curves (no edits).
3. **Which keys a drag moves.** The band's keys are recomputed from the target controls when the drag starts (what
   the slider shows is what moves), not taken from a `Selection.keys` the Graph Editor may have refined. After the
   drag `time.selectBand` re-selects the band at its new place.
4. **Undo.** One drag = one history step (`Move Keys` / `Scale Keys`) restoring keys and key selection; the band is
   session state and stays where the drag left it (as in Maya). A preview cancelled from outside (Esc →
   `edit.escape`) ends the drag without a step.
5. **Scale.** The opposite band end is the pivot; the dragged end never crosses it, stays ≥ 1 frame away when
   snapping, and the factor never drops below 0.01 (§4.11.3).
6. **Clearing.** `time.selectBand {band: null}` (plain click outside the band) clears the band and, with mode
   `replace`, the key selection. A click inside the band without moving changes nothing.
7. **Snapping.** Scrub frames follow `snapToFrames` (whole frames by default); key drags also turn snapping off while
   Alt is held at the press (§4.11.3). Scrubbing clamps to the clip range.
8. **Slider span and playback range.** The slider spans the clip range united with the playback range; frames outside
   the playback range are shaded and its ends get bracket markers ("playback-range handles"). `TimeSliderHit` has no
   kind for them, so they are drawn only; the range slider edits the playback range (ends, middle, double-click =
   whole clip) and keeps it inside the clip range.
9. **RMB menu without a band** offers only Paste: Delete/Copy/Tangent would act on key selections the slider does not
   show. With a band: Delete Keys, Copy Keys, Paste Keys, Tangent ▸ (auto, spline, clamped, linear, flat, stepped),
   Select Band Keys in Graph Editor (`time.selectBand` with the current band). Items contributed to
   `timeline.context` by other packages follow the built-in groups.
10. **Fields.** Frame fields accept `24`, relative `+10` / `-5` (also `+=`/`-=`) and `=-5` for an absolute negative
    frame; Enter commits, Esc reverts, ↑/↓ in the current-frame field step one frame. The fps menu always asks
    keep-seconds or keep-frames before `clip.setSettings`; Custom accepts `12.5`, `29.97` (→ 30000/1001) and
    `30000/1001`.
11. **Transport.** The loop button cycles Once → Loop → Oscillate. While playing, the button of the current direction
    stops (`time.stop`); the other one reverses (`time.play {direction}`).
12. **Keyboard on the slider.** The canvas is a focusable `role="slider"` (ARIA value = current frame); ←/→ run
    `time.step`.

## API additions (additive, outside the §7 block)

- `TimeSliderController.cancel()` (pointer cancel / lost capture; drops a key drag's preview) and the `dragging`
  getter (the panel's cursor and move routing). Requested for §7: add `cancel(): void` next to `dispose()`.
- `registerTimelineContributions` also registers the `timeline.context` menu items (the §7 comment names only
  `time.selectBand`).

No contract file was changed, no dependency was added and no `package.json` was edited.
