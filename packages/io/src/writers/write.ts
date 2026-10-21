// Fresh-document writers (ADR 0005 §7–8, MVP-SPEC §4.11.12): animation-only GLB and VRMA, both through glTF
// Transform (never three's GLTFExporter).
import { EkzaError } from '@ekza-studio/anim-core';
import type { HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, type SkeletonDesc } from '@ekza-studio/rig';
import type { Node } from '@gltf-transform/core';
import type { BakedClip, BakedTrack, EkzaAnimationV1, ExportArtifact, ExportProfileDef, LintIssue } from '../types';
import { VRMC_VRM_ANIMATION, VRMCVrmAnimation } from '../vrma/extension';
import { finalizeArtifact } from './artifact';
import { addAnimation, InputAccessors, newDocument, writeDocument } from './document';
import { clipNameKey, outputMeta } from './names';

export { clipExportName, exportFileName } from './names';

type WriterOptions = {
  readonly meta: EkzaAnimationV1;
  readonly fileName: string;
  readonly profile: ExportProfileDef | null;
};

export function generatorName(meta: EkzaAnimationV1): string {
  return `Ekza Animator ${meta.provenance.toolVersion}`;
}

/**
 * Animation-only GLB: one node per skeleton node that is animated or an ancestor of an animated node (same names,
 * rest TRS and hierarchy), no meshes or skins, raw channels, one animation per clip.
 */
export async function writeAnimationGlb(
  skeleton: SkeletonDesc,
  clips: readonly BakedClip[],
  opts: WriterOptions,
): Promise<ExportArtifact> {
  if (clips.some((clip) => clip.target !== 'raw')) {
    throw new EkzaError('unsupported', 'The animation-only GLB writer needs raw-target clips');
  }
  assertUniqueNames(clips);
  const keep = new Set<number>();
  for (const clip of clips) {
    for (const track of clip.tracks) {
      for (let n = track.node; n !== -1 && !keep.has(n); n = skeleton.nodes[n]?.parent ?? -1) {
        if (skeleton.nodes[n] === undefined) break;
        keep.add(n);
      }
    }
  }
  const meta = outputMeta(
    opts.meta,
    clips.map((clip, index) => ({ clip, index })),
  );
  const doc = newDocument(generatorName(opts.meta), { ekza_animation_v1: meta });
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const nodes = new Map<number, Node>();
  for (const sk of skeleton.nodes) {
    if (!keep.has(sk.index)) continue;
    const { t, q, s } = sk.restLocal;
    const node = doc
      .createNode(sk.name)
      .setTranslation([t[0], t[1], t[2]])
      .setRotation([q[0], q[1], q[2], q[3]])
      .setScale([s[0], s[1], s[2]]);
    nodes.set(sk.index, node);
    const parent = sk.parent === -1 ? undefined : nodes.get(sk.parent);
    if (parent === undefined) scene.addChild(node);
    else parent.addChild(node);
  }
  const inputs = new InputAccessors(doc, buffer);
  let channels = 0;
  let keys = 0;
  for (const clip of clips) {
    const added = addAnimation(doc, buffer, inputs, clip, (track) => nodes.get(track.node) ?? null);
    channels += added.channels;
    keys += added.keys;
  }
  const bytes = await writeDocument(doc);
  return finalizeArtifact({
    kind: 'animation-glb',
    fileName: opts.fileName,
    bytes,
    clips,
    skeleton,
    profile: opts.profile,
    writerLints: [],
    stats: { clips: clips.length, channels, keys },
  });
}

/**
 * VRMA (one clip): one node per humanoid bone present in the source (never eyes), parented by the humanoid parent
 * map over present bones, hips under an identity root, translations from the canonical rest world positions and no
 * rest rotation or scale; tracks are N_b rotations and the absolute hips position.
 */
export async function writeVrma(
  skeleton: SkeletonDesc,
  clip: BakedClip,
  opts: WriterOptions & {
    readonly humanoidRestWorld: Readonly<Partial<Record<HumanBoneName, readonly [number, number, number]>>>;
  },
): Promise<ExportArtifact> {
  if (clip.target !== 'humanoid') throw new EkzaError('unsupported', 'The VRMA writer needs a humanoid-target clip');
  const humanoid = skeleton.humanoid ?? {};
  const present = HUMAN_BONE_NAMES.filter(
    (bone) =>
      bone !== 'leftEye' &&
      bone !== 'rightEye' &&
      humanoid[bone] !== undefined &&
      opts.humanoidRestWorld[bone] !== undefined,
  );
  if (!present.includes('hips')) throw new EkzaError('unsupported', 'The VRMA writer needs the rest position of hips');
  const presentSet = new Set<HumanBoneName>(present);
  const meta = outputMeta(opts.meta, [{ clip, index: 0 }]);
  const doc = newDocument(generatorName(opts.meta), { ekza_animation_v1: meta });
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const root = doc.createNode('root');
  scene.addChild(root);
  const nodes = new Map<HumanBoneName, Node>();
  for (const bone of present) {
    const parent = presentParent(bone, presentSet);
    const p = opts.humanoidRestWorld[bone] as readonly [number, number, number];
    const q = parent === null ? [0, 0, 0] : (opts.humanoidRestWorld[parent] as readonly [number, number, number]);
    const node = doc.createNode(bone).setTranslation([p[0] - q[0], p[1] - q[1], p[2] - q[2]]);
    (parent === null ? root : (nodes.get(parent) as Node)).addChild(node);
    nodes.set(bone, node);
  }
  const extension = doc.createExtension(VRMCVrmAnimation);
  const humanoidExt = extension.createHumanoid().setSpecVersion('1.0');
  for (const [bone, node] of nodes) humanoidExt.setBone(bone, node);
  doc.getRoot().setExtension(VRMC_VRM_ANIMATION, humanoidExt);

  const writerLints: LintIssue[] = [];
  const target = (track: BakedTrack): Node | null => {
    const bone = HUMAN_BONE_NAMES[track.node];
    if (bone === undefined || !presentSet.has(bone)) return null;
    if (track.path === 'scale' || (track.path === 'translation' && bone !== 'hips')) return null;
    return nodes.get(bone) ?? null;
  };
  const added = addAnimation(doc, buffer, new InputAccessors(doc, buffer), clip, target);
  for (const track of added.skipped) {
    writerLints.push({
      code: 'vrma.skipped-track',
      severity: 'warning',
      message: `A ${track.path} track of humanoid bone ${HUMAN_BONE_NAMES[track.node] ?? track.node} cannot be written to VRMA and was dropped`,
    });
  }
  const bytes = await writeDocument(doc);
  return finalizeArtifact({
    kind: 'vrma',
    fileName: opts.fileName,
    bytes,
    clips: [{ ...clip, tracks: clip.tracks.filter((track) => target(track) !== null) }],
    skeleton,
    profile: opts.profile,
    writerLints,
    stats: { clips: 1, channels: added.channels, keys: added.keys },
  });
}

function presentParent(bone: HumanBoneName, present: ReadonlySet<HumanBoneName>): HumanBoneName | null {
  let parent = HUMAN_BONE_PARENT[bone];
  while (parent !== null && !present.has(parent)) parent = HUMAN_BONE_PARENT[parent];
  return parent;
}

export function assertUniqueNames(clips: readonly BakedClip[]): void {
  const seen = new Set<string>();
  for (const clip of clips) {
    const key = clipNameKey(clip.name);
    if (seen.has(key)) {
      throw new EkzaError('unsupported', `Two clips export under the name '${clip.name}' (names are case-insensitive)`);
    }
    seen.add(key);
  }
}
