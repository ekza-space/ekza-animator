// VRMA 1.0 of a normalized humanoid clip (M6B-SPEC §0.4.7, §0.5; C12): the shipped VRMA writer's layout (`writeVrma`,
// MVP-SPEC §4.11.12) — an identity `root`, one node per present humanoid bone (never eyes) parented along the humanoid
// parent map over present bones, translations from rest world positions and no rest rotation or scale — with the
// clip's normalized local rotations n_b and the absolute hips position as tracks, one animation named after the clip
// (the UAL source name, so `/loop/i` gives a plain `file.importAnimation` the right loop flag) and the clip's
// provenance in `asset.extras.ekza_animation_v1`. Deterministic: the same input gives the same bytes.
import { EkzaError } from '@ekza-studio/anim-core';
import type { DerivedFrom, HumanBoneName } from '@ekza-studio/doc';
import { HUMAN_BONE_NAMES, HUMAN_BONE_PARENT, type HumanoidClipData } from '@ekza-studio/rig';
import type { Node } from '@gltf-transform/core';
import { normalizeClipMeta } from '../bake/meta';
import type { EkzaAnimationV1 } from '../types';
import { VRMC_VRM_ANIMATION, VRMCVrmAnimation } from '../vrma/extension';
import { InputAccessors, newDocument, writeDocument } from '../writers/document';

type Vec3 = readonly [number, number, number];

/** Provenance and file metadata of a written clip. `sourceSha256` (optional) names the source file's hash. */
export interface HumanoidVrmaMeta {
  readonly generator: string;
  readonly license: string;
  readonly credit: string;
  readonly source: string;
  readonly sourceSha256?: string | null;
}

/**
 * Deterministic VRMA 1.0 bytes of a normalized humanoid clip (the shipped VRMA writer's layout and provenance).
 * `restWorld` places the bone nodes (the clip's own rest, e.g. the retarget's T-pose); a bone it lacks sits 5 cm above
 * its parent (players read only rotations and the hips, §4.11.7). Throws EkzaError('unsupported') without hips.
 */
export async function writeHumanoidVrma(
  data: HumanoidClipData,
  meta: HumanoidVrmaMeta,
  restWorld: Readonly<Partial<Record<HumanBoneName, Vec3>>> = {},
): Promise<Uint8Array> {
  return writeDocument(buildDocument(data, meta, restWorld));
}

function buildDocument(
  data: HumanoidClipData,
  meta: HumanoidVrmaMeta,
  restWorld: Readonly<Partial<Record<HumanBoneName, Vec3>>>,
): ReturnType<typeof newDocument> {
  const listed = new Set(data.presentBones);
  const present = HUMAN_BONE_NAMES.filter((bone) => listed.has(bone) && bone !== 'leftEye' && bone !== 'rightEye');
  if (!present.includes('hips')) throw new EkzaError('unsupported', 'A VRMA needs the hips bone');
  const presentSet = new Set<HumanBoneName>(present);
  const parentOf = (bone: HumanBoneName): HumanBoneName | null => {
    let parent = HUMAN_BONE_PARENT[bone];
    while (parent !== null && !presentSet.has(parent)) parent = HUMAN_BONE_PARENT[parent];
    return parent;
  };

  const doc = newDocument(meta.generator, { ekza_animation_v1: animationMeta(data, meta) });
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  doc.getRoot().setDefaultScene(scene);
  const root = doc.createNode('root');
  scene.addChild(root);
  const world = new Map<HumanBoneName, Vec3>();
  const nodes = new Map<HumanBoneName, Node>();
  for (const bone of present) {
    const parent = parentOf(bone);
    const base: Vec3 = parent === null ? [0, 0, 0] : (world.get(parent) as Vec3);
    const p: Vec3 =
      bone === 'hips'
        ? [data.restHipsPosition[0], data.restHipsPosition[1], data.restHipsPosition[2]]
        : (restWorld[bone] ?? [base[0], base[1] + 0.05, base[2]]);
    world.set(bone, p);
    const node = doc.createNode(bone).setTranslation([p[0] - base[0], p[1] - base[1], p[2] - base[2]]);
    (parent === null ? root : (nodes.get(parent) as Node)).addChild(node);
    nodes.set(bone, node);
  }
  const extension = doc.createExtension(VRMCVrmAnimation);
  const humanoid = extension.createHumanoid().setSpecVersion('1.0');
  for (const [bone, node] of nodes) humanoid.setBone(bone, node);
  doc.getRoot().setExtension(VRMC_VRM_ANIMATION, humanoid);

  const animation = doc.createAnimation(data.name);
  const inputs = new InputAccessors(doc, buffer);
  const add = (
    node: Node,
    path: 'rotation' | 'translation',
    track: { readonly times: Float32Array; readonly values: Float32Array },
    interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE',
  ): void => {
    const output = doc
      .createAccessor()
      .setType(path === 'rotation' ? 'VEC4' : 'VEC3')
      .setArray(track.values.slice())
      .setBuffer(buffer);
    const sampler = doc
      .createAnimationSampler()
      .setInput(inputs.get(track.times))
      .setOutput(output)
      .setInterpolation(interpolation);
    animation.addSampler(sampler);
    animation.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  };
  for (const bone of present) {
    const track = data.rotations[bone];
    if (track === undefined || track.times.length === 0) continue;
    add(nodes.get(bone) as Node, 'rotation', track, data.interpolation[bone] ?? 'LINEAR');
  }
  if (data.hips !== null && data.hips.times.length > 0) {
    add(nodes.get('hips') as Node, 'translation', data.hips, data.interpolation.hipsPosition ?? 'LINEAR');
  }
  return doc;
}

/** `ekza_animation_v1` of one clip: its name, loop by `/loop/i`, timing and the given provenance. */
function animationMeta(data: HumanoidClipData, meta: HumanoidVrmaMeta): EkzaAnimationV1 {
  const derivedFrom: DerivedFrom[] = [
    { title: meta.source, author: meta.credit, license: meta.license, sourceSha256: meta.sourceSha256 ?? null },
  ];
  return {
    schema: 1,
    rig: 'vrm-humanoid',
    clips: [
      normalizeClipMeta({
        index: 0,
        name: data.name,
        slot: null,
        loop: /loop/i.test(data.name),
        fps: frameRateOf(data),
        durationSeconds: data.duration,
        rootMotion: 'hips',
        contactSeconds: null,
        tags: [],
        derivedFrom,
        redistributable: meta.license === 'CC0-1.0' ? 'yes' : 'unknown',
      }),
    ],
    provenance: {
      tool: 'ekza-animator',
      toolVersion: meta.generator,
      projectSha256: null,
      baseSha256: null,
      derivedFrom,
    },
  };
}

/** Keys per second of the densest track (the source's 30 fps for UAL clips), rounded to an integer when close. */
function frameRateOf(data: HumanoidClipData): number {
  let keys = data.hips?.times.length ?? 0;
  for (const track of Object.values(data.rotations)) if (track !== undefined) keys = Math.max(keys, track.times.length);
  if (keys < 2 || data.duration <= 0) return 30;
  const fps = (keys - 1) / data.duration;
  return Math.abs(fps - Math.round(fps)) < 1e-3 ? Math.round(fps) : fps;
}
