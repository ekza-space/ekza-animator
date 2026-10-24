// The breadcrumb, the selection chip (STUDIO-TOUCH-SPEC §4.1, §6.5): floats above the selection, never over it.
// `Cube Lad › Right arm › Forearm · Numbers`: tap a crumb to select that ancestor; *Numbers* opens the Inspector;
// long-press the last crumb for ‹ › siblings, ▾ children, *Other side* and *Select branch* (with the Thumb key's Select
// more on, ‹ › and ▾ extend the selection — Pro's Shift+arrows). In Make it carries *Select ▾* (Loop · Ring · Shell ·
// Grow · Shrink; Loop needs a picked edge and is T8's); after an ambiguous tap *Next ›* steps to the next candidate under it (§5.2); when the Halo opens only
// on right-click (§4.5) *⋯ Verbs* is the visible way in.
import { type Box, Cluster, TouchButton, useLongPress } from '@ekza-studio/ui/touch';
import { type JSX, useState } from 'react';
import type { HaloController } from '../shell/controller';
import { useHaloStore } from '../shell/store';
import { en } from '../i18n/en';
import { breadcrumbTop } from './geometry';
import { Icon } from './icons';
import type { Noun } from './verbSource';

const crumbClass = 'min-w-0 truncate px-2.5 font-normal';

const SELECT_MENU: readonly { readonly op: string; readonly label: string }[] = [
  { op: 'select.mesh.ring', label: en.halo.ring },
  { op: 'select.mesh.shell', label: en.halo.shell },
  { op: 'select.mesh.grow', label: en.halo.grow },
  { op: 'select.mesh.shrink', label: en.halo.shrink },
];

export function Breadcrumb({
  controller,
  noun,
  box,
  width,
  above,
}: {
  readonly controller: HaloController;
  readonly noun: Noun;
  readonly box: Box | null;
  readonly width: number;
  /** The top the breadcrumb may not go above (the top bar). */
  readonly above: number;
}): JSX.Element {
  const { ctx, grammar } = controller;
  const { store } = ctx;
  const haloOpen = useHaloStore(store, (s) => s.halo !== null);
  const candidates = useHaloStore(store, (s) => s.candidates.length);
  const stage = useHaloStore(store, (s) => s.stage);
  const thumbOn = useHaloStore(store, (s) => s.thumb.latch !== 'off');
  const [menu, setMenu] = useState<'walk' | 'select' | null>(null);
  const last = noun.crumbs[noun.crumbs.length - 1];
  const press = useLongPress({
    onTap: () => {
      if (!haloOpen) grammar.open();
    },
    onLongPress: () => setMenu('walk'),
  });
  const centerX = box === null ? width / 2 : (box.left + box.right) / 2;
  const top = breadcrumbTop(box, above);
  const walk = (direction: 'up' | 'down' | 'left' | 'right'): void => {
    setMenu(null);
    void ctx.run('select.pickWalk', { direction, add: thumbOn });
  };
  const components = noun.kind === 'face' || noun.kind === 'edge' || noun.kind === 'vertex';
  return (
    <div
      data-halo-chrome=""
      data-testid="halo-breadcrumb"
      className="pointer-events-none absolute z-(--z-chrome) flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{ left: Math.min(Math.max(centerX, 180), Math.max(180, width - 180)), top }}
    >
      <Cluster className="pointer-events-auto flex h-(--touch-hit) max-w-[min(640px,calc(100vw-32px))] items-center rounded-full px-1 text-[15px]">
        <nav aria-label={en.halo.selectionPath} className="flex min-w-0 items-center">
          {noun.crumbs.slice(0, -1).map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center">
              <TouchButton
                variant="ghost"
                className={crumbClass}
                {...(crumb.select === undefined ? { disabled: true } : {})}
                onClick={() => {
                  if (crumb.select !== undefined) void ctx.run(crumb.select.op, crumb.select.args);
                }}
              >
                {crumb.label}
              </TouchButton>
              <span aria-hidden="true" className="text-fg-3">
                ›
              </span>
            </span>
          ))}
          {last === undefined ? null : (
            <TouchButton
              variant="ghost"
              className="min-w-0 truncate px-2.5 text-fg"
              aria-current="true"
              aria-haspopup="menu"
              data-testid="halo-crumb-last"
              {...press}
              onClick={(event) => {
                // keyboard and assistive technology (no pointer): the same as a tap
                if (event.detail === 0 && !haloOpen) grammar.open();
              }}
            >
              {last.label}
            </TouchButton>
          )}
        </nav>
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
        <TouchButton
          variant="ghost"
          className="px-2.5 text-accent-text"
          data-testid="halo-numbers"
          onClick={() => store.set({ sheet: 'numbers', halo: null })}
        >
          {en.halo.numbers}
        </TouchButton>
        {components && stage === 'make' ? (
          <TouchButton
            variant="ghost"
            className="gap-1 px-2.5 text-accent-text"
            aria-haspopup="menu"
            aria-expanded={menu === 'select'}
            onClick={() => setMenu(menu === 'select' ? null : 'select')}
          >
            {en.halo.select}
            <Icon name="down" size={16} />
          </TouchButton>
        ) : null}
        {candidates > 1 ? (
          <TouchButton variant="ghost" className="gap-1 px-2.5" data-testid="halo-next" onClick={() => grammar.next()}>
            {en.halo.next}
            <Icon name="right" size={16} />
          </TouchButton>
        ) : null}
        {haloOpen ? null : (
          <TouchButton
            variant="ghost"
            className="gap-1 px-2.5"
            data-testid="halo-verbs"
            aria-label={`${en.halo.verbs}, ${noun.label}`}
            onClick={() => grammar.open()}
          >
            <Icon name="more" size={18} />
            {en.halo.verbs}
          </TouchButton>
        )}
      </Cluster>
      {menu === null ? null : (
        <Cluster
          role="menu"
          aria-label={menu === 'walk' ? noun.label : en.halo.select}
          data-testid="halo-crumb-menu"
          className="pointer-events-auto flex flex-wrap justify-center gap-1 p-1.5"
        >
          {menu === 'walk' ? (
            <>
              <TouchButton role="menuitem" variant="ghost" onClick={() => walk('left')}>
                ‹ {en.halo.previous}
              </TouchButton>
              <TouchButton role="menuitem" variant="ghost" onClick={() => walk('right')}>
                {en.halo.following} ›
              </TouchButton>
              <TouchButton role="menuitem" variant="ghost" onClick={() => walk('up')}>
                {en.halo.parent}
              </TouchButton>
              <TouchButton role="menuitem" variant="ghost" onClick={() => walk('down')}>
                ▾ {en.halo.children}
              </TouchButton>
              <TouchButton
                role="menuitem"
                variant="ghost"
                onClick={() => {
                  setMenu(null);
                  void ctx.run('select.mirror');
                }}
              >
                {en.halo.otherSide}
              </TouchButton>
            </>
          ) : (
            SELECT_MENU.map((item) => (
              <TouchButton
                key={item.op}
                role="menuitem"
                variant="ghost"
                onClick={() => {
                  setMenu(null);
                  void ctx.run(item.op);
                }}
              >
                {item.label}
              </TouchButton>
            ))
          )}
        </Cluster>
      )}
    </div>
  );
}
