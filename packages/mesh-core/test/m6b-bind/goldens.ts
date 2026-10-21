// P-S5 (M6B-SPEC §5.26): the bind cases whose manifest ids must be the same in Node, the skin worker and Chromium —
// computed here (pure, no file access) by the Node test (bind-goldens.test.ts, which keeps goldens.json) and the
// Chromium run (bind.browser.test.ts). The skin worker runs the same `bindSkin` on the same inputs (E2E-SKIN-01 and
// editor-core's skin-service test compare its manifests with a Node run).
import cubeLadText from '../../../../fixtures/models/cube-lad-truth.json?raw';
import {
  type BindMethod,
  bindSkin,
  type MeshData,
  type SkinBindArgs,
  type SkinSkeleton,
  skinGeometryOf,
  withSkin,
  writeRevision,
} from '../../src';
import {
  body,
  bodySkeletonRows,
  type CubeLadTruth,
  cubeLad,
  cubeLadRows,
  skeletonOf,
  tubeCharacter,
  worm,
} from './fixtures';

export const DEFAULT_ARGS: SkinBindArgs & { readonly symmetrize: boolean } = {
  method: 'auto-lowpoly',
  joints: null,
  points: null,
  hierarchy: true,
  dropoff: 4,
  stiffness: 1,
  pruneBelow: 0.025,
  rigidifyAbove: null,
  symmetrize: true,
};

export interface BindGolden {
  readonly manifest: string;
  readonly palette: readonly string[];
  readonly islands: number;
  readonly rigidIslands: number;
  readonly heatIslands: number;
  readonly unreachable: number;
  readonly cgIterations: number;
}

export function cubeLadTruth(): CubeLadTruth {
  return JSON.parse(cubeLadText) as CubeLadTruth;
}

/** The manifest id of a mesh with its bound skin (the revision content hash). */
export function boundManifest(mesh: MeshData, skin: Parameters<typeof withSkin>[1]): string {
  return writeRevision(withSkin(mesh, skin)).manifestId;
}

function golden(mesh: MeshData, skeleton: SkinSkeleton, method: BindMethod): BindGolden {
  const geom = skinGeometryOf(mesh, skeleton.height);
  const { skin, report } = bindSkin(geom, skeleton, { ...DEFAULT_ARGS, method }, null);
  return {
    manifest: boundManifest(mesh, skin),
    palette: skin.palette.map((entry) => entry.key),
    islands: report.islands,
    rigidIslands: report.rigidIslands,
    heatIslands: report.heatIslands,
    unreachable: report.unreachable.length,
    cgIterations: report.cgIterations,
  };
}

const METHODS: readonly BindMethod[] = ['auto-lowpoly', 'heat', 'rigid-islands', 'closest'];

/** Every P-S5 case: the generated body (smooth, segmented), the Cube Lad and the tube character × the four methods. */
export function bindGoldenValues(): Record<string, BindGolden> {
  const out: Record<string, BindGolden> = {};
  const bodySkeleton = skeletonOf(bodySkeletonRows());
  const truth = cubeLadTruth();
  const lad = cubeLad(truth);
  const ladSkeleton = skeletonOf(cubeLadRows(truth));
  const character = tubeCharacter();
  const small = worm(20, 16, 12);
  const cases: readonly (readonly [string, MeshData, SkinSkeleton])[] = [
    ['body-smooth', body('smooth'), bodySkeleton],
    ['body-segmented', body('segmented'), bodySkeleton],
    ['cube-lad', lad.mesh, ladSkeleton],
    ['tube-character', character.mesh, character.skeleton],
    ['worm', small.mesh, small.skeleton],
  ];
  for (const [name, mesh, skeleton] of cases) {
    for (const method of METHODS) out[`${name}/${method}`] = golden(mesh, skeleton, method);
  }
  return out;
}
