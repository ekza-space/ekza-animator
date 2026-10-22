// Templates (M6A-SPEC §5.16; B13): the humanoid body generator behind `mesh.create.template {template:
// 'humanoidBody'}` and `primitive('humanoidBody', …)`.
export { humanoidBody } from './humanoidBody';
// CR-2 (M6B-SPEC §2.4; C2): the joint positions the generator was built around.
export { type HumanoidBodyRigBone, humanoidBodyRig } from './humanoidBodyRig';
