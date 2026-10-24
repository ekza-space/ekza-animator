// The sheet slot (STUDIO-TOUCH-SPEC §4.1, §20.6): one sheet at a time — on the right edge (360 pt) of wide containers,
// from the bottom in portrait and on phones (full height on Compact). Every sheet is lazy. The bodies are other work
// packages' (More, Numbers, Scene, View, Settings, Health, Help, About: T6b; Share: T11; Library: T7; History: T10):
// they register here (`registerHaloSheet`); the grammar ships a stand-in More list, and a sheet not registered yet says
// so and offers *Open in the Pro layout ▸*, never a dead end.
import type { UiDialog } from '@ekza-studio/editor-core';
import { Sheet, TouchButton } from '@ekza-studio/ui/touch';
import { type ComponentType, createElement, type JSX, lazy, Suspense } from 'react';
import { en } from '../i18n/en';
import type { HaloController } from './controller';
import type { SizeClass } from './hooks';
import { useHaloStore } from './store';

export interface SheetBodyProps {
  readonly controller: HaloController;
}

const MoreSheet = lazy(() => import('../halo/MoreSheet'));

const registry = new Map<string, ComponentType<SheetBodyProps>>();

/** A sheet body for an id ('numbers', 'scene', 'share', …): a lazy component; the disposer removes it. */
export function registerHaloSheet(id: string, body: ComponentType<SheetBodyProps>): () => void {
  registry.set(id, body);
  return () => {
    if (registry.get(id) === body) registry.delete(id);
  };
}

/** The Pro dialog a sheet's *Open in the Pro layout ▸* arrives at (§16.1). */
const PRO_ARRIVAL: Readonly<Record<string, UiDialog>> = {
  share: 'export',
  settings: 'preferences',
  help: 'shortcuts',
  about: 'vrmMeta',
};

export function Sheets({
  controller,
  size,
}: {
  readonly controller: HaloController;
  readonly size: SizeClass;
}): JSX.Element | null {
  const { store } = controller.ctx;
  const sheet = useHaloStore(store, (s) => s.sheet);
  if (sheet === null) return null;
  const close = (open: boolean): void => {
    if (!open) store.set({ sheet: null });
  };
  const side = size === 'wide' ? 'right' : 'bottom';
  if (sheet === 'more') {
    return (
      <Suspense fallback={null}>
        <MoreSheet controller={controller} side={side} onOpenChange={close} />
      </Suspense>
    );
  }
  const body = registry.get(sheet);
  if (body !== undefined) return <Suspense fallback={null}>{createElement(body, { controller })}</Suspense>;
  const arrival = PRO_ARRIVAL[sheet];
  return (
    <Sheet
      data-testid={`halo-sheet-${sheet}`}
      open
      onOpenChange={close}
      modal={false}
      side={side}
      defaultDetent={size === 'compact' ? 'full' : 'half'}
      title={en.sheets[sheet] ?? sheet}
      footer={
        <TouchButton
          className="flex-1"
          onClick={() => {
            store.set({ sheet: null });
            controller.proLayout(true, arrival);
          }}
        >
          {en.toast.openInPro}
        </TouchButton>
      }
    >
      <p className="m-0 py-2 text-fg-2">{en.sheet.soon}</p>
    </Sheet>
  );
}
