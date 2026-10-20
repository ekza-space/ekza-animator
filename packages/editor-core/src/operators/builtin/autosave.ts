// Autosave and crash recovery (M2A-SPEC §4.9 `file.recover`, `file.discardRecovery`, `file.autosaveNow`, §5.20).
// The host starts the autosave controller (`startAutosave`, browser shell); without one these operators poll-fail.
import { EkzaError } from '@ekza-animator/anim-core';
import type { CharacterId, ClipId } from '@ekza-animator/doc';
import { autosaveOf } from '../../app/autosave';
import { attachMeshes } from '../../mesh';
import { addBlobSource } from '../../services/blobs';
import { type EditorApp, GLOBAL_SCOPE } from '../../types';
import { loadProject, type OpenedProject } from '../../workflows/project';
import { activateClip } from '../../workflows/session';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';

const OFF = 'Autosave is off in this editor';

/** The blob source of the slot each app recovered last (released when another recovery replaces it). */
const recoverySources = new WeakMap<EditorApp, () => void>();

function pollSlot(args: unknown) {
  return isRecord(args) && typeof args['slot'] === 'string' && args['slot'] !== '' ? OK : fail('expects { slot }');
}

/** "18 Oct, 14:32" (another day) or "14:32" (today), in the browser's locale. */
export function formatSavedAt(savedAt: number, now: number = Date.now()): string {
  const date = new Date(savedAt);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

interface Recovered extends OpenedProject {
  readonly slot: string;
  readonly projectName: string;
  readonly savedAt: number | null;
  /** The session's active character and clips when the slot was written (absent in older slots). */
  readonly activeCharacter: CharacterId | null;
  readonly activeClip: Readonly<Record<CharacterId, ClipId>>;
}

/**
 * Returns the session to the character and clips that were active when the slot was written, where they exist
 * (after `loadProject`, whose session repair opened each character's first clip): the other characters' clips as
 * recorded, then the active character's clip at its start frame (`activateClip`, as `clip.setActive`).
 */
function restoreActiveClips(app: EditorApp, recovered: Recovered): void {
  const state = app.session.getState();
  const activeClip: Record<CharacterId, ClipId> = { ...state.activeClip };
  let changed = false;
  for (const [character, clip] of Object.entries(recovered.activeClip) as [CharacterId, ClipId][]) {
    if (app.store.get('clips', clip)?.character !== character || activeClip[character] === clip) continue;
    activeClip[character] = clip;
    changed = true;
  }
  if (changed) app.session.setState({ activeClip });
  const character = recovered.activeCharacter;
  const clipId = character === null ? undefined : activeClip[character];
  const clip = clipId === undefined ? undefined : app.store.get('clips', clipId);
  if (clip !== undefined) activateClip(app, app.store, clip);
}

const fileRecover = defineOperator<'file.recover', Recovered>({
  id: 'file.recover',
  label: 'Recover…',
  description: 'Open an autosaved project that was not saved before its page closed.',
  category: 'file',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    if ((autosaveOf(app)?.store ?? null) === null) return fail(OFF);
    return pollSlot(args);
  },
  async prepare({ app }, args) {
    const store = autosaveOf(app)?.store ?? null;
    if (store === null) throw new EkzaError('unsupported', OFF);
    const read = await store.read(args.slot);
    if (read === null) throw new EkzaError('not-found', 'That recovery point no longer exists');
    // M6a (§5.20): the slot's mesh blobs load lazily — runtimes read what they need through the blob store, which
    // falls back to the slot (until the next recovery replaces it).
    recoverySources.get(app)?.();
    recoverySources.set(
      app,
      addBlobSource(app.blobs, (id) => read.blob(id)),
    );
    // The file.openProject path (§5.20): assets into the asset store (ids are their SHA-256), then the migrations
    // and the read-only rule of the snapshot.
    const warnings: string[] = [];
    for (const [id, { record, bytes }] of read.assets) {
      const stored = await app.services.assets.put(bytes, { name: record.name, ext: record.ext, role: record.role });
      if (stored.id !== id) {
        throw new EkzaError('asset-corrupt', `The recovered asset ${record.name} does not match its SHA-256 ${id}`);
      }
    }
    const { migrateSnapshot } = await import('./snapshotMigrate');
    const migrated = migrateSnapshot(read.snapshot);
    for (const record of Object.values(migrated.snapshot.tables.assets ?? {})) {
      if (read.assets.has(record.id) || (await app.services.assets.has(record.id))) continue;
      warnings.push(`${record.name} was not part of the recovery point; add the model to see its characters`);
    }
    if (migrated.readOnly) warnings.push('This project was written by a newer version and opens read-only');
    const info = app.session.getState().recovery.find((entry) => entry.id === args.slot);
    return {
      slot: args.slot,
      snapshot: migrated.snapshot,
      readOnly: migrated.readOnly,
      migratedFrom: migrated.migratedFrom,
      warnings,
      projectName: migrated.snapshot.tables.project?.['project']?.name ?? info?.projectName ?? 'Untitled',
      savedAt: info?.savedAt ?? null,
      activeCharacter: info?.activeCharacter ?? null,
      activeClip: info?.activeClip ?? {},
    };
  },
  apply({ app }, _args, recovered) {
    attachMeshes(app);
    loadProject(app, recovered);
    restoreActiveClips(app, recovered);
    // Recovered work is unsaved work: dirty, history empty (loadProject), the dialog closed.
    app.session.setState({ dirty: true, dialog: null });
    autosaveOf(app)?.markRecovered(recovered.slot);
    const when = recovered.savedAt === null ? '' : ` from ${formatSavedAt(recovered.savedAt)}`;
    app.services.notify.toast({
      kind: 'success',
      text: `Recovered '${recovered.projectName}'${when}. Save it to keep it.`,
    });
    for (const warning of recovered.warnings) app.services.notify.toast({ kind: 'warning', text: warning });
    return { readOnly: app.store.readOnly };
  },
});

const fileDiscardRecovery = defineOperator<'file.discardRecovery', void>({
  id: 'file.discardRecovery',
  label: 'Discard Recovery',
  description: 'Delete an autosaved recovery point.',
  category: 'file',
  scope: GLOBAL_SCOPE,
  poll({ app }, args) {
    if ((autosaveOf(app)?.store ?? null) === null) return fail(OFF);
    return pollSlot(args);
  },
  async prepare({ app }, args) {
    const store = autosaveOf(app)?.store ?? null;
    if (store === null) throw new EkzaError('unsupported', OFF);
    await store.remove(args.slot);
  },
  apply({ app }, args) {
    const recovery = app.session.getState().recovery;
    if (recovery.some((entry) => entry.id === args.slot)) {
      app.session.setState({ recovery: recovery.filter((entry) => entry.id !== args.slot) });
    }
  },
});

type Written = { readonly slot: string; readonly bytes: number } | null;

const fileAutosaveNow = defineOperator<'file.autosaveNow', Written>({
  id: 'file.autosaveNow',
  label: 'Save Recovery Point',
  description: 'Write the autosave slot now.',
  category: 'file',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  poll({ app }) {
    const status = app.session.getState().autosave;
    if (autosaveOf(app) === null || !status.enabled || status.slot === null) return fail(OFF);
    if (status.error === 'quota') return fail('Autosave is paused: the storage is full');
    return OK;
  },
  async prepare({ app }) {
    return (await autosaveOf(app)?.writeNow()) ?? null;
  },
  apply: (_ctx, _args, written) => written,
});

export const AUTOSAVE_OPERATORS: readonly AnyOperator[] = [fileRecover, fileDiscardRecovery, fileAutosaveNow];
