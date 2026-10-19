// MCP-SPEC §4.5 (D0): every bridge message parses with a strict schema; unknown keys, unknown types, wrong types and
// non-JSON are refused (the socket then closes with 1008).
import { describe, expect, it } from 'vitest';
import { BRIDGE_MESSAGE_SCHEMAS, type BridgeMessage, BridgeProtocolError, parseBridgeMessage } from '../src';

const HASH = 'a'.repeat(64);
const GRANTS = { read: true, edit: true, files: false, view: false, workspace: false } as const;
const SAMPLES: readonly BridgeMessage[] = [
  { t: 'hello', bridge: 1, toolset: { version: '1.0.0', hash: HASH }, app: { version: '0.2.0', build: 'e2e' } },
  {
    t: 'hello.ok',
    server: { name: 'ekza-animator-mcp', version: '0.1.0', startedAt: 1 },
    client: { name: 'Claude Code', version: '2.1.0' },
    toolset: { version: '1.0.0', hash: HASH },
    busy: false,
  },
  { t: 'hello.refused', code: 'version_mismatch', message: 'update the version pinned in your MCP client' },
  { t: 'pair.offer' },
  { t: 'pair.code', code: 'K7Q-M4P', expiresAt: 120_000 },
  { t: 'pair.claimed', client: null, cwdName: 'walk-project' },
  { t: 'pair.accept', grants: GRANTS },
  { t: 'pair.deny' },
  {
    t: 'pair.ok',
    session: 's_1',
    token: 't'.repeat(43),
    actor: { kind: 'agent', id: 'agt_ABCDEFGHIJKL', name: 'Claude Code' },
  },
  { t: 'tab', title: 'Ekza Animator', project: 'walk' },
  { t: 'resume', session: 's_1', token: 't'.repeat(43) },
  { t: 'resume.ok', waiting: ['c_1abc'] },
  { t: 'call', id: 'c_1abc', tool: 'pose_set', args: { frame: 0 }, progress: true, deadline: 30_000, files: [] },
  { t: 'progress', id: 'c_1abc', done: 1, total: null, message: 'waiting for your drag to finish' },
  { t: 'result', id: 'c_1abc', result: { ok: true, data: {} }, images: [], writes: [] },
  { t: 'cancel', id: 'c_1abc' },
  { t: 'grants', grants: GRANTS },
  { t: 'paused', on: true },
  { t: 'bye', reason: 'user' },
  { t: 'blob', id: 'b_1', seq: 0, last: true, bytes: 12, sha256: HASH },
  { t: 'error', code: 'not_paired', message: 'pair first' },
];

describe('bridge protocol (MCP-SPEC §4.5)', () => {
  it('has a sample for every message type and parses each', () => {
    expect(new Set(SAMPLES.map((m) => m.t))).toEqual(new Set(Object.keys(BRIDGE_MESSAGE_SCHEMAS)));
    for (const message of SAMPLES) expect(parseBridgeMessage(JSON.stringify(message))).toEqual(message);
  });

  it('refuses unknown keys at every level (a pair.offer carrying a code is closed)', () => {
    expect(() => parseBridgeMessage(JSON.stringify({ t: 'pair.offer', code: 'K7Q-M4P' }))).toThrow(BridgeProtocolError);
    expect(() => parseBridgeMessage(JSON.stringify({ t: 'pair.accept', grants: { ...GRANTS, admin: true } }))).toThrow(
      BridgeProtocolError,
    );
  });

  it('refuses unknown types, wrong types, a read grant of false and non-JSON', () => {
    expect(() => parseBridgeMessage('{"t":"exec","cmd":"rm"}')).toThrow(/unknown message type/);
    expect(() => parseBridgeMessage('{"t":"paused","on":"yes"}')).toThrow(BridgeProtocolError);
    expect(() => parseBridgeMessage(JSON.stringify({ t: 'grants', grants: { ...GRANTS, read: false } }))).toThrow(
      BridgeProtocolError,
    );
    expect(() => parseBridgeMessage('not json')).toThrow(/not JSON/);
    expect(() => parseBridgeMessage('[]')).toThrow(/not an object/);
  });
});
