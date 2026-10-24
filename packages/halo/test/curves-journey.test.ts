// AS-ST-5 for Curves (STUDIO-TOUCH-SPEC §20.7 headless integration, §22; T10 exit test): the operator sequence Halo
// emits for J4 (fix foot sliding and polish a walk with curves) exports the same VRMA bytes as Studio Pro's Graph
// Editor for the same steps, on the production kernel with Seed-san and the library's Walk.
//
// Halo's side is built by Halo's own code: the channel chip's selection (`channelChips` + `chipSelection`:
// `select.channels`), the docked key Halo's *Ease ▾ › Flat* and the curve Halo's *Cycle ▾ › Repeat* from the verb
// table's choices, and the ⟨Value⟩ chip's `graph.keys.setFields` (a typed number sets every selected key). Pro's side
// is what its Graph Editor sends: the toolbar's Flat tangents, the Value field's text "0" (`fieldArgs`, mixed values:
// set them all), and Pre and Post infinity as two runs. The marquee is the same controller in both shells: here both
// select the same contact keys with `select.keys`.
import { existsSync, readFileSync } from 'node:fs';
import type { CharacterId, ClipId, ControlId, KeyId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { threadContext } from '../src/thread/strip/model';
import { channelChips, chipSelection, curveRows } from '../src/thread/curves/model';
import { petalsFor } from '../src/verbs/table';
import { everyOperator, runOk } from './support';

const ROOT = new URL('../../../', import.meta.url);

function staticFetch(url: string | URL): Promise<Response> {
  const path = String(url).startsWith('/library/') ? `apps/web/public/library/${String(url).slice(9)}` : null;
  const file = path === null ? null : new URL(path, ROOT);
  if (file === null || !existsSync(file)) return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(new Uint8Array(readFileSync(file)).buffer, { status: 200 }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', staticFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Seed-san with the library's Walk (Pro's Clip Library call), active, the L foot's IK goal selected. */
async function walk(): Promise<{
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly clip: ClipId;
  readonly goal: ControlId;
}> {
  const app = await everyOperator();
  const { character } = await runOk<{ character: CharacterId }>(app, 'file.loadSample', { sample: 'seed-san' });
  for (let i = 0; i < 200 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const { clip } = await runOk<{ clip: ClipId }>(app, 'library.useClip', { character, clip: 'walk' });
  await runOk(app, 'clip.setActive', { clip });
  const goal = app.store.list('controls').find((c) => c.key === 'ik.leg.L')?.id;
  if (goal === undefined) throw new Error('no L foot goal');
  await runOk(app, 'select.controls', { ids: [goal], mode: 'replace' });
  return { app, character, clip, goal };
}

/** The contact keys of the foot's Move Y: the longest run at the curve's floor (within 12 % of its range). */
function contactKeys(app: EditorApp, clip: ClipId, goal: ControlId): readonly KeyId[] {
  const curve = app.store.query.curvesOfClip(clip).find((c) => c.control === goal && c.channel === 'ty');
  if (curve === undefined) throw new Error('no Move Y');
  const keys = app.store.query.keysOfCurve(curve.id);
  const lo = Math.min(...keys.map((k) => k.v));
  const hi = Math.max(...keys.map((k) => k.v));
  let best: KeyId[] = [];
  let run: KeyId[] = [];
  for (const key of keys) {
    if (key.v <= lo + (hi - lo) * 0.12) run.push(key.id);
    else run = [];
    if (run.length > best.length) best = [...run];
  }
  return best;
}

async function vrma(app: EditorApp, character: CharacterId, clip: ClipId): Promise<string> {
  const artifacts = await runOk<readonly { readonly bytes: Uint8Array }[]>(app, 'file.export', {
    kind: 'vrma',
    character,
    clips: [clip],
    fileNamePattern: '{character}_{clip}',
    closeLoop: false,
    includeConstantTracks: true,
    acknowledgeLicense: true,
    profile: null,
  });
  const bytes = artifacts[0]?.bytes;
  if (bytes === undefined) throw new Error('no artifact');
  return Buffer.from(bytes).toString('base64');
}

const choice = (noun: 'keyDot' | 'curve', petal: string, plain: string) => {
  const found = petalsFor(noun, 'animate')
    .find((p) => p.id === petal)
    ?.menu?.find((c) => c.plain === plain);
  if (found === undefined) throw new Error(`no ${noun} ${petal} › ${plain}`);
  return found;
};

describe('AS-ST-5: Curves export what Studio Pro’s Graph Editor does', () => {
  it('J4: Move Y alone, the contact keys Flat, their value 0, Cycle › Repeat — the same VRMA as Pro', async () => {
    // Halo
    const halo = await walk();
    const thread = threadContext(halo.app);
    if (thread === null) throw new Error('no thread');
    const rows = curveRows(halo.app, thread, [halo.goal]);
    const chips = channelChips(halo.app, rows, []);
    const moveY = chips.find((c) => c.channel === 'ty');
    if (moveY === undefined) throw new Error('no Move Y chip');
    const pick = chipSelection([], moveY, chips, false);
    await runOk(halo.app, 'select.channels', { refs: pick.refs, mode: pick.mode });
    const haloContact = contactKeys(halo.app, halo.clip, halo.goal);
    expect(haloContact.length).toBeGreaterThanOrEqual(3);
    await runOk(halo.app, 'select.keys', {
      items: haloContact.map((key) => ({ key, parts: { key: true, in: false, out: false } })),
      mode: 'replace',
    });
    const flat = choice('keyDot', 'ease', 'Flat');
    await runOk(halo.app, flat.op, flat.args);
    await runOk(halo.app, 'graph.keys.setFields', { value: 0 });
    const repeat = choice('curve', 'cycle', 'Repeat');
    await runOk(halo.app, repeat.op, repeat.args);
    const haloBytes = await vrma(halo.app, halo.character, halo.clip);

    // Studio Pro's Graph Editor
    const pro = await walk();
    const proContact = contactKeys(pro.app, pro.clip, pro.goal);
    await runOk(pro.app, 'select.keys', {
      items: proContact.map((key) => ({ key, parts: { key: true, in: false, out: false } })),
      mode: 'replace',
    });
    await runOk(pro.app, 'graph.tangent.set', { type: 'flat' });
    await runOk(pro.app, 'graph.keys.setFields', { value: 0 });
    await runOk(pro.app, 'graph.infinity.set', { pre: 'cycle' });
    await runOk(pro.app, 'graph.infinity.set', { post: 'cycle' });
    const proBytes = await vrma(pro.app, pro.character, pro.clip);

    expect(haloBytes).toBe(proBytes);
    // the edits happened: the contact keys sit at 0
    const keys = haloContact.map((key) => halo.app.store.get('keys', key)?.v);
    expect(keys.every((v) => v === 0)).toBe(true);
    halo.app.dispose();
    pro.app.dispose();
  }, 120_000);
});
