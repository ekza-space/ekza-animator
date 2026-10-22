// Fixtures of the A0 rig tests (AUTORIG-SPEC §10 A0): A-posed Polybot (`polybot-unskinned.glb`, CC0) with its truth
// joints for both poses (`polybot-truth.json` `poses.apose` / `poses.tpose`) and the A-pose truth markers derived with
// rig's `markersFromJoints` (no new fixture); the Cube Lad with its arms rotated down (E2E-QR-02's synthetic A-pose).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HumanBoneName, JointRecord, SkeletonId, SkeletonRecord } from '@ekza-studio/doc';
import { TriangleBvh } from '@ekza-studio/mesh-core';
import {
  DEFAULT_FLEXION,
  fitQuickRig,
  markersFromJoints,
  type QuickRigMarker,
  type QuickRigMarkers,
  type SkeletonPreset,
  templateJointRecords,
} from '../../src';
import { boundsOf, cubeLad, type Fixture, glbTriangles, type Triangles, type V3 } from '../m6b-skeleton/support';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/models/', import.meta.url));

interface PoseTruth {
  readonly height: number;
  readonly ground: number;
  readonly humanoid: Readonly<Partial<Record<HumanBoneName, V3>>>;
}

export interface APoseFixture extends Fixture {
  /** T-pose truth joints (character space) of the same model. */
  readonly tpose: Readonly<Partial<Record<HumanBoneName, V3>>>;
}

function truth(): { readonly apose: PoseTruth; readonly tpose: PoseTruth } {
  const file = JSON.parse(readFileSync(`${FIXTURES}polybot-truth.json`, 'utf8')) as {
    readonly poses: { readonly apose: PoseTruth; readonly tpose: PoseTruth };
  };
  return file.poses;
}

/** A-posed Polybot: the mesh, the A-pose truth joints, the derived A-pose truth markers and the T-pose truth joints. */
export function polybotAPose(): APoseFixture {
  const triangles = glbTriangles('polybot-unskinned.glb');
  const bounds = boundsOf(triangles);
  const poses = truth();
  const joints = poses.apose.humanoid;
  const ground = bounds[0][1];
  // The truth has no tails: the head tail is the model's top above the head (the head-top marker's meaning, §0.4.2).
  const head = joints.head as V3;
  const lookup = (bone: HumanBoneName) => {
    const position = joints[bone];
    if (position === undefined) return undefined;
    return { position, tail: bone === 'head' ? ([0, bounds[1][1], head[2]] as V3) : null };
  };
  const markers = markersFromJoints(lookup, ground) as Readonly<Record<QuickRigMarker, V3>>;
  return {
    name: 'Polybot (A-pose)',
    triangles,
    bvh: new TriangleBvh(triangles.positions, triangles.tris),
    bounds,
    height: bounds[1][1] - ground,
    ground,
    joints,
    markers,
    tpose: poses.tpose.humanoid,
  };
}

/** The Cube Lad with both arms rotated `angle` down about the shoulder blocks (E2E-QR-02's synthetic A-pose). */
export function cubeLadAPose(angle: number): Fixture {
  const lad = cubeLad();
  const positions = new Float64Array(lad.triangles.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = lad.triangles.positions[i] as number;
    const y = lad.triangles.positions[i + 1] as number;
    const z = lad.triangles.positions[i + 2] as number;
    if (Math.abs(x) <= 0.181) {
      positions.set([x, y, z], i);
      continue;
    }
    const s = Math.sign(x);
    const dx = x - s * 0.18;
    const dy = y - 1.33;
    const c = Math.cos(angle);
    const n = Math.sin(angle);
    positions.set([s * 0.18 + dx * c + s * dy * n, 1.33 - s * dx * n + dy * c, z], i);
  }
  const triangles: Triangles = { positions, tris: lad.triangles.tris };
  const bounds = boundsOf(triangles);
  return {
    ...lad,
    name: `Cube Lad (arms ${Math.round((angle * 180) / Math.PI)}° down)`,
    triangles,
    bvh: new TriangleBvh(positions, triangles.tris),
    bounds,
    height: bounds[1][1] - bounds[0][1],
    ground: bounds[0][1],
  };
}

export const SKELETON = 'skl_a0' as SkeletonId;

export function skeletonRecord(preset: SkeletonPreset = 'standard33'): SkeletonRecord {
  return {
    id: SKELETON,
    character: 'chr_a0' as never,
    template: 'vrm-humanoid',
    templateVersion: '1.0.0',
    preset,
    symmetry: true,
    deleted: null,
  };
}

/** Quick Rig's committed joints for `markers` (the preview = commit fit), as template joint records. */
export function quickRigJoints(
  f: Fixture,
  markers: QuickRigMarkers,
  preset: SkeletonPreset = 'standard33',
): JointRecord[] {
  return templateJointRecords(
    fitQuickRig(preset, markers, f.bvh, { ground: f.ground, flexion: DEFAULT_FLEXION }),
    SKELETON,
  );
}
