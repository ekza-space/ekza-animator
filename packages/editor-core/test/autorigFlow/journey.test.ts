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

/** The Cube Lad exported in centimetres: its node scaled ×100 (a 1.7 m body 170 m tall, AR-R5-1's Wang case). */
function centimetreLad(): Uint8Array {
  const bytes = new Uint8Array(readFileSync(new URL('fixtures/models/cube-lad.glb', ROOT)));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as {
    nodes: { scale?: number[] }[];
  };
  for (const node of json.nodes) node.scale = [100, 100, 100];
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += ' ';
  const chunk = new TextEncoder().encode(text);
  const rest = bytes.subarray(20 + length);
  const out = new Uint8Array(20 + chunk.byteLength + rest.byteLength);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12));
  outView.setUint32(8, out.byteLength, true);
  outView.setUint32(12, chunk.byteLength, true);
  outView.setUint32(16, 0x4e4f534a, true);
  out.set(chunk, 20);
  out.set(rest, 20 + chunk.byteLength);
  return out;
}

const labels = (app: EditorApp): string[] => {
  const out: string[] = [];
  while (app.history.canUndo()) out.push(app.history.undo()?.label ?? '?');
  while (app.history.canRedo()) app.history.redo();
  return out.reverse();
};

interface Recorded {
  readonly model: AutoRigSampleId | 'cube-lad-cm';
  readonly log: readonly AutoRigFlowLogEntry[];
  readonly history: readonly string[];
}

async function journey(model: AutoRigSampleId | { readonly name: string; readonly bytes: Uint8Array }) {
  const { app, services } = await meshTestApp();
  const log = recordAutoRigFlow(autoRigFlowHost(app));
  try {
    const result = await runAutoRigJourney(log.host, {
      model: typeof model === 'string' ? { sample: model } : model,
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

  it('the Cube Lad in centimetres: ① sets its height first (AR-R5-1), then the same rig and export', async () => {
    const run = await journey({ name: 'cube-lad-cm.glb', bytes: centimetreLad() });
    expect(run.result.stopped).toBeNull();
    expect(run.result.fixes).toEqual(['scale']);
    expect(run.result.motion).toBeNull();
    expect(run.result.report?.checks.scale).toBe('ok');
    expect(run.result.export?.saved).toBe(true);
    expect(run.outside).toEqual([]);
    const recorded: Recorded = { model: 'cube-lad-cm', log: run.log, history: run.history };
    expect(recorded).toEqual(reference('cube-lad-cm', recorded));
    const fix = run.log.find((entry) => entry.op === 'autorig.fix');
    expect(fix?.args).toEqual({ fix: 'scale', height: 1.7, meshes: ['msh#1'] });
    expect(run.log.map((entry) => entry.op).indexOf('autorig.inspect')).toBeGreaterThan(
      run.log.map((entry) => entry.op).indexOf('autorig.fix'),
    );
  });

  it('runs the same journey to the same log twice (deterministic)', async () => {
    const a = await journey('cube-lad');
    const b = await journey('cube-lad');
    expect(b.log).toEqual(a.log);
    expect(b.history).toEqual(a.history);
  });
});
