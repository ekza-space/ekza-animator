// The confirm card (MCP-SPEC §7.4): a non-modal card near the status line (outside the panel, so it is seen when the
// panel is hidden), one at a time, with the prompt's title and detail, a countdown, [Deny] and [Allow] (`danger`
// prompts style Allow as destructive). `Esc` on its buttons = Deny; the session times out to Deny. The card never
// takes focus by itself (an agent call must not steal the user's keystrokes).
import { Button } from '@ekza-studio/ui';
import type { JSX, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AgentSessionState } from '../types';
import { useNow } from './hooks';
import type { AgentSessionHandle } from './runtime';

export function ConfirmCard(props: {
  readonly state: AgentSessionState;
  readonly session: AgentSessionHandle;
}): JSX.Element | null {
  const confirm = props.state.confirm;
  const now = useNow(confirm !== null);
  if (confirm === null || typeof document === 'undefined') return null;
  const answer = (value: 'allow' | 'deny'): void => props.session.answerConfirm?.(confirm.id, value);
  const seconds = Math.max(0, Math.ceil((confirm.expiresAt - now) / 1_000));
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    answer('deny');
  };
  return createPortal(
    <section
      aria-label={confirm.prompt.title}
      className="fixed top-[76px] right-3 z-(--z-dialog) flex w-[min(380px,calc(100vw-24px))] flex-col gap-2 rounded-dialog border border-line-strong bg-panel p-3 text-ui text-fg shadow-popover outline-none"
      style={{ borderLeft: '3px solid var(--presence-agent, #e66cff)' }}
      data-testid="agent-confirm"
    >
      <div className="flex items-baseline justify-between gap-2">
        <strong className="font-semibold">{confirm.prompt.title}</strong>
        <span className="text-fg-3 tabular-nums">{seconds} s</span>
      </div>
      <p className="text-fg-2">{confirm.prompt.detail}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" data-testid="agent-confirm-deny" onKeyDown={onKeyDown} onClick={() => answer('deny')}>
          Deny
        </Button>
        <Button
          onKeyDown={onKeyDown}
          size="sm"
          variant={confirm.prompt.danger ? 'danger' : 'primary'}
          data-testid="agent-confirm-allow"
          disabled={props.session.answerConfirm === undefined}
          onClick={() => answer('allow')}
        >
          Allow
        </Button>
      </div>
    </section>,
    document.body,
  );
}
