// The View puck (STUDIO-TOUCH-SPEC §4.1): a small orientation cube in the lower corner on the Pencil side. Tap it to
// frame the selection, double-tap to frame everything (the visible twin of the quick pinch, C5), drag it to orbit (the
// twin of a one-finger orbit), long-press it for the View sheet (T6b's: cameras, panes, Look and Show, Hide UI).
import { useLongPress } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';
import { en } from '../i18n/en';
import type { HaloController } from '../shell/controller';
import { PANE } from '../shell/stage';

export function ViewPuck({ controller }: { readonly controller: HaloController }): JSX.Element {
  const { ctx, grammar } = controller;
  const press = useLongPress({
    onTap: (e) => {
      ctx.store.set((s) => ({ touches: s.touches + 1 }));
      grammar.frame(e.count >= 2 ? 'all' : 'selection');
    },
    onDrag: (e) => {
      ctx.vm()?.navigate(PANE, 'orbit', e.dx, e.dy);
    },
    onDragEnd: () => ctx.vm()?.endNavigate(PANE),
    onLongPress: () => ctx.store.set({ sheet: 'view', halo: null }),
  });
  return (
    <div className="pointer-events-auto flex items-center gap-2" data-halo-chrome="">
      <span aria-hidden="true" className="text-touch-label text-fg-2">
        {en.view.puck}
      </span>
      <button
        type="button"
        data-testid="halo-puck"
        aria-label={en.view.puckName}
        className="inline-flex size-[64px] touch-none select-none items-center justify-center rounded-touch-card border border-line bg-touch-surface text-accent-text shadow-touch backdrop-blur-md active:bg-pressed"
        {...press}
        onClick={(event) => {
          // keyboard and assistive technology: frame the selection
          if (event.detail === 0) grammar.frame('selection');
        }}
      >
        <svg
          aria-hidden="true"
          width={40}
          height={40}
          viewBox="0 0 40 40"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <path d="M20 5 34 12v16L20 35 6 28V12z" fill="var(--accent-soft)" />
          <path d="M6 12l14 7 14-7M20 19v16" />
          <circle cx="24" cy="15" r="2.4" fill="var(--accent)" stroke="none" />
        </svg>
      </button>
    </div>
  );
}
