// Share's two-step save (STUDIO-TOUCH-SPEC §13.3, S9, S24, ST-21, ST-33; T0's `SaveTicket`): choosing a card prepares
// its file at once — the export operator runs with the file service's `download` held, so its bytes stay in the page —
// and a `SaveTicket` (`FileService.save`) holds them; the export button delivers the ticket from its own tap, a fresh
// user activation: the iOS share sheet (`canShare` + `share({files})`, a download after ~10 s or a refusal), a
// download elsewhere. The operator is the one Studio Pro or Auto-Rig runs, with their arguments, so the bytes are
// theirs (AS-ST-5); the export's own toasts are held too (the card says what happened). An export never touches the
// unsaved dot: only a project save does (`file.save`).
import type { EditorApp, FileService, Notifier, OperatorResult, SaveTicket } from '@ekza-studio/editor-core';
import type { ShareCall } from './model';

/** A file an export handed to `download`. */
export interface HeldFile {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** A lint of the written file, as the card lists it. */
export interface BakeLint {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

export type BakeStatus = 'idle' | 'preparing' | 'ready' | 'blocked' | 'failed';

/** What the export button shows (§13.3: it names the file it writes). */
export interface BakeState {
  readonly status: BakeStatus;
  /** The call's key (op, arguments, document version) this state is for. */
  readonly key: string | null;
  readonly fileName: string | null;
  readonly bytes: number;
  readonly lints: readonly BakeLint[];
  /** Why there is no file: the export's refusal or its first blocking lint. */
  readonly reason: string | null;
  /** How the file left, once it has (a later change prepares a new one). */
  readonly delivered: 'shared' | 'downloaded' | null;
}

export const IDLE: BakeState = {
  status: 'idle',
  key: null,
  fileName: null,
  bytes: 0,
  lints: [],
  reason: null,
  delivered: null,
};

type Runner = (op: string, args: unknown) => Promise<OperatorResult<unknown>>;

/** Runs `run` with the app's `download` and toasts held; nothing leaves the page. */
export async function holdingFiles(
  app: EditorApp,
  run: () => Promise<OperatorResult<unknown>>,
): Promise<{
  readonly result: OperatorResult<unknown>;
  readonly files: readonly HeldFile[];
  readonly toasts: readonly Parameters<Notifier['toast']>[0][];
}> {
  const files: HeldFile[] = [];
  const toasts: Parameters<Notifier['toast']>[0][] = [];
  const service: { download: FileService['download'] } = app.services.files;
  const notifier: { toast: Notifier['toast'] } = app.services.notify;
  // the services' own functions, put back as they were (not bound copies)
  const original = { download: service.download, toast: notifier.toast };
  const toast: Notifier['toast'] = (t) => original.toast.call(notifier, t);
  const heldDownload: FileService['download'] = (name, bytes, mime) => {
    files.push({ name, bytes, mime });
  };
  const heldToast: Notifier['toast'] = (t) => {
    toasts.push(t);
  };
  service.download = heldDownload;
  notifier.toast = heldToast;
  try {
    const result = await run();
    return { result, files, toasts };
  } finally {
    if (service.download === heldDownload) service.download = original.download;
    if (notifier.toast === heldToast) notifier.toast = original.toast;
    // a toast that is not about this export (another run's) still reaches the person
    for (const t of toasts) if (!/^Exported |was not saved: /.test(t.text)) toast(t);
  }
}

/** The lints a call's result carries (each export operator returns them in its own shape). */
export function lintsOf(value: unknown): readonly BakeLint[] {
  const out: BakeLint[] = [];
  const add = (lints: unknown): void => {
    if (!Array.isArray(lints)) return;
    for (const lint of lints as { code?: unknown; severity?: unknown; message?: unknown }[]) {
      if (typeof lint?.code !== 'string') continue;
      const severity = lint.severity === 'error' || lint.severity === 'warning' ? lint.severity : 'info';
      out.push({ code: lint.code, severity, message: typeof lint.message === 'string' ? lint.message : lint.code });
    }
  };
  if (Array.isArray(value)) for (const artifact of value as { lints?: unknown }[]) add(artifact?.lints);
  else if (typeof value === 'object' && value !== null) add((value as { lints?: unknown }).lints);
  const seen = new Set<string>();
  return out.filter((lint) => {
    const key = `${lint.severity}:${lint.code}:${lint.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One file for a ticket: a single export file as it is (several only for a format that writes several). */
function single(files: readonly HeldFile[]): HeldFile | null {
  return files.length === 0 ? null : (files.at(-1) as HeldFile);
}

export interface Baker {
  readonly get: () => BakeState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Prepares the call's file now (a newer call waits for the running one, then replaces it). */
  readonly prepare: (value: ShareCall, key: string) => void;
  /** Forgets the prepared file (the card changed to one without a call). */
  readonly clear: () => void;
  /** Delivers the prepared file from a tap (the ticket's share or download); null when none is ready. */
  readonly deliver: () => Promise<'shared' | 'downloaded' | 'cancelled' | null>;
}

/** The baker of one Share sheet: one prepared file at a time, re-prepared when the call or the document changes. */
export function createBaker(app: EditorApp, run: Runner): Baker {
  let state: BakeState = IDLE;
  let ticket: SaveTicket | null = null;
  let held: HeldFile | null = null;
  let running = false;
  let queued: { readonly value: ShareCall; readonly key: string } | null = null;
  const listeners = new Set<() => void>();
  const set = (next: BakeState): void => {
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };

  const bake = async (value: ShareCall, key: string): Promise<void> => {
    running = true;
    ticket = null;
    held = null;
    set({ ...IDLE, status: 'preparing', key });
    try {
      const { result, files } = await holdingFiles(app, () => run(value.op, value.args));
      if (queued !== null) return;
      if (result.status !== 'finished') {
        set({
          ...IDLE,
          status: 'failed',
          key,
          reason: result.status === 'failed' ? result.error.message : result.reason,
        });
        return;
      }
      const lints = lintsOf(result.value);
      const file = single(files);
      if (file === null) {
        const error = lints.find((lint) => lint.severity === 'error');
        set({ ...IDLE, status: 'blocked', key, lints, reason: error?.message ?? null });
        return;
      }
      held = file;
      const service = app.services.files;
      ticket =
        service.save === undefined ? null : service.save({ name: file.name, mime: file.mime, bytes: file.bytes });
      set({
        status: 'ready',
        key,
        fileName: file.name,
        bytes: file.bytes.byteLength,
        lints,
        reason: null,
        delivered: null,
      });
    } catch (error) {
      set({ ...IDLE, status: 'failed', key, reason: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
      const next = queued;
      queued = null;
      if (next !== null) void bake(next.value, next.key);
    }
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prepare: (value, key) => {
      if (state.key === key && state.status !== 'failed') return;
      if (running) {
        queued = { value, key };
        if (state.status !== 'preparing') set({ ...IDLE, status: 'preparing', key });
        return;
      }
      void bake(value, key);
    },
    clear: () => {
      queued = null;
      ticket = null;
      held = null;
      if (!running) set(IDLE);
    },
    deliver: async () => {
      if (state.status !== 'ready' || held === null) return null;
      const file = held;
      let how: 'shared' | 'downloaded' | 'cancelled';
      if (ticket !== null) how = await ticket.deliver();
      else {
        // a host without tickets (Node, harnesses): the plain download
        app.services.files.download(file.name, file.bytes, file.mime);
        how = 'downloaded';
      }
      if (how !== 'cancelled' && state.status === 'ready') set({ ...state, delivered: how });
      return how;
    },
  };
}
