// Menu bar model (research 09 §4.1; ADR 0008): built from the menu registry, with enabled state from operator polls
// and shortcut labels from the keymap. Pure functions over the EditorApp, so the React menu bar stays thin.
import type {
  EditorApp,
  KeyBinding,
  KeymapManager,
  MenuItemDef,
  OperatorId,
  RunContext,
} from '@ekza-animator/editor-core';

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

/** Top-level menus to show: the known ones that have items, then other registered ids, then Windows and Help. */
export function topMenus(items: readonly MenuItemDef[]): readonly { readonly id: string; readonly label: string }[] {
  const present = new Set<string>();
  for (const item of items) {
    if (isContextMenu(item.menu)) continue;
    present.add(item.menu.split('.')[0] ?? item.menu);
  }
  const known = TOP_MENUS.filter((menu) => present.has(menu.id));
  const seenLabels = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const menu of known.filter((m) => !TRAILING.has(m.id))) {
    if (seenLabels.has(menu.label)) continue;
    seenLabels.add(menu.label);
    out.push(menu);
  }
  const knownIds = new Set(TOP_MENUS.map((menu) => menu.id));
  for (const id of [...present].filter((menuId) => !knownIds.has(menuId)).sort())
    out.push({ id, label: titleCase(id) });
  for (const menu of known.filter((m) => TRAILING.has(m.id))) out.push(menu);
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

/** Keyboard label of the binding that runs `op` with `args` (global scope preferred), e.g. 'Ctrl+Z' / '⌘Z'. */
export function shortcutFor(keymap: KeymapManager, op: string, args: unknown): string | null {
  const key = stableKey(args);
  let best: KeyBinding | null = null;
  for (const binding of keymap.bindings()) {
    if (binding.op !== op || stableKey(binding.args) !== key) continue;
    if (best === null || (best.scope !== 'global' && binding.scope === 'global')) best = binding;
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

function sectionsOf(app: EditorApp, items: readonly MenuItemDef[], ctx: RunContext): MenuSection[] {
  const groups = new Map<string, MenuItemDef[]>();
  const seen = new Set<string>();
  const sorted = [...items].sort((a, b) => a.order - b.order);
  for (const item of sorted) {
    const dedupe = `${item.op}|${stableKey(item.args)}`;
    if (seen.has(dedupe)) continue;
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
        shortcut: shortcutFor(app.keymap, item.op, item.args),
        disabledReason: pollReason(app, item, ctx),
      })),
    }));
}

/** Sections (by group, separated in the UI) and sub-menus of one top-level menu, polled in `ctx`. */
export function menuContents(
  app: EditorApp,
  menuId: string,
  ctx: RunContext,
): { readonly sections: readonly MenuSection[]; readonly submenus: readonly SubmenuView[] } {
  const ids = new Set(menuAliases(menuId));
  const all = app.menus.list().filter((item) => !isContextMenu(item.menu));
  const own = all.filter((item) => ids.has(item.menu));
  const subIds = [
    ...new Set(
      all.filter((item) => ids.has(item.menu.split('.')[0] ?? '') && item.menu.includes('.')).map((item) => item.menu),
    ),
  ];
  return {
    sections: sectionsOf(app, own, ctx),
    submenus: subIds.map((id) => ({
      id,
      label: SUBMENU_LABELS[id] ?? titleCase(id.slice(id.indexOf('.') + 1)),
      sections: sectionsOf(
        app,
        all.filter((item) => item.menu === id),
        ctx,
      ),
    })),
  };
}
