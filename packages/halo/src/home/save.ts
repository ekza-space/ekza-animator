// Save project to Files (STUDIO-TOUCH-SPEC §13.3, §17, S11, ST-22, ST-33; T11): the project menu's and Share's footer
// action. It is `file.save` — the `.ekzanim` with its models — and only it clears the unsaved dot. Off iOS the file
// downloads; on iOS the host's save prompt (T0) holds it until a fresh tap shares it to Files (two steps: this tap
// prepares, the prompt's *Save to Files* delivers). After the first save on an iPad, a card offers *Keep projects on
// this iPad* (`storage.persist()`, D12), then — only after that Files backup — *Add to Home Screen*, with the warning
// that the Home Screen app keeps its own projects (S12). The card's state is this device's (localStorage).
import { isIosWebKit, requestPersistentStorage, sharePreferred } from '@ekza-studio/editor/host';
import { en } from '../i18n/en';
import type { ShellContext } from '../shell/context';
import { commitSession } from '../session/sessions';
import type { StorageCard } from '../sheets/share';

export const HALO_STORAGE_KEY = 'ekza-studio:halo:storage:v1';
export const HALO_AUTHOR_KEY = 'ekza-studio:halo:author:v1';

interface StorageRecord {
  /** A project was saved to a file on this device. */
  readonly backedUp: boolean;
  /** The answer of `storage.persist()` (null: not asked yet). */
  readonly kept: boolean | null;
  readonly dismissed: boolean;
}

const EMPTY: StorageRecord = { backedUp: false, kept: null, dismissed: false };

function local(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(): StorageRecord {
  try {
    const raw = local()?.getItem(HALO_STORAGE_KEY);
    if (raw === null || raw === undefined) return EMPTY;
    const v = JSON.parse(raw) as Partial<StorageRecord>;
    return {
      backedUp: v.backedUp === true,
      kept: typeof v.kept === 'boolean' ? v.kept : null,
      dismissed: v.dismissed === true,
    };
  } catch {
    return EMPTY;
  }
}

function write(record: StorageRecord): void {
  try {
    local()?.setItem(HALO_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // blocked: the card comes back next time
  }
}

const standalone = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
};

/** Which storage card shows (§17): none off iOS, before the first project save, or once dismissed. */
export function storageCardOf(record: StorageRecord, ios: boolean, isStandalone: boolean): StorageCard {
  if (!ios || !record.backedUp || record.dismissed) return 'hidden';
  if (record.kept === null) return 'keep';
  return isStandalone ? 'hidden' : 'homeScreen';
}

export interface StorageCardStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly get: () => StorageCard;
  readonly markBackedUp: () => void;
  readonly keep: () => Promise<void>;
  readonly dismiss: () => void;
}

export function createStorageCard(toast: (text: string) => void): StorageCardStore {
  let record = read();
  let card = storageCardOf(record, isIosWebKit(), standalone());
  const listeners = new Set<() => void>();
  const set = (next: StorageRecord): void => {
    record = next;
    write(record);
    card = storageCardOf(record, isIosWebKit(), standalone());
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => card,
    markBackedUp() {
      if (!record.backedUp) set({ ...record, backedUp: true });
    },
    async keep() {
      const kept = await requestPersistentStorage();
      set({ ...record, kept: kept === true });
      toast(kept === true ? en.share.kept : en.share.notKept);
    },
    dismiss() {
      set({ ...record, dismissed: true });
    },
  };
}

/** The author this device remembers (asked once, §13.3; Auto-Rig ⑤ remembers its own the same way). */
export const rememberedAuthor: { readonly get: () => string | null; readonly set: (name: string) => void } = {
  get: (): string | null => {
    try {
      const value = local()?.getItem(HALO_AUTHOR_KEY);
      return value === null || value === undefined || value.trim() === '' ? null : value;
    } catch {
      return null;
    }
  },
  set: (name: string): void => {
    try {
      local()?.setItem(HALO_AUTHOR_KEY, name);
    } catch {
      // blocked: asked again next time
    }
  },
};

/** *Save project to Files*: commits an open tool session (P15), then `file.save`; the storage card follows. */
export async function saveProject(ctx: ShellContext, storage: StorageCardStore): Promise<boolean> {
  await commitSession(ctx);
  const result = await ctx.run('file.save');
  if (result.status !== 'finished') return false;
  storage.markBackedUp();
  // iOS: the host's save prompt says how the file left; elsewhere the download is the file
  if (!sharePreferred()) {
    const name = (result.value as { fileName?: string } | undefined)?.fileName ?? '';
    ctx.toasts.push({ key: 'save', text: en.share.saved(name) });
  }
  return true;
}
