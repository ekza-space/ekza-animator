// The VRM meta fields of a model character (M6B-SPEC §8.13, §5.22; C10; CR-AR-1 host-agnostic body): name, authors
// (required), the licence preset radio ("Open — CC0" first, none pre-selected), then the advanced fields (version,
// copyright, contact, references, permissions, other licence URL, third-party licences). Every committed edit is one
// `char.setVrmMeta` run (one undo step): text fields commit on Enter or blur, choices at once.
import type { CharacterId, CharacterVrmMeta, VrmLicensePreset } from '@ekza-studio/doc';
import { makeVrmMeta } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { VRM_LICENCE_CHOICES } from '@ekza-studio/io';
import { Checkbox, NativeSelect, RadioGroup, RadioGroupItem, TextInput } from '@ekza-studio/ui';
import { type JSX, useId, useState } from 'react';
import { useDocQuery } from '../../../hooks';

export interface VrmMetaFieldsProps {
  readonly app: EditorApp;
  readonly character: CharacterId;
  /** A denser layout (the Rig Toolkit): the advanced fields stay folded. */
  readonly compact?: boolean;
  /** How edits run (default: the app's untyped run; the shell passes its own so failures toast). */
  readonly run?: (op: string, args: unknown) => Promise<unknown>;
}

type MetaPatch = Partial<CharacterVrmMeta>;

const PERMISSION = [
  { value: 'onlyAuthor', label: 'Only the author' },
  { value: 'onlySeparatelyLicensedPerson', label: 'Separately licensed people' },
  { value: 'everyone', label: 'Everyone' },
] as const;
const COMMERCIAL = [
  { value: 'personalNonProfit', label: 'Personal, non-profit' },
  { value: 'personalProfit', label: 'Personal, profit' },
  { value: 'corporation', label: 'Corporations too' },
] as const;
const CREDIT = [
  { value: 'required', label: 'Credit required' },
  { value: 'unnecessary', label: 'Credit unnecessary' },
] as const;
const MODIFICATION = [
  { value: 'prohibited', label: 'Prohibited' },
  { value: 'allowModification', label: 'Allowed' },
  { value: 'allowModificationRedistribution', label: 'Allowed, with redistribution' },
] as const;
const USAGE_FLAGS = [
  ['allowExcessivelyViolentUsage', 'Excessively violent usage'],
  ['allowExcessivelySexualUsage', 'Excessively sexual usage'],
  ['allowPoliticalOrReligiousUsage', 'Political or religious usage'],
  ['allowAntisocialOrHateUsage', 'Antisocial or hate usage'],
] as const;

/** A comma- or newline-separated list as the meta stores it (empty entries dropped). */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** A text field that commits on Enter or blur when its text changed. */
function CommitText(props: {
  readonly id: string;
  readonly value: string;
  readonly testId: string;
  readonly placeholder?: string;
  readonly invalid?: boolean;
  readonly onCommit: (text: string) => void;
}): JSX.Element {
  // The draft is local until committed; a new stored value replaces it (the draft remembers which value it edits).
  const [draft, setDraft] = useState<{ readonly of: string; readonly text: string }>({
    of: props.value,
    text: props.value,
  });
  const text = draft.of === props.value ? draft.text : props.value;
  const setText = (next: string) => setDraft({ of: props.value, text: next });
  const commit = () => {
    if (text !== props.value) props.onCommit(text);
  };
  return (
    <TextInput
      id={props.id}
      value={text}
      placeholder={props.placeholder}
      aria-invalid={props.invalid === true}
      data-testid={props.testId}
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setText(props.value);
      }}
    />
  );
}

export function VrmMetaFields(props: VrmMetaFieldsProps): JSX.Element {
  const { app, character } = props;
  const ids = useId();
  const record = useDocQuery((store) => store.get('characters', character), ['characters']);
  const meta = record?.vrm ?? makeVrmMeta(record?.name ?? '');
  const run = props.run ?? ((op: string, args: unknown) => app.runUntyped(op, args));
  const patch = (fields: MetaPatch) => void run('char.setVrmMeta', { character, patch: fields });
  const authors = meta.authors.filter((author) => author.trim() !== '');
  const field = (key: keyof CharacterVrmMeta) => `${ids}-${key}`;

  const text = (
    key: 'version' | 'copyrightInformation' | 'contactInformation' | 'otherLicenseUrl' | 'thirdPartyLicenses',
    label: string,
  ) => (
    <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={field(key)}>
      {label}
      <CommitText
        id={field(key)}
        value={meta[key]}
        testId={`vrm-meta-${key}`}
        onCommit={(value) => patch({ [key]: value })}
      />
    </label>
  );
  const choice = <K extends 'avatarPermission' | 'commercialUsage' | 'creditNotation' | 'modification'>(
    key: K,
    label: string,
    options: readonly { readonly value: CharacterVrmMeta[K]; readonly label: string }[],
  ) => (
    <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={field(key)}>
      {label}
      <NativeSelect
        id={field(key)}
        value={meta[key]}
        data-testid={`vrm-meta-${key}`}
        onChange={(event) => patch({ [key]: event.currentTarget.value })}
        options={options.map((option) => ({ value: option.value, label: option.label }))}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="vrm-meta-fields">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={field('name')}>
          Name
          <CommitText
            id={field('name')}
            value={meta.name}
            testId="vrm-meta-name"
            invalid={meta.name.trim() === ''}
            onCommit={(value) => patch({ name: value.trim() === '' ? (record?.name ?? '') : value.trim() })}
          />
        </label>
        <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={field('authors')}>
          Authors (required)
          <CommitText
            id={field('authors')}
            value={authors.join(', ')}
            testId="vrm-meta-authors"
            placeholder="Your name"
            invalid={authors.length === 0}
            onCommit={(value) => patch({ authors: splitList(value) })}
          />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-ui font-semibold text-fg-2">Licence</legend>
        <RadioGroup
          value={meta.licensePreset ?? ''}
          onValueChange={(value) => patch({ licensePreset: value as VrmLicensePreset })}
          aria-label="Licence"
          className={props.compact === true ? 'grid gap-1.5' : 'grid gap-1.5 md:grid-cols-2'}
        >
          {VRM_LICENCE_CHOICES.map((choiceOf) => (
            <RadioGroupItem
              key={choiceOf.id}
              value={choiceOf.id}
              label={choiceOf.label}
              hint={choiceOf.hint}
              data-testid={`vrm-licence-${choiceOf.id}`}
            />
          ))}
        </RadioGroup>
        {meta.licensePreset === null ? (
          <p className="text-ui text-warn" data-testid="vrm-licence-unset">
            Choose a licence: the export needs an explicit choice.
          </p>
        ) : null}
      </fieldset>
      <details className="flex flex-col gap-2" open={props.compact !== true && meta.licensePreset === 'custom'}>
        <summary className="cursor-pointer text-ui text-fg-2" data-testid="vrm-meta-advanced">
          Permissions, contact and references
        </summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {choice('avatarPermission', 'Who may use the avatar', PERMISSION)}
          {choice('commercialUsage', 'Commercial use', COMMERCIAL)}
          {choice('modification', 'Modification', MODIFICATION)}
          {choice('creditNotation', 'Credit', CREDIT)}
          <Checkbox
            checked={meta.allowRedistribution}
            data-testid="vrm-meta-allowRedistribution"
            onChange={(event) => patch({ allowRedistribution: event.currentTarget.checked })}
            label="Redistribution allowed"
          />
          {USAGE_FLAGS.map(([key, label]) => (
            <Checkbox
              key={key}
              checked={meta[key]}
              data-testid={`vrm-meta-${key}`}
              onChange={(event) => patch({ [key]: event.currentTarget.checked })}
              label={label}
            />
          ))}
          {text('version', 'Version')}
          {text('copyrightInformation', 'Copyright')}
          {text('contactInformation', 'Contact')}
          <label className="flex flex-col gap-1 text-ui text-fg-2" htmlFor={field('references')}>
            References (comma-separated)
            <CommitText
              id={field('references')}
              value={meta.references.join(', ')}
              testId="vrm-meta-references"
              onCommit={(value) => patch({ references: splitList(value) })}
            />
          </label>
          {text('otherLicenseUrl', 'Other licence URL')}
          {text('thirdPartyLicenses', 'Third-party licences (empty: from provenance)')}
        </div>
      </details>
    </div>
  );
}
