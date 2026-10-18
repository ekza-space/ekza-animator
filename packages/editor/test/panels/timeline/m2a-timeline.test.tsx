// M2A-SPEC §5.9 (A3) in the Timeline panel: an MMB press scrubs with carry, the arrows nudge selected keys (else
// they step the time), the RMB menu's Ripple Edit is a checkbox item, and the panel's probe answers `timelineTicks`
// and `screenOfBand` (§4.8).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { screenOfTimelineBand, screenOfTimelineFrame, timelineTicksOf } from '../../../src/panels/timeline';
import { callsOf, click, type PanelView, pointerAt, renderPanel, settle, stubOperator, waveApp } from './fixture';

let view: PanelView | null = null;
afterEach(async () => {
  await view?.unmount();
  view?.app.dispose();
  view = null;
});

async function mountPanel(): Promise<PanelView> {
  view = await renderPanel(await waveApp());
  return view;
}

describe('time slider canvas (M2a)', () => {
  it('an MMB drag scrubs with carry', async () => {
    const v = await mountPanel();
    const canvas = v.get('timeline-canvas');
    const at = (frame: number) => screenOfTimelineFrame(v.app, frame)!;
    pointerAt(canvas, 'pointerdown', at(4).x, at(4).y, { button: 1, buttons: 4 });
    pointerAt(canvas, 'pointermove', at(9).x, at(9).y, { buttons: 4 });
    pointerAt(canvas, 'pointerup', at(9).x, at(9).y, { button: 1 });
    await settle();
    expect(callsOf(v.app, 'time.setFrame')).toEqual([
      { frame: 4, unit: 'clip', carry: true },
      { frame: 9, unit: 'clip', carry: true },
    ]);
  });

  it('the arrows nudge the selected keys (graph.keys.move in the timeline scope), else step the time', async () => {
    const v = await mountPanel();
    const canvas = v.get('timeline-canvas');
    const press = async (key: string): Promise<void> => {
      await act(async () => {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
      await settle();
    };
    // graph.keys.move polls false without selected keys (the stub stands in for it).
    let keysSelected = false;
    v.app.contribute({
      kind: 'operator',
      def: {
        id: 'graph.keys.move',
        label: 'Move Keys',
        category: 'test',
        scope: 'global',
        poll: () => (keysSelected ? true : { ok: false, reason: 'No keys are selected' }),
        apply: () => undefined,
      },
    });
    await press('ArrowRight');
    expect(callsOf(v.app, 'time.step')).toEqual([{ delta: 1 }]);
    expect(callsOf(v.app, 'graph.keys.move')).toEqual([]);
    keysSelected = true;
    await press('ArrowLeft');
    expect(callsOf(v.app, 'graph.keys.move')).toEqual([{ dFrames: -1, dValue: 0 }]);
    expect(callsOf(v.app, 'time.step')).toEqual([{ delta: 1 }]);
  });

  it('Ripple Edit is a checkbox item of the RMB menu', async () => {
    const v = await mountPanel();
    stubOperator(v.app, 'key.toggleRipple');
    const point = screenOfTimelineFrame(v.app, 15)!;
    const open = async (): Promise<void> => {
      await act(async () => {
        v.get('timeline-canvas').dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, clientX: point.x, clientY: point.y }),
        );
      });
    };
    await open();
    const item = v.get('timeline-menu-ripple');
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('false');
    expect(v.query('timeline-menu-insert-frame')).not.toBeNull();
    expect(v.query('timeline-menu-remove-frame')).not.toBeNull();
    expect(v.query('timeline-menu-delete-time')).not.toBeNull();
    await click(item);
    expect(callsOf(v.app, 'key.toggleRipple')).toEqual([undefined]);
    act(() => {
      const state = v.app.session.getState();
      v.app.session.setState({ tools: { ...state.tools, ripple: true } });
    });
    await open();
    expect(v.get('timeline-menu-ripple').getAttribute('aria-checked')).toBe('true');
  });

  // Acceptance fix round 1, bug 11: a refused item (Remove Frame with a key on the next frame) was only disabled;
  // the poll's reason is its tooltip now, as in the menu bar.
  it('a disabled item says why in its tooltip; enabled items have none', async () => {
    const v = await mountPanel();
    v.app.contribute({
      kind: 'operator',
      def: {
        id: 'time.insertTime',
        label: 'Insert Time',
        category: 'test',
        scope: 'global',
        // Remove Frame is time.insertTime {frames: −1}: refused with the key it would delete.
        poll: (_ctx, args) =>
          (args as { frames?: number } | undefined)?.frames === -1
            ? { ok: false, reason: 'A key at frame 11 would be deleted: use Delete Time' }
            : true,
        apply: () => undefined,
      },
    });
    const point = screenOfTimelineFrame(v.app, 15)!;
    await act(async () => {
      v.get('timeline-canvas').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: point.x, clientY: point.y }),
      );
    });
    const remove = v.get('timeline-menu-remove-frame') as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.title).toBe('A key at frame 11 would be deleted: use Delete Time');
    const insert = v.get('timeline-menu-insert-frame') as HTMLButtonElement;
    expect(insert.disabled).toBe(false);
    expect(insert.hasAttribute('title')).toBe(false);
  });

  it('exposes key ticks and band grab points for the test API', async () => {
    const v = await mountPanel();
    expect(timelineTicksOf(v.app)).toEqual([
      { frame: 0, breakdown: false, selected: false },
      { frame: 15, breakdown: false, selected: false },
      { frame: 30, breakdown: false, selected: false },
    ]);
    expect(screenOfTimelineBand(v.app, 'middle')).toBeNull();
    await act(async () => {
      await v.app.run('time.selectBand', { band: { start: 10, end: 20 } });
    });
    const canvas = v.get('timeline-canvas').getBoundingClientRect();
    const start = screenOfTimelineBand(v.app, 'start')!;
    const end = screenOfTimelineBand(v.app, 'end')!;
    const middle = screenOfTimelineBand(v.app, 'middle')!;
    expect(start.x).toBeLessThan(middle.x);
    expect(middle.x).toBeLessThan(end.x);
    expect(middle.x).toBeCloseTo(screenOfTimelineFrame(v.app, 15)!.x, 6);
    expect(start.y).toBeGreaterThan(canvas.top);
    expect(start.y).toBeLessThan(canvas.bottom);
  });
});
