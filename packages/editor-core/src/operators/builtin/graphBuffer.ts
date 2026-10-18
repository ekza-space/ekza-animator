// Graph Editor buffer curves (M2A-SPEC §4.9 `graph.buffer.*`, §5.15.1; A4). A buffer is a per-user copy of a curve
// (`session.curveBuffers`, never saved or synced): snapshot copies the target curves, swap exchanges each target
// curve with its buffer (one undoable step; the buffers themselves are U state and undo does not restore them), clear
// forgets them. The kernel drops the buffer of a deleted curve.
import { type AnimCurve, EkzaError } from '@ekza-animator/anim-core';
import type { CurveId, CurveRecord, KeyRecord, ReadView, Tx } from '@ekza-animator/doc';
import { newRecordId } from '../../app/internals';
import { animCurve, keyDataOf } from '../../edit/context';
import { type CurveBuffer, type EditorApp, GLOBAL_SCOPE } from '../../types';
import { targetCurves } from '../../workflows/targets';
import type { CountResult } from '../args';
import { type AnyOperator, defineOperator, fail, OK, optionalArgs } from './define';
import { pollEditable } from './polls';

function curvesArg(args: unknown): readonly CurveId[] | null | string {
  const options = optionalArgs(args);
  if (options === null) return 'expects { curves? }';
  const curves = options['curves'];
  if (curves === undefined) return null;
  if (!Array.isArray(curves) || !(curves as readonly unknown[]).every((c) => typeof c === 'string')) {
    return 'curves must be curve ids';
  }
  return curves as readonly CurveId[];
}

/**
 * The curves a buffer operator acts on: the given ones, else the curves of the selected keys or channels, else the
 * curves the Graph Editor shows (the selected controls' curves, else the active clip's; `targetCurves`).
 */
function bufferTargets(app: EditorApp, view: ReadView, given: readonly CurveId[] | null): readonly CurveRecord[] {
  if (given === null) return targetCurves(app, view);
  const out: CurveRecord[] = [];
  for (const id of new Set(given)) {
    const curve = view.get('curves', id);
    if (curve !== undefined) out.push(curve);
  }
  return out;
}

/** The curve's keys, weighting and infinities as an AnimCurve (the buffer's content). */
function captureCurve(view: ReadView, curve: CurveRecord): AnimCurve {
  return animCurve(curve, view.query.keysOfCurve(curve.id).map(keyDataOf));
}

const snapshot = defineOperator({
  id: 'graph.buffer.snapshot',
  label: 'Snapshot Buffer Curves',
  description: 'Keep a copy of the target curves to compare with or swap back.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    const given = curvesArg(args);
    if (typeof given === 'string') return fail(given);
    return bufferTargets(app, app.store, given).length > 0 ? OK : fail('No curves to snapshot');
  },
  apply({ app }, args) {
    const given = curvesArg(args);
    if (typeof given === 'string') return { count: 0 };
    const now = Date.now();
    const buffers = new Map(app.session.getState().curveBuffers);
    let count = 0;
    for (const curve of bufferTargets(app, app.store, given)) {
      buffers.set(curve.id, { curve: captureCurve(app.store, curve), capturedAt: now });
      count++;
    }
    app.session.setState({ curveBuffers: buffers });
    return { count } satisfies CountResult;
  },
});

/** Replaces the curve's keys, weighting and infinities with `content` (new key IDs). */
function writeCurve(app: EditorApp, tx: Tx, curve: CurveRecord, content: AnimCurve): void {
  for (const key of tx.query.keysOfCurve(curve.id)) tx.remove('keys', key.id);
  for (const key of tx.query.hiddenKeys(curve.id)) if (tx.get('keys', key.id) !== undefined) tx.remove('keys', key.id);
  for (const data of content.keys) {
    const key: KeyRecord = { ...keyDataOf(data), id: newRecordId(app, 'key'), clip: curve.clip, curve: curve.id };
    tx.put('keys', key);
  }
  const patch: { weighted?: boolean; pre?: CurveRecord['pre']; post?: CurveRecord['post'] } = {};
  if (curve.weighted !== content.weighted) patch.weighted = content.weighted;
  if (curve.pre !== content.pre) patch.pre = content.pre;
  if (curve.post !== content.post) patch.post = content.post;
  if (Object.keys(patch).length > 0) tx.patch('curves', curve.id, patch);
}

const swap = defineOperator({
  id: 'graph.buffer.swap',
  label: 'Swap Buffer Curves',
  description: 'Swap the target curves with their buffer copies.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  flags: { undo: true },
  undoLabel: () => 'Swap Buffer Curves',
  poll({ app }, args) {
    const given = curvesArg(args);
    if (typeof given === 'string') return fail(given);
    const editable = pollEditable(app);
    if (editable !== true) return editable;
    const buffers = app.session.getState().curveBuffers;
    const swappable = bufferTargets(app, app.store, given).filter((curve) => buffers.has(curve.id));
    if (swappable.length === 0) return fail('The target curves have no buffer curves (Snapshot first)');
    return swappable.some((curve) => !curve.locked) ? OK : fail('The curves with buffers are locked');
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'graph.buffer.swap runs in a transaction');
    const given = curvesArg(args);
    if (typeof given === 'string') return { count: 0 };
    const now = Date.now();
    const buffers = new Map<CurveId, CurveBuffer>(app.session.getState().curveBuffers);
    let count = 0;
    for (const curve of bufferTargets(app, tx, given)) {
      const buffer = buffers.get(curve.id);
      if (buffer === undefined || curve.locked) continue;
      const replaced = captureCurve(tx, curve);
      writeCurve(app, tx, curve, buffer.curve);
      buffers.set(curve.id, { curve: replaced, capturedAt: now });
      count++;
    }
    // Swapped keys got new IDs: the old ones leave the key selection.
    const selection = app.session.getState().selection;
    const keys = new Map([...selection.keys].filter(([id]) => tx.get('keys', id) !== undefined));
    app.session.setState({
      curveBuffers: buffers,
      ...(keys.size === selection.keys.size ? {} : { selection: { ...selection, keys } }),
    });
    return { count } satisfies CountResult;
  },
});

const clear = defineOperator({
  id: 'graph.buffer.clear',
  label: 'Clear Buffer Curves',
  description: 'Forget every buffer curve.',
  category: 'graph',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.session.getState().curveBuffers.size > 0 ? OK : fail('There are no buffer curves')),
  apply({ app }) {
    app.session.setState({ curveBuffers: new Map() });
  },
});

/** Drops the buffers of curves that no longer exist (the kernel calls it after document changes). */
export function pruneCurveBuffers(app: EditorApp): void {
  const buffers = app.session.getState().curveBuffers;
  if (buffers.size === 0) return;
  let next: Map<CurveId, CurveBuffer> | null = null;
  for (const id of buffers.keys()) {
    if (app.store.get('curves', id) !== undefined) continue;
    next ??= new Map(buffers);
    next.delete(id);
  }
  if (next !== null) app.session.setState({ curveBuffers: next });
}

export const GRAPH_BUFFER_OPERATORS: readonly AnyOperator[] = [snapshot, swap, clear];
