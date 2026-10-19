// MCP mapping of tool results (MCP-SPEC §5.3, §5.20.2): success → `structuredContent` = the envelope, `content[0]` =
// the envelope as minified JSON text, then at most one image; failure → `isError: true` with the error envelope as
// text only (no `structuredContent`: SDK clients validate it against the success `outputSchema`).
import type { AgentImage, AgentToolResult } from '@ekza-animator/agent-tools';

export interface CallToolResultShape {
  readonly content: readonly (
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  )[];
  readonly structuredContent?: Readonly<Record<string, unknown>>;
  readonly isError?: true;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function toCallToolResult(result: AgentToolResult<unknown>): CallToolResultShape {
  if (!result.ok) {
    return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: result.error }) }], isError: true };
  }
  const { images, ...envelope } = result;
  const image: AgentImage | undefined = images?.[0];
  return {
    content: [
      { type: 'text', text: JSON.stringify(envelope) },
      ...(image === undefined ? [] : [{ type: 'image' as const, data: base64(image.bytes), mimeType: image.mime }]),
    ],
    structuredContent: envelope,
  };
}
