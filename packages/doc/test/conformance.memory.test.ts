// The memory store runs the non-replicating half of the conformance suite (MVP-SPEC §6.3 doc gate).
import { createMemoryStore } from '../src';
import { runDocumentStoreConformance } from '../src/testing';

runDocumentStoreConformance('memory store', () => createMemoryStore(), { replicating: false });
