// AUTORIG-SPEC §4.4 (D1): the handoff record's writer and the hand-over. The writer stores the live document — dirty
// or clean, whatever autosave does — with the assets the asset store has and the HandoffInfo, under a fresh UUID; the
// hand-over points the tab opened in the gesture (or this page) at the route with `handoff=<id>`.
import type { AutosaveStore, HandoffInfo } from '@ekza-studio/editor-core';
import { createFakeEditorApp } from '@ekza-studio/editor-core/testing';
import { describe, expect, it } from 'vitest';
import { handOver, writeHandoffRecord } from '../src/host/handoff';
import { createStore } from 'zustand/vanilla';
import type { MountedShell } from '../src/host/types';
import { readSynthetic } from './render';

type Written = Parameters<NonNullable<AutosaveStore['writeHandoff']>>;

function recordingStore(): { readonly store: AutosaveStore; readonly writes: Written[] } {
  const writes: Written[] = [];
  const store: AutosaveStore = {
    open: async () => 'as_0000000000000001',
    write: async () => ({ bytes: 0 }),
    listOrphans: async () => [],
    read: async () => null,
    remove: async () => {},
    writeHandoff: async (...args) => {
      writes.push(args);
      return { bytes: args[1].snapshotJson.length };
    },
  };
  return { store, writes };
}

const INFO: HandoffInfo = {
  route: 'studio',
  workspace: 'animate',
  subject: null,
  autorig: { step: 'animations', startPose: null },
  createdAt: 1_700_000_000_000,
};

describe('the handoff record (§4.4)', () => {
  it('writes the live document, clean or dirty, under a fresh UUID, never touching the slot', async () => {
    const { store, writes } = recordingStore();
    const snapshot = await readSynthetic('wave-doc.json');
    const app = createFakeEditorApp({ snapshot: snapshot as never, services: { autosave: store } });
    app.session.setState({ dirty: false });
    const id = await writeHandoffRecord(app, INFO);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(writes.length).toBe(1);
    const [writtenId, data] = writes[0] ?? [];
    expect(writtenId).toBe(id);
    expect(JSON.parse(data?.snapshotJson ?? '{}')).toEqual(JSON.parse(JSON.stringify(app.store.snapshot())));
    expect(data?.info).toEqual(INFO);
    // the fake asset store holds none of the wave document's models: none is listed
    expect(data?.assets).toEqual([]);
    expect(data?.blobs).toEqual([]);
    const second = await writeHandoffRecord(app, INFO);
    expect(second).not.toBe(id);
  });

  it('hands over to the tab opened in the gesture, or to this page', async () => {
    const { store, writes } = recordingStore();
    const app = createFakeEditorApp({ services: { autosave: store } });
    const mounted = createStore<MountedShell | null>()(() => ({
      kind: 'autorig',
      handoffState: () => ({ step: 'export', startPose: { armAngle: 0.6, kind: 'a' } }),
    }));
    const tab = { location: { href: 'about:blank' }, close: () => {} } as unknown as Window;
    await handOver({ app, mounted }, { to: 'studio', workspace: 'rig' }, '/editor?e2e=1&ws=rig', tab);
    const id = writes[0]?.[0] ?? '';
    expect(tab.location.href).toBe(`/editor?e2e=1&ws=rig&handoff=${id}`);
    expect(writes[0]?.[1].info).toMatchObject({
      route: 'studio',
      workspace: 'rig',
      autorig: { step: 'export', startPose: { armAngle: 0.6, kind: 'a' } },
    });
    const assigned: string[] = [];
    await handOver({ app, mounted }, { to: 'autorig' }, '/autorig', null, {
      assign: (url) => void assigned.push(String(url)),
    });
    expect(assigned).toEqual([`/autorig?handoff=${writes[1]?.[0] ?? ''}`]);
  });
});
