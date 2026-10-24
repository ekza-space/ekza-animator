// Parameter surfaces (STUDIO-TOUCH-SPEC §5.6, §6.3, §20.5 test 9; T6b): how Ekza Studio shows an operator's
// parameters. `tooling/param-lint.mjs` reads `PARAM_SURFACES` and checks it against the registry (T5a's surface checks):
// - `chips`: after-run Echo chips through `edit.adjustLast` — adjustable operators only;
// - `form`: a pre-run form with ✓ — a Halo-only `FormDef` (`@ekza-studio/editor-core/forms`) or the operator's own
//   ParamDefs when it is not adjustable;
// - `options`: ⚙ Options on the More row and the petal's long-press (rendered from the ParamDefs through the
//   `./toolkit` subpath; *Make default* is the only write to the option defaults) — every operator with a Studio Pro
//   option box.
// Plain data, loaded by param-lint in Node: it imports nothing.

export type ParamSurfaceKind = 'chips' | 'form' | 'options';
export interface ParamSurface {
  readonly op: string;
  readonly surface: ParamSurfaceKind;
}

/** Adjustable operators: their parameters float as chips beside the result after a run (§5.6). */
export const CHIP_OPERATORS: readonly string[] = [
  'mesh.averageVertices',
  'mesh.bevel',
  'mesh.bridge',
  'mesh.combine',
  'mesh.connect',
  'mesh.create.cone',
  'mesh.create.cube',
  'mesh.create.cylinder',
  'mesh.create.plane',
  'mesh.create.sphere',
  'mesh.create.template',
  'mesh.create.torus',
  'mesh.duplicateFaces',
  'mesh.extract',
  'mesh.extrude',
  'mesh.freezeTransforms',
  'mesh.insertLoop',
  'mesh.inset',
  'mesh.merge',
  'mesh.mergeByDistance',
  'mesh.mirror',
  'mesh.offsetLoop',
  'mesh.primitive.set',
  'mesh.quadrangulate',
  'mesh.setNormalAngle',
  'mesh.slide',
  'mesh.symmetrize',
  'mesh.targetWeld',
  'mesh.transformComponents',
  'mesh.uv.box',
  'mesh.uv.cylindrical',
  'mesh.uv.planar',
  'skel.joint.flex',
  'skel.joint.mirror',
  'skel.joint.move',
  'skel.joint.orient',
  'skel.joint.rotateRest',
  'skel.quickRig.commit',
  'skel.template.create',
  'skin.bind',
  'skin.weights.mirror',
  'skin.weights.normalize',
  'skin.weights.prune',
  'skin.weights.set',
  'skin.weights.smooth',
];

/** Pre-run forms: the Halo-only FormDefs (T5a) and the non-adjustable operators with ParamDefs (§5.6). */
export const FORM_OPERATORS: readonly string[] = [
  // FormDefs (editor-core/forms)
  'graph.curves.simplify',
  'graph.infinity.set',
  'key.tween',
  'time.insertTime',
  'time.deleteTime',
  'pose.mirrorAnimation',
  'clip.new',
  'rig.ikFk.switch',
  'rig.ikFk.matchRange',
  'library.useClip',
  'pose.hold',
  'pose.pasteAt',
  'pose.placeGoal',
  'pose.lookAt',
  'pose.reach',
  'clip.loop',
  'key.scaleValues',
  'key.offsetValues',
  'key.offsetInLoop',
  'imagePlane.replace',
  // ParamDefs of non-adjustable operators
  'mesh.cleanup',
  'mesh.paint',
  'mesh.paint.fillShell',
  'mesh.spinEdge',
  'rig.autoRig.update',
  'skin.weights.flood',
];

/** Operators with a Studio Pro option box: ⚙ Options in More and on the petal's long-press (§6.3 lint). */
export const OPTIONS_OPERATORS: readonly string[] = [
  'mesh.averageVertices',
  'mesh.bevel',
  'mesh.bridge',
  'mesh.cleanup',
  'mesh.combine',
  'mesh.connect',
  'mesh.create.cone',
  'mesh.create.cube',
  'mesh.create.cylinder',
  'mesh.create.plane',
  'mesh.create.sphere',
  'mesh.create.template',
  'mesh.create.torus',
  'mesh.duplicateFaces',
  'mesh.extract',
  'mesh.extrude',
  'mesh.freezeTransforms',
  'mesh.insertLoop',
  'mesh.inset',
  'mesh.merge',
  'mesh.mergeByDistance',
  'mesh.mirror',
  'mesh.offsetLoop',
  'mesh.paint',
  'mesh.paint.fillShell',
  'mesh.quadrangulate',
  'mesh.setNormalAngle',
  'mesh.slide',
  'mesh.spinEdge',
  'mesh.symmetrize',
  'mesh.targetWeld',
  'mesh.transformComponents',
  'mesh.uv.box',
  'mesh.uv.cylindrical',
  'mesh.uv.planar',
  'rig.autoRig.update',
  'skel.joint.flex',
  'skel.joint.mirror',
  'skel.joint.orient',
  'skel.quickRig.commit',
  'skel.template.create',
  'skin.bind',
  'skin.weights.flood',
  'skin.weights.mirror',
  'skin.weights.normalize',
  'skin.weights.prune',
  'skin.weights.set',
  'skin.weights.smooth',
];

export const PARAM_SURFACES: readonly ParamSurface[] = [
  ...CHIP_OPERATORS.map((op): ParamSurface => ({ op, surface: 'chips' })),
  ...FORM_OPERATORS.map((op): ParamSurface => ({ op, surface: 'form' })),
  ...OPTIONS_OPERATORS.map((op): ParamSurface => ({ op, surface: 'options' })),
];

/** The parameter surfaces of one operator (More's ⚙, the petal's long-press, the Echo chips). */
export function paramSurfacesOf(op: string): readonly ParamSurfaceKind[] {
  return PARAM_SURFACES.filter((s) => s.op === op).map((s) => s.surface);
}
