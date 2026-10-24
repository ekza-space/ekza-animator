// Share › OMOBA & Ekza Space › *Made for a game* (CHARACTER-CONTRACT-SPEC §8.2–§8.10, C2; STUDIO-TOUCH-SPEC §7.3, §13.3;
// T11): a model character can be made for one of OMOBA's heroes (`target.bind`, the contract pinned in the document;
// `target.unbind`; `target.update` to the bundled newer list). Bound, the OMOBA card writes C2's hero package
// (`target.exportPackage`: the target's slot animations and the slot map, `ekza/omoba-humanoid-v2`) and lists the
// hero's slots — the game's own animation or yours — with *Make it* for an empty one (`target.slot.create`, the game
// default's copy, one step with the contract's settings). Studio Pro's Target panel (Windows › Target) arrives here.
// The target chunk loads on the first tap (CC-22), never with the sheet.
import type { CharacterId } from '@ekza-studio/doc';
import { type EditorApp, loadTargetKit, type TargetKit } from '@ekza-studio/editor-core';
import { SheetGroup, TouchButton } from '@ekza-studio/ui/touch';
import { type JSX, useEffect, useState } from 'react';
import { en } from '../../i18n/en';

interface Hero {
  readonly id: string;
  readonly name: string;
}

export function GameTarget(props: {
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly bound: boolean;
  /** The store version: the slot list follows the document. */
  readonly version: number;
  run(op: string, args: unknown): void;
  touch(): void;
}): JSX.Element {
  const { app, character, bound } = props;
  const [kit, setKit] = useState<TargetKit | null>(null);
  const [heroes, setHeroes] = useState<readonly Hero[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a bound character's slots need the chunk (its rows come from the pinned contract in the document)
  useEffect(() => {
    if (!bound || kit !== null) return;
    let live = true;
    void loadTargetKit(app).then(
      (loaded) => live && setKit(loaded),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [app, bound, kit]);

  const choose = (): void => {
    props.touch();
    setOpen(true);
    if (heroes !== null) return;
    void loadTargetKit(app)
      .then(async (loaded) => {
        setKit(loaded);
        const { model } = await loaded.contractsOf(app).latest('omoba');
        setHeroes(
          model.targets
            .filter((target) => target.kind === 'character')
            .map((target) => ({ id: target.id, name: target.name })),
        );
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };

  const binding = bound && kit !== null ? kit.bindingOf(app, character) : null;
  const statuses = bound && kit !== null ? kit.slotStatuses(app, character) : null;
  const heroName = binding?.model?.targets.find((t) => t.id === binding.target.target)?.name ?? null;
  const rows = (statuses?.rows ?? []).filter((row) => row.kind === 'animation' && row.status.kind !== 'fixed');

  return (
    <section className="flex flex-col gap-1" data-section="destination" data-testid="halo-share-target">
      <SheetGroup>{en.share.target.title}</SheetGroup>
      {bound ? (
        <>
          <div className="flex min-h-[52px] flex-wrap items-center gap-2 px-2.5">
            <span className="min-w-0 flex-1 text-fg" data-testid="halo-share-target-hero">
              {en.share.target.madeFor(heroName ?? '…')}
            </span>
            <TouchButton
              variant="ghost"
              data-op="target.update"
              onClick={() => {
                props.touch();
                props.run('target.update', { character });
              }}
            >
              {en.share.target.update}
            </TouchButton>
            <TouchButton
              variant="ghost"
              data-op="target.unbind"
              data-testid="halo-share-target-unbind"
              onClick={() => {
                props.touch();
                props.run('target.unbind', { character });
              }}
            >
              {en.share.target.unbind}
            </TouchButton>
          </div>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="halo-share-slots">
            {rows.map((row) => {
              const mine = row.status.kind === 'custom' || row.status.kind === 'invalid';
              return (
                <li
                  key={row.slot}
                  className="flex min-h-[48px] items-center gap-2 px-2.5"
                  data-slot={row.slot}
                  data-status={row.status.kind}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-fg">{row.label}</span>
                    <span className="truncate text-touch-label text-fg-3">
                      {mine ? en.share.target.yours : en.share.target.gameDefault}
                    </span>
                  </span>
                  {mine ? null : (
                    <TouchButton
                      data-op="target.slot.create"
                      data-testid="halo-share-slot-make"
                      onClick={() => {
                        props.touch();
                        props.run('target.slot.create', {
                          character,
                          slot: row.slot,
                          from: row.default === null ? 'blank' : 'default',
                        });
                      }}
                    >
                      {en.share.target.makeIt}
                    </TouchButton>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <div className="flex min-h-[52px] flex-wrap items-center gap-2 px-2.5">
            <span className="min-w-0 flex-1 text-fg-2">{en.share.target.notBound}</span>
            <TouchButton variant="ghost" aria-expanded={open} data-testid="halo-share-target-choose" onClick={choose}>
              {en.share.target.choose}
            </TouchButton>
          </div>
          {open ? (
            <div className="flex flex-wrap gap-1.5 px-2.5 pb-1" data-testid="halo-share-heroes">
              {error !== null ? <span className="text-touch-label text-danger">{error}</span> : null}
              {heroes === null && error === null ? (
                <span className="text-touch-label text-fg-3">{en.share.target.loading}</span>
              ) : null}
              {(heroes ?? []).map((hero) => (
                <TouchButton
                  key={hero.id}
                  data-op="target.bind"
                  data-testid={`halo-share-hero-${hero.id}`}
                  onClick={() => {
                    props.touch();
                    setOpen(false);
                    props.run('target.bind', { character, game: 'omoba', target: hero.id });
                  }}
                >
                  {hero.name}
                </TouchButton>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
