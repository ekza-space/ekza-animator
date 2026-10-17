// Attribution of document undo entries to history steps. Every local batch is classified against the doc undo
// stack: it created a new top entry, was coalesced into the top entry (same txId, new entry object), made the top
// entry disappear (coalesced edits that cancelled out), or entered no stack (`undoable: false`, empty).
//
// Inside a scope (an operator's apply, a gesture commit) the outcome goes to the scope's owner, which records ONE
// step with its override delta. Outside any scope (a panel or tool calling `store.transact` / committing a preview
// itself) the commit becomes a step of its own, so Mod+Z never skips a document change and "one gesture = one undo
// step" holds for every writer.
//
// A document load (`store.load`) clears the history. When the doc undo stacks are emptied without a load batch (a
// load that changed nothing visible, `undo.clear()`), the history steps lose their document parts: no entry they
// could own exists any more.
import type { ChangeBatch, DocumentStore, UndoEntry } from '@ekza-animator/doc';
import { isDocumentLoad } from '../session/loads';
import type { KernelHistory } from './history';

export type CaptureOutcome =
  | { readonly kind: 'new'; readonly txId: string; readonly label: string }
  | { readonly kind: 'coalesced'; readonly txId: string; readonly label: string }
  | { readonly kind: 'removed'; readonly txId: string }
  | { readonly kind: 'none' };

export interface CaptureScope {
  /** Local batches committed while the scope was open, oldest first. */
  readonly batches: ChangeBatch[];
  /** A document load replaced the document while the scope was open. */
  loaded: boolean;
  /** Doc undo top entry (the object) when the scope opened. */
  readonly topBefore: UndoEntry | null;
}

export interface DocCapture {
  begin(): CaptureScope;
  /** Closes the scope and classifies what its batches did to the doc undo stack. */
  end(scope: CaptureScope): CaptureOutcome;
  /** Attributes direct commits whose undo entry appeared after their batch was emitted. */
  reconcile(): void;
  /** Re-reads the doc undo top after the history navigated it (an undo may skip every change and emit no batch). */
  sync(): void;
  dispose(): void;
}

export function createDocCapture(store: DocumentStore, history: () => KernelHistory): DocCapture {
  const scopes: CaptureScope[] = [];
  /** Doc undo top entry after the last batch (or navigation) the capture saw. */
  let lastTop: UndoEntry | null = store.undo.peekUndo();
  /** Direct commits that did not (yet) show an undo entry, by txId. */
  const pending = new Map<string, string>();

  const apply = (outcome: CaptureOutcome): void => {
    switch (outcome.kind) {
      case 'new':
        history().record({ label: outcome.label, docTxId: outcome.txId, overrides: null });
        break;
      case 'coalesced':
        // Extends the step that owns the entry (or takes the entry over, past an override-only step).
        if (history().owns(outcome.txId))
          history().record({ label: outcome.label, docTxId: outcome.txId, overrides: null });
        break;
      case 'removed':
        history().forgetDocEntry(outcome.txId);
        break;
      case 'none':
        break;
    }
  };

  const reconcile = (): void => {
    if (pending.size === 0) return;
    const top = store.undo.peekUndo();
    const label = top === null ? undefined : pending.get(top.txId);
    pending.clear();
    if (top !== null && label !== undefined && !history().owns(top.txId)) {
      history().record({ label, docTxId: top.txId, overrides: null });
    }
    lastTop = top;
  };

  const unsubscribeBatches = store.subscribe((batch) => {
    if (batch.origin === 'load') {
      // Partition visibility changes are 'load' batches too; only a document load resets the history.
      if (isDocumentLoad(store, batch)) {
        pending.clear();
        for (const scope of scopes) scope.loaded = true;
        history().clear();
      }
    } else if (batch.origin === 'local') {
      const scope = scopes.at(-1);
      if (scope !== undefined) {
        scope.batches.push(batch);
      } else {
        reconcile();
        const outcome = classify(store.undo.peekUndo(), lastTop, [batch]);
        if (outcome.kind === 'none') pending.set(batch.txId, batch.label);
        apply(outcome);
      }
    }
    lastTop = store.undo.peekUndo();
  });
  const unsubscribeUndo = store.undo.subscribe(() => {
    if (store.undo.canUndo() || store.undo.canRedo()) return;
    pending.clear();
    history().forgetDocEntries();
  });

  return {
    begin(): CaptureScope {
      reconcile();
      const scope: CaptureScope = { batches: [], loaded: false, topBefore: store.undo.peekUndo() };
      scopes.push(scope);
      return scope;
    },
    end(scope: CaptureScope): CaptureOutcome {
      const index = scopes.lastIndexOf(scope);
      if (index !== -1) scopes.splice(index, 1);
      lastTop = store.undo.peekUndo();
      if (scope.loaded) return { kind: 'none' };
      return classify(lastTop, scope.topBefore, scope.batches);
    },
    reconcile,
    sync(): void {
      lastTop = store.undo.peekUndo();
    },
    dispose(): void {
      unsubscribeBatches();
      unsubscribeUndo();
      scopes.length = 0;
      pending.clear();
    },
  };
}

/**
 * What `batches` (local, in commit order) did to the doc undo stack whose top entry was `before`. Stores replace the
 * top entry object when they coalesce a transaction into it (same txId); a commit that entered no stack
 * (`undoable: false`) leaves the very same object on top.
 */
export function classify(
  top: UndoEntry | null,
  before: UndoEntry | null,
  batches: readonly ChangeBatch[],
): CaptureOutcome {
  if (batches.length === 0) return { kind: 'none' };
  if (top !== null) {
    if (batches.some((batch) => batch.txId === top.txId)) return { kind: 'new', txId: top.txId, label: top.label };
    if (before !== null && top.txId === before.txId) {
      return top === before ? { kind: 'none' } : { kind: 'coalesced', txId: top.txId, label: top.label };
    }
  }
  if (before !== null && top?.txId !== before.txId) return { kind: 'removed', txId: before.txId };
  return { kind: 'none' };
}
