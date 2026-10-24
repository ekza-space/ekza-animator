// Layout pieces of the Attributes panel: collapsible sections and label/value grids (shared by its sections).
import { type JSX, type ReactNode, useId, useState } from 'react';
import { ChevronIcon } from '../channels/kit/icons';

export function Section(props: {
  readonly title: string;
  readonly testId: string;
  readonly children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section className="border-b border-line" data-testid={props.testId}>
      <h2>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-1 bg-header px-1.5 text-left font-semibold text-fg-2 hover:text-fg"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <ChevronIcon open={open} />
          {props.title}
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="px-2 py-2">
          {props.children}
        </div>
      ) : null}
    </section>
  );
}

export function Fields(props: { readonly children: ReactNode }): JSX.Element {
  return <dl className="grid grid-cols-[7.5rem_1fr] items-center gap-x-2 gap-y-1.5">{props.children}</dl>;
}

export function Field(props: {
  readonly label: string;
  readonly htmlFor?: string | undefined;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <>
      <dt className="text-fg-2">
        {props.htmlFor === undefined ? props.label : <label htmlFor={props.htmlFor}>{props.label}</label>}
      </dt>
      <dd className="min-w-0">{props.children}</dd>
    </>
  );
}
