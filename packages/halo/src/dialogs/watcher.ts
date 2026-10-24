// The dialog watcher (STUDIO-TOUCH-SPEC §6.7, ST-38): while Halo is mounted it takes every `session.dialog` value the
// kernel or a shortcut sets and shows the Halo surface of `./map` instead of Studio Pro's dialog. It closes the host's
// dialog at once, in the same store notification, so the host's dialog never renders or loads (the kernel's pending
// question — a rebind, an unbind — stays for the answer). Surfaces the host still shows (`host`) pass through.
import type { UiDialog } from '@ekza-studio/editor-core';
import { en } from '../i18n/en';
import type { ShellContext } from '../shell/context';
import { surfaceOf } from './map';

export interface DialogTargets {
  openSheet(sheet: string): void;
  openPicker(kind: 'open' | 'import'): void;
  /** Home (§17), where Continue lives. */
  showHome(): void;
  /** ▤ Pro layout with the dialog opened on arrival. */
  toPro(dialog: UiDialog): void;
}

export function watchDialogs(ctx: ShellContext, targets: DialogTargets): () => void {
  const { app, store } = ctx;
  let last: UiDialog | null = app.session.getState().dialog;
  const take = (dialog: UiDialog): void => {
    const surface = surfaceOf(dialog);
    if (surface.kind === 'host') return;
    // The host's dialog never shows over Halo: closed in this notification (a UI field, not a document write).
    app.session.setState({ dialog: null });
    last = null;
    switch (surface.kind) {
      case 'confirm':
        store.set({
          confirm: { dialog, text: surface.text, yes: surface.yes, op: dialog, args: null },
          halo: null,
        });
        return;
      case 'sheet':
        targets.openSheet(surface.sheet);
        return;
      case 'picker':
        targets.openPicker(surface.picker);
        return;
      case 'home':
        targets.showHome();
        return;
      case 'pro':
        ctx.toasts.push({
          key: 'dialog',
          text: en.dialogs.unknown(dialog),
          action: { label: en.toast.openInPro, run: () => targets.toPro(dialog) },
        });
        return;
      case 'noop':
      case 'deferred':
        return;
    }
  };
  if (last !== null) take(last);
  return app.session.subscribe((state) => {
    if (state.dialog === last) return;
    last = state.dialog;
    if (state.dialog !== null) take(state.dialog);
  });
}

/** Answers an inline confirm card (§6.7): the kernel's own answer helpers, loaded with the card's chunk. */
export async function answerConfirm(ctx: ShellContext, dialog: string, yes: boolean): Promise<void> {
  ctx.store.set({ confirm: null });
  const { answerRebind, answerUnbind } = await import('./answers');
  if (dialog === 'rebindSkin') await answerRebind(ctx.app, yes ? 'rebind' : 'cancel');
  else if (dialog === 'unbindSkin') await answerUnbind(ctx.app, yes ? 'unbind' : 'cancel');
  else if (dialog === 'applyPoseAsRest' && yes) await ctx.run('skel.pose.applyAsRest', { confirm: true });
}
