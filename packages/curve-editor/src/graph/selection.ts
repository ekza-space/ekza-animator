// Key-part selection rules shared by the Graph Editor gestures and `select.curveKeys` (research 09 §6.1): click
// replaces, Shift toggles, Mod removes, Mod+Shift adds.
import type { KeyId } from '@ekza-animator/doc';
import type { KeyPartSelection, SelectMode } from '@ekza-animator/editor-core';

export const KEY_PART: KeyPartSelection = { key: true, in: false, out: false };
export const NO_PARTS: KeyPartSelection = { key: false, in: false, out: false };

export function selectModeFor(e: { readonly shift: boolean; readonly mod: boolean }): SelectMode {
  if (e.mod && e.shift) return 'add';
  if (e.mod) return 'remove';
  if (e.shift) return 'toggle';
  return 'replace';
}

export interface KeySelectItem {
  readonly key: KeyId;
  readonly parts: KeyPartSelection;
}

const any = (p: KeyPartSelection): boolean => p.key || p.in || p.out;
const union = (a: KeyPartSelection, b: KeyPartSelection): KeyPartSelection => ({
  key: a.key || b.key,
  in: a.in || b.in,
  out: a.out || b.out,
});
const minus = (a: KeyPartSelection, b: KeyPartSelection): KeyPartSelection => ({
  key: a.key && !b.key,
  in: a.in && !b.in,
  out: a.out && !b.out,
});
const covers = (a: KeyPartSelection, b: KeyPartSelection): boolean =>
  (!b.key || a.key) && (!b.in || a.in) && (!b.out || a.out);

/**
 * The key selection after applying `items` with `mode`. Toggle works per item (an item whose parts are all selected
 * is removed, otherwise added) or, with `group`, for the items as a whole (all selected → remove all, else add all).
 */
export function applyKeySelection(
  current: ReadonlyMap<KeyId, KeyPartSelection>,
  items: readonly KeySelectItem[],
  mode: SelectMode,
  opts?: { readonly group?: boolean },
): Map<KeyId, KeyPartSelection> {
  const next = mode === 'replace' ? new Map<KeyId, KeyPartSelection>() : new Map(current);
  const add = (item: KeySelectItem): void => {
    const merged = union(next.get(item.key) ?? NO_PARTS, item.parts);
    if (any(merged)) next.set(item.key, merged);
  };
  const remove = (item: KeySelectItem): void => {
    const existing = next.get(item.key);
    if (existing === undefined) return;
    const left = minus(existing, item.parts);
    if (any(left)) next.set(item.key, left);
    else next.delete(item.key);
  };
  const selected = (item: KeySelectItem): boolean => covers(current.get(item.key) ?? NO_PARTS, item.parts);
  switch (mode) {
    case 'replace':
    case 'add':
      for (const item of items) add(item);
      break;
    case 'remove':
      for (const item of items) remove(item);
      break;
    case 'toggle':
      if (opts?.group === true) {
        const all = items.length > 0 && items.every(selected);
        for (const item of items) (all ? remove : add)(item);
      } else {
        for (const item of items) (selected(item) ? remove : add)(item);
      }
      break;
  }
  return next;
}

/** Keys whose key part is selected, in selection order. */
export function selectedKeyParts(selection: ReadonlyMap<KeyId, KeyPartSelection>): KeyId[] {
  const keys: KeyId[] = [];
  for (const [key, parts] of selection) if (parts.key) keys.push(key);
  return keys;
}

/** Selected handle parts (in or out) of keys, in selection order. */
export function selectedHandleParts(
  selection: ReadonlyMap<KeyId, KeyPartSelection>,
): { readonly key: KeyId; readonly side: 'in' | 'out' }[] {
  const handles: { key: KeyId; side: 'in' | 'out' }[] = [];
  for (const [key, parts] of selection) {
    if (parts.in) handles.push({ key, side: 'in' });
    if (parts.out) handles.push({ key, side: 'out' });
  }
  return handles;
}

export function sameKeySelection(
  a: ReadonlyMap<KeyId, KeyPartSelection>,
  b: ReadonlyMap<KeyId, KeyPartSelection>,
): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, parts] of a) {
    const other = b.get(key);
    if (other === undefined || other.key !== parts.key || other.in !== parts.in || other.out !== parts.out)
      return false;
  }
  return true;
}
