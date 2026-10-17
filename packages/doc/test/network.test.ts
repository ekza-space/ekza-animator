import { describe, expect, it } from 'vitest';
import { EkzaError, type Partition, type ReplicatingStore } from '../src';
import { createTestNetwork, type TestNetwork } from '../src/testing';

/** A peer that only sends what it is told to and records what it receives (TestNetwork uses nothing else). */
class Peer {
  readonly received: string[] = [];
  private readonly out: { partition: Partition; update: Uint8Array }[] = [];

  constructor(readonly replicaId: string) {}

  send(text: string, partition: Partition = 'scene'): void {
    this.out.push({ partition, update: new TextEncoder().encode(text) });
  }

  drainOutgoing(): readonly { readonly partition: Partition; readonly update: Uint8Array }[] {
    return this.out.splice(0);
  }

  receive(partition: Partition, update: Uint8Array): void {
    this.received.push(`${partition}:${new TextDecoder().decode(update)}`);
  }
}

function network(n: number, seed = 1): { net: TestNetwork; peers: Peer[] } {
  const peers: Peer[] = [];
  const net = createTestNetwork(
    n,
    (id) => {
      const peer = new Peer(id);
      peers.push(peer);
      return peer as unknown as ReplicatingStore;
    },
    { seed },
  ) as TestNetwork;
  return { net, peers };
}

describe('createTestNetwork', () => {
  it('names replicas r0…rn−1 and delivers to every other peer', () => {
    const { net, peers } = network(3);
    expect(peers.map((p) => p.replicaId)).toEqual(['r0', 'r1', 'r2']);
    peers[0]?.send('a');
    expect(net.deliver()).toBe(2);
    expect(peers.map((p) => p.received)).toEqual([[], ['scene:a'], ['scene:a']]);
  });

  it('delays updates by delayTicks deliveries', () => {
    const { net, peers } = network(2);
    net.setLink({ delayTicks: 2 });
    peers[0]?.send('a');
    expect(net.deliver()).toBe(0);
    expect(net.deliver()).toBe(0);
    expect(net.deliver()).toBe(1);
    expect(peers[1]?.received).toEqual(['scene:a']);
  });

  it('holds updates across a network partition until heal', () => {
    const { net, peers } = network(3);
    net.partition(0, 1);
    peers[0]?.send('a');
    net.deliver();
    expect(peers[1]?.received).toEqual([]);
    expect(peers[2]?.received).toEqual(['scene:a']);
    expect(net.inFlight).toBe(1);
    net.heal();
    net.deliver();
    expect(peers[1]?.received).toEqual(['scene:a']);
  });

  it('reorders deterministically per seed', () => {
    const orders = [1, 1, 2].map((seed) => {
      const { net, peers } = network(2, seed);
      net.setLink({ reorder: true });
      for (const text of ['a', 'b', 'c', 'd', 'e', 'f']) peers[0]?.send(text);
      net.deliver();
      return peers[1]?.received.join('');
    });
    expect(orders[0]).toBe(orders[1]);
    expect(orders[0]).not.toBe(orders[2]);
  });

  it('drops updates and settle() recovers them by re-sending every history', () => {
    const { net, peers } = network(3, 5);
    net.setLink({ dropRate: 0.5 });
    for (let i = 0; i < 20; i++) peers[i % 3]?.send(`u${i}`, i % 2 === 0 ? 'scene' : 'clip:x');
    net.deliver();
    expect(net.dropped).toBeGreaterThan(0);
    net.settle();
    for (const [i, peer] of peers.entries()) {
      const expected = Array.from({ length: 20 }, (_, n) => n).filter((n) => n % 3 !== i);
      for (const n of expected) expect(peer.received).toContain(`${n % 2 === 0 ? 'scene' : 'clip:x'}:u${n}`);
    }
    expect(net.inFlight).toBe(0);
  });

  it('settle heals partitions and delivers delayed updates', () => {
    const { net, peers } = network(2);
    net.setLink({ delayTicks: 5 });
    net.partition(0, 1);
    peers[1]?.send('late');
    net.settle();
    expect(peers[0]?.received).toEqual(['scene:late']);
  });

  it('validates its arguments', () => {
    const { net } = network(2);
    expect(() => net.partition(0, 2)).toThrow(EkzaError);
    expect(() => net.setLink({ dropRate: 1 })).toThrow(EkzaError);
    expect(() => net.setLink({ delayTicks: -1 })).toThrow(EkzaError);
    expect(() => createTestNetwork(0, () => ({}) as ReplicatingStore)).toThrow(EkzaError);
  });

  it('stops a replica that keeps producing updates', () => {
    const { net, peers } = network(2);
    for (const peer of peers) peer.receive = (partition) => peer.send('again', partition);
    peers[0]?.send('start');
    expect(() => net.settle()).toThrow(expect.objectContaining({ code: 'internal' }));
  });
});
