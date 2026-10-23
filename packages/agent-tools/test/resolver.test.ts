// MCP-SPEC §5.1 (D0): name resolution — characters, clips (and the user-session rule), controls by template key,
// display name, VRM humanoid bone, id and opaque `sec.#…` key, bones; misses and ambiguities answer with candidates.
import type { ControlId } from '@ekza-studio/doc';
import { beforeAll, describe, expect, it } from 'vitest';
import { AgentToolFailure, controlKeyOf, createResolver, opaqueControlKey } from '../src';
import { type Fixture, polybotFixture } from './support';

function failure(fn: () => unknown): AgentToolFailure {
  try {
    fn();
  } catch (error) {
    if (error instanceof AgentToolFailure) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

describe('resolver (MCP-SPEC §5.1)', () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await polybotFixture(41);
  });

  it('resolves characters by name (case-insensitive) and id, the only one by default', () => {
    const r = createResolver(fx.app, { forEdit: false, userSession: false });
    const name = fx.app.store.get('characters', fx.character)?.name ?? '';
    expect(r.character().id).toBe(fx.character);
    expect(r.character(name.toUpperCase()).id).toBe(fx.character);
    expect(r.character(fx.character).name).toBe(name);
    const miss = failure(() => r.character('Nobody'));
    expect(miss.code).toBe('not_found');
    expect(miss.candidates).toEqual([name]);
  });

  it('resolves clips by name and id; edits on a host with a user session must name the clip', () => {
    const read = createResolver(fx.app, { forEdit: false, userSession: true });
    expect(read.clip(fx.character).id).toBe(fx.userClip);
    expect(read.clip(fx.character, 'agent').id).toBe(fx.agentClip);
    expect(read.clip(fx.character, fx.agentClip).name).toBe('agent');
    const edit = createResolver(fx.app, { forEdit: true, userSession: true });
    const missing = failure(() => edit.clip(fx.character));
    expect(missing.code).toBe('invalid_args');
    expect(missing.candidates?.[0]).toBe('user');
    expect(missing.hint).toContain('"user"');
    const headless = createResolver(fx.app, { forEdit: true, userSession: false });
    expect(headless.clip(fx.character).id).toBe(fx.userClip);
    expect(failure(() => read.clip(fx.character, 'wlak')).candidates).toContain('agent');
  });

  it('resolves controls by template key, display name, humanoid bone, id and want ik', () => {
    const r = createResolver(fx.app, { forEdit: false, userSession: false });
    const byKey = r.control(fx.character, 'fk.upperArm.L');
    expect(byKey.key).toBe('fk.upperArm.L');
    expect(r.control(fx.character, byKey.name.toLowerCase()).id).toBe(byKey.id);
    expect(r.control(fx.character, 'leftUpperArm').id).toBe(byKey.id);
    expect(r.control(fx.character, byKey.id).key).toBe('fk.upperArm.L');
    const ik = r.control(fx.character, 'leftFoot', 'ik');
    expect(ik.key).toBe('ik.leg.L');
    const miss = failure(() => r.control(fx.character, 'fk.uperArm.L'));
    expect(miss.code).toBe('not_found');
    expect(miss.candidates?.[0]).toMatch(/^fk\.upperArm\.L \(/);
  });

  it('resolves bones by humanoid name and node name', () => {
    const r = createResolver(fx.app, { forEdit: false, userSession: false });
    const hand = r.bone(fx.character, 'leftHand');
    expect(hand.humanoid).toBe('leftHand');
    expect(r.bone(fx.character, hand.name).humanoid).toBe('leftHand');
    expect(failure(() => r.bone(fx.character, 'leftHnad')).candidates).toContain('leftHand');
  });

  it('never resolves an inherited object member as a bone or a control', () => {
    const r = createResolver(fx.app, { forEdit: false, userSession: false });
    for (const ref of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect([ref, failure(() => r.bone(fx.character, ref)).code]).toEqual([ref, 'not_found']);
      expect([ref, failure(() => r.control(fx.character, ref, 'ik')).code]).toEqual([ref, 'not_found']);
    }
  });

  it('lists body-part controls of a humanoid rig', () => {
    const r = createResolver(fx.app, { forEdit: false, userSession: false });
    const arm = r.bodyPartControls(fx.character, ['arm.L']);
    const keys = arm.map((id) => fx.app.store.get('controls', id)?.key);
    expect(keys).toContain('fk.upperArm.L');
    expect(keys.every((key) => key?.endsWith('.L'))).toBe(true);
    expect(r.bodyPartControls(fx.character, ['all']).length).toBeGreaterThan(arm.length);
  });

  it('gives unsafe secondary keys a stable opaque key and never truncates identifiers', () => {
    const long = { id: 'rig_X:sec.hair' as ControlId, key: `sec.${'h'.repeat(60)}` };
    const odd = { id: 'rig_X:sec.odd' as ControlId, key: 'sec.hair strand #2' };
    expect(controlKeyOf({ id: 'rig_X:sec.hat' as ControlId, key: 'sec.hat' })).toBe('sec.hat');
    expect(controlKeyOf(long)).toBe(opaqueControlKey(long.id));
    expect(controlKeyOf(odd)).toMatch(/^sec\.#[0-9A-Za-z]{8}$/);
    expect(opaqueControlKey(long.id)).toBe(opaqueControlKey(long.id));
    expect(opaqueControlKey(long.id)).not.toBe(opaqueControlKey(odd.id));
  });
});
