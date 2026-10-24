// The numpad of a chip (STUDIO-TOUCH-SPEC §5.6): the kit's Pencil-sized numpad (minus, decimal point, expressions,
// units, ±1 / ±10, Done), anchored to its chip. Its own lazy chunk: `/app` loads it on the first tap of a chip.
import { Numpad, type NumpadProps } from '@ekza-studio/ui/touch';
import type { JSX } from 'react';

export default function NumpadPanel(props: NumpadProps): JSX.Element {
  return <Numpad data-testid="halo-numpad" className="z-(--z-popover)" {...props} />;
}
