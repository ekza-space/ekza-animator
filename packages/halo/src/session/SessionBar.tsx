// The session bar (STUDIO-TOUCH-SPEC §5.7): at the top of the canvas while a modal tool session is open —
// `✕ Cancel · <tool> · <one-line hint> · ✓ Done`, plus ⌫ (remove the last point) and − n + where they apply. ✕
// discards and asks first when it would discard more than three steps, naming them; ✓ keeps the work.
import { Cluster, TouchButton, TouchIconButton } from '@ekza-studio/ui/touch';
import { type JSX, useState } from 'react';
import { Icon } from '../halo/icons';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { useSessionValue } from '../shell/hooks';
import { activeSession } from './sessions';

export function SessionBar({
  controller,
  top,
}: {
  readonly controller: HaloController;
  readonly top: number;
}): JSX.Element | null {
  const { ctx } = controller;
  const id = useSessionValue(ctx.app, () => activeSession(ctx.app)?.id ?? null);
  const [asking, setAsking] = useState<number | null>(null);
  const session = id === null ? null : activeSession(ctx.app);
  if (session === null) return null;
  const cancel = (): void => {
    const steps = session.steps?.(ctx) ?? 0;
    if (steps > 3 && asking === null) {
      setAsking(steps);
      return;
    }
    setAsking(null);
    void session.cancel(ctx);
  };
  return (
    <div
      data-halo-chrome=""
      data-testid="halo-session"
      data-session={session.id}
      className="pointer-events-none absolute inset-x-0 flex justify-center px-(--touch-inset-left)"
      style={{ top }}
    >
      <Cluster
        role="toolbar"
        aria-label={session.label}
        className="pointer-events-auto flex max-w-full items-center gap-1.5 p-[5px]"
      >
        <TouchButton variant="ghost" className="gap-1.5" data-testid="halo-session-cancel" onClick={cancel}>
          <Icon name="close" />
          {en.session.cancel}
        </TouchButton>
        <span className="px-2 font-semibold whitespace-nowrap">{session.label}</span>
        <span className="hidden min-w-0 truncate px-1 text-touch-label text-fg-2 md:inline">{session.hint}</span>
        {session.backspace === undefined ? null : (
          <TouchIconButton
            label={en.session.removeLast}
            icon={<Icon name="backspace" />}
            className="border-0 bg-transparent shadow-none"
            onClick={() => session.backspace?.(ctx)}
          />
        )}
        {session.count === undefined ? null : (
          <>
            <TouchIconButton
              label={en.session.fewer}
              icon={<span aria-hidden="true">−</span>}
              className="border-0 bg-transparent shadow-none"
              onClick={() => session.count?.(ctx, -1)}
            />
            <TouchIconButton
              label={en.session.more}
              icon={<span aria-hidden="true">+</span>}
              className="border-0 bg-transparent shadow-none"
              onClick={() => session.count?.(ctx, 1)}
            />
          </>
        )}
        <TouchButton
          variant="primary"
          className="gap-1.5"
          data-testid="halo-session-done"
          onClick={() => {
            setAsking(null);
            void session.done(ctx);
          }}
        >
          <Icon name="check" />
          {en.session.done}
        </TouchButton>
      </Cluster>
      {asking === null ? null : (
        <Cluster
          role="alertdialog"
          aria-label={en.session.discard(asking)}
          className="pointer-events-auto absolute top-[calc(100%+8px)] flex items-center gap-2 p-2"
        >
          <span className="px-2">{en.session.discard(asking)}</span>
          <TouchButton variant="danger" onClick={cancel}>
            {en.session.discardYes}
          </TouchButton>
          <TouchButton variant="ghost" onClick={() => setAsking(null)}>
            {en.session.keep}
          </TouchButton>
        </Cluster>
      )}
    </div>
  );
}
