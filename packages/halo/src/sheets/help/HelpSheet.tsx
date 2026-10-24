// Help (STUDIO-TOUCH-SPEC §17 "Help", §18; T6b): the gesture card (every gesture and its visible twin, the Thumb key,
// who does what with a Pencil), the readiness glyph legend, the shortcut sheet (Ekza Studio's keys, then Studio Pro's
// keymap with a filter), About and the licence notes — a thin view over `model.ts`. Each part is a
// `<section data-section>`; the kernel's `ui.open {dialog: 'shortcuts' | 'about'}` opens the sheet scrolled to it.
import type { EditorApp } from '@ekza-studio/editor-core';
import { SheetGroup } from '@ekza-studio/ui/touch';
import { type JSX, type ReactNode, useEffect, useRef, useState } from 'react';
import type { HaloSheetProps } from '../../manifest/sheets';
import { HaloSheet, useAppVersion } from '../more/kit';
import {
  aboutInfo,
  type GestureRow,
  gestureRows,
  glyphRows,
  type HelpSectionId,
  haloKeys,
  helpSections,
  licenceRows,
  routingRows,
  shortcutGroups,
  thumbRows,
} from './model';

function Section(props: { readonly id: HelpSectionId; readonly children: ReactNode }): JSX.Element {
  const label = helpSections().find((section) => section.id === props.id)?.label ?? props.id;
  return (
    <section
      data-section={props.id}
      aria-label={label}
      data-testid={`halo-help-section-${props.id}`}
      className="scroll-mt-2"
    >
      <SheetGroup>{label}</SheetGroup>
      {props.children}
    </section>
  );
}

function Detail(props: { readonly who: string; readonly text: string | null }): JSX.Element | null {
  if (props.text === null) return null;
  return (
    <p className="text-touch-label text-fg-2">
      <span className="font-medium text-fg-3">{props.who}: </span>
      {props.text}
    </p>
  );
}

function GestureCard(props: { readonly row: GestureRow }): JSX.Element {
  const { row } = props;
  return (
    <li
      className="flex flex-col gap-0.5 rounded-touch border border-line px-3 py-2"
      data-testid="halo-help-gesture"
      data-gesture={row.id}
    >
      <span className="font-medium text-fg">{row.gesture}</span>
      <Detail who="Finger" text={row.finger} />
      <Detail who="Pencil" text={row.pencil} />
      <Detail who="Mouse or trackpad" text={row.mouse} />
      <p className="text-touch-label text-fg">
        <span className="font-medium text-accent-text">Button twin: </span>
        {row.twin}
      </p>
    </li>
  );
}

function Gestures(): JSX.Element {
  return (
    <Section id="gestures">
      <p className="px-2.5 pb-2 text-touch-label text-fg-2">
        One and two fingers only. Every gesture has a button that does the same.
      </p>
      <ul className="flex flex-col gap-2 px-1">
        {gestureRows().map((row) => (
          <GestureCard key={row.id} row={row} />
        ))}
      </ul>
      <h4 className="px-2.5 pt-4 pb-1 font-medium text-fg">The Thumb key</h4>
      <ul className="flex flex-col px-2.5" data-testid="halo-help-thumb">
        {thumbRows().map((row) => (
          <li key={row.id} className="flex min-h-(--touch-hit) items-center gap-3">
            <span className="w-24 shrink-0 font-medium text-fg">{row.how}</span>
            <span className="text-touch-label text-fg-2">{row.what}</span>
          </li>
        ))}
      </ul>
      <h4 className="px-2.5 pt-4 pb-1 font-medium text-fg">Finger and Pencil</h4>
      <ul className="flex flex-col gap-2 px-1" data-testid="halo-help-routing">
        {routingRows().map((row) => (
          <li key={row.id} className="flex flex-col gap-0.5 rounded-touch border border-line px-3 py-2">
            <span className="font-medium text-fg">{row.mode}</span>
            <Detail who="Finger" text={row.finger} />
            <Detail who="Pencil" text={row.pencil} />
            <Detail who="When" text={row.when} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Glyphs(): JSX.Element {
  return (
    <Section id="glyphs">
      <ul className="flex flex-col px-2.5" data-testid="halo-help-glyphs">
        {glyphRows().map((row) => (
          <li key={row.glyph} className="flex min-h-(--touch-hit) items-center gap-3">
            <span aria-hidden="true" className="w-10 shrink-0 text-center text-[20px] text-fg">
              {row.text}
            </span>
            <span className="text-fg-2">{row.meaning}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function KeyRow(props: {
  readonly keys: string;
  readonly label: string;
  readonly pro?: string;
  readonly off?: boolean;
}): JSX.Element {
  return (
    <li className="flex min-h-(--touch-hit) items-center gap-3 px-2.5" data-testid="halo-help-shortcut">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={props.off === true ? 'text-fg-3' : 'text-fg'}>{props.label}</span>
        {props.pro === undefined || props.pro === '' ? null : (
          <span className="truncate text-touch-label text-fg-3">{props.pro}</span>
        )}
      </span>
      <kbd className="shrink-0 rounded-touch-inner border border-line bg-field px-2 py-1 font-mono text-touch-label text-fg">
        {props.keys}
      </kbd>
    </li>
  );
}

function Shortcuts(props: { readonly app: EditorApp }): JSX.Element {
  const [filter, setFilter] = useState('');
  const own = haloKeys(props.app, filter);
  const groups = shortcutGroups(props.app, filter);
  return (
    <Section id="shortcuts">
      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter shortcuts"
        aria-label="Filter shortcuts"
        data-testid="halo-help-filter"
        className="mx-1 mb-2 min-h-(--touch-hit) w-[calc(100%-8px)] rounded-touch border border-line bg-field px-3 text-[16px] text-fg placeholder:text-fg-3"
      />
      {own.length === 0 ? null : (
        <div data-testid="halo-help-halo-keys">
          <h4 className="px-2.5 pt-2 pb-1 font-medium text-fg">In Ekza Studio</h4>
          <ul>
            {own.map((row) => (
              <KeyRow key={row.keys} keys={row.keys} label={row.label} />
            ))}
          </ul>
        </div>
      )}
      <p className="px-2.5 pt-3 pb-1 text-touch-label text-fg-2">
        Every other key works as in Studio Pro; its names are in grey.
      </p>
      {groups.map((group) => (
        <div key={group.scope} data-testid="halo-help-shortcut-group" data-scope={group.scope}>
          <h4 className="px-2.5 pt-3 pb-1 font-medium text-fg">
            {group.label}
            {group.pro === null ? null : <span className="font-normal text-fg-3"> · {group.pro}</span>}
          </h4>
          <ul>
            {group.rows.map((row) => (
              <KeyRow
                key={row.key}
                keys={row.keys}
                label={row.label}
                pro={row.available ? row.pro : `${row.pro === '' ? '' : `${row.pro} · `}not loaded yet`}
                off={!row.available}
              />
            ))}
          </ul>
        </div>
      ))}
      {own.length === 0 && groups.length === 0 ? (
        <p className="px-2.5 py-4 text-fg-3" data-testid="halo-help-empty">
          No shortcut matches.
        </p>
      ) : null}
    </Section>
  );
}

function About(): JSX.Element {
  const about = aboutInfo();
  return (
    <Section id="about">
      <div className="flex flex-col gap-2 px-2.5" data-testid="halo-help-about">
        <p className="text-fg">
          <span className="font-semibold">{about.name}</span>{' '}
          <span className="font-mono text-fg-2" data-testid="halo-help-version">
            {about.version}
          </span>
        </p>
        <p className="text-fg-2">{about.positioning}</p>
        <p className="text-fg-2" data-testid="halo-help-beta">
          {about.beta}
        </p>
        <p className="text-touch-label text-fg-3">{about.licence} licence</p>
      </div>
    </Section>
  );
}

function Licences(): JSX.Element {
  const about = aboutInfo();
  return (
    <Section id="licences">
      <ul className="flex flex-col gap-1.5 px-2.5" data-testid="halo-help-licences">
        {licenceRows().map((row) => (
          <li key={row.id} className="text-touch-label text-fg-2">
            {row.text}
          </li>
        ))}
      </ul>
      <a
        href={about.noticesHref}
        target="_blank"
        rel="noreferrer"
        className="mt-1 inline-flex min-h-(--touch-hit) items-center rounded-touch px-2.5 font-medium text-accent-text underline-offset-4 hover:underline"
        data-testid="halo-help-notices"
      >
        Third-party notices ▸
      </a>
    </Section>
  );
}

export default function HelpSheet({ ctx, args }: HaloSheetProps): JSX.Element {
  const app = ctx.host.app;
  useAppVersion(app);
  const root = useRef<HTMLDivElement>(null);
  const target = args?.section;
  useEffect(() => {
    if (target === undefined) return;
    root.current?.querySelector(`[data-section="${CSS.escape(target)}"]`)?.scrollIntoView({ block: 'start' });
  }, [target]);
  return (
    <HaloSheet ctx={ctx} id="help" title="Help" description="Gestures, marks, shortcuts and licences">
      <div ref={root} data-testid="halo-help">
        <Gestures />
        <Glyphs />
        <Shortcuts app={app} />
        <About />
        <Licences />
      </div>
    </HaloSheet>
  );
}
