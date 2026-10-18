// Empty viewport (research 09 §10.1): drop hint, "Open file…" and the three bundled samples. Dropping a file is
// handled by the shell's window-wide drop target (WP-8); this card only explains it.
import type { EditorApp, SampleId } from '@ekza-animator/editor-core';
import type { JSX } from 'react';
import { useSession } from '../../hooks';

const SAMPLES: readonly {
  readonly id: SampleId;
  readonly label: string;
  readonly detail: string;
  readonly title?: string;
}[] = [
  { id: 'seed-san', label: 'Seed-san', detail: 'VRM 1.0' },
  {
    id: 'polybot',
    label: 'Polybot',
    detail: 'VRM 0.x · A-pose',
    title: 'Rests in an A-pose: VRMA clips from T-pose avatars play with the arms about 38° lower.',
  },
  { id: 'quaternius-ual', label: 'Quaternius UAL', detail: 'GLB with clips' },
];

export function EmptyState(props: { readonly app: EditorApp }): JSX.Element {
  const { app } = props;
  const busy = useSession((s) => s.busy !== null);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center p-4" data-testid="dropzone">
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--border-strong,#4b4e58)] bg-[color-mix(in_srgb,var(--bg-panel,#232428)_88%,transparent)] px-6 py-5 text-center text-[12px] text-fg-2">
        <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" className="text-fg-3">
          <path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <p className="text-[13px] text-fg">Drop a .glb or .vrm file anywhere</p>
        <button
          type="button"
          className="rounded bg-accent-fill px-3 py-1 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50"
          disabled={busy}
          data-testid="dropzone-open"
          onClick={() => void app.run('ui.open', { dialog: 'open' })}
        >
          Open file…
        </button>
        <p className="text-fg-3">or try a sample</p>
        <div className="flex flex-wrap justify-center gap-2">
          {SAMPLES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className="flex flex-col items-center rounded border border-line bg-header px-3 py-1.5 text-fg hover:bg-[var(--bg-hover,#30323a)] disabled:opacity-50"
              disabled={busy}
              data-testid={`sample-${sample.id}`}
              title={sample.title}
              onClick={() => void app.run('file.loadSample', { sample: sample.id })}
            >
              <span>{sample.label}</span>
              <span className="text-[10px] text-fg-3">{sample.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
