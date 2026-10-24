// ● Rec (STUDIO-TOUCH-SPEC §10.2, §16.4, ST-T7-1): Ekza Studio's own setting `halo.rec` (on by default; the shell's
// store keeps it and its session mirror), applied to the kernel as a removable `shell`-layer override of Auto Key while
// Halo is mounted and an animation is active. Rec on means every pose change writes a key at the playhead, also on a
// channel that has no keys yet: the override is `{autoKey: true, autoKeyMode: 'all'}` (Studio Pro's default mode
// 'keyed-only' would leave a new animation's first pose unkeyed). Rec off is `{autoKey: false}`: changes stay as
// unkeyed overrides. Pro's stored Auto Key is never written (the override layer persists only the base), and the
// override is removed when the shell unmounts (ha-12), so Pro behaves exactly as its own setting says after a switch.
import { type EditorApp, overridePrefs, type PrefsPatch } from '@ekza-studio/editor-core';
import type { HaloStore } from '../../shell/store';
import { activeClip } from './model';

/** The override Rec lays over the preferences. */
export function recPatch(rec: boolean): PrefsPatch {
  return rec ? { autoKey: true, autoKeyMode: 'all' } : { autoKey: false };
}

/**
 * Applies Rec while an animation is active and follows its changes; the disposer removes the override (shell
 * unmount). Returns the disposer.
 */
export function installRec(app: EditorApp, store: HaloStore): () => void {
  let applied: { readonly rec: boolean; readonly dispose: () => void } | null = null;
  const sync = (): void => {
    const want = activeClip(app) === null ? null : store.get().rec;
    if (applied !== null && applied.rec === want) return;
    applied?.dispose();
    applied = want === null ? null : { rec: want, dispose: overridePrefs(app.prefs, 'shell', recPatch(want)) };
  };
  sync();
  const offStore = store.subscribe((next, previous) => {
    if (next.rec !== previous.rec) sync();
  });
  const offSession = app.session.subscribe((next, previous) => {
    if (next.activeClip !== previous.activeClip || next.activeCharacter !== previous.activeCharacter) sync();
  });
  const offDoc = app.store.subscribe(() => sync());
  return () => {
    offStore();
    offSession();
    offDoc();
    applied?.dispose();
    applied = null;
  };
}
