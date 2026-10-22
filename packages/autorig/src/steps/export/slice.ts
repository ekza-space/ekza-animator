// The ⑤ `export` slice and its reducers (AUTORIG-SPEC §4.3, §10.0 "Session"; D6): the chosen target and whether the
// last download of this subject succeeded (the stepper's card check). U state, never in the document; the session
// store (D3) stores and mirrors it generically through `patch('export', …)`.
import type { AutoRigSessionStore } from '../../session';
import type { AutoRigExportSlice, AutoRigExportTarget } from '../../types';

/** The default: the recommended target, nothing downloaded. */
export const EXPORT_SLICE: AutoRigExportSlice = { target: 'ekza-vrm', downloaded: false };

/** Chooses a target; a new choice clears the download check (it was for another file). */
export function chooseTarget(session: AutoRigSessionStore, target: AutoRigExportTarget): void {
  const current = session.getState().export;
  if (current.target === target) return;
  session.patch('export', { target, downloaded: false });
}

/** Records a download of the current target (saved, or blocked by an error lint). */
export function recordDownload(session: AutoRigSessionStore, saved: boolean): void {
  if (session.getState().export.downloaded === saved) return;
  session.patch('export', { downloaded: saved });
}

/** The target the step shows: the chosen one when it is available, else the first available one (null: none). */
export function shownTarget(
  slice: AutoRigExportSlice,
  available: readonly AutoRigExportTarget[],
): AutoRigExportTarget | null {
  return available.includes(slice.target) ? slice.target : (available[0] ?? null);
}

/** What a download was written from: the character, the target and the document version. */
export interface DownloadKey {
  readonly character: string;
  readonly target: AutoRigExportTarget;
  readonly version: number;
}

/**
 * The last download while it still describes the file *Download* would write now: same character, same target, same
 * document version. A later edit (or another target) drops it, and with it its byte rows: a blocked download keeps
 * *Download* disabled (its error row) until the document changes.
 */
export function currentDownload<T extends DownloadKey>(
  last: T | null,
  character: string | null,
  target: AutoRigExportTarget | null,
  version: number,
): T | null {
  return last !== null && last.character === character && last.target === target && last.version === version
    ? last
    : null;
}
