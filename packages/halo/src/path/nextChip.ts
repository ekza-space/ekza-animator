// The one Next chip (STUDIO-TOUCH-SPEC §7.2, §17; T6b): a single dismissible chip above the tray that follows readiness
// — *Rig it for me ▸* → *Add animations ▸* → *Share for <destination> ▸*. It is the only standing guidance; the frame
// hides it while a card or a sheet is open. Pure over the app and the readiness list.
import type { EditorApp } from '@ekza-studio/editor-core';
import type { SheetId, Stage } from '../manifest/types';
import type { Readiness } from './readiness';

export interface NextChip {
  readonly id: 'rigIt' | 'addAnimations' | 'share' | 'fix';
  readonly label: string;
  /** What a tap does: switch the stage, open a sheet, or both. */
  readonly stage?: Stage;
  readonly sheet?: SheetId;
}

/** The Next chip for this document and destination, or null when there is nothing to suggest. */
export function nextChip(app: EditorApp, r: Readiness): NextChip | null {
  const meshes = app.store.list('meshes').filter((mesh) => mesh.deleted === null).length;
  const characters = app.store.list('characters').filter((c) => c.deleted === null);
  if (characters.length === 0) {
    return meshes > 0 ? { id: 'rigIt', label: 'Rig it for me ▸', stage: 'rig' } : null;
  }
  const clips = app.store.list('clips').filter((clip) => clip.deleted === null).length;
  if (clips === 0) return { id: 'addAnimations', label: 'Add animations ▸', stage: 'animate', sheet: 'library' };
  if (r.total > 0) return { id: 'fix', label: `${r.total} to fix ▸`, sheet: 'health' };
  const name = r.destination.id === 'exploring' ? '' : ` for ${r.destination.badge ?? r.destination.name}`;
  return { id: 'share', label: `Share${name} ▸`, sheet: 'share' };
}
