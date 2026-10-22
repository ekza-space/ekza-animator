// The thumbnail of a model character (M6B-SPEC §8.13, §5.22; C10): the stored 1024 × 1024 PNG (shown small) and
// Render, which runs `char.renderThumbnail` (one undo step).
import type { AssetId, CharacterId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { Button } from '@ekza-studio/ui';
import { type JSX, useEffect, useState } from 'react';
import { useDocQuery } from '../../../hooks';

export function ThumbnailPreview(props: {
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly run?: (op: string, args: unknown) => Promise<unknown>;
  readonly size?: number;
  /** `data-testid` stem (the Export dialog's `export-char-thumb`; the Rig Toolkit's `attr-char-thumb`). */
  readonly testId?: string;
}): JSX.Element {
  const { app, character } = props;
  const thumbnail: AssetId | null = useDocQuery(
    (store) => store.get('characters', character)?.vrm?.thumbnail ?? null,
    ['characters'],
  );
  // The object URL of the stored PNG, tagged with the asset it shows (another asset shows nothing until loaded).
  const [shown, setShown] = useState<{ readonly asset: AssetId; readonly url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (thumbnail === null) return;
    let live = true;
    let created: string | null = null;
    void app.services.assets
      .get(thumbnail)
      .then((bytes) => {
        if (!live || typeof URL.createObjectURL !== 'function') return;
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setShown({ asset: thumbnail, url: created });
      })
      .catch(() => {});
    return () => {
      live = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [app, thumbnail]);
  const url = shown !== null && shown.asset === thumbnail ? shown.url : null;
  const size = props.size ?? 112;
  const testId = props.testId ?? 'export-char-thumb';
  const run = props.run ?? ((op: string, args: unknown) => app.runUntyped(op, args));
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid={testId} data-asset={thumbnail ?? ''}>
      <div
        className="grid place-items-center overflow-hidden rounded-button border border-line bg-field text-ui-dense text-fg-3"
        style={{ width: size, height: size }}
      >
        {url === null ? (
          thumbnail === null ? (
            'No thumbnail'
          ) : (
            '…'
          )
        ) : (
          <div
            title="Thumbnail"
            data-testid={`${testId}-image`}
            style={{ width: size, height: size, backgroundImage: `url(${url})`, backgroundSize: 'cover' }}
          />
        )}
      </div>
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        data-testid={`${testId}-render`}
        onClick={() => {
          setBusy(true);
          void run('char.renderThumbnail', { character }).finally(() => setBusy(false));
        }}
      >
        {busy ? 'Rendering…' : thumbnail === null ? 'Render Thumbnail' : 'Render Again'}
      </Button>
    </div>
  );
}
