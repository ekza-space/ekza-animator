// The shell-neutral view operators (STUDIO-TOUCH-SPEC §20.3 item 12; T3: moved from the Studio shell's
// `shell/operators.ts`): `view.selectionMask` (the status line's Pick toggles, Halo's View sheet) and
// `view.toggleFullscreen` (Windows › Full Screen, `Shift+F`, Halo's project menu). Part of the host's lazy
// registrations chunk (`./parts`), registered on every route once per app; neither writes the document.
import type { EditorApp, OperatorDef, PollResult, SelectionMask } from '@ekza-studio/editor-core';

/** The operators; `doc` is the document whose Fullscreen API `view.toggleFullscreen` uses (null: none). */
export function viewOperatorDefs(
  app: EditorApp,
  doc: () => Document | null = () => (typeof document === 'undefined' ? null : document),
): readonly OperatorDef<unknown>[] {
  const selectionMask: OperatorDef<{ readonly mask: Partial<SelectionMask> }> = {
    id: 'view.selectionMask',
    label: 'Selection Mask',
    category: 'select',
    scope: 'global',
    apply(_ctx, args) {
      const tools = app.session.getState().tools;
      app.session.setState({ tools: { ...tools, selectionMask: { ...tools.selectionMask, ...args.mask } } });
    },
  };

  const toggleFullscreen: OperatorDef = {
    id: 'view.toggleFullscreen',
    label: 'Full Screen',
    aliases: ['Fullscreen'],
    description: 'Show the editor full screen (the browser Fullscreen API), or leave full screen.',
    category: 'view',
    scope: 'global',
    poll(): PollResult {
      const d = doc();
      return d !== null && d.fullscreenEnabled
        ? true
        : { ok: false, reason: 'Full screen is not available in this browser' };
    },
    apply() {
      const d = doc();
      if (d === null) return;
      // Called in the key or menu event's user activation; the browser answers asynchronously.
      const request =
        d.fullscreenElement === null
          ? d.documentElement.requestFullscreen({ navigationUI: 'hide' })
          : d.exitFullscreen();
      request.catch((error: unknown) =>
        app.services.notify.toast({
          kind: 'warning',
          text: `The browser refused full screen${error instanceof Error ? `: ${error.message}` : ''}`,
        }),
      );
    },
  };

  return [selectionMask, toggleFullscreen] as readonly OperatorDef<unknown>[];
}
