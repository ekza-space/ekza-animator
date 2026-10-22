// The Rig Toolkit's Character section (M6B-SPEC §8.6, §8.9 Attributes › Character inside the Toolkit — the CR-5
// fallback; C10): the Rig & Skin character's name and source, its VRM meta at a glance (licence, authors), the
// thumbnail with Render, and the buttons VRM Meta… and Export Character…. Imported avatars show their source only.
import { characterOf } from '@ekza-studio/editor-core';
import { VRM_LICENCE_CHOICES } from '@ekza-studio/io';
import { Button } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { ThumbnailPreview } from '../../../../dialogs/export/character/ThumbnailPreview';
import { useDocQuery, useSession } from '../../../../hooks';
import type { RigToolkitSectionProps } from '../types';

export function CharacterSection({ app }: RigToolkitSectionProps): JSX.Element | null {
  const key = useSession((s) => `${s.rig.character ?? ''}:${s.activeCharacter ?? ''}`);
  const character = useDocQuery(() => characterOf(app, undefined), ['characters']);
  void key;
  const record = useDocQuery(
    (store) => (character === null ? undefined : store.get('characters', character)),
    ['characters'],
  );
  if (character === null || record === undefined) return null;
  const run = (op: string, args: unknown) => app.runUntyped(op, args);
  if (record.source?.kind !== 'model') {
    return (
      <div className="flex flex-col gap-1 text-ui text-fg-2" data-testid="attr-char-panel">
        <span data-testid="attr-char-name">{record.name}</span>
        <span className="text-fg-3" data-testid="attr-char-source">
          Imported avatar: its VRM meta is the file's; export it with File › Export.
        </span>
      </div>
    );
  }
  const meta = record.vrm;
  const licence = VRM_LICENCE_CHOICES.find((choice) => choice.id === meta?.licensePreset)?.label ?? 'Not chosen';
  const authors = meta?.authors.filter((author) => author.trim() !== '') ?? [];
  return (
    <div className="flex flex-col gap-2 text-ui" data-testid="attr-char-panel">
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-fg-2">
        <dt className="text-fg-3">Name</dt>
        <dd data-testid="attr-char-name">{meta?.name ?? record.name}</dd>
        <dt className="text-fg-3">Source</dt>
        <dd data-testid="attr-char-source">Made from your model</dd>
        <dt className="text-fg-3">Authors</dt>
        <dd data-testid="attr-char-authors" className={authors.length === 0 ? 'text-warn' : undefined}>
          {authors.length === 0 ? 'None yet (required)' : authors.join(', ')}
        </dd>
        <dt className="text-fg-3">Licence</dt>
        <dd
          data-testid="attr-char-licence"
          className={(meta?.licensePreset ?? null) === null ? 'text-warn' : undefined}
        >
          {licence}
        </dd>
      </dl>
      <ThumbnailPreview app={app} character={character} run={run} size={72} testId="attr-char-thumb" />
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          data-testid="rtk-btn-char.setVrmMeta"
          onClick={() => void app.runUntyped('char.setVrmMeta', { character })}
        >
          VRM Meta…
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="rtk-btn-file.exportCharacter"
          onClick={() => void app.runUntyped('ui.open', { dialog: 'export' })}
        >
          Export Character…
        </Button>
      </div>
    </div>
  );
}
