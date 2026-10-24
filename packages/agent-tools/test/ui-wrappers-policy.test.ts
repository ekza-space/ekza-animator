// STUDIO-TOUCH-SPEC §14, §20.3 item 7 (T5a): the touch shell's UI wrappers are classified and denied to agents by
// default, so the toolset and the generated reference (`reference.test.ts`, `manifest.test.ts`) stay as they are; the
// operators they wrap keep their own classification.
import { loadUiWrappers, UI_WRAPPER_IDS } from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { agentPolicyOf, buildManifest, isClassified, tablePolicyOf } from '../src';
import { type Fixture, polybotFixture } from './support';

const WRAPPED: Readonly<Record<string, string>> = {
  'pose.transfer': 'allowed',
  'pose.setAt': 'allowed',
  'pose.goals': 'allowed',
  'clip.makeLoop': 'allowed',
  'key.adjust': 'allowed',
  'key.retime': 'allowed',
  'imagePlane.import': 'denied',
  'imagePlane.delete': 'denied',
};

describe('UI wrappers in the agent policy', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await polybotFixture();
    await loadUiWrappers(fx.app);
  });

  it('denies every wrapper, registered as a trusted built-in, with a reason that names the tools to use', () => {
    for (const id of UI_WRAPPER_IDS) {
      const def = fx.app.operators.get(id);
      expect([id, def !== undefined, isClassified(id)]).toEqual([id, true, true]);
      const policy = agentPolicyOf(id, def, { trusted: true });
      expect([id, policy.policy, (policy.reason ?? '').length > 0]).toEqual([id, 'denied', true]);
    }
    expect(tablePolicyOf('pose.reach')?.reason).toMatch(/pose_ik_target/);
  });

  it('leaves the wrapped operators as they were', () => {
    for (const [id, policy] of Object.entries(WRAPPED)) expect([id, tablePolicyOf(id)?.policy]).toEqual([id, policy]);
  });

  it('keeps every registered operator classified with the wrappers loaded', () => {
    const unclassified = fx.app.operators
      .list()
      .map((def) => def.id)
      .filter((id) => !isClassified(id) && fx.app.operators.get(id)?.agent === undefined);
    expect(unclassified).toEqual([]);
  });

  it('adds nothing to the tool manifest', () => {
    const manifest = JSON.stringify(buildManifest());
    for (const id of UI_WRAPPER_IDS)
      expect([id, manifest.includes(`'${id}'`) || manifest.includes(`"${id}"`)]).toEqual([id, false]);
  });
});
