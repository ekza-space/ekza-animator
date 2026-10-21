// Document-store conformance suite (MVP-SPEC §7 WP-2, ADR 0002 §5): every DocumentStore implementation runs the
// non-replicating part; replicating stores (caps.replicating) also run the replicating part against caps.harness.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ConformanceCaps, DocumentStore } from '../../store';
import { registerCoreCases } from './core';
import { hostRunner } from './harness';
import { registerReplicatingCases } from './replicating';
import { registerSchemaV3Cases, registerSchemaV3ReplicatingCases } from './schemaV3';
// M6a B7: the opaque mesh-ref cases (testing/meshRefs.ts).
import { registerMeshRefCases, registerMeshRefReplicatingCases } from '../meshRefs';

/**
 * Registers the suite with the host test runner's global `describe`/`it` (Vitest needs `globals: true`). `factory`
 * must return a fresh, empty store on every call.
 */
export function runDocumentStoreConformance(label: string, factory: () => DocumentStore, caps: ConformanceCaps): void {
  if (caps.replicating && caps.harness === undefined) {
    throw new EkzaError('unsupported', 'runDocumentStoreConformance: a replicating store needs caps.harness');
  }
  const runner = hostRunner();
  runner.describe(`DocumentStore conformance: ${label}`, () => {
    registerCoreCases(runner, factory);
    registerSchemaV3Cases(runner, factory);
    registerMeshRefCases(runner, factory);
    if (caps.replicating) {
      registerReplicatingCases(runner, caps);
      registerSchemaV3ReplicatingCases(runner, caps);
      registerMeshRefReplicatingCases(runner, caps);
    }
  });
}
