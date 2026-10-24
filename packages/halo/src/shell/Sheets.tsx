// The sheet slot (STUDIO-TOUCH-SPEC §4.1, §20.6): one sheet at a time — on the right edge (360 pt) of wide containers,
// from the bottom in portrait and on phones (full height on Compact). Every sheet is lazy. T6b's eight (More, Numbers,
// Scene, View, Settings, Health, Help, About) load through `SHEET_LOADERS`; the other packages register theirs here
// (`registerHaloSheet`: Share T11, Library T7, History T10, …). Each body gets the frame's `HaloSheetContext` — stage,
// noun, destination, where it docks, and the frame's verbs (open, close, run, the stage, the Pro layout, Hide UI,
// verb → target, the Input rows' slot). A sheet not registered yet says so and offers *Open in the Pro layout ▸*,
// never a dead end.
import type { UiDialog } from '@ekza-studio/editor-core';
import { Sheet, TouchButton } from '@ekza-studio/ui/touch';
import { type ComponentType, type JSX, lazy, type ReactNode, Suspense, useMemo } from 'react';
import { startTarget } from '../halo/run';
import { TARGET_OPS } from '../halo/verbSource';
import { en } from '../i18n/en';
import { SHEET_LOADERS } from '../manifest/sheetLoaders';
import { type HaloSheetContext, type HaloSheetProps, T6B_SHEETS, type T6bSheetId } from '../manifest/sheets';
import { resolveNoun } from '../verbs/nouns';
import type { HaloController } from './controller';
import { type SizeClass, useDocumentVersion, useSessionValue } from './hooks';
import { useHaloStore } from './store';

export type { HaloSheetContext, HaloSheetProps };

const InputSettings = lazy(() => import('../input/InputSettings'));

/** T6b's sheets, each its own chunk (§20.6). */
const T6B: Readonly<Record<T6bSheetId, ComponentType<HaloSheetProps>>> = Object.fromEntries(
  T6B_SHEETS.map((id) => [id, lazy(SHEET_LOADERS[id])]),
) as unknown as Record<T6bSheetId, ComponentType<HaloSheetProps>>;

const registry = new Map<string, ComponentType<HaloSheetProps>>();

/**
 * A sheet body for an id ('share', 'library', 'history', …): a (lazy) component taking the frame's
 * `HaloSheetContext`; it wins over a built-in sheet of the same id. The disposer removes it.
 */
export function registerHaloSheet(id: string, body: ComponentType<HaloSheetProps>): () => void {
  registry.set(id, body);
  return () => {
    if (registry.get(id) === body) registry.delete(id);
  };
}

/** The body of a sheet id: a registered one, else T6b's, else null (not built yet). */
export function sheetBody(id: string): ComponentType<HaloSheetProps> | null {
  return registry.get(id) ?? (T6B as Readonly<Record<string, ComponentType<HaloSheetProps>>>)[id] ?? null;
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
  const { ctx } = controller;
  const { store, app, host } = ctx;
  const sheet = useHaloStore(store, (s) => s.sheet);
  const args = useHaloStore(store, (s) => s.sheetArgs);
  const own = useHaloStore(store, (s) => s.sheetNoun);
  const stage = useHaloStore(store, (s) => s.stage);
  const destination = useHaloStore(store, (s) => s.destination);
  const selection = useSessionValue(app, (s) => s.selection);
  const components = useSessionValue(app, (s) => s.model.components.version);
  const version = useDocumentVersion(app);
  const side = size === 'wide' ? 'right' : 'bottom';
  const compact = size === 'compact';
  const noun = useMemo(
    () => own ?? resolveNoun(app, stage),
    // the selection, the component counts and the document decide the live noun
    // oxlint-disable-next-line react/exhaustive-deps
    [own, app, stage, selection, components, version],
  );
  const sheetCtx = useMemo<HaloSheetContext | null>(() => {
    if (sheet === null) return null;
    return {
      host,
      stage,
      noun,
      destination: destination as HaloSheetContext['destination'],
      side,
      compact,
      close: () => store.set({ sheet: null, sheetArgs: null, sheetNoun: null }),
      open: (id, next) => store.set({ sheet: id, sheetArgs: next ?? null, sheetNoun: null, halo: null }),
      setStage: (to) => void controller.enterStage(to),
      setDestination: (to) => store.set({ destination: to }),
      run: (op, runArgs) => ctx.run(op, runArgs),
      openPro: () => {
        store.set({ sheet: null, sheetArgs: null, sheetNoun: null });
        controller.proLayout(true, PRO_ARRIVAL[sheet]);
      },
      hideUi: () => store.set({ hideUi: true, sheet: null, sheetArgs: null, sheetNoun: null, halo: null }),
      startTarget: (op, label) => {
        if (!TARGET_OPS.has(op)) return false;
        startTarget(ctx, label, op as never);
        return true;
      },
      renderSlot: (slot): ReactNode =>
        slot === 'halo.input' ? (
          <Suspense fallback={null}>
            <InputSettings store={store} setInput={(patch) => controller.setInput(patch)} />
          </Suspense>
        ) : null,
    };
  }, [sheet, host, stage, noun, destination, side, compact, store, controller, ctx]);

  if (sheet === null || sheetCtx === null) return null;
  const Body = sheetBody(sheet);
  if (Body !== null) {
    return (
      <Suspense fallback={null}>
        <Body key={sheet} ctx={sheetCtx} {...(args === null ? {} : { args })} />
      </Suspense>
    );
  }
  const arrival = PRO_ARRIVAL[sheet];
  return (
    <Sheet
      data-testid={`halo-sheet-${sheet}`}
      open
      onOpenChange={(open) => {
        if (!open) sheetCtx.close();
      }}
      modal={false}
      side={side}
      defaultDetent={compact ? 'full' : 'half'}
      title={en.sheets[sheet] ?? sheet}
      footer={
        <TouchButton
          className="flex-1"
          onClick={() => {
            sheetCtx.close();
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
