// A model-sourced character as records only (no meshes; M6B-SPEC §5.1 shapes): the character, its Standard 33
// template skeleton (§5.2 identities) and an empty rig record — the setup of the C2 rows of the P-C6 keys-hash table.
import { xfIdentity } from '@ekza-studio/anim-core';
import type { CharacterId, JointId, RigId, SkeletonId } from '@ekza-studio/doc';
import { makeTestRig } from '@ekza-studio/doc/testing';
import { DEFAULT_FLEXION, skeletonTemplate, templateJointRecords } from '@ekza-studio/rig';
import type { EditorApp } from '../../../src';

export const C2_CHARACTER = 'chr_c2kernel000000' as CharacterId;
export const C2_SKELETON = 'skl_c2kernel000000' as SkeletonId;
const RIG = 'rig_c2kernel000000' as RigId;

/** Writes the character (outside history) and returns the joint id of a template bone. */
export function modelCharacter(app: EditorApp): (bone: string) => JointId {
  app.store.transact({ label: 'setup' }, (tx) => {
    tx.put('characters', {
      id: C2_CHARACTER,
      name: 'C2',
      asset: null,
      source: { kind: 'model', skeleton: C2_SKELETON },
      format: 'vrm1',
      rig: RIG,
      placement: xfIdentity(),
      order: 'a0',
      deleted: null,
      vrm: null,
    });
    tx.put('skeletons', {
      id: C2_SKELETON,
      character: C2_CHARACTER,
      template: 'vrm-humanoid',
      templateVersion: '1.0.0',
      preset: 'standard33',
      symmetry: true,
      deleted: null,
    });
    tx.put('rigs', makeTestRig(RIG, C2_CHARACTER));
    const template = skeletonTemplate('standard33', { height: 1.7, proportions: 'standard', flexion: DEFAULT_FLEXION });
    for (const joint of templateJointRecords(template, C2_SKELETON)) tx.put('joints', joint);
  });
  const rig = app.session.getState().rig;
  app.session.setState({ rig: { ...rig, character: C2_CHARACTER } });
  return (bone) => `${C2_SKELETON}:${bone}` as JointId;
}
