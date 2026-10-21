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
}): JSX.Element {
  const { app, character } = props;
  const thumbnail = useDocQuery(
    (store) => store.get('characters', character)?.vrm?.thumbnail ?? null,
    ['characters'],
  ) as AssetId | null;
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (thumbnail === null) {
      setUrl(null);
      return;
    }
    let live = true;
    let created: string | null = null;
    void app.services.assets
      .get(thumbnail)
      .then((bytes) => {
        if (!live || typeof URL.createObjectURL !== 'function') return;
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setUrl(created);
      })
      .catch(() => {
        if (live) setUrl(null);
      });
    return () => {
      live = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [app, thumbnail]);
  const size = props.size ?? 112;
  const run = props.run ?? ((op: string, args: unknown) => app.runUntyped(op, args));
  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="export-char-thumb" data-asset={thumbnail ?? ''}>
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
          <img src={url} alt="Thumbnail" width={size} height={size} />
        )}
      </div>
      <Button
        size="sm"
        variant="default"
        disabled={busy}
        data-testid="export-char-thumb-render"
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
