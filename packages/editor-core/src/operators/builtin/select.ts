// Selection operators (MVP-SPEC §4.9 `select.*`, ADR 0008 §8). Selection is per-user session state: not undoable
// itself, restored by undo/redo through the snapshots history steps carry. It is limited to one character: selecting
// another character's controls makes that character active and replaces the selection.
import type { CharacterId, ControlId, KeyId } from '@ekza-animator/doc';
import { ownerOfControl } from '../../session/location';
import {
  type ChannelRef,
  type EditorApp,
  GLOBAL_SCOPE,
  type KeyPartSelection,
  PANEL,
  type Selection,
  type SelectMode,
} from '../../types';
import { activeClipRecord, baseCurves, keysOfCurves, selectedControls, visibleControls } from '../../workflows/targets';
import { type AnyOperator, defineOperator, fail, isRecord, OK, panelOf } from './define';
import { stubOperator } from './stub';

const SELECT_MODES: readonly SelectMode[] = ['replace', 'toggle', 'add', 'remove'];
// M2a: the Dope Sheet shares the key selection (M2A-SPEC §5.10).
const KEY_PANELS: ReadonlySet<string> = new Set([PANEL.graph, PANEL.timeline, PANEL.dopeSheet]);

function isMode(value: unknown): value is SelectMode {
  return typeof value === 'string' && (SELECT_MODES as readonly string[]).includes(value);
}

/** `ids` combined into `current` by mode; the lead (last element) is the last id added. */
export function combine<T>(current: readonly T[], ids: readonly T[], mode: SelectMode): T[] {
  const unique: T[] = [];
  for (const id of ids) {
    const at = unique.indexOf(id);
    if (at !== -1) unique.splice(at, 1);
    unique.push(id);
  }
  switch (mode) {
    case 'replace':
      return unique;
    case 'add':
      return [...current.filter((id) => !unique.includes(id)), ...unique];
    case 'remove':
      return current.filter((id) => !unique.includes(id));
    case 'toggle': {
      const next = [...current];
      for (const id of unique) {
        const at = next.indexOf(id);
        if (at === -1) next.push(id);
        else next.splice(at, 1);
      }
      return next;
    }
  }
}

/**
 * The selection after the selected controls changed: channel refs keep only selected controls; keys keep only
 * curves the Graph Editor still shows (the selected controls' curves in the active clip, or every curve of the
 * active clip when no control is selected).
 */
export function pruneForControls(app: EditorApp, selection: Selection): Selection {
  const controls = new Set(selection.controls);
  const clip = activeClipRecord(app);
  const shown = new Set(
    clip === undefined ? [] : baseCurves(app.store, clip, controls.size > 0 ? controls : undefined).map((c) => c.id),
  );
  const keys = new Map<KeyId, KeyPartSelection>();
  for (const [id, parts] of selection.keys) {
    const key = app.store.get('keys', id);
    if (key !== undefined && shown.has(key.curve)) keys.set(id, parts);
  }
  const channels = selection.channels.filter((ref) => controls.has(ref.control));
  return { controls: selection.controls, keys, channels };
}

/** Selects controls (one character at a time) and prunes the dependent key and channel selections. */
export function selectControls(app: EditorApp, ids: readonly ControlId[], mode: SelectMode): void {
  const state = app.session.getState();
  const owner = new Map<ControlId, CharacterId | null>();
  for (const id of ids) if (app.store.get('controls', id) !== undefined) owner.set(id, ownerOfControl(app.store, id));
  const live = ids.filter((id) => owner.has(id));
  let character = state.activeCharacter;
  let effective = mode;
  const foreign = live.filter((id) => owner.get(id) !== character);
  if (foreign.length > 0 && mode !== 'remove') {
    character = owner.get(foreign[foreign.length - 1] as ControlId) ?? character;
    effective = 'replace';
  }
  const own = live.filter((id) => owner.get(id) === character);
  const current = character === state.activeCharacter ? state.selection.controls : [];
  const controls = combine(current, own, effective);
  const patch: { activeCharacter?: CharacterId | null } = {};
  if (character !== state.activeCharacter) patch.activeCharacter = character;
  app.session.setState({ ...patch, selection: { ...state.selection, controls } });
  app.session.setState({ selection: pruneForControls(app, app.session.getState().selection) });
}

function partsOf(parts: Partial<KeyPartSelection> | undefined): KeyPartSelection {
  if (parts === undefined) return { key: true, in: false, out: false };
  return { key: parts.key === true, in: parts.in === true, out: parts.out === true };
}

function any(parts: KeyPartSelection): boolean {
  return parts.key || parts.in || parts.out;
}

/** Key selection by mode (parts default to the key itself). */
export function combineKeys(
  current: ReadonlyMap<KeyId, KeyPartSelection>,
  items: readonly { readonly key: KeyId; readonly parts?: Partial<KeyPartSelection> | undefined }[],
  mode: SelectMode,
): Map<KeyId, KeyPartSelection> {
  const next = new Map(mode === 'replace' ? [] : current);
  for (const item of items) {
    const parts = partsOf(item.parts);
    const was = next.get(item.key) ?? { key: false, in: false, out: false };
    let now: KeyPartSelection;
    switch (mode) {
      case 'replace':
      case 'add':
        now = { key: was.key || parts.key, in: was.in || parts.in, out: was.out || parts.out };
        break;
      case 'remove':
        now =
          item.parts === undefined
            ? { key: false, in: false, out: false }
            : { key: was.key && !parts.key, in: was.in && !parts.in, out: was.out && !parts.out };
        break;
      case 'toggle':
        now = { key: was.key !== parts.key, in: was.in !== parts.in, out: was.out !== parts.out };
        break;
    }
    if (any(now)) next.set(item.key, now);
    else next.delete(item.key);
  }
  return next;
}

const selectControlsOp = defineOperator({
  id: 'select.controls',
  label: 'Select Controls',
  description: 'Select controls (Shift toggles, Mod removes, Mod+Shift adds); the last one added leads.',
  category: 'select',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll(_ctx, args) {
    if (!isRecord(args) || !Array.isArray(args['ids']) || !isMode(args['mode'])) {
      return fail('expects { ids, mode }');
    }
    return (args['ids'] as readonly unknown[]).every((id) => typeof id === 'string')
      ? OK
      : fail('ids must be control ids');
  },
  apply({ app }, args) {
    selectControls(app, args.ids, args.mode);
  },
});

const selectAll = defineOperator({
  id: 'select.all',
  label: 'Select All',
  description: 'All visible controls of the character, or all keys of the shown curves in the Graph Editor.',
  category: 'select',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.session.getState().activeCharacter === null ? fail('No character is loaded') : OK),
  apply(ctx) {
    const app = ctx.app;
    const state = app.session.getState();
    const panel = panelOf(ctx);
    if (panel !== null && KEY_PANELS.has(panel)) {
      const clip = activeClipRecord(app);
      if (clip === undefined) return;
      const selected = selectedControls(app);
      const curves = baseCurves(app.store, clip, selected.length > 0 ? new Set(selected.map((c) => c.id)) : undefined);
      const keys = new Map<KeyId, KeyPartSelection>();
      for (const id of keysOfCurves(app.store, curves)) keys.set(id, { key: true, in: false, out: false });
      app.session.setState({ selection: { ...state.selection, keys } });
      return;
    }
    selectControls(
      app,
      visibleControls(app).map((control) => control.id),
      'replace',
    );
  },
});

const selectNone = defineOperator({
  id: 'select.none',
  label: 'Select None',
  description: "Clear the selection of the panel's kind (keys in the Graph Editor and time slider).",
  category: 'select',
  scope: GLOBAL_SCOPE,
  apply(ctx) {
    const app = ctx.app;
    const state = app.session.getState();
    const panel = panelOf(ctx);
    if (panel !== null && KEY_PANELS.has(panel)) {
      app.session.setState({
        selection: { ...state.selection, keys: new Map() },
        ...(panel === PANEL.timeline ? { time: { ...state.time, band: null } } : {}),
      });
    } else if (panel === PANEL.channelBox) {
      app.session.setState({ selection: { ...state.selection, channels: [] } });
    } else {
      selectControls(app, [], 'replace');
    }
  },
});

const selectMirror = defineOperator({
  id: 'select.mirror',
  label: 'Select Mirror',
  description: 'Replace the selection with the mirror counterparts (centre and unpaired controls stay).',
  category: 'select',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.session.getState().selection.controls.length > 0 ? OK : fail('Nothing is selected')),
  apply({ app }) {
    const mirrored = selectedControls(app).map((control) =>
      control.mirror !== null && app.store.get('controls', control.mirror) !== undefined ? control.mirror : control.id,
    );
    selectControls(app, mirrored, 'replace');
  },
});

const selectKeys = defineOperator({
  id: 'select.keys',
  label: 'Select Keys',
  description: 'Select keys and tangent handles in the Graph Editor or on the time slider.',
  category: 'select',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll(_ctx, args) {
    if (!isRecord(args) || !Array.isArray(args['items']) || !isMode(args['mode']))
      return fail('expects { items, mode }');
    const ok = (args['items'] as readonly unknown[]).every(
      (item) =>
        isRecord(item) && typeof item['key'] === 'string' && (item['parts'] === undefined || isRecord(item['parts'])),
    );
    return ok ? OK : fail('items must be { key, parts? }');
  },
  apply({ app }, args) {
    const state = app.session.getState();
    const items = args.items.filter((item) => app.store.get('keys', item.key) !== undefined);
    const keys = combineKeys(state.selection.keys, items, args.mode);
    app.session.setState({ selection: { ...state.selection, keys } });
  },
});

const selectChannels = defineOperator({
  id: 'select.channels',
  label: 'Select Channels',
  description: 'Select channels in the Channel Box and the Graph Editor channel list.',
  category: 'select',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll(_ctx, args) {
    if (!isRecord(args) || !Array.isArray(args['refs']) || !isMode(args['mode'])) return fail('expects { refs, mode }');
    const ok = (args['refs'] as readonly unknown[]).every(
      (ref) => isRecord(ref) && typeof ref['control'] === 'string' && typeof ref['channel'] === 'string',
    );
    return ok ? OK : fail('refs must be { control, channel }');
  },
  apply({ app }, args) {
    const state = app.session.getState();
    const keyOf = (ref: ChannelRef): string => `${ref.control}\u0000${ref.channel}`;
    const byKey = new Map<string, ChannelRef>();
    for (const ref of [...state.selection.channels, ...args.refs]) byKey.set(keyOf(ref), ref);
    const live = args.refs.filter((ref) => app.store.get('controls', ref.control) !== undefined);
    const keys = combine(state.selection.channels.map(keyOf), live.map(keyOf), args.mode);
    const channels = keys.map((key) => byKey.get(key) as ChannelRef);
    app.session.setState({ selection: { ...state.selection, channels } });
  },
});

export const SELECT_OPERATORS: readonly AnyOperator[] = [
  selectControlsOp,
  selectAll,
  selectNone,
  selectMirror,
  selectKeys,
  selectChannels,
  // M2a (M2A-SPEC §5.17; A2 implements it)
  stubOperator('select.pickWalk', 'Pick Walk', {
    category: 'select',
    description: 'Walk the selection up, down or sideways in the control hierarchy.',
  }),
];
