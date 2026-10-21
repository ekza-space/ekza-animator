// M6A-SPEC §4.7, §5.27 (B9): the lazy scale chunk failing to load (offline after a redeploy, a network error). The
// user is told once per failed load, nothing rejects unhandled, the manipulator does not retry on every refresh
// (playback refreshes each frame), and the user's next Scale action (choosing R again, a press) tries again.
import type { ControlId } from '@ekza-studio/doc';
import { type ToolPointerEvent, VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import type { FakeServices } from '@ekza-studio/editor-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  onScaleKitLoaded,
  requestScaleKit,
  SCALE_LOAD_FAILED,
  type ScaleKit,
  scaleKit,
  setScaleKitImporterForTests,
} from '../src/manipulators/scale/load';
import { createRig, type Rig } from './helpers';

const realKit = (): Promise<ScaleKit> => import('../src/manipulators/scale/kit');

/** An importer that fails like a missing chunk, counting its calls. */
function offline(): { readonly importer: () => Promise<ScaleKit>; calls(): number } {
  let calls = 0;
  return {
    importer: () => {
      calls += 1;
      return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
    },
    calls: () => calls,
  };
}

/** Lets every pending promise callback run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const failedToasts = (services: Pick<FakeServices, 'toasts'>): number =>
  services.toasts.filter((t) => t.kind === 'error' && t.text === SCALE_LOAD_FAILED).length;

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
  setScaleKitImporterForTests(null);
});

describe('requestScaleKit', () => {
  it('a failed load resolves null for every caller and toasts once; the next request tries again', async () => {
    const net = offline();
    setScaleKitImporterForTests(net.importer);
    const toasts: { kind: string; text: string }[] = [];
    const notify = { toast: (t: { kind: string; text: string }) => void toasts.push(t) };
    const [a, b] = await Promise.all([requestScaleKit(notify), requestScaleKit(notify)]);
    expect([a, b]).toEqual([null, null]);
    expect(net.calls()).toBe(1);
    expect(toasts).toEqual([{ kind: 'error', text: SCALE_LOAD_FAILED }]);
    expect(scaleKit()).toBeNull();

    expect(await requestScaleKit(notify)).toBeNull();
    expect(net.calls()).toBe(2);
    expect(toasts).toHaveLength(2);

    // Back online: the kit loads, the loaded listeners hear it, and later requests do not import again.
    let calls = 0;
    let loaded = 0;
    const off = onScaleKitLoaded(() => (loaded += 1));
    setScaleKitImporterForTests(() => {
      calls += 1;
      return realKit();
    });
    const kit = await requestScaleKit(notify);
    expect(kit).not.toBeNull();
    expect(scaleKit()).toBe(kit);
    expect(loaded).toBe(1);
    expect(await requestScaleKit(notify)).toBe(kit);
    expect(calls).toBe(1);
    expect(toasts).toHaveLength(2);
    off();
  });
});

describe('the Scale tool and its manipulator when the chunk fails', () => {
  const PANE = 'pane-single';

  function chooseTool(r: Rig, viewport: string): void {
    r.app.session.setState({ tools: { ...r.app.session.getState().tools, viewport } });
  }

  it('toasts once, never retries per refresh, retries when R is chosen again or on a press, then shows handles', async () => {
    const net = offline();
    setScaleKitImporterForTests(net.importer);
    rig = await createRig();
    rig.layout('single');
    const services = rig.app.services as FakeServices;
    const control = rig.app.store.list('controls').find((c) => c.parent !== null) as { id: ControlId };
    rig.app.store.transact({ label: 'Keyable scale', undoable: false }, (tx) => {
      const record = tx.get('controls', control.id);
      if (record === undefined) throw new Error(`no control ${control.id}`);
      tx.patch('controls', control.id, { keyable: { ...record.keyable, s: [true, true, true] } });
    });
    rig.app.session.setState({ selection: { ...rig.app.session.getState().selection, controls: [control.id] } });

    chooseTool(rig, VIEWPORT_TOOL.scale);
    rig.frame();
    await flush();
    expect(net.calls()).toBe(1); // the tool and the manipulator share one load
    expect(failedToasts(services)).toBe(1);
    // Refreshes (selection changes, playback frames) do not load again.
    for (let i = 0; i < 20; i += 1) {
      rig.app.session.setState({
        selection: { ...rig.app.session.getState().selection, controls: i % 2 === 0 ? [] : [control.id] },
      });
      rig.frame();
    }
    await flush();
    expect(net.calls()).toBe(1);
    expect(failedToasts(services)).toBe(1);
    expect(rig.vm.manipulatorScreenPoint(PANE, 'suniform')).toBeNull();

    // A press with the tool tries again (and says so again when that fails too).
    const tool = rig.vm.activeTool();
    expect(tool?.pointerDown?.({} as ToolPointerEvent)).toBe(false);
    await flush();
    expect(net.calls()).toBe(2);
    expect(failedToasts(services)).toBe(2);

    // Back online: choosing R again loads the chunk and the handles show.
    setScaleKitImporterForTests(realKit);
    chooseTool(rig, VIEWPORT_TOOL.move);
    rig.frame();
    chooseTool(rig, VIEWPORT_TOOL.scale);
    rig.frame();
    await vi.waitFor(() => expect(scaleKit()).not.toBeNull());
    rig.frame();
    expect(rig.vm.manipulatorScreenPoint(PANE, 'suniform')).not.toBeNull();
    expect(failedToasts(services)).toBe(2);
  });
});
