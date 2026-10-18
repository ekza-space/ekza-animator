// Telling a document load apart from other 'load' batches. `store.load(snapshot)` replaces the document and clears
// the doc undo stacks (MVP-SPEC §4.2); stores also report partition visibility changes (open/close, records revealed
// by a write that opened their partition) with origin 'load', and those leave the undo stacks alone. A 'load' batch
// that leaves undo or redo entries is therefore never a document load. (One left with both stacks empty is treated
// as one: nothing is lost, as no document change could be undone anyway.)
import type { ChangeBatch, DocumentStore } from '@ekza-animator/doc';

export function isDocumentLoad(store: DocumentStore, batch: ChangeBatch): boolean {
  return batch.origin === 'load' && !store.undo.canUndo() && !store.undo.canRedo();
}
