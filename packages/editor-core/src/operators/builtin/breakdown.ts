// Breakdown conversion (M2A-SPEC §4.9 `key.convert`, §5.12; A4): the selected keys, or the keys at the current frame
// on the key-target controls, become breakdowns (they keep their ratio between the keys around them when those move)
// or plain keys again. Keys of locked curves keep their kind.
import { EkzaError } from '@ekza-studio/anim-core';
import type { KeyId, KeyRecord, ReadView } from '@ekza-studio/doc';
import { isLocked, isTrsChannel } from '../../edit/channelMeta';
import { currentClipFrame } from '../../edit/context';
import { activeClipOf } from '../../evaluation/time';
import { type EditorApp, GLOBAL_SCOPE, type OperatorContext } from '../../types';
import { keyTargetControls } from '../../workflows/targets';
import type { CountResult } from '../args';
import { type AnyOperator, defineOperator, fail, isActorRun, isRecord, OK } from './define';
import { pollEditable } from './polls';
import { actorScope } from '../scope';
import { pollScopeTargets } from './scoped';

/** Two keys this close (frames) share a frame (§4.11.1). */
const SAME_FRAME = 1e-6;

/** Keys of editable curves: not locked in the Graph Editor, their TRS channel not locked. */
function editableKey(view: ReadView, key: KeyRecord): boolean {
  const curve = view.get('curves', key.curve);
  if (curve === undefined || curve.locked) return false;
  const control = view.get('controls', curve.control);
  return control === undefined || !isTrsChannel(curve.channel) || !isLocked(control, curve.channel);
}

/** The keys `key.convert` acts on: the selected keys, else the key-target controls' keys at the current frame. */
export function convertTargets(app: EditorApp, view: ReadView = app.store): readonly KeyRecord[] {
  const state = app.session.getState();
  const selected: KeyRecord[] = [];
  for (const [id, parts] of state.selection.keys) {
    const key = parts.key ? view.get('keys', id) : undefined;
    if (key !== undefined) selected.push(key);
  }
  if (selected.length > 0) return selected.filter((key) => editableKey(view, key));
  const out: KeyRecord[] = [];
  for (const id of keyTargetControls(app, state.tools.keyTarget, view)) {
    const control = view.get('controls', id);
    const character = control === undefined ? undefined : view.get('rigs', control.rig)?.character;
    const clip = character === undefined ? undefined : activeClipOf(view, state, character);
    if (clip === undefined) continue;
    const frame = currentClipFrame(app, view, clip);
    for (const curve of view.query.curvesOfControl(clip.id, id)) {
      for (const key of view.query.keysOfCurve(curve.id)) {
        if (Math.abs(key.t - frame) < SAME_FRAME && editableKey(view, key)) out.push(key);
      }
    }
  }
  return out;
}

/**
 * MCP-SPEC §4.10 (P1): the keys a run converts. User runs: `convertTargets` (unchanged). Agent runs: the run scope's
 * selected keys only — never the playhead, the key target or the user's selection.
 */
function runTargets(ctx: OperatorContext, view: ReadView = ctx.app.store): readonly KeyRecord[] {
  return isActorRun(ctx) ? actorScope().convertTargets(ctx, view, editableKey) : convertTargets(ctx.app, view);
}

const keyConvert = defineOperator({
  id: 'key.convert',
  label: 'Convert Keys',
  description: 'Turn the selected keys into breakdowns or back into keys.',
  category: 'key',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: (args) => (args.to === 'breakdown' ? 'Convert to Breakdown' : 'Convert to Key'),
  poll(ctx, raw) {
    if (!isRecord(raw) || (raw['to'] !== 'breakdown' && raw['to'] !== 'key')) {
      return fail("expects { to: 'breakdown' | 'key' }");
    }
    const editable = pollEditable(ctx.app);
    if (editable !== true) return editable;
    const scoped = pollScopeTargets(ctx);
    if (scoped !== true) return scoped;
    return runTargets(ctx).length > 0 ? OK : fail('No keys are selected or at the current frame');
  },
  apply(ctx, args) {
    const { tx } = ctx;
    if (tx === null) throw new EkzaError('internal', 'key.convert runs in a transaction');
    const breakdown = args.to === 'breakdown';
    const seen = new Set<KeyId>();
    let count = 0;
    for (const key of runTargets(ctx, tx)) {
      if (seen.has(key.id)) continue;
      seen.add(key.id);
      if ((key.breakdown === true) === breakdown) continue;
      if (breakdown) tx.put('keys', { ...key, breakdown: true });
      else {
        // A plain key carries no `breakdown` field (M1 records stay byte-identical).
        const { breakdown: _flag, ...rest } = key;
        tx.put('keys', rest);
      }
      count++;
    }
    return { count } satisfies CountResult;
  },
});

export const BREAKDOWN_OPERATORS: readonly AnyOperator[] = [keyConvert];
