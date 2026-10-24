// Ekza Studio touch shell (STUDIO-TOUCH-SPEC §20.3 item 7, T5a): the public UI wrappers of the AI-only operators.
// Each wrapper fills the explicit targets of an M-AI operator (`pose.transfer`, `pose.setAt`, `pose.goals`,
// `clip.makeLoop`, `key.adjust`, `key.retime {wrap}`) — or deletes and imports an image plane — from the user's session
// (the active clip, the playhead, the time band, the selection, the copied pose), validates its own arguments in plain
// words and records one undo step under its own label. The definitions are a lazy chunk (`uiWrappers.ts`) that
// `loadUiWrappers` registers once per app, for every shell; nothing here is imported by Studio Pro's first visit
// (`/editor` +0 B). They are denied to agents (agent-tools policy, §14): agents keep the operators they wrap, so the
// MCP toolset and its generated reference do not change.
//
// The argument types extend `OperatorMap` by declaration merging, so `args.ts` (owned by the shell-contracts package)
// is untouched; folding them into `args.ts` later is a line patch with no behaviour change.
import type { Frame, Quat, Vec3 } from '@ekza-studio/anim-core';
import type { ClipId, ControlId, ImagePlaneId } from '@ekza-studio/doc';
import type { LimbId } from '@ekza-studio/rig';
import type { EditorApp } from '../../types';
import type { ChannelTarget } from '../args';
import { loadAgentOperators } from './agentChunk';
import type { solveReach } from './uiWrappers';

/** Where the keys of a value wrapper come from: the given targets, else the selected keys, channels or controls. */
export interface UiKeyScopeArgs {
  readonly clip?: ClipId;
  /** Explicit channels (default: the selected keys' channels, else the selected channels, else the animated channels
   *  of the selected controls). */
  readonly targets?: readonly ChannelTarget[];
  /** Only keys inside this frame range (default: the selected keys' frames, else the time band, else every key). */
  readonly range?: { readonly start: Frame; readonly end: Frame };
}

/** `clip.makeLoop` methods and root travel (the wrapper's defaults: match ends, cycle offset). */
export type UiLoopMethod = 'matchEnds' | 'blend' | 'cycleOnly';
export type UiLoopTravel = 'cycleOffset' | 'inPlace' | 'keep';
/** The pivots of Scale Values (`key.adjust` pivots that need no extra value). */
export type UiScalePivot = 'rest' | 'mean' | 'rangeStart';

declare module '../args' {
  interface OperatorMap {
    /** Hold Pose: keys the pose of `from` (default: the band start, else the playhead) at `to` (default: the band
     *  end) on the given controls (default: the selected controls, else every control of the character). */
    'pose.hold': {
      args: {
        readonly clip?: ClipId;
        readonly from?: Frame;
        readonly to?: Frame | readonly Frame[];
        readonly controls?: readonly ControlId[];
      } | void;
      result: { readonly keyed: number };
    };
    /** Paste Pose at: keys the copied pose (mirrored on request) at `frame` (default: the playhead) without moving the
     *  playhead; with a selection that shares controls with the pose, only the selected controls. */
    'pose.pasteAt': {
      args: { readonly frame?: Frame; readonly clip?: ClipId; readonly mirrored?: boolean } | void;
      result: { readonly keyed: number };
    };
    /** Place Goal: puts a limb's IK goal at a character-space position (metres) at `frame` (default: the playhead);
     *  `limb` defaults to the limb of the lead selected control. An FK limb switches to IK over the time band. */
    'pose.placeGoal': {
      args: { readonly position: Vec3; readonly limb?: LimbId; readonly frame?: Frame; readonly clip?: ClipId };
      result: { readonly keyed: number; readonly reached: boolean };
    };
    /** Look At: aims a bone (default the head, shared with the neck) at a character-space point. */
    'pose.lookAt': {
      args: {
        readonly target: Vec3;
        readonly bone?: string;
        readonly weight?: number;
        readonly keepTwist?: boolean;
        readonly frame?: Frame;
        readonly clip?: ClipId;
      };
      result: { readonly keyed: number };
    };
    /** Reach: one drag of a hand or foot. With `key` (default: auto key, the shell's Rec) it keys the solved limb at
     *  the playhead; without, it leaves unkeyed edits there. One undo step either way. */
    'pose.reach': {
      args: {
        readonly position: Vec3;
        readonly rotation?: Quat;
        readonly limb?: LimbId;
        readonly key?: boolean;
        readonly frame?: Frame;
        readonly clip?: ClipId;
      };
      result: { readonly keyed: number; readonly proposed: number; readonly reached: boolean };
    };
    /** Loop Animation: makes a clip (default: the active one) loop seamlessly. */
    'clip.loop': {
      args: {
        readonly clip?: ClipId;
        readonly method?: UiLoopMethod;
        readonly rootTravel?: UiLoopTravel;
        readonly blendFrames?: number;
      } | void;
      result: { readonly curvesChanged: number; readonly seamBefore: number; readonly seamAfter: number };
    };
    /** Scale Values: scales key values about a pivot (default: the rest pose). */
    'key.scaleValues': {
      args: UiKeyScopeArgs & { readonly factor: number; readonly pivot?: UiScalePivot };
      result: { readonly keys: number; readonly curves: number };
    };
    /** Offset Values: adds an offset to key values, per channel kind, in stored units (radians, metres, factor). */
    'key.offsetValues': {
      args: UiKeyScopeArgs & {
        readonly rotate?: number;
        readonly translate?: number;
        readonly scale?: number;
        readonly attr?: number;
      };
      result: { readonly keys: number; readonly curves: number };
    };
    /** Offset in Loop: shifts whole curves in time by `offset` frames, wrapping around the loop clip's range. */
    'key.offsetInLoop': {
      args: { readonly offset: number; readonly clip?: ClipId; readonly targets?: readonly ChannelTarget[] };
      result: { readonly moved: number };
    };
    /** Replace Image: swaps an image plane's picture and keeps its view, placement, opacity, depth and visibility. */
    'imagePlane.replace': {
      args: { readonly id: ImagePlaneId; readonly bytes: Uint8Array; readonly name?: string };
      result: { readonly id: ImagePlaneId };
    };
  }
}

/** The ids `uiWrappers.ts` registers (final names, ST-T5A-1). */
export const UI_WRAPPER_IDS = [
  'pose.hold',
  'pose.pasteAt',
  'pose.placeGoal',
  'pose.lookAt',
  'pose.reach',
  'clip.loop',
  'key.scaleValues',
  'key.offsetValues',
  'key.offsetInLoop',
  'imagePlane.replace',
] as const;
export type UiWrapperId = (typeof UI_WRAPPER_IDS)[number];

const loads = new WeakMap<object, Promise<void>>();

/**
 * Registers the UI wrappers on this app once (with the M-AI operators they call; ids already registered are left as
 * they are). Idempotent and never disposed, like the agent operators: once any shell has loaded them, every shell
 * lists them. A failed load is retried by the next call.
 */
/** P-T7-1 (T10): the solve `pose.reach` runs, without writing anything (`uiWrappers.ts` `solveReach`). */
export type ReachSolver = typeof solveReach;

/**
 * P-T7-1 (T10): the wrappers' Reach solve from their lazy chunk (the chunk is registered first, as `loadUiWrappers`
 * does), so a touch shell previews the solved limb while a Reach drag moves (§10.1).
 */
export function loadReachSolver(app: EditorApp): Promise<ReachSolver> {
  return loadUiWrappers(app).then(() => import('./uiWrappers').then((chunk) => chunk.solveReach));
}

export function loadUiWrappers(app: EditorApp): Promise<void> {
  const known = loads.get(app.operators);
  if (known !== undefined) return known;
  const load = Promise.all([import('./uiWrappers'), loadAgentOperators(app)]).then(([{ UI_WRAPPER_OPERATORS }]) => {
    for (const def of UI_WRAPPER_OPERATORS) {
      if (app.operators.get(def.id) === undefined) app.contribute({ kind: 'operator', def });
    }
  });
  loads.set(app.operators, load);
  load.catch(() => {
    if (loads.get(app.operators) === load) loads.delete(app.operators);
  });
  return load;
}
