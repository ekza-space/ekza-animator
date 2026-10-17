import type { ClipId, ControlId, DocSnapshot, KeyId } from '@ekza-animator/doc';
import type { EditorApp, SessionState } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { Component, type JSX, type ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { EditorAppProvider, useDocQuery, useEditorApp, usePrefs, useSession } from '../src';
import { byTestId, readSynthetic, render, update } from './render';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
  skeleton = (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc;
});

const CLIP = 'clp_SyntheticWave001' as ClipId;
const KEY = 'k_SynthWave001' as KeyId;
const LOWER_ARM = 'rig_SyntheticWave001:fk.lowerArm.L' as ControlId;

function setTime(app: EditorApp, patch: Partial<SessionState['time']>): void {
  app.session.setState({ time: { ...app.session.getState().time, ...patch } });
}

class Catch extends Component<{ readonly children: ReactNode }, { readonly error: unknown }> {
  override state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown): { readonly error: unknown } {
    return { error };
  }
  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return <p data-testid="caught">{error instanceof Error ? error.message : 'unknown error'}</p>;
  }
}

describe('editor hooks over the fake app', () => {
  let app: FakeEditorApp;
  beforeAll(() => {
    app = createFakeEditorApp({ snapshot, skeleton });
  });

  it('useEditorApp returns the provided app and throws outside a provider', async () => {
    function Probe(props: { readonly expected: EditorApp }): JSX.Element {
      return <output data-testid="probe">{useEditorApp() === props.expected ? 'provided app' : 'other app'}</output>;
    }
    const inside = await render(
      <EditorAppProvider app={app}>
        <Probe expected={app} />
      </EditorAppProvider>,
    );
    expect(byTestId(inside.container, 'probe').textContent).toBe('provided app');
    await inside.unmount();

    const restore = console.error;
    console.error = () => {}; // React reports the caught render error
    try {
      const outside = await render(
        <Catch>
          <Probe expected={app} />
        </Catch>,
      );
      expect(byTestId(outside.container, 'caught').textContent).toContain('EditorAppProvider');
      await outside.unmount();
    } finally {
      console.error = restore;
    }
  });

  it('useSession re-renders only when the selected value changes', async () => {
    const fresh = createFakeEditorApp({ snapshot, skeleton });
    let renders = 0;
    function Frame(): JSX.Element {
      renders++;
      const frame = useSession((s) => s.time.sceneFrame);
      return <output data-testid="frame">{frame}</output>;
    }
    const view = await render(
      <EditorAppProvider app={fresh}>
        <Frame />
      </EditorAppProvider>,
    );
    expect(byTestId(view.container, 'frame').textContent).toBe('0');
    const initial = renders;
    await update(() => setTime(fresh, { sceneFrame: 7 }));
    expect(byTestId(view.container, 'frame').textContent).toBe('7');
    expect(renders).toBe(initial + 1);
    await update(() => fresh.session.setState({ dialog: 'about' }));
    await update(() => setTime(fresh, { playing: true }));
    expect(renders).toBe(initial + 1);
    await view.unmount();
  });

  it('useSession keeps the identity of equal values under a custom equality', async () => {
    const fresh = createFakeEditorApp({ snapshot, skeleton });
    const seen: (readonly ControlId[])[] = [];
    const sameList = (a: readonly ControlId[], b: readonly ControlId[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);
    function Selected(): null {
      seen.push(useSession((s) => [...s.selection.controls], sameList));
      return null;
    }
    const view = await render(
      <EditorAppProvider app={fresh}>
        <Selected />
      </EditorAppProvider>,
    );
    const select = (controls: readonly ControlId[]) =>
      update(() => fresh.session.setState({ selection: { ...fresh.session.getState().selection, controls } }));
    await select([LOWER_ARM]);
    const count = seen.length;
    await select([LOWER_ARM]); // new array, same content: no re-render
    expect(seen.length).toBe(count);
    expect(seen.at(-1)).toEqual([LOWER_ARM]);
    await view.unmount();
  });

  it('usePrefs follows preference changes', async () => {
    const fresh = createFakeEditorApp();
    function AutoKey(): JSX.Element {
      return <output data-testid="autokey">{usePrefs((p) => (p.autoKey ? 'on' : 'off'))}</output>;
    }
    const view = await render(
      <EditorAppProvider app={fresh}>
        <AutoKey />
      </EditorAppProvider>,
    );
    expect(byTestId(view.container, 'autokey').textContent).toBe('off');
    await update(() => fresh.prefs.setState({ autoKey: true }));
    expect(byTestId(view.container, 'autokey').textContent).toBe('on');
    await view.unmount();
  });

  it('useDocQuery re-reads after batches on its tables (preview and load included) and ignores others', async () => {
    const fresh = createFakeEditorApp({ snapshot, skeleton });
    let reads = 0;
    function ClipName(): JSX.Element {
      const name = useDocQuery(
        (store) => {
          reads++;
          return store.get('clips', CLIP)?.name ?? '—';
        },
        ['clips'],
      );
      return <output data-testid="clip">{name}</output>;
    }
    // Reads happen on renders only: a batch on another table must not cause one.
    const view = await render(
      <EditorAppProvider app={fresh}>
        <ClipName />
      </EditorAppProvider>,
    );
    const clip = () => byTestId(view.container, 'clip').textContent;
    expect(clip()).toBe('wave');
    await update(() => fresh.store.transact({ label: 'Rename' }, (tx) => tx.patch('clips', CLIP, { name: 'hello' })));
    expect(clip()).toBe('hello');
    const before = reads;
    await update(() => fresh.store.transact({ label: 'Key' }, (tx) => tx.patch('keys', KEY, { v: 0 })));
    expect(reads).toBe(before);

    const preview = fresh.store.beginPreview('Rename drag');
    await update(() => preview.update((tx) => tx.patch('clips', CLIP, { name: 'previewing' })));
    expect(clip()).toBe('previewing');
    await update(() => preview.cancel());
    expect(clip()).toBe('hello');

    await update(() => fresh.store.load(snapshot));
    expect(clip()).toBe('wave');
    await view.unmount();
  });
});
