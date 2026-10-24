// M6B-SPEC §8.13, §8.6, §0.4.6 (C10, editor): the Export dialog's Character section — the default in Rig & Skin, the
// OMOBA/Space banner, only `ekza/space-avatar-v1` (VRM 1.0 only) and `local/generic` (VRM or plain GLB), the VRM meta
// rows blocking Export until a licence and an author are set (each edit one `char.setVrmMeta` step), Render Thumbnail,
// the export result; the VRM Meta dialog; the Rig Toolkit's Character section.
import { type CharacterId, type MeshId, makeVrmMeta } from '@ekza-studio/doc';
import { type EditorApp, loadMeshKernel, registerBuiltins } from '@ekza-studio/editor-core';
import { CHARACTER_EXPORT_BANNER } from '@ekza-studio/io';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DialogHost } from '../src/dialogs/DialogHost';
import { EditorAppProvider } from '../src/hooks';
import { splitList } from '../src/dialogs/export/character/VrmMetaFields';
import { CharacterSection } from '../src/panels/rigToolkit/sections/character';
import { by, cleanup, mountPlain } from './panels/helpers';
import { render, update } from './render';
import { createTestShell, ShellFrame, waveFixtures } from './shell-helpers';

let fixtures: Awaited<ReturnType<typeof waveFixtures>>;
beforeAll(async () => {
  await loadMeshKernel();
  fixtures = await waveFixtures();
});
afterEach(async () => {
  await cleanup();
});

async function run(app: EditorApp, op: string, args?: unknown): Promise<unknown> {
  let value: unknown;
  await act(async () => {
    const result = await app.runUntyped(op, args);
    if (result.status !== 'finished') throw new Error(`${op}: ${JSON.stringify(result)}`);
    value = result.value;
  });
  return value;
}

async function waitUntil(predicate: () => boolean, ms = 10_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > ms) throw new Error('condition not met in time');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }
}

const body = (id: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (element === null) throw new Error(`no ${id}`);
  return element;
};
const maybe = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/**
 * A shell in Rig & Skin with a bound character: the generated humanoid body, Skeleton Template (Standard 33) and Bind
 * Skin (INT: with C2, C4 and C7 merged the Validation rows join the export gate, so the character must be a valid one
 * for the meta rows to be the only errors).
 */
async function rigShell(): Promise<{
  app: EditorApp;
  shell: ReturnType<typeof createTestShell>['shell'];
  character: CharacterId;
}> {
  const test = createTestShell({ snapshot: fixtures.snapshot, skeleton: fixtures.skeleton });
  registerBuiltins(test.app);
  test.app.session.setState({ workspace: 'model' });
  const { mesh } = (await run(test.app, 'mesh.create.template', { template: 'humanoidBody' })) as { mesh: MeshId };
  await act(() => test.app.rig.load());
  const made = (await run(test.app, 'skel.template.create', { objects: [mesh] })) as { character: CharacterId };
  await act(async () => {
    test.app.store.transact({ label: 'name (test)' }, (tx) =>
      tx.patch('characters', made.character, { name: 'Box Lad' }),
    );
  });
  test.app.session.setState({ workspace: 'rig' });
  await run(test.app, 'skin.bind', { meshes: [mesh] });
  return { app: test.app, shell: test.shell, character: made.character };
}

describe('the Export dialog Character section (§8.13)', () => {
  it('offers the Space profile (VRM 1.0) and local/generic (VRM or GLB) under the OMOBA banner', async () => {
    const { app, shell } = await rigShell();
    const view = await render(
      <ShellFrame shell={shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => shell.runFromUi('ui.open', { dialog: 'export' }));
    await waitUntil(() => maybe('export-character') !== null);
    expect(body('export-mode-character').getAttribute('aria-checked')).toBe('true');
    expect(body('export-char-banner').textContent).toBe(CHARACTER_EXPORT_BANNER);
    expect(CHARACTER_EXPORT_BANNER).toBe('OMOBA plays its own motion library on your VRM; your clips play in Space.');
    const profile = body('export-char-profile') as HTMLSelectElement;
    // CHARACTER-CONTRACT-SPEC §8.10 (C2): the OMOBA hero package profile sits between them.
    expect([...profile.options].map((o) => o.value)).toEqual([
      'ekza/space-avatar-v1',
      'ekza/omoba-humanoid-v2',
      'local/generic',
    ]);
    expect([...profile.options].map((o) => o.text)).toContain('Ekza avatar — Space and OMOBA (VRM 1.0)');
    const format = body('export-char-format') as HTMLSelectElement;
    expect([...format.options].map((o) => o.value)).toEqual(['vrm']);
    expect(format.disabled).toBe(true);
    await update(() => {
      profile.value = 'local/generic';
      profile.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect([...(body('export-char-format') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['vrm', 'glb']);
    void app;
    await view.unmount();
  });

  it('the VRM meta rows block Export until a licence and an author are set; each edit is one step', async () => {
    const { app, shell, character } = await rigShell();
    const view = await render(
      <ShellFrame shell={shell}>
        <DialogHost />
      </ShellFrame>,
    );
    await update(() => shell.runFromUi('ui.open', { dialog: 'export' }));
    await waitUntil(() => maybe('export-character') !== null);
    await waitUntil(() => maybe('export-char-row-vrm.licence-unset') !== null);
    expect(body('export-character').textContent).toContain('vrm.meta-required');
    expect((body('export-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(body('export-char-blocked').textContent).toBe('2 errors block the export');
    // Licence: the CC0 preset (one step).
    const steps = app.history.peekUndo()?.id;
    await update(() => body('vrm-licence-cc0').click());
    await waitUntil(() => app.store.get('characters', character)?.vrm?.licensePreset === 'cc0');
    expect(app.history.peekUndo()?.id).not.toBe(steps);
    expect(app.history.peekUndo()?.label).toBe('VRM Meta');
    // Authors: typed, committed on Enter.
    const authors = body('vrm-meta-authors') as HTMLInputElement;
    await update(() => userEvent.fill(authors, 'Tester, Second'));
    await update(() => authors.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await waitUntil(() => app.store.get('characters', character)?.vrm?.authors.length === 2);
    await waitUntil(() => maybe('export-char-row-vrm.meta-required') === null);
    // The thumbnail row is a warning: Export is enabled.
    expect(maybe('export-char-row-vrm.thumbnail-square')).not.toBeNull();
    await waitUntil(() => !(body('export-confirm') as HTMLButtonElement).disabled);
    // Render Thumbnail: a thumbnail asset, the warning gone.
    await update(() => body('export-char-thumb-render').click());
    await waitUntil(() => (app.store.get('characters', character)?.vrm?.thumbnail ?? null) !== null, 30_000);
    await waitUntil(() => maybe('export-char-row-vrm.thumbnail-square') === null);
    // INT: the bound body keeps Validation's info rows (e.g. unweighted finger joints), so the list is not "clean"; no
    // row is an error or a warning.
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="export-char-row-"]')];
    expect(
      rows.map((row) => [row.dataset['testid']?.startsWith('export-char-row-skin.'), row.textContent?.slice(0, 4)]),
    ).toEqual(rows.map(() => [true, 'info']));
    expect((body('export-confirm') as HTMLButtonElement).disabled).toBe(false);
    // Export: the result is listed (the bound body passes OMOBA's rules: no vrm.* row).
    await update(() => body('export-confirm').click());
    await waitUntil(() => maybe('export-char-result') !== null, 30_000);
    expect(body('export-char-result').textContent).toContain('Box_Lad.vrm');
    expect(body('export-char-result').textContent).not.toContain('vrm.');
    expect(body('export-char-size').textContent).toMatch(/KiB|B$/);
    await view.unmount();
  });

  it('splits author lists on commas and new lines', () => {
    expect(splitList(' A, B \n C,, ')).toEqual(['A', 'B', 'C']);
  });
});

describe('VRM Meta dialog and the Rig Toolkit Character section', () => {
  it('VRM Meta… opens the dialog with the fields and the thumbnail (no step)', async () => {
    const { app, shell, character } = await rigShell();
    const view = await render(
      <ShellFrame shell={shell}>
        <DialogHost />
      </ShellFrame>,
    );
    const steps = app.history.peekUndo()?.id;
    const opened = await shell.runFromUi('char.setVrmMeta', { character });
    expect(opened).toMatchObject({ status: 'finished' });
    expect(app.session.getState().dialog).toBe('vrmMeta');
    await waitUntil(() => maybe('vrm-meta-dialog') !== null);
    expect(app.history.peekUndo()?.id).toBe(steps);
    expect((body('vrm-meta-name') as HTMLInputElement).value).toBe('Box Lad');
    expect(maybe('vrm-licence-cc0')).not.toBeNull();
    expect(maybe('export-char-thumb')).not.toBeNull();
    await update(() => body('vrm-meta-done').click());
    await waitUntil(() => maybe('vrm-meta-dialog') === null);
    await view.unmount();
  });

  it('shows name, source, authors and licence, and the buttons', async () => {
    const { app, character } = await rigShell();
    await act(async () => {
      app.store.transact({ label: 'meta (test)' }, (tx) =>
        tx.patch('characters', character, {
          vrm: { ...makeVrmMeta('Box Lad'), authors: ['Tester'], licensePreset: 'cc0' },
        }),
      );
    });
    await mountPlain(
      <EditorAppProvider app={app}>
        <CharacterSection app={app} />
      </EditorAppProvider>,
    );
    expect(by('attr-char-name').textContent).toBe('Box Lad');
    expect(by('attr-char-source').textContent).toBe('Made from your model');
    expect(by('attr-char-authors').textContent).toBe('Tester');
    expect(by('attr-char-licence').textContent).toBe('Open — CC0');
    expect(by('rtk-btn-file.exportCharacter').textContent).toBe('Export Character…');
  });
});
