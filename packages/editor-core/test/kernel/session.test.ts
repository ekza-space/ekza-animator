import type { ClipId, ClipRecord, KeyId, UserId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  activeClip,
  activeClipFrame,
  activeRuntime,
  defaultSession,
  restoreSelection,
  type Selection,
  selectionSnapshot,
} from '../../src';
import { createFakeEditorApp } from '../../src/testing';
import { edit, kernelApp, SECOND, setFrame, twoCharacterDoc, W, waveApp, waveDoc } from './support';

describe('defaultSession', () => {
  it('documents every default (§4.5)', () => {
    const session = defaultSession();
    expect(session).toMatchObject({
      user: 'local',
      projectName: 'Untitled',
      dirty: false,
      activeCharacter: null,
      activeClip: {},
      selection: { controls: [], channels: [] },
      time: {
        sceneFrame: 0,
        playing: false,
        direction: 1,
        loop: 'loop',
        speed: 'realtime',
        playbackRange: null,
        snapToFrames: true,
        band: null,
      },
      tools: {
        viewport: 'select',
        graph: 'select',
        manipulatorSize: 90,
        selectionMask: { controls: true, joints: false, meshes: false, groups: false },
        keyTarget: 'selected',
      },
      showSecondary: false,
      viewportLayout: 'split',
      maximizedPane: null,
      hoveredPanel: null,
      clipboard: { pose: null, keys: null },
      feetPins: null,
      dialog: null,
      busy: null,
    });
    expect(session.selection.keys.size).toBe(0);
    expect(session.overrides.size).toBe(0);
    expect(session.hiddenControls.size).toBe(0);
    expect(defaultSession('alice' as UserId).user).toBe('alice');
  });
});

describe('session and document', () => {
  it("opens a document with its project name, first character and every character's first clip active", () => {
    const app = kernelApp({ snapshot: twoCharacterDoc() });
    expect(app.session.getState()).toMatchObject({
      projectName: 'Wave (synthetic)',
      activeCharacter: W.character,
      activeClip: { [W.character]: W.clip, [SECOND.character]: SECOND.clip },
      dirty: false,
    });
    expect(activeClip(app)?.id).toBe(W.clip);
    expect(activeRuntime(app)?.id).toBe(W.character);
    expect(activeClipFrame(app)).toBe(0);
    const empty = createFakeEditorApp();
    expect(activeClip(empty)).toBeNull();
    expect(activeRuntime(empty)).toBeNull();
    expect(activeClipFrame(empty)).toBeNull();
  });

  it('tracks unsaved changes: commits set dirty, previews do not, a load clears it', () => {
    const app = waveApp();
    const preview = app.store.beginPreview('Drag');
    preview.update((tx) => tx.patch('clips', W.clip, { name: 'x' }));
    expect(app.session.getState().dirty).toBe(false);
    preview.cancel();
    edit(app, 'Rename', (tx) => tx.patch('clips', W.clip, { name: 'y' }));
    expect(app.session.getState().dirty).toBe(true);
    app.session.setState({ projectName: 'other' });
    app.store.load(waveDoc());
    expect(app.session.getState()).toMatchObject({ dirty: false, projectName: 'Wave (synthetic)' });
  });

  it('repairs active character and clips after deletions and undo', () => {
    const app = kernelApp({ snapshot: twoCharacterDoc() });
    const other = 'clp_OtherClip0000001' as ClipId;
    edit(app, 'New Clip', (tx) =>
      tx.put('clips', { ...(tx.get('clips', W.clip) as ClipRecord), id: other, name: 'other', order: 'a1' }),
    );
    edit(app, 'Delete Clip', (tx) => tx.softDelete('clips', W.clip));
    expect(app.session.getState().activeClip[W.character]).toBe(other);
    edit(app, 'Delete Clip', (tx) => tx.softDelete('clips', other));
    expect(app.session.getState().activeClip[W.character]).toBeUndefined();
    app.history.undo();
    expect(app.session.getState().activeClip[W.character]).toBe(other);
    edit(app, 'Delete Character', (tx) => tx.softDelete('characters', W.character));
    expect(app.session.getState().activeCharacter).toBe(SECOND.character);
    expect(Object.keys(app.session.getState().activeClip)).toEqual([SECOND.character]);
    edit(app, 'Delete Character', (tx) => tx.softDelete('characters', SECOND.character));
    expect(app.session.getState().activeCharacter).toBeNull();
    app.history.undo();
    expect(app.session.getState().activeCharacter).toBe(SECOND.character);
  });

  it('prunes selection, overrides and feet pins of deleted records', () => {
    const app = waveApp();
    setFrame(app, 3);
    app.session.setState({
      selection: {
        controls: [W.lowerArmL, W.handL],
        keys: new Map([[W.keys[1], { key: true, in: false, out: false }]]),
        channels: [{ control: W.handL, channel: 'rz' }],
        objects: [],
      },
      overrides: new Map([[W.handL, { rz: 1 }]]),
      feetPins: { character: W.character, pins: [] },
    });
    edit(app, 'Delete', (tx) => {
      tx.remove('keys', W.keys[1]);
      tx.softDelete('controls', W.handL);
    });
    const state = app.session.getState();
    expect(state.selection.controls).toEqual([W.lowerArmL]);
    expect(state.selection.keys.size).toBe(0);
    expect(state.selection.channels).toEqual([]);
    expect(state.overrides.size).toBe(0);
    expect(state.feetPins).not.toBeNull();
    edit(app, 'Delete', (tx) => tx.softDelete('characters', W.character));
    expect(app.session.getState().feetPins).toBeNull();
  });

  it("drops a character's overrides when its clip frame moves, not when it holds", () => {
    const app = kernelApp({ snapshot: twoCharacterDoc({ second: { loop: false } }) });
    setFrame(app, 40); // first wraps to 10, second holds 30
    app.session.setState({
      overrides: new Map([
        [W.lowerArmL, { rz: 1 }],
        [SECOND.lowerArmL, { rz: 2 }],
      ]),
    });
    setFrame(app, 45);
    expect([...app.session.getState().overrides.keys()]).toEqual([SECOND.lowerArmL]);
    // Clip settings that move the frame drop overrides too.
    edit(app, 'Scene Start', (tx) => tx.patch('clips', SECOND.clip, { sceneStart: 30 }));
    expect(app.session.getState().overrides.size).toBe(0);
  });
});

describe('selection snapshots', () => {
  const selection: Selection = {
    controls: [W.lowerArmL, W.handL],
    keys: new Map([[W.keys[0], { key: true, in: false, out: true }]]),
    channels: [{ control: W.lowerArmL, channel: 'rz' }],
    objects: [],
  };

  it('round-trips through JSON and restores into the session', () => {
    const app = waveApp();
    const snapshot = JSON.parse(JSON.stringify(selectionSnapshot(selection))) as unknown;
    restoreSelection(app, snapshot);
    expect(app.session.getState().selection).toEqual(selection);
  });

  it('drops ids that no longer exist and ignores malformed snapshots', () => {
    const app = waveApp();
    const snapshot = selectionSnapshot({
      ...selection,
      controls: [...selection.controls, 'rig_X:gone' as typeof W.handL],
      keys: new Map([...selection.keys, ['k_Gone00000000' as KeyId, { key: true, in: false, out: false }]]),
    });
    restoreSelection(app, snapshot);
    expect(app.session.getState().selection).toEqual(selection);
    for (const bad of [
      null,
      1,
      'x',
      { kind: 'other' },
      { kind: 'ekza.selection', controls: 'x', keys: [], channels: [] },
    ]) {
      restoreSelection(app, bad);
      expect(app.session.getState().selection).toEqual(selection);
    }
    restoreSelection(app, {
      kind: 'ekza.selection',
      controls: [1, W.lowerArmL],
      keys: [['k', null], 'x'],
      channels: [{}, null],
    });
    expect(app.session.getState().selection).toEqual({
      controls: [W.lowerArmL],
      keys: new Map(),
      channels: [],
      objects: [],
    });
  });
});
