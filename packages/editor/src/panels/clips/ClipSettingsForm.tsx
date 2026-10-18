// Clip settings (FR-CLIP-04, FR-CLIP-09): fps with keep-seconds / keep-frames, range, scene start, loop, root
// motion, Ekza slot, contact frame, tags and provenance. Used in the Clips panel's settings popover and in the
// Attributes panel. One Apply = one `clip.setSettings` run with the changed fields = one undo step.
import type { ClipRecord, Redistributable, RootMotionMode } from '@ekza-animator/doc';
import type { EditorApp, PanelKind } from '@ekza-animator/editor-core';
import { type JSX, type ReactNode, useId, useState } from 'react';
import { runOperator } from '../channel-box/kit/run';
import {
  BUTTON,
  CHECK,
  ERROR_TEXT,
  INPUT,
  INVALID,
  MUTED_TEXT,
  PRIMARY_BUTTON,
  SELECT,
} from '../channel-box/kit/styles';
import {
  type ClipSettingsDraft,
  checkDraft,
  type DraftField,
  draftFromClip,
  EMPTY_SOURCE,
  FPS_PRESETS,
  formatDuration,
  type FpsMode,
  LICENSE_PRESETS,
  MAX_TAGS,
  REDISTRIBUTABLE_LABEL,
  redistributionHint,
  ROOT_MOTION_HINT,
  ROOT_MOTION_LABEL,
  SLOT_VOCABULARY,
  type SourceDraft,
} from './settings';

export interface ClipSettingsFormProps {
  readonly app: EditorApp;
  readonly panel: PanelKind;
  readonly clip: ClipRecord;
  /** After a successful Apply (the popover closes). */
  readonly onApplied?: (() => void) | undefined;
  /** Shows a Cancel button (popover). */
  readonly onCancel?: (() => void) | undefined;
}

/** Remount with `key={clip.id}` to edit another clip; external edits of the same clip show while nothing is typed. */
export function ClipSettingsForm(props: ClipSettingsFormProps): JSX.Element {
  const { app, panel, clip, onApplied, onCancel } = props;
  const [edited, setEdited] = useState<ClipSettingsDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = edited ?? draftFromClip(clip);
  const { errors, args, fpsChanged } = checkDraft(clip, draft);
  const hint = redistributionHint(draft);
  const id = useId();

  const set = <K extends keyof ClipSettingsDraft>(key: K, value: ClipSettingsDraft[K]): void =>
    setEdited({ ...draft, [key]: value });
  const setSource = (index: number, patch: Partial<SourceDraft>): void =>
    set(
      'sources',
      draft.sources.map((source, i) => (i === index ? { ...source, ...patch } : source)),
    );

  const apply = async (): Promise<void> => {
    if (args === null || busy) return;
    setBusy(true);
    try {
      const result = await runOperator(app, panel, 'clip.setSettings', args);
      if (result.status === 'finished') {
        setEdited(null);
        onApplied?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const error = (field: DraftField): JSX.Element | null =>
    errors[field] === undefined ? null : (
      <p className={`col-span-2 col-start-2 ${ERROR_TEXT}`} data-testid={`clip-settings-error-${field}`} role="alert">
        {errors[field]}
      </p>
    );
  const invalid = (field: DraftField): string => (errors[field] === undefined ? '' : INVALID);

  return (
    <form
      className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-x-2 gap-y-1.5"
      data-testid="clip-settings-form"
      aria-label={`Settings of clip ${clip.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <Row label="Frame rate" htmlFor={`${id}-fps`}>
        <select
          id={`${id}-fps`}
          className={`${SELECT} w-24`}
          value={draft.fps}
          data-testid="clip-settings-fps"
          onChange={(event) => set('fps', event.currentTarget.value)}
        >
          {FPS_PRESETS.map((fps) => (
            <option key={fps} value={String(fps)}>
              {fps} fps
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {draft.fps === 'custom' ? (
          <input
            className={`${INPUT} w-20 tabular-nums ${invalid('fps')}`}
            aria-label="Custom frame rate"
            value={draft.fpsCustom}
            data-testid="clip-settings-fps-custom"
            onChange={(event) => set('fpsCustom', event.currentTarget.value)}
          />
        ) : null}
      </Row>
      {error('fps')}
      <fieldset className="col-span-2 col-start-2 flex gap-3" disabled={!fpsChanged}>
        <legend className="sr-only">Frame rate change</legend>
        {(['keep-seconds', 'keep-frames'] as const satisfies readonly FpsMode[]).map((mode) => (
          <label key={mode} className={`flex items-center gap-1 ${fpsChanged ? 'text-fg-2' : MUTED_TEXT}`}>
            <input
              type="radio"
              className={CHECK}
              name={`${id}-fps-mode`}
              checked={draft.fpsMode === mode}
              data-testid={`clip-settings-fps-mode-${mode}`}
              onChange={() => set('fpsMode', mode)}
            />
            {mode === 'keep-seconds' ? 'Keep seconds' : 'Keep frames'}
          </label>
        ))}
      </fieldset>

      <Row label="Range" htmlFor={`${id}-start`}>
        <input
          id={`${id}-start`}
          className={`${INPUT} w-16 tabular-nums ${invalid('rangeStart')}`}
          aria-label="Range start"
          value={draft.rangeStart}
          data-testid="clip-settings-range-start"
          onChange={(event) => set('rangeStart', event.currentTarget.value)}
        />
        <span className={MUTED_TEXT}>–</span>
        <input
          className={`${INPUT} w-16 tabular-nums ${invalid('rangeEnd')}`}
          aria-label="Range end"
          value={draft.rangeEnd}
          data-testid="clip-settings-range-end"
          onChange={(event) => set('rangeEnd', event.currentTarget.value)}
        />
        {args?.range === undefined && errors.rangeStart === undefined && errors.rangeEnd === undefined ? (
          <span className={MUTED_TEXT}>{formatDuration(clip.range, clip.fps)}</span>
        ) : null}
      </Row>
      {error('rangeStart')}
      {error('rangeEnd')}

      <Row label="Scene start" htmlFor={`${id}-scene-start`}>
        <input
          id={`${id}-scene-start`}
          className={`${INPUT} w-16 tabular-nums ${invalid('sceneStart')}`}
          title="Scene frame at which clip frame 0 plays"
          value={draft.sceneStart}
          data-testid="clip-settings-scene-start"
          onChange={(event) => set('sceneStart', event.currentTarget.value)}
        />
      </Row>
      {error('sceneStart')}

      <Row label="Loop" htmlFor={`${id}-loop`}>
        <input
          id={`${id}-loop`}
          type="checkbox"
          className={CHECK}
          checked={draft.loop}
          data-testid="clip-settings-loop"
          onChange={(event) => set('loop', event.currentTarget.checked)}
        />
      </Row>

      <Row label="Root motion" htmlFor={`${id}-root-motion`}>
        <select
          id={`${id}-root-motion`}
          className={`${SELECT} w-40`}
          value={draft.rootMotion}
          title={ROOT_MOTION_HINT}
          data-testid="clip-settings-root-motion"
          onChange={(event) => set('rootMotion', event.currentTarget.value as RootMotionMode)}
        >
          {(Object.keys(ROOT_MOTION_LABEL) as RootMotionMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {ROOT_MOTION_LABEL[mode]}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Ekza slot" htmlFor={`${id}-slot`}>
        <select
          id={`${id}-slot`}
          className={`${SELECT} w-40 ${invalid('slot')}`}
          value={draft.slot}
          data-testid="clip-settings-slot"
          onChange={(event) => set('slot', event.currentTarget.value)}
        >
          <option value="">None</option>
          {SLOT_VOCABULARY.map((slot) => (
            <option key={slot} value={slot}>
              {slot}
            </option>
          ))}
          {draft.slot !== '' && !(SLOT_VOCABULARY as readonly string[]).includes(draft.slot) ? (
            <option value={draft.slot}>{draft.slot} (unknown)</option>
          ) : null}
        </select>
      </Row>
      {error('slot')}

      <Row label="Contact frame" htmlFor={`${id}-contact`}>
        <input
          id={`${id}-contact`}
          className={`${INPUT} w-16 tabular-nums ${invalid('contact')}`}
          placeholder="none"
          title="Impact pose (attack, cast); exported as contactSeconds"
          value={draft.contact}
          data-testid="clip-settings-contact"
          onChange={(event) => set('contact', event.currentTarget.value)}
        />
      </Row>
      {error('contact')}

      <Row label="Tags" htmlFor={`${id}-tags`}>
        <input
          id={`${id}-tags`}
          className={`${INPUT} min-w-0 flex-1 ${invalid('tags')}`}
          placeholder={`emote, loop (≤ ${MAX_TAGS})`}
          value={draft.tags}
          spellCheck={false}
          data-testid="clip-settings-tags"
          onChange={(event) => set('tags', event.currentTarget.value)}
        />
      </Row>
      {error('tags')}

      <h3 className="col-span-3 mt-1 border-t border-line pt-2 font-semibold text-fg-2">Provenance</h3>
      <Row label="Redistribution" htmlFor={`${id}-redistributable`}>
        <select
          id={`${id}-redistributable`}
          className={`${SELECT} w-24`}
          value={draft.redistributable}
          data-testid="clip-settings-redistributable"
          onChange={(event) => set('redistributable', event.currentTarget.value as Redistributable)}
        >
          <option value="yes">yes</option>
          <option value="no">no</option>
          <option value="unknown">unknown</option>
        </select>
        <RedistributableBadge state={draft.redistributable} />
      </Row>
      {hint === null ? null : (
        <p
          className="col-span-2 col-start-2 text-[var(--warn,#e3b34a)]"
          data-testid="clip-settings-redistribution-hint"
        >
          {hint}
        </p>
      )}
      {draft.sources.length === 0 ? (
        <p className={`col-span-3 ${MUTED_TEXT}`}>Authored from scratch: no sources.</p>
      ) : null}
      {draft.sources.map((source, index) => (
        <SourceFields
          // Sources have no identity of their own; their position is their key while editing.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          index={index}
          source={source}
          errors={errors}
          onChange={(patch) => setSource(index, patch)}
          onRemove={() =>
            set(
              'sources',
              draft.sources.filter((_, i) => i !== index),
            )
          }
        />
      ))}
      <div className="col-span-3">
        <button
          type="button"
          className={BUTTON}
          data-testid="clip-settings-source-add"
          onClick={() => set('sources', [...draft.sources, EMPTY_SOURCE])}
        >
          + Add source
        </button>
      </div>

      <div className="col-span-3 mt-1 flex justify-end gap-2 border-t border-line pt-2">
        <button
          type="button"
          className={BUTTON}
          disabled={edited === null}
          data-testid="clip-settings-reset"
          onClick={() => setEdited(null)}
        >
          Reset
        </button>
        {onCancel === undefined ? null : (
          <button type="button" className={BUTTON} data-testid="clip-settings-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={args === null || busy}
          data-testid="clip-settings-apply"
        >
          Apply
        </button>
      </div>
    </form>
  );
}

/** A label in the first column and its controls across the other two. */
function Row(props: { readonly label: string; readonly htmlFor: string; readonly children: ReactNode }): JSX.Element {
  return (
    <>
      <label htmlFor={props.htmlFor} className="text-fg-2">
        {props.label}
      </label>
      <div className="col-span-2 flex min-w-0 items-center gap-1">{props.children}</div>
    </>
  );
}

const BADGE_STYLE: Readonly<Record<Redistributable, string>> = {
  yes: 'border-[var(--ok,#65a878)] text-[var(--ok,#65a878)]',
  no: 'border-[var(--danger,#ef6b6b)] text-[var(--danger,#ef6b6b)]',
  unknown: 'border-[var(--warn,#e3b34a)] text-[var(--warn,#e3b34a)]',
};

export function RedistributableBadge(props: { readonly state: Redistributable }): JSX.Element {
  return (
    <span
      className={`rounded-[3px] border px-1 leading-4 ${BADGE_STYLE[props.state]}`}
      data-testid="clip-redistributable-badge"
      data-state={props.state}
    >
      {REDISTRIBUTABLE_LABEL[props.state]}
    </span>
  );
}

function SourceFields(props: {
  readonly index: number;
  readonly source: SourceDraft;
  readonly errors: ReturnType<typeof checkDraft>['errors'];
  readonly onChange: (patch: Partial<SourceDraft>) => void;
  readonly onRemove: () => void;
}): JSX.Element {
  const { index, source, errors, onChange } = props;
  const testId = (part: string): string => `clip-settings-source-${index}-${part}`;
  const problem = (field: 'title' | 'license' | 'sourceSha256'): string | undefined =>
    errors[`source.${index}.${field}`];
  return (
    <fieldset className="col-span-3 grid grid-cols-[7.5rem_1fr_auto] items-center gap-x-2 gap-y-1 rounded-[4px] border border-line p-2">
      <legend className="px-1 text-fg-3">Source {index + 1}</legend>
      <span className="text-fg-2">Title</span>
      <input
        className={`${INPUT} ${problem('title') === undefined ? '' : INVALID}`}
        aria-label={`Source ${index + 1} title`}
        value={source.title}
        title={problem('title')}
        data-testid={testId('title')}
        onChange={(event) => onChange({ title: event.currentTarget.value })}
      />
      <button
        type="button"
        className={BUTTON}
        aria-label={`Remove source ${index + 1}`}
        data-testid={testId('remove')}
        onClick={props.onRemove}
      >
        ✕
      </button>
      <span className="text-fg-2">Author</span>
      <input
        className={`${INPUT} col-span-2`}
        aria-label={`Source ${index + 1} author`}
        value={source.author}
        data-testid={testId('author')}
        onChange={(event) => onChange({ author: event.currentTarget.value })}
      />
      <span className="text-fg-2">Licence</span>
      <div className="col-span-2 flex gap-1">
        <select
          className={`${SELECT} w-40 ${problem('license') === undefined ? '' : INVALID}`}
          aria-label={`Source ${index + 1} licence`}
          value={source.license}
          data-testid={testId('license')}
          onChange={(event) => onChange({ license: event.currentTarget.value })}
        >
          {LICENSE_PRESETS.map((license) => (
            <option key={license} value={license}>
              {license}
            </option>
          ))}
          <option value="other">Other SPDX id…</option>
        </select>
        {source.license === 'other' ? (
          <input
            className={`${INPUT} min-w-0 flex-1 ${problem('license') === undefined ? '' : INVALID}`}
            aria-label={`Source ${index + 1} SPDX licence id`}
            placeholder="SPDX id"
            spellCheck={false}
            value={source.licenseOther}
            title={problem('license')}
            data-testid={testId('license-other')}
            onChange={(event) => onChange({ licenseOther: event.currentTarget.value })}
          />
        ) : null}
      </div>
      <span className="text-fg-2">Source SHA-256</span>
      <input
        className={`${INPUT} col-span-2 font-mono ${problem('sourceSha256') === undefined ? '' : INVALID}`}
        aria-label={`Source ${index + 1} SHA-256`}
        placeholder="optional"
        spellCheck={false}
        value={source.sourceSha256}
        title={problem('sourceSha256')}
        data-testid={testId('sha')}
        onChange={(event) => onChange({ sourceSha256: event.currentTarget.value })}
      />
      {(['title', 'license', 'sourceSha256'] as const).map((field) =>
        problem(field) === undefined ? null : (
          <p
            key={field}
            className={`col-span-2 col-start-2 ${ERROR_TEXT}`}
            role="alert"
            data-testid={testId(`error-${field}`)}
          >
            {problem(field)}
          </p>
        ),
      )}
    </fieldset>
  );
}
