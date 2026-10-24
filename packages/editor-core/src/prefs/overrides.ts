// The effective-preferences layer (STUDIO-TOUCH-SPEC §16.4, §20.3 item 16, §20.4; ST-20): removable session
// overrides over the stored preferences. `overridePrefs(app.prefs, layer, patch)` lays `patch` over the preferences
// until its disposer runs. Readers (`getState`, `subscribe`) see the effective value base ⊕ device ⊕ shell; the
// persistence (`savePrefs`) writes only the base, so an override never reaches storage and is gone when it is removed.
//
// - Layers: `device` (the host's per-device memory profile, for the page's life) under `shell` (a mounted shell's
//   session settings, removed on unmount). Within a layer, a later patch wins.
// - Patches are deep: a nested object merges field by field (`{ modeling: { undoBudgetMB: 96 } }` leaves every other
//   modeling field to the base); arrays and other values replace.
// - The layer installs itself on the store at the first override and leaves it when the last one is removed: until
//   then, and after, the store is untouched (a page without overrides behaves exactly as before).
// - While installed, `setState` writes the base and publishes the effective state. A write of an overridden field
//   lands in the base and shows once the override goes. A write that only carries the shown (overridden) value back —
//   `setState({ modeling: { ...getState().modeling, gridStep } })` — keeps the base's own value for that field.
import type { Disposer } from '@ekza-studio/anim-core';
import type { StoreApi } from 'zustand/vanilla';
import type { Prefs } from '../types';

export type PrefsLayer = 'device' | 'shell';

/** A deep partial of a preferences value: nested objects merge field by field, arrays and scalars replace. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { readonly [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export type PrefsPatch = DeepPartial<Prefs>;

/** Lowest first: a shell override wins over the device profile. */
const LAYER_ORDER: readonly PrefsLayer[] = ['device', 'shell'];

interface Entry {
  readonly layer: PrefsLayer;
  readonly patch: PrefsPatch;
}

interface Layered {
  base: Prefs;
  readonly entries: Entry[];
  readonly setState: StoreApi<Prefs>['setState'];
}

const layered = new WeakMap<StoreApi<Prefs>, Layered>();
/** Effective state object → the base it was composed from (`savePrefs` writes the base). */
const bases = new WeakMap<object, Prefs>();

type Plain = Readonly<Record<string, unknown>>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `patch` laid over `value` (deep for plain objects). */
function lay(value: unknown, patch: unknown): unknown {
  if (patch === undefined) return value;
  if (!isPlain(patch) || !isPlain(value)) return patch;
  const out: Record<string, unknown> = { ...value };
  for (const key of Object.keys(patch)) out[key] = lay(value[key], patch[key]);
  return out;
}

/** Every patch of `entries` merged in layer order (undefined when there is none). */
function overlayOf(entries: readonly Entry[]): Plain | undefined {
  let overlay: unknown;
  for (const layer of LAYER_ORDER) {
    for (const entry of entries) if (entry.layer === layer) overlay = lay(overlay ?? {}, entry.patch);
  }
  return overlay as Plain | undefined;
}

/**
 * The base value after a write of `written` where `overlay` overrides: a field the overlay overrides keeps the
 * base's value when the write carries the shown value back, and takes the written value otherwise.
 */
function rebase(base: unknown, shown: unknown, written: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return written;
  if (isPlain(overlay)) {
    if (!isPlain(written)) return written;
    const out: Record<string, unknown> = { ...written };
    for (const key of Object.keys(overlay)) {
      if (!Object.hasOwn(written, key)) continue;
      out[key] = rebase(
        isPlain(base) ? base[key] : undefined,
        isPlain(shown) ? shown[key] : undefined,
        written[key],
        overlay[key],
      );
    }
    return out;
  }
  return Object.is(written, shown) ? base : written;
}

/** `next` with every plain object that equals its counterpart in `previous` replaced by that object. */
function share(previous: unknown, next: unknown): unknown {
  if (Object.is(previous, next) || !isPlain(previous) || !isPlain(next)) return next;
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(previous).length;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = share(previous[key], next[key]);
    if (same && !(Object.hasOwn(previous, key) && Object.is(out[key], previous[key]))) same = false;
  }
  return same ? previous : out;
}

function publish(store: StoreApi<Prefs>, state: Layered, baseChanged: boolean): void {
  const shown = store.getState();
  const composed = share(shown, lay(state.base, overlayOf(state.entries))) as Prefs;
  if (composed === shown && !baseChanged) return;
  // A new top-level object even when only the base moved: the store's subscribers persist the base.
  const effective = composed === shown ? { ...composed } : composed;
  bases.set(effective, state.base);
  state.setState(effective, true);
}

function install(store: StoreApi<Prefs>): Layered {
  const existing = layered.get(store);
  if (existing !== undefined) return existing;
  const state: Layered = { base: store.getState(), entries: [], setState: store.setState };
  const write = (partial: Prefs | Partial<Prefs> | ((prefs: Prefs) => Prefs | Partial<Prefs>), replace?: boolean) => {
    const shown = store.getState();
    const written = typeof partial === 'function' ? partial(shown) : partial;
    if (Object.is(written, shown)) return;
    const overlay = overlayOf(state.entries);
    const next: Record<string, unknown> = replace === true ? {} : { ...state.base };
    for (const key of Object.keys(written)) {
      next[key] = rebase(
        (state.base as unknown as Plain)[key],
        (shown as unknown as Plain)[key],
        (written as Plain)[key],
        overlay?.[key],
      );
    }
    const base = share(state.base, next) as Prefs;
    const changed = base !== state.base;
    state.base = base;
    publish(store, state, changed);
  };
  store.setState = write;
  layered.set(store, state);
  return state;
}

function uninstall(store: StoreApi<Prefs>, state: Layered): void {
  store.setState = state.setState;
  layered.delete(store);
}

/**
 * Lays `patch` over the preferences in `layer` until the returned disposer runs (calling it again does nothing).
 * The store's subscribers see the effective preferences change at once, and again when the override is removed.
 */
export function overridePrefs(store: StoreApi<Prefs>, layer: PrefsLayer, patch: PrefsPatch): Disposer {
  const state = install(store);
  const entry: Entry = { layer, patch };
  state.entries.push(entry);
  publish(store, state, false);
  return () => {
    const index = state.entries.indexOf(entry);
    if (index === -1) return;
    state.entries.splice(index, 1);
    publish(store, state, false);
    if (state.entries.length === 0 && layered.get(store) === state) uninstall(store, state);
  };
}

/** The base (stored) preferences of an effective preferences value; the value itself when nothing overrides it. */
export function basePrefs(prefs: Prefs): Prefs {
  return bases.get(prefs) ?? prefs;
}

/** The layers that override the store's preferences now (empty when none). */
export function prefsOverrideLayers(store: StoreApi<Prefs>): readonly PrefsLayer[] {
  const state = layered.get(store);
  if (state === undefined) return [];
  return LAYER_ORDER.filter((layer) => state.entries.some((entry) => entry.layer === layer));
}
