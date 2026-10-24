// About this character (STUDIO-TOUCH-SPEC §6.8, §15 row 11.7): every `CharacterVrmMeta` field with the defaults of
// the VRM Meta dialog for a character made from a model, the licence presets in Halo's words with none pre-selected,
// one `char.setVrmMeta` run per edited field (it lands headless), *Render thumbnail* through `char.renderThumbnail`,
// a file's own meta shown read-only, and every operator the manifest places in About wired to a control.
import type { CharacterId, CharacterVrmMeta, MeshId } from '@ekza-studio/doc';
import { makeVrmMeta } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { describe, expect, it, vi } from 'vitest';
import { DISCLOSURE } from '../../src/manifest/disclosure';
import { SHEET_SECTIONS } from '../../src/manifest/sheets';
import { entriesOf } from '../../src/manifest/types';
import {
  ABOUT_FIELDS,
  type AboutModel,
  aboutModel,
  fileMeta,
  LICENCE_PRESETS,
  patchFor,
} from '../../src/sheets/about/model';
import { everyOperator, polybotApp, runOk } from '../support';

// Headless apps with every chunk load slowly on a busy machine.
vi.setConfig({ testTimeout: 60_000 });

/** A character made from a model: a cube, made a character in Rig (`char.fromModel`). */
async function modelCharacter(app: EditorApp): Promise<CharacterId> {
  await runOk(app, 'workspace.set', { workspace: 'model' });
  const { mesh } = await runOk<{ mesh: MeshId }>(app, 'mesh.create.cube');
  await runOk(app, 'workspace.set', { workspace: 'rig' });
  const made = await runOk<{ character: CharacterId }>(app, 'char.fromModel', { objects: [mesh] });
  app.session.setState({ activeCharacter: made.character });
  return made.character;
}

const fieldOf = (model: AboutModel, id: string) =>
  model.sections.flatMap((section) => section.fields).find((field) => field.id === id);

/** Every meta field the record holds, but the thumbnail (rendered, never typed). */
const META_FIELDS = Object.keys(makeVrmMeta('')).filter((key) => key !== 'thumbnail');

describe('About this character (§6.8)', () => {
  it('says there is no character yet, with nothing to edit', async () => {
    const app = await everyOperator();
    const model = aboutModel(app);
    expect(model).toMatchObject({ character: null, editable: false, sections: [], thumbnail: { control: null } });
    expect(model.note).toMatch(/No character yet/);
  });

  it('shows every field with the VRM Meta dialog’s defaults for a model character without meta', async () => {
    const app = await everyOperator();
    const character = await modelCharacter(app);
    const record = app.store.get('characters', character);
    expect(record?.vrm).toBeNull();
    const model = aboutModel(app);
    expect(model.character).toMatchObject({ id: character, source: 'model' });
    expect(model.editable).toBe(true);
    expect(model.note).toBeNull();
    expect(model.sections.map((section) => section.id)).toEqual(['identity', 'licence', 'usage', 'flags']);
    expect([...model.sections.map((s) => s.id), 'thumbnail']).toEqual(SHEET_SECTIONS.about);
    const ids = model.sections.flatMap((section) => section.fields.map((field) => field.id));
    expect([...ids].sort()).toEqual([...META_FIELDS].sort());
    const defaults = makeVrmMeta(record?.name ?? '');
    expect(fieldOf(model, 'name')?.value).toBe(defaults.name);
    expect(fieldOf(model, 'authors')).toMatchObject({ value: '', missing: true, required: true });
    // No licence is pre-selected (Q-SKIN-3); the presets read in Halo's words.
    expect(fieldOf(model, 'licensePreset')).toMatchObject({ value: '', missing: true });
    expect(model.licenceChosen).toBe(false);
    expect(LICENCE_PRESETS.map((preset) => preset.label)).toEqual([
      'Free for anyone (CC0)',
      'Credit me (CC BY 4.0)',
      'Personal use only',
      'Custom…',
    ]);
    expect(fieldOf(model, 'otherLicenseUrl')?.shown).toBe(false);
    for (const key of ['avatarPermission', 'commercialUsage', 'creditNotation', 'modification'] as const) {
      expect(fieldOf(model, key)?.value).toBe(defaults[key]);
    }
    for (const key of [
      'allowRedistribution',
      'allowExcessivelyViolentUsage',
      'allowExcessivelySexualUsage',
      'allowPoliticalOrReligiousUsage',
      'allowAntisocialOrHateUsage',
    ] as const) {
      expect(fieldOf(model, key)?.value).toBe(false);
    }
    expect(model.thumbnail).toMatchObject({
      asset: null,
      control: { op: 'char.renderThumbnail', args: { character }, enabled: true, label: 'Render thumbnail' },
    });
  }, 60_000);

  it('writes one field per char.setVrmMeta run, headless, and the presets set their permissions', async () => {
    const app = await everyOperator();
    const character = await modelCharacter(app);
    const target = { id: character, name: app.store.get('characters', character)?.name ?? '' };
    const top = (): number | null => app.history.peekUndo()?.id ?? null;
    const run = async (field: Parameters<typeof patchFor>[1], value: string | boolean): Promise<void> => {
      const call = patchFor(target, field, value);
      if (call === null) throw new Error(`no run for ${field}`);
      const sent = call.args as { readonly character: string; readonly patch: object };
      expect(call.op).toBe('char.setVrmMeta');
      expect([sent.character, Object.keys(sent.patch)]).toEqual([character, [field]]);
      const before = top();
      await runOk(app, call.op, call.args);
      expect(top()).not.toBe(before);
      expect(app.history.peekUndo()?.label).toBe('VRM Meta');
    };
    await run('authors', 'Ada, Grace\nLinus');
    await run('licensePreset', 'cc-by-4.0');
    await run('allowExcessivelyViolentUsage', true);
    await run('name', 'Cube Hero');
    expect(app.store.get('characters', character)?.vrm?.name).toBe('Cube Hero');
    await run('name', '  ');
    await run('references', 'https://example.org/a, https://example.org/b');
    const vrm = app.store.get('characters', character)?.vrm as CharacterVrmMeta;
    expect(vrm).toMatchObject({
      authors: ['Ada', 'Grace', 'Linus'],
      licensePreset: 'cc-by-4.0',
      avatarPermission: 'everyone',
      creditNotation: 'required',
      allowExcessivelyViolentUsage: true,
      name: target.name,
      references: ['https://example.org/a', 'https://example.org/b'],
    });
    const model = aboutModel(app);
    expect(model.licenceChosen).toBe(true);
    expect(fieldOf(model, 'authors')).toMatchObject({ value: 'Ada, Grace, Linus', missing: false });
    expect(fieldOf(model, 'avatarPermission')?.value).toBe('everyone');
    // A value that does not fit the field builds no run.
    expect(patchFor(target, 'avatarPermission', 'nobody')).toBeNull();
    expect(patchFor(target, 'allowRedistribution', 'yes')).toBeNull();
    // Custom… shows the licence link.
    await run('licensePreset', 'custom');
    expect(fieldOf(aboutModel(app), 'otherLicenseUrl')?.shown).toBe(true);
  }, 60_000);

  it('shows a file’s own meta read-only, with a plain note and no thumbnail render', async () => {
    const { app, character } = await polybotApp();
    app.session.setState({ activeCharacter: character });
    const model = aboutModel(app);
    expect(model.character).toMatchObject({ id: character, source: 'asset' });
    expect(model.editable).toBe(false);
    expect(model.note).toMatch(/came from a file/);
    expect(fieldOf(model, 'name')?.value).not.toBe('');
    expect(model.thumbnail.control?.enabled).toBe(false);
    expect(typeof model.thumbnail.control?.reason).toBe('string');
    expect(fileMeta({ extensions: {} }, 'x')).toBeNull();
    expect(
      fileMeta(
        {
          extensions: {
            VRMC_vrm: {
              meta: {
                name: 'Bot',
                authors: ['A'],
                otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
              },
            },
          },
        },
        'x',
      ),
    ).toMatchObject({ name: 'Bot', authors: ['A'], licensePreset: 'cc0' });
    expect(
      fileMeta({ extensions: { VRM: { meta: { title: 'Old', author: 'B', licenseName: 'CC_BY' } } } }, 'x'),
    ).toMatchObject({ name: 'Old', authors: ['B'], licensePreset: 'cc-by-4.0' });
  }, 60_000);

  it('wires every operator the manifest places in About', async () => {
    const app = await everyOperator();
    const character = await modelCharacter(app);
    const model = aboutModel(app);
    const target = { id: character, name: 'x' };
    const wired = new Map<string, Set<string>>();
    const add = (section: string, op: string): void => {
      wired.set(section, new Set([...(wired.get(section) ?? []), op]));
    };
    for (const section of model.sections) {
      for (const field of section.fields) {
        const sample = field.kind === 'flag' ? true : field.kind === 'choice' ? (field.options?.[0]?.value ?? '') : 'x';
        const call = patchFor(target, field.id, sample);
        if (call !== null) add(section.id, call.op);
      }
    }
    if (model.thumbnail.control !== null) add('thumbnail', model.thumbnail.control.op);
    expect(ABOUT_FIELDS.length).toBe(META_FIELDS.length);
    for (const [op, value] of Object.entries(DISCLOSURE)) {
      for (const entry of entriesOf(value)) {
        // `ui.open {dialog: 'vrmMeta'}` is the way in (the frame opens this sheet), not a control inside it.
        if (!('surfaces' in entry) || entry.when !== undefined) continue;
        for (const surface of entry.surfaces) {
          if (!('sheet' in surface) || surface.sheet !== 'about') continue;
          const sections =
            surface.section === undefined ? ['identity', 'licence', 'usage', 'flags'] : [surface.section];
          for (const section of sections) expect(wired.get(section), `${op} in ${section}`).toContain(op);
        }
      }
    }
    // Render thumbnail lands headless as one step.
    const render = model.thumbnail.control;
    await runOk(app, render?.op ?? '', render?.args);
    const rendered = aboutModel(app).thumbnail;
    expect(typeof rendered.asset).toBe('string');
    expect(rendered.control?.label).toBe('Render again');
  }, 60_000);
});
