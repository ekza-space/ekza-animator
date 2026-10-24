// The T6b harness shell (dev and e2e builds only; see `./index.ts`): mounts as `halo`, installs the parity probe and
// hosts the T6b parts until T6a's frame does.
import { useHost } from '@ekza-studio/editor/host';
import { type JSX, useEffect } from 'react';
import { installParityProbe } from '../probe';

export function HaloT6bHarness(): JSX.Element {
  const host = useHost();
  useEffect(() => {
    installParityProbe(host.app);
    return host.mount({ kind: 'halo', haloState: () => ({ stage: 'make' }) });
  }, [host]);
  return (
    <div className="relative z-(--z-chrome) flex h-full w-full flex-col" data-testid="halo-t6b-harness">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-header px-2">
        <span className="font-semibold">Ekza Studio · T6b harness</span>
      </header>
    </div>
  );
}
