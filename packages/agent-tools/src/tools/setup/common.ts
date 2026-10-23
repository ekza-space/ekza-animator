// Shared parts of the character setup tools (MCP-SPEC §0.4.4; B4): scene mesh addressing, the Auto-Rig intake report
// in tool units, the history steps one call recorded (a composition records several, each `AI: …`), and the errors of
// the Auto-Rig gates with the tool that fixes them.
import type { CharacterId, MeshId, MeshRecord } from '@ekza-studio/doc';
import { ARMS_NOT_FOUND, type EditorApp, type IntakeReport } from '@ekza-studio/editor-core';
import { z } from 'zod';
import { finishedValue } from '../../envelope/errors';
import type { AgentToolContext, OperatorRun, UndoInfo } from '../../types';
import { AgentToolFailure } from '../../types';

const DEG = 180 / Math.PI;
/** AUTORIG-SPEC §4.3: the pose class limit (the `skel.tpose` 5°): above it the input is A-posed and is straightened. */
export const A_POSE_LIMIT_DEG = 5;
/** AUTORIG-SPEC §5.2 Size (AR-R5-1): the rig refuses a character outside 0.3–3 m until `model_fix {fix: 'scale'}`. */
export const HEIGHT_LIMITS_M = { min: 0.3, max: 3, target: 1.7 } as const;

const NO_MODEL_HINT =
  "project_import a model first ({path: 'model.glb'} or {sample: 'cube_lad' | 'polybot_tpose' | 'polybot_apose'})";

/** The live scene meshes (models before Create Skeleton), in id order. */
export function sceneMeshRecords(app: EditorApp): readonly MeshRecord[] {
  return app.store.list('meshes').filter((mesh) => 'scene' in mesh.owner);
}

export interface ResolvedMeshes {
  readonly ids: readonly MeshId[];
  readonly names: readonly string[];
}

/**
 * Scene meshes by name (case-insensitive) or id; every scene mesh when `refs` is absent. Throws `not_found` (with up to
 * five candidates) or `ambiguous`.
 */
export function resolveSceneMeshes(app: EditorApp, refs: readonly string[] | undefined): ResolvedMeshes {
  const all = sceneMeshRecords(app);
  if (all.length === 0) {
    throw new AgentToolFailure('not_found', 'The scene has no model meshes to set up.', NO_MODEL_HINT);
  }
  if (refs === undefined) return { ids: all.map((mesh) => mesh.id), names: all.map((mesh) => mesh.name) };
  const ids: MeshId[] = [];
  const names: string[] = [];
  const candidates = all.slice(0, 5).map((mesh) => mesh.name);
  for (const ref of refs) {
    const byId = all.find((mesh) => mesh.id === ref);
    const matches = byId !== undefined ? [byId] : all.filter((mesh) => mesh.name.toLowerCase() === ref.toLowerCase());
    if (matches.length === 0) {
      throw new AgentToolFailure('not_found', `No scene mesh "${ref}".`, 'model_inspect lists the scene meshes', {
        candidates,
      });
    }
    if (matches.length > 1) {
      throw new AgentToolFailure('ambiguous', `Several scene meshes are called "${ref}".`, 'pass the mesh id instead', {
        candidates: matches.slice(0, 5).map((mesh) => `${mesh.name} (${mesh.id})`),
      });
    }
    const mesh = matches[0] as MeshRecord;
    if (!ids.includes(mesh.id)) {
      ids.push(mesh.id);
      names.push(mesh.name);
    }
  }
  return { ids, names };
}

/** Quick Rig's markers (`QUICK_RIG_MARKERS`, rig `QuickRigMarker`; a test keeps them equal). */
export const MARKER_NAMES = [
  'headTop',
  'chin',
  'pelvis',
  'shoulder',
  'elbow',
  'wrist',
  'knee',
  'ankle',
  'toe',
] as const;

export const MODEL_FIXES = ['center', 'face_forward', 'stand_up', 'scale', 'freeze'] as const;
export type ModelFix = (typeof MODEL_FIXES)[number];
/** The tool's fix names → `autorig.fix`'s (AUTORIG-SPEC §4.5). */
export const AUTORIG_FIX: Readonly<Record<ModelFix, 'center' | 'face' | 'standUp' | 'scale' | 'freeze'>> = {
  center: 'center',
  face_forward: 'face',
  stand_up: 'standUp',
  scale: 'scale',
  freeze: 'freeze',
};

/** The report of model_inspect and model_fix (an `IntakeReport` in tool units). */
export const modelReportOut = z.object({
  kind: z.string().describe('static, project, vrm, rigged-humanoid or rigged-other'),
  fileName: z.string().nullable(),
  meshes: z.array(z.string()),
  triangles: z.number(),
  heightM: z.number(),
  textured: z.boolean(),
  weight: z.enum(['light', 'medium', 'heavy', 'too-heavy']),
  pose: z.enum(['t_pose', 'a_pose', 'unknown']),
  armAngleDeg: z.number().nullable(),
  checks: z.object({
    centered: z.boolean(),
    grounded: z.boolean(),
    facingForward: z.boolean(),
    upright: z.boolean(),
    scaleOk: z.boolean(),
    armsFound: z.boolean(),
  }),
  fixes: z.array(z.object({ check: z.string(), fix: z.enum(MODEL_FIXES), hint: z.string() })),
  problems: z.array(z.string()),
  readyToRig: z.boolean(),
});
export type ModelReport = z.output<typeof modelReportOut>;

const round = (value: number, digits = 3): number => {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
};

/** The `IntakeReport` of the Auto-Rig operators in tool units, with the fixes in the order to apply them. */
export function modelReport(report: IntakeReport, names: readonly string[]): ModelReport {
  const { checks } = report;
  const armsFound = !checks.upright || report.pose !== null;
  const fixes: ModelReport['fixes'] = [];
  const problems: string[] = [];
  if (!checks.upright) {
    fixes.push({
      check: 'upright',
      fix: 'stand_up',
      hint: "model_fix {fix: 'stand_up'} turns a model lying on its back upright",
    });
  }
  if (!checks.facing) {
    fixes.push({
      check: 'facingForward',
      fix: 'face_forward',
      hint: "model_fix {fix: 'face_forward'} turns it to face +Z",
    });
  }
  if (checks.scale !== 'ok') {
    fixes.push({
      check: 'scaleOk',
      fix: 'scale',
      hint: `model_fix {fix: 'scale', heightM: ${HEIGHT_LIMITS_M.target}} (the rig needs ${HEIGHT_LIMITS_M.min}–${HEIGHT_LIMITS_M.max} m; it is ${round(report.height, 2)} m)`,
    });
  }
  if (!checks.centred || !checks.grounded) {
    fixes.push({
      check: checks.centred ? 'grounded' : 'centered',
      fix: 'center',
      hint: "model_fix {fix: 'center'} centres it on the origin and stands it on the ground",
    });
  }
  if (!armsFound) {
    problems.push(
      `${ARMS_NOT_FOUND} (rig_create: pass markers shoulder, elbow and wrist of the character's right arm (x < 0) in metres, character space).`,
    );
  }
  if (report.weight === 'too-heavy') problems.push('Over 200,000 triangles: reduce the model before rigging.');
  if (report.kind === 'rigged-other') {
    problems.push('A skinned model that is not a humanoid: import it again to re-rig it from scratch.');
  }
  const pose = report.pose === null ? 'unknown' : report.pose.kind === 'a' ? 'a_pose' : 't_pose';
  return {
    kind: report.kind,
    fileName: report.fileName,
    meshes: [...names],
    triangles: report.triangles,
    heightM: round(report.height),
    textured: report.textured,
    weight: report.weight,
    pose,
    armAngleDeg: report.pose === null ? null : round(report.pose.armAngle * DEG, 1),
    checks: {
      centered: checks.centred,
      grounded: checks.grounded,
      facingForward: checks.facing,
      upright: checks.upright,
      scaleOk: checks.scale === 'ok',
      armsFound,
    },
    fixes,
    problems,
    readyToRig: fixes.length === 0 && problems.length === 0 && (report.kind === 'static' || report.kind === 'project'),
  };
}

/**
 * Resolves once the character's runtime (rig program) exists: a new character's is built asynchronously after the
 * step that created it, and clip operators refuse "The character is still loading" until then. Bounded (10 s).
 */
export function characterReady(ctx: AgentToolContext, character: CharacterId, maxMs = 10_000): Promise<void> {
  const { app } = ctx;
  if (app.characters.get(character) !== undefined) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timer);
      off();
      ctx.signal.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      done();
      reject(
        new AgentToolFailure('cancelled', 'The call was cancelled while the character loaded.', 'nothing more changed'),
      );
    };
    const timer = setTimeout(() => {
      done();
      reject(new AgentToolFailure('busy', 'The character is still loading.', 'retry in a moment'));
    }, maxMs);
    const off = app.characters.subscribe(() => {
      if (app.characters.get(character) === undefined) return;
      done();
      resolve();
    });
    ctx.signal.addEventListener('abort', abort, { once: true });
  });
}

/** The ids of the steps this actor recorded since `before` (the top step id before the call), oldest first. */
export function stepsSince(ctx: AgentToolContext, before: number | null): readonly UndoInfo[] {
  const out: UndoInfo[] = [];
  for (const step of ctx.app.history.entries().undo) {
    if (before !== null && step.id <= before) continue;
    if (step.actor?.id !== ctx.actor.id) continue;
    out.push({ step: step.id, label: step.label });
  }
  return out;
}

/** The top history step id now (null for an empty history). */
export function topStep(app: EditorApp): number | null {
  return app.history.peekUndo()?.id ?? null;
}

/** The `undo` of a result that recorded steps: the last one (Mod+Z undoes the steps one by one). */
export function lastUndo(steps: readonly UndoInfo[]): { readonly undo?: UndoInfo } {
  const last = steps.at(-1);
  return last === undefined ? {} : { undo: last };
}

/** The value of a finished run, else the operator's own reason as a tool error with a hint naming the fix. */
export function setupValue<T>(operator: string, run: OperatorRun, hint?: (reason: string) => string | null): T {
  const { result } = run;
  if (result.status === 'finished') return result.value as T;
  const reason = result.status === 'cancelled' ? result.reason : result.error.message;
  const fix = hint?.(reason) ?? null;
  if (result.status === 'cancelled' && fix !== null) {
    throw new AgentToolFailure('poll_failed', `${operator} refused: ${reason}.`, fix, {
      detail: { operatorReason: reason },
    });
  }
  if (result.status === 'failed' && fix !== null) {
    throw new AgentToolFailure(result.error.code === 'cancelled' ? 'cancelled' : 'poll_failed', reason, fix, {
      detail: { operatorReason: reason, ekzaCode: result.error.code },
    });
  }
  return finishedValue(operator, result) as T;
}
