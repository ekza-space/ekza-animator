// Toasts (STUDIO-TOUCH-SPEC §3 P5, §5.3 C9, §5.7): an inverse pill above the tray that names what happened and offers
// one action — "Undid: select 2 faces · Redo". Polite live region; resting a pointer on it or focusing it holds
// the timers. The store (toast-store.ts) is created by the shell; `useToasts` reads it.
import { type JSX, useSyncExternalStore } from 'react';
import { cn } from '../cn';
import type { ToastItem, ToastStore } from './toast-store';

export function useToasts(store: ToastStore): readonly ToastItem[] {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}

export function ToastRegion({
  store,
  label = 'Notifications',
  className,
  'data-testid': testId,
}: {
  readonly store: ToastStore;
  readonly label?: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
}): JSX.Element {
  const items = useToasts(store);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a resting pointer or focus only pauses the timers
    <section
      aria-label={label}
      data-testid={testId}
      className={cn('pointer-events-none flex max-w-[calc(100%-32px)] flex-col items-center gap-2', className)}
      onPointerEnter={() => store.hold(true)}
      onPointerLeave={() => store.hold(false)}
      onFocus={() => store.hold(true)}
      onBlur={() => store.hold(false)}
    >
      <ol aria-live="polite" className="m-0 flex list-none flex-col items-center gap-2 p-0">
        {items.map((t) => (
          <li
            key={t.id}
            data-tone={t.tone ?? 'neutral'}
            className={cn(
              'pointer-events-auto flex min-h-[52px] max-w-full items-center gap-3 rounded-full bg-toast py-1 pl-4 text-on-toast',
              'text-[14px] font-medium shadow-sheet animate-[ekza-touch-in_var(--motion-toast)_cubic-bezier(0.2,0.8,0.2,1)]',
              t.action === undefined ? 'pr-4' : 'pr-1',
            )}
          >
            {t.tone === 'warning' || t.tone === 'error' ? (
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', t.tone === 'error' ? 'bg-danger' : 'bg-warn')}
              />
            ) : null}
            <span className="min-w-0">{t.text}</span>
            {t.action === undefined ? null : (
              <button
                type="button"
                className="min-h-(--touch-hit) shrink-0 rounded-full bg-on-toast/10 px-4 font-semibold whitespace-nowrap text-on-toast active:bg-on-toast/20"
                onClick={() => {
                  t.action?.run();
                  store.dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
