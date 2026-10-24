// AS-ST-15 / AS-ST-5 (STUDIO-TOUCH-SPEC §20.3 item 10, T5b): the wizard's own step functions — ① `loadSample`, ②
// `enterMarkers`, ③ `runAutoRig`, ④ `loadManifest` + `addClip`, ⑤ `enterExport` — run headless on the production
// kernel issue exactly the operator log editor-core's `autorigFlow` journey recorded for the same model
// (`editor-core/test/autorigFlow/logs/<model>.json`): the wizard runs the shared orchestration, nothing of its own.
// Three calls stand in for UI the wizard renders: ③'s motion test (`useMotionTest` drives the flow's
// `startMotionTest` with these arguments), ⑤'s licence (`VrmMetaFields` runs `char.setVrmMeta` through `ctx.run`) and
// ⑤'s *Download* (the footer's effect runs the flow's `downloadExport` with the wizard's host). Every run is recorded
// from the wizard's funnels: `ctx.run` (the person's) and `app.runUntyped` outside a run (bookkeeping).
import { existsSync, readFileSync } from 'node:fs';
import { seededIdSource } from '@ekza-studio/doc';
import {
  type AutoRigFlowLogEntry,
  type AutoRigSampleId,
  comparableArgs,
  createEditorApp,
  createMemoryBlobStore,
  downloadExport,
  type EditorApp,
  type KernelMeshRuntimes,
  loadMeshKernel,
  type OperatorResult,
  startMotionTest,
} from '@ekza-studio/editor-core';
import { createFakeServices } from '@ekza-studio/editor-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoRigSessionStore } from '../../src/session';
import type { AutoRigStep } from '../../src/types';
import type { WizardContext } from '../../src/shell/context';
import { smallStore } from '../../src/shell/store';
import { addClip, loadManifest } from '../../src/steps/animations/actions';
import { enterExport, exportCharacter } from '../../src/steps/export/enter';
import { AUTHOR_KEY } from '../../src/steps/export/author';
import { enterMarkers } from '../../src/steps/markers/enter';
import { loadSample } from '../../src/steps/model/flow';
import { flowHost } from '../../src/steps/model/flowHost';
import { runAutoRig } from '../../src/steps/rig/run';

const ROOT = new URL('../../../../', import.meta.url);
const LOGS = new URL('packages/editor-core/test/autorigFlow/logs/', ROOT);

function staticFetch(url: string | URL): Promise<Response> {
  const path = String(url);
  const file = path.startsWith('/samples/')
    ? new URL(`fixtures/models/${path.slice('/samples/'.length)}`, ROOT)
    : path.startsWith('/library/')
      ? new URL(`apps/web/public/library/${path.slice('/library/'.length)}`, ROOT)
      : null;
  if (file === null || !existsSync(file)) return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(new Uint8Array(readFileSync(file)).buffer, { status: 200 }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', staticFetch);
  // ⑤'s remembered author (`rememberedAuthor` reads the window's storage)
  const storage = new Map<string, string>([[AUTHOR_KEY, 'Tester']]);
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: () => {} },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Run = (id: string, args?: unknown) => Promise<OperatorResult<unknown>>;

/** A production app (the editor-core kernel tests' setup) whose runs are recorded as the flow log records them. */
async function recordedApp(): Promise<{ app: EditorApp; run: Run; log: AutoRigFlowLogEntry[] }> {
  await loadMeshKernel();
  const app = createEditorApp({
    services: { ...createFakeServices(), blobs: createMemoryBlobStore() },
    idSource: seededIdSource(7),
    builtins: true,
  });
  app.prefs.setState({ firstRunDone: true });
  (app.meshes as KernelMeshRuntimes).attach(app);
  const log: AutoRigFlowLogEntry[] = [];
  const tokens = new Map<string, string>();
  let open: string[] | null = null;
  app.operators.onBeforeDocumentRun((id) => open?.push(id));
  const untyped = app.runUntyped.bind(app);
  const record =
    (via: 'run' | 'quiet', funnel: Run): Run =>
    async (op, args) => {
      if (open !== null) return funnel(op, args);
      const document: string[] = [];
      open = document;
      const entry = {
        op,
        via,
        args: args === undefined ? null : comparableArgs(args, tokens),
        status: 'failed' as AutoRigFlowLogEntry['status'],
        document,
      };
      log.push(entry);
      try {
        const result = await funnel(op, args);
        entry.status = result.status;
        return result;
      } finally {
        open = null;
      }
    };
  (app as { runUntyped: Run }).runUntyped = record('quiet', untyped);
  return { app, run: record('run', untyped), log };
}

/** The wizard's context over the app (what the frame gives every step view; the UI parts are inert). */
function wizard(app: EditorApp, run: Run): WizardContext {
  const session = createAutoRigSessionStore();
  return {
    host: { confirm: () => Promise.resolve(true) },
    app,
    session,
    go: (step: AutoRigStep) => session.set({ step }),
    setFooter: () => {},
    ui: smallStore({ fromStudio: null, pendingStep: null }),
    run,
  } as unknown as WizardContext;
}

async function wizardJourney(sample: AutoRigSampleId): Promise<readonly AutoRigFlowLogEntry[]> {
  const { app, run, log } = await recordedApp();
  const ctx = wizard(app, run);
  await loadSample(ctx, sample); // ①
  await enterMarkers(ctx); // ②
  await runAutoRig(ctx); // ③
  expect(ctx.session.getState().step).toBe('rig');
  const character = exportCharacter(ctx);
  if (character === null) throw new Error('no character');
  await new Promise<void>((resolve, reject) => {
    // ③'s motion test, as `useMotionTest` starts it; leaving ③ stops it
    const test = startMotionTest(
      { app, quiet: (op, args) => app.runUntyped(op, args) },
      character.id,
      'walk',
      (state) => (state === null ? void test.stop().then(resolve, reject) : reject(new Error(state))),
    );
  });
  await loadManifest(ctx); // ④
  expect(await addClip(ctx, 'walk')).toBe(true);
  await enterExport(ctx); // ⑤
  await ctx.run('char.setVrmMeta', { character: character.id, patch: { licensePreset: 'cc0' } });
  const downloaded = await downloadExport(flowHost(ctx), character.id, ctx.session.getState().export.target);
  expect(downloaded?.saved).toBe(true);
  return log;
}

const reference = (model: string): readonly AutoRigFlowLogEntry[] =>
  (JSON.parse(readFileSync(new URL(`${model}.json`, LOGS), 'utf8')) as { log: AutoRigFlowLogEntry[] }).log;

describe('the wizard issues the autorigFlow operator log (AS-ST-15)', { timeout: 300_000 }, () => {
  it.each(['cube-lad', 'polybot-apose'] as const)('%s ①–⑤', async (model) => {
    const log = await wizardJourney(model);
    expect(log.map((entry) => entry.op)).toEqual([
      'workspace.set',
      'autorig.sample',
      'select.objects',
      'skel.quickRig.start',
      'autorig.rig',
      'library.preview',
      'library.stop',
      'autorig.clip.add',
      'char.renderThumbnail',
      'char.setVrmMeta',
      'char.setVrmMeta',
      'autorig.export',
    ]);
    expect(log).toEqual(reference(model));
  });
});
