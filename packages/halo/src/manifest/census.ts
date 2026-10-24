// The live census of an EditorApp (STUDIO-TOUCH-SPEC §20.5, ST-29; T6b): what the parity check compares the Disclosure
// Manifest with. A plain-JSON snapshot of the operator registry (every definition, internal ones included, with the
// deferred stubs marked), the menu items, the marking-menu items and the key bindings with their arguments. The
// browser parity spec (`ha-parity`) takes one census per mount (host + Halo, Pro, Auto-Rig, each workspace entered)
// and joins them, since about 70 ids exist only while a UI is mounted; the unit tests take one from a headless app.
// React-free and read-only: it never runs an operator, only polls the ones that may be stubs.
import {
  ARRIVES_AFTER_MVP,
  type EditorApp,
  type MarkingMenuItem,
  NOT_AVAILABLE_YET,
  type OperatorDef,
  PANEL,
} from '@ekza-studio/editor-core';

/** One operator as the census records it. */
export interface CensusOperator {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly internal: boolean;
  /** A deferred stub: poll-fails "Arrives after the MVP" (or "not available yet") whatever the arguments. */
  readonly deferred: boolean;
  readonly undo: boolean;
  readonly adjustable: boolean;
  readonly repeatable: boolean;
  readonly selection: boolean;
  readonly tool: string | null;
  readonly workspaces: readonly string[] | null;
  /** Names of the visible ParamDefs (a Studio Pro option box when not internal). */
  readonly params: readonly string[];
}

/** An (operator, arguments) pair a menu, a marking menu or a key binding sends. */
export interface CensusPair {
  readonly op: string;
  readonly args: unknown;
  /** Where it comes from: `menu:<menu>/<item id>`, `marking:<menu id>`, `key:<scope>`. */
  readonly from: string;
}

export interface Census {
  readonly operators: readonly CensusOperator[];
  readonly menus: readonly CensusPair[];
  readonly markingMenus: readonly CensusPair[];
  readonly bindings: readonly CensusPair[];
  /** Registered tools as `<panel>:<tool id>`. */
  readonly tools: readonly string[];
  /** Where the census was taken (`halo`, `studio:model`, …): the spec's labels, for the report. */
  readonly mounts: readonly string[];
}

const STUB_REASONS: ReadonlySet<string> = new Set([ARRIVES_AFTER_MVP, NOT_AVAILABLE_YET]);

/** A stub answers its fixed reason for every argument: no arguments and a bogus argument object must both fail so. */
function isDeferredStub(app: EditorApp, def: OperatorDef<unknown, unknown, unknown>): boolean {
  if (def.flags?.internal !== true) return false;
  const reason = (args: unknown): string | null => {
    try {
      const result = app.operators.poll(def.id, undefined, args);
      return result === true ? null : result.reason;
    } catch {
      return null;
    }
  };
  const bare = reason(undefined);
  return bare !== null && STUB_REASONS.has(bare) && reason({ __census__: true }) === bare;
}

function censusOperator(app: EditorApp, def: OperatorDef<unknown, unknown, unknown>): CensusOperator {
  return {
    id: def.id,
    label: def.label,
    category: def.category,
    internal: def.flags?.internal === true,
    deferred: isDeferredStub(app, def),
    undo: def.flags?.undo === true,
    adjustable: def.flags?.adjustable === true,
    repeatable: def.flags?.repeatable === true,
    selection: def.flags?.selection === true,
    tool: def.tool ?? null,
    workspaces: def.workspaces === undefined ? null : [...def.workspaces],
    params: (def.params ?? []).filter((param) => param.hidden !== true && param.kind !== 'data').map((p) => p.name),
  };
}

/** Plain JSON of an argument value (functions and cycles dropped). */
function plain(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return '*';
  }
}

function markingItems(items: readonly MarkingMenuItem[], from: string, out: CensusPair[]): void {
  for (const item of items) {
    if (item.op !== undefined) out.push({ op: item.op, args: plain(item.args), from });
    if (item.submenu !== undefined) markingItems(item.submenu, from, out);
  }
}

/** One census of `app` as it is now (`mount` names the moment, e.g. `studio:rig`). */
export function liveCensus(app: EditorApp, mount: string): Census {
  const operators = app.operators.list().map((def) => censusOperator(app, def));
  const menus = app.menus
    .list()
    .map((item) => ({ op: item.op, args: plain(item.args), from: `menu:${item.menu}/${item.id}` }));
  const markingMenus: CensusPair[] = [];
  for (const def of app.markingMenus.list()) {
    const slots = Object.values(def.slots).filter((item): item is MarkingMenuItem => item !== undefined);
    markingItems([...slots, ...def.list], `marking:${def.id}`, markingMenus);
  }
  const bindings = app.keymap
    .bindings()
    .map((binding) => ({ op: binding.op, args: plain(binding.args), from: `key:${binding.scope}` }));
  return {
    operators,
    menus,
    markingMenus,
    bindings,
    tools: Object.values(PANEL).flatMap((panel) => app.tools.list(panel).map((tool) => `${panel}:${tool.id}`)),
    mounts: [mount],
  };
}

/** Joins censuses: an operator seen in any mount counts (the first definition wins); pairs are deduplicated. */
export function joinCensus(parts: readonly Census[]): Census {
  const operators = new Map<string, CensusOperator>();
  const pairs = (pick: (census: Census) => readonly CensusPair[]): CensusPair[] => {
    const seen = new Map<string, CensusPair>();
    for (const census of parts) {
      for (const pair of pick(census)) {
        const key = `${pair.op} ${JSON.stringify(pair.args ?? null)} ${pair.from}`;
        if (!seen.has(key)) seen.set(key, pair);
      }
    }
    return [...seen.values()];
  };
  for (const census of parts) {
    for (const op of census.operators) {
      const known = operators.get(op.id);
      // A stub replaced by its real definition in a later mount is live.
      if (known === undefined || (known.deferred && !op.deferred)) operators.set(op.id, op);
    }
  }
  return {
    operators: [...operators.values()].sort((a, b) => a.id.localeCompare(b.id)),
    menus: pairs((c) => c.menus),
    markingMenus: pairs((c) => c.markingMenus),
    bindings: pairs((c) => c.bindings),
    tools: [...new Set(parts.flatMap((c) => c.tools))].sort(),
    mounts: parts.flatMap((c) => c.mounts),
  };
}
