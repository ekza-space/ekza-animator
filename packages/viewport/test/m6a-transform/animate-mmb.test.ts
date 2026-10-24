// B12a (M6A-SPEC §5.15): the MMB rule in Animate — with channels selected in the Channels panel the viewport's virtual
// slider takes the MMB drag (shipped M2a); without them the Move/Rotate tools transform the selected controls through
// the same channel-edit gesture as a handle drag (one gesture, one commit): in the view plane / about the view axis, or
// along the last-picked handle (a LMB press-release on a handle picks it; a tool switch clears it).
import type { ChannelId, ControlId, ControlRecord } from '@ekza-studio/doc';
import type { ChannelEdit } from '@ekza-studio/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { type GestureFactory, moveToolDef, rotateToolDef } from '../../src/tools/transformTool';
import { createRig, drag, pointer, type Rig } from '../helpers';

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

interface Recorder {
  labels: string[];
  updates: (readonly ChannelEdit[])[];
  commits: number;
}

async function recordingRig(): Promise<{ readonly rig: Rig; readonly rec: Recorder }> {
  const r = await createRig({ contributions: false });
  const rec: Recorder = { labels: [], updates: [], commits: 0 };
  const factory: GestureFactory = (_app, label) => {
    rec.labels.push(label);
    const gesture = {
      active: true,
      update: (edits: readonly ChannelEdit[]) => {
        rec.updates.push(edits);
      },
      commit: () => {
        gesture.active = false;
        rec.commits++;
      },
      cancel: () => {
        gesture.active = false;
      },
    };
    return gesture;
  };
  r.app.contribute({ kind: 'tool', def: moveToolDef(factory) });
  r.app.contribute({ kind: 'tool', def: rotateToolDef(factory) });
  r.layout('split', {
    camera: (id) => (id === 'pane-right' ? { kind: 'view', preset: 'front' } : { kind: 'view', preset: 'persp' }),
  });
  return { rig: r, rec };
}

function control(r: Rig, key: string): ControlRecord {
  const record = r.app.store.list('controls').find((c) => c.key === key);
  if (record === undefined) throw new Error(`no control ${key}`);
  return record;
}

function setup(r: Rig, id: ControlId, tool: 'move' | 'rotate', channels: readonly ChannelId[] = []): void {
  const state = r.app.session.getState();
  r.app.session.setState({
    selection: {
      controls: [id],
      keys: new Map(),
      channels: channels.map((channel) => ({ control: id, channel })),
      objects: [],
      joints: [],
      constraints: [],
    },
    tools: { ...state.tools, viewport: tool },
  });
  r.app.prefs.setState({ moveSpace: 'world' });
  r.frame();
}

const last = (rec: Recorder): Record<string, number> =>
  Object.fromEntries((rec.updates.at(-1) ?? []).map((edit) => [edit.channel, edit.value]));

function pane(r: Rig): HTMLElement {
  return r.panes.get('pane-right') as HTMLElement;
}

function pageOf(r: Rig, handle: string): { x: number; y: number } {
  const p = r.vm.manipulatorScreenPoint('pane-right', handle as never);
  if (p === null) throw new Error(`no ${handle}`);
  const rect = pane(r).getBoundingClientRect();
  return { x: rect.left + p.x, y: rect.top + p.y };
}

describe('the MMB rule in Animate (§5.15)', () => {
  it('moves the selected control in the view plane, then along the last-picked handle', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    const cog = control(r, 'cog');
    setup(r, cog.id, 'move');
    const start = r.app.evaluation.channelValues(cog.id);
    const rect = pane(r).getBoundingClientRect();
    const from = { x: rect.left + 80, y: rect.top + 80 };
    drag(pane(r), from, { x: from.x + 30, y: from.y + 20 }, { button: 1 }, 3);
    expect([rec.labels, rec.commits]).toEqual([['Move'], 1]);
    const free = last(rec);
    expect(Math.abs((free['tx'] ?? 0) - start.tx)).toBeGreaterThan(1e-3);
    expect(Math.abs((free['ty'] ?? 0) - start.ty)).toBeGreaterThan(1e-3);
    expect(free['tz']).toBeCloseTo(start.tz, 9); // the front view's plane
    // A LMB press-release on tx picks it.
    const tx = pageOf(r, 'tx');
    pointer(pane(r), 'pointerdown', tx.x, tx.y);
    pointer(pane(r), 'pointerup', tx.x, tx.y);
    expect(r.app.session.getState().model.tweakHandle).toBe('tx');
    expect(rec.commits).toBe(1);
    drag(pane(r), from, { x: from.x + 30, y: from.y + 20 }, { button: 1 }, 3);
    expect(rec.commits).toBe(2);
    const along = last(rec);
    expect(Math.abs((along['tx'] ?? 0) - start.tx)).toBeGreaterThan(1e-3);
    expect(along['ty']).toBeCloseTo(start.ty, 9);
    expect(along['tz']).toBeCloseTo(start.tz, 9);
  });

  it('a tool switch forgets the picked handle; the Rotate tool turns about the view axis', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    const cog = control(r, 'cog');
    setup(r, cog.id, 'move');
    const tx = pageOf(r, 'tx');
    pointer(pane(r), 'pointerdown', tx.x, tx.y);
    pointer(pane(r), 'pointerup', tx.x, tx.y);
    expect(r.app.session.getState().model.tweakHandle).toBe('tx');
    setup(r, cog.id, 'rotate');
    r.vm.activeTool(); // the viewport activates the new tool
    expect(r.app.session.getState().model.tweakHandle).toBeNull();
    const rect = pane(r).getBoundingClientRect();
    const from = { x: rect.left + 80, y: rect.top + 80 };
    drag(pane(r), from, { x: from.x + 40, y: from.y }, { button: 1 }, 3);
    expect([rec.labels.at(-1), rec.commits]).toEqual(['Rotate', 1]);
    expect(Object.keys(last(rec)).sort()).toEqual(['rx', 'ry', 'rz']);
  });

  it('with channels selected the virtual slider takes the drag (the tool opens no gesture)', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    const cog = control(r, 'cog');
    setup(r, cog.id, 'move', ['ty']);
    const rect = pane(r).getBoundingClientRect();
    const from = { x: rect.left + 80, y: rect.top + 80 };
    drag(pane(r), from, { x: from.x + 30, y: from.y }, { button: 1 }, 3);
    expect(rec.labels).toEqual([]);
    expect(rec.commits).toBe(0);
  });
});
