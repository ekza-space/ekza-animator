// The harness's own diagnostic panel: what the fake app holds and evaluates. It edits session and document state
// directly (not through operators) because it is a test tool, not product UI.
import { DEG2RAD, RAD2DEG } from '@ekza-animator/anim-core';
import {
  BUILTIN_TABLES,
  type ChannelId,
  type ClipId,
  type ControlId,
  type CurveId,
  type DocumentStore,
  TRS_CHANNELS,
  type TrsChannel,
} from '@ekza-animator/doc';
import type { EditorApp } from '@ekza-animator/editor-core';
import type { JSX } from 'react';
import { useDocQuery, useSession } from '../hooks';
import type { PanelDef, PanelProps } from '../panels/types';

export const DEV_STATE_PANEL: PanelDef = {
  id: 'dev.state',
  kind: 'dev.state',
  title: 'Fake app state',
  component: DevStatePanel,
  keyScope: 'global',
};

interface CurveRow {
  readonly curve: CurveId;
  readonly control: ControlId;
  readonly controlKey: string;
  readonly channel: ChannelId;
  readonly keys: number;
}

function curveRows(store: DocumentStore, clip: ClipId | null): CurveRow[] {
  if (clip === null) return [];
  return store.query.curvesOfClip(clip).map((curve) => ({
    curve: curve.id,
    control: curve.control,
    controlKey: store.get('controls', curve.control)?.key ?? curve.control,
    channel: curve.channel,
    keys: store.query.keysOfCurve(curve.id).length,
  }));
}

const isTrs = (channel: ChannelId): channel is TrsChannel => (TRS_CHANNELS as readonly string[]).includes(channel);

/** Current value in display units (degrees for rotations), or '—' for custom attributes. */
function displayValue(app: EditorApp, row: CurveRow): string {
  if (!isTrs(row.channel)) return '—';
  const value = app.evaluation.channelValues(row.control)[row.channel];
  return (row.channel.startsWith('r') ? value * RAD2DEG : value).toFixed(3);
}

function DevStatePanel({ app }: PanelProps): JSX.Element {
  const time = useSession((s) => s.time);
  const character = useSession((s) => s.activeCharacter);
  const clip = useSession((s) => (character === null ? null : (s.activeClip[character] ?? null)));
  const counts = useDocQuery(
    (store) => BUILTIN_TABLES.map((table) => [table, store.list(table).length] as const),
    BUILTIN_TABLES,
  );
  const rows = useDocQuery((store) => curveRows(store, clip), ['clips', 'controls', 'curves', 'keys']);
  const undoLabel = useDocQuery((store) => store.undo.peekUndo()?.label ?? null, BUILTIN_TABLES);
  const clipFrame = character === null ? null : app.evaluation.clipFrame(character);

  const step = (delta: number): void =>
    app.session.setState({ time: { ...time, sceneFrame: time.sceneFrame + delta } });
  const offsetFirstCurve = (): void => {
    const first = rows[0];
    if (first === undefined) return;
    app.store.transact({ label: 'Offset Keys' }, (tx) => {
      for (const key of tx.query.keysOfCurve(first.curve)) tx.patch('keys', key.id, { v: key.v + 10 * DEG2RAD });
    });
  };
  const button = 'rounded bg-header px-2 py-0.5 disabled:opacity-40';

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 font-mono text-xs" data-testid="dev-state">
      <section className="flex flex-wrap items-center gap-2">
        <span>
          clip frame <b data-testid="dev-state-frame">{clipFrame ?? '—'}</b> (scene {time.sceneFrame})
        </span>
        <button type="button" className={button} data-testid="dev-state-prev" onClick={() => step(-1)}>
          ◀ frame
        </button>
        <button type="button" className={button} data-testid="dev-state-next" onClick={() => step(1)}>
          frame ▶
        </button>
        <button type="button" className={button} data-testid="dev-state-offset" onClick={offsetFirstCurve}>
          first curve +10°
        </button>
        <button
          type="button"
          className={button}
          data-testid="dev-state-undo"
          disabled={undoLabel === null}
          onClick={() => app.store.undo.undo()}
        >
          undo <span data-testid="dev-state-undo-label">{undoLabel ?? ''}</span>
        </button>
      </section>
      <table className="w-fit border-separate border-spacing-x-3 text-left">
        <caption className="text-left text-fg-2">Curves of the active clip</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.curve}>
              <td>{row.controlKey}</td>
              <td>{row.channel}</td>
              <td className="text-fg-3">{row.keys} keys</td>
              <td data-testid={`dev-state-value-${row.controlKey}-${row.channel}`}>{displayValue(app, row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="flex flex-wrap gap-x-4 text-fg-2">
        {counts.map(([table, count]) => (
          <li key={table}>
            {table} <b data-testid={`dev-state-count-${table}`}>{count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
