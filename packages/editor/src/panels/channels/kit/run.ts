// Operator calls from the data panels: typed by OperatorMap, tagged with the calling panel, and reported to the user
// when they do not finish (the runner never throws; MVP-SPEC §4.11.0).
import type { ChannelRef, EditorApp, OperatorMap, OperatorResult, PanelKind } from '@ekza-studio/editor-core';

type Args<K extends keyof OperatorMap> = OperatorMap[K]['args'];
type Result<K extends keyof OperatorMap> = OperatorMap[K]['result'];

/**
 * Runs an operator for `panel`. A failed run is reported as an error toast, a cancelled one (poll failure, gesture
 * in progress) as a warning with the runner's reason.
 */
export async function runOperator<K extends keyof OperatorMap>(
  app: EditorApp,
  panel: PanelKind,
  id: K,
  args: Args<K>,
): Promise<OperatorResult<Result<K>>> {
  const result = (await app.runUntyped(id, args, { panel })) as OperatorResult<Result<K>>;
  if (result.status === 'failed') app.services.notify.toast({ kind: 'error', text: result.error.message });
  else if (result.status === 'cancelled') app.services.notify.toast({ kind: 'warning', text: result.reason });
  return result;
}

/** `runOperator` for an id outside the typed catalog (contract requests, extensions); see docs/wp-notes/wp-9.md. */
export async function runUntypedOperator(
  app: EditorApp,
  panel: PanelKind,
  id: string,
  args: unknown,
): Promise<OperatorResult<unknown>> {
  const result = await app.runUntyped(id, args, { panel });
  if (result.status === 'failed') app.services.notify.toast({ kind: 'error', text: result.error.message });
  else if (result.status === 'cancelled') app.services.notify.toast({ kind: 'warning', text: result.reason });
  return result;
}

/** True when `id` is registered and its poll passes for `args` in `panel`. */
export function canRun(app: EditorApp, panel: PanelKind, id: string, args?: unknown): boolean {
  return app.operators.get(id) !== undefined && app.operators.poll(id, { panel }, args) === true;
}

/**
 * Replaces the Channels panel / Graph channel highlight (`Selection.channels`, per-user U state, not undoable).
 * The catalog has no `select.channels` operator yet (contract request R-1 in docs/wp-notes/wp-9.md), so the panel
 * writes the session directly, as selection-only state allows.
 */
export function setChannelSelection(app: EditorApp, channels: readonly ChannelRef[]): void {
  const selection = app.session.getState().selection;
  if (sameChannelRefs(selection.channels, channels)) return;
  app.session.setState({ selection: { ...selection, channels: [...channels] } });
}

export function sameChannelRefs(a: readonly ChannelRef[], b: readonly ChannelRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.control === b[i]?.control && ref.channel === b[i]?.channel);
}

/** `Mod` of the keymap: Cmd on macOS, Ctrl elsewhere (research 09 §6.1). */
export function hasMod(app: EditorApp, event: { readonly metaKey: boolean; readonly ctrlKey: boolean }): boolean {
  return app.keymap.platform === 'mac' ? event.metaKey : event.ctrlKey;
}

/** Click modifiers → selection mode (research 09 §6.1): Shift toggle, Mod remove, Mod+Shift add. */
export function selectModeOf(
  app: EditorApp,
  event: { readonly shiftKey: boolean; readonly metaKey: boolean; readonly ctrlKey: boolean },
): 'replace' | 'toggle' | 'add' | 'remove' {
  const mod = hasMod(app, event);
  if (mod && event.shiftKey) return 'add';
  if (mod) return 'remove';
  if (event.shiftKey) return 'toggle';
  return 'replace';
}
