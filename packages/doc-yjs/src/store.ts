// WP-2 stub: final signature (MVP-SPEC §7 WP-2); throws until the Yjs replicating store lands.
import { EkzaError, type ReplicatingStore, type UserId } from '@ekza-animator/doc';

export function createYjsStore(_opts: {
  readonly replicaId: string;
  readonly user?: UserId;
  readonly strictPut?: boolean;
}): ReplicatingStore {
  throw new EkzaError('not-implemented', 'doc-yjs.createYjsStore');
}
