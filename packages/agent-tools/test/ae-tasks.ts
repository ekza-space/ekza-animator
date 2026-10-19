// Setups of P2's copies of the evaluation tasks (MCP-SPEC §9.3.3): documents the simulated user made before the agent
// starts — clips and keys written as user edits (no actor), with explicit tangents where a task needs them.
import type { TangentType } from '@ekza-animator/anim-core';
import type { CharacterId, ClipId } from '@ekza-animator/doc';
import { type EditorApp, ensureCurve, writeKeyAt } from '@ekza-animator/editor-core';
import { controlOf } from './support';

export interface UserKey {
  readonly control: string;
  readonly channel: string;
  readonly frame: number;
  /** Stored units (radians, metres). */
  readonly value: number;
  readonly tangent?: TangentType;
}

/** A new clip made by the user (`clip.new`, a user run), not activated by anything else. */
export async function userClip(
  app: EditorApp,
  character: CharacterId,
  name: string,
  range: { readonly start: number; readonly end: number },
): Promise<ClipId> {
  const active = app.session.getState().activeClip[character];
  const result = await app.runUntyped('clip.new', { character, name, range });
  if (result.status !== 'finished') throw new Error(`clip.new: ${JSON.stringify(result)}`);
  const clip = (result.value as { clip: ClipId }).clip;
  // the user goes back to the clip they were on (the agent addresses clips by name)
  if (active !== undefined) {
    app.session.setState({ activeClip: { ...app.session.getState().activeClip, [character]: active } });
  }
  return clip;
}

/** Keys written by the user in one edit (a store transaction without an actor). */
export function userKeys(app: EditorApp, character: CharacterId, clip: ClipId, keys: readonly UserKey[]): void {
  const defaults = app.prefs.getState().defaultTangents;
  app.store.transact({ label: 'Setup' }, (tx) => {
    for (const key of keys) {
      const curve = ensureCurve(app, tx, clip, controlOf(app, character, key.control), key.channel as never);
      const tangents =
        key.tangent === undefined ? { in: defaults.in, out: defaults.out } : { in: key.tangent, out: key.tangent };
      writeKeyAt(app, tx, curve, key.frame, key.value, tangents, { existing: 'set' });
    }
  });
}

/** A deterministic noise in [−1, 1] (xorshift), for the dense-mocap setups. */
export function noise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}
