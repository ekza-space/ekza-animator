// Dope Sheet benchmarks (M2A-SPEC §5.10, §5.22; report only): redraw with 450 curves × 200 keys (the 50 controls ×
// 9 channels × 200 keys of the budget, on the wave rig's 27 controls with extra attribute channels) and a drag of
// 1,000 selected keys per pointer frame, on the production kernel (`createEditorApp`: doc's indexed store, the
// editor's curve engine; the naive test store scans every key per query). The drag splits the frame into the
// preview update, compiling the moved curves (both shared with the Graph Editor's M-1 path, §5.21.1) and the Dope
// Sheet's own redraw. The bounds asserted only catch order-of-magnitude regressions; the e2e bench `m2a-a3.bench.ts`
// measures the whole editor.
import type { ChannelId, ControlId, CurveId, KeyId, KeyRecord } from '@ekza-animator/doc';
import { createMemoryStore, newId } from '@ekza-animator/doc';
import { createEditorApp, type EditorApp } from '@ekza-animator/editor-core';
import { createFakeServices } from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DopeSheetController, registerDopeSheetContributions } from '../../src';
import { waveSnapshot } from '../timeline/fixture';
import { pointer, WAVE } from './fixture';

interface Bench {
  readonly app: EditorApp;
  readonly sheet: DopeSheetController;
  dispose(): void;
}

let mounted: Bench | null = null;
afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

/** The production kernel (`createEditorApp`: doc's indexed memory store, the editor curve engine) on the wave doc. */
async function realApp(): Promise<EditorApp> {
  const store = createMemoryStore();
  store.load(await waveSnapshot());
  return createEditorApp({ services: createFakeServices(), store });
}

function mount(app: EditorApp, width: number, height: number, dpr: number): Bench {
  const canvas = document.createElement('canvas');
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.append(canvas);
  const sheet = new DopeSheetController({ app, canvas });
  const unregister = registerDopeSheetContributions(app, () => sheet);
  sheet.resize(width, height, dpr);
  return {
    app,
    sheet,
    dispose() {
      unregister();
      sheet.dispose();
      canvas.remove();
      app.dispose();
    },
  };
}

function setKeySelection(app: EditorApp, keys: readonly KeyId[]): void {
  const state = app.session.getState();
  app.session.setState({
    selection: { ...state.selection, keys: new Map(keys.map((key) => [key, { key: true, in: false, out: false }])) },
  });
}

const TRS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const;

/** 450 curves × `keys` keys at whole frames, values varying (spans move; a few holds). */
async function denseSheet(keys: number): Promise<{ readonly m: Bench; readonly curves: CurveId[] }> {
  const app = await realApp();
  const controls = app.store.query.controlsOfRig('rig_SyntheticWave001' as never).map((control) => control.id);
  const curves: CurveId[] = [];
  app.store.transact({ label: 'Dense', undoable: false }, (tx) => {
    for (const key of tx.query.keysOfCurve(WAVE.curve)) tx.remove('keys', key.id);
    let c = 0;
    for (let k = 0; curves.length < 450; k++) {
      const control = controls[k % controls.length] as ControlId;
      const round = Math.floor(k / controls.length);
      const channel = (round < TRS.length ? TRS[round] : `@c${round}`) as ChannelId;
      if (tx.query.curveFor(WAVE.clip, WAVE.layer, control, channel) !== undefined) continue;
      const id = newId('curve');
      tx.put('curves', {
        id,
        clip: WAVE.clip,
        layer: WAVE.layer,
        control,
        channel,
        weighted: false,
        pre: 'constant',
        post: 'constant',
        staticValue: null,
        locked: false,
        muted: false,
        deleted: null,
      });
      for (let i = 0; i < keys; i++) {
        const record: KeyRecord = {
          id: newId('key'),
          clip: WAVE.clip,
          curve: id,
          t: i,
          v: i % 10 < 3 ? 0 : Math.sin(i * 0.37 + c),
          inType: 'auto',
          outType: 'auto',
          inHandle: { dt: 0, dv: 0 },
          outHandle: { dt: 0, dv: 0 },
          broken: false,
          weightLocked: true,
        };
        tx.put('keys', record);
      }
      curves.push(id);
      c++;
    }
  });
  const m = mount(app, 1240, 300, 2);
  m.sheet.setShow('character');
  return { m, curves };
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

describe('Dope Sheet benchmarks (§5.22, reported)', () => {
  it('redraw of 450 curves × 200 keys: view change, selection change, one edited key', async ({ annotate }) => {
    const { m, curves } = await denseSheet(200);
    mounted = m;
    m.sheet.frame('all'); // all 200 frames on screen
    m.sheet.redraw(true); // builds rows and row data
    const view: number[] = [];
    for (let i = 0; i < 30; i++) {
      m.sheet.setView({ ...m.sheet.view, f0: m.sheet.view.f0 + (i % 2 === 0 ? 0.5 : -0.5) });
      const start = performance.now();
      m.sheet.redraw(true);
      view.push(performance.now() - start);
    }
    const selection: number[] = [];
    for (let i = 0; i < 10; i++) {
      // A selection change recounts the selected keys of every visible row.
      const keys = m.app.store.query
        .keysOfCurve(curves[i] as CurveId)
        .slice(0, 50)
        .map((key) => key.id);
      setKeySelection(m.app, keys);
      const start = performance.now();
      m.sheet.redraw(true);
      selection.push(performance.now() - start);
    }
    const edit: number[] = [];
    for (let i = 0; i < 10; i++) {
      // One key's value changes: its curve's data and the rows above it are rebuilt.
      const key = m.app.store.query.keysOfCurve(curves[i] as CurveId)[100] as KeyRecord;
      m.app.store.transact({ label: 'Edit', undoable: false }, (tx) => tx.put('keys', { ...key, v: key.v + 0.1 }));
      m.app.evaluation.compiledCurve(curves[i] as CurveId); // the frame's evaluation compiles it
      const start = performance.now();
      m.sheet.redraw();
      edit.push(performance.now() - start);
    }
    const rows = m.sheet.rows().length;
    await annotate(
      `Dope Sheet redraw, ${curves.length} curves × 200 keys (all frames shown), ${rows} rows, DPR 2: view change ` +
        `median ${median(view).toFixed(2)} ms, selection change ${median(selection).toFixed(2)} ms, one edited key ` +
        `${median(edit).toFixed(2)} ms (budget ≤ 4 ms)`,
      'budget',
    );
    expect(median(view)).toBeLessThan(100);
    expect(median(selection)).toBeLessThan(100);
    expect(median(edit)).toBeLessThan(100);
  });

  it('drag of 1,000 selected keys: per pointer frame', async ({ annotate }) => {
    const { m, curves } = await denseSheet(200);
    mounted = m;
    // The last frames of every curve: 1,000 keys free to move later.
    const selected: KeyId[] = [];
    for (const curve of curves) {
      const keys = m.app.store.query.keysOfCurve(curve);
      for (const key of keys.slice(-Math.min(3, 1000 - selected.length))) selected.push(key.id);
      if (selected.length === 1000) break;
    }
    setKeySelection(m.app, selected);
    m.sheet.frame('all');
    m.sheet.redraw(true);
    // Grab the region bar (a press on a glyph would select that glyph's keys instead).
    const grab = m.sheet.regionPoint('middle');
    if (grab === null) throw new Error('no region bar');
    const { x: x0, y } = grab;
    m.sheet.pointerDown(pointer(x0, y));
    m.sheet.pointerMove(pointer(x0 + 5, y));
    const total: number[] = [];
    const update: number[] = [];
    const compile: number[] = [];
    const own: number[] = [];
    for (let step = 1; step <= 30; step++) {
      const start = performance.now();
      m.sheet.pointerMove(pointer(x0 + 5 + step * m.sheet.view.sx, y));
      m.app.flushScheduled();
      const updated = performance.now();
      // The frame's pose evaluation compiles the moved curves (the shared M-1 path); the Dope Sheet reuses them.
      for (const curve of curves) m.app.evaluation.compiledCurve(curve);
      const compiled = performance.now();
      m.sheet.redraw();
      const end = performance.now();
      total.push(end - start);
      update.push(updated - start);
      compile.push(compiled - updated);
      own.push(end - compiled);
    }
    m.sheet.pointerUp(pointer(x0 + 5 + 30 * m.sheet.view.sx, y, { buttons: 0 }));
    const moved = selected.filter((key) => (m.app.store.get('keys', key)?.t ?? 0) >= 200).length;
    expect(moved).toBe(selected.length);
    await annotate(
      `Dope Sheet drag of ${selected.length} selected keys (${curves.length} curves × 200 keys), DPR 2: median ` +
        `${median(total).toFixed(2)} ms per pointer frame: preview update ${median(update).toFixed(2)} ms, compiling ` +
        `the moved curves ${median(compile).toFixed(2)} ms (both the shared M-1 path), the Dope Sheet's redraw ` +
        `${median(own).toFixed(2)} ms (budget ≤ 4 ms)`,
      'budget',
    );
    expect(median(total)).toBeLessThan(500);
  });
});
