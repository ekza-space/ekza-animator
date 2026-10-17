// WP-2 stub: final signature (MVP-SPEC §7 WP-2); throws until the replica harness lands.
import { EkzaError, type ReplicaHarness } from '@ekza-animator/doc';

export function yjsHarness(): ReplicaHarness {
  throw new EkzaError('not-implemented', 'doc-yjs.yjsHarness');
}
