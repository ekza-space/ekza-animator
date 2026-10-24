// An inline confirm card (STUDIO-TOUCH-SPEC §6.7): the kernel's question — *Binding again replaces the painted weights ·
// Bind again / Cancel* — next to the verb that asked, never a modal. The answer runs the kernel's own answer.
import { type Box, Cluster, TouchButton } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { useHaloStore } from '../shell/store';
import { answerConfirm } from './watcher';

export function ConfirmCard({
  controller,
  box,
  width,
}: {
  readonly controller: HaloController;
  readonly box: Box | null;
  readonly width: number;
}): JSX.Element | null {
  const { ctx } = controller;
  const card = useHaloStore(ctx.store, (s) => s.confirm);
  if (card === null) return null;
  const left = box === null ? width / 2 - 180 : Math.min(Math.max(16, box.left), width - 376);
  const top = box === null ? 120 : box.bottom + 16;
  return (
    <Cluster
      role="alertdialog"
      aria-label={card.text}
      data-halo-chrome=""
      data-testid="halo-confirm"
      data-dialog={card.dialog}
      className="pointer-events-auto absolute flex w-[360px] flex-col gap-3 p-3"
      style={{ left, top }}
    >
      <p className="m-0 text-touch text-fg">{card.text}</p>
      <div className="flex justify-end gap-2">
        <TouchButton variant="ghost" onClick={() => void answerConfirm(ctx, card.dialog, false)}>
          {en.dialogs.cancel}
        </TouchButton>
        <TouchButton
          variant="primary"
          data-testid="halo-confirm-yes"
          onClick={() => void answerConfirm(ctx, card.dialog, true)}
        >
          {card.yes}
        </TouchButton>
      </div>
    </Cluster>
  );
}
