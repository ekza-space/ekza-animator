// M-AI explicit-target clip operator (MCP-SPEC §4.10): `clip.makeLoop` makes a clip loop seamlessly — match its ends,
// blend toward the start pose, or only cycle it — and reports the seam before and after (`workflows/loop.ts`). A dry
// run measures on scratch curves and writes nothing (an empty transaction records no step). The apply loads with the
// agent operators' implementation (`agentImpl.ts`).
import type { ClipRecord } from '@ekza-animator/doc';
import { GLOBAL_SCOPE } from '../../types';
import type { LoopMethod, RootTravel } from '../../workflows/loop';
import { AGENT_SPAN_LIMIT, clipArg, pollAgentClip } from './agentCommon';
import { type AgentImpl, loadAgentImpl } from './agentLoad';
import { type AnyOperator, defineOperator, fail, isActorRun, isFiniteNumber, OK } from './define';

const METHODS: readonly LoopMethod[] = ['matchEnds', 'blend', 'cycleOnly'];
const TRAVEL: readonly RootTravel[] = ['cycleOffset', 'inPlace', 'keep'];

const makeLoop = defineOperator<'clip.makeLoop', AgentImpl>({
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
  prepare: () => loadAgentImpl(),
  apply: ({ app, tx }, args, impl) => impl.makeLoop(app, tx, args),
});

export const AGENT_CLIP_OPERATORS: readonly AnyOperator[] = [makeLoop];
