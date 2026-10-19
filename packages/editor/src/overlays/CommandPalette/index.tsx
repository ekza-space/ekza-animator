// Command palette host (M6A-SPEC §5.18; B9): the list UI is a lazy chunk loaded when the palette first opens.
import { type JSX, lazy, Suspense } from 'react';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type { CommandPaletteController } from './controller';

export {
  type CommandPaletteController,
  createCommandPaletteController,
  filterEntries,
  formatParam,
  fuzzyScore,
  type PaletteEntry,
  paletteEntries,
  parseParam,
} from './controller';

const CommandPaletteView = lazy(() => import('./CommandPaletteView'));

export function CommandPaletteHost(props: { readonly controller: CommandPaletteController }): JSX.Element | null {
  const open = useStoreSelector(props.controller.state, (s) => s.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <CommandPaletteView controller={props.controller} />
    </Suspense>
  );
}
