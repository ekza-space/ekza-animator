// The Poly Count HUD (M6A-SPEC §5.24, §8.7; B10): top-left of each Model pane while the pane's `polyCount` flag is on.
// A lazy chunk (Model only). It recomputes when the selection service, the session's Model state, a mesh runtime or
// the meshes table changes — never per frame.
import { type JSX, useEffect, useState } from 'react';
import type { PaneOverlayProps } from '../../../overlays/slots';
import { type HudCounts, type HudData, hudData } from './data';

const ROWS: readonly { readonly key: keyof HudCounts; readonly label: string }[] = [
  { key: 'vertex', label: 'Verts' },
  { key: 'edge', label: 'Edges' },
  { key: 'face', label: 'Faces' },
  { key: 'tris', label: 'Tris' },
  { key: 'uvs', label: 'UVs' },
];

const number = (value: number): string => value.toLocaleString('en');

/** The HUD's numbers, recomputed (once per microtask) whenever its inputs may have changed. */
function useHudData(props: PaneOverlayProps): HudData | null {
  const { app, paneId } = props;
  const [data, setData] = useState(() => hudData(app, paneId));
  useEffect(() => {
    let pending = false;
    const bump = (): void => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        pending = false;
        setData(hudData(app, paneId));
      });
    };
    bump();
    const offSession = app.session.subscribe((state, previous) => {
      const a = state.model;
      const b = previous.model;
      if (
        state.workspace !== previous.workspace ||
        state.selection.objects !== previous.selection.objects ||
        a.components !== b.components ||
        a.componentMode !== b.componentMode ||
        a.hilite !== b.hilite ||
        a.hiddenObjects !== b.hiddenObjects ||
        a.isolate !== b.isolate ||
        a.symmetry !== b.symmetry ||
        a.softSelect !== b.softSelect
      ) {
        bump();
      }
    });
    const offMeshes = app.meshes.subscribe(bump);
    const offStore = app.store.subscribe((batch) => {
      if (
        batch.origin === 'load' ||
        batch.changes.some((change) => change.table === 'meshes' || change.table === 'groups')
      ) {
        bump();
      }
    });
    return () => {
      offSession();
      offMeshes();
      offStore();
    };
  }, [app, paneId]);
  return data;
}

export default function Hud(props: PaneOverlayProps): JSX.Element | null {
  const { paneId } = props;
  const data = useHudData(props);
  if (data === null) return null;
  const columns: readonly { readonly title: string; readonly counts: HudCounts; readonly sym?: HudCounts }[] = [
    { title: 'Scene', counts: data.scene },
    { title: 'Object', counts: data.object },
    { title: 'Selected', counts: data.selected, sym: data.selectedSym },
  ];
  const rows = ROWS.filter((row) => row.key !== 'uvs' || data.scene.uvs !== undefined);
  const { budget } = data;
  const share = budget.limit === null ? 0 : Math.min(1, budget.tris / budget.limit);
  const tone =
    budget.state === 'danger'
      ? 'bg-[var(--lint-error,#ef6b6b)]'
      : budget.state === 'warn'
        ? 'bg-[var(--lint-ngon,#e3b34a)]'
        : 'bg-[var(--comp-selected,#ffa31a)]';
  return (
    <div
      className="select-none rounded-sm bg-[#14151acc] px-1.5 py-1 font-mono text-[10px] leading-[14px] text-fg-2 tabular-nums"
      data-testid={`hud-${paneId}`}
      data-mode={data.mode}
    >
      <div className="font-semibold tracking-wide text-fg" data-testid={`hud-mode-${paneId}`}>
        {data.badge}
      </div>
      <table className="border-separate border-spacing-x-2">
        <thead>
          <tr className="text-fg-3">
            <th scope="col">
              <span className="sr-only">Count</span>
            </th>
            {columns.map((column) => (
              <th key={column.title} className="text-right font-normal">
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="text-fg-3">{row.label}</td>
              {columns.map((column) => {
                const value = column.counts[row.key] ?? 0;
                const sym = column.sym?.[row.key] ?? 0;
                return (
                  <td
                    key={column.title}
                    className="text-right"
                    data-testid={`hud-${paneId}-${column.title.toLowerCase()}-${row.key}`}
                  >
                    {number(value)}
                    {sym > 0 ? <span className="text-fg-3">{` (+${number(sym)} sym)`}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className="mt-0.5 flex items-center gap-1.5"
        data-testid={`hud-budget-${paneId}`}
        data-state={budget.state}
        title={budget.limit === null ? 'No triangle budget' : `Budget: ${number(budget.limit)} triangles`}
      >
        <span className="text-fg-3">Budget</span>
        <span className="relative h-1.5 w-16 overflow-hidden rounded-sm bg-[#3a3d46]" aria-hidden="true">
          <span className={`absolute inset-y-0 left-0 ${tone}`} style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
        <span>
          {budget.limit === null
            ? `${number(budget.tris)} tris`
            : `${number(budget.tris)} / ${number(budget.limit)} tris${budget.label === null ? '' : ` · ${budget.label}`}`}
          {budget.state === 'danger' ? ' · over' : budget.state === 'warn' ? ' · near' : ''}
        </span>
      </div>
    </div>
  );
}
