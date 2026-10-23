// Contract file: the bridge protocol of MCP-SPEC §4.5. JSON text frames, one message per frame; a `blob` header frame
// is followed by exactly one binary frame. Every message is parsed with a STRICT zod schema on receipt (unknown keys
// are an error); an invalid message closes the socket with code 1008. Before `pair.ok` the server closes a socket
// whose frame exceeds 64 KiB (code 1009); after it, frames are at most 16 MiB; blobs travel in 1 MiB chunks; one call
// moves at most 256 MiB in total.
import type { RunActor } from '@ekza-studio/editor-core';
import { z } from 'zod';
import type { Grants } from '../types';

export const BRIDGE_PROTOCOL = 1 as const;
/** Frame and transfer limits (§4.5). */
export const BRIDGE_LIMITS = {
  unpairedFrameBytes: 64 * 1024,
  maxPayloadBytes: 16 * 1024 * 1024,
  blobChunkBytes: 1024 * 1024,
  maxCallBytes: 256 * 1024 * 1024,
} as const;
/** WebSocket close codes the bridge uses. */
export const BRIDGE_CLOSE = { invalidMessage: 1008, tooBig: 1009 } as const;
/** The default bridge ports (§5.10). */
export const BRIDGE_PORTS = { first: 47_821, last: 47_830 } as const;

export interface ServerInfo {
  readonly name: 'ekza-studio-mcp';
  readonly version: string;
  readonly startedAt: number;
}
export interface ClientInfo {
  readonly name: string;
  readonly version: string;
} // as reported by the MCP client, sanitised
export interface ToolsetInfo {
  readonly version: string;
  readonly hash: string;
}
export type BridgeMessage =
  // discovery and version (tab → server first; nothing about the tab or its project before pair.ok)
  | {
      readonly t: 'hello';
      readonly bridge: 1;
      readonly toolset: ToolsetInfo;
      readonly app: { readonly version: string; readonly build: 'server' | 'static' | 'dev' | 'e2e' };
    }
  | {
      readonly t: 'hello.ok';
      readonly server: ServerInfo;
      readonly client: ClientInfo | null;
      readonly toolset: ToolsetInfo;
      readonly busy: boolean;
    } // busy: paired with another tab
  | { readonly t: 'hello.refused'; readonly code: 'version_mismatch'; readonly message: string }
  // pairing (§5.10): the SERVER generates the code
  | { readonly t: 'pair.offer' } // tab → server
  | { readonly t: 'pair.code'; readonly code: string; readonly expiresAt: number } // server → tab (shown to the user)
  | { readonly t: 'pair.claimed'; readonly client: ClientInfo | null; readonly cwdName: string } // server → tab
  | { readonly t: 'pair.accept'; readonly grants: Grants } // tab → server
  | { readonly t: 'pair.deny' } // tab → server
  | { readonly t: 'pair.ok'; readonly session: string; readonly token: string; readonly actor: RunActor } // server → tab
  | { readonly t: 'tab'; readonly title: string; readonly project: string } // tab → server, after pair.ok
  | { readonly t: 'resume'; readonly session: string; readonly token: string } // tab → server
  | { readonly t: 'resume.ok'; readonly waiting: readonly string[] } // call ids still unanswered
  // calls (server → tab), progress and results (tab → server)
  | {
      readonly t: 'call';
      readonly id: string;
      readonly tool: string;
      readonly args: unknown;
      readonly progress: boolean;
      readonly deadline: number;
      readonly files: readonly { readonly path: string; readonly blob: string }[];
    } // workspace reads, pre-attached (§5.10)
  | {
      readonly t: 'progress';
      readonly id: string;
      readonly done: number;
      readonly total: number | null;
      readonly message?: string;
    }
  | {
      readonly t: 'result';
      readonly id: string;
      readonly result: unknown; // AgentToolResult without images
      readonly images: readonly {
        readonly blob: string;
        readonly mime: BridgeImageMime;
        readonly width: number;
        readonly height: number;
      }[];
      /** Workspace writes: base file names only (no separators); the server decides the folder, the extension check
       *  and whether an existing file may be replaced, from the call's own arguments (§5.10, §5.18). */
      readonly writes: readonly { readonly name: string; readonly blob: string }[];
    }
  | { readonly t: 'cancel'; readonly id: string } // server → tab
  // session state (tab → server)
  | { readonly t: 'grants'; readonly grants: Grants }
  | { readonly t: 'paused'; readonly on: boolean }
  | { readonly t: 'bye'; readonly reason: 'user' | 'server' | 'version' | 'idle' | 'replaced' } // the tab sends 'user' on pagehide
  // binary transfer (either direction)
  | {
      readonly t: 'blob';
      readonly id: string;
      readonly seq: number;
      readonly last: boolean;
      readonly bytes: number;
      readonly sha256?: string;
    }
  | { readonly t: 'error'; readonly code: string; readonly message: string };

/** The image types a tab may send (§5.15.5). */
export const BRIDGE_IMAGE_MIMES = ['image/png', 'image/webp'] as const;
export type BridgeImageMime = (typeof BRIDGE_IMAGE_MIMES)[number];
/**
 * A workspace write's name (§4.5, §5.10): one base file name — no slash, backslash or colon, no control or format
 * character (`Cc`, `Cf`: no bidi override disguising the extension), not `.` or `..`, 1–255 code points. The server
 * still derives the folder, the extension and the overwrite rule itself (T7, T16).
 */
export const BRIDGE_WRITE_NAME = /^(?!\.{1,2}$)[^/\\:\p{Cc}\p{Cf}]{1,255}$/u;

// ---------- strict schemas (one per message) ----------
const shortText = (max: number) => z.string().max(max);
const id = z.string().min(1).max(64);
const count = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
const toolset = z.strictObject({ version: shortText(32), hash: z.string().regex(/^[0-9a-f]{64}$/) });
const serverInfo = z.strictObject({
  name: z.literal('ekza-studio-mcp'),
  version: shortText(32),
  startedAt: count,
});
const clientInfo = z.strictObject({ name: shortText(200), version: shortText(64) });
const grants = z.strictObject({
  read: z.literal(true),
  edit: z.boolean(),
  files: z.boolean(),
  view: z.boolean(),
  workspace: z.boolean(),
});
const actor = z.strictObject({
  kind: z.literal('agent'),
  id: z.string().regex(/^agt_[0-9A-Za-z]{12}$/),
  name: shortText(40),
});

export const BRIDGE_MESSAGE_SCHEMAS = {
  hello: z.strictObject({
    t: z.literal('hello'),
    bridge: z.literal(BRIDGE_PROTOCOL),
    toolset,
    app: z.strictObject({ version: shortText(32), build: z.enum(['server', 'static', 'dev', 'e2e']) }),
  }),
  'hello.ok': z.strictObject({
    t: z.literal('hello.ok'),
    server: serverInfo,
    client: clientInfo.nullable(),
    toolset,
    busy: z.boolean(),
  }),
  'hello.refused': z.strictObject({
    t: z.literal('hello.refused'),
    code: z.literal('version_mismatch'),
    message: shortText(500),
  }),
  'pair.offer': z.strictObject({ t: z.literal('pair.offer') }),
  'pair.code': z.strictObject({ t: z.literal('pair.code'), code: shortText(16), expiresAt: count }),
  'pair.claimed': z.strictObject({
    t: z.literal('pair.claimed'),
    client: clientInfo.nullable(),
    cwdName: shortText(200),
  }),
  'pair.accept': z.strictObject({ t: z.literal('pair.accept'), grants }),
  'pair.deny': z.strictObject({ t: z.literal('pair.deny') }),
  'pair.ok': z.strictObject({ t: z.literal('pair.ok'), session: id, token: z.string().min(16).max(256), actor }),
  tab: z.strictObject({ t: z.literal('tab'), title: shortText(500), project: shortText(500) }),
  resume: z.strictObject({ t: z.literal('resume'), session: id, token: z.string().min(16).max(256) }),
  'resume.ok': z.strictObject({ t: z.literal('resume.ok'), waiting: z.array(id).max(1_024) }),
  call: z.strictObject({
    t: z.literal('call'),
    id,
    tool: z.string().regex(/^[a-z][a-z0-9_]{2,39}$/),
    args: z.unknown(),
    progress: z.boolean(),
    deadline: count,
    files: z.array(z.strictObject({ path: shortText(1_024), blob: id })).max(64),
  }),
  progress: z.strictObject({
    t: z.literal('progress'),
    id,
    done: z.number().min(0),
    total: z.number().min(0).nullable(),
    message: shortText(500).optional(),
  }),
  result: z.strictObject({
    t: z.literal('result'),
    id,
    result: z.unknown(),
    images: z
      .array(
        z.strictObject({
          blob: id,
          mime: z.enum(BRIDGE_IMAGE_MIMES),
          width: z.int().min(1).max(16_384),
          height: z.int().min(1).max(16_384),
        }),
      )
      .max(4),
    writes: z.array(z.strictObject({ name: z.string().regex(BRIDGE_WRITE_NAME), blob: id })).max(64),
  }),
  cancel: z.strictObject({ t: z.literal('cancel'), id }),
  grants: z.strictObject({ t: z.literal('grants'), grants }),
  paused: z.strictObject({ t: z.literal('paused'), on: z.boolean() }),
  bye: z.strictObject({ t: z.literal('bye'), reason: z.enum(['user', 'server', 'version', 'idle', 'replaced']) }),
  blob: z.strictObject({
    t: z.literal('blob'),
    id,
    seq: count,
    last: z.boolean(),
    bytes: z.int().min(0).max(BRIDGE_LIMITS.blobChunkBytes),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  }),
  error: z.strictObject({ t: z.literal('error'), code: shortText(64), message: shortText(500) }),
} as const satisfies Record<BridgeMessage['t'], z.ZodType>;

/** One strict schema over every message, discriminated by `t`. */
export const bridgeMessageSchema = z.discriminatedUnion('t', Object.values(BRIDGE_MESSAGE_SCHEMAS) as never);

/** Thrown by `parseBridgeMessage` (the socket then closes with 1008). */
export class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeProtocolError';
  }
}

/** Strict: invalid JSON, an unknown `t`, a missing or unknown key, or a wrong type throws `BridgeProtocolError`. */
export function parseBridgeMessage(text: string): BridgeMessage {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BridgeProtocolError('not JSON');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new BridgeProtocolError('not an object');
  const t = (json as { readonly t?: unknown }).t;
  if (typeof t !== 'string' || !Object.hasOwn(BRIDGE_MESSAGE_SCHEMAS, t)) {
    throw new BridgeProtocolError(`unknown message type ${typeof t === 'string' ? t.slice(0, 32) : typeof t}`);
  }
  const schema = BRIDGE_MESSAGE_SCHEMAS[t as BridgeMessage['t']];
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BridgeProtocolError(
      `invalid ${t}: ${issue === undefined ? 'invalid' : `${issue.path.join('.')} ${issue.message}`}`,
    );
  }
  return parsed.data as BridgeMessage;
}

/** Serialises a message (the server and the tab never send anything else). */
export function serializeBridgeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}
