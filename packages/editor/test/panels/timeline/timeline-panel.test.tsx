// The Timeline panel in Vitest browser mode over the fake app (MVP-SPEC §7 WP-6t): registration, the time-slider
// canvas wiring, frame field, clip and fps controls, transport, range slider, RMB menu and per-frame rendering.
import type { ClipId, ClipRecord } from '@ekza-animator/doc';
import { act, Profiler } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanelRegistry, EditorAppProvider, registerBuiltinPanels } from '../../../src';
import {
  focusedTimeSlider,
  registerTimelinePanel,
  screenOfTimelineFrame,
  screenOfTimelineTick,
} from '../../../src/panels/timeline';
import { TimelinePanel } from '../../../src/panels/timeline/TimelinePanel';
import { PanelHarness } from '../../../src/testing';
import { readSynthetic, render } from '../../render';
import {
  callsOf,
  chooseOption,
  click,
  frames,
  type PanelView,
  patchClip,
  pointerAt,
  renderPanel,
  setTime,
  settle,
  stubOperator,
  typeAndEnter,
  typeInto,
  WAVE_CLIP,
  waveApp,
} from './fixture';

let view: PanelView | null = null;
afterEach(async () => {
  await view?.unmount();
  view?.app.dispose();
  view = null;
});

async function mountPanel(width?: number): Promise<PanelView> {
  view = await renderPanel(await waveApp(), width);
  return view;
}

const sliderOf = (v: PanelView) => {
  const surface = focusedTimeSlider(v.app);
  if (surface === null) throw new Error('no time slider mounted');
  return surface;
};

describe('registerTimelinePanel', () => {
  it('registers the timeline panel in the timeline key scope, also through registerBuiltinPanels', () => {
    const registry = createPanelRegistry();
    const dispose = registerTimelinePanel(registry);
    expect(registry.get('timeline')).toMatchObject({ kind: 'timeline', keyScope: 'timeline', title: 'Time Slider' });
    dispose();
    expect(registry.get('timeline')).toBeUndefined();
    const all = createPanelRegistry();
    registerBuiltinPanels(all);
    expect(all.get('timeline')?.component).toBe(TimelinePanel);
  });

  it('mounts in the /dev/panels harness with the fake app', async () => {
    const harness = await render(
      <PanelHarness
        snapshot={await readSynthetic('wave-doc.json')}
        skeleton={await readSynthetic('humanoid-skeleton.json')}
        panel="timeline"
      />,
    );
    await frames(2);
    const canvas = harness.container.querySelector<HTMLCanvasElement>('[data-testid="timeline-canvas"]');
    expect(canvas?.width).toBeGreaterThan(100);
    expect(window.__EKZA_DEV_PANELS__?.app.operators.get('time.selectBand')).toBeDefined();
    await harness.unmount();
  });
});

describe('time slider canvas', () => {
  it('sizes the canvas to its box, registers time.selectBand while mounted and exposes screen points', async () => {
    const v = await mountPanel();
    const canvas = v.get('timeline-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    expect(canvas.width).toBe(Math.round(rect.width * devicePixelRatio));
    expect(canvas.height).toBe(Math.round(rect.height * devicePixelRatio));
    expect(v.app.operators.get('time.selectBand')).toBeDefined();
    expect(v.app.menus.list()).toHaveLength(10);

    const { slider } = sliderOf(v);
    const x = rect.left + slider.frameToX(15);
    expect(screenOfTimelineFrame(v.app, 15)).toEqual({ x, y: rect.top + rect.height / 2 });
    // Ticks fill the slider below its 12 px label strip.
    expect(screenOfTimelineTick(v.app, 15)).toEqual({ x, y: rect.top + (12 + rect.height) / 2 });
    expect(screenOfTimelineTick(v.app, 14)).toBeNull();

    await v.unmount();
    expect(v.app.operators.get('time.selectBand')).toBeUndefined();
    expect(v.app.menus.list()).toEqual([]);
    expect(focusedTimeSlider(v.app)).toBeNull();
    v.app.dispose();
    view = null;
  });

  it('turns pointer input into scrubbing and Shift band selection', async () => {
    const v = await mountPanel();
    const canvas = v.get('timeline-canvas');
    const at = (frame: number) => screenOfTimelineFrame(v.app, frame)!;
    pointerAt(canvas, 'pointerdown', at(7).x, at(7).y);
    pointerAt(canvas, 'pointermove', at(8.4).x, at(8).y);
    pointerAt(canvas, 'pointerup', at(8.4).x, at(8).y);
    await settle();
    expect(callsOf(v.app, 'time.setFrame')).toEqual([
      { frame: 7, unit: 'clip' },
      { frame: 8, unit: 'clip' },
    ]);

    pointerAt(canvas, 'pointerdown', at(10).x, at(10).y, { shiftKey: true });
    pointerAt(canvas, 'pointermove', at(20).x, at(20).y, { shiftKey: true });
    pointerAt(canvas, 'pointerup', at(20).x, at(20).y, { shiftKey: true });
    await settle();
    expect(v.app.session.getState().time.band).toEqual({ start: 10, end: 20 });
    expect([...v.app.session.getState().selection.keys.keys()]).toEqual(['k_SynthWave002']);
    expect(canvas.getAttribute('aria-valuenow')).toBe('0');
    setTime(v.app, { sceneFrame: 12 });
    expect(canvas.getAttribute('aria-valuenow')).toBe('12');
  });

  it('opens the band menu on right click and runs the chosen operator in the timeline scope', async () => {
    const v = await mountPanel();
    const canvas = v.get('timeline-canvas');
    stubOperator(v.app, 'graph.keys.delete');
    stubOperator(v.app, 'graph.tangent.set');
    stubOperator(v.app, 'graph.keys.paste', false);
    await act(async () => {
      await v.app.run('time.selectBand', { band: { start: 15, end: 15 } });
    });
    const point = screenOfTimelineFrame(v.app, 15)!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: point.x, clientY: point.y }));
    });
    expect(v.query('timeline-menu')).not.toBeNull();
    expect((v.get('timeline-menu-delete') as HTMLButtonElement).disabled).toBe(false);
    expect((v.get('timeline-menu-copy') as HTMLButtonElement).disabled).toBe(true); // not registered here
    expect((v.get('timeline-menu-paste') as HTMLButtonElement).disabled).toBe(true); // poll fails
    expect(v.query('timeline-menu-tangent-linear')).toBeNull();
    // ↓ walks the enabled items of the menu: Delete Keys (focused first) → Tangent → Select Band Keys.
    expect(document.activeElement).toBe(v.get('timeline-menu-delete'));
    await act(async () => {
      v.get('timeline-menu-delete').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement).toBe(v.get('timeline-menu-tangent'));
    await click(v.get('timeline-menu-tangent'));
    await click(v.get('timeline-menu-tangent-linear'));
    expect(v.query('timeline-menu')).toBeNull();
    expect(callsOf(v.app, 'graph.tangent.set')).toEqual([{ type: 'linear' }]);

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: point.x, clientY: point.y }));
    });
    await click(v.get('timeline-menu-delete'));
    expect(callsOf(v.app, 'graph.keys.delete')).toEqual([undefined]);

    await act(async () => {
      canvas.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: point.x, clientY: point.y }));
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(v.query('timeline-menu')).toBeNull();
  });

  it('commits no React render while the clock runs (frame field and readout are written directly)', async () => {
    const app = await waveApp();
    let commits = 0;
    const rendered = await render(
      <Profiler id="timeline" onRender={() => commits++}>
        <EditorAppProvider app={app}>
          <div style={{ width: 1000, height: 58 }}>
            <TimelinePanel app={app} instanceId="timeline#1" />
          </div>
        </EditorAppProvider>
      </Profiler>,
    );
    await frames(2);
    const before = commits;
    for (let frame = 1; frame <= 30; frame++) setTime(app, { sceneFrame: frame, playing: frame < 30 });
    await frames(1);
    // Only the play button flips back when playback stops at the end; no commit per frame.
    expect(commits - before).toBeLessThanOrEqual(2);
    const field = rendered.container.querySelector<HTMLInputElement>('[data-testid="timeline-frame-field"]');
    expect(field?.value).toBe('30');
    await rendered.unmount();
    app.dispose();
  });
});

describe('mounted sliders per app', () => {
  it('shares one registration between panels; the last one used is focused; the last unmount removes it', async () => {
    const app = await waveApp();
    const panel = (key: string) => (
      <div key={key} style={{ width: 800, height: 58 }}>
        <TimelinePanel app={app} instanceId={key} />
      </div>
    );
    const both = await render(
      <EditorAppProvider app={app}>
        {panel('a')}
        {panel('b')}
      </EditorAppProvider>,
    );
    await frames(2);
    const [first, second] = [...both.container.querySelectorAll<HTMLCanvasElement>('[data-testid="timeline-canvas"]')];
    expect(focusedTimeSlider(app)?.canvas).toBe(second);
    const at = first!.getBoundingClientRect();
    pointerAt(first!, 'pointerdown', at.left + 100, at.top + 10);
    pointerAt(first!, 'pointerup', at.left + 100, at.top + 10);
    expect(focusedTimeSlider(app)?.canvas).toBe(first);
    expect(app.operators.list().filter((op) => op.id === 'time.selectBand')).toHaveLength(1);

    await both.rerender(<EditorAppProvider app={app}>{panel('b')}</EditorAppProvider>);
    expect(focusedTimeSlider(app)?.canvas).toBe(second);
    expect(app.operators.get('time.selectBand')).toBeDefined();
    await both.unmount();
    expect(app.operators.get('time.selectBand')).toBeUndefined();
    app.dispose();
  });
});

describe('frame field and scene time', () => {
  it('follows the active clip frame and the scene clock (24 fps clip on the 30 fps scene clock)', async () => {
    const v = await mountPanel();
    const field = v.get('timeline-frame-field') as HTMLInputElement;
    expect(field.value).toBe('0');
    expect(v.get('timeline-scene-time').textContent).toBe('0.00 s');
    setTime(v.app, { sceneFrame: 15 });
    expect(field.value).toBe('15');
    expect(v.get('timeline-scene-time').textContent).toBe('0.50 s');
    patchClip(v.app, { fps: { num: 24, den: 1 } });
    setTime(v.app, { sceneFrame: 30 });
    expect(field.value).toBe('24');
    expect(v.get('timeline-scene-time').textContent).toBe('1.00 s');
  });

  it('runs time.setFrame with absolute and relative frames; arrows step', async () => {
    const v = await mountPanel();
    const field = v.get('timeline-frame-field');
    setTime(v.app, { sceneFrame: 15 });
    await typeAndEnter(field, '20');
    await typeAndEnter(field, '+5');
    await typeAndEnter(field, '-5');
    await typeAndEnter(field, '=-2');
    await typeAndEnter(field, 'abc');
    expect(callsOf(v.app, 'time.setFrame')).toEqual([20, 20, 10, -2].map((frame) => ({ frame, unit: 'clip' })));
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(callsOf(v.app, 'time.step')).toEqual([{ delta: 1 }]);
  });
});

describe('clip and fps controls', () => {
  function addClip(v: PanelView, id: string, name: string): void {
    const wave = v.app.store.get('clips', WAVE_CLIP) as ClipRecord;
    act(() => {
      v.app.store.transact({ label: 'New Clip' }, (tx) =>
        tx.put('clips', { ...wave, id: id as ClipId, name, order: 'a1' }),
      );
    });
  }

  it('lists the active character clips and switches with clip.setActive', async () => {
    const v = await mountPanel();
    const select = v.get('timeline-clip-select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['wave']);
    addClip(v, 'clp_SyntheticWave002', 'idle');
    expect([...select.options].map((o) => o.textContent)).toEqual(['wave', 'idle']);
    await chooseOption(select, 'clp_SyntheticWave002');
    expect(callsOf(v.app, 'clip.setActive')).toEqual([{ clip: 'clp_SyntheticWave002' }]);
  });

  it('asks keep-seconds or keep-frames before changing the frame rate', async () => {
    const v = await mountPanel();
    const fps = v.get('timeline-fps') as HTMLSelectElement;
    expect(fps.value).toBe('30');
    await chooseOption(fps, '24');
    const dialog = v.get('timeline-fps-dialog');
    expect(dialog.textContent).toContain('24 fps');
    // Rendered on document.body (outside the clipping dock), placed inside the viewport, focus on the first choice.
    expect(dialog.parentElement).toBe(document.body);
    expect(getComputedStyle(dialog).visibility).toBe('visible');
    expect(dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(document.activeElement).toBe(v.get('timeline-fps-keep-seconds'));
    await click(v.get('timeline-fps-keep-seconds'));
    expect(v.query('timeline-fps-dialog')).toBeNull();

    await chooseOption(fps, 'custom');
    await typeInto(v.get('timeline-fps-custom-input'), '29.97');
    await click(v.get('timeline-fps-custom-ok'));
    await click(v.get('timeline-fps-keep-frames'));

    await chooseOption(fps, '60');
    await click(v.get('timeline-fps-cancel'));
    await chooseOption(fps, '30'); // the current rate: nothing to ask
    expect(v.query('timeline-fps-dialog')).toBeNull();
    expect(callsOf(v.app, 'clip.setSettings')).toEqual([
      { clip: WAVE_CLIP, fps: { num: 24, den: 1 }, fpsMode: 'keep-seconds' },
      { clip: WAVE_CLIP, fps: { num: 30000, den: 1001 }, fpsMode: 'keep-frames' },
    ]);

    patchClip(v.app, { fps: { num: 30000, den: 1001 } });
    expect(fps.value).toBe('current');
    expect(fps.selectedOptions[0]?.textContent).toBe('29.97 fps');
  });

  it('closes the fps question on Escape', async () => {
    const v = await mountPanel();
    await chooseOption(v.get('timeline-fps'), '25');
    expect(v.query('timeline-fps-dialog')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(v.query('timeline-fps-dialog')).toBeNull();
    expect(callsOf(v.app, 'clip.setSettings')).toEqual([]);
  });
});

describe('transport, loop, speed and auto-key', () => {
  it('runs the playback operators; the button of the running direction stops', async () => {
    const v = await mountPanel();
    for (const id of [
      'timeline-start',
      'timeline-prev-key',
      'timeline-prev-frame',
      'timeline-play-back',
      'timeline-play',
      'timeline-next-frame',
      'timeline-next-key',
      'timeline-end',
    ]) {
      await click(v.get(id));
    }
    expect(v.app.calls.map((call) => [call.id, call.args])).toEqual([
      ['time.goToStart', undefined],
      ['time.prevKey', undefined],
      ['time.step', { delta: -1 }],
      ['time.play', { direction: -1 }],
      ['time.play', { direction: 1 }],
      ['time.step', { delta: 1 }],
      ['time.nextKey', undefined],
      ['time.goToEnd', undefined],
    ]);
    setTime(v.app, { playing: true, direction: 1 });
    const play = v.get('timeline-play');
    expect(play.getAttribute('aria-pressed')).toBe('true');
    expect(play.getAttribute('aria-label')).toBe('Stop');
    await click(play);
    await click(v.get('timeline-play-back'));
    expect(v.app.calls.slice(-2).map((call) => [call.id, call.args])).toEqual([
      ['time.stop', undefined],
      ['time.play', { direction: -1 }],
    ]);
  });

  it('cycles the loop mode, sets the speed and toggles auto-key', async () => {
    const v = await mountPanel();
    const loop = v.get('timeline-loop');
    expect(loop.dataset['mode']).toBe('loop');
    await click(loop);
    setTime(v.app, { loop: 'oscillate' });
    expect(loop.dataset['mode']).toBe('oscillate');
    await click(loop);
    await chooseOption(v.get('timeline-speed'), 'every-frame');
    const autoKey = v.get('timeline-autokey');
    expect(autoKey.getAttribute('aria-pressed')).toBe('false');
    await click(autoKey);
    act(() => v.app.prefs.setState({ autoKey: true }));
    expect(autoKey.getAttribute('aria-pressed')).toBe('true');
    expect(v.app.calls.map((call) => [call.id, call.args])).toEqual([
      ['time.setLoop', { loop: 'oscillate' }],
      ['time.setLoop', { loop: 'once' }],
      ['time.setSpeed', { speed: 'every-frame' }],
      ['key.toggleAutoKey', undefined],
    ]);
  });
});

describe('range slider', () => {
  it('edits the clip range (clip.setSettings) and the playback range (time.setPlaybackRange, scene frames)', async () => {
    const v = await mountPanel();
    const value = (id: string) => (v.get(id) as HTMLInputElement).value;
    expect(['clip-start', 'play-start', 'play-end', 'clip-end'].map((id) => value(`timeline-range-${id}`))).toEqual([
      '0',
      '0',
      '30',
      '30',
    ]);
    await typeAndEnter(v.get('timeline-range-clip-start'), '5');
    await typeAndEnter(v.get('timeline-range-clip-end'), '+30');
    expect(callsOf(v.app, 'clip.setSettings')).toEqual([
      { clip: WAVE_CLIP, range: { start: 5, end: 30 } },
      { clip: WAVE_CLIP, range: { start: 0, end: 60 } },
    ]);

    // A 24 fps clip starting at scene frame 6: clip frames 10–30 are scene frames 18.5–43.5.
    patchClip(v.app, { fps: { num: 24, den: 1 }, sceneStart: 6 });
    await typeAndEnter(v.get('timeline-range-play-start'), '10');
    await typeAndEnter(v.get('timeline-range-play-end'), '50'); // clamped to the clip end
    expect(callsOf(v.app, 'time.setPlaybackRange')).toEqual([
      { range: { start: 18.5, end: 43.5 } },
      { range: null }, // 0–30 is the whole clip
    ]);

    setTime(v.app, { playbackRange: { start: 18.5, end: 31 } });
    expect(value('timeline-range-play-start')).toBe('10');
    expect(value('timeline-range-play-end')).toBe('20');
  });

  it('drags the playback range ends and middle on the bar; double-click restores the whole clip', async () => {
    const v = await mountPanel();
    const bar = v.get('timeline-range-bar');
    const rect = bar.getBoundingClientRect();
    const xOf = (frame: number) => rect.left + (frame / 30) * rect.width;
    const y = rect.top + rect.height / 2;

    pointerAt(bar, 'pointerdown', xOf(30) - 2, y);
    pointerAt(bar, 'pointermove', xOf(20), y);
    pointerAt(bar, 'pointerup', xOf(20), y);
    await settle();
    expect(callsOf(v.app, 'time.setPlaybackRange').at(-1)).toEqual({ range: { start: 0, end: 20 } });

    setTime(v.app, { playbackRange: { start: 0, end: 20 } });
    pointerAt(bar, 'pointerdown', xOf(10), y);
    pointerAt(bar, 'pointermove', xOf(15), y);
    pointerAt(bar, 'pointermove', xOf(40), y); // the range stays inside the clip
    pointerAt(bar, 'pointerup', xOf(40), y);
    await settle();
    expect(callsOf(v.app, 'time.setPlaybackRange').at(-1)).toEqual({ range: { start: 10, end: 30 } });

    setTime(v.app, { playbackRange: { start: 10, end: 30 } });
    await act(async () => {
      bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await settle();
    expect(callsOf(v.app, 'time.setPlaybackRange').at(-1)).toEqual({ range: null });
  });
});
