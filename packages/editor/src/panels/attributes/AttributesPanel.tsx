// Attributes (research 09 §4.6, MVP-SPEC §7 WP-9): collapsible sections for the lead control (name, side, rotate
// order, shape size), the active clip's settings, the active character (format, licence, credits, height) and the
// shot cameras (lock, focal length ↔ FOV). Every edit runs an operator.
// M2a (M2A-SPEC §5.6, §5.2.3, §5.7; A2): the Limb section of the lead control's limb — IK/FK (switch with match),
// Match FK to IK / IK to FK, the switch key mode (`prefs.ikFkSwitchKey`), the foot pivots of legs (cm, break angle in
// degrees; `rig.setFootParams`) — and "Add Limb IK" on humanoid rigs without limb IK.
import type {
  AssetRecord,
  CameraRecord,
  CharacterId,
  CharacterRecord,
  ClipId,
  ClipRecord,
  ControlRecord,
  DocumentStore,
} from '@ekza-animator/doc';
import { type EditorApp, PANEL, type SessionState } from '@ekza-animator/editor-core';
import { type JSX, useCallback, useId, useMemo, useState } from 'react';
import { useDocQuery, useSession } from '../../hooks';
import type { PanelProps } from '../types';
import { NumberField } from '../channel-box/kit/fields';
import { sameIds, selectedControls, useCharactersVersion } from '../channel-box/kit/hooks';
import { LockIcon } from '../channel-box/kit/icons';
import { formatFixed, readVrmLicense } from '../channel-box/kit/kernel';
import { canRun, runOperator, runUntypedOperator } from '../channel-box/kit/run';
import { BUTTON, CHECK, MUTED_TEXT, PANEL_ROOT, SELECT, SIDE_COLOR, SIDE_LABEL } from '../channel-box/kit/styles';
import { ClipNameInput } from '../clips/ClipNameInput';
import { ClipSettingsForm } from '../clips/ClipSettingsForm';
import {
  focalLengthFromFov,
  fovFromDegrees,
  fovFromFocalLength,
  fovToDegrees,
  validateFocalLength,
  validateFovDegrees,
} from './lens';
import { licenceSummary } from './licence';
import { Field, Fields, Section } from './layout';
import { LimbSection } from './LimbSection';

const PANEL_KIND = PANEL.attributes;

/**
 * Lens edits need an undoable camera operator the M1 catalog lacks: contract request R-3 in docs/wp-notes/wp-9.md
 * (`view.camera.setSettings { camera, fovY?, near?, far?, aspect? }`). The fields stay read-only until an operator
 * with this id is registered and polls true.
 */
export const CAMERA_SETTINGS_OP = 'view.camera.setSettings';

const ROTATE_ORDERS = ['xyz', 'yzx', 'zxy', 'xzy', 'yxz', 'zyx'] as const;
const FORMAT_LABEL = { vrm0: 'VRM 0.x', vrm1: 'VRM 1.0', gltf: 'glTF' } as const;
const GROUP_LABEL = { body: 'Body', fingers: 'Fingers', face: 'Face', secondary: 'Secondary' } as const;

interface AttributesView {
  readonly control: ControlRecord | null;
  readonly mirror: ControlRecord | null;
  readonly character: CharacterRecord | null;
  readonly asset: AssetRecord | null;
  readonly clip: ClipRecord | null;
  readonly cameras: readonly CameraRecord[];
}

const selectActiveCharacter = (s: SessionState): CharacterId | null => s.activeCharacter;
const selectActiveClipId = (s: SessionState): ClipId | null =>
  s.activeCharacter === null ? null : (s.activeClip[s.activeCharacter] ?? null);

export function AttributesPanel({ app, instanceId }: PanelProps): JSX.Element {
  const selected = useSession(selectedControls, sameIds);
  const activeCharacter = useSession(selectActiveCharacter);
  const activeClipId = useSession(selectActiveClipId);
  const leadId = selected.at(-1) ?? null;
  const read = useCallback(
    (store: DocumentStore): AttributesView => {
      const control = leadId === null ? null : (store.get('controls', leadId) ?? null);
      const mirror =
        control === null || control.mirror === null ? null : (store.get('controls', control.mirror) ?? null);
      const character = activeCharacter === null ? null : (store.get('characters', activeCharacter) ?? null);
      return {
        control,
        mirror,
        character,
        asset: character === null ? null : (store.get('assets', character.asset) ?? null),
        clip: activeClipId === null ? null : (store.get('clips', activeClipId) ?? null),
        cameras: [...store.list('cameras')].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0)),
      };
    },
    [leadId, activeCharacter, activeClipId],
  );
  const view = useDocQuery(read, ['controls', 'characters', 'assets', 'clips', 'cameras']);

  return (
    <div className={`${PANEL_ROOT} overflow-auto`} data-testid="attributes-panel" data-instance={instanceId}>
      <Section title="Control" testId="attr-section-control">
        {view.control === null ? (
          <p className={MUTED_TEXT}>Select a control.</p>
        ) : (
          <ControlFields app={app} control={view.control} mirror={view.mirror} />
        )}
      </Section>
      <LimbSection app={app} control={view.control} />
      <Section title="Clip" testId="attr-section-clip">
        {view.clip === null ? (
          <p className={MUTED_TEXT}>No active clip.</p>
        ) : (
          <ClipFields key={view.clip.id} app={app} clip={view.clip} />
        )}
      </Section>
      <Section title="Character" testId="attr-section-character">
        {view.character === null ? (
          <p className={MUTED_TEXT}>No character loaded.</p>
        ) : (
          <CharacterFields app={app} character={view.character} asset={view.asset} />
        )}
      </Section>
      <Section title="Cameras" testId="attr-section-cameras">
        {view.cameras.length === 0 ? (
          <p className={MUTED_TEXT}>No shot camera.</p>
        ) : (
          view.cameras.map((camera) => <CameraFields key={camera.id} app={app} camera={camera} />)
        )}
      </Section>
    </div>
  );
}

function ControlFields(props: {
  readonly app: EditorApp;
  readonly control: ControlRecord;
  readonly mirror: ControlRecord | null;
}): JSX.Element {
  const { app, control, mirror } = props;
  const id = useId();
  const orderPoll = app.operators.poll(
    'rig.setRotateOrder',
    { panel: PANEL_KIND },
    { control: control.id, order: control.rotateOrder },
  );
  const orderEditable = orderPoll === true;
  const bone = control.drives?.bone;
  return (
    <Fields>
      <Field label="Name">
        <span className="block truncate" data-testid="attr-control-name">
          {control.name}
        </span>
        <span className="block truncate font-mono text-fg-3" data-testid="attr-control-key">
          {control.key}
        </span>
      </Field>
      <Field label="Side">
        <span className="flex items-center gap-1.5" data-testid="attr-control-side">
          <span className="inline-block size-2.5 rounded-full" style={{ background: SIDE_COLOR[control.side] }} />
          {SIDE_LABEL[control.side]}
          <span className={MUTED_TEXT}>· {GROUP_LABEL[control.group]}</span>
        </span>
      </Field>
      <Field label="Rotate order" htmlFor={`${id}-order`}>
        <select
          id={`${id}-order`}
          className={`${SELECT} w-24 font-mono`}
          value={control.rotateOrder}
          disabled={!orderEditable}
          title={
            orderEditable
              ? 'First letter applied first; the pose is kept at every key (between keys the motion can differ)'
              : `Read-only: ${orderPoll.reason}. The pose-preserving change is an M1-stretch item.`
          }
          data-testid="attr-rotate-order"
          onChange={(event) =>
            void runOperator(app, PANEL_KIND, 'rig.setRotateOrder', {
              control: control.id,
              order: event.currentTarget.value as (typeof ROTATE_ORDERS)[number],
            })
          }
        >
          {ROTATE_ORDERS.map((order) => (
            <option key={order} value={order}>
              {order}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Shape">
        <span data-testid="attr-shape-kind">{control.shape.kind}</span>
      </Field>
      <Field label="Shape size (m)" htmlFor={`${id}-size`}>
        <NumberField
          id={`${id}-size`}
          className="w-24 text-right tabular-nums"
          ariaLabel="Shape size in metres"
          testId="attr-shape-size"
          value={control.shape.size}
          validate={(size) => (size > 0 && size <= 100 ? null : 'Size must be above 0 and at most 100 m')}
          onValue={(size) => void runOperator(app, PANEL_KIND, 'rig.setControlSize', { control: control.id, size })}
        />
      </Field>
      <Field label="Drives">
        <span className="block truncate" data-testid="attr-control-drives">
          {bone === undefined
            ? 'Nothing (a space control)'
            : 'humanoid' in bone
              ? `${bone.humanoid} (humanoid)`
              : bone.name}
        </span>
      </Field>
      <Field label="Mirror">
        <span className="block truncate" data-testid="attr-control-mirror">
          {mirror === null ? '—' : mirror.name}
        </span>
      </Field>
    </Fields>
  );
}

function ClipFields(props: { readonly app: EditorApp; readonly clip: ClipRecord }): JSX.Element {
  const { app, clip } = props;
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Fields>
        <Field label="Name">
          {renaming ? (
            <ClipNameInput app={app} panel={PANEL_KIND} clip={clip} onDone={() => setRenaming(false)} />
          ) : (
            <span className="flex items-center gap-1">
              <span className="truncate" data-testid="attr-clip-name">
                {clip.name}
              </span>
              <button
                type="button"
                className={BUTTON}
                aria-label={`Rename clip ${clip.name}`}
                data-testid="attr-clip-rename"
                onClick={() => setRenaming(true)}
              >
                Rename
              </button>
            </span>
          )}
        </Field>
      </Fields>
      <ClipSettingsForm app={app} panel={PANEL_KIND} clip={clip} />
    </div>
  );
}

const TONE_CLASS = {
  ok: 'border-[var(--ok,#65a878)] text-[var(--ok,#65a878)]',
  warn: 'border-[var(--warn,#e3b34a)] text-[var(--warn,#e3b34a)]',
  muted: 'border-line text-fg-3',
} as const;

function CharacterFields(props: {
  readonly app: EditorApp;
  readonly character: CharacterRecord;
  readonly asset: AssetRecord | null;
}): JSX.Element {
  const { app, character, asset } = props;
  const version = useCharactersVersion(app);
  const runtime = useMemo(() => {
    void version; // the registry reports runtime changes
    return app.characters.get(character.id) ?? null;
  }, [app, character.id, version]);
  const licence = useMemo(
    () => licenceSummary(character.format, runtime === null ? undefined : readVrmLicense(runtime.container)),
    [character.format, runtime],
  );
  return (
    <Fields>
      <Field label="Name">
        <span className="block truncate" data-testid="attr-character-name">
          {character.name}
        </span>
      </Field>
      <Field label="Format">
        <span data-testid="attr-character-format">{FORMAT_LABEL[character.format]}</span>
      </Field>
      <Field label="File">
        <span className="block truncate" title={asset?.id} data-testid="attr-character-file">
          {asset === null ? '—' : `${asset.name} · ${formatBytes(asset.size)}`}
        </span>
      </Field>
      <Field label="Height">
        <span data-testid="attr-character-height">
          {runtime === null
            ? 'Loading…'
            : `${formatFixed(runtime.skeleton.height, 2)} m (${runtime.skeleton.heightSource === 'mesh' ? 'mesh bounds' : 'joint estimate'})`}
        </span>
      </Field>
      <Field label="Licence">
        <span
          className={`inline-block max-w-full truncate rounded-[3px] border px-1 leading-4 ${TONE_CLASS[licence.tone]}`}
          title={licence.details ?? undefined}
          data-testid="attr-licence-badge"
          data-tone={licence.tone}
        >
          {licence.title}
        </span>
        {licence.details === null ? null : (
          <span className={`block ${MUTED_TEXT}`} data-testid="attr-licence-details">
            {licence.details}
          </span>
        )}
      </Field>
      <Field label="Credits">
        <span className="block" data-testid="attr-character-credits">
          {licence.credits ?? '—'}
        </span>
      </Field>
    </Fields>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatFixed(bytes / 1024, 1)} KB`;
  return `${formatFixed(bytes / (1024 * 1024), 1)} MB`;
}

function CameraFields(props: { readonly app: EditorApp; readonly camera: CameraRecord }): JSX.Element {
  const { app, camera } = props;
  const id = useId();
  const editable = canRun(app, PANEL_KIND, CAMERA_SETTINGS_OP, { camera: camera.id, fovY: camera.fovY });
  const readOnlyWhy = `Read-only until the ${CAMERA_SETTINGS_OP} operator exists (contract request)`;
  const setFov = (fovY: number): void =>
    void runUntypedOperator(app, PANEL_KIND, CAMERA_SETTINGS_OP, { camera: camera.id, fovY });
  const perspective = camera.projection === 'perspective';
  return (
    <div className="mb-2 last:mb-0" data-testid={`attr-camera-${camera.id}`}>
      <Fields>
        <Field label="Camera">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold">{camera.name}</span>
            <span className={MUTED_TEXT}>{camera.projection}</span>
          </span>
        </Field>
        <Field label="Locked" htmlFor={`${id}-lock`}>
          <label className="flex items-center gap-1.5">
            <input
              id={`${id}-lock`}
              type="checkbox"
              className={CHECK}
              checked={camera.locked}
              data-testid={`attr-camera-lock-${camera.id}`}
              onChange={() => void runOperator(app, PANEL_KIND, 'view.toggleCameraLock', { cameraId: camera.id })}
            />
            {camera.locked ? (
              <span className="flex items-center gap-1 text-[var(--locked-badge,#e3b34a)]">
                <LockIcon /> panes cannot move it
              </span>
            ) : (
              <span className={MUTED_TEXT}>navigable</span>
            )}
          </label>
        </Field>
        {perspective ? (
          <>
            <Field label="Focal length (mm)" htmlFor={`${id}-focal`}>
              <NumberField
                id={`${id}-focal`}
                className="w-24 text-right tabular-nums"
                ariaLabel={`Focal length of ${camera.name} in millimetres`}
                testId={`attr-camera-focal-${camera.id}`}
                readOnly={!editable}
                title={editable ? '24 mm sensor height (35 mm full frame)' : readOnlyWhy}
                value={focalLengthFromFov(camera.fovY)}
                format={(mm) => formatFixed(mm, 1)}
                validate={validateFocalLength}
                onValue={(mm) => setFov(fovFromFocalLength(mm))}
              />
            </Field>
            <Field label="Vertical FOV (°)" htmlFor={`${id}-fov`}>
              <NumberField
                id={`${id}-fov`}
                className="w-24 text-right tabular-nums"
                ariaLabel={`Vertical field of view of ${camera.name} in degrees`}
                testId={`attr-camera-fov-${camera.id}`}
                readOnly={!editable}
                title={editable ? undefined : readOnlyWhy}
                value={fovToDegrees(camera.fovY)}
                format={(deg) => formatFixed(deg, 2)}
                validate={validateFovDegrees}
                onValue={(deg) => setFov(fovFromDegrees(deg))}
              />
            </Field>
          </>
        ) : (
          <Field label="Ortho height (m)">
            <span className="tabular-nums">{formatFixed(camera.orthoHeight, 3)}</span>
          </Field>
        )}
        <Field label="Clip planes">
          <span className="tabular-nums text-fg-2">
            {formatFixed(camera.near, 3)} – {formatFixed(camera.far, 1)} m
          </span>
        </Field>
      </Fields>
    </div>
  );
}
