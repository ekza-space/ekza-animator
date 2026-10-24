// The intake chain (MODELING-PLAN §7.2 G-a, research 15 §5.9): the steps of one job, in order, over every mesh of one
// model — normalize (the meshes together), reduce (one triangle budget split over the meshes), quadrangulate (the
// kernel op on each whole mesh) and palette bake (one palette for all). Each editor operator is a job of one step;
// the intake preset is the whole chain in one job (one worker round trip, one undo step). Pure and deterministic:
// the same job gives the same meshes and palette, byte for byte.
import { curveEngine } from '@ekza-studio/anim-core';
import type { MeshData } from '@ekza-studio/mesh-core';
import { editMeshFrom, isRefusal, MESH_OPS } from '@ekza-studio/mesh-core';
import { triangleCount } from './meshdata';
import { normalizeMeshes } from './normalize';
import { paletteBake } from './palette';
import { reduceMesh, splitBudget } from './reduce';
import { loadSimplifier, type Simplifier } from './simplifier';
import type {
  IntakeJob,
  IntakeMeshOut,
  IntakeResult,
  IntakeStep,
  IntakeStepReport,
  IntakeWarning,
  QuadrangulateArgs,
} from './types';

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

const total = (meshes: readonly MeshData[]): number => meshes.reduce((sum, data) => sum + triangleCount(data), 0);

/** The kernel's Quadrangulate on the whole mesh; the quads and remaining triangles of the result. */
export function quadrangulateMesh(
  data: MeshData,
  args: QuadrangulateArgs,
): { readonly data: MeshData; readonly quads: number; readonly triangles: number } {
  const op = MESH_OPS['mesh.quadrangulate'];
  if (op === undefined) throw new Error('mesh.quadrangulate is missing from the kernel');
  const mesh = editMeshFrom(data);
  mesh.begin('mesh.quadrangulate');
  const result = op.run(
    mesh,
    null,
    { angle: args.angle, keepHardEdges: true, keepSeams: true, keepMaterials: true },
    {
      symmetry: null,
      hidden: null,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      faceted: false,
      soft: null,
      curves: curveEngine,
      epsilon: 1e-9,
    },
  );
  if (isRefusal(result)) {
    mesh.abort();
    return { data, quads: 0, triangles: data.counts.faces };
  }
  mesh.end();
  const out = mesh.snapshot();
  let quads = 0;
  let triangles = 0;
  for (let f = 0; f < out.counts.faces; f++) {
    let n = 0;
    let c = out.faceCorner[f] as number;
    const first = c;
    do {
      n++;
      c = out.cornerNext[c] as number;
    } while (c !== first && n <= out.counts.corners);
    if (n === 4) quads++;
    else if (n === 3) triangles++;
  }
  return { data: out, quads, triangles };
}

/** Runs a job (see the module comment). The simplifier loads on the first reduce step unless one is passed. */
export async function runIntakeJob(job: IntakeJob, simplifier?: Simplifier): Promise<IntakeResult> {
  const started = now();
  let meshes: MeshData[] = job.meshes.map((mesh) => mesh.data);
  let world = false;
  let palette: (readonly [number, number, number])[] | null = null;
  const reports: IntakeStepReport[] = [];
  const warnings: IntakeWarning[] = [];
  for (const step of job.steps) {
    const t0 = now();
    const before = total(meshes);
    let facts: Record<string, number | string | boolean> = {};
    switch (step.kind) {
      case 'normalize': {
        const skinned = job.meshes.filter((mesh) => mesh.skinned).length;
        if (skinned > 0) throw new Error('Normalize works before rigging: a mesh has skin weights');
        const outcome = normalizeMeshes(
          meshes,
          job.meshes.map((mesh) => mesh.world),
          step.args,
        );
        meshes = [...outcome.meshes];
        world = true;
        facts = { ...outcome.facts, forward: step.args.forward, up: step.args.up, origin: step.args.origin };
        break;
      }
      case 'reduce': {
        const s = simplifier ?? (await loadSimplifier());
        const budgets = splitBudget(
          meshes.map((data) => triangleCount(data)),
          step.args.triangles,
        );
        let runs = 0;
        let error = 0;
        let errorMetres = 0;
        let locked = 0;
        let seamPoints = 0;
        let regularized = false;
        meshes = meshes.map((data, i) => {
          const outcome = reduceMesh(s, data, budgets[i] as number, step.args, job.meshes[i]?.skinned === true);
          runs += outcome.facts.runs;
          error = Math.max(error, outcome.facts.error);
          errorMetres = Math.max(errorMetres, outcome.facts.errorMetres);
          locked += outcome.facts.locked;
          seamPoints += outcome.facts.seamPoints;
          regularized ||= outcome.facts.regularized;
          warnings.push(...outcome.warnings);
          return outcome.data;
        });
        facts = { target: step.args.triangles, runs, error, errorMetres, locked, seamPoints, regularized };
        break;
      }
      case 'quadrangulate': {
        let quads = 0;
        let triangles = 0;
        meshes = meshes.map((data) => {
          const outcome = quadrangulateMesh(data, step.args);
          quads += outcome.quads;
          triangles += outcome.triangles;
          return outcome.data;
        });
        const faces = quads + triangles;
        facts = { quads, triangles, quadShare: faces === 0 ? 0 : quads / faces };
        break;
      }
      case 'paletteBake': {
        const outcome = paletteBake(
          meshes.map((data, i) => ({
            data,
            materials: job.meshes[i]?.materials ?? [],
            paint: job.meshes[i]?.paint ?? null,
          })),
          job.sources,
          step.args,
        );
        meshes = [...outcome.meshes];
        palette = [...outcome.palette];
        facts = { ...outcome.facts };
        break;
      }
      default: {
        const unknown: never = step;
        throw new Error(`Unknown intake step ${(unknown as IntakeStep).kind}`);
      }
    }
    reports.push({
      kind: step.kind,
      ms: now() - t0,
      trianglesBefore: before,
      trianglesAfter: total(meshes),
      facts,
    });
  }
  const out: IntakeMeshOut[] = meshes.map((data, i) => ({ key: job.meshes[i]?.key ?? String(i), data, world }));
  return { meshes: out, palette, steps: reports, warnings, ms: now() - started };
}

/** The buffers of a job or a result, for `postMessage`'s transfer list (each buffer once). */
export function transferablesOf(value: IntakeJob | IntakeResult): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (array: { readonly buffer: ArrayBufferLike }): void => {
    if (array.buffer instanceof ArrayBuffer) out.add(array.buffer);
  };
  const addMesh = (data: MeshData): void => {
    for (const array of [
      data.position,
      data.edgeVerts,
      data.edgeFlags,
      data.cornerVert,
      data.cornerNext,
      data.faceCorner,
      data.faceMaterial,
      data.faceFlags,
    ])
      add(array);
    for (const layer of data.layers.values()) add(layer.data);
  };
  for (const mesh of value.meshes) addMesh(mesh.data);
  if ('sources' in value)
    for (const source of value.sources) if (source.texture !== null) add(source.texture.image.rgba);
  return [...out];
}
