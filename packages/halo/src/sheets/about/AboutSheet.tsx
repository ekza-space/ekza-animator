// About this character (STUDIO-TOUCH-SPEC §6.8, §6.7 `vrmMeta`, §15 row 11.7; T6b): every field of the character's
// VRM meta — who made it, the licence (a preset in plain words, none pre-selected), what others may do, the four
// allowed-use flags, other people's work in it — and the thumbnail with *Render thumbnail*. Studio Pro's names sit
// in grey under the plain ones. Text fields commit on Enter or when they lose focus, choices at once: each edit is
// one `char.setVrmMeta` run (one undo step) through `ctx.run`. A character from a file shows its file's meta to read.
import type { AssetId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { SheetGroup, ToggleChip, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useId, useRef, useState } from 'react';
import type { HaloSheetContext, HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet, useAppVersion } from '../more/kit';
import { type AboutField, type AboutModel, type AboutSection, aboutModel, type MetaField, patchFor } from './model';

type Commit = (field: MetaField, value: string | boolean) => void;

const INPUT =
  'min-h-(--touch-hit) w-full rounded-touch border border-line bg-field px-3 text-[16px] text-fg placeholder:text-fg-3 aria-invalid:border-warn';

/** A text field that commits once, on Enter or blur, when its text changed (Escape puts the stored text back). */
function CommitText(props: {
  readonly field: AboutField;
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly onCommit: (text: string) => void;
}): JSX.Element {
  const { field } = props;
  const stored = String(field.value);
  // The draft is local until committed; a new stored value replaces it (the draft remembers which value it edits).
  const [draft, setDraft] = useState<{ readonly of: string; readonly text: string }>({ of: stored, text: stored });
  const text = draft.of === stored ? draft.text : stored;
  const setText = (next: string): void => setDraft({ of: stored, text: next });
  const commit = (): void => {
    if (text !== stored) props.onCommit(text);
  };
  const common = {
    id: props.id,
    value: text,
    placeholder: field.placeholder,
    'aria-invalid': field.missing || undefined,
    'aria-describedby': props.describedBy,
    'data-op': 'char.setVrmMeta',
    'data-field': field.id,
    'data-testid': `halo-about-${field.id}`,
    onBlur: commit,
  };
  if (field.kind === 'longText') {
    return (
      <textarea
        {...common}
        rows={3}
        className={`${INPUT} py-2`}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setText(stored);
        }}
      />
    );
  }
  return (
    <input
      {...common}
      type={field.id === 'otherLicenseUrl' ? 'url' : 'text'}
      className={INPUT}
      onChange={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') setText(stored);
      }}
    />
  );
}

/**
 * One of a field's options as native radios (keyboard and screen readers for free): rows with hints for the licence,
 * wrapping chips otherwise. None chosen is allowed (the licence starts unchosen, Q-SKIN-3); a choice commits at once.
 */
function ChoiceGroup(props: {
  readonly field: AboutField;
  readonly legend: JSX.Element;
  readonly describedBy: string | undefined;
  readonly rows: boolean;
  readonly onChoose: (value: string) => void;
}): JSX.Element {
  const { field } = props;
  const name = useId();
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
      aria-describedby={props.describedBy}
      data-testid={`halo-about-${field.id}`}
    >
      {props.legend}
      <div className={props.rows ? 'flex flex-col gap-1' : 'flex flex-wrap gap-1.5'}>
        {(field.options ?? []).map((option) => {
          const on = option.value === field.value;
          return (
            <label
              key={option.value}
              className={
                props.rows
                  ? `flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-touch border px-3 py-1.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${on ? 'border-accent/60 bg-accent-soft' : 'border-line bg-field'}`
                  : `inline-flex min-h-(--touch-hit) cursor-pointer items-center rounded-touch border px-3 text-touch font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${on ? 'border-accent/60 bg-accent-soft text-fg' : 'border-line bg-field text-fg-2'}`
              }
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={on}
                onChange={() => props.onChoose(option.value)}
                className="sr-only"
                data-op="char.setVrmMeta"
                data-field={field.id}
                data-testid={`halo-about-${field.id}-${option.value}`}
              />
              {props.rows ? (
                <>
                  <span
                    aria-hidden="true"
                    className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border ${on ? 'border-accent' : 'border-line'}`}
                  >
                    {on ? <span className="size-2.5 rounded-full bg-accent" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-fg">{option.label}</span>
                    {option.hint === undefined ? null : (
                      <span className="text-touch-label text-fg-3">{option.hint}</span>
                    )}
                  </span>
                </>
              ) : (
                option.label
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function readOnlyText(field: AboutField): string {
  if (field.kind === 'flag') return field.value === true ? 'Allowed' : 'Not allowed';
  if (field.kind === 'choice')
    return field.options?.find((option) => option.value === field.value)?.label ?? 'Not stated';
  return field.value === '' ? 'Not stated' : String(field.value);
}

function FieldView(props: {
  readonly field: AboutField;
  readonly editable: boolean;
  readonly onCommit: Commit;
}): JSX.Element | null {
  const { field } = props;
  const id = useId();
  if (!field.shown) return null;
  const labelId = `${id}-label`;
  const hintId = field.hint === undefined && !field.missing ? undefined : `${id}-hint`;
  const missing =
    field.id === 'licensePreset' ? 'Choose a licence: sharing it needs an explicit choice' : 'Needed to share it';
  let control: JSX.Element;
  if (!props.editable) {
    control = (
      <span className="text-fg-2" data-testid={`halo-about-${field.id}`}>
        {readOnlyText(field)}
      </span>
    );
  } else if (field.kind === 'flag') {
    control = (
      <ToggleChip
        label={field.value === true ? 'Allowed' : 'Not allowed'}
        pressed={field.value === true}
        aria-labelledby={labelId}
        onPressedChange={(pressed) => props.onCommit(field.id, pressed)}
        data-op="char.setVrmMeta"
        data-field={field.id}
        data-testid={`halo-about-${field.id}`}
      />
    );
  } else if (field.kind === 'choice') {
    return (
      <div className="flex flex-col gap-1.5 px-2.5 py-1.5" data-testid={`halo-about-row-${field.id}`}>
        <ChoiceGroup
          field={field}
          legend={
            <legend className="flex flex-col p-0">
              <span className="font-medium text-fg">{field.label}</span>
              {field.pro === field.label ? null : <span className="text-touch-label text-fg-3">{field.pro}</span>}
            </legend>
          }
          describedBy={hintId}
          rows={field.id === 'licensePreset'}
          onChoose={(value) => props.onCommit(field.id, value)}
        />
        {hintId === undefined ? null : (
          <span id={hintId} className={field.missing ? 'text-touch-label text-warn' : 'text-touch-label text-fg-3'}>
            {field.missing ? missing : field.hint}
          </span>
        )}
      </div>
    );
  } else {
    control = (
      <CommitText
        field={field}
        id={`${id}-input`}
        describedBy={hintId}
        onCommit={(text) => props.onCommit(field.id, text)}
      />
    );
  }
  const inline = field.kind === 'flag' || !props.editable;
  return (
    <div
      className={inline ? 'flex min-h-[52px] items-center gap-3 px-2.5 py-1.5' : 'flex flex-col gap-1.5 px-2.5 py-1.5'}
      data-testid={`halo-about-row-${field.id}`}
    >
      <span className={inline ? 'flex min-w-0 flex-1 flex-col' : 'flex flex-col'}>
        {props.editable && (field.kind === 'text' || field.kind === 'list' || field.kind === 'longText') ? (
          <label id={labelId} htmlFor={`${id}-input`} className="font-medium text-fg">
            {field.label}
          </label>
        ) : (
          <span id={labelId} className="font-medium text-fg">
            {field.label}
          </span>
        )}
        {field.pro === field.label ? null : <span className="text-touch-label text-fg-3">{field.pro}</span>}
      </span>
      {control}
      {hintId === undefined || !props.editable ? null : (
        <span id={hintId} className={field.missing ? 'text-touch-label text-warn' : 'text-touch-label text-fg-3'}>
          {field.missing ? missing : field.hint}
        </span>
      )}
    </div>
  );
}

function SectionView(props: {
  readonly section: AboutSection;
  readonly editable: boolean;
  readonly onCommit: Commit;
}): JSX.Element {
  const { section } = props;
  return (
    <section data-section={section.id} aria-label={section.title} data-testid={`halo-about-section-${section.id}`}>
      <SheetGroup>{section.title}</SheetGroup>
      {section.note === undefined ? null : <p className="px-2.5 text-touch-label text-fg-3">{section.note}</p>}
      {section.fields.map((field) => (
        <FieldView key={field.id} field={field} editable={props.editable} onCommit={props.onCommit} />
      ))}
    </section>
  );
}

/** The stored thumbnail as an object URL, tagged with the asset it shows (another asset shows nothing until read). */
function useThumbnailUrl(app: EditorApp, asset: AssetId | null): string | null {
  const [shown, setShown] = useState<{ readonly asset: AssetId; readonly url: string } | null>(null);
  useEffect(() => {
    if (asset === null) return;
    let live = true;
    let created: string | null = null;
    void app.services.assets
      .get(asset)
      .then((bytes) => {
        if (!live || typeof URL.createObjectURL !== 'function') return;
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
        setShown({ asset, url: created });
      })
      .catch(() => {});
    return () => {
      live = false;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [app, asset]);
  return shown !== null && shown.asset === asset ? shown.url : null;
}

function ThumbnailSection(props: { readonly ctx: HaloSheetContext; readonly model: AboutModel }): JSX.Element {
  const { ctx, model } = props;
  const url = useThumbnailUrl(ctx.host.app, model.thumbnail.asset);
  const [busy, setBusy] = useState(false);
  const control = model.thumbnail.control;
  return (
    <section data-section="thumbnail" aria-label="Thumbnail" data-testid="halo-about-section-thumbnail">
      <SheetGroup>Thumbnail</SheetGroup>
      <div className="flex flex-wrap items-center gap-3 px-2.5 py-1.5">
        <div
          className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-touch border border-line bg-field text-touch-label text-fg-3"
          data-testid="halo-about-thumbnail"
          data-asset={model.thumbnail.asset ?? ''}
        >
          {url === null ? (
            model.thumbnail.asset === null ? (
              'No picture yet'
            ) : (
              '…'
            )
          ) : (
            <>
              <span
                aria-hidden="true"
                className="size-full bg-cover bg-center"
                style={{ backgroundImage: `url(${url})` }}
                data-testid="halo-about-thumbnail-image"
              />
              <span className="sr-only">Its thumbnail is set</span>
            </>
          )}
        </div>
        {control === null ? null : (
          <span className="flex min-w-0 flex-col gap-1">
            <TouchButton
              disabled={!control.enabled || busy}
              onClick={() => {
                setBusy(true);
                void ctx.run(control.op, control.args).finally(() => setBusy(false));
              }}
              data-op={control.op}
              data-testid="halo-about-render"
            >
              {busy ? 'Rendering…' : control.label}
            </TouchButton>
            <span className="text-touch-label text-fg-3">
              {control.reason ?? 'Square, at the bind pose · Render Thumbnail'}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}

export default function AboutSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  const model = aboutModel(app);
  const body = useRef<HTMLDivElement>(null);
  const wanted = args?.section;

  useEffect(() => {
    if (wanted === undefined) return;
    body.current?.querySelector(`[data-section="${wanted}"]`)?.scrollIntoView({ block: 'start' });
  }, [wanted]);

  const commit: Commit = (field, value) => {
    const character = model.character;
    if (character === null || !model.editable) return;
    const call = patchFor(character, field, value);
    if (call !== null) void ctx.run(call.op, call.args);
  };

  return (
    <HaloSheet
      ctx={ctx}
      id="about"
      title="About this character"
      description={model.character === null ? 'Name, maker and licence' : model.character.name}
    >
      <div ref={body} className="flex flex-col gap-1">
        {model.note === null ? null : (
          <p className="px-2.5 py-2 text-fg-2" data-testid="halo-about-note">
            {model.note}
          </p>
        )}
        {model.character === null ? (
          <div className="px-2.5">
            <TouchButton variant="primary" onClick={() => ctx.setStage('rig')} data-testid="halo-about-to-rig">
              Go to Rig ▸
            </TouchButton>
          </div>
        ) : null}
        {model.sections.map((section) => (
          <SectionView key={section.id} section={section} editable={model.editable} onCommit={commit} />
        ))}
        {model.character === null ? null : <ThumbnailSection ctx={ctx} model={model} />}
      </div>
    </HaloSheet>
  );
}
