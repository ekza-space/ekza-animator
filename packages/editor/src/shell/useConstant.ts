// One instance per mounted component. A plain state initializer or useMemo would not do: React StrictMode calls
// those twice in development and the discarded editor (services, operators, schedulers) would never be disposed.
// Here the initializer only allocates a lazy cell; the StrictMode re-render reuses the kept cell, so `create` runs
// once.
import { useState } from 'react';

function once<T>(create: () => T): () => T {
  let cell: { readonly value: T } | null = null;
  return () => {
    cell ??= { value: create() };
    return cell.value;
  };
}

export function useConstant<T>(create: () => T): T {
  const [get] = useState(() => once(create));
  return get();
}
