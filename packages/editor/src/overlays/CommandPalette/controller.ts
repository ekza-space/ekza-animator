// The command palette (M6A-SPEC §5.18, FR-SHELL-08; B9): logic, no React. `Mod+K` opens a fuzzy search over every
// operator visible in the current workspace (labels, ids and Blender-style `aliases`), the menu items with their
// arguments ("Four View", "Export…") and one entry per workspace ("Workspace: Model"), with key labels and poll
// reasons read when it opens. Enter runs the highlighted entry (`source: 'palette'`); an operator with value params
// first prompts for its primary field inline (Tab moves through the others), then runs with the typed values.
import { type ParamDef, type ParamValue, primaryParam } from '@ekza-animator/anim-core';
import type { EditorApp, MenuItemDef, OperatorResult, RunContext } from '@ekza-animator/editor-core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { shortcutFor } from '../../shell/menus';
import type { PaletteEntry, PalettePrompt, PaletteState } from './types';

export type { PaletteEntry, PalettePrompt, PaletteState } from './types';

export interface CommandPaletteDeps {
  readonly app: EditorApp;
  readonly run: (op: string, args: unknown, ctx: RunContext) => Promise<OperatorResult<unknown>>;
  /** The run context of palette runs (the last hovered panel). */
  readonly context: () => RunContext;
  /** The state store to drive (the shell's eager facade owns it); default: a new one. */
  readonly state?: StoreApi<PaletteState>;
}

export interface CommandPaletteController {
  readonly state: StoreApi<PaletteState>;
  open(): void;
  close(): void;
  setQuery(query: string): void;
  /** Moves the highlight (wraps). */
  move(delta: number): void;
  /** The filtered, ranked entries for the current query. */
  items(): readonly PaletteEntry[];
  /** Enter on an entry (default: the highlighted one): runs it, or opens its prompt. */
  choose(entry?: PaletteEntry): void;
  setField(text: string): void;
  /** Tab / Shift+Tab in the prompt. */
  nextField(delta: 1 | -1): void;
  submitPrompt(): void;
}

// ---------- fuzzy matching ----------

/** How well `query` matches `text` (0 = no match): substrings beat subsequences, word starts and prefixes win. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 1;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at !== -1) {
    const wordStart = at === 0 || /[\s.:/_(-]/.test(t.charAt(at - 1));
    return 1000 - at + (at === 0 ? 400 : 0) + (wordStart ? 200 : 0) + (t.length === q.length ? 300 : 0);
  }
  // Subsequence: every query character in order; contiguous runs and word starts score.
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const i = t.indexOf(ch, from);
    if (i === -1) return 0;
    score += i === previous + 1 ? 8 : 1;
    if (i === 0 || /[\s.:/_(-]/.test(t.charAt(i - 1))) score += 6;
    previous = i;
    from = i + 1;
  }
  return score;
}

/** Entries matching the query, best first (enabled before disabled at equal scores, then by label). */
export function filterEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  if (query.trim() === '') return [...entries];
  const scored: { entry: PaletteEntry; score: number }[] = [];
  for (const entry of entries) {
    const score = Math.max(
      fuzzyScore(query, entry.label) * 1.2,
      fuzzyScore(query, entry.op),
      ...entry.aliases.map((alias) => fuzzyScore(query, alias) * 1.1),
    );
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.entry.enabled) - Number(a.entry.enabled) ||
      a.entry.label.localeCompare(b.entry.label),
  );
  return scored.map((item) => item.entry);
}

// ---------- typed values ----------

/** The text a param's value shows in the prompt (angles in degrees, fractions as fractions). */
export function formatParam(param: ParamDef, value: ParamValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') {
    if (param.kind === 'angle') return String(Math.round(((value * 180) / Math.PI) * 1000) / 1000);
    if (param.kind === 'fraction') return value.toFixed(3);
    return String(value);
  }
  return typeof value === 'string' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}

/** Parses typed text for a param (§5.10: `30%` = 0.3 for fractions, degrees for angles); an error string otherwise. */
export function parseParam(param: ParamDef, text: string): { readonly value: ParamValue } | { readonly error: string } {
  const raw = text.trim();
  if (raw === '') return { value: param.default };
  switch (param.kind) {
    case 'bool': {
      const lower = raw.toLowerCase();
      if (['true', 'yes', 'on', '1'].includes(lower)) return { value: true };
      if (['false', 'no', 'off', '0'].includes(lower)) return { value: false };
      return { error: `${param.label}: type yes or no` };
    }
    case 'enum':
    case 'axis': {
      const lower = raw.toLowerCase();
      const option = param.options?.find(
        (candidate) => candidate.value.toLowerCase() === lower || candidate.label.toLowerCase() === lower,
      );
      return option === undefined
        ? { error: `${param.label}: one of ${(param.options ?? []).map((o) => o.label).join(', ')}` }
        : { value: option.value };
    }
    case 'data':
      return { error: `${param.label} cannot be typed` };
    case 'number':
    case 'int':
    case 'distance':
    case 'angle':
    case 'fraction': {
      const percent = param.kind === 'fraction' && raw.endsWith('%');
      const number = Number.parseFloat(percent ? raw.slice(0, -1) : raw.replace(/[a-z°\s]+$/i, ''));
      if (!Number.isFinite(number)) return { error: `${param.label}: type a number` };
      if (param.kind === 'int') return { value: Math.round(number) };
      if (param.kind === 'angle') return { value: (number * Math.PI) / 180 };
      if (percent) return { value: number / 100 };
      return { value: number };
    }
  }
}

// ---------- entries ----------

/** Params the palette prompts for: value-bound, shown, typeable; the primary one first. */
function promptParams(params: readonly ParamDef[] | undefined): readonly ParamDef[] {
  if (params === undefined) return [];
  const shown = params.filter((param) => param.bound === 'value' && param.hidden !== true && param.kind !== 'data');
  const primary = primaryParam(shown);
  return primary === null ? shown : [primary, ...shown.filter((param) => param !== primary)];
}

function visibleIn(workspaces: readonly string[] | undefined, workspace: string): boolean {
  return workspaces === undefined || workspaces.includes(workspace);
}

/** Every entry of the palette in the current workspace (polls and key labels read now). */
export function paletteEntries(app: EditorApp, ctx: RunContext): PaletteEntry[] {
  const session = app.session.getState();
  const workspace = session.workspace;
  const poll = (op: string, args: unknown): string | null => {
    const result = app.operators.poll(op, ctx, args);
    return result === true ? null : result.reason;
  };
  const entries: PaletteEntry[] = [];
  const seen = new Set<string>();
  const variants = new Set<string>();
  const add = (entry: Omit<PaletteEntry, 'reason' | 'enabled'>): void => {
    if (seen.has(entry.key)) return;
    seen.add(entry.key);
    const reason = poll(entry.op, entry.args);
    entries.push({ ...entry, reason, enabled: reason === null });
  };

  // Workspaces (§5.17: "the command palette lists 'Workspace: Model' etc.").
  for (const def of [...app.workspaces.list()].sort((a, b) => a.order - b.order)) {
    add({
      key: `workspace.set:${def.id}`,
      op: 'workspace.set',
      args: { workspace: def.id },
      label: `Workspace: ${def.label}`,
      aliases: [`Switch to ${def.label}`, `${def.label} workspace`],
      shortcut: null,
      params: [],
      testId: `cmdk-item-workspace.set:${def.id}`,
    });
    variants.add('workspace.set');
  }

  // Menu items with arguments (variants of their operator), as the menus show them in this workspace and mode.
  const items: readonly MenuItemDef[] = app.menus.list();
  for (const item of items) {
    if (!visibleIn(item.workspaces, workspace)) continue;
    if (item.modes !== undefined && !item.modes.includes(session.model.componentMode)) continue;
    if (item.menu.endsWith('.context')) continue;
    if (item.args === undefined) continue;
    const def = app.operators.get(item.op);
    if (def === undefined) continue;
    variants.add(item.op);
    add({
      key: `${item.op}:${item.id}`,
      op: item.op,
      args: item.args,
      label: item.label ?? def.label,
      aliases: def.aliases ?? [],
      shortcut: shortcutFor(app.keymap, item.op, item.args),
      params: [],
      testId: `cmdk-item-${item.op}:${item.id}`,
    });
  }

  // Every other operator visible in this workspace.
  for (const def of app.operators.list()) {
    if (def.flags?.internal === true || variants.has(def.id)) continue;
    if (!visibleIn(def.workspaces, workspace)) continue;
    add({
      key: def.id,
      op: def.id,
      args: undefined,
      label: def.label,
      aliases: def.aliases ?? [],
      shortcut: shortcutFor(app.keymap, def.id, undefined),
      params: promptParams(def.params),
      testId: `cmdk-item-${def.id}`,
    });
  }
  return entries;
}

const CLOSED: PaletteState = { open: false, query: '', index: 0, entries: [], prompt: null };

export function createCommandPaletteController(deps: CommandPaletteDeps): CommandPaletteController {
  const state = deps.state ?? createStore<PaletteState>()(() => CLOSED);

  const items = (): readonly PaletteEntry[] => {
    const s = state.getState();
    return s.open ? filterEntries(s.entries, s.query) : [];
  };

  const run = (entry: PaletteEntry, args: unknown): void => {
    state.setState(CLOSED);
    void deps.run(entry.op, args, { ...deps.context(), source: 'palette' });
  };

  const promptFor = (entry: PaletteEntry): PalettePrompt => {
    const defaults = deps.app.prefs.getState().modeling.optionDefaults[entry.op] ?? {};
    const values: Record<string, string> = {};
    for (const param of entry.params) values[param.name] = formatParam(param, defaults[param.name] ?? param.default);
    return { entry, field: (entry.params[0] as ParamDef).name, values, error: null };
  };

  const controller: CommandPaletteController = {
    state,
    open() {
      state.setState({
        open: true,
        query: '',
        index: 0,
        entries: paletteEntries(deps.app, deps.context()),
        prompt: null,
      });
    },
    close() {
      state.setState(CLOSED);
    },
    setQuery(query) {
      state.setState({ query, index: 0, prompt: null });
    },
    move(delta) {
      const list = items();
      if (list.length === 0) return;
      const index = (state.getState().index + delta + list.length) % list.length;
      state.setState({ index });
    },
    items,
    choose(entry) {
      const chosen = entry ?? items()[state.getState().index];
      if (chosen === undefined) return;
      if (!chosen.enabled) {
        // A disabled entry stays listed with its reason; Enter on it does nothing but keep the palette open.
        return;
      }
      if (chosen.params.length > 0) {
        state.setState({ prompt: promptFor(chosen) });
        return;
      }
      run(chosen, chosen.args);
    },
    setField(text) {
      const prompt = state.getState().prompt;
      if (prompt === null) return;
      state.setState({ prompt: { ...prompt, values: { ...prompt.values, [prompt.field]: text }, error: null } });
    },
    nextField(delta) {
      const prompt = state.getState().prompt;
      if (prompt === null) return;
      const names = prompt.entry.params.map((param) => param.name);
      const at = names.indexOf(prompt.field);
      const field = names[(at + delta + names.length) % names.length] ?? prompt.field;
      state.setState({ prompt: { ...prompt, field } });
    },
    submitPrompt() {
      const prompt = state.getState().prompt;
      if (prompt === null) return;
      const args: Record<string, ParamValue> = {};
      for (const param of prompt.entry.params) {
        const parsed = parseParam(param, prompt.values[param.name] ?? '');
        if ('error' in parsed) {
          state.setState({ prompt: { ...prompt, field: param.name, error: parsed.error } });
          return;
        }
        args[param.name] = parsed.value;
      }
      const base = typeof prompt.entry.args === 'object' && prompt.entry.args !== null ? prompt.entry.args : {};
      run(prompt.entry, { ...base, ...args });
    },
  };
  return controller;
}
