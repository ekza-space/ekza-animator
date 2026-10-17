// '@ekza-animator/doc/testing' (Node only; may use node:fs). Final signatures (MVP-SPEC §7 WP-2). The fixture
// helpers are the shared test kit (WP-0b); the conformance suite, the test network and makeTestDocument are WP-2 and
// throw until they land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ConformanceCaps, DocSnapshot, DocumentStore, ReplicaNetwork, ReplicatingStore } from '../store';

export {
  fixturePath,
  type LicensedFixture,
  readFixture,
  readSyntheticFixture,
  type SyntheticFixture,
} from './fixtures';

export function runDocumentStoreConformance(
  _label: string,
  _factory: () => DocumentStore,
  _caps: ConformanceCaps,
): void {
  throw new EkzaError('not-implemented', 'doc/testing.runDocumentStoreConformance');
}

export function createTestNetwork(
  _n: number,
  _factory: (replicaId: string) => ReplicatingStore,
  _opts?: { readonly seed?: number },
): ReplicaNetwork {
  throw new EkzaError('not-implemented', 'doc/testing.createTestNetwork');
}

export function makeTestDocument(_opts?: {
  readonly characters?: number;
  readonly controlsPerRig?: number;
  readonly keysPerCurve?: number;
}): DocSnapshot {
  throw new EkzaError('not-implemented', 'doc/testing.makeTestDocument');
}
