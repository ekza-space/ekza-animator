// Mesh-level lints of an export (M6A-SPEC §4.5 lint table, §5.24 budgets, §5.25 Mesh Check; B8): they read the
// exported meshes' MeshData and records, which the GLB bytes no longer show:
//
// - `mesh.budget.tris` / `.materials` / `.textures` / `.joints` against the resolved budget (advisory);
// - Mesh Check diagnostics (B5's `checkMesh`): non-manifold, zero-area faces, loose geometry, inconsistent winding,
//   non-planar n-gons in faceted regions and concave n-gons (skipped while the kernel's Mesh Check is a stub);
// - `palette.missing-swatch`: faces painting a slot without a live swatch;
// - `mesh.influences`: sources with more than four influences per vertex;
// - `ekza.provenance-ai-undisclosed`: AI-generated sources exported without the generator in the provenance block.
//
// Lazy: reachable only through `io/mesh` (it uses the kernel's Mesh Check).
import { EkzaError } from '@ekza-animator/anim-core';
import type { MeshData, MeshProblem } from '@ekza-animator/mesh-core';
import { checkMesh, EDGE_HARD } from '../mesh/kernel';
import type { BudgetPreset } from '../profiles/budgets';
import type { ExportProfileDef, LintIssue } from '../types';
import { ruleSeverity } from './rules';

export interface MeshLintInput {
  readonly id: string;
  readonly name: string;
  readonly data: MeshData;
  /** The resolved budget (§5.24) or null. */
  readonly budget: { readonly label: string; readonly preset: BudgetPreset | null; readonly tris: number } | null;
  /** Live swatch slots of the mesh's palette (null: no palette, every painted slot is missing). */
  readonly swatchSlots: ReadonlySet<number> | null;
  /** Materials the mesh exports (glTF materials of its primitives). */
  readonly materials: number;
  /** Side of the largest texture the mesh uses, in pixels (0: none). */
  readonly textureSide: number;
  /** Joints of the mesh's skin (0: none). */
  readonly joints: number;
  /** Largest number of skin influences per vertex in its source (made-editable meshes; ≤ 4 otherwise). */
  readonly influences?: number;
  /** The mesh comes from AI-generated geometry (asset provenance). */
  readonly aiGenerated?: boolean;
}

export interface MeshLintOptions {
  /** Whether the export carries the AI generator in its provenance block (ekza_model_v1). */
  readonly generatorDisclosed: boolean;
}

/** Triangles of a mesh: n − 2 per n-gon (§5.4 always gives n − 2). */
export function triangleCount(data: MeshData): number {
  const { faces, corners } = data.counts;
  return corners - 2 * faces;
}

export function lintMeshes(
  inputs: readonly MeshLintInput[],
  profile: ExportProfileDef | null,
  opts: MeshLintOptions = { generatorDisclosed: true },
): readonly LintIssue[] {
  const issues: LintIssue[] = [];
  const emit = (code: string, message: string): void => {
    const severity = ruleSeverity(code, profile);
    if (severity !== null) issues.push({ code, severity, message });
  };
  for (const input of inputs) {
    const label = `'${input.name}'`;
    const budget = input.budget;
    if (budget !== null) {
      const tris = triangleCount(input.data);
      if (tris > budget.tris) {
        const warn = budget.preset === null ? '' : ` (warn above ${budget.preset.warnTris})`;
        emit(
          'mesh.budget.tris',
          `${label} has ${tris} triangles; its budget ${budget.label} allows ${budget.tris}${warn}`,
        );
      }
      const preset = budget.preset;
      if (preset !== null) {
        if (input.materials > preset.materials) {
          emit(
            'mesh.budget.materials',
            `${label} uses ${input.materials} materials; ${budget.label} allows ${preset.materials}`,
          );
        }
        if (input.textureSide > preset.textureSide) {
          emit(
            'mesh.budget.textures',
            `${label} uses a ${input.textureSide} px texture; ${budget.label} allows ${preset.textureSide} px`,
          );
        }
        if (preset.joints !== null && input.joints > preset.joints) {
          emit('mesh.budget.joints', `${label} uses ${input.joints} joints; ${budget.label} allows ${preset.joints}`);
        }
      }
    }
    if ((input.influences ?? 0) > 4) {
      emit('mesh.influences', `${label} had ${input.influences} influences per vertex; only four are kept`);
    }
    const missing = missingSwatchFaces(input);
    if (missing > 0) {
      emit(
        'palette.missing-swatch',
        `${missing} face${missing === 1 ? '' : 's'} of ${label} paint a slot without a live swatch (exported with slot 0's colour)`,
      );
    }
    if (input.aiGenerated === true && !opts.generatorDisclosed) {
      emit('ekza.provenance-ai-undisclosed', `${label} comes from AI-generated geometry the export does not disclose`);
    }
    for (const [code, message] of meshCheckLints(input)) emit(code, `${label}: ${message}`);
  }
  return issues;
}

function missingSwatchFaces(input: MeshLintInput): number {
  const paint = input.data.layers.get('paint');
  if (paint === undefined) return 0;
  let missing = 0;
  for (let f = 0; f < input.data.counts.faces; f++) {
    if (input.swatchSlots === null || !input.swatchSlots.has(paint.data[f] as number)) missing++;
  }
  return missing;
}

const CHECK_LINTS: Readonly<Record<string, string>> = {
  'non-manifold-edge': 'mesh.non-manifold',
  'non-manifold-vertex': 'mesh.non-manifold',
  'zero-area-face': 'mesh.zero-area-face',
  'loose-geometry': 'mesh.loose-geometry',
  'inconsistent-winding': 'mesh.inconsistent-winding',
  'concave-ngon': 'mesh.ngon-concave',
};

/** Mesh Check problems as lint codes; [] while the kernel's Mesh Check is not implemented (READY.b5). */
function meshCheckLints(input: MeshLintInput): [string, string][] {
  let problems: readonly MeshProblem[];
  try {
    problems = checkMesh(input.data);
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return [];
    throw error;
  }
  const out: [string, string][] = [];
  for (const problem of problems) {
    const count = problem.elements?.length ?? 1;
    if (problem.code === 'nonplanar-ngon') {
      const faceted = (problem.elements ?? []).filter((f) => allEdgesHard(input.data, f)).length;
      if (faceted > 0) out.push(['mesh.nonplanar-faceted', `${faceted} non-planar n-gon(s) in a faceted region`]);
      continue;
    }
    const code = CHECK_LINTS[problem.code];
    if (code !== undefined) out.push([code, `${problem.message} (${count})`]);
  }
  return out;
}

function allEdgesHard(data: MeshData, face: number): boolean {
  const edges = new Map<string, number>();
  for (let e = 0; e < data.counts.edges; e++) {
    const a = data.edgeVerts[2 * e] as number;
    const b = data.edgeVerts[2 * e + 1] as number;
    edges.set(a < b ? `${a},${b}` : `${b},${a}`, data.edgeFlags[e] as number);
  }
  const start = data.faceCorner[face] as number;
  let c = start;
  do {
    const a = data.cornerVert[c] as number;
    const b = data.cornerVert[data.cornerNext[c] as number] as number;
    if (((edges.get(a < b ? `${a},${b}` : `${b},${a}`) ?? 0) & EDGE_HARD) === 0) return false;
    c = data.cornerNext[c] as number;
  } while (c !== start);
  return true;
}
