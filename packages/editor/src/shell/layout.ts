// The Animate workspace layout (research 09 §2, §9): default dock arrangement and its persistence. Pure helpers over
// dockview's API and serialized JSON; the stored layout is versioned and every storage access is guarded.
import { PANEL, type PanelKind, type PrefsStorage } from '@ekza-animator/editor-core';
import type { AddPanelOptions, DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview-react';

export const WORKSPACE_ID = 'animate';
export const LAYOUT_SCHEMA_VERSION = 1;
/** research 09 §9.2: `ekza-animator:layout:v1:<workspace>`. */
export const layoutStorageKey = (workspace: string = WORKSPACE_ID): string =>
  `ekza-animator:layout:v${LAYOUT_SCHEMA_VERSION}:${workspace}`;

/** Content component used for a panel kind that is not registered in this build. */
export const PLACEHOLDER_COMPONENT = 'ekza.placeholder';

export type DockSlot = 'left' | 'center' | 'right' | 'bottom';

/** Dock slots of the Animate workspace (MVP-SPEC §7 WP-8): left Outliner | Clips, centre Viewport, right Channel Box
 *  | Attributes, bottom Graph Editor. The timeline is fixed chrome below the docks, not a dock panel. */
export const ANIMATE_SLOTS: readonly { readonly kind: PanelKind; readonly slot: DockSlot; readonly title: string }[] = [
  { kind: PANEL.viewport, slot: 'center', title: 'Viewport' },
  { kind: PANEL.outliner, slot: 'left', title: 'Outliner' },
  { kind: PANEL.clips, slot: 'left', title: 'Clips' },
  { kind: PANEL.channelBox, slot: 'right', title: 'Channel Box' },
  { kind: PANEL.attributes, slot: 'right', title: 'Attributes' },
  { kind: PANEL.graph, slot: 'bottom', title: 'Graph Editor' },
];

/** Panel kinds rendered outside dockview (fixed regions). */
export const FIXED_KINDS: ReadonlySet<PanelKind> = new Set([PANEL.timeline]);

export const DOCK_SIZES = { left: 240, right: 280, bottomFraction: 0.36, bottomMin: 160 } as const;

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

  const graph = entry(PANEL.graph);
  if (graph !== null) {
    api.addPanel(
      addOptions(graph, {
        position: { direction: 'below' },
        initialHeight: Math.max(DOCK_SIZES.bottomMin, Math.round(height * DOCK_SIZES.bottomFraction)),
      }),
    );
  }
  center?.api.setActive();
}

/** Adds a closed panel back into its default dock (next to a sibling of the same slot when one is open). */
export function addPanelToDefaultDock(api: DockviewApi, entry: PanelComponent): IDockviewPanel {
  const slot = ANIMATE_SLOTS.find((candidate) => candidate.kind === entry.kind)?.slot ?? 'center';
  const siblings = ANIMATE_SLOTS.filter((candidate) => candidate.slot === slot).map((candidate) => candidate.kind);
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
  | { readonly kind: 'reset'; readonly reason: 'newer' | 'invalid' };

/** Reads and validates the stored layout. Any parse or shape problem is 'invalid' (the default layout is used). */
export function readStoredLayout(storage: PrefsStorage | null, workspace: string = WORKSPACE_ID): StoredLayoutResult {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(layoutStorageKey(workspace)) ?? null;
  } catch {
    return { kind: 'none' };
  }
  if (raw === null || raw === '') return { kind: 'none' };
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
  if (stored.schemaVersion > LAYOUT_SCHEMA_VERSION) return { kind: 'reset', reason: 'newer' };
  if (
    stored.schemaVersion !== LAYOUT_SCHEMA_VERSION ||
    stored.workspace !== workspace ||
    !isSerializedDockview(stored.dockview)
  ) {
    return { kind: 'reset', reason: 'invalid' };
  }
  return { kind: 'ok', layout: stored.dockview };
}

export function writeStoredLayout(
  storage: PrefsStorage | null,
  dockview: SerializedDockview,
  workspace: string = WORKSPACE_ID,
): void {
  if (storage === null) return;
  const stored: StoredLayout = { schemaVersion: LAYOUT_SCHEMA_VERSION, workspace, dockview };
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
