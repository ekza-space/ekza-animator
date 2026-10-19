// Workspace dock layouts (research 09 §2, §9; M6A-SPEC §4.8, §8.2): the default dock arrangement of each workspace
// and its persistence. Pure helpers over dockview's API and serialized JSON; each workspace's layout is stored under
// its own versioned key (`ekza-animator:layout:v<N>:<workspace>`: Animate v2, Model v1) and every storage access is
// guarded.
import { PANEL, type PanelKind, type PrefsStorage } from '@ekza-animator/editor-core';
import type { AddPanelOptions, DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview-react';

export const WORKSPACE_ID = 'animate';
/** 2 since M2a: the Animate layout has a Dope Sheet tab beside the Graph Editor (M2A-SPEC §4.8). */
export const LAYOUT_SCHEMA_VERSION = 2;
/** Layout versions per workspace (M6A-SPEC §4.8): Animate keeps v2, Model starts at v1. */
export const LAYOUT_VERSIONS: Readonly<Record<string, number>> = { animate: LAYOUT_SCHEMA_VERSION, model: 1 };
/** The layout version of a workspace (workspaces without their own layout use Animate's). */
export const layoutVersion = (workspace: string): number => LAYOUT_VERSIONS[workspace] ?? LAYOUT_SCHEMA_VERSION;
/** research 09 §9.2: `ekza-animator:layout:v<version>:<workspace>`; the key carries the version. */
export const layoutStorageKey = (
  workspace: string = WORKSPACE_ID,
  version: number = layoutVersion(workspace),
): string => `ekza-animator:layout:v${version}:${workspace}`;
/** The M1 key (`ekza-animator:layout:v1:<workspace>`), read once by the v1 → v2 migration and never written. */
export const layoutStorageKeyV1 = (workspace: string = WORKSPACE_ID): string => layoutStorageKey(workspace, 1);

/** Content component used for a panel kind that is not registered in this build. */
export const PLACEHOLDER_COMPONENT = 'ekza.placeholder';

export type DockSlot = 'left' | 'center' | 'right' | 'bottom';

/** Dock slots of the Animate workspace (MVP-SPEC §7 WP-8, M2A-SPEC §4.8): left Outliner | Clips, centre Viewport,
 *  right Channel Box | Attributes, bottom Graph Editor | Dope Sheet (an inactive tab). The timeline is fixed chrome
 *  below the docks, not a dock panel. */
export const ANIMATE_SLOTS: readonly { readonly kind: PanelKind; readonly slot: DockSlot; readonly title: string }[] = [
  { kind: PANEL.viewport, slot: 'center', title: 'Viewport' },
  { kind: PANEL.outliner, slot: 'left', title: 'Outliner' },
  { kind: PANEL.clips, slot: 'left', title: 'Clips' },
  { kind: PANEL.channelBox, slot: 'right', title: 'Channel Box' },
  { kind: PANEL.attributes, slot: 'right', title: 'Attributes' },
  { kind: PANEL.graph, slot: 'bottom', title: 'Graph Editor' },
  { kind: PANEL.dopeSheet, slot: 'bottom', title: 'Dope Sheet' },
];

/** M6a panel kinds (§4.8 `PANEL` additions; registered by B10, B11, B13 as lazy chunks). */
export const MODEL_PANEL = { toolkit: 'toolkit', palette: 'palette', meshCheck: 'meshCheck' } as const;

/** Dock slots of the Model workspace (§8.2): left Outliner, centre Viewport, right Toolkit (first tab) | Channel Box |
 *  Attributes | Palette, bottom Mesh Check (collapsed to its tab strip). The time slider is hidden. */
export const MODEL_SLOTS: readonly { readonly kind: PanelKind; readonly slot: DockSlot; readonly title: string }[] = [
  { kind: PANEL.viewport, slot: 'center', title: 'Viewport' },
  { kind: PANEL.outliner, slot: 'left', title: 'Outliner' },
  { kind: MODEL_PANEL.toolkit, slot: 'right', title: 'Toolkit' },
  { kind: PANEL.channelBox, slot: 'right', title: 'Channel Box' },
  { kind: PANEL.attributes, slot: 'right', title: 'Attributes' },
  { kind: MODEL_PANEL.palette, slot: 'right', title: 'Palette' },
  { kind: MODEL_PANEL.meshCheck, slot: 'bottom', title: 'Mesh Check' },
];

/** The dock slots of a workspace's layout (Model's, else Animate's). */
export function slotsOf(workspace: string): typeof ANIMATE_SLOTS {
  return workspace === 'model' ? MODEL_SLOTS : ANIMATE_SLOTS;
}

/** Every panel kind a workspace layout may place (for titles and placeholders). */
export const ALL_SLOTS: typeof ANIMATE_SLOTS = [
  ...ANIMATE_SLOTS,
  ...MODEL_SLOTS.filter((slot) => !ANIMATE_SLOTS.some((other) => other.kind === slot.kind)),
];

/** Panel kinds rendered outside dockview (fixed regions). */
export const FIXED_KINDS: ReadonlySet<PanelKind> = new Set([PANEL.timeline]);

export const DOCK_SIZES = { left: 240, right: 280, bottomFraction: 0.36, bottomMin: 160 } as const;
/** Model's docks (§8.2): Outliner 240 px, right dock 300 px, Mesh Check collapsed to its tab strip. */
export const MODEL_DOCK_SIZES = { left: 240, right: 300, bottom: 34 } as const;

/** How the layout shows a panel kind: its registered component, or the placeholder. */
export interface PanelComponent {
  readonly kind: PanelKind;
  readonly component: string;
  readonly title: string;
}

export interface PanelParams {
  readonly kind: PanelKind;
  readonly [key: string]: unknown;
}

/** `params.kind` of a dockview panel or serialized panel state (dockview types params as `any`). */
export function kindOfParams(params: unknown): PanelKind | null {
  if (typeof params !== 'object' || params === null) return null;
  const kind = (params as Readonly<Record<string, unknown>>)['kind'];
  return typeof kind === 'string' ? kind : null;
}

export function kindOfPanel(panel: IDockviewPanel): PanelKind | null {
  return kindOfParams(panel.params);
}

function addOptions(
  entry: PanelComponent,
  extra: Partial<AddPanelOptions<PanelParams>> = {},
): AddPanelOptions<PanelParams> {
  return {
    id: entry.kind,
    component: entry.component,
    title: entry.title,
    params: { kind: entry.kind },
    ...extra,
  };
}

/**
 * Builds the default Animate layout into an empty dockview. `resolve` returns the component of a kind (registered
 * panel or placeholder); kinds it returns null for are left out.
 */
export function buildAnimateLayout(
  api: DockviewApi,
  resolve: (kind: PanelKind) => PanelComponent | null,
  height: number,
): void {
  const entry = (kind: PanelKind): PanelComponent | null => resolve(kind);
  const viewportEntry = entry(PANEL.viewport);
  const center = viewportEntry === null ? null : api.addPanel(addOptions(viewportEntry));

  const dock = (kinds: readonly PanelKind[], direction: 'left' | 'right', width: number): void => {
    let first: IDockviewPanel | null = null;
    for (const kind of kinds) {
      const e = entry(kind);
      if (e === null) continue;
      if (first === null) {
        const position = center === null ? { direction } : { referencePanel: center, direction };
        first = api.addPanel(addOptions(e, { position, initialWidth: width }));
      } else {
        api.addPanel(addOptions(e, { position: { referencePanel: first, direction: 'within' }, inactive: true }));
      }
    }
  };
  dock([PANEL.outliner, PANEL.clips], 'left', DOCK_SIZES.left);
  dock([PANEL.channelBox, PANEL.attributes], 'right', DOCK_SIZES.right);

  // Bottom dock: the Graph Editor with the Dope Sheet as an inactive tab of its group (M2A-SPEC §4.8).
  let bottom: IDockviewPanel | null = null;
  for (const kind of [PANEL.graph, PANEL.dopeSheet]) {
    const e = entry(kind);
    if (e === null) continue;
    if (bottom === null) {
      bottom = api.addPanel(
        addOptions(e, {
          position: { direction: 'below' },
          initialHeight: Math.max(DOCK_SIZES.bottomMin, Math.round(height * DOCK_SIZES.bottomFraction)),
        }),
      );
    } else {
      api.addPanel(addOptions(e, { position: { referencePanel: bottom, direction: 'within' }, inactive: true }));
    }
  }
  center?.api.setActive();
}

/**
 * Builds the default Model layout (M6A-SPEC §8.2) into an empty dockview: the viewport in the centre, the Outliner on
 * the left, Toolkit (active) | Channel Box | Attributes | Palette on the right and Mesh Check below, collapsed.
 */
export function buildModelLayout(api: DockviewApi, resolve: (kind: PanelKind) => PanelComponent | null): void {
  const viewportEntry = resolve(PANEL.viewport);
  const center = viewportEntry === null ? null : api.addPanel(addOptions(viewportEntry));
  const dock = (
    kinds: readonly PanelKind[],
    direction: 'left' | 'right' | 'below',
    size: { readonly initialWidth?: number; readonly initialHeight?: number },
  ): void => {
    let first: IDockviewPanel | null = null;
    for (const kind of kinds) {
      const e = resolve(kind);
      if (e === null) continue;
      if (first === null) {
        const position = center === null ? { direction } : { referencePanel: center, direction };
        first = api.addPanel(addOptions(e, { position, ...size }));
      } else {
        api.addPanel(addOptions(e, { position: { referencePanel: first, direction: 'within' }, inactive: true }));
      }
    }
  };
  dock([PANEL.outliner], 'left', { initialWidth: MODEL_DOCK_SIZES.left });
  dock([MODEL_PANEL.toolkit, PANEL.channelBox, PANEL.attributes, MODEL_PANEL.palette], 'right', {
    initialWidth: MODEL_DOCK_SIZES.right,
  });
  dock([MODEL_PANEL.meshCheck], 'below', { initialHeight: MODEL_DOCK_SIZES.bottom });
  center?.api.setActive();
}

/** Builds a workspace's default layout (Model's, else Animate's). */
export function buildWorkspaceLayout(
  workspace: string,
  api: DockviewApi,
  resolve: (kind: PanelKind) => PanelComponent | null,
  height: number,
): void {
  if (workspace === 'model') buildModelLayout(api, resolve);
  else buildAnimateLayout(api, resolve, height);
}

/**
 * Layout v1 → v2 (M2A-SPEC §4.8) on a restored M1 layout: the Dope Sheet joins the group that holds the Graph Editor
 * as an inactive tab (or a new bottom group when the Graph Editor was closed); the rest of the layout is kept.
 * Nothing happens when the layout already has a Dope Sheet or this build cannot show one.
 */
export function addDopeSheetTab(api: DockviewApi, resolve: (kind: PanelKind) => PanelComponent | null): void {
  if (api.panels.some((panel) => kindOfPanel(panel) === PANEL.dopeSheet)) return;
  const entry = resolve(PANEL.dopeSheet);
  if (entry === null) return;
  const graph = api.panels.find((panel) => kindOfPanel(panel) === PANEL.graph);
  if (graph !== undefined) {
    const id = api.getPanel(entry.kind) === undefined ? entry.kind : `${entry.kind}#${api.panels.length + 1}`;
    api.addPanel({
      ...addOptions(entry),
      id,
      position: { referencePanel: graph, direction: 'within' },
      inactive: true,
    } as AddPanelOptions<PanelParams>);
    return;
  }
  addPanelToDefaultDock(api, entry);
}

/** Adds a closed panel back into its default dock (next to a sibling of the same slot when one is open). */
export function addPanelToDefaultDock(
  api: DockviewApi,
  entry: PanelComponent,
  workspace: string = WORKSPACE_ID,
): IDockviewPanel {
  const slots = slotsOf(workspace);
  const slot =
    slots.find((candidate) => candidate.kind === entry.kind)?.slot ??
    ALL_SLOTS.find((candidate) => candidate.kind === entry.kind)?.slot ??
    'center';
  const siblings = slots.filter((candidate) => candidate.slot === slot).map((candidate) => candidate.kind);
  const sibling = api.panels.find((panel) => {
    const kind = kindOfPanel(panel);
    return kind !== null && siblings.includes(kind);
  });
  const id = api.getPanel(entry.kind) === undefined ? entry.kind : `${entry.kind}#${api.panels.length + 1}`;
  const viewport = api.panels.find((panel) => kindOfPanel(panel) === PANEL.viewport);
  const direction = slot === 'left' ? 'left' : slot === 'right' ? 'right' : slot === 'bottom' ? 'below' : 'within';
  const position =
    sibling !== undefined
      ? { referencePanel: sibling, direction: 'within' as const }
      : viewport !== undefined
        ? { referencePanel: viewport, direction }
        : { direction: direction === 'within' ? ('right' as const) : direction };
  return api.addPanel({ ...addOptions(entry), id, position } as AddPanelOptions<PanelParams>);
}

// ---------- persistence ----------

interface StoredLayout {
  readonly schemaVersion: number;
  readonly workspace: string;
  readonly dockview: SerializedDockview;
}

export type StoredLayoutResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly layout: SerializedDockview }
  /** M2a: no v2 layout, but a valid M1 (v1) layout under the v1 key: restore it, add the Dope Sheet, store as v2. */
  | { readonly kind: 'migrate'; readonly from: 1; readonly layout: SerializedDockview }
  | { readonly kind: 'reset'; readonly reason: 'newer' | 'invalid' };

/** Reads one stored layout text: `text` null when nothing is stored, `failed` when the storage threw. */
function readText(
  storage: PrefsStorage | null,
  key: string,
): { readonly text: string | null; readonly failed: boolean } {
  try {
    const raw = storage?.getItem(key) ?? null;
    return { text: raw === '' ? null : raw, failed: false };
  } catch {
    return { text: null, failed: true };
  }
}

/** Validates a stored layout of the expected version. */
function parseStored(raw: string, workspace: string, version: number): StoredLayoutResult {
  const current = layoutVersion(workspace);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'reset', reason: 'invalid' };
  }
  const stored = parsed as Partial<StoredLayout> | null;
  if (typeof stored !== 'object' || stored === null || typeof stored.schemaVersion !== 'number') {
    return { kind: 'reset', reason: 'invalid' };
  }
  if (stored.schemaVersion > current) return { kind: 'reset', reason: 'newer' };
  if (stored.schemaVersion !== version || stored.workspace !== workspace || !isSerializedDockview(stored.dockview)) {
    return { kind: 'reset', reason: 'invalid' };
  }
  return { kind: 'ok', layout: stored.dockview };
}

/**
 * Reads and validates the stored layout. Any parse or shape problem is 'invalid' (the default layout is used).
 * Without a v2 layout, a valid M1 layout under the v1 key is returned as 'migrate' (M2A-SPEC §4.8); the v1 key is
 * only read, never changed, so M1 apps keep their layout. Any other v1 problem resets (M1 rule).
 */
export function readStoredLayout(storage: PrefsStorage | null, workspace: string = WORKSPACE_ID): StoredLayoutResult {
  const current = readText(storage, layoutStorageKey(workspace));
  if (current.failed) return { kind: 'none' };
  if (current.text !== null) return parseStored(current.text, workspace, layoutVersion(workspace));
  // Only Animate has an older layout to migrate (M1's v1); Model starts at v1.
  if (workspace !== WORKSPACE_ID) return { kind: 'none' };
  const v1 = readText(storage, layoutStorageKeyV1(workspace));
  if (v1.failed || v1.text === null) return { kind: 'none' };
  const old = parseStored(v1.text, workspace, 1);
  return old.kind === 'ok' ? { kind: 'migrate', from: 1, layout: old.layout } : old;
}

export function writeStoredLayout(
  storage: PrefsStorage | null,
  dockview: SerializedDockview,
  workspace: string = WORKSPACE_ID,
): void {
  if (storage === null) return;
  const stored: StoredLayout = { schemaVersion: layoutVersion(workspace), workspace, dockview };
  try {
    storage.setItem(layoutStorageKey(workspace), JSON.stringify(stored));
  } catch {
    // Quota or blocked storage: the layout simply is not remembered.
  }
}

export function clearStoredLayout(storage: PrefsStorage | null, workspace: string = WORKSPACE_ID): void {
  if (storage === null) return;
  try {
    // PrefsStorage has no removeItem; an empty value reads as "no layout".
    storage.setItem(layoutStorageKey(workspace), '');
  } catch {
    // ignore
  }
}

function isSerializedDockview(value: unknown): value is SerializedDockview {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SerializedDockview>;
  return (
    typeof candidate.grid === 'object' &&
    candidate.grid !== null &&
    typeof candidate.panels === 'object' &&
    candidate.panels !== null
  );
}

/**
 * Maps a stored layout onto this build's panels: each panel's `params.kind` picks the registered component, or the
 * placeholder when that kind is not registered. Null when a panel has no kind (not written by this shell) or a
 * panel kind is a fixed region (never docked).
 */
export function reconcileLayout(
  layout: SerializedDockview,
  resolve: (kind: PanelKind) => PanelComponent | null,
): SerializedDockview | null {
  const panels: SerializedDockview['panels'] = {};
  for (const [id, state] of Object.entries(layout.panels)) {
    const kind = kindOfParams(state.params);
    if (kind === null || FIXED_KINDS.has(kind)) return null;
    const entry = resolve(kind);
    if (entry === null) return null;
    panels[id] = { ...state, contentComponent: entry.component, title: entry.title, params: { ...state.params, kind } };
  }
  if (layout.popoutGroups !== undefined && layout.popoutGroups.length > 0) return null;
  return { ...layout, panels };
}
