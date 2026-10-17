// In-memory replica bus (research 06 §7.4): N replicating stores joined pairwise, with controllable delay, loss,
// reordering and network partitions. Updates are opaque; replicating stores must apply them idempotently and in any
// order (CRDT updates). Lost updates are recovered by `settle()`, which re-sends every peer's full history (the
// anti-entropy a real provider performs with state vectors on reconnect).
import { EkzaError } from '@ekza-animator/anim-core';
import type { Partition } from '../records';
import type { ReplicaNetwork, ReplicatingStore } from '../store';
import { Rng } from './random';

interface Message {
  readonly from: number;
  readonly to: number;
  readonly partition: Partition;
  readonly update: Uint8Array;
  readonly readyAt: number;
  readonly seq: number;
}

interface LinkSettings {
  delayTicks: number;
  dropRate: number;
  reorder: boolean;
}

/** Hard stop for `settle()` loops: a replicating store that keeps producing updates on receive is a bug. */
const SETTLE_ROUNDS = 1000;

export class TestNetwork implements ReplicaNetwork {
  readonly peers: readonly ReplicatingStore[];
  private readonly history: { readonly partition: Partition; readonly update: Uint8Array }[][];
  private readonly cuts = new Set<string>();
  private readonly link: LinkSettings = { delayTicks: 0, dropRate: 0, reorder: false };
  private readonly rng: Rng;
  private queue: Message[] = [];
  private tick = 0;
  private seq = 0;
  private lost = false;
  /** Updates dropped so far (for tests that assert loss happened). */
  dropped = 0;

  constructor(peers: readonly ReplicatingStore[], seed: number) {
    this.peers = peers;
    this.history = peers.map(() => []);
    this.rng = new Rng(seed);
  }

  /**
   * One tick: collects new outgoing updates, then applies every update whose delay has elapsed across healed links
   * (an update sent with `delayTicks: d` arrives on the (d+1)-th call). Returns how many were applied.
   */
  deliver(): number {
    this.tick++;
    this.collect();
    const ready: Message[] = [];
    const waiting: Message[] = [];
    for (const message of this.queue) {
      if (message.readyAt <= this.tick && !this.isCut(message.from, message.to)) ready.push(message);
      else waiting.push(message);
    }
    this.queue = waiting;
    if (this.link.reorder) this.rng.shuffle(ready);
    let delivered = 0;
    for (const message of ready) {
      if (this.link.dropRate > 0 && this.rng.next() < this.link.dropRate) {
        this.dropped++;
        this.lost = true;
        continue;
      }
      this.peers[message.to]?.receive(message.partition, message.update);
      delivered++;
    }
    return delivered;
  }

  /** Heals every link, delivers everything (no delay or loss) and recovers lost updates. */
  settle(): void {
    this.heal();
    for (let round = 0; ; round++) {
      if (round >= SETTLE_ROUNDS) throw new EkzaError('internal', 'TestNetwork.settle: replicas never went quiet');
      this.collect();
      if (this.queue.length === 0) {
        if (!this.lost) return;
        this.lost = false;
        this.resendHistory();
        continue;
      }
      const pending = this.queue.sort((a, b) => a.seq - b.seq);
      this.queue = [];
      for (const message of pending) this.peers[message.to]?.receive(message.partition, message.update);
    }
  }

  partition(a: number, b: number): void {
    this.assertPeer(a);
    this.assertPeer(b);
    if (a !== b) this.cuts.add(pairKey(a, b));
  }

  heal(): void {
    this.cuts.clear();
  }

  setLink(opts: { readonly delayTicks?: number; readonly dropRate?: number; readonly reorder?: boolean }): void {
    if (opts.delayTicks !== undefined) {
      if (!Number.isInteger(opts.delayTicks) || opts.delayTicks < 0) {
        throw new EkzaError('unsupported', 'setLink: delayTicks must be a non-negative integer');
      }
      this.link.delayTicks = opts.delayTicks;
    }
    if (opts.dropRate !== undefined) {
      if (!(opts.dropRate >= 0 && opts.dropRate < 1))
        throw new EkzaError('unsupported', 'setLink: dropRate must be in [0, 1)');
      this.link.dropRate = opts.dropRate;
    }
    if (opts.reorder !== undefined) this.link.reorder = opts.reorder;
  }

  /** Updates waiting in links (sent, not yet delivered). */
  get inFlight(): number {
    return this.queue.length;
  }

  private collect(): void {
    this.peers.forEach((peer, from) => {
      for (const outgoing of peer.drainOutgoing()) {
        this.history[from]?.push(outgoing);
        this.peers.forEach((_, to) => {
          if (to === from) return;
          this.queue.push({
            from,
            to,
            partition: outgoing.partition,
            update: outgoing.update,
            readyAt: this.tick + this.link.delayTicks,
            seq: this.seq++,
          });
        });
      }
    });
  }

  private resendHistory(): void {
    this.history.forEach((updates, from) => {
      this.peers.forEach((peer, to) => {
        if (to === from) return;
        for (const update of updates) peer.receive(update.partition, update.update);
      });
    });
  }

  private isCut(a: number, b: number): boolean {
    return this.cuts.has(pairKey(a, b));
  }

  private assertPeer(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.peers.length) {
      throw new EkzaError('unsupported', `TestNetwork: no peer ${index}`);
    }
  }
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** N replicas named 'r0'…'r<n−1>' on one bus. */
export function createTestNetwork(
  n: number,
  factory: (replicaId: string) => ReplicatingStore,
  opts?: { readonly seed?: number },
): ReplicaNetwork {
  if (!Number.isInteger(n) || n < 1)
    throw new EkzaError('unsupported', 'createTestNetwork: n must be a positive integer');
  const peers = Array.from({ length: n }, (_, i) => factory(`r${i}`));
  return new TestNetwork(peers, opts?.seed ?? 1);
}
