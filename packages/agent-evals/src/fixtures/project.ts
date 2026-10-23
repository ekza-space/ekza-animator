// Deterministic fixture builders (MCP-SPEC §9.3.1): a task's starting document is a bundled sample loaded in a
// separate headless app, edited by the simulated user (clips and keys written without an actor) and saved as
// `.ekzanim` bytes for the agent to open; graders open the agent's saved bytes in another fresh app.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { TangentType } from '@ekza-studio/anim-core';
import { type CharacterId, type ClipId, seededIdSource } from '@ekza-studio/doc';
import {
  createHeadlessEditorApp,
  type EditorApp,
  ensureCurve,
  type ImportResult,
  writeKeyAt,
} from '@ekza-studio/editor-core';
import { controlOf } from '../graders/world';

export type SampleName = 'polybot' | 'seed-san';

const FIXTURES = new URL('../../../../fixtures/', import.meta.url);

/** The repository's fixture files (models/, animations/). */
export async function readFixtureFile(file: string): Promise<Uint8Array> {
  for (const dir of ['models/', 'animations/']) {
    try {
      return new Uint8Array(await readFile(fileURLToPath(new URL(`${dir}${file}`, FIXTURES))));
    } catch {
      // next folder
    }
  }
  throw new Error(`no fixture ${file}`);
}

/** The repository's fixtures folder (the server's `--samples-dir`). */
export const FIXTURES_DIR = fileURLToPath(FIXTURES);

/** Resolves once every character has its runtime. */
export function charactersReady(app: EditorApp): Promise<void> {
  const missing = (): boolean =>
    [...app.store.list('characters')].some((record) => app.characters.get(record.id) === undefined);
  if (!missing()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = app.characters.subscribe(() => {
      if (missing()) return;
      off();
      resolve();
    });
  });
}

export interface FixtureApp {
  readonly app: EditorApp;
  readonly character: CharacterId;
}

/** A headless app with a bundled sample loaded (as the user would: no actor). */
export async function sampleApp(sample: SampleName, seed = 1): Promise<FixtureApp> {
  const app = createHeadlessEditorApp({ readSample: (def) => readFixtureFile(def.file), idSource: seededIdSource(seed) });
  const loaded = await app.runUntyped('file.loadSample', { sample });
  if (loaded.status !== 'finished') throw new Error(`${sample} did not load: ${JSON.stringify(loaded)}`);
  const character = (loaded.value as ImportResult).character;
  await charactersReady(app);
  return { app, character };
}

/** A clip made by the user (`clip.new`), the user's active clip left where it was. */
export async function userClip(
  fx: FixtureApp,
  name: string,
  range: { readonly start: number; readonly end: number },
): Promise<ClipId> {
  const { app, character } = fx;
  const active = app.session.getState().activeClip[character];
  const result = await app.runUntyped('clip.new', { character, name, range });
  if (result.status !== 'finished') throw new Error(`clip.new: ${JSON.stringify(result)}`);
  if (active !== undefined) {
    app.session.setState({ activeClip: { ...app.session.getState().activeClip, [character]: active } });
  }
  return (result.value as { clip: ClipId }).clip;
}

export interface UserKey {
  readonly control: string;
  readonly channel: string;
  readonly frame: number;
  /** Stored units (radians, metres). */
  readonly value: number;
  readonly tangent?: TangentType;
}

/** Keys written by the user in one edit (no actor). */
export function userKeys(fx: FixtureApp, clip: ClipId, keys: readonly UserKey[]): void {
  const { app, character } = fx;
  const defaults = app.prefs.getState().defaultTangents;
  app.store.transact({ label: 'Setup' }, (tx) => {
    for (const key of keys) {
      const curve = ensureCurve(app, tx, clip, controlOf(app, character, key.control), key.channel as never);
      const tangents =
        key.tangent === undefined ? { in: defaults.in, out: defaults.out } : { in: key.tangent, out: key.tangent };
      writeKeyAt(app, tx, curve, key.frame, key.value, tangents, { existing: 'set' });
    }
  });
}

/** The document as `.ekzanim` bytes (`file.save`, captured). */
export async function projectBytes(app: EditorApp): Promise<Uint8Array> {
  const files: Uint8Array[] = [];
  const service = app.services.files as { download: (name: string, bytes: Uint8Array, mime: string) => void };
  const original = service.download;
  service.download = (_name, bytes) => {
    files.push(bytes);
  };
  try {
    const saved = await app.runUntyped('file.save', { fileName: 'task.ekzanim' });
    if (saved.status !== 'finished') throw new Error(`file.save: ${JSON.stringify(saved)}`);
  } finally {
    service.download = original;
  }
  const bytes = files[0];
  if (bytes === undefined) throw new Error('file.save produced no bytes');
  return bytes;
}

export interface OpenedProject {
  readonly app: EditorApp;
  /** The first character (tasks have one). */
  readonly character: CharacterId;
  clip(name: string, character?: CharacterId): ClipId;
}

/** Opens `.ekzanim` bytes in a fresh headless app (graders: never the agent's own runtime). */
export async function openProject(bytes: Uint8Array): Promise<OpenedProject> {
  const app = createHeadlessEditorApp({ readSample: null });
  const opened = await app.runUntyped('file.openProject', { name: 'graded.ekzanim', bytes });
  if (opened.status !== 'finished') throw new Error(`file.openProject: ${JSON.stringify(opened)}`);
  await charactersReady(app);
  const characters = [...app.store.list('characters')];
  const first = characters[0];
  if (first === undefined) throw new Error('no character in the project');
  return {
    app,
    character: first.id,
    clip(name, character = first.id) {
      const clip = app.store.query.clipsOfCharacter(character).find((record) => record.name === name);
      if (clip === undefined) throw new Error(`no clip ${name}`);
      return clip.id;
    },
  };
}
