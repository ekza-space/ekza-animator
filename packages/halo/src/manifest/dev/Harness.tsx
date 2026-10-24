// The T6b harness shell (dev and e2e builds only; see `./index.ts`): mounts as `halo` and stands in for T6a's frame
// around the parts T6b builds — the Path with readiness, the status corner and the Next chip, the canvas pane, and the
// eight T6b sheets loaded lazily through `SHEET_LOADERS` with the `HaloSheetContext` the frame will hand them. It
// installs the parity probe and feeds the test API's `halo()` (stage, open sheet, noun, petals, the visible targets and
// a `t6b` slice with the readiness list). The launcher row (`data-harness`) is test chrome, not part of the layout,
// and is left out of the visible-target count.
import type { EditorApp } from '@ekza-studio/editor-core';
import { provideHaloTestState, useHost, useHostUi } from '@ekza-studio/editor/host';
import { Cluster, TouchButton, TouchRoot } from '@ekza-studio/ui/touch';
import {
  type ComponentType,
  type JSX,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DEFAULT_DESTINATION, type DestinationId, STAGE_WORKSPACE } from '../../path/destinations';
import { nextChip } from '../../path/nextChip';
import { Path, stageSwitch } from '../../path/Path';
import { readiness } from '../../path/readiness';
import { NextChipView, StatusCorner } from '../../path/StatusCorner';
import { useAppVersion } from '../../sheets/more/kit';
import { resolveNoun } from '../../verbs/nouns';
import { petalsFor } from '../../verbs/table';
import { installParityProbe } from '../probe';
import { SHEET_LOADERS } from '../sheetLoaders';
import { type HaloSheetContext, type HaloSheetProps, type SheetArgs, T6B_SHEETS, type T6bSheetId } from '../sheets';
import type { SheetId, Stage } from '../types';

const SHEETS = Object.fromEntries(T6B_SHEETS.map((id) => [id, lazy(SHEET_LOADERS[id])])) as unknown as Readonly<
  Record<T6bSheetId, ComponentType<HaloSheetProps>>
>;

const PANE = 'pane-single';

const stageOf = (workspace: string): Stage =>
  workspace === 'rig' ? 'rig' : workspace === 'animate' ? 'animate' : 'make';

/** Interactive targets visible on screen inside `root` (§4.8): harness chrome left out. */
export function countVisibleTargets(root: HTMLElement | null): number {
  if (root === null) return 0;
  const view = root.ownerDocument.defaultView;
  const width = view?.innerWidth ?? 0;
  const height = view?.innerHeight ?? 0;
  let count = 0;
  for (const element of root.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [role="tab"], [role="slider"], [role="switch"], [tabindex="0"]',
  )) {
    if (element.closest('[data-harness]') !== null) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height) continue;
    if (element.closest('[role="tablist"]') !== null && element.getAttribute('role') !== 'tab') continue;
    count += 1;
  }
  return count;
}

function HarnessPane(props: { readonly app: EditorApp }): JSX.Element {
  const vm = useHostUi((s) => s.viewport);
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = surface.current;
    if (vm === null || element === null) return undefined;
    const setup = vm.paneSetup(PANE);
    vm.registerPane({ id: PANE, element, camera: setup.camera, display: setup.display });
    return () => vm.unregisterPane(PANE);
  }, [vm]);
  void props.app;
  return (
    <div
      ref={surface}
      className="absolute inset-0 overflow-hidden outline-none"
      data-testid={`pane-${PANE}`}
      data-ekza-panel="viewport"
      data-ekza-pane={PANE}
    />
  );
}

export function HaloT6bHarness(): JSX.Element {
  const host = useHost();
  const app = host.app;
  useAppVersion(app);
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStageState] = useState<Stage>(() => stageOf(app.session.getState().workspace));
  const [sheet, setSheet] = useState<{ readonly id: SheetId; readonly args?: SheetArgs } | null>(null);
  const [destination, setDestination] = useState<DestinationId>(DEFAULT_DESTINATION);
  const [dismissed, setDismissed] = useState(false);
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024));

  useEffect(() => {
    const onResize = (): void => setWide(window.innerWidth >= 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const r = readiness(app, destination);
  const noun = resolveNoun(app, stage);
  const next = dismissed || sheet !== null ? null : nextChip(app, r);

  const setStage = (to: Stage): void => {
    void (async () => {
      for (const step of stageSwitch(app, to)) await host.runFromUi(step.op, step.args);
      setStageState(to);
    })();
  };

  const ctx = useMemo<HaloSheetContext>(
    () => ({
      host,
      stage,
      noun,
      destination,
      side: wide ? 'right' : 'bottom',
      close: () => setSheet(null),
      open: (id, args) => setSheet(args === undefined ? { id } : { id, args }),
      setStage,
      setDestination,
      run: (op, args) => host.runFromUi(op, args, { panel: 'viewport', paneId: PANE }),
      openPro: () => void host.navigation.go({ to: 'studio', from: 'halo', workspace: STAGE_WORKSPACE[stage] }),
    }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: setStage reads the latest host and app.
    [host, stage, noun, destination, wide],
  );

  useEffect(() => {
    installParityProbe(app);
    return host.mount({ kind: 'halo', haloState: () => ({ stage }) });
  }, [host, app, stage]);

  useEffect(
    () =>
      provideHaloTestState(app, () => ({
        stage,
        sheet: sheet?.id ?? null,
        noun: { kind: noun.kind, id: noun.id },
        petals: petalsFor(noun.kind, stage).map((petal) => petal.op ?? petal.id),
        threadLayer: 0,
        thumb: { mode: 'hidden', tap: null, drag: null },
        visibleTargets: countVisibleTargets(root.current),
        touches: 0,
        slices: {
          t6b: {
            destination,
            total: r.total,
            stages: r.stages,
            rows: r.rows.map((row) => ({ id: row.id, stage: row.stage, code: row.code, fix: row.fix?.op ?? null })),
            budget: r.budget,
            next: next?.id ?? null,
          },
        },
      })),
    [app, stage, sheet, noun, destination, r, next],
  );

  const Open =
    sheet !== null && (T6B_SHEETS as readonly string[]).includes(sheet.id) ? SHEETS[sheet.id as T6bSheetId] : null;
  const launch = (id: T6bSheetId, label: string): ReactNode => (
    <TouchButton key={id} variant="ghost" onClick={() => setSheet({ id })} data-testid={`harness-open-${id}`}>
      {label}
    </TouchButton>
  );

  return (
    <TouchRoot
      uiScale={app.prefs.getState().uiScale}
      className="relative z-(--z-chrome) h-full w-full overflow-hidden"
      data-shell="ekza-halo-t6b-harness"
      data-testid="halo-t6b-harness"
    >
      <div ref={root} className="absolute inset-0">
        <HarnessPane app={app} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 px-(--touch-inset-left) py-2">
          <Cluster className="pointer-events-auto flex items-center px-3">
            <span className="font-semibold">Ekza Studio</span>
          </Cluster>
          <div className="pointer-events-auto">
            <Path
              stage={stage}
              readiness={r}
              onStage={setStage}
              onProblems={(problemStage) => setSheet({ id: 'health', args: { section: problemStage } })}
            />
          </div>
          <span className="flex-1" />
          <div className="pointer-events-auto">
            <StatusCorner readiness={r} onOpenHealth={() => setSheet({ id: 'health' })} />
          </div>
        </div>
        <div className="pointer-events-auto absolute bottom-(--touch-inset-bottom) left-(--touch-inset-left)">
          <NextChipView
            chip={next}
            onChip={(chip) => {
              if (chip.stage !== undefined) setStage(chip.stage);
              if (chip.sheet !== undefined) setSheet({ id: chip.sheet });
            }}
            onDismiss={() => setDismissed(true)}
          />
        </div>
        <Cluster
          data-harness=""
          className="pointer-events-auto absolute top-16 left-(--touch-inset-left) flex max-w-[60%] flex-wrap gap-1 p-1"
        >
          {launch('more', 'More')}
          {launch('numbers', 'Numbers')}
          {launch('scene', 'Scene')}
          {launch('view', 'View')}
          {launch('settings', 'Settings')}
          {launch('health', 'Health')}
          {launch('help', 'Help')}
          {launch('about', 'About')}
        </Cluster>
        {Open === null || sheet === null ? null : (
          <div className="absolute inset-0 top-14" data-testid="halo-sheet-host">
            <Suspense fallback={null}>
              <Open ctx={ctx} {...(sheet.args === undefined ? {} : { args: sheet.args })} />
            </Suspense>
          </div>
        )}
      </div>
    </TouchRoot>
  );
}
