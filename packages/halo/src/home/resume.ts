// Resume after a reload (STUDIO-TOUCH-SPEC §9 J10, §16.1, §17, S24; T11). iPadOS reloads a tab under memory pressure;
// while a project is open, Halo keeps a small record in this tab's sessionStorage — the page's autosave slot, when it
// was written, the time and the selection — so the next page of the same tab restores it **silently**: `file.recover`
// of that slot (an orphan once its page is gone), the frame and the selection again, the stage from the session
// mirror, and one toast, *Back where you were · 2 min ago*. 0 touches. Any other orphaned slot is Home › Continue
// (`./model`); Halo never shows the Recovery dialog (the host's hook offers Home, `./start`).
//
// The camera comes back to its framing: the viewport keeps no camera across a reload (an API patch, P-T11-3).
import type { AutosaveSlotInfo, EditorApp } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { agoText } from './model';

export const HALO_RESUME_KEY = 'ekza-studio:halo:resume:v1';

/** What this tab remembers of its open project. */
export interface ResumeRecord {
  readonly slot: string;
  readonly savedAt: number;
  readonly projectName: string;
  readonly frame: number | null;
  readonly selection: {
    readonly controls: readonly string[];
    readonly objects: readonly string[];
    readonly joints: readonly string[];
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStore(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export function readResume(storage: StorageLike | null): ResumeRecord | null {
  try {
    const raw = storage?.getItem(HALO_RESUME_KEY);
    if (raw === null || raw === undefined) return null;
    const v = JSON.parse(raw) as Partial<ResumeRecord> & { selection?: Partial<ResumeRecord['selection']> };
    if (typeof v.slot !== 'string' || typeof v.savedAt !== 'number') return null;
    return {
      slot: v.slot,
      savedAt: v.savedAt,
      projectName: typeof v.projectName === 'string' ? v.projectName : '',
      frame: typeof v.frame === 'number' ? v.frame : null,
      selection: {
        controls: strings(v.selection?.controls),
        objects: strings(v.selection?.objects),
        joints: strings(v.selection?.joints),
      },
    };
  } catch {
    return null;
  }
}

function writeResume(storage: StorageLike | null, record: ResumeRecord | null): void {
  try {
    if (record === null) storage?.removeItem(HALO_RESUME_KEY);
    else storage?.setItem(HALO_RESUME_KEY, JSON.stringify(record));
  } catch {
    // blocked storage: the record is a convenience
  }
}

/** This page's record (the slot the autosave wrote last, with the time and the selection now). */
export function recordOf(app: EditorApp): ResumeRecord | null {
  const s = app.session.getState();
  if (s.autosave.slot === null || s.autosave.lastSavedAt === null) return null;
  return {
    slot: s.autosave.slot,
    savedAt: s.autosave.lastSavedAt,
    projectName: s.projectName,
    frame: s.time.sceneFrame,
    selection: {
      controls: [...s.selection.controls],
      objects: [...s.selection.objects],
      joints: [...s.selection.joints],
    },
  };
}

/** The orphaned slot this tab's record names, or null. */
export function resumable(record: ResumeRecord | null, recovery: readonly AutosaveSlotInfo[]): AutosaveSlotInfo | null {
  if (record === null) return null;
  return recovery.find((slot) => slot.id === record.slot) ?? null;
}

const documentEmpty = (app: EditorApp): boolean =>
  app.store.list('characters').length === 0 && app.store.list('meshes').length === 0;

export interface Resume {
  /** True while a silent restore is under way or done (the recovery hook then leaves Home alone). */
  readonly restoring: () => boolean;
  /** Starts watching; the disposer stops. */
  readonly start: () => () => void;
}

export function createResume(controller: HaloController, storage: StorageLike | null = sessionStore()): Resume {
  const { ctx } = controller;
  const { app } = ctx;
  // the previous page's record, read once before this page writes its own
  const previous = readResume(storage);
  let attempted = false;
  let restoring = false;

  const restore = async (slot: AutosaveSlotInfo, record: ResumeRecord): Promise<void> => {
    restoring = true;
    const result = await ctx.run('file.recover', { slot: slot.id });
    if (result.status !== 'finished') {
      restoring = false;
      return;
    }
    ctx.store.set({ home: false });
    // the stage is the session mirror's (the controller's arrival); the time and the selection are this record's
    const stage = ctx.store.get().stage;
    await controller.enterStage(stage);
    if (record.frame !== null) await app.runUntyped('time.setFrame', { frame: record.frame, unit: 'scene' });
    const live = <T extends 'controls' | 'meshes' | 'joints'>(table: T, ids: readonly string[]): string[] =>
      ids.filter((id) => (app.store as unknown as { get(t: string, i: string): unknown }).get(table, id) !== undefined);
    const controls = live('controls', record.selection.controls);
    const objects = record.selection.objects.filter(
      (id) =>
        (app.store as unknown as { get(t: string, i: string): unknown }).get(
          id.startsWith('grp_') ? 'groups' : 'meshes',
          id,
        ) !== undefined,
    );
    const joints = live('joints', record.selection.joints);
    if (controls.length > 0) await app.runUntyped('select.controls', { ids: controls, mode: 'replace' });
    if (objects.length > 0) await app.runUntyped('select.objects', { ids: objects, mode: 'replace' });
    if (joints.length > 0) await app.runUntyped('select.joints', { ids: joints, mode: 'replace' });
    ctx.toasts.push({ key: 'resume', text: en.home.back(agoText(slot.savedAt, Date.now())) });
  };

  const check = (): void => {
    if (attempted || !documentEmpty(app)) return;
    const slot = resumable(previous, app.session.getState().recovery);
    if (slot === null || previous === null) return;
    attempted = true;
    void restore(slot, previous);
  };

  return {
    restoring: () => restoring || (!attempted && resumable(previous, app.session.getState().recovery) !== null),
    start() {
      check();
      const offs = [
        app.session.subscribe((state, prior) => {
          if (state.recovery !== prior.recovery) check();
          // this page's record follows its autosave writes (and the time and selection at each)
          if (
            state.autosave.lastSavedAt !== prior.autosave.lastSavedAt ||
            state.autosave.slot !== prior.autosave.slot
          ) {
            const record = recordOf(app);
            if (record !== null) writeResume(storage, record);
          }
        }),
      ];
      // the time and selection as they are when the page hides (iPadOS may discard it, S24)
      const onHide = (): void => {
        const record = recordOf(app);
        if (record !== null) writeResume(storage, record);
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', onHide);
        offs.push(() => window.removeEventListener('pagehide', onHide));
      }
      return () => {
        for (const off of offs) off();
      };
    },
  };
}
