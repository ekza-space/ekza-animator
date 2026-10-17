// The memory store runs the non-replicating half of the conformance suite (MVP-SPEC §6.3 doc gate).
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../src';
import { runDocumentStoreConformance } from '../src/testing';

runDocumentStoreConformance('memory store', () => createMemoryStore(), { replicating: false });

describe('runDocumentStoreConformance', () => {
  it('refuses a replicating run without a harness', () => {
    expect(() => runDocumentStoreConformance('broken', () => createMemoryStore(), { replicating: true })).toThrow(
      'a replicating store needs caps.harness',
    );
  });
});
