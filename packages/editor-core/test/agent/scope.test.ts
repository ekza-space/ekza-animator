// MCP-SPEC §4.10 (P1): the scope-ready operators give the same result with the run scope as with the equivalent user
// selection, and act on nothing without a context (never the user's selection); the actor-safe migrations
// (`graph.key.insert`, `clip.delete`, `rig.ikFk.matchRange {clip}`) and `clip.new {loop, activate}`,
// `clip.duplicate {name, activate}` keep the user's session (runner rule 6) under an agent.
import type { ClipId, CurveId, KeyId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import type { FakeEditorApp } from '../../src/testing';
import type { RunScope, Selection } from '../../src/types';
import {
  agentOk,
  agentRefusal,
  asAgent,
  changedFields,
  DEG,
  docJson,
  opsApp,
  runAgent,
  runOk,
  seedUser,
  sessionRecord,
  WAVE,
  waveCurve,
} from './support';

const ARM = WAVE.lowerArmL;
const KEYS = (ids: readonly KeyId[]) => new Map(ids.map((id) => [id, { key: true, in: true, out: true }]));
const EMPTY: Selection = { controls: [], keys: new Map(), channels: [] };

interface Case {
  readonly id: string;
  readonly args: unknown;
  readonly selection: Partial<Selection>;
}

const MIDDLE = [WAVE.keys[1]];
const CASES: readonly Case[] = [
  { id: 'graph.tangent.set', args: { type: 'flat' }, selection: { keys: KEYS(MIDDLE) } },
  { id: 'graph.tangent.set', args: { type: 'linear', side: 'out' }, selection: { controls: [ARM] } },
  { id: 'graph.tangent.break', args: undefined, selection: { keys: KEYS(WAVE.keys) } },
  { id: 'graph.tangent.lockWeight', args: { locked: false }, selection: { keys: KEYS(MIDDLE) } },
  {
    id: 'graph.curve.setWeighted',
    args: { weighted: true },
    selection: { channels: [{ control: ARM, channel: 'rz' }] },
  },
  { id: 'graph.infinity.set', args: { pre: 'linear', post: 'cycle' }, selection: { controls: [ARM] } },
  { id: 'graph.keys.setFields', args: { value: 12 }, selection: { keys: KEYS(MIDDLE) } },
  { id: 'graph.keys.setFields', args: { frame: 3, relative: true }, selection: { keys: KEYS(MIDDLE) } },
  { id: 'graph.curves.simplify', args: undefined, selection: { controls: [ARM] } },
  { id: 'graph.eulerFilter', args: undefined, selection: { controls: [ARM] } },
  { id: 'key.tween', args: { mode: 'tween', amount: 50, target: 'keys' }, selection: { keys: KEYS(MIDDLE) } },
  { id: 'key.tween', args: { mode: 'ease', amount: 40, frames: [5, 20] }, selection: { controls: [ARM] } },
  { id: 'key.convert', args: { to: 'breakdown' }, selection: { keys: KEYS(MIDDLE) } },
  { id: 'pose.mirrorAnimation', args: { mode: 'leftToRight' }, selection: { controls: [ARM] } },
];

/** A wave whose arm curve has a 2π flip at 15 (the Euler filter has work) and a shallow middle key (simplify). */
async function fixture(): Promise<FakeEditorApp> {
  const app = opsApp();
  const [first, middle] = app.store.query.keysOfCurve(WAVE.curve);
  if (first === undefined || middle === undefined) throw new Error('no keys');
  // Fixed ids, so two fixtures compare record for record.
  app.store.transact({ label: 'fixture' }, (tx) => {
    tx.put('keys', { ...middle, v: -30 * DEG + 2 * Math.PI });
    tx.put('keys', { ...first, id: 'k_ScopeFixture22' as KeyId, t: 22, v: 0.4 });
  });
  return app;
}

/**
 * The document with the ids of records created after `base` renamed by content (tables in reference order), so two
 * apps whose operators created the same records under random ids compare equal.
 */
function normalized(app: FakeEditorApp, base: ReadonlySet<string>): unknown {
  let text = JSON.stringify(app.store.snapshot());
  for (const table of ['clips', 'layers', 'curves', 'keys']) {
    const doc = JSON.parse(text) as { tables: Record<string, Record<string, { id: string }>> };
    const fresh = Object.values(doc.tables[table] ?? {})
      .filter((record) => !base.has(record.id))
      .map((record) => ({ id: record.id, content: JSON.stringify({ ...record, id: null }) }))
      .sort((a, b) => (a.content < b.content ? -1 : a.content > b.content ? 1 : 0));
    fresh.forEach((record, i) => {
      text = text.split(record.id).join(`${table}#${i}`);
    });
  }
  const doc = JSON.parse(text) as { tables: Record<string, Record<string, unknown>> };
  // Re-key the tables by id order, so insertion order does not matter.
  for (const [table, records] of Object.entries(doc.tables)) {
    doc.tables[table] = Object.fromEntries(Object.entries(records).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return doc;
}

function idsOf(app: FakeEditorApp): Set<string> {
  const doc = app.store.snapshot() as unknown as { tables: Record<string, Record<string, unknown>> };
  return new Set(Object.values(doc.tables).flatMap((records) => Object.keys(records)));
}

describe('scope-ready operators (MCP-SPEC §4.10)', () => {
  for (const c of CASES) {
    it(`${c.id} ${JSON.stringify(c.args ?? {})}: the scope gives the user-selection result`, async () => {
      const user = await fixture();
      const base = idsOf(user);
      const start = docJson(user);
      user.session.setState({ selection: { ...EMPTY, ...c.selection } });
      await runOk(user, c.id, c.args);
      const agent = await fixture();
      // The agent's user has another selection, a band and an override; the scope names the targets.
      seedUser(agent);
      const before = sessionRecord(agent);
      const scope: RunScope = { character: WAVE.character, clip: WAVE.clip, selection: c.selection };
      await agentOk(agent, c.id, c.args, asAgent({ runScope: scope }));
      expect(changedFields(before, sessionRecord(agent))).toEqual([]);
      expect(normalized(agent, base)).toEqual(normalized(user, base));
      // A run that changed the document made one `AI: …` step.
      const changed = JSON.stringify(docJson(agent)) !== JSON.stringify(start);
      expect(!changed || agent.history.peekUndo()?.label.startsWith('AI: ') === true).toBe(true);
    });
  }

  it('acts on nothing without a context: "No targets", never the user selection', async () => {
    for (const c of CASES) {
      const app = await fixture();
      seedUser(app);
      app.session.setState({ selection: { ...EMPTY, ...c.selection } });
      const doc = docJson(app);
      const result = await runAgent(app, c.id, c.args);
      const reason = result.status === 'cancelled' ? result.reason : `${result.status}`;
      expect([c.id, reason.startsWith('No targets')]).toEqual([c.id, true]);
      expect(docJson(app)).toEqual(doc);
    }
  });

  it('a scope of keys alone names their controls for the control-level operators', async () => {
    const user = await fixture();
    user.session.setState({ selection: { ...EMPTY, controls: [ARM] } });
    await runOk(user, 'graph.eulerFilter');
    const agent = await fixture();
    await agentOk(
      agent,
      'graph.eulerFilter',
      undefined,
      asAgent({ runScope: { clip: WAVE.clip, selection: { keys: KEYS(MIDDLE) } } }),
    );
    expect(docJson(agent)).toEqual(docJson(user));
  });

  it('an agent tween at the pose needs frames (the playhead is the user’s)', async () => {
    const app = await fixture();
    const scope: RunScope = { clip: WAVE.clip, selection: { controls: [ARM] } };
    expect(
      await agentRefusal(app, 'key.tween', { mode: 'tween', amount: 0, target: 'frame' }, asAgent({ runScope: scope })),
    ).toMatch(/needs frames/);
  });

  it('agent runs read the keyed values: a tween at the user frame ignores the override', async () => {
    const app = await fixture();
    seedUser(app);
    app.session.setState({ overrides: new Map([[ARM, { rz: 1 }]]) });
    const scope: RunScope = {
      clip: WAVE.clip,
      selection: { controls: [ARM], channels: [{ control: ARM, channel: 'rz' }] },
    };
    await agentOk(app, 'key.tween', { mode: 'pushPull', amount: 0, frames: [12] }, asAgent({ runScope: scope }));
    // pushPull at 0 keys the current value: the keyed curve value, not the override (1 rad).
    const key = app.store.query.keysOfCurve(waveCurve(app, ARM, 'rz') as CurveId).find((k) => k.t === 12);
    expect(key?.v).not.toBeCloseTo(1, 3);
    expect(app.session.getState().overrides.get(ARM)).toEqual({ rz: 1 });
  });

  it('the Simplify span limit applies to agent runs only', async () => {
    const app = opsApp();
    const arm = waveCurve(app, ARM, 'rz') as CurveId;
    const last = app.store.query.keysOfCurve(arm)[2];
    if (last === undefined) throw new Error('no key');
    app.store.transact({ label: 'far key' }, (tx) => tx.put('keys', { ...last, t: 150_000 }));
    const scope: RunScope = { clip: WAVE.clip, selection: { controls: [ARM] } };
    expect(await agentRefusal(app, 'graph.curves.simplify', undefined, asAgent({ runScope: scope }))).toMatch(
      /100000 frames/,
    );
  });
});

describe('actor-safe migrations', () => {
  it('graph.key.insert snaps to whole frames and never selects the key for agents', async () => {
    const app = opsApp();
    seedUser(app);
    app.session.setState({ time: { ...app.session.getState().time, snapToFrames: false } });
    const before = sessionRecord(app);
    const value = (await agentOk(app, 'graph.key.insert', { curve: waveCurve(app, ARM, 'rz'), frame: 7.4 })) as {
      key: KeyId;
    };
    expect(app.store.get('keys', value.key)?.t).toBe(7);
    expect(changedFields(before, sessionRecord(app))).toEqual([]);
    // The user's insert still selects its key and honours snapping off.
    const user = (await runOk(app, 'graph.key.insert', { curve: waveCurve(app, ARM, 'rz'), frame: 8.5 })) as {
      key: KeyId;
    };
    expect(app.store.get('keys', user.key)?.t).toBe(8.5);
    expect([...app.session.getState().selection.keys.keys()]).toEqual([user.key]);
  });

  it("clip.delete under an agent keeps the session; the keeper re-points the user's active clip after the commit", async () => {
    const app = opsApp();
    const { clip: other } = (await runOk(app, 'clip.new', { character: WAVE.character, name: 'other' })) as {
      clip: ClipId;
    };
    await runOk(app, 'clip.setActive', { clip: WAVE.clip });
    seedUser(app);
    const result = await runAgent(app, 'clip.delete', { clip: WAVE.clip });
    expect(result.status).toBe('finished');
    expect(app.store.get('clips', WAVE.clip)).toBeUndefined();
    expect(app.session.getState().activeClip[WAVE.character]).toBe(other);
    await runOk(app, 'edit.undo');
    expect(app.store.get('clips', WAVE.clip)).toBeDefined();
  });

  it('clip.new {loop, activate: false} and clip.duplicate {name, activate: false} leave the session alone', async () => {
    const app = opsApp();
    seedUser(app);
    const before = sessionRecord(app);
    const { clip } = (await agentOk(app, 'clip.new', {
      character: WAVE.character,
      name: 'walk',
      loop: true,
      activate: false,
    })) as { clip: ClipId };
    expect(app.store.get('clips', clip)).toMatchObject({ name: 'walk', loop: true });
    const { clip: copy } = (await agentOk(app, 'clip.duplicate', {
      clip: WAVE.clip,
      name: 'wave 2',
      activate: false,
    })) as {
      clip: ClipId;
    };
    expect(app.store.get('clips', copy)?.name).toBe('wave 2');
    expect(changedFields(before, sessionRecord(app))).toEqual([]);
    expect(await agentRefusal(app, 'clip.duplicate', { clip: WAVE.clip, name: 'walk' })).toBe(
      'A clip with that name exists',
    );
    // Activation is a View change (access 'view'); the user's own runs keep their defaults.
    await agentOk(app, 'clip.duplicate', { clip: copy, name: 'wave 3', activate: true }, asAgent({ access: 'view' }));
    expect(app.store.get('clips', app.session.getState().activeClip[WAVE.character] as ClipId)?.name).toBe('wave 3');
    const { clip: made } = (await runOk(app, 'clip.new', { character: WAVE.character })) as { clip: ClipId };
    expect(app.session.getState().activeClip[WAVE.character]).toBe(made);
  });

  it('rig.ikFk.matchRange: an agent run names its clip and range', async () => {
    const app = opsApp();
    expect(
      await agentRefusal(app, 'rig.ikFk.matchRange', { limb: 'arm.L', side: 'fk', range: { start: 0, end: 10 } }),
    ).toBe('An agent Match Range needs its clip and range');
    expect(await agentRefusal(app, 'rig.ikFk.matchRange', { limb: 'arm.L', side: 'fk', clip: WAVE.clip })).toBe(
      'An agent Match Range needs its clip and range',
    );
    expect(
      await agentRefusal(app, 'rig.ikFk.matchRange', {
        limb: 'arm.L',
        side: 'fk',
        clip: WAVE.clip,
        range: { start: -60_000, end: 60_000 },
      }),
    ).toMatch(/100000 frames/);
  });
});
