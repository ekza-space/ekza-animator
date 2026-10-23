// The runs of the character setup tools (MCP-SPEC §0.4.4; B4). Every write is an Auto-Rig composition or one of its
// inner operators (AUTORIG-SPEC §4.5), so an agent and the Auto-Rig wizard produce the same document; the
// compositions forward the agent's run context, so each inner step is its own `AI: …` step.
//
// - model_inspect: `autorig.inspect {meshes}` (no step).
// - model_fix: `autorig.fix {fix, meshes, height}` (one step), then the report again.
// - rig_create: Quick Rig on the meshes (`skel.quickRig.start`, `.setPreset`, `.setMarker` — the Rig & Skin session,
//   hence `access: 'view'`), the gates of ② (start checks, ① Size AR-R5-1, arms AR-D10-3) checked before anything is
//   written, then `autorig.rig {straighten, rigidParts}`: "Create Skeleton", "Bind Skin" (+ rigid part binds) and
//   "Straighten to T-Pose" for an A-posed input. A refused or failed rig closes the Quick Rig it opened.
// - library_list: the starter pack manifest.
// - library_use: `autorig.clip.add {character, clip, params, replace}` (Use Clip, one step) and an optional rename.
import type { CharacterId, ClipId, MeshId } from '@ekza-studio/doc';
import {
  type AutoRigRigResult,
  autoRigBlock,
  CHECK_REASONS,
  type EditorApp,
  type IntakeReport,
  quickRigOf,
} from '@ekza-studio/editor-core';
import type { QuickRigMarker } from '@ekza-studio/rig';
import { fpsNumber } from '../../units/units';
import type { AgentToolContext, AgentToolResult, OperatorRun } from '../../types';
import { AgentToolFailure } from '../../types';
import { clipInfo } from '../../runtime/toolkit';
import {
  A_POSE_LIMIT_DEG,
  AUTORIG_FIX,
  characterReady,
  HEIGHT_LIMITS_M,
  lastUndo,
  type ModelFix,
  type ModelReport,
  modelReport,
  resolveSceneMeshes,
  setupValue,
  stepsSince,
  topStep,
} from './common';

// ---------------------------------------------------------------------------------------------------------------------
// model_inspect, model_fix

async function inspect(ctx: AgentToolContext, ids: readonly MeshId[], names: readonly string[]): Promise<ModelReport> {
  const run = await ctx.run('autorig.inspect', { meshes: [...ids] });
  return modelReport(setupValue<IntakeReport>('autorig.inspect', run), names);
}

export async function modelInspect(
  ctx: AgentToolContext,
  args: { readonly meshes?: readonly string[] | undefined },
): Promise<AgentToolResult<ModelReport>> {
  const meshes = resolveSceneMeshes(ctx.app, args.meshes);
  const report = await inspect(ctx, meshes.ids, meshes.names);
  const next = report.readyToRig
    ? 'rig_create'
    : report.fixes.length > 0
      ? (report.fixes[0]?.hint ?? 'model_fix')
      : 'see problems';
  return { ok: true, data: report, next };
}

export async function modelFix(
  ctx: AgentToolContext,
  args: {
    readonly fix: ModelFix;
    readonly meshes?: readonly string[] | undefined;
    readonly heightM?: number | undefined;
  },
): Promise<AgentToolResult<ModelReport>> {
  const meshes = resolveSceneMeshes(ctx.app, args.meshes);
  const before = topStep(ctx.app);
  const run = await ctx.run('autorig.fix', {
    fix: AUTORIG_FIX[args.fix],
    meshes: [...meshes.ids],
    ...(args.fix === 'scale' ? { height: args.heightM ?? HEIGHT_LIMITS_M.target } : {}),
  });
  setupValue('autorig.fix', run);
  const steps = stepsSince(ctx, before);
  const report = await inspect(ctx, meshes.ids, meshes.names);
  const next = report.readyToRig ? 'rig_create' : (report.fixes[0]?.hint ?? 'see problems');
  return { ok: true, data: report, ...lastUndo(steps), ...warningsOf(run), next };
}

function warningsOf(run: OperatorRun): { readonly warnings?: readonly string[] } {
  return run.warnings.length === 0 ? {} : { warnings: [...new Set(run.warnings)] };
}

// ---------------------------------------------------------------------------------------------------------------------
// rig_create

/** `runComposition`'s stop message (AUTORIG-SPEC §4.5 exclusivity; `wizard/compose.ts`, which is in the lazy rig chunk). */
export const COMPOSITION_INTERRUPTED = 'Rigging was interrupted by another change';

export const RIG_PRESETS = { standard: 'standard33', standard_fingers: 'full52' } as const;

export interface RigCreateArgs {
  readonly meshes?: readonly string[] | undefined;
  readonly markers?: readonly { readonly name: QuickRigMarker; readonly positionM: readonly number[] }[] | undefined;
  readonly preset?: keyof typeof RIG_PRESETS | undefined;
  readonly straightenToTPose?: boolean | undefined;
  readonly rigidParts?: boolean | undefined;
}

export interface RigCreateData {
  readonly character: string;
  readonly skeleton: string;
  readonly straightened: boolean;
  readonly joints: number;
  readonly steps: readonly string[];
  readonly validation: readonly { readonly code: string; readonly severity: string; readonly count: number }[];
}

/** The Validation profile of the result rows (the VRM profile Auto-Rig exports with). */
export const RIG_PROFILE = 'ekza/space-avatar-v1';

/** The tool that clears an Auto-Rig gate, by the gate's reason (②'s start checks, ① Size, the arms). */
function gateHint(reason: string): string | null {
  if (reason.includes('Set height')) {
    return `model_fix {fix: 'scale', heightM: ${HEIGHT_LIMITS_M.target}} first (the rig needs ${HEIGHT_LIMITS_M.min}–${HEIGHT_LIMITS_M.max} m)`;
  }
  if (reason === CHECK_REASONS.centred || reason === CHECK_REASONS.grounded) return "model_fix {fix: 'center'} first";
  if (reason === CHECK_REASONS.facing) return "model_fix {fix: 'face_forward'} first";
  if (reason.startsWith('Auto-Rig could not find the arms')) {
    return "pass markers [{name: 'shoulder', positionM}, {name: 'elbow', …}, {name: 'wrist', …}] on the character's right arm (x < 0), metres";
  }
  if (reason === COMPOSITION_INTERRUPTED)
    return 'the scene changed while rigging; model_inspect, then rig_create again';
  return null;
}

const quickRigCtx = (ctx: AgentToolContext) => ({ source: 'api' as const, actor: ctx.actor, access: 'view' as const });

/** Closes a Quick Rig session this call opened (the user's session as it was), ignoring a refusal. */
async function closeQuickRig(ctx: AgentToolContext): Promise<void> {
  if (quickRigOf(ctx.app) !== null) await ctx.app.runUntyped('skel.quickRig.cancel', undefined, quickRigCtx(ctx));
}

function validationOf(app: EditorApp, character: CharacterId): RigCreateData['validation'] {
  const counts = new Map<string, { code: string; severity: string; count: number }>();
  for (const row of app.rig.validation.rows(character, RIG_PROFILE)) {
    const entry = counts.get(row.code) ?? { code: row.code, severity: row.severity, count: 0 };
    entry.count += Math.max(1, row.ids.length);
    counts.set(row.code, entry);
  }
  const order = { error: 0, warning: 1, info: 2 } as Readonly<Record<string, number>>;
  return [...counts.values()].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

export async function rigCreate(ctx: AgentToolContext, args: RigCreateArgs): Promise<AgentToolResult<RigCreateData>> {
  const { app } = ctx;
  const meshes = resolveSceneMeshes(app, args.meshes);
  if (quickRigOf(app) !== null) {
    if (ctx.host.mode === 'live') {
      throw new AgentToolFailure(
        'busy',
        'Quick Rig is open in the editor.',
        'ask the user to finish or cancel Quick Rig, then call rig_create again',
      );
    }
    await closeQuickRig(ctx);
  }
  await app.rig.load();
  const before = topStep(app);
  let rigged = false;
  try {
    // ② Markers: Quick Rig on the meshes; the One-Click guess places the markers.
    const start = await ctx.run('skel.quickRig.start', { meshes: [...meshes.ids] }, { access: 'view' });
    setupValue('skel.quickRig.start', start, gateHint);
    const preset = RIG_PRESETS[args.preset ?? 'standard'];
    if (quickRigOf(app)?.preset !== preset) {
      setupValue('skel.quickRig.setPreset', await ctx.run('skel.quickRig.setPreset', { preset }, { access: 'view' }));
    }
    for (const marker of args.markers ?? []) {
      const [x = 0, y = 0, z = 0] = marker.positionM;
      const set = await ctx.run(
        'skel.quickRig.setMarker',
        { name: marker.name, point: [x, y, z], moved: true },
        { access: 'view' },
      );
      setupValue('skel.quickRig.setMarker', set);
    }
    const state = quickRigOf(app);
    if (state === null) {
      throw new AgentToolFailure('stale', 'Quick Rig closed while the markers were placed.', 'call rig_create again');
    }
    // The gates of ② (start checks, ① Size, the arms) before anything is written.
    const block = autoRigBlock(state);
    if (block !== null) {
      throw new AgentToolFailure('poll_failed', `Auto-Rig refused: ${block}.`, gateHint(block) ?? 'model_inspect', {
        detail: { operatorReason: block },
      });
    }
    const armAngleDeg = ((state.guess?.armAngle ?? 0) * 180) / Math.PI;
    const straighten = args.straightenToTPose ?? armAngleDeg > A_POSE_LIMIT_DEG;
    const rigidParts = args.rigidParts ?? meshes.ids.length > 1;
    const run = await ctx.run('autorig.rig', { straighten, rigidParts }, { access: 'view' });
    const result = setupValue<AutoRigRigResult>('autorig.rig', run, gateHint);
    rigged = true;
    await characterReady(ctx, result.character);
    const steps = stepsSince(ctx, before);
    const record = app.store.get('characters', result.character);
    return {
      ok: true,
      data: {
        character: record?.name ?? result.character,
        skeleton: result.skeleton,
        straightened: result.straightened,
        joints: app.store.query.jointsOfSkeleton(result.skeleton).length,
        steps: steps.map((step) => step.label),
        validation: validationOf(app, result.character),
      },
      ...lastUndo(steps),
      ...warningsOf(run),
      next: 'view_capture front to look at it, then library_use {clip: "walk"}; project_export {kind: "vrm"} needs meta (authors, license)',
    };
  } catch (error) {
    if (error instanceof AgentToolFailure && error.detail?.['operatorReason'] === COMPOSITION_INTERRUPTED) {
      const made = stepsSince(ctx, before).map((step) => step.label);
      throw new AgentToolFailure(
        'stale',
        `Rigging was interrupted by another change; the steps already made stay (${made.join(', ') || 'none'}).`,
        'model_inspect and scene_summary, then rig_create again or undo the steps',
        { detail: { steps: made } },
      );
    }
    throw error;
  } finally {
    if (!rigged) await closeQuickRig(ctx);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// library_list, library_use

/** The starter pack's clip ids (`apps/web/public/library/animations/starter-pack.json`, `tooling/make-starter-pack.mjs`). */
export const LIBRARY_CLIP_IDS = [
  'idle',
  'walk',
  'run',
  'jog',
  'sword-attack',
  'punch',
  'cast',
  'hit',
  'death',
  'dance',
  'pistol-shoot',
  'jump-start',
  'jump-loop',
  'jump-land',
] as const;
export type LibraryClipId = (typeof LIBRARY_CLIP_IDS)[number];

const USES: Readonly<Record<string, string>> = {
  idle: 'standing idle (loop)',
  walk: 'walk cycle (loop, moves forward; inPlace for a treadmill)',
  run: 'sprint cycle (loop)',
  jog: 'jog cycle (loop)',
  'sword-attack': 'one-handed sword swing',
  punch: 'punch',
  cast: 'spell cast',
  hit: 'hit reaction',
  death: 'death fall',
  dance: 'dance (loop)',
  'pistol-shoot': 'pistol shot',
  'jump-start': 'jump take-off',
  'jump-loop': 'in the air (loop)',
  'jump-land': 'landing',
};

export interface LibraryListData {
  readonly clips: readonly {
    readonly id: string;
    readonly label: string;
    readonly loop: boolean;
    readonly seconds: number;
    readonly slot: string | null;
    readonly use: string;
  }[];
  readonly license: string;
  readonly credit: string;
}

async function manifestOf(app: EditorApp) {
  try {
    return await app.library.service.manifest();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentToolFailure(
      'unsupported',
      `The clip library is not available here: ${message}.`,
      'ask the user to add the clip in Studio',
      {
        retryable: false,
      },
    );
  }
}

export async function libraryList(ctx: AgentToolContext): Promise<AgentToolResult<LibraryListData>> {
  const manifest = await manifestOf(ctx.app);
  return {
    ok: true,
    data: {
      clips: manifest.clips.map((clip) => ({
        id: clip.id,
        label: clip.label,
        loop: clip.loop,
        seconds: Math.round(clip.duration * 1_000) / 1_000,
        slot: clip.slot,
        use: USES[clip.id] ?? clip.label,
      })),
      license: manifest.license,
      credit: manifest.credit,
    },
    next: 'library_use {character, clip}',
  };
}

export interface LibraryUseArgs {
  readonly character?: string | undefined;
  readonly clip: LibraryClipId;
  readonly name?: string | undefined;
  readonly speedFactor?: number | undefined;
  readonly mirror?: boolean | undefined;
  readonly inPlace?: boolean | undefined;
  readonly armSpaceDeg?: number | undefined;
  readonly trimSeconds?: readonly number[] | undefined;
  readonly replace?: string | undefined;
}

export interface LibraryUseData {
  readonly clip: string;
  readonly source: string;
  readonly fps: number;
  readonly rangeFrames: readonly [number, number];
  readonly loop: boolean;
  readonly activated: boolean;
}

export async function libraryUse(
  ctx: AgentToolContext,
  args: LibraryUseArgs,
): Promise<AgentToolResult<LibraryUseData>> {
  const { app } = ctx;
  const character = ctx.resolve.character(args.character);
  await characterReady(ctx, character.id);
  const replace = args.replace === undefined ? undefined : ctx.resolve.clip(character.id, args.replace).id;
  const manifest = await manifestOf(app);
  if (!manifest.clips.some((clip) => clip.id === args.clip)) {
    throw new AgentToolFailure('not_found', `The library has no clip "${args.clip}".`, 'library_list lists the clips', {
      candidates: manifest.clips.slice(0, 5).map((clip) => clip.id),
    });
  }
  const [start, end] = args.trimSeconds ?? [];
  const params = {
    speed: args.speedFactor ?? 1,
    trim: start === undefined || end === undefined ? null : { start, end },
    mirror: args.mirror ?? false,
    inPlace: args.inPlace ?? false,
    armSpace: args.armSpaceDeg ?? 0,
  };
  // Headless (no user) the new clip becomes the active one, as clip_create's; in the user's editor it stays out of
  // their view (they can click Show) — Use Clip activates it only for a run with View access.
  const activate = ctx.host.mode === 'headless';
  const before = topStep(app);
  const run = await ctx.run(
    'autorig.clip.add',
    { character: character.id, clip: args.clip, params, ...(replace === undefined ? {} : { replace }) },
    { access: activate ? 'view' : 'edit' },
  );
  const added = setupValue<{ readonly clip: ClipId }>('autorig.clip.add', run).clip;
  const record = app.store.get('clips', added);
  if (record === undefined)
    throw new AgentToolFailure('internal', 'Use Clip wrote no clip.', 'report this', { retryable: false });
  if (args.name !== undefined && args.name !== record.name) {
    const taken = app.store.query
      .clipsOfCharacter(character.id)
      .some((clip) => clip.id !== added && clip.name === args.name);
    if (taken) {
      throw new AgentToolFailure(
        'exists',
        `The clip was added as "${record.name}": a clip "${args.name}" exists.`,
        'pick another name with clip_update',
        {
          retryable: false,
        },
      );
    }
    setupValue('clip.rename', await ctx.run('clip.rename', { clip: added, name: args.name }));
  }
  const final = app.store.get('clips', added) ?? record;
  const steps = stepsSince(ctx, before);
  return {
    ok: true,
    data: {
      clip: final.name,
      source: args.clip,
      fps: fpsNumber(final.fps),
      rangeFrames: [final.range.start, final.range.end],
      loop: final.loop,
      activated: app.session.getState().activeClip[character.id] === added,
    },
    clip: clipInfo(ctx, added),
    ...lastUndo(steps),
    ...warningsOf(run),
    next: 'keys_read or view_capture the new clip; pass clip on every edit',
  };
}
