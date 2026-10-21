// Layout presets for focused work (docs/LAYOUT-PRESETS.md): a preset is a dock layout, the chrome visibility (tool
// strip, help line, time slider) and the viewport pane layout. Four built-ins ship (Animate, Blocking, Polish, Review
// on Alt+1…4); users save their own per workspace under `ekza-animator:presets:v1:<workspace>`. Every storage access
// is guarded: with storage blocked (or a write failing) the presets live for the session only.
import type { Disposer } from '@ekza-studio/anim-core';
import type { PrefsStorage, ViewportLayout } from '@ekza-studio/editor-core';
import type { SerializedDockview } from 'dockview-react';
import { type ChromeVisibility, isSerializedDockview, type PresetDock, parseChrome } from './layout';

export type BuiltinPresetId = 'animate' | 'blocking' | 'polish' | 'review';

export interface BuiltinPreset {
  readonly id: BuiltinPresetId;
  readonly label: string;
  readonly description: string;
  readonly dock: PresetDock;
  /** The chrome the preset sets (replaces the toggles; absent parts = the workspace's default). */
  readonly chrome: Partial<ChromeVisibility>;
  /** The viewport pane layout; null = the workspace's default (and its maximized pane). */
  readonly viewportLayout: ViewportLayout | null;
  /** Only Animate-style workspaces have a time slider and a Graph Editor; Model offers the default preset only. */
  readonly animateOnly: boolean;
}

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    id: 'animate',
    label: 'Animate',
    description: 'The default layout of the workspace',
    dock: 'default',
    chrome: {},
    viewportLayout: null,
    animateOnly: false,
  },
  {
    id: 'blocking',
    label: 'Blocking',
    description: 'One single-pane viewport and the time slider',
    dock: 'viewport',
    chrome: { toolbar: true, helpLine: true, timeline: true },
    viewportLayout: 'single',
    animateOnly: true,
  },
  {
    id: 'polish',
    label: 'Polish',
    description: 'The viewport over a large Graph Editor, and the time slider',
    dock: 'viewportOverGraph',
    chrome: { toolbar: true, helpLine: true, timeline: true },
    viewportLayout: 'single',
    animateOnly: true,
  },
  {
    id: 'review',
    label: 'Review',
    description: 'The viewport across the window with the playback controls only',
    dock: 'viewport',
    chrome: { toolbar: false, helpLine: false, timeline: true },
    viewportLayout: 'single',
    animateOnly: true,
  },
];

export function builtinPreset(id: unknown): BuiltinPreset | undefined {
  return BUILTIN_PRESETS.find((preset) => preset.id === id);
}

/** A preset the user saved: what the workspace looked like when it was saved. */
export interface UserPreset {
  readonly id: string;
  readonly name: string;
  readonly dockview: SerializedDockview;
  readonly chrome: Partial<ChromeVisibility>;
  readonly viewportLayout: ViewportLayout;
  readonly maximizedPane: string | null;
  readonly savedAt: number;
}

export type UserPresetData = Omit<UserPreset, 'id' | 'name' | 'savedAt'>;

export const PRESETS_SCHEMA_VERSION = 1;
/** The `ekza-animator:` prefix is kept from the old name (DECISIONS-OPEN NAME-1) so saved presets survive the rename. */
export const presetsStorageKey = (workspace: string): string =>
  `ekza-animator:presets:v${PRESETS_SCHEMA_VERSION}:${workspace}`;
export const PRESET_NAME_MAX = 60;

const VIEWPORT_LAYOUTS: ReadonlySet<string> = new Set(['single', 'split', 'quad', 'rig-side', 'rig-markers']);

/** Why `name` cannot name a preset, or null. */
export function presetNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim() === '') return 'Give the preset a name';
  if (name.trim().length > PRESET_NAME_MAX) return `Preset names are at most ${PRESET_NAME_MAX} characters`;
  return null;
}

function parsePreset(value: unknown): UserPreset | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Partial<Record<keyof UserPreset, unknown>>;
  if (typeof record.id !== 'string' || record.id === '' || presetNameProblem(record.name) !== null) return null;
  if (!isSerializedDockview(record.dockview)) return null;
  if (typeof record.viewportLayout !== 'string' || !VIEWPORT_LAYOUTS.has(record.viewportLayout)) return null;
  return {
    id: record.id,
    name: (record.name as string).trim(),
    dockview: record.dockview,
    chrome: parseChrome(record.chrome) ?? {},
    viewportLayout: record.viewportLayout as ViewportLayout,
    maximizedPane: typeof record.maximizedPane === 'string' ? record.maximizedPane : null,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
  };
}

/** Reads the stored presets of a workspace; unreadable entries are dropped, a broken or newer file reads as none. */
export function readStoredPresets(storage: PrefsStorage | null, workspace: string): readonly UserPreset[] {
  let raw: string | null;
  try {
    raw = storage?.getItem(presetsStorageKey(workspace)) ?? null;
  } catch {
    return [];
  }
  if (raw === null || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const file = parsed as { schemaVersion?: unknown; presets?: unknown } | null;
  if (typeof file !== 'object' || file === null || file.schemaVersion !== PRESETS_SCHEMA_VERSION) return [];
  if (!Array.isArray(file.presets)) return [];
  const out: UserPreset[] = [];
  for (const entry of file.presets) {
    const preset = parsePreset(entry);
    if (preset !== null && !out.some((other) => other.id === preset.id)) out.push(preset);
  }
  return out;
}

export interface LayoutPresetStore {
  /** The user's presets of a workspace, in the order they were first saved. */
  list(workspace: string): readonly UserPreset[];
  get(workspace: string, id: string): UserPreset | undefined;
  /** Saves under `name`; a preset of the same name (any case) is replaced and keeps its id. */
  save(workspace: string, name: string, data: UserPresetData): UserPreset;
  rename(workspace: string, id: string, name: string): UserPreset | undefined;
  remove(workspace: string, id: string): boolean;
  /** False when presets cannot be remembered across reloads (storage blocked, or the last write failed). */
  persistent(): boolean;
  subscribe(listener: () => void): Disposer;
}

export function createLayoutPresetStore(
  storage: PrefsStorage | null,
  opts: { readonly now?: () => number } = {},
): LayoutPresetStore {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, readonly UserPreset[]>();
  const listeners = new Set<() => void>();
  let writable = storage !== null;
  let counter = 0;

  const list = (workspace: string): readonly UserPreset[] => {
    let presets = cache.get(workspace);
    if (presets === undefined) {
      presets = readStoredPresets(storage, workspace);
      cache.set(workspace, presets);
    }
    return presets;
  };

  const commit = (workspace: string, presets: readonly UserPreset[]): void => {
    cache.set(workspace, presets);
    if (storage !== null) {
      try {
        storage.setItem(
          presetsStorageKey(workspace),
          JSON.stringify({ schemaVersion: PRESETS_SCHEMA_VERSION, workspace, presets }),
        );
        writable = true;
      } catch {
        writable = false; // quota or blocked: kept for this session
      }
    }
    for (const listener of listeners) listener();
  };

  const nextId = (workspace: string): string => {
    const taken = new Set(list(workspace).map((preset) => preset.id));
    let id: string;
    do {
      counter += 1;
      id = `user-${now().toString(36)}-${counter.toString(36)}`;
    } while (taken.has(id));
    return id;
  };

  return {
    list,
    get: (workspace, id) => list(workspace).find((preset) => preset.id === id),
    save(workspace, name, data) {
      const problem = presetNameProblem(name);
      if (problem !== null) throw new Error(problem);
      const trimmed = name.trim();
      const presets = list(workspace);
      const existing = presets.find((preset) => preset.name.toLowerCase() === trimmed.toLowerCase());
      const preset: UserPreset = { ...data, id: existing?.id ?? nextId(workspace), name: trimmed, savedAt: now() };
      commit(
        workspace,
        existing === undefined ? [...presets, preset] : presets.map((other) => (other === existing ? preset : other)),
      );
      return preset;
    },
    rename(workspace, id, name) {
      const problem = presetNameProblem(name);
      if (problem !== null) throw new Error(problem);
      const presets = list(workspace);
      const target = presets.find((preset) => preset.id === id);
      if (target === undefined) return undefined;
      const trimmed = name.trim();
      const clash = presets.find((preset) => preset.id !== id && preset.name.toLowerCase() === trimmed.toLowerCase());
      if (clash !== undefined) throw new Error(`A preset named '${clash.name}' already exists`);
      const renamed: UserPreset = { ...target, name: trimmed };
      commit(
        workspace,
        presets.map((preset) => (preset === target ? renamed : preset)),
      );
      return renamed;
    },
    remove(workspace, id) {
      const presets = list(workspace);
      if (!presets.some((preset) => preset.id === id)) return false;
      commit(
        workspace,
        presets.filter((preset) => preset.id !== id),
      );
      return true;
    },
    persistent: () => writable,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
