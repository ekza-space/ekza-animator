// doc-yjs runs the full conformance suite, replicating part included (MVP-SPEC §6.3 doc gate, ADR 0002 §5–6).
import { runDocumentStoreConformance } from '@ekza-studio/doc/testing';
import { createYjsStore, yjsHarness } from '../src';

let next = 0;
runDocumentStoreConformance('yjs store', () => createYjsStore({ replicaId: `solo-${next++}` }), {
  replicating: true,
  harness: yjsHarness(),
});
