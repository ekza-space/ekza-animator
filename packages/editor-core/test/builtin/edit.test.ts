// Edit operators (MVP-SPEC §4.9 `edit.*`): undo/redo through the editor history (document and override steps), the
// copy/paste/delete dispatchers by panel, and Esc (gesture, preview, dialog, playback).
import { describe, expect, it } from 'vitest';
import { beginChannelEditGesture } from '../../src';
import { docJson, opsApp, runOk, runResult, setSceneFrame, WAVE } from './support';

describe('edit.undo / edit.redo', () => {
  it('undo and redo document steps and override steps; nothing to undo is refused', async () => {
    const app = opsApp();
    expect(await runResult(app, 'edit.undo')).toEqual({ status: 'cancelled', reason: 'Nothing to undo' });
    expect(await runResult(app, 'edit.redo')).toEqual({ status: 'cancelled', reason: 'Nothing to redo' });
    const before = docJson(app);
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.lowerArmL] } });
    setSceneFrame(app, 5);
    await runOk(app, 'key.set');
    const keyed = docJson(app);
    await runOk(app, 'channel.setValues', { edits: [{ control: WAVE.lowerArmL, channel: 'rz', value: 0.3 }] });
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 0.3 });
    const undone = (await runOk(app, 'edit.undo')) as { label: string };
    expect(undone.label).toBe('Set Value');
    expect(app.session.getState().overrides.size).toBe(0);
    expect(docJson(app)).toEqual(keyed);
    await runOk(app, 'edit.undo');
    expect(docJson(app)).toEqual(before);
    await runOk(app, 'edit.redo');
    expect(docJson(app)).toEqual(keyed);
    await runOk(app, 'edit.redo');
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 0.3 });
    expect(app.history.canRedo()).toBe(false);
  });

  it('restores the selection of the undone step', async () => {
    const app = opsApp();
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.cog] } });
    await runOk(app, 'key.set');
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [] } });
    await runOk(app, 'edit.undo');
    expect(app.session.getState().selection.controls).toEqual([WAVE.cog]);
  });
});

describe('edit.copy / edit.paste / edit.delete', () => {
  it('forward to the pose operators in the viewport and to the key operators in the Graph Editor', async () => {
    const app = opsApp();
    app.session.setState({ selection: { ...app.session.getState().selection, controls: [WAVE.lowerArmL] } });
    setSceneFrame(app, 15);
    await app.runUntyped('edit.delete', undefined, { panel: 'channelBox' });
    expect(app.store.get('keys', WAVE.keys[1])).toBeUndefined();
    await app.runUntyped('select.keys', { items: [{ key: WAVE.keys[0] }], mode: 'replace' });
    await app.runUntyped('edit.copy', undefined, { panel: 'graph' });
    await app.runUntyped('edit.delete', undefined, { panel: 'timeline' });
    const ids = app.calls.map((call) => call.id);
    expect(ids).toContain('key.deleteAtFrame');
    expect(ids).toContain('graph.keys.copy');
    expect(ids).toContain('graph.keys.delete');
    expect(app.store.get('keys', WAVE.keys[0])).toBeUndefined();
    expect(app.session.getState().clipboard.keys?.curves[0]?.keys).toHaveLength(1);
  });

  it('follow the panel under the pointer without a run context', async () => {
    const app = opsApp();
    app.session.setState({ hoveredPanel: { kind: 'graph', paneId: null } });
    await app.runUntyped('select.keys', { items: [{ key: WAVE.keys[1] }], mode: 'replace' });
    await runOk(app, 'edit.copy');
    expect(app.calls.at(-1)?.id).toBe('graph.keys.copy');
  });

  it('are refused when their target is, and fail like it', async () => {
    const app = opsApp();
    // Graph paste without copied keys: refused by the target's poll.
    expect((await app.runUntyped('edit.paste', undefined, { panel: 'graph' })).status).toBe('cancelled');
  });
});

describe('edit.escape', () => {
  it('cancels a channel-edit gesture in progress and restores the overrides', async () => {
    const app = opsApp();
    const gesture = beginChannelEditGesture(app, 'Rotate', { key: 'auto' });
    gesture.update([{ control: WAVE.lowerArmL, channel: 'rz', value: 1 }]);
    expect(app.session.getState().overrides.get(WAVE.lowerArmL)).toEqual({ rz: 1 });
    expect((await app.runUntyped('edit.escape')).status).toBe('finished');
    expect(gesture.active).toBe(false);
    expect(app.store.preview).toBeNull();
    expect(app.session.getState().overrides.size).toBe(0);
    expect(app.history.canUndo()).toBe(false);
  });

  it('cancels another preview; else closes the dialog; else stops playback', async () => {
    const app = opsApp();
    const preview = app.store.beginPreview('Drag Keys');
    preview.update((tx) => {
      const key = tx.get('keys', WAVE.keys[1]);
      if (key !== undefined) tx.put('keys', { ...key, v: 1 });
    });
    await runOk(app, 'edit.escape');
    expect(preview.active).toBe(false);
    expect(app.store.get('keys', WAVE.keys[1])?.v).not.toBe(1);
    app.session.setState({ dialog: 'export', time: { ...app.session.getState().time, playing: true } });
    await runOk(app, 'edit.escape');
    expect(app.session.getState().dialog).toBeNull();
    expect(app.session.getState().time.playing).toBe(true);
    await runOk(app, 'edit.escape');
    expect(app.session.getState().time.playing).toBe(false);
  });
});
