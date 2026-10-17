// Attribution of document undo entries to history steps. Every local batch is classified against the doc undo
// stack: it created a new top entry, was coalesced into the top entry, made the top entry disappear (coalesced edits
// that cancelled out), or entered no stack (`undoable: false`, empty).
//
// Inside a scope (an operator's apply, a gesture commit) the outcome goes to the scope's owner, which records ONE
// step with its override delta. Outside any scope (a panel or tool calling `store.transact` / committing a preview
// itself) the commit becomes a step of its own, so Mod+Z never skips a document change and "one gesture = one undo
// step" holds for every writer.
import type { AnyChange, ChangeBatch, DocumentStore, UndoEntry } from '@ekza-animator/doc';
import type { KernelHistory } from './history';

export type CaptureOutcome =
  | { readonly kind: 'new'; readonly txId: string; readonly label: string }
  | { readonly kind: 'coalesced'; readonly txId: string; readonly label: string }
  | { readonly kind: 'removed'; readonly txId: string }
  | { readonly kind: 'none' };

export interface CaptureScope {
  /** Local batches committed while the scope was open, oldest first. */
  readonly batches: ChangeBatch[];
  /** A `load` batch replaced the document while the scope was open. */
  loaded: boolean;
  /** Doc undo top when the scope opened. */
  readonly topBefore: string | null;
}

export interface DocCapture {
  begin(): CaptureScope;
  /** Closes the scope and classifies what its batches did to the doc undo stack. */
  end(scope: CaptureScope): CaptureOutcome;
  /** Attributes direct commits whose undo entry appeared after their batch was emitted. */
  reconcile(): void;
  dispose(): void;
}

export function createDocCapture(store: DocumentStore, history: () => KernelHistory): DocCapture {
  const scopes: CaptureScope[] = [];
  /** Doc undo top after the last batch the capture saw. */
  let lastTop: string | null = topTxId(store);
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
    lastTop = top?.txId ?? null;
  };

  const unsubscribe = store.subscribe((batch) => {
    if (batch.origin === 'load') {
      pending.clear();
      for (const scope of scopes) scope.loaded = true;
      history().clear();
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
    lastTop = topTxId(store);
  });

  return {
    begin(): CaptureScope {
      reconcile();
      const scope: CaptureScope = { batches: [], loaded: false, topBefore: topTxId(store) };
      scopes.push(scope);
      return scope;
    },
    end(scope: CaptureScope): CaptureOutcome {
      const index = scopes.lastIndexOf(scope);
      if (index !== -1) scopes.splice(index, 1);
      lastTop = topTxId(store);
      if (scope.loaded) return { kind: 'none' };
      return classify(store.undo.peekUndo(), scope.topBefore, scope.batches);
    },
    reconcile,
    dispose(): void {
      unsubscribe();
      scopes.length = 0;
      pending.clear();
    },
  };
}

/** What `batches` (local, in commit order) did to the doc undo stack whose top was `topBefore`. */
export function classify(
  top: UndoEntry | null,
  topBefore: string | null,
  batches: readonly ChangeBatch[],
): CaptureOutcome {
  if (batches.length === 0) return { kind: 'none' };
  if (top !== null) {
    const created = batches.find((batch) => batch.txId === top.txId);
    if (created !== undefined) return { kind: 'new', txId: top.txId, label: top.label };
    if (top.txId === topBefore && batches.every((batch) => entryTouches(top, batch.changes))) {
      return { kind: 'coalesced', txId: top.txId, label: top.label };
    }
  }
  if (topBefore !== null && top?.txId !== topBefore) return { kind: 'removed', txId: topBefore };
  return { kind: 'none' };
}

/**
 * True when every change of the batch lands in the entry: the same record and, for field updates, only fields the
 * entry already covers (a coalesced write). A commit that bypassed the undo stack touches other records or fields.
 */
function entryTouches(entry: UndoEntry, changes: readonly AnyChange[]): boolean {
  if (changes.length === 0) return false;
  const byRecord = new Map(entry.changes.map((change) => [`${change.table}\u0000${change.id}`, change] as const));
  return changes.every((change) => {
    const covered = byRecord.get(`${change.table}\u0000${change.id}`);
    if (covered === undefined) return false;
    if (change.fields === undefined || covered.fields === undefined) return true;
    return change.fields.every((field) => covered.fields?.includes(field) === true);
  });
}

function topTxId(store: DocumentStore): string | null {
  return store.undo.peekUndo()?.txId ?? null;
}
