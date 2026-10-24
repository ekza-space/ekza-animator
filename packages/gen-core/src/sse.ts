// Server-sent events: the gateway's writer and the client's incremental reader (the client reads the stream through
// `fetch`, not `EventSource`, so it can send the Authorization header).

export interface SseEvent {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

export function formatSseEvent(event: string, data: string, id?: string | number): string {
  const lines = data.split('\n').map((l) => `data: ${l}`);
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\n${lines.join('\n')}\n\n`;
}

export const SSE_COMMENT = ': ping\n\n';

/** Feeds text chunks; returns the complete events seen so far. Comments and `retry:` lines are skipped. */
export class SseReader {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const out: SseEvent[] = [];
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end < 0) break;
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      let event = 'message';
      let id: string | null = null;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line === '' || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') id = value;
      }
      if (data.length > 0) out.push({ event, data: data.join('\n'), id });
    }
    return out;
  }
}
