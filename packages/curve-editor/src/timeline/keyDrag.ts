// One key-retiming drag as one undo step (MVP-SPEC §4.11.0 "Drags use store.beginPreview …"): the edit kernel runs
// inside preview updates, the final update resolves collisions, the commit becomes one document undo entry and the
// gesture records exactly one editor-history step.
import { EkzaError } from '@ekza-studio/anim-core';
import type { PreviewSession, Tx } from '@ekza-studio/doc';
import { type EditorApp, selectionSnapshot } from '@ekza-studio/editor-core';

export class KeyDrag {
  private preview: PreviewSession | null = null;
  private selectionBefore: unknown = undefined;
  private failed = false;

  constructor(
    private readonly app: EditorApp,
    private readonly label: string,
  ) {}

  /** False once the drag failed or its preview was cancelled from outside (Esc → `edit.escape`). */
  get alive(): boolean {
    return !this.failed && (this.preview === null || this.preview.active);
  }

  /** Re-applies `edit` on top of the committed document (the preview starts on the first call). */
  update(edit: (tx: Tx) => void): boolean {
    if (!this.alive) return false;
    try {
      if (this.preview === null) {
        if (this.app.store.readOnly) throw new EkzaError('read-only', 'The project is open read-only');
        this.selectionBefore = selectionSnapshot(this.app.session.getState().selection);
        this.preview = this.app.store.beginPreview(this.label);
      }
      this.preview.update(edit);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  /**
   * Applies `final` (the update with `resolveCollisions: true`), commits and records the history step. Returns false
   * when nothing was committed because the drag failed or was cancelled.
   */
  commit(final: (tx: Tx) => void): boolean {
    if (this.preview === null) return this.alive;
    if (!this.update(final)) return false;
    const preview: PreviewSession | null = this.preview;
    if (preview === null) return false;
    try {
      const selection = selectionSnapshot(this.app.session.getState().selection);
      const batch = preview.commit({
        label: this.label,
        selectionBefore: this.selectionBefore,
        selectionAfter: selection,
      });
      if (batch !== null) this.app.history.record({ label: this.label, docTxId: batch.txId, overrides: null });
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.preview = null;
    }
  }

  cancel(): void {
    const preview = this.preview;
    this.preview = null;
    if (preview?.active === true) preview.cancel();
  }

  private fail(error: unknown): void {
    this.failed = true;
    this.cancel();
    const message = error instanceof Error ? error.message : String(error);
    this.app.services.notify.toast({ kind: 'error', text: `${this.label} failed: ${message}` });
  }
}
