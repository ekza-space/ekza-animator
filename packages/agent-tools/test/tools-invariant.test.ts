// MCP-SPEC §5.7, §9.2 (P2): the session-state invariant as a property — 200 random schema-valid calls of every ready
// tool (reads, edits, clips, history; the tools over P1's work answer their pre-P1 refusals until READY.p1) with a
// simulated user session (a selection, a band, a frame, an unkeyed override, another active clip): after every call
// the user's state deep-equals the recorded one once the keeper repairs that call reported are applied (clip_update's
// `overridesDropped`, clip_delete's `userNowSees`), no call ends `internal`, and undoing every agent step restores the
// starting document byte for byte. Seeded (EKZA_FC_SEED overrides) so CI is deterministic.
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readyTools } from '../src';
import { call, dataOf, liveHost, p2Fixture, runtimeOf, seedUserSession, sessionRecord } from './p2-support';
import { READY } from './ready';
import { AGENT } from './support';

const SEED = Number(process.env['EKZA_FC_SEED'] ?? 20_261_020);
const CALLS = 200;
/** Stands for the newest checkpoint handle of the run (history_revert {to}). */
const LAST_CHECKPOINT = '$checkpoint';

const clip = fc.constantFrom('agent', 'user');
const frame = fc.integer({ min: 0, max: 30 });
const armControl = fc.constantFrom('fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L', 'fk.upperArm.R', 'fk.head', 'cog');
const rotation = fc.double({ min: -90, max: 90, noNaN: true });
const newClip = fc.constantFrom('c1', 'c2', 'c3');

type Call = readonly [string, Record<string, unknown>];

/** The tools that did most of the work before this round; their success rate is checked (the rest may refuse). */
const CORE = new Set([
  'scene_summary',
  'pose_read',
  'keys_read',
  'curves_summary',
  'keys_set',
  'pose_set',
  'pose_aim',
  'pose_ik_target',
  'pose_transfer',
  'pose_reset',
  'keys_delete',
  'keys_adjust',
  'keys_retime',
  'history_checkpoint',
]);

const callArb: fc.Arbitrary<Call> = fc.oneof(
  // reads
  fc.tuple(fc.constant('scene_summary'), fc.constant({})),
  fc.tuple(
    fc.constant('rig_describe'),
    fc.record(
      { detail: fc.constantFrom('concise', 'detailed'), bodyParts: fc.constant(['arm.L']) },
      { requiredKeys: ['detail'] },
    ),
  ),
  fc.tuple(
    fc.constant('pose_read'),
    fc.record({
      clip,
      frames: fc.array(frame, { minLength: 1, maxLength: 3 }),
      space: fc.constantFrom('channels', 'world', 'both'),
    }),
  ),
  fc.tuple(
    fc.constant('keys_read'),
    fc.record({ clip, targets: fc.record({ controls: fc.array(armControl, { minLength: 1, maxLength: 2 }) }) }),
  ),
  fc.tuple(fc.constant('curves_summary'), fc.record({ clip })),
  // posing
  fc.tuple(
    fc.constant('keys_set'),
    fc.record({
      clip,
      keys: fc.array(
        fc.record({ control: armControl, channel: fc.constantFrom('rx', 'ry', 'rz'), frame, value: rotation }),
        { minLength: 1, maxLength: 4 },
      ),
    }),
  ),
  fc.tuple(
    fc.constant('pose_set'),
    fc.record({
      clip,
      frame,
      set: fc.array(fc.record({ control: armControl, rotateDeg: fc.record({ z: rotation }) }), {
        minLength: 1,
        maxLength: 2,
      }),
    }),
  ),
  fc.tuple(
    fc.constant('pose_aim'),
    fc.record({ clip, frame, aims: fc.constant([{ bone: 'leftUpperArm', direction: 'left+up' }]) }),
  ),
  fc.tuple(
    fc.constant('pose_ik_target'),
    fc.record({
      clip,
      frame,
      limb: fc.constantFrom('leg.L', 'leg.R'),
      offsetM: fc.tuple(fc.constant(0), fc.double({ min: 0, max: 0.2, noNaN: true }), fc.constant(0)),
    }),
  ),
  fc.tuple(
    fc.constant('pose_transfer'),
    fc.record({
      clip,
      fromFrame: frame,
      toFrames: fc.array(frame, { minLength: 1, maxLength: 2 }),
      controls: fc.constant(['fk.lowerArm.L']),
    }),
  ),
  fc.tuple(
    fc.constant('pose_reset'),
    fc.record({ clip, frames: fc.array(frame, { minLength: 1, maxLength: 2 }), controls: fc.constant(['fk.hand.L']) }),
  ),
  // keys and timing
  fc.tuple(
    fc.constant('keys_delete'),
    fc.record({
      clip,
      targets: fc.record({ controls: fc.array(armControl, { minLength: 1, maxLength: 2 }) }),
      frames: fc.array(frame, { minLength: 1, maxLength: 3 }),
    }),
  ),
  fc.tuple(
    fc.constant('keys_adjust'),
    fc.record({
      clip,
      targets: fc.constant({ controls: ['fk.lowerArm.L'] }),
      scalePercent: fc.integer({ min: 50, max: 150 }),
    }),
  ),
  fc.tuple(
    fc.constant('keys_retime'),
    fc.record({
      clip,
      targets: fc.constant({ controls: ['fk.lowerArm.L'] }),
      mode: fc.constant('offset'),
      offsetFrames: fc.integer({ min: -3, max: 3 }),
    }),
  ),
  fc.tuple(
    fc.constant('keys_retime'),
    fc.record({
      clip,
      targets: fc.constant({ controls: ['fk.lowerArm.L'] }),
      mode: fc.constant('scale'),
      factor: fc.constantFrom(0.5, 1.5, 2),
      pivotFrame: fc.constant(0),
    }),
  ),
  fc.tuple(
    fc.constant('keys_tween'),
    fc.record({
      clip,
      targets: fc.record({ controls: fc.array(armControl, { minLength: 1, maxLength: 2 }) }),
      frames: fc.array(frame, { minLength: 1, maxLength: 2 }),
      mode: fc.constantFrom('tween', 'ease', 'push_pull'),
      amountPercent: fc.integer({ min: -50, max: 150 }),
    }),
  ),
  // curve cleanup
  fc.tuple(
    fc.constant('curves_set_interpolation'),
    fc.oneof(
      fc.record({
        clip,
        targets: fc.constant({ controls: ['fk.lowerArm.L'] }),
        tangent: fc.constantFrom('auto', 'linear', 'flat', 'step'),
      }),
      fc.record({
        clip,
        targets: fc.constant({ controls: ['fk.lowerArm.L'] }),
        postInfinity: fc.constantFrom('cycle', 'constant'),
      }),
    ),
  ),
  fc.tuple(fc.constant('curves_euler_filter'), fc.record({ clip })),
  fc.tuple(fc.constant('curves_simplify'), fc.record({ clip, dryRun: fc.boolean() })),
  // clips
  fc.tuple(
    fc.constant('clip_create'),
    fc.record(
      { name: newClip, durationFrames: fc.constant(30), activate: fc.constant(true) },
      { requiredKeys: ['name', 'durationFrames'] },
    ),
  ),
  fc.tuple(
    fc.constant('clip_update'),
    fc.oneof(
      fc.record({
        clip,
        fps: fc.constantFrom(24, 25, 30),
        fpsMode: fc.constantFrom('keep_seconds', 'keep_frames'),
        confirm: fc.constant(true),
      }),
      fc.record({ clip, rangeFrames: fc.constantFrom([0, 30], [0, 40], [-10, 30], [5, 30]) }),
      fc.record({ clip, loop: fc.boolean() }),
      fc.record({ clip, activate: fc.constant(true) }),
      fc.record({ clip: newClip, name: newClip }),
    ),
  ),
  fc.tuple(
    fc.constant('clip_make_loop'),
    fc.record({ clip, method: fc.constantFrom('match_ends', 'cycle_only', 'blend'), dryRun: fc.boolean() }),
  ),
  fc.tuple(
    fc.constant('clip_delete'),
    // the user's active clip only before P1 (refused); after P1 its deletion is a reported keeper repair too
    fc.record({ clip: fc.constantFrom('c1', 'c2', 'c3', 'clip1', 'user'), confirm: fc.constant(true) }),
  ),
  // history
  fc.tuple(fc.constant('history_checkpoint'), fc.record({ label: fc.constant('Request'), list: fc.boolean() })),
  fc.tuple(fc.constant('history_revert'), fc.record({ to: fc.constant(LAST_CHECKPOINT), dryRun: fc.boolean() })),
);

/** Every tool the property draws (kept equal to the ready catalogue below). */
const DRAWN = [
  'scene_summary',
  'rig_describe',
  'keys_read',
  'curves_summary',
  'pose_read',
  'pose_set',
  'pose_aim',
  'pose_ik_target',
  'pose_transfer',
  'pose_reset',
  'keys_set',
  'keys_delete',
  'keys_adjust',
  'keys_retime',
  'keys_tween',
  'curves_set_interpolation',
  'curves_euler_filter',
  'curves_simplify',
  'clip_create',
  'clip_update',
  'clip_make_loop',
  'clip_delete',
  'history_checkpoint',
  'history_revert',
];

describe('the session-state invariant (§5.7, §9.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws every ready tool of the catalogue', () => {
    // B1: the hub's tools and the file tools are drawn by ekza-studio-mcp's invariant test (they need a server)
    expect([...DRAWN].sort()).toEqual(
      readyTools()
        .filter((tool) => tool.group !== 'files' && !['projects_list', 'project_close'].includes(tool.name))
        .map((tool) => tool.name)
        // editor_connect is answered by the server's bridge, never by a runtime (B2)
        .filter((name) => name !== 'editor_connect')
        // view_capture is a live read with a capture service: tools-view.test.ts checks the invariant for it (B3)
        .filter((name) => name !== 'view_capture')
        .sort(),
    );
  });

  it(`holds over ${CALLS} random calls, and undoing every agent step restores the document`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(callArb, { minLength: CALLS, maxLength: CALLS }), async (calls) => {
        const fx = await p2Fixture(101);
        seedUserSession(fx);
        const { overrides } = fx.app.session.getState();
        const start = JSON.stringify(fx.app.store.snapshot());
        const runtime = runtimeOf(fx, liveHost({ answer: 'allow' }));
        let before = sessionRecord(fx.app);
        let checkpoint = 'cp_000000000000';
        let steps = 0;
        let core = 0;
        let coreOk = 0;
        const drawn = new Set<string>();
        // a call every 100 ms of the runtime's clock: within the rate limit (§5.8 2)
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        for (const [name, raw] of calls) {
          now += 100;
          drawn.add(name);
          const args = raw['to'] === LAST_CHECKPOINT ? { ...raw, to: checkpoint } : raw;
          const result = await call(runtime, name, args);
          expect([name, result.ok ? 'ok' : result.error.code]).not.toEqual([name, 'internal']);
          if (CORE.has(name)) {
            core++;
            coreOk += result.ok ? 1 : 0;
          }
          steps += result.ok && result.undo !== undefined ? 1 : 0;
          if (name === 'history_checkpoint' && result.ok) {
            checkpoint = dataOf<{ checkpoint: string }>(result).checkpoint;
          }
          // the keeper repairs the call reported (§5.7): dropped unkeyed edits, a switched clip
          const expected = { ...before };
          let repaired = false;
          if (result.ok) {
            const data = result.data as { overridesDropped?: number; userNowSees?: string | null };
            if ((data.overridesDropped ?? 0) > 0) {
              expected['overrides'] = new Map();
              repaired = true;
            }
            if (typeof data.userNowSees === 'string') {
              const shown = fx.app.store.query.clipsOfCharacter(fx.character).find((c) => c.name === data.userNowSees);
              expected['activeClip'] = { ...(before['activeClip'] as object), [fx.character]: shown?.id };
              expected['overrides'] = new Map();
              repaired = true;
            }
          }
          expect([name, sessionRecord(fx.app)]).toEqual([name, expected]);
          if (repaired) {
            // the user types the edit again: the next calls are checked against an override too
            fx.app.session.setState({ overrides });
            before = sessionRecord(fx.app);
          }
        }
        // the run drew (almost) every tool, and the core tools did real work
        expect(drawn.size).toBeGreaterThanOrEqual(DRAWN.length - 2);
        expect(coreOk).toBeGreaterThan(core * 0.8);
        expect(steps).toBeGreaterThan(CALLS * 0.2);
        // undo every agent step (the user made none since the start)
        while (fx.app.history.peekUndo()?.actor?.id === AGENT.id) fx.app.history.undo();
        expect(JSON.stringify(fx.app.store.snapshot())).toBe(start);
        runtime.dispose();
      }),
      { numRuns: 1, seed: SEED },
    );
  });

  it.skipIf(READY.p1)('refuses (until P1) what would touch the user’s state, and never ends internal', async () => {
    const fx = await p2Fixture(102);
    seedUserSession(fx);
    const before = sessionRecord(fx.app);
    const runtime = runtimeOf(fx, liveHost({ answer: 'allow' }));
    for (const [name, args] of [
      ['clip_create', { name: 'c1', durationFrames: 30 }],
      ['clip_delete', { clip: 'user', confirm: true }],
      ['curves_euler_filter', { clip: 'agent' }],
    ] as const) {
      const result = await call(runtime, name, args);
      expect([name, result.ok ? 'ok' : result.error.code]).toEqual([name, 'unsupported']);
      expect(sessionRecord(fx.app)).toEqual(before);
    }
    runtime.dispose();
  });
});
