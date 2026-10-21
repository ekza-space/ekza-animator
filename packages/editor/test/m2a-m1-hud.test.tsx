// M2A-SPEC §5.21.1 (M-1): the viewport HUD rewrites its frame and seconds only when the text changes. It listens to
// every document batch, and a drag emits one per frame; writing the same text again replaced the text node, which
// invalidated layout and made the viewport's next rect read force a layout in the middle of the frame.
import type { DocSnapshot } from '@ekza-studio/doc';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { SkeletonDesc } from '@ekza-studio/rig';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorAppProvider } from '../src';
import { ViewportPanel } from '../src/panels/viewport';
import { byTestId, type Rendered, readSynthetic, render } from './render';

let snapshot: DocSnapshot;
let skeleton: SkeletonDesc;
beforeAll(async () => {
  snapshot = (await readSynthetic('wave-doc.json')) as DocSnapshot;
  skeleton = (await readSynthetic('humanoid-skeleton.json')) as SkeletonDesc;
});

let mounted: { view: Rendered; app: FakeEditorApp } | null = null;
afterEach(async () => {
  await mounted?.view.unmount();
  mounted?.app.dispose();
  mounted = null;
});

describe('viewport HUD (M-1)', () => {
  it('a document batch that leaves the frame alone does not touch the HUD text; a frame change does', async () => {
    const app = createFakeEditorApp({ snapshot, skeleton });
    const view = await render(
      <EditorAppProvider app={app}>
        <div style={{ position: 'fixed', left: 0, top: 0, width: 1000, height: 600 }}>
          <ViewportPanel app={app} instanceId="viewport#1" />
        </div>
      </EditorAppProvider>,
    );
    mounted = { view, app };
    const pane = byTestId(view.container, 'pane-pane-right');
    const frame = byTestId(pane, 'pane-hud-frame');
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(byTestId(pane, 'pane-hud-seconds').parentElement as HTMLElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    const key = app.store.query.keysOfCurve(app.store.list('curves')[0]?.id ?? ('' as never))[0];
    if (key === undefined) throw new Error('the wave document has keys');
    const preview = app.store.beginPreview('Move Keys');
    for (const v of [0.1, 0.2, 0.3]) preview.update((tx) => tx.patch('keys', key.id, { v }));
    preview.commit({ label: 'Move Keys' });
    await Promise.resolve();
    expect(mutations.flatMap((record) => [...record.addedNodes])).toEqual([]);
    expect(frame.textContent).toBe('f 0');

    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 15 } });
    await Promise.resolve();
    expect(frame.textContent).toBe('f 15');
    expect(mutations.length).toBeGreaterThan(0);
    observer.disconnect();
  });
});
