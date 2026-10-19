// Clip tools (MCP-SPEC §6.6 tools 22–25, §5.9, §5.12): clip_create (clip.new / clip.duplicate; live it stays out of
// the user's view unless activated with Edit and View), clip_update (one change kind per call: clip.rename,
// clip.setActive or clip.setSettings; fps changes and range or loop changes over the user's unkeyed edits are
// confirmed), clip_make_loop (clip.makeLoop, the seam before and after) and clip_delete (clip.delete, confirmed).
import type { Fps } from '@ekza-animator/anim-core';
import type { ChannelId, ClipId, ControlId } from '@ekza-animator/doc';
import { controlKeyOf } from '../../resolve/resolver';
import { AGENT_RANGE_MAX, rangeArg } from '../../resolve/targets';
import {
  addressed,
  clipInfo,
  explicitOperatorsIn,
  labelName,
  notAvailableInThisBuild,
  staleCheck,
  valueOf,
  writeResult,
} from '../../runtime/toolkit';
import { quoteName } from '../../sanitize/sanitize';
import { AgentToolFailure, type AgentToolContext, type AgentToolResult, type ConfirmPrompt } from '../../types';
import { overridesOn } from '../../units/pose';
import { fpsOf, fpsValue, roundTo } from '../../units/units';

/** Default length of a new clip (§6.6): 2 seconds. */
export const DEFAULT_CLIP_SECONDS = 2;

function sceneFpsOf(ctx: AgentToolContext): Fps {
  return ctx.app.store.get('project', 'project')?.sceneFps ?? { num: 30, den: 1 };
}

// ---------- clip_create ----------
export interface ClipCreateArgs {
  readonly character?: string | undefined;
  readonly name: string;
  readonly fps?: number | undefined;
  readonly durationFrames?: number | undefined;
  readonly durationSeconds?: number | undefined;
  readonly loop: boolean;
  readonly duplicateOf?: string | undefined;
  readonly activate?: boolean | undefined;
}

export async function clipCreate(ctx: AgentToolContext, args: ClipCreateArgs): Promise<AgentToolResult<unknown>> {
  const character = ctx.resolve.character(args.character);
  const taken = ctx.app.store.query.clipsOfCharacter(character.id).find((clip) => clip.name === args.name);
  if (taken !== undefined) {
    throw new AgentToolFailure(
      'invalid_args',
      `The character already has a clip named ${quoteName(args.name)}.`,
      'pick another name, or edit that clip by passing clip',
      { detail: { path: 'name' } },
    );
  }
  // Headless: no user to protect, so the new clip becomes active by default (later calls can default to it).
  const activate = args.activate ?? ctx.host.mode === 'headless';
  const access = activate ? ('view' as const) : ('edit' as const);
  if (!activate && !explicitOperatorsIn(ctx.app)) {
    // The shipped clip.new / clip.duplicate always make the new clip active (P1 adds `activate`).
    throw notAvailableInThisBuild(
      'Creating a clip without showing it to the user would switch the user’s clip.',
      ctx.host.mode === 'live'
        ? 'pass activate: true (it needs the View grant and shows the new clip to the user), or ask the user to add the clip'
        : 'leave activate out: a headless project makes the new clip active',
    );
  }
  let created: ClipId;
  if (args.duplicateOf !== undefined) {
    const source = ctx.resolve.clip(character.id, args.duplicateOf);
    ctx.focus(
      { character: character.id, clip: source.id, controls: [], frame: null },
      `Duplicate clip ${labelName(source.name)}`,
    );
    const run = await ctx.run('clip.duplicate', { clip: source.id, name: args.name, activate }, { access });
    created = valueOf<{ readonly clip: ClipId }>('clip.duplicate', run).clip;
    return createdResult(ctx, character.id, created, run, activate);
  }
  const fps = args.fps === undefined ? sceneFpsOf(ctx) : fpsOf(args.fps);
  const frames =
    args.durationFrames !== undefined
      ? Math.round(args.durationFrames)
      : Math.round((args.durationSeconds ?? DEFAULT_CLIP_SECONDS) * fpsValue(fps));
  if (frames < 1) {
    throw new AgentToolFailure('invalid_args', 'The clip would be shorter than one frame.', 'pass durationFrames ≥ 1', {
      detail: { path: args.durationFrames !== undefined ? 'durationFrames' : 'durationSeconds' },
    });
  }
  if (frames > AGENT_RANGE_MAX) {
    throw new AgentToolFailure(
      'limit',
      `A clip of ${frames} frames is longer than ${AGENT_RANGE_MAX.toLocaleString('en')} frames.`,
      'make it shorter',
    );
  }
  ctx.focus({ character: character.id, clip: null, controls: [], frame: null }, `New clip "${args.name}"`);
  const run = await ctx.run(
    'clip.new',
    { character: character.id, name: args.name, fps, range: { start: 0, end: frames }, loop: args.loop, activate },
    { access },
  );
  created = valueOf<{ readonly clip: ClipId }>('clip.new', run).clip;
  return createdResult(ctx, character.id, created, run, activate);
}

function createdResult(
  ctx: AgentToolContext,
  character: Parameters<typeof ctx.focus>[0]['character'],
  clip: ClipId,
  run: Awaited<ReturnType<AgentToolContext['run']>>,
  activate: boolean,
): AgentToolResult<unknown> {
  const info = clipInfo(ctx, clip);
  const activated = character !== null && ctx.app.session.getState().activeClip[character] === clip;
  ctx.focus({ character, clip, controls: [], frame: null }, `New clip "${info.name}"`);
  return writeResult(
    ctx,
    clip,
    run,
    { clip: info, activated },
    [activate && !activated ? 'the clip was created but not made active' : null],
    ctx.host.mode === 'live' && !activated
      ? `The user still sees their own clip; edit this one by passing clip: "${info.name}" (the user can click Show).`
      : undefined,
  );
}

// ---------- clip_update ----------
export interface ClipUpdateArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly name?: string | undefined;
  readonly fps?: number | undefined;
  readonly fpsMode?: 'keep_seconds' | 'keep_frames' | undefined;
  readonly rangeFrames?: readonly [number, number] | undefined;
  readonly loop?: boolean | undefined;
  readonly rootMotion?: 'keep' | 'in_place' | undefined;
  readonly slot?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly contactFrame?: number | null | undefined;
  readonly activate?: boolean | undefined;
  readonly confirm?: boolean | undefined;
}

/** What a settings change moves (§5.9, §5.12): fps always; range, scene start or loop over the user's overrides. */
function settingsRisk(
  ctx: AgentToolContext,
  args: ClipUpdateArgs,
): { readonly fps: boolean; readonly overrides: number; readonly moves: boolean } {
  const target = addressed(ctx, args);
  const fpsChange = args.fps !== undefined && fpsValue(fpsOf(args.fps)) !== fpsValue(target.record.fps);
  const rangeChange =
    args.rangeFrames !== undefined &&
    (args.rangeFrames[0] !== target.record.range.start || args.rangeFrames[1] !== target.record.range.end);
  const loopChange = args.loop !== undefined && args.loop !== target.record.loop;
  const overrides = ctx.host.capabilities.has('user') ? overridesOn(ctx.app, target.character.id) : 0;
  return { fps: fpsChange, overrides, moves: fpsChange || rangeChange || loopChange };
}

export function clipUpdateConfirm(ctx: AgentToolContext, args: ClipUpdateArgs): ConfirmPrompt | null {
  if (args.name !== undefined || args.activate !== undefined) return null;
  const risk = settingsRisk(ctx, args);
  const target = addressed(ctx, args);
  if (risk.fps) {
    return {
      title: `AI wants to change the fps of clip ${quoteName(target.clip.name)} to ${args.fps}`,
      detail: `${args.fpsMode === 'keep_frames' ? 'Keys keep their frames (the motion plays faster or slower)' : 'Keys move to keep their timing in seconds'}${risk.overrides > 0 ? `; your ${risk.overrides} unkeyed edits are dropped` : ''}. Undo restores it.`,
      danger: false,
    };
  }
  if (risk.moves && risk.overrides > 0) {
    return {
      title: `AI wants to change the range or loop of clip ${quoteName(target.clip.name)}`,
      detail: `Your ${risk.overrides} unkeyed edits on this character are dropped. Undo restores the clip.`,
      danger: false,
    };
  }
  return null;
}

export async function clipUpdate(ctx: AgentToolContext, args: ClipUpdateArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const clip = target.clip.id;
  if (args.name !== undefined) {
    const taken = ctx.app.store.query
      .clipsOfCharacter(target.character.id)
      .find((c) => c.name === args.name && c.id !== clip);
    if (taken !== undefined) {
      throw new AgentToolFailure(
        'invalid_args',
        `The character already has a clip named ${quoteName(args.name)}.`,
        'pick another name',
        {
          detail: { path: 'name' },
        },
      );
    }
    const stale = staleCheck(ctx, clip, args.ifClipRevision, { curves: [], clipRecord: true });
    ctx.focus(
      { character: target.character.id, clip, controls: [], frame: null },
      `Rename clip ${labelName(target.clip.name)}`,
    );
    const run = await ctx.run('clip.rename', { clip, name: args.name });
    valueOf('clip.rename', run);
    return writeResult(ctx, clip, run, { clip: clipInfo(ctx, clip), overridesDropped: 0, activated: false }, [stale]);
  }
  if (args.activate !== undefined) {
    if (!args.activate) {
      throw new AgentToolFailure(
        'invalid_args',
        'activate: false changes nothing.',
        'pass activate: true to show the clip',
        {
          detail: { path: 'activate' },
        },
      );
    }
    const before = overridesOn(ctx.app, target.character.id);
    ctx.focus(
      { character: target.character.id, clip, controls: [], frame: null },
      `Show clip ${labelName(target.clip.name)}`,
    );
    const run = await ctx.run('clip.setActive', { clip }, { access: 'view' });
    valueOf('clip.setActive', run);
    const dropped = Math.max(0, before - overridesOn(ctx.app, target.character.id));
    return writeResult(ctx, clip, run, { clip: clipInfo(ctx, clip), overridesDropped: dropped, activated: true }, [
      dropped > 0 ? `switching the clip dropped ${dropped} unkeyed edits of the user` : null,
    ]);
  }
  const range = args.rangeFrames === undefined ? undefined : rangeArg(args.rangeFrames, 'rangeFrames');
  if (range !== undefined && (range[0] === range[1] || range[1] - range[0] > AGENT_RANGE_MAX)) {
    throw new AgentToolFailure(
      range[0] === range[1] ? 'invalid_args' : 'limit',
      range[0] === range[1]
        ? 'The range needs at least two frames.'
        : `A range longer than ${AGENT_RANGE_MAX.toLocaleString('en')} frames.`,
      'pass rangeFrames [start, end] with start < end',
      { detail: { path: 'rangeFrames' } },
    );
  }
  const risk = settingsRisk(ctx, args);
  const stale = staleCheck(ctx, clip, args.ifClipRevision, {
    curves: risk.fps && args.fpsMode !== 'keep_frames' ? 'all' : [],
    clipRecord: true,
  });
  const before = overridesOn(ctx.app, target.character.id);
  ctx.focus(
    { character: target.character.id, clip, controls: [], frame: null },
    `Clip settings ${labelName(target.clip.name)}`,
  );
  const run = await ctx.run('clip.setSettings', {
    clip,
    ...(args.fps === undefined ? {} : { fps: fpsOf(args.fps) }),
    ...(args.fpsMode === undefined
      ? {}
      : { fpsMode: args.fpsMode === 'keep_seconds' ? 'keep-seconds' : 'keep-frames' }),
    ...(range === undefined ? {} : { range: { start: range[0], end: range[1] } }),
    ...(args.loop === undefined ? {} : { loop: args.loop }),
    ...(args.rootMotion === undefined ? {} : { rootMotion: args.rootMotion === 'keep' ? 'hips' : 'in-place' }),
    ...(args.slot === undefined ? {} : { slot: args.slot }),
    ...(args.tags === undefined ? {} : { tags: args.tags }),
    ...(args.contactFrame === undefined ? {} : { contact: args.contactFrame }),
  });
  valueOf('clip.setSettings', run);
  const dropped = Math.max(0, before - overridesOn(ctx.app, target.character.id));
  return writeResult(ctx, clip, run, { clip: clipInfo(ctx, clip), overridesDropped: dropped, activated: false }, [
    stale,
    dropped > 0 ? `the clip's frames moved, so ${dropped} unkeyed edits of the user were dropped` : null,
  ]);
}

// ---------- clip_make_loop ----------
export interface ClipMakeLoopArgs {
  readonly character?: string | undefined;
  readonly clip?: string | undefined;
  readonly ifClipRevision?: number | undefined;
  readonly method: 'match_ends' | 'blend' | 'cycle_only';
  readonly blendFrames: number;
  readonly rootTravel: 'cycle_offset' | 'in_place' | 'keep';
  readonly dryRun: boolean;
}

/** Seam thresholds on channels (§5.16): C0 ≤ 1e-6, C1 ≤ 1e-3 per frame (stored units). */
export const SEAM_C0 = 1e-6;
export const SEAM_C1 = 1e-3;

interface SeamMetrics {
  readonly maxC0: number;
  readonly maxC1: number;
  readonly worst: readonly { readonly control: ControlId; readonly channel: ChannelId }[];
}

function seamSummary(ctx: AgentToolContext, seam: SeamMetrics, loop: boolean) {
  const verdict = !loop
    ? ('not_a_loop' as const)
    : seam.maxC0 > SEAM_C0
      ? ('pops' as const)
      : seam.maxC1 > SEAM_C1
        ? ('hitches' as const)
        : ('seamless' as const);
  return {
    verdict,
    maxC0: roundTo(seam.maxC0, 1e-6),
    maxC1PerFrame: roundTo(seam.maxC1, 1e-6),
    worst: seam.worst.slice(0, 5).map((t) => {
      const control = ctx.app.store.get('controls', t.control);
      return `${control === undefined ? t.control : controlKeyOf(control)} ${t.channel}`;
    }),
  };
}

const LOOP_METHOD = { match_ends: 'matchEnds', blend: 'blend', cycle_only: 'cycleOnly' } as const;
const ROOT_TRAVEL = { cycle_offset: 'cycleOffset', in_place: 'inPlace', keep: 'keep' } as const;

export async function clipMakeLoop(ctx: AgentToolContext, args: ClipMakeLoopArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const clip = target.clip.id;
  const wasLoop = target.record.loop;
  const stale = args.dryRun ? null : staleCheck(ctx, clip, args.ifClipRevision, { curves: 'all', clipRecord: true });
  ctx.focus(
    { character: target.character.id, clip, controls: [], frame: null },
    `Make loop ${labelName(target.clip.name)}`,
  );
  const run = await ctx.run('clip.makeLoop', {
    clip,
    method: LOOP_METHOD[args.method],
    ...(args.method === 'blend' ? { blendFrames: args.blendFrames } : {}),
    rootTravel: ROOT_TRAVEL[args.rootTravel],
    dryRun: args.dryRun,
  });
  const value = valueOf<{ readonly before: SeamMetrics; readonly after: SeamMetrics; readonly curvesChanged: number }>(
    'clip.makeLoop',
    run,
  );
  return writeResult(
    ctx,
    clip,
    args.dryRun ? null : run,
    {
      before: seamSummary(ctx, value.before, wasLoop),
      after: seamSummary(ctx, value.after, true),
      curvesChanged: value.curvesChanged,
      dryRun: args.dryRun,
    },
    [stale],
  );
}

// ---------- clip_delete ----------
export interface ClipDeleteArgs {
  readonly character?: string | undefined;
  readonly clip: string;
  readonly confirm?: boolean | undefined;
}

/**
 * Whether this build's clip.delete would write the session itself (deleting the active clip before P1's actor-safe
 * migration). Live that is refused up front — before any confirmation card; headless has no user to protect, so the
 * run goes ahead with `access: 'view'` (MCP-SPEC §4.1 runner rule 6 does not apply).
 */
function legacyDelete(ctx: AgentToolContext, target: ReturnType<typeof addressed>): boolean {
  const wasActive = ctx.app.session.getState().activeClip[target.character.id] === target.clip.id;
  if (!wasActive || explicitOperatorsIn(ctx.app)) return false;
  if (ctx.host.mode === 'live') {
    throw notAvailableInThisBuild(
      'Deleting the clip the user is looking at would switch the user’s clip.',
      'delete another clip, or ask the user to delete this one',
    );
  }
  return true;
}

export function clipDeleteConfirm(ctx: AgentToolContext, args: ClipDeleteArgs): ConfirmPrompt {
  const target = addressed(ctx, args);
  legacyDelete(ctx, target);
  const looking =
    ctx.host.capabilities.has('user') && ctx.app.session.getState().activeClip[target.character.id] === target.clip.id;
  return {
    title: `Delete clip ${quoteName(target.clip.name)}?`,
    detail: `${looking ? 'It is the clip you are looking at; the editor switches to another clip. ' : ''}Its keys go with it. Undo restores it.`,
    danger: true,
  };
}

export async function clipDelete(ctx: AgentToolContext, args: ClipDeleteArgs): Promise<AgentToolResult<unknown>> {
  const target = addressed(ctx, args);
  const clip = target.clip.id;
  const wasActive = ctx.app.session.getState().activeClip[target.character.id] === clip;
  const legacy = legacyDelete(ctx, target);
  ctx.focus(
    { character: target.character.id, clip: null, controls: [], frame: null },
    `Delete clip ${labelName(target.clip.name)}`,
  );
  const run = await ctx.run('clip.delete', { clip }, legacy ? { access: 'view' } : undefined);
  valueOf('clip.delete', run);
  const nowId = ctx.app.session.getState().activeClip[target.character.id];
  const now = nowId === undefined ? undefined : ctx.app.store.get('clips', nowId);
  const userNowSees = ctx.host.capabilities.has('user') && wasActive ? (now?.name ?? null) : null;
  return writeResult(ctx, null, run, { deleted: target.clip.name, userNowSees }, [
    userNowSees !== null
      ? `it was the user's active clip; the editor now shows ${quoteName(userNowSees)}`
      : ctx.host.capabilities.has('user') && wasActive
        ? "it was the user's active clip; the character now has no clip"
        : null,
  ]);
}
