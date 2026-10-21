// Skeleton display (DisplayFlags.skeleton): a line from every joint to its nearest joint ancestor, drawn from the
// evaluated bone worlds, plus the joint positions used by joint picking. Bones are hidden by default (FR-RIG-05).
import type { Mat4 } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { Color, Group } from 'three';
import { multiplyAt } from '../controls/ControlLayer';
import { LAYER } from '../layers';
import type { JointSet } from '../picking/picker';
import { VIEWPORT_THEME } from '../theme';
import { LineBatch, lineMaterial } from './lineBatch';

interface CharacterSkeleton {
  readonly batch: LineBatch;
  /** Pairs (child, ancestor) of node indices drawn as segments. */
  readonly links: Int32Array;
  readonly isJoint: Uint8Array;
  readonly positions: Float32Array;
  readonly segments: Float32Array;
}

export class SkeletonLayer {
  readonly root = new Group();
  private readonly characters = new Map<CharacterId, CharacterSkeleton>();
  private readonly material = lineMaterial({ width: 1.5, vertexColors: true, depthTest: false });
  private readonly rgb = new Color(VIEWPORT_THEME.joint);
  private readonly matrix = new Float64Array(16);

  constructor() {
    this.root.name = 'ekza.skeleton';
    this.root.matrixAutoUpdate = false;
  }

  get lineMaterial(): typeof this.material {
    return this.material;
  }

  setCharacter(character: CharacterId, skeleton: SkeletonDesc): void {
    this.removeCharacter(character);
    const nodes = skeleton.nodes;
    const isJoint = new Uint8Array(nodes.length);
    const anyJoint = nodes.some((node) => node.isJoint);
    for (const node of nodes) isJoint[node.index] = anyJoint ? (node.isJoint ? 1 : 0) : 1;
    const links: number[] = [];
    for (const node of nodes) {
      if (isJoint[node.index] !== 1) continue;
      let parent = node.parent;
      while (parent !== -1 && isJoint[parent] !== 1) parent = nodes[parent]?.parent ?? -1;
      if (parent !== -1) links.push(node.index, parent);
    }
    const batch = new LineBatch([{ material: this.material, layer: LAYER.skeleton }], `ekza.skeleton.${character}`);
    batch.addTo(this.root);
    this.characters.set(character, {
      batch,
      links: new Int32Array(links),
      isJoint,
      positions: new Float32Array(nodes.length * 3).fill(Number.NaN),
      segments: new Float32Array((links.length / 2) * 6),
    });
  }

  removeCharacter(character: CharacterId): void {
    const existing = this.characters.get(character);
    if (existing === undefined) return;
    existing.batch.dispose();
    this.characters.delete(character);
  }

  /** Bone origins (scene space) from `PoseBuffers.boneWorld`; non-joint nodes stay NaN (not pickable). */
  updatePose(character: CharacterId, placement: Mat4, boneWorld: Float64Array): void {
    const set = this.characters.get(character);
    if (set === undefined) return;
    const m = this.matrix;
    const count = set.isJoint.length;
    for (let node = 0; node < count; node++) {
      if (set.isJoint[node] !== 1 || node * 16 + 16 > boneWorld.length) continue;
      multiplyAt(placement, boneWorld, node * 16, m);
      set.positions[node * 3] = m[12] as number;
      set.positions[node * 3 + 1] = m[13] as number;
      set.positions[node * 3 + 2] = m[14] as number;
    }
    const links = set.links;
    for (let i = 0; i < links.length; i += 2) {
      const a = (links[i] as number) * 3;
      const b = (links[i + 1] as number) * 3;
      const o = (i / 2) * 6;
      set.segments[o] = set.positions[a] as number;
      set.segments[o + 1] = set.positions[a + 1] as number;
      set.segments[o + 2] = set.positions[a + 2] as number;
      set.segments[o + 3] = set.positions[b] as number;
      set.segments[o + 4] = set.positions[b + 1] as number;
      set.segments[o + 5] = set.positions[b + 2] as number;
    }
    const n = links.length / 2;
    set.batch.begin(n);
    set.batch.push(set.segments, 0, n, this.rgb.r, this.rgb.g, this.rgb.b);
    set.batch.end();
  }

  *jointSets(): IterableIterator<JointSet> {
    for (const [character, set] of this.characters) yield { character, positions: set.positions };
  }

  dispose(): void {
    for (const character of this.characters.keys()) this.removeCharacter(character);
    this.material.dispose();
  }
}
