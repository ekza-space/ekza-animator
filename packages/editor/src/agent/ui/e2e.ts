// The agent UI's e2e hook (B3): in e2e builds opened with `?e2e=1` (the test API is installed), loading the agent
// module also puts `window.__EKZA_AGENT_E2E__` on the page, so a Playwright spec can install a fake paired session
// and drive real tool calls through it (audit rows, AI steps, view_capture) without the bridge (B2's ai-01 covers
// the socket). A separate chunk: only e2e pages import it.
import type { AgentToolResult } from '@ekza-studio/agent-tools';
import { createFakeAgentSession, type FakeAgentSession, type FakeSessionOptions } from './fakeSession';
import type { AgentRuntime } from './runtime';

export interface AgentE2eHook {
  installFake(opts?: FakeSessionOptions): void;
  /** A tool call as the paired agent; images come back as their size and PNG signature (and base64 bytes on request). */
  call(tool: string, args: unknown, opts?: { readonly withBytes?: boolean }): Promise<unknown>;
  answerConfirm(answer: 'allow' | 'deny'): void;
  status(): string | null;
}

declare global {
  interface Window {
    __EKZA_AGENT_E2E__?: AgentE2eHook;
  }
}

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function plain(result: AgentToolResult<unknown>, withBytes: boolean): unknown {
  if (!result.ok) return result;
  const images = result.images?.map((image) => ({
    mime: image.mime,
    width: image.width,
    height: image.height,
    byteLength: image.bytes.length,
    signature: Array.from(image.bytes.subarray(0, 8)),
    ...(withBytes ? { base64: base64(image.bytes) } : {}),
  }));
  return JSON.parse(JSON.stringify({ ...result, images }));
}

export function installAgentE2eHook(runtime: AgentRuntime): () => void {
  let fake: FakeAgentSession | null = null;
  const hook: AgentE2eHook = {
    installFake(opts) {
      fake = createFakeAgentSession(runtime.app, opts);
      runtime.install(fake);
    },
    async call(tool, args, opts) {
      if (fake === null) throw new Error('installFake first');
      return plain(await fake.call(tool, args), opts?.withBytes === true);
    },
    answerConfirm(answer) {
      const confirm = fake?.store.getState().confirm;
      if (confirm !== null && confirm !== undefined) fake?.answerConfirm(confirm.id, answer);
    },
    status: () => runtime.store.getState().session?.store.getState().status ?? null,
  };
  window.__EKZA_AGENT_E2E__ = hook;
  return () => {
    if (window.__EKZA_AGENT_E2E__ === hook) delete window.__EKZA_AGENT_E2E__;
  };
}
