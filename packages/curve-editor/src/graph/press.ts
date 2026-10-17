// What a press in the Graph Editor does (MVP-SPEC §4.11.18, §4.11.3, research 09 §4.7): on release below the drag
// threshold it is a click (select, insert), past it a drag (move keys, drag handles, marquee). The drag set is
// predicted from the click's selection change, so a drag never waits for the asynchronous `select.keys` run.
import type { CurveId, KeyId } from '@ekza-animator/doc';
import type { EditorApp, KeyPartSelection, SelectMode } from '@ekza-animator/editor-core';
import { type HitScratch, handlesInRect, keysInRect, type ScreenRect } from '../hit/hitTest';
import type { GraphHit } from '../types';
import {
  type Gesture,
  type GestureHost,
  type GesturePointer,
  HandleDragGesture,
  type HandleTarget,
  KeyMoveGesture,
  MarqueeGesture,
} from './gestures';
import { type GraphScene, handlePosition, keyX, keyY } from './scene';
import { applyKeySelection, KEY_PART, selectedHandleParts, selectedKeyParts, selectModeFor } from './selection';

export interface PendingPress {
  readonly start: GesturePointer;
  /** Creates the drag gesture once the pointer passes the drag threshold; null: the press has no drag. */
  readonly drag: (() => Gesture | null) | null;
  /** Runs on release below the threshold. */
  readonly click: (() => void) | null;
}

export type KeySelectItems = readonly { readonly key: KeyId; readonly parts: KeyPartSelection }[];

/** What press planning needs from its controller. */
export interface PressContext {
  readonly app: EditorApp;
  readonly gestures: GestureHost;
  readonly hitScratch: HitScratch;
  scene(): GraphScene;
  hitTest(x: number, y: number): GraphHit;
  selectKeys(items: KeySelectItems, mode: SelectMode): void;
  selectCurveKeys(curve: CurveId, mode: SelectMode): void;
  insertKey(curve: CurveId, frame: number): void;
}

const handlePart = (side: 'in' | 'out'): KeyPartSelection => ({ key: false, in: side === 'in', out: side === 'out' });

/** Selected keys (key part) on shown, unlocked curves. */
export function draggableKeys(scene: GraphScene, selection: ReadonlyMap<KeyId, KeyPartSelection>): KeyId[] {
  return selectedKeyParts(selection).filter((key) => {
    const found = scene.curves.byKey.get(key);
    return found !== undefined && !found.entry.locked;
  });
}

/** Drag targets of handles on shown, unlocked curves, captured at press time. */
export function handleTargets(
  scene: GraphScene,
  handles: readonly { readonly key: KeyId; readonly side: 'in' | 'out' }[],
): HandleTarget[] {
  const targets: HandleTarget[] = [];
  for (const { key, side } of handles) {
    const found = scene.curves.byKey.get(key);
    if (found === undefined || found.entry.locked) continue;
    const { entry, index } = found;
    const c = entry.compiled;
    const record = entry.keys[index];
    if (record === undefined) continue;
    const p = handlePosition(scene, entry, index, side, { x: 0, y: 0 });
    const neighbour = side === 'in' ? index - 1 : index + 1;
    const span =
      neighbour >= 0 && neighbour < c.keyCount ? Math.abs((c.t[neighbour] as number) - (c.t[index] as number)) : null;
    targets.push({
      key,
      curve: entry.id,
      side,
      keyX: keyX(scene, entry, index),
      keyY: keyY(scene, entry, index),
      handleX: p.x,
      handleY: p.y,
      scale: entry.scale,
      weighted: c.weighted,
      weightLocked: record.weightLocked,
      dt: (side === 'in' ? c.inDt[index] : c.outDt[index]) as number,
      span,
    });
  }
  return targets;
}

/** Moves the selected keys, or the selected handles when no key part is selected (MMB, Move tool). */
export function selectionGesture(
  ctx: PressContext,
  start: GesturePointer,
  selection: ReadonlyMap<KeyId, KeyPartSelection>,
): Gesture | null {
  const scene = ctx.scene();
  const keys = draggableKeys(scene, selection);
  if (keys.length > 0) return new KeyMoveGesture(ctx.gestures, start, keys);
  const targets = handleTargets(scene, selectedHandleParts(selection));
  return targets.length > 0 ? new HandleDragGesture(ctx.gestures, start, targets) : null;
}

/** Keys inside a marquee; when none, the shown handles inside it (Maya). */
export function marqueeItems(scene: GraphScene, rect: ScreenRect, scratch: HitScratch): KeySelectItems {
  const keys = keysInRect(scene, rect);
  if (keys.length > 0) return keys.map((key) => ({ key, parts: KEY_PART }));
  return handlesInRect(scene, rect, scratch).map(({ key, side }) => ({ key, parts: handlePart(side) }));
}

/** MMB press: a drag anywhere moves the current key/handle selection; a click does nothing. */
export function middlePress(ctx: PressContext, start: GesturePointer): PendingPress {
  return { start, drag: () => selectionGesture(ctx, start, ctx.app.session.getState().selection.keys), click: null };
}

/**
 * Select/Move tool press: a click selects keys or handles with the modifiers (a click on empty space or a curve
 * segment clears the selection), a double-click on a curve or key selects all keys of its curve, a drag on a
 * selected or just-selected key/handle moves the selection, a drag elsewhere draws a marquee (`empty: 'marquee'`)
 * or moves the current selection (`empty: 'move'`).
 */
export function defaultPress(
  ctx: PressContext,
  start: GesturePointer,
  clicks: number,
  empty: 'marquee' | 'move',
): PendingPress {
  const hit = ctx.hitTest(start.x, start.y);
  const mode = selectModeFor(start);
  const current = ctx.app.session.getState().selection.keys;
  if (clicks >= 2 && (hit.kind === 'curve' || hit.kind === 'key')) {
    ctx.selectCurveKeys(hit.curve, mode);
    return { start, drag: null, click: null };
  }
  if (hit.kind === 'key' || hit.kind === 'handle') {
    const parts = hit.kind === 'key' ? KEY_PART : handlePart(hit.side);
    const isSelected = (selection: ReadonlyMap<KeyId, KeyPartSelection>): boolean =>
      hit.kind === 'key' ? selection.get(hit.key)?.key === true : selection.get(hit.key)?.[hit.side] === true;
    // Pressing an already selected part keeps the selection so it can be dragged; a click without a drag then
    // narrows the selection to that part (Maya).
    const deferred = mode === 'replace' && isSelected(current);
    const predicted = deferred ? current : applyKeySelection(current, [{ key: hit.key, parts }], mode);
    if (!deferred) ctx.selectKeys([{ key: hit.key, parts }], mode);
    const item = [{ key: hit.key, parts }];
    return {
      start,
      drag: isSelected(predicted) ? () => selectionGesture(ctx, start, keyOrHandleParts(predicted, hit.kind)) : null,
      click: deferred ? () => ctx.selectKeys(item, 'replace') : null,
    };
  }
  const clear = mode === 'replace' ? () => ctx.selectKeys([], 'replace') : null;
  if (empty === 'move' && current.size > 0) {
    return { start, drag: () => selectionGesture(ctx, start, current), click: clear };
  }
  return {
    start,
    drag: () =>
      new MarqueeGesture(ctx.gestures, start, mode, (rect) => marqueeItems(ctx.scene(), rect, ctx.hitScratch)),
    click: clear,
  };
}

/** A press on a key drags the selected keys; a press on a handle drags the selected handles only. */
function keyOrHandleParts(
  selection: ReadonlyMap<KeyId, KeyPartSelection>,
  kind: 'key' | 'handle',
): ReadonlyMap<KeyId, KeyPartSelection> {
  if (kind === 'key') return selection;
  const handles = new Map<KeyId, KeyPartSelection>();
  for (const [key, parts] of selection) {
    if (parts.in || parts.out) handles.set(key, { key: false, in: parts.in, out: parts.out });
  }
  return handles;
}

/** Insert tool press on a curve: a click inserts a shape-preserving key at the hit frame. */
export function insertPress(
  ctx: PressContext,
  start: GesturePointer,
  hit: Extract<GraphHit, { readonly kind: 'curve' }>,
): PendingPress {
  return { start, drag: null, click: () => ctx.insertKey(hit.curve, hit.frame) };
}
