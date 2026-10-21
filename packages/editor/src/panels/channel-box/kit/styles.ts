// Shared Tailwind class strings of the WP-9 data panels. Tokens come from research 09 §8; the ones WP-8 has not put
// into `@ekza-studio/ui/styles.css` yet are written as `var(--token, fallback)` so the panels look right before
// and after the token build lands.

export const PANEL_ROOT = 'flex h-full min-h-0 flex-col bg-panel text-xs text-fg select-none';

/** The panel root's geometry, inline so scrolling regions work before (or without) the stylesheet. */
export const PANEL_ROOT_STYLE = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } as const;

export const TOOLBAR =
  'flex h-7 shrink-0 items-center gap-1 border-b border-line bg-header px-1.5 text-fg-2 [&_svg]:shrink-0';

export const BUTTON =
  'inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-[4px] px-1.5 text-fg-2 ' +
  'hover:bg-[var(--bg-hover,#30323a)] hover:text-fg active:bg-[var(--bg-pressed,#3a3d46)] ' +
  'disabled:cursor-not-allowed disabled:text-[var(--text-disabled,#5d616b)] disabled:hover:bg-transparent ' +
  'focus-visible:outline-2 focus-visible:outline-[var(--accent-text,#a996ff)]';

export const PRIMARY_BUTTON =
  'inline-flex h-6 items-center justify-center rounded-[4px] bg-accent-fill px-3 text-white ' +
  'hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-text,#a996ff)]';

export const INPUT =
  'h-[22px] min-w-0 rounded-[3px] border border-transparent bg-[var(--bg-field,#17181b)] px-1.5 text-fg ' +
  'outline-none placeholder:text-fg-3 hover:border-[var(--border-strong,#4b4e58)] ' +
  'focus:border-[var(--accent-text,#a996ff)] read-only:cursor-default read-only:hover:border-transparent ' +
  'disabled:cursor-not-allowed disabled:text-[var(--text-disabled,#5d616b)]';

export const INVALID =
  'border-[var(--danger,#ef6b6b)] hover:border-[var(--danger,#ef6b6b)] focus:border-[var(--danger,#ef6b6b)]';

export const SELECT = `${INPUT} pr-1`;

/** Checkboxes and radios in the accent colour instead of the platform blue. */
export const CHECK = 'accent-[var(--accent,#7c5cff)]';

export const ROW_HOVER = 'hover:bg-[var(--bg-hover,#30323a)]';

export const ROW_SELECTED = 'bg-[var(--bg-selected,#3b3270)] hover:bg-[var(--bg-selected,#3b3270)]';

export const ERROR_TEXT = 'text-[var(--danger,#ef6b6b)]';

export const MUTED_TEXT = 'text-fg-3';

export const EMPTY_STATE = 'grid flex-1 place-items-center p-4 text-center text-fg-3';

/** Rig side colours (research 09 §8.2 `--rig-left/right/center`). */
export const SIDE_COLOR = {
  L: 'var(--rig-left, #4f8dff)',
  R: 'var(--rig-right, #ff5f69)',
  C: 'var(--rig-center, #ffd84d)',
} as const;

export const SIDE_LABEL = { L: 'Left', R: 'Right', C: 'Centre' } as const;

/** Selection highlight tokens (`--sel-lead` marks the lead, Maya's light green). */
export const SEL_LEAD_COLOR = 'var(--sel-lead, #7dff8a)';
