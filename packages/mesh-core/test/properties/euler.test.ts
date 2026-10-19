// M6A-SPEC §5.29 P1, P5, P8 on the Euler operators (Node): model-based `fc.commands` runs of 50–500 steps on
// primitives with random divisions and on synthetic non-manifold soups; every step goes through the harness
// (validity, count oracle, canonical links, dead slots, remap, dirty set, incremental = full revision both ways,
// exact undo and redo on the same mesh and on rebuilt runtimes). Then the same with 2–40 (and 200–400) steps per
// transaction, layer events included — the way ops compose the operators — with an exact abort first.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EditMesh, editMeshFrom, type MeshData, primitive, writeRevision } from '../../src';
import { arbEulerStep, arbPrimitive, arbSoup, type EulerStep } from '../../src/testing';
import { checkStep, checkTransaction, checkTransactions, newTally, type StepTally } from './harness';

interface Model {
  steps: number;
}
interface Real {
  readonly mesh: EditMesh;
  revision: ReturnType<typeof writeRevision>;
  readonly tally: StepTally;
}

class StepCommand implements fc.Command<Model, Real> {
  constructor(readonly step: EulerStep) {}
  check(): boolean {
    return true;
  }
  run(model: Model, real: Real): void {
    real.revision = checkStep(real.mesh, this.step, real.tally, real.revision);
    model.steps++;
  }
  toString(): string {
    return JSON.stringify(this.step);
  }
}

/** One multi-step transaction (begin, 2…n resolved steps, end) as a model-based command. */
class TransactionCommand implements fc.Command<Model, Real> {
  constructor(readonly steps: readonly EulerStep[]) {}
  check(): boolean {
    return true;
  }
  run(model: Model, real: Real): void {
    real.revision = checkTransaction(real.mesh, this.steps, real.tally, real.revision);
    model.steps += this.steps.length;
  }
  toString(): string {
    return JSON.stringify(this.steps);
  }
}

const commands = fc.commands([arbEulerStep().map((step) => new StepCommand(step))], { maxCommands: 500, size: 'max' });

const transactions = (minLength: number, maxLength: number, maxCommands: number) =>
  fc.commands(
    [fc.array(arbEulerStep(), { minLength, maxLength, size: 'max' }).map((steps) => new TransactionCommand(steps))],
    { maxCommands, size: 'max' },
  );

function run(start: MeshData, cmds: Iterable<fc.Command<Model, Real>>): StepTally {
  const mesh = editMeshFrom(start);
  const real: Real = { mesh, revision: writeRevision(mesh), tally: newTally() };
  fc.modelRun(() => ({ model: { steps: 0 }, real }), cmds);
  return real.tally;
}

describe('Euler operator sequences (P1, P5, P8; model-based)', () => {
  it('on primitives with random divisions', () => {
    let applied = 0;
    fc.assert(
      fc.property(arbPrimitive(), commands, ({ kind, params }, cmds) => {
        applied += run(primitive(kind, params), cmds).applied;
      }),
      { numRuns: 8 },
    );
    expect(applied).toBeGreaterThan(100);
  });

  it('on synthetic non-manifold soups', () => {
    let steps = 0;
    fc.assert(
      fc.property(arbSoup(), commands, (soup, cmds) => {
        const tally = run(soup, cmds);
        steps += tally.applied + tally.refused;
      }),
      { numRuns: 8 },
    );
    expect(steps).toBeGreaterThan(100);
  });

  it('runs 50–500 steps (fixed-length sequences from a cube)', () => {
    fc.assert(
      fc.property(fc.array(arbEulerStep(), { minLength: 50, maxLength: 500 }), (steps) => {
        const tally = run(
          primitive('cube', { subdivisionsWidth: 2 }),
          steps.map((step) => new StepCommand(step)),
        );
        expect(tally.applied + tally.refused + tally.skipped).toBe(steps.length);
      }),
      { numRuns: 3 },
    );
  });
});

describe('multi-step transactions with layer events (P1, P5, P8; model-based)', () => {
  it('2–40 steps per transaction on primitives with random divisions', () => {
    let applied = 0;
    fc.assert(
      fc.property(arbPrimitive(), transactions(2, 40, 12), ({ kind, params }, cmds) => {
        applied += run(primitive(kind, params), cmds).applied;
      }),
      { numRuns: 10 },
    );
    expect(applied).toBeGreaterThan(200);
  });

  it('2–40 steps per transaction on synthetic non-manifold soups', () => {
    let steps = 0;
    fc.assert(
      fc.property(arbSoup(), transactions(2, 40, 12), (soup, cmds) => {
        const tally = run(soup, cmds);
        steps += tally.applied + tally.refused;
      }),
      { numRuns: 10 },
    );
    expect(steps).toBeGreaterThan(200);
  });

  it('200–400 steps in one transaction', () => {
    fc.assert(
      fc.property(
        arbPrimitive(),
        fc.array(arbEulerStep(), { minLength: 200, maxLength: 400, size: 'max' }),
        ({ kind, params }, steps) => {
          const tally = checkTransactions(primitive(kind, params), [steps]).tally;
          expect(tally.applied + tally.refused + tally.skipped).toBe(steps.length);
        },
      ),
      { numRuns: 4 },
    );
  });
});
