// '@ekza-animator/doc/testing' (Node only; may use node:fs). Final signatures (MVP-SPEC §7 WP-2); the conformance
// suite and test network are WP-2, the fixture helpers WP-0b. Bodies throw until they land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ConformanceCaps, DocSnapshot, DocumentStore, ReplicaNetwork, ReplicatingStore } from '../store';

export type LicensedFixture = 'seed-san.vrm' | 'polybot.vrm' | 'quaternius-ual.glb' | 'quaternius-idle-meshopt.glb';
export type SyntheticFixture = 'humanoid-skeleton.json' | 'wave-doc.json' | 'rest-pose.json';

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

export function fixturePath(_name: LicensedFixture): string {
  throw new EkzaError('not-implemented', 'doc/testing.fixturePath');
}

export function readFixture(_name: LicensedFixture): Uint8Array {
  throw new EkzaError('not-implemented', 'doc/testing.readFixture');
}

export function readSyntheticFixture(_name: SyntheticFixture): unknown {
  throw new EkzaError('not-implemented', 'doc/testing.readSyntheticFixture');
}

export function makeTestDocument(_opts?: {
  readonly characters?: number;
  readonly controlsPerRig?: number;
  readonly keysPerCurve?: number;
}): DocSnapshot {
  throw new EkzaError('not-implemented', 'doc/testing.makeTestDocument');
}
