// STUDIO-TOUCH-SPEC §20.7, AS-ST-5 / AS-ST-15 (T5b): the headless operator log of Auto-Rig ①–⑤, recorded for the Cube
// Lad (T-pose) and Polybot (A-pose) on the production kernel. The journey runs only `autorigFlow` — the functions the
// wizard's steps call — through a recording host: ① the sample and every first fix, ② Quick Rig with the One-Click
// guess, ③ Auto-rig and the Walk motion test, ④ Walk from the starter pack, ⑤ the first-entry thumbnail and author,
// the licence, the Ekza VRM download. Each log is compared with its recorded reference (`logs/<model>.json`): the
// operator sequence Halo's J1 must equal (T9), and the one the wizard's own step functions issue
// (`autorig/test/steps/flowLog.test.ts`). `UPDATE_AUTORIG_LOGS=1` writes the references again (then `biome format
// --write` them).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AutoRigFlowLogEntry,
  type AutoRigSampleId,
  autoRigFlowHost,
  type EditorApp,
  recordAutoRigFlow,
  runAutoRigJourney,
} from '../../src';
import { meshTestApp } from '../mesh/support';

const ROOT = new URL('../../../../', import.meta.url);
const LOGS = new URL('./logs/', import.meta.url);

/** The web app's static files: `/samples/` (the fixtures `copy-assets` copies) and `/library/` (the starter pack). */
function servedFile(url: string): Uint8Array | null {
  const path = url.startsWith('/samples/')
    ? `fixtures/models/${url.slice('/samples/'.length)}`
    : url.startsWith('/library/')
      ? `apps/web/public/library/${url.slice('/library/'.length)}`
      : null;
  if (path === null) return null;
  const file = new URL(path, ROOT);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
}

function staticFetch(url: string | URL): Promise<Response> {
  const bytes = servedFile(String(url));
  if (bytes === null) return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(bytes.slice().buffer, { status: 200 }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', staticFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const labels = (app: EditorApp): string[] => {
  const out: string[] = [];
  while (app.history.canUndo()) out.push(app.history.undo()?.label ?? '?');
  while (app.history.canRedo()) app.history.redo();
  return out.reverse();
};

interface Recorded {
  readonly model: AutoRigSampleId;
  readonly log: readonly AutoRigFlowLogEntry[];
  readonly history: readonly string[];
}

async function journey(sample: AutoRigSampleId) {
  const { app, services } = await meshTestApp();
  const log = recordAutoRigFlow(autoRigFlowHost(app));
  try {
    const result = await runAutoRigJourney(log.host, {
      model: { sample },
      clips: ['walk'],
      author: 'Tester',
      meta: [{ licensePreset: 'cc0' }],
    });
    return { app, services, result, log: log.entries(), outside: log.outside(), history: labels(app) };
  } finally {
    log.stop();
  }
}

function reference(name: string, recorded: Recorded): Recorded {
  const file = new URL(`${name}.json`, LOGS);
  if (process.env['UPDATE_AUTORIG_LOGS'] === '1' || !existsSync(file)) {
    mkdirSync(LOGS, { recursive: true });
    writeFileSync(file, `${JSON.stringify(recorded, null, 2)}\n`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as Recorded;
}

describe('Auto-Rig ①–⑤ headless through autorigFlow (AS-ST-5, AS-ST-15)', { timeout: 300_000 }, () => {
  it('the Cube Lad (T-pose): the recorded operator log, two rig steps, a clean Ekza VRM', async () => {
    const run = await journey('cube-lad');
    expect(run.result.stopped).toBeNull();
    expect(run.result.fixes).toEqual([]);
    expect(run.result.motion).toBeNull();
    expect(run.result.export?.saved).toBe(true);
    expect(run.result.export?.result.fileName).toBe('cube-lad.vrm');
    expect(run.services.downloads.map((download) => download.fileName)).toEqual(['cube-lad.vrm']);
    expect(run.outside).toEqual([]);
    expect(run.history).toEqual([
      'Import Static Model',
      'Create Skeleton',
      'Bind Skin',
      'Use Clip Walk',
      'Render Thumbnail',
      'VRM Meta',
      'VRM Meta',
    ]);
    const recorded: Recorded = { model: 'cube-lad', log: run.log, history: run.history };
    expect(recorded).toEqual(reference('cube-lad', recorded));
    const rig = run.log.find((entry) => entry.op === 'autorig.rig');
    expect(rig?.args).toEqual({ rigidParts: false, straighten: false });
  });

  it('Polybot (A-pose): the recorded operator log, straightened in a third rig step, a clean Ekza VRM', async () => {
    const run = await journey('polybot-apose');
    expect(run.result.stopped).toBeNull();
    expect(run.result.report?.pose?.kind).toBe('a');
    expect(run.result.motion).toBeNull();
    expect(run.result.export?.saved).toBe(true);
    expect(run.outside).toEqual([]);
    expect(run.history).toContain('Straighten to T-Pose');
    const recorded: Recorded = { model: 'polybot-apose', log: run.log, history: run.history };
    expect(recorded).toEqual(reference('polybot-apose', recorded));
    const rig = run.log.find((entry) => entry.op === 'autorig.rig');
    expect(rig?.args).toMatchObject({ straighten: true });
    expect(rig?.document).toEqual(['skel.quickRig.commit', 'skin.bind', 'skel.pose.applyAsRest']);
  });

  it('runs the same journey to the same log twice (deterministic)', async () => {
    const a = await journey('cube-lad');
    const b = await journey('cube-lad');
    expect(b.log).toEqual(a.log);
    expect(b.history).toEqual(a.history);
  });
});
