// MCP-SPEC §5.7, §9.2 (P2): the session-state invariant as a property — 200 random schema-valid calls of the read and
// edit tools with a simulated user session (a selection, a band, a frame, an unkeyed override, another active clip):
// after every call the user's state deep-equals the recorded one (no call here moves clip frames, so the keeper
// repairs nothing), no call ends `internal`, and undoing every agent step restores the starting document byte for
// byte. Seeded (EKZA_FC_SEED overrides) so CI is deterministic.
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, liveHost, p2Fixture, runtimeOf, seedUserSession, sessionRecord } from './p2-support';
import { AGENT } from './support';

const SEED = Number(process.env['EKZA_FC_SEED'] ?? 20_261_020);
const CALLS = 200;

const clip = fc.constantFrom('agent', 'user');
const frame = fc.integer({ min: 0, max: 30 });
const armControl = fc.constantFrom('fk.upperArm.L', 'fk.lowerArm.L', 'fk.hand.L', 'fk.upperArm.R', 'fk.head', 'cog');
const rotation = fc.double({ min: -90, max: 90, noNaN: true });

const callArb: fc.Arbitrary<readonly [string, Record<string, unknown>]> = fc.oneof(
  fc.tuple(fc.constant('scene_summary'), fc.constant({})),
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
  fc.tuple(fc.constant('history_checkpoint'), fc.record({ label: fc.constant('Request'), list: fc.boolean() })),
);

describe('the session-state invariant (§5.7, §9.2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(`holds over ${CALLS} random calls, and undoing every agent step restores the document`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(callArb, { minLength: CALLS, maxLength: CALLS }), async (calls) => {
        const fx = await p2Fixture(101);
        seedUserSession(fx);
        const start = JSON.stringify(fx.app.store.snapshot());
        const runtime = runtimeOf(fx, liveHost({ answer: 'allow' }));
        const before = sessionRecord(fx.app);
        let steps = 0;
        let ok = 0;
        // a call every 100 ms of the runtime's clock: within the rate limit (§5.8 2)
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        for (const [name, args] of calls) {
          now += 100;
          const result = await call(runtime, name, args);
          expect([name, result.ok ? 'ok' : result.error.code]).not.toEqual([name, 'internal']);
          ok += result.ok ? 1 : 0;
          steps += result.ok && result.undo !== undefined ? 1 : 0;
          expect([name, sessionRecord(fx.app)]).toEqual([name, before]);
        }
        // the sequence did real work: most calls succeeded and many recorded steps
        expect(ok).toBeGreaterThan(CALLS * 0.8);
        expect(steps).toBeGreaterThan(CALLS * 0.3);
        // undo every agent step (the user made none since the start)
        while (fx.app.history.peekUndo()?.actor?.id === AGENT.id) fx.app.history.undo();
        expect(JSON.stringify(fx.app.store.snapshot())).toBe(start);
        runtime.dispose();
      }),
      { numRuns: 1, seed: SEED },
    );
  });
});
