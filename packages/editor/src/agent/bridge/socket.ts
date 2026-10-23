// The tab's end of the bridge (MCP-SPEC §4.5): a WebSocket to ws://127.0.0.1:<port>, strict parsing of every frame
// (`parseBridgeMessage`: an invalid frame closes the socket with 1008), blob frames in both directions (a JSON `blob`
// header followed by exactly one binary frame; 1 MiB chunks with the SHA-256 of the whole blob on the last one).
import {
  BRIDGE_CLOSE,
  BRIDGE_LIMITS,
  type BridgeMessage,
  parseBridgeMessage,
  serializeBridgeMessage,
} from '@ekza-studio/agent-tools';

export interface TabSocket {
  readonly port: number;
  send(message: BridgeMessage): void;
  /** Sends `bytes` as blob `id` (chunked). */
  sendBlob(id: string, bytes: Uint8Array): Promise<void>;
  /** A complete blob the server sent (taken out of the socket's store), or null. */
  takeBlob(id: string): Uint8Array | null;
  onMessage(listener: (message: BridgeMessage) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
  readonly open: boolean;
  close(code?: number, reason?: string): void;
}

async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return undefined;
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Opens a socket to the bridge on `port`; rejects when it does not open within `timeoutMs`. */
export function openTabSocket(port: number, timeoutMs: number): Promise<TabSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, timeoutMs);
    const messageListeners: ((message: BridgeMessage) => void)[] = [];
    const closeListeners: ((code: number, reason: string) => void)[] = [];
    let expect: Extract<BridgeMessage, { t: 'blob' }> | null = null;
    const blobs = new Map<string, { chunks: Uint8Array[]; done: boolean }>();
    let opened = false;
    let closed = false;

    const socket: TabSocket = {
      port,
      get open() {
        return opened && !closed && ws.readyState === WebSocket.OPEN;
      },
      send(message) {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeBridgeMessage(message));
      },
      async sendBlob(id, bytes) {
        const sha256 = await sha256Hex(bytes);
        const chunk = BRIDGE_LIMITS.blobChunkBytes;
        const count = Math.max(1, Math.ceil(bytes.length / chunk));
        for (let seq = 0; seq < count; seq++) {
          const part = bytes.subarray(seq * chunk, (seq + 1) * chunk);
          const last = seq === count - 1;
          socket.send({
            t: 'blob',
            id,
            seq,
            last,
            bytes: part.length,
            ...(last && sha256 !== undefined ? { sha256 } : {}),
          });
          if (ws.readyState === WebSocket.OPEN) ws.send(part as Uint8Array<ArrayBuffer>);
        }
      },
      takeBlob(id) {
        const blob = blobs.get(id);
        if (blob === undefined || !blob.done) return null;
        blobs.delete(id);
        const total = blob.chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const c of blob.chunks) {
          out.set(c, at);
          at += c.length;
        }
        return out;
      },
      onMessage(listener) {
        messageListeners.push(listener);
      },
      onClose(listener) {
        closeListeners.push(listener);
      },
      close(code = 1000, reason = '') {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code, reason);
      },
    };

    ws.onopen = () => {
      clearTimeout(timer);
      opened = true;
      resolve(socket);
    };
    ws.onerror = () => {
      if (!opened) {
        clearTimeout(timer);
        reject(new Error('unreachable'));
      }
    };
    ws.onclose = (event) => {
      clearTimeout(timer);
      if (!opened) {
        reject(new Error('closed'));
        return;
      }
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener(event.code, event.reason);
    };
    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const header = expect;
        if (header === null || event.data.byteLength !== header.bytes) {
          ws.close(BRIDGE_CLOSE.invalidMessage, 'unexpected binary frame');
          return;
        }
        expect = null;
        let blob = blobs.get(header.id);
        if (blob === undefined) {
          blob = { chunks: [], done: false };
          blobs.set(header.id, blob);
        }
        blob.chunks.push(new Uint8Array(event.data));
        if (header.last) blob.done = true;
        return;
      }
      let message: BridgeMessage;
      try {
        message = parseBridgeMessage(String(event.data));
      } catch {
        ws.close(BRIDGE_CLOSE.invalidMessage, 'invalid message');
        return;
      }
      if (message.t === 'blob') {
        expect = message;
        return;
      }
      for (const listener of messageListeners) listener(message);
    };
  });
}
