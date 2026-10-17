// Replica harness for the conformance suite: N Yjs stores, one user each, on the shared test network.
import type { ReplicaHarness, UserId } from '@ekza-animator/doc';
import { createTestNetwork } from '@ekza-animator/doc/testing';
import { createYjsStore } from '../store';

export function yjsHarness(): ReplicaHarness {
  return {
    create: (n, opts) =>
      createTestNetwork(n, (replicaId) => createYjsStore({ replicaId, user: `user-${replicaId}` as UserId }), opts),
  };
}
