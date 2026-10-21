// M6b test API, C2 group (M6B-SPEC §4.8, §0.5; the skeleton kernel). §4.8 names no C2 function; these read the kernel
// for the Quick Rig and joint-fit scenarios (C3's E2E-QR-01/02, INT's E2E-MVP-01) without going through the UI:
// - `quickRigGuess(meshes)`: the start checks and the One-Click guess over the meshes' world triangles;
// - `quickRigFit(args)`: the joints Create Skeleton would write for `{preset, markers, meshes, flexion}` (the preview);
// - `skeletonChecks(character)`: the skel.* and xform.* problems of a character's skeleton (§5.21 rows before
//   severity);
// - `templateJoints(preset, height)`: the §5.2 template.
import { mat4Compose } from '@ekza-studio/anim-core';
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { kernelMeshes, loadMeshKernel, worldPlacement } from '@ekza-studio/editor-core';
import {
  checkSkeleton,
  DEFAULT_FLEXION,
  fitQuickRig,
  guessMarkers,
  isSkeletonPreset,
  quickRigStartChecks,
  type SkeletonPreset,
  skeletonTemplate,
} from '@ekza-studio/rig';
import type { M6bTestApiContext } from './support';

export interface SkeletonKernelTestApi {
  quickRigGuess(meshes: string[]): Promise<{
    checks: { centred: boolean; grounded: boolean; facing: boolean };
    markers: Record<string, number[]> | null;
    armAngle: number | null;
    aPose: boolean | null;
  }>;
  quickRigFit(args: {
    preset?: string;
    markers: Record<string, number[]>;
    meshes: string[];
    flexion?: number;
  }): Promise<{ key: string; parent: string | null; position: number[]; tail: number[] | null }[]>;
  skeletonChecks(character: string): { code: string; ids: string[]; message: string }[] | null;
  templateJoints(preset: string, height: number): { key: string; parent: string | null; position: number[] }[];
}

export function skeletonKernelTestApi(ctx: M6bTestApiContext): SkeletonKernelTestApi {
  /** World-space triangles of the meshes in one BVH (the editor-core Quick Rig geometry, rebuilt here). */
  const geometry = async (ids: readonly string[]) => {
    ctx.sync();
    const kernel = await loadMeshKernel();
    const app = ctx.shell.app;
    const runtimes = kernelMeshes(app);
    const positions: number[] = [];
    const tris: number[] = [];
    for (const id of ids) {
      const record = app.store.get('meshes', id as MeshId);
      const runtime = runtimes?.get(id as MeshId);
      const data = runtime?.data() ?? null;
      if (record === undefined || runtime === undefined || data === null) throw new Error(`mesh ${id} is not ready`);
      const m = mat4Compose(worldPlacement(app.store, record));
      const base = positions.length / 3;
      for (let i = 0; i < data.counts.points; i++) {
        const [x, y, z] = [
          data.position[3 * i] as number,
          data.position[3 * i + 1] as number,
          data.position[3 * i + 2] as number,
        ];
        for (let k = 0; k < 3; k++) {
          positions.push(
            (m[k] as number) * x + (m[4 + k] as number) * y + (m[8 + k] as number) * z + (m[12 + k] as number),
          );
        }
      }
      const corners = runtime.triangulation().tris;
      for (let i = 0; i < corners.length; i++) tris.push(base + (data.cornerVert[corners[i] as number] as number));
    }
    const bvh = new kernel.TriangleBvh(Float64Array.from(positions), Uint32Array.from(tris));
    return { bvh, bounds: bvh.bounds() };
  };
  const plain = (v: readonly number[] | null) => (v === null ? null : [...v]);
  return {
    async quickRigGuess(meshes) {
      const { bvh, bounds } = await geometry(meshes);
      const checks = quickRigStartChecks(bounds, bvh);
      const guess = guessMarkers(bvh, bounds);
      return {
        checks: { ...checks },
        markers:
          guess === null ? null : Object.fromEntries(Object.entries(guess.markers).map(([name, p]) => [name, [...p]])),
        armAngle: guess?.armAngle ?? null,
        aPose: guess?.aPose ?? null,
      };
    },
    async quickRigFit(args) {
      const { bvh, bounds } = await geometry(args.meshes);
      const preset: SkeletonPreset = isSkeletonPreset(args.preset) ? args.preset : 'standard33';
      const joints = fitQuickRig(preset, args.markers, bvh, {
        ground: bounds[0][1],
        flexion: args.flexion ?? DEFAULT_FLEXION,
      });
      return joints.map((j) => ({ key: j.key, parent: j.parent, position: [...j.position], tail: plain(j.tail) }));
    },
    skeletonChecks(character) {
      ctx.sync();
      const app = ctx.shell.app;
      const skeleton = app.store.query.skeletonOfCharacter(character as CharacterId);
      if (skeleton === undefined) return null;
      const joints = app.store.query.jointsOfSkeleton(skeleton.id);
      const runtimes = kernelMeshes(app);
      const meshes = app.store
        .list('meshes')
        .filter((m) => 'character' in m.owner && m.owner.character === character)
        .flatMap((record) => {
          const data = runtimes?.get(record.id)?.data() ?? null;
          if (data === null) return [];
          const placement = mat4Compose(worldPlacement(app.store, record));
          return [{ id: record.id, data, skin: record.skin === null ? null : ({} as never), placement }];
        });
      return checkSkeleton({ skeleton, joints, meshes }).map((p) => ({
        code: p.code,
        ids: [...p.ids],
        message: p.message,
      }));
    },
    templateJoints(preset, height) {
      const p: SkeletonPreset = isSkeletonPreset(preset) ? preset : 'standard33';
      return skeletonTemplate(p, { height, proportions: 'standard', flexion: DEFAULT_FLEXION }).map((j) => ({
        key: j.key,
        parent: j.parent,
        position: [...j.position],
      }));
    },
  };
}
