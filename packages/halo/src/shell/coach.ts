// Coach marks (STUDIO-TOUCH-SPEC §17): once per surface, in context, dismissible — the first Halo (*Hold on the model
// and flick toward a verb to go faster*) and the first time the Thumb key appears (the text of its current
// `modifierMap` row, so it always matches the key's label). Remembered on this device; never a modal.
import { coachText } from '../input/modifierMap';
import { currentRow } from '../input/situation';
import { en } from '../i18n/en';
import type { ShellContext } from './context';

export const HALO_COACH_KEY = 'ekza-studio:halo:coach:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function seen(storage: StorageLike | null): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(HALO_COACH_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function coachMarks(ctx: ShellContext, storage: StorageLike | null): () => void {
  const shown = seen(storage);
  const show = (id: string, text: string): void => {
    if (shown.has(id) || text === '') return;
    shown.add(id);
    try {
      storage?.setItem(HALO_COACH_KEY, JSON.stringify([...shown]));
    } catch {
      // blocked storage: shown once for this page
    }
    ctx.toasts.push({ key: `coach-${id}`, text, durationMs: 8000, action: { label: en.halo.gotIt, run: () => {} } });
  };
  const offStore = ctx.store.subscribe((next, previous) => {
    if (next.halo !== null && previous.halo === null) show('ring', en.halo.coachRing);
  });
  const offSession = ctx.app.session.subscribe(() => {
    if (shown.has('thumb')) return;
    const row = currentRow(ctx.app, ctx.store);
    if (row !== null) show('thumb', coachText(row));
  });
  return () => {
    offStore();
    offSession();
  };
}
