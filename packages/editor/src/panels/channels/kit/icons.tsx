// 14 px line icons of the data panels (research 09 §8.6 grid: 1.5 px stroke, round caps). Stand-ins until the
// `@ekza-studio/ui` icon set lands (WP-8). Decorative: callers label the control they sit in.
import type { CSSProperties, JSX, ReactNode } from 'react';

function Icon(props: { readonly children: ReactNode; readonly style?: CSSProperties | undefined }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={props.style}
    >
      {props.children}
    </svg>
  );
}

export const PlusIcon = (): JSX.Element => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const DuplicateIcon = (): JSX.Element => (
  <Icon>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 3.5v-1h-8v8h1" />
  </Icon>
);

export const TrashIcon = (): JSX.Element => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />
  </Icon>
);

export const GearIcon = (): JSX.Element => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
  </Icon>
);

export const ChevronIcon = (props: { readonly open: boolean }): JSX.Element => (
  <Icon style={{ transform: props.open ? 'rotate(90deg)' : undefined, transition: 'transform 80ms' }}>
    <path d="m6 4 4 4-4 4" />
  </Icon>
);

export const LoopIcon = (): JSX.Element => (
  <Icon>
    <path d="M3 7a4 4 0 0 1 7-2.5L12 6M13 9a4 4 0 0 1-7 2.5L4 10M12 3v3H9M4 13v-3h3" />
  </Icon>
);

export const LockIcon = (): JSX.Element => (
  <Icon>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
);

/** A control: a ring in the rig side colour (`color` on the parent). */
export const ControlIcon = (props: { readonly color: string }): JSX.Element => (
  <Icon style={{ color: props.color }}>
    <circle cx="8" cy="8" r="4.5" strokeWidth="2" />
  </Icon>
);

export const BoneIcon = (): JSX.Element => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 2v4M8 10v4" />
  </Icon>
);

export const ClipIcon = (): JSX.Element => (
  <Icon>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    <path d="M2.5 6.5h11M5.5 3.5l-1 3M9 3.5l-1 3" />
  </Icon>
);

export const CharacterIcon = (): JSX.Element => (
  <Icon>
    <circle cx="8" cy="4.5" r="2" />
    <path d="M4 14l1-6h6l1 6M8 8v6" />
  </Icon>
);

export const RigIcon = (): JSX.Element => (
  <Icon>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.5" />
  </Icon>
);
