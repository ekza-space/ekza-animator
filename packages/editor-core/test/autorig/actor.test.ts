// MCP-SPEC §0.4.4 (M-AI B4): under an agent actor an Auto-Rig composition forwards its run context to every inner run,
// so each inner step is its own `AI: …` step attributed to the agent and checked by the session invariant (runner rules
// 2, 3, 6), and the agent's signal stops the composition between its steps; without an actor the steps are the user's
// as before. Use Clip (`library.useClip`) run by an agent with Edit access leaves the user's active clip and playhead
// alone; with View access (or without an actor) it activates the new clip as shipped.
import { readFileSync } from 'node:fs';
import type { Tx } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorApp, type EditorApp, type ImportResult, type OperatorDef, type RunActor } from '../../src';
import { attachClipLibrary } from '../../src/library';
import { IDENTITY_CLIP_PARAMS } from '../../src/library/params';
import { type CompositionOutcome, runComposition } from '../../src/operators/builtin/rig/wizard';
import { runContextOf } from '../../src/operators/builtin/define';
import { createFakeServices } from '../../src/testing';
import { opsApp, runOk } from '../builtin/support';
import { W } from '../kernel/support';

const AGENT: RunActor = { kind: 'agent', id: 'agt_ActorForward01', name: 'Test agent' };
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function renameOp(id: `${string}.${string}`, name: string): OperatorDef<unknown, string, unknown> {
  return {
    id,
    label: `Rename ${name}`,
    category: 'test',
    scope: 'global',
    flags: { undo: true },
    apply: (ctx: { readonly tx: Tx | null }) => {
      ctx.tx?.patch('clips', W.clip, { name });
      return name;
    },
  };
}

function setup(): EditorApp {
  const app = opsApp();
  for (const def of [renameOp('test.a', 'A'), renameOp('test.b', 'B')]) disposers.push(app.operators.register(def));
  // the way `autorig.rig` runs its inner operators: from `prepare`, with its own run context forwarded
  disposers.push(
    app.operators.register({
      id: 'test.compose',
      label: 'Composition',
      category: 'test',
      scope: 'global',
      prepare: (ctx) => runComposition(ctx.app, [{ id: 'test.a' }, { id: 'test.b' }], { context: runContextOf(ctx) }),
      apply: (_ctx, _args, outcome) => outcome,
    } satisfies OperatorDef<unknown, CompositionOutcome, CompositionOutcome>),
  );
  return app;
}

describe('compositions under an actor (MCP-SPEC §0.4.4)', () => {
  it('every inner step is an AI step of the agent', async () => {
    const app = setup();
    const result = await app.runUntyped('test.compose', undefined, { source: 'api', actor: AGENT, access: 'edit' });
    expect(result).toEqual({ status: 'finished', value: { status: 'finished', values: ['A', 'B'] } });
    const steps = app.history.entries().undo.slice(-2);
    expect(steps.map((step) => [step.label, step.actor?.id])).toEqual([
      ['AI: Rename A', AGENT.id],
      ['AI: Rename B', AGENT.id],
    ]);
  });

  it('without an actor the inner steps stay the user’s', async () => {
    const app = setup();
    await runOk(app, 'test.compose');
    const steps = app.history.entries().undo.slice(-2);
    expect(steps.map((step) => [step.label, step.actor ?? null])).toEqual([
      ['Rename A', null],
      ['Rename B', null],
    ]);
  });

  it("the agent's signal stops the composition before its next inner run", async () => {
    const app = setup();
    const controller = new AbortController();
    const off = app.store.subscribe(() => controller.abort());
    disposers.push(off);
    const result = await app.runUntyped('test.compose', undefined, {
      source: 'api',
      actor: AGENT,
      access: 'edit',
      signal: controller.signal,
    });
    expect(result.status).not.toBe('finished');
    expect(
      app.history
        .entries()
        .undo.filter((step) => step.actor?.id === AGENT.id)
        .map((step) => step.label),
    ).toEqual(['AI: Rename A']);
  });
});

const LIBRARY = new URL('../../../../apps/web/public/library/', import.meta.url);
function servedFetch() {
  return (url: string) => {
    const bytes = new Uint8Array(readFileSync(new URL(url.replace(/^\/library\//, ''), LIBRARY)));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as unknown),
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  };
}

async function seedSan(): Promise<{ app: EditorApp; character: ImportResult['character'] }> {
  const app = createEditorApp({ services: createFakeServices() });
  app.prefs.setState({ firstRunDone: true });
  disposers.push(attachClipLibrary(app, { fetch: servedFetch(), frames: null }).dispose);
  const { character } = (await runOk(app, 'file.importModel', {
    name: 'seed-san.vrm',
    bytes: readFixture('seed-san.vrm'),
  })) as ImportResult;
  for (let i = 0; i < 600 && app.characters.get(character) === undefined; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { app, character };
}

describe('Use Clip under an actor (MCP-SPEC §0.4.4)', () => {
  it('an Edit run leaves the active clip and the playhead; a View run activates the new clip', async () => {
    const { app, character } = await seedSan();
    const before = app.session.getState();
    const args = { character, clip: 'walk', params: IDENTITY_CLIP_PARAMS };
    const quiet = await app.runUntyped('library.useClip', args, { source: 'api', actor: AGENT, access: 'edit' });
    expect(quiet.status).toBe('finished');
    expect(app.session.getState().activeClip).toBe(before.activeClip);
    expect(app.session.getState().time).toBe(before.time);
    expect(app.history.peekUndo()?.label).toBe('AI: Use Clip Walk');
    const shown = await app.runUntyped(
      'library.useClip',
      { ...args, clip: 'idle' },
      { source: 'api', actor: AGENT, access: 'view' },
    );
    expect(shown.status).toBe('finished');
    const added = shown.status === 'finished' ? (shown.value as { clip: string }).clip : null;
    expect(app.session.getState().activeClip[character]).toBe(added);
  }, 30_000);
});
