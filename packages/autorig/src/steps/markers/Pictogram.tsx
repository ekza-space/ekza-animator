// The ② body pictogram (AUTORIG-SPEC §5.3, Cascadeur's body diagram, L1; §8.2): a small front view of a person with
// the nine marker places — the character's right side filled, its mirrored left side as rings — and the selected
// marker drawn as a square in the accent colour, so shape tells the states apart, not colour alone. Decorative to
// screen readers except for its label, which names the selected marker.
import type { QuickRigState } from '@ekza-studio/editor-core';
import type { JSX } from 'react';

type QuickRigMarker = NonNullable<QuickRigState['selected']>;

/** The marker places on a 100 × 200 front view (the character faces the viewer: its right side is on the left). */
const PLACES: Readonly<Record<QuickRigMarker, readonly [number, number]>> = {
  headTop: [50, 8],
  chin: [50, 40],
  pelvis: [50, 104],
  shoulder: [36, 52],
  elbow: [22, 54],
  wrist: [8, 56],
  knee: [43, 150],
  ankle: [43, 186],
  toe: [38, 196],
};
const CENTRE: ReadonlySet<QuickRigMarker> = new Set(['headTop', 'chin', 'pelvis']);

export function Pictogram(props: {
  readonly selected: QuickRigMarker | null;
  readonly placed: ReadonlySet<QuickRigMarker>;
  readonly label: string;
}): JSX.Element {
  const { selected, placed } = props;
  return (
    <figure className="m-0 shrink-0" data-testid="ar-markers-pictogram" data-selected={selected ?? ''}>
      <figcaption className="sr-only">{props.label}</figcaption>
      <svg viewBox="0 0 100 204" className="h-40 w-20 text-fg-3" aria-hidden="true">
        {/* the body: head, torso, arms out to the sides, legs */}
        <g fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x={40} y={8} width={20} height={30} rx={6} />
          <path d="M50 38 V104 M36 52 H64 M36 52 L8 56 M64 52 L92 56 M43 104 H57 M43 104 L43 186 L38 196 M57 104 L57 186 L62 196" />
        </g>
        {(Object.keys(PLACES) as QuickRigMarker[]).flatMap((name) => {
          const [x, y] = PLACES[name];
          const isSelected = name === selected;
          const isPlaced = placed.has(name);
          const own = isSelected ? (
            <rect
              key={`${name}-R`}
              x={x - 5}
              y={y - 5}
              width={10}
              height={10}
              className="fill-accent stroke-fg"
              strokeWidth={1}
              data-marker={name}
              data-selected="true"
            />
          ) : (
            <circle
              key={`${name}-R`}
              cx={x}
              cy={y}
              r={4}
              className={isPlaced ? 'fill-fg-2' : 'fill-none stroke-warn'}
              strokeWidth={1.5}
              data-marker={name}
            />
          );
          if (CENTRE.has(name)) return [own];
          return [
            own,
            <circle
              key={`${name}-L`}
              cx={100 - x}
              cy={y}
              r={4}
              className="fill-none stroke-fg-3"
              strokeWidth={1.5}
              data-ghost={name}
            />,
          ];
        })}
      </svg>
    </figure>
  );
}
