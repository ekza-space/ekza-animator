// Menu bar model (research 09 §4.1; ADR 0008): built from the menu registry, with enabled state from operator polls
// and shortcut labels from the keymap. Pure functions over the EditorApp, so the React menu bar stays thin.
//
// M6a (M6A-SPEC §8.1, §8.3; B0b): menu sets per workspace. An item with `workspaces` is listed only there (items
// without it everywhere), an item with `modes` only in those component modes; a workspace's `menus` order its menu
// bar and drop the other known menus (Model shows no Key or Pose menu). Shortcut labels name the chord that runs the
// item where the menu was opened (`Mod+Shift+E` for Export in Model, where `Mod+E` extrudes).
import {
  type EditorApp,
  type KeyBinding,
  type KeymapManager,
  type KeyScope,
  type MenuItemDef,
  type OperatorId,
  type RunContext,
  resolveChord,
  WORKSPACE,
  type WorkspaceId,
} from '@ekza-studio/editor-core';
import { scopeChain } from '../input/keyboard';

/** Menu-bar order and labels of known top-level menu ids; other ids follow before Windows and Help. */
export const TOP_MENUS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'file', label: 'File' },
  { id: 'edit', label: 'Edit' },
  { id: 'select', label: 'Select' },
  { id: 'key', label: 'Key' },
  { id: 'pose', label: 'Pose' },
  { id: 'clip', label: 'Clip' },
  { id: 'graph', label: 'Graph' },
  { id: 'time', label: 'Playback' },
  { id: 'playback', label: 'Playback' },
  { id: 'rig', label: 'Rig' },
  { id: 'view', label: 'View' },
  { id: 'display', label: 'Display' },
  // M6a: Model's menus (§8.1); its `WorkspaceDef.menus` give their order there.
  { id: 'create', label: 'Create' },
  { id: 'modify', label: 'Modify' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'edit-mesh', label: 'Edit Mesh' },
  { id: 'mesh-tools', label: 'Mesh Tools' },
  { id: 'mesh-display', label: 'Mesh Display' },
  { id: 'uv', label: 'UV' },
  { id: 'windows', label: 'Windows' },
  { id: 'help', label: 'Help' },
];
const TRAILING = new Set(['windows', 'help']);

export interface MenuItemView {
  readonly id: string;
  readonly label: string;
  readonly op: OperatorId;
  readonly args: unknown;
  readonly shortcut: string | null;
  /** null when enabled; otherwise the poll's reason (shown as the tooltip, research 09 §8.7). */
  readonly disabledReason: string | null;
  /** A check-box item's state when the menu opened; null for a plain item. */
  readonly checked: boolean | null;
}

export interface MenuSection {
  readonly group: string;
  readonly items: readonly MenuItemView[];
}

export interface SubmenuView {
  readonly id: string;
  readonly label: string;
  readonly sections: readonly MenuSection[];
}

const titleCase = (id: string): string =>
  id
    .split(/[-_.\s]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** Sub-menu labels that title-casing the id would get wrong (M2a). */
const SUBMENU_LABELS: Readonly<Record<string, string>> = { 'rig.ik-fk': 'IK/FK' };

/** Context menus ('timeline.context') are panel-owned and never shown in the menu bar. */
const isContextMenu = (menu: string): boolean => menu.endsWith('.context') || menu === 'context';

/** The menu bar's workspace: its id and, when registered, its menu set (`WorkspaceDef.menus`). */
export interface MenuWorkspace {
  readonly id: WorkspaceId;
  readonly menus?: readonly string[] | undefined;
}

/** Listed in `workspace` (items without `workspaces` are listed everywhere). */
export function inWorkspace(item: MenuItemDef, workspace: WorkspaceId): boolean {
  return item.workspaces === undefined || item.workspaces.includes(workspace);
}

/**
 * Top-level menus to show, in the workspace's menu-set order (default: Animate, ordered as `TOP_MENUS`): the known
 * menus of the set that have items there, then other registered ids (extensions), then Windows and Help. Known menus
 * outside the set are not shown.
 */
export function topMenus(
  items: readonly MenuItemDef[],
  workspace: MenuWorkspace = { id: WORKSPACE.animate },
): readonly { readonly id: string; readonly label: string }[] {
  const present = new Set<string>();
  for (const item of items) {
    if (isContextMenu(item.menu) || !inWorkspace(item, workspace.id)) continue;
    present.add(item.menu.split('.')[0] ?? item.menu);
  }
  const order = workspace.menus ?? TOP_MENUS.map((menu) => menu.id);
  const knownIds = new Set([...TOP_MENUS.map((menu) => menu.id), ...order]);
  const labelOf = (id: string): string => TOP_MENUS.find((menu) => menu.id === id)?.label ?? titleCase(id);
  const seenLabels = new Set<string>();
  const out: { id: string; label: string }[] = [];
  const push = (id: string): void => {
    const label = labelOf(id);
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    out.push({ id, label });
  };
  for (const id of order) if (!TRAILING.has(id) && present.has(id)) push(id);
  for (const id of [...present].filter((menuId) => !knownIds.has(menuId)).sort()) push(id);
  for (const id of order) if (TRAILING.has(id) && present.has(id)) push(id);
  return out;
}

/** Ids merged into one menu-bar entry (both 'time' and 'playback' render as Playback). */
export function menuAliases(id: string): readonly string[] {
  const label = TOP_MENUS.find((menu) => menu.id === id)?.label;
  if (label === undefined) return [id];
  return TOP_MENUS.filter((menu) => menu.label === label).map((menu) => menu.id);
}

/** Order-independent JSON for comparing operator arguments. */
export function stableKey(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
    .join(',')}}`;
}

/**
 * Keyboard label of the binding that runs `op` with `args`, e.g. 'Ctrl+Z' / '⌘Z'. With `scopes` (the chain where the
 * menu was opened) a binding that a deeper scope shadows there is passed over for one that really runs the item;
 * otherwise, and when none does, the global binding is preferred.
 */
export function shortcutFor(
  keymap: KeymapManager,
  op: string,
  args: unknown,
  scopes?: readonly KeyScope[],
): string | null {
  const key = stableKey(args);
  let best: KeyBinding | null = null;
  let live = false;
  for (const binding of keymap.bindings()) {
    if (binding.op !== op || stableKey(binding.args) !== key) continue;
    const runs = scopes !== undefined && resolveChord(keymap, binding.chord, scopes, binding.trigger) === binding;
    if (best === null || (runs && !live) || (runs === live && best.scope !== 'global' && binding.scope === 'global')) {
      best = binding;
      live = runs;
    }
  }
  if (best === null) return null;
  if (best.trigger === 'tap' || best.trigger === 'hold') {
    const label = keymap.label(best.chord);
    return best.trigger === 'tap' ? label : `${label} (hold)`;
  }
  return keymap.label(best.chord);
}

function itemLabel(app: EditorApp, item: MenuItemDef): string {
  const base = item.label ?? app.operators.get(item.op)?.label ?? item.op;
  if (item.op === 'edit.undo') {
    const label = app.history.peekUndo()?.label;
    return label === undefined ? base : `${base} ${label}`;
  }
  if (item.op === 'edit.redo') {
    const label = app.history.peekRedo()?.label;
    return label === undefined ? base : `${base} ${label}`;
  }
  return base;
}

function pollReason(app: EditorApp, item: MenuItemDef, ctx: RunContext): string | null {
  if (app.operators.get(item.op) === undefined) return 'Not available in this build';
  try {
    const result = app.operators.poll(item.op, ctx, item.args);
    return result === true ? null : result.reason;
  } catch (error) {
    return error instanceof Error ? error.message : 'Not available';
  }
}

function checkedOf(app: EditorApp, item: MenuItemDef): boolean | null {
  if (item.checked === undefined) return null;
  try {
    return item.checked(app);
  } catch {
    return false;
  }
}

function sectionsOf(
  app: EditorApp,
  items: readonly MenuItemDef[],
  ctx: RunContext,
  scopes: readonly KeyScope[],
): MenuSection[] {
  const groups = new Map<string, MenuItemDef[]>();
  const sorted = [...items].sort((a, b) => a.order - b.order);
  // One item per operator and arguments: the first by order, except that a workspace's own item (`workspaces` set)
  // wins over a shared one, so Rig & Skin's File › Export Character… replaces the shared Export… (§0.4.5).
  const keyOf = (item: MenuItemDef): string => `${item.op}|${stableKey(item.args)}`;
  const own = new Set(sorted.filter((item) => item.workspaces !== undefined).map(keyOf));
  const seen = new Set<string>();
  for (const item of sorted) {
    const dedupe = keyOf(item);
    if (seen.has(dedupe) || (item.workspaces === undefined && own.has(dedupe))) continue;
    seen.add(dedupe);
    const list = groups.get(item.group);
    if (list === undefined) groups.set(item.group, [item]);
    else list.push(item);
  }
  return [...groups.entries()]
    .sort(([, a], [, b]) => (a[0]?.order ?? 0) - (b[0]?.order ?? 0))
    .map(([group, list]) => ({
      group,
      items: list.map((item) => ({
        id: item.id,
        label: itemLabel(app, item),
        op: item.op,
        args: item.args,
        shortcut: shortcutFor(app.keymap, item.op, item.args, scopes),
        disabledReason: pollReason(app, item, ctx),
        checked: checkedOf(app, item),
      })),
    }));
}

/**
 * Sections (by group, separated in the UI) and sub-menus of one top-level menu, polled in `ctx`: the items listed in
 * the active workspace and component mode.
 */
export function menuContents(
  app: EditorApp,
  menuId: string,
  ctx: RunContext,
): { readonly sections: readonly MenuSection[]; readonly submenus: readonly SubmenuView[] } {
  const session = app.session.getState();
  const mode = session.model.componentMode;
  const scopes = scopeChain(
    app,
    ctx.panel === undefined ? null : { kind: ctx.panel, scope: ctx.panel, paneId: ctx.paneId ?? null },
  ).scopes;
  const ids = new Set(menuAliases(menuId));
  const all = app.menus
    .list()
    .filter(
      (item) =>
        !isContextMenu(item.menu) &&
        inWorkspace(item, session.workspace) &&
        (item.modes === undefined || item.modes.includes(mode)),
    );
  const own = all.filter((item) => ids.has(item.menu));
  const subIds = [
    ...new Set(
      all.filter((item) => ids.has(item.menu.split('.')[0] ?? '') && item.menu.includes('.')).map((item) => item.menu),
    ),
  ];
  return {
    sections: sectionsOf(app, own, ctx, scopes),
    submenus: subIds.map((id) => ({
      id,
      label: SUBMENU_LABELS[id] ?? titleCase(id.slice(id.indexOf('.') + 1)),
      sections: sectionsOf(
        app,
        all.filter((item) => item.menu === id),
        ctx,
        scopes,
      ),
    })),
  };
}
