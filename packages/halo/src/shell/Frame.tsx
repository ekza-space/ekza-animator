// The frame (STUDIO-TOUCH-SPEC §4.1–§4.6): one full-bleed canvas and, around it, at most three edge zones — the top bar
// (with the Path), the off-hand column (↶ and the Thumb key) with the View puck opposite, and the tray — plus the
// floating grammar (breadcrumb, Halo, chips) anchored to the selection, the session bar, sheets, search and toasts.
// Layouts switch on the container's width (Wide ≥ 1024, Regular 700–1023, Compact < 700; never the user agent).
// Handedness mirrors the off-hand column and the Halo's side. Breathing chrome fades every cluster but ↶ while a press
// on the canvas travels; Hide UI leaves the canvas and a faint restore button (§4.7).
import { TouchIconButton, ToastRegion, TouchRoot } from '@ekza-studio/ui/touch';
import { type JSX, lazy, Suspense, useCallback, useState, useSyncExternalStore } from 'react';
import { HaloPane } from '../canvas/HaloPane';
import { ViewPuck } from '../canvas/ViewPuck';
import { HaloLayer } from '../halo/HaloLayer';
import { Icon } from '../halo/icons';
import { Home } from '../home/Home';
import { en } from '../i18n/en';
import { ThumbKeyView } from '../input/ThumbKeyView';
import { SessionBar } from '../session/SessionBar';
import type { HaloController } from './controller';
import { sizeClassOf, useElementSize } from './hooks';
import { Sheets } from './Sheets';
import { PathTabs, TopBar } from './TopBar';
import { Tray } from './Tray';
import { useHaloStore } from './store';

const Palette = lazy(() => import('../palette/Palette'));
const ProjectMenu = lazy(() => import('./ProjectMenu'));

/** `check-size` marker of the Halo shell's entry (§20.6): initial on `/app`, a banned boundary on `/editor` and `/autorig`. */
export const HALO_SHELL_MARKER = 'ekza-halo-shell' as const;

export function Frame({ controller }: { readonly controller: HaloController }): JSX.Element {
  const { ctx, grammar } = controller;
  const { store, app } = ctx;
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      setRoot(el);
      controller.setRoot(el);
    },
    [controller],
  );
  const { width, height } = useElementSize(root);
  const size = sizeClassOf(width === 0 && typeof window !== 'undefined' ? window.innerWidth : width);
  const home = useHaloStore(store, (s) => s.home);
  const hideUi = useHaloStore(store, (s) => s.hideUi);
  const breathing = useHaloStore(store, (s) => s.breathing);
  const palette = useHaloStore(store, (s) => s.palette);
  const projectMenu = useHaloStore(store, (s) => s.projectMenu);
  const locked = useHaloStore(store, (s) => s.thumb.latch === 'locked');
  const handedness = useHaloStore(store, (s) => s.input.handedness);
  const uiScale = useSyncExternalStore(
    (listener) => app.prefs.subscribe(listener),
    () => app.prefs.getState().uiScale,
    () => app.prefs.getState().uiScale,
  );
  const compact = size === 'compact';
  // the chrome's extent, for the floating grammar (pane px)
  const insetTop = size === 'regular' ? 128 : 76;
  const insetBottom = compact ? 148 : 84;
  const offSide = handedness === 'right' ? 'left-(--touch-inset-left)' : 'right-(--touch-inset-right)';
  const penSide = handedness === 'right' ? 'right-(--touch-inset-right)' : 'left-(--touch-inset-left)';
  const fade = breathing ? { opacity: 0.15, pointerEvents: 'none' as const } : undefined;
  return (
    <TouchRoot
      ref={ref}
      uiScale={uiScale}
      data-shell={HALO_SHELL_MARKER}
      data-testid="halo-shell"
      data-size={size}
      data-breathing={breathing ? '' : undefined}
      className="absolute inset-0 z-(--z-chrome) overflow-hidden text-fg"
    >
      <HaloPane controller={controller} />
      {locked && !home ? (
        <div
          aria-hidden="true"
          data-testid="halo-lock-tint"
          className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_3px_var(--accent)]"
        />
      ) : null}
      {home ? (
        <Home controller={controller} />
      ) : hideUi ? (
        <TouchIconButton
          label={en.view.showUi}
          icon={<Icon name="eye" />}
          data-testid="halo-show-ui"
          className={`absolute top-[max(12px,env(safe-area-inset-top))] ${penSide} opacity-40`}
          onClick={() => store.set({ hideUi: false })}
        />
      ) : (
        <>
          <HaloLayer
            controller={controller}
            width={width}
            height={height}
            size={size}
            insetTop={insetTop}
            insetBottom={insetBottom}
          />
          <div className="transition-opacity duration-(--motion-touch)" style={fade}>
            <TopBar controller={controller} size={size} />
          </div>
          <SessionBar controller={controller} top={insetTop} />
          <div
            className={`pointer-events-none absolute ${offSide} flex flex-col items-start gap-2.5`}
            style={{ bottom: `calc(var(--touch-inset-bottom) + ${insetBottom - 12}px)` }}
          >
            {compact ? null : (
              <TouchIconButton
                size="lg"
                label={en.undo.undo}
                icon={<Icon name="undo" />}
                data-testid="halo-undo"
                data-halo-chrome=""
                className="pointer-events-auto"
                onClick={() => {
                  store.set((s) => ({ touches: s.touches + 1 }));
                  grammar.undo();
                }}
              />
            )}
            <div className="pointer-events-auto transition-opacity duration-(--motion-touch)" style={fade}>
              <ThumbKeyView app={app} store={store} />
            </div>
          </div>
          <div
            className={`pointer-events-none absolute ${penSide} transition-opacity duration-(--motion-touch)`}
            style={{ ...fade, bottom: `calc(var(--touch-inset-bottom) + ${insetBottom - 12}px)` }}
          >
            <ViewPuck controller={controller} />
          </div>
          <div
            className="pointer-events-none absolute inset-x-0 flex flex-col items-stretch gap-2 px-(--touch-inset-left) transition-opacity duration-(--motion-touch)"
            style={{ ...fade, bottom: 'var(--touch-inset-bottom)' }}
          >
            <div className="flex justify-center">
              <Tray controller={controller} compact={compact} />
            </div>
            {compact ? (
              <div className="pointer-events-auto flex">
                <PathTabs controller={controller} bar />
              </div>
            ) : null}
          </div>
        </>
      )}
      <Sheets controller={controller} size={size} />
      {palette ? (
        <Suspense fallback={null}>
          <Palette controller={controller} side={size === 'wide' ? 'right' : 'bottom'} />
        </Suspense>
      ) : null}
      {projectMenu ? (
        <Suspense fallback={null}>
          <ProjectMenu controller={controller} />
        </Suspense>
      ) : null}
      <ToastRegion
        store={ctx.toasts}
        data-testid="halo-toasts"
        className="absolute bottom-[calc(var(--touch-inset-bottom)+150px)] left-1/2 z-(--z-popover) -translate-x-1/2"
        label={en.toast.region}
      />
    </TouchRoot>
  );
}
