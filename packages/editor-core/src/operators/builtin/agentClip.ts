// M-AI explicit-target clip operator (MCP-SPEC §4.10): `clip.makeLoop` makes a clip loop seamlessly — match its ends,
// blend toward the start pose, or only cycle it — and reports the seam before and after (`workflows/loop.ts`). A dry
// run measures on scratch curves and writes nothing (an empty transaction records no step).
import { EkzaError } from '@ekza-animator/anim-core';
import type { ClipRecord, ControlId, KeyRecord, Tx } from '@ekza-animator/doc';
import { newRecordId } from '../../app/internals';
import { type EditorApp, GLOBAL_SCOPE } from '../../types';
import { inPlaceNode } from '../../workflows/export';
import { drivingControl } from '../../workflows/goals';
import {
  type LoopCurvePlan,
  type LoopMethod,
  planLoopCurve,
  type RootTravel,
  type SeamValue,
  seamValues,
} from '../../workflows/loop';
import type { ChannelTarget, SeamMetrics } from '../args';
import { AGENT_SPAN_LIMIT, clipArg, pollAgentClip } from './agentCommon';
import { type AnyOperator, defineOperator, fail, isActorRun, isFiniteNumber, OK } from './define';

const METHODS: readonly LoopMethod[] = ['matchEnds', 'blend', 'cycleOnly'];
const TRAVEL: readonly RootTravel[] = ['cycleOffset', 'inPlace', 'keep'];
const METHOD_TEXT: Readonly<Record<LoopMethod, string>> = {
  matchEnds: 'match ends',
  blend: 'blend',
  cycleOnly: 'cycle only',
};
/** Default cross-fade length of `blend` (frames). */
export const DEFAULT_BLEND_FRAMES = 6;
/** Rows of `SeamMetrics.worst`. */
const WORST_ROWS = 5;

/** The control whose X/Z translation is the clip's root travel (the in-place node's driver), or null. */
function travelControl(app: EditorApp, clip: ClipRecord): ControlId | null {
  const runtime = app.characters.get(clip.character);
  if (runtime === undefined) return null;
  const node = inPlaceNode(app.store, runtime.program, clip);
  return node === null ? null : drivingControl(runtime.program, node);
}

function metricsOf(values: readonly SeamValue[]): SeamMetrics {
  let maxC0 = 0;
  let maxC1 = 0;
  for (const value of values) {
    maxC0 = Math.max(maxC0, value.c0);
    maxC1 = Math.max(maxC1, value.c1);
  }
  const worst: ChannelTarget[] = [...values]
    .filter((value) => value.c0 + value.c1 > 1e-9)
    .sort((a, b) => b.c0 + b.c1 - (a.c0 + a.c1))
    .slice(0, WORST_ROWS)
    .map((value) => ({ control: value.control, channel: value.channel }));
  return { maxC0, maxC1, worst };
}

interface LoopArgs {
  readonly method: LoopMethod;
  readonly blendFrames?: number;
  readonly rootTravel: RootTravel;
}

/** The plan of every animated base curve of the clip. */
function planClip(app: EditorApp, view: Tx | EditorApp['store'], clip: ClipRecord, args: LoopArgs): LoopCurvePlan[] {
  const layer = view.query.baseLayer(clip.id);
  if (layer === undefined) return [];
  const travel = travelControl(app, clip);
  const blendFrames = args.blendFrames ?? DEFAULT_BLEND_FRAMES;
  return view.query
    .curvesOfClip(clip.id)
    .filter((curve) => curve.layer === layer.id && view.query.keysOfCurve(curve.id).length > 0)
    .map((curve) =>
      planLoopCurve(app, view, clip, curve, {
        method: args.method,
        rootTravel: args.rootTravel,
        travel: travel !== null && curve.control === travel && (curve.channel === 'tx' || curve.channel === 'tz'),
        blendFrames,
      }),
    );
}

/** Writes one curve plan: removed keys go, planned keys are put (new ones get ids), infinities follow. */
function writePlan(app: EditorApp, tx: Tx, plan: LoopCurvePlan): void {
  const planned = new Set(plan.keys.map((key) => key.id).filter((id) => id !== null));
  for (const key of tx.query.keysOfCurve(plan.curve.id)) if (!planned.has(key.id)) tx.remove('keys', key.id);
  for (const key of plan.keys) {
    const existing = key.id === null ? undefined : tx.get('keys', key.id);
    const record: KeyRecord = {
      ...key.data,
      id: existing?.id ?? newRecordId(app, 'key'),
      clip: plan.curve.clip,
      curve: plan.curve.id,
    };
    if (existing === undefined || JSON.stringify(existing) !== JSON.stringify({ ...existing, ...record })) {
      tx.put('keys', existing === undefined ? record : { ...existing, ...record });
    }
  }
  if (plan.pre !== plan.curve.pre || plan.post !== plan.curve.post) {
    tx.patch('curves', plan.curve.id, { pre: plan.pre, post: plan.post });
  }
}

const makeLoop = defineOperator({
  id: 'clip.makeLoop',
  label: 'Make Loop',
  description: 'Make a clip loop seamlessly: match its ends, blend toward the start pose, or only cycle it.',
  category: 'clip',
  scope: GLOBAL_SCOPE,
  flags: { undo: true, internal: true },
  undoLabel: () => 'Make Loop',
  poll(ctx, raw) {
    const { app } = ctx;
    const base = pollAgentClip(app, raw);
    if (base !== true) return base;
    const args = raw as unknown as Readonly<Record<string, unknown>>;
    if (!METHODS.includes(args['method'] as LoopMethod)) return fail(`method is one of ${METHODS.join(', ')}`);
    if (!TRAVEL.includes(args['rootTravel'] as RootTravel)) return fail(`rootTravel is one of ${TRAVEL.join(', ')}`);
    if (args['dryRun'] !== undefined && typeof args['dryRun'] !== 'boolean') return fail('dryRun must be a boolean');
    const clip = clipArg(app.store, raw) as ClipRecord;
    const span = clip.range.end - clip.range.start;
    const blend = args['blendFrames'];
    if (blend !== undefined && (!isFiniteNumber(blend) || blend < 1 || blend > Math.max(1, span))) {
      return fail(`blendFrames must lie in 1…${Math.max(1, span)} (the clip length)`);
    }
    if (!(span > 0)) return fail('The clip range is empty');
    if (isActorRun(ctx) && span > AGENT_SPAN_LIMIT) return fail(`The clip spans more than ${AGENT_SPAN_LIMIT} frames`);
    return OK;
  },
  apply({ app, tx }, args) {
    if (tx === null) throw new EkzaError('internal', 'clip.makeLoop runs in a transaction');
    const clip = tx.get('clips', args.clip);
    if (clip === undefined) throw new EkzaError('invalid-record', `Clip ${args.clip} does not exist`);
    const plans = planClip(app, tx, clip, args);
    const before = metricsOf(seamValues(app, tx, clip, plans, 'before'));
    const after = metricsOf(seamValues(app, tx, clip, plans, 'after'));
    const changed = plans.filter((plan) => plan.changed);
    if (args.dryRun !== true) {
      for (const plan of changed) writePlan(app, tx, plan);
      if (!clip.loop) tx.patch('clips', clip.id, { loop: true });
      // §5.6: `Make Loop "walk" (match ends)` (agent runs get the runner's `AI: ` prefix).
      tx.annotate({ label: `Make Loop "${clip.name}" (${METHOD_TEXT[args.method]})` });
    }
    return { before, after, curvesChanged: changed.length };
  },
});

export const AGENT_CLIP_OPERATORS: readonly AnyOperator[] = [makeLoop];
