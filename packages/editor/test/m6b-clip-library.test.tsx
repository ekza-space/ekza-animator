// C12 (M6B-SPEC §0.4.7 "Panel"): the Clip Library body over the fake app — the manifest is fetched on open (no clip
// file), cards show label, duration, loop and slot; Play of a clip whose served bytes fail their checksum turns its
// card disabled with the reason; without a character the empty state says what to do; the Rig Toolkit section stays
// collapsed (no chunk loads) until opened.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipCardList } from '../src/panels/clipLibrary/ClipCardList';
import { libraryView } from '../src/panels/clipLibrary/state';
import { LibrarySection } from '../src/panels/rigToolkit/sections/library';
import { byTestId, render, update } from './render';
import { createTestShell, ShellFrame, waitFor, waveFixtures } from './shell-helpers';

const CLIP = new Uint8Array([1, 2, 3, 4]);

function manifest() {
  const clip = (id: string, label: string, slot: string | null, loop: boolean) => ({
    id,
    source: `${label}_Loop`,
    label,
    slot,
    loop,
    file: `${id}.vrma`,
    bytes: CLIP.length,
    sha256: 'b'.repeat(64),
    duration: 1.333333,
    fps: 30,
    license: 'CC0-1.0',
    credit: 'Quaternius',
  });
  return {
    version: 1,
    id: 'ekza/starter-pack',
    title: 'Starter pack — Universal Animation Library',
    license: 'CC0-1.0',
    credit: 'Universal Animation Library by Quaternius (CC0)',
    sourceUrl: 'https://quaternius.com/packs/universalanimationlibrary.html',
    source: { file: 'fixtures/animations/quaternius-ual.glb', sha256: 'a'.repeat(64) },
    generator: 'tooling/make-starter-pack.mjs v1',
    clips: [clip('walk', 'Walk', 'walk', true), clip('punch', 'Punch', null, false)],
  };
}

let requests: string[] = [];
beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', (url: string) => {
    requests.push(url);
    const json = url.endsWith('starter-pack.json');
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(manifest()),
      arrayBuffer: () => Promise.resolve(json ? new ArrayBuffer(0) : CLIP.slice().buffer),
    });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Clip Library body (§0.4.7)', () => {
  it('lists the manifest on open, then disables a card whose file fails its checksum', async () => {
    const { shell, app } = createTestShell(await waveFixtures());
    const view = await render(
      <ShellFrame shell={shell}>
        <ClipCardList app={app} />
      </ShellFrame>,
    );
    await waitFor(() => view.container.querySelector('[data-testid="clip-card-walk"]') !== null);
    expect(requests).toEqual(['/library/animations/starter-pack.json']);
    const walk = byTestId(view.container, 'clip-card-walk');
    expect(walk.textContent).toContain('Walk');
    expect(walk.textContent).toContain('1.3 s');
    expect(walk.textContent).toContain('walk');
    expect(byTestId(view.container, 'clip-library-credit').textContent).toContain('Quaternius UAL · CC0');
    expect(byTestId(view.container, 'clip-library-character').textContent).toMatch(/^Character: /);

    await update(() => byTestId(view.container, 'clip-play-walk').click());
    await waitFor(() => libraryView(app).failed.has('walk'));
    await waitFor(() => view.container.querySelector('[data-testid="clip-failed-walk"]') !== null);
    expect(byTestId(view.container, 'clip-failed-walk').textContent).toBe('The file failed its checksum');
    expect((byTestId(view.container, 'clip-play-walk') as HTMLButtonElement).disabled).toBe(true);
    expect((byTestId(view.container, 'clip-use-walk') as HTMLButtonElement).disabled).toBe(true);
    expect(byTestId(view.container, 'clip-card-walk').getAttribute('data-disabled')).toBe('true');
    expect(requests).toEqual(['/library/animations/starter-pack.json', '/library/animations/walk.vrma']);

    // The search field filters the cards.
    const search = byTestId(view.container, 'clip-library-search') as HTMLInputElement;
    await update(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'pun');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(view.container.querySelector('[data-testid="clip-card-walk"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="clip-card-punch"]')).not.toBeNull();
    await view.unmount();
  });

  it('without a character shows the empty state', async () => {
    const { shell, app } = createTestShell();
    const view = await render(
      <ShellFrame shell={shell}>
        <ClipCardList app={app} />
      </ShellFrame>,
    );
    expect(byTestId(view.container, 'clip-library-empty').textContent).toBe(
      'Select a humanoid character (a VRM, or one you rigged here) to preview clips',
    );
    // The manifest still loads (the cards list it, disabled); let it settle before the next test.
    await waitFor(() => libraryView(app).status === 'ready', 5000);
    await view.unmount();
  });

  it('the Rig Toolkit section is collapsed until opened: no chunk, no request', async () => {
    const { shell, app } = createTestShell(await waveFixtures());
    const view = await render(
      <ShellFrame shell={shell}>
        <LibrarySection app={app} />
      </ShellFrame>,
    );
    expect(byTestId(view.container, 'rtk-library-open').textContent).toBe('Show clips');
    expect(app.library.loaded).toBe(false);
    expect(requests).toEqual([]);
    await update(() => byTestId(view.container, 'rtk-library-open').click());
    await waitFor(() => view.container.querySelector('[data-testid="clip-library-body"]') !== null, 5000);
    await waitFor(() => requests.length === 1, 5000);
    await view.unmount();
  });
});
