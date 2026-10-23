'use client';

import type { StudioHostProps } from '@ekza-studio/editor/host';
import {
  type ComponentType,
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

// The `(studio)` layout's island (AUTORIG-SPEC §4.4, D1; decision AR-D1-1 in docs/wp-notes/ar-studio-host.md). Each
// route's page loads one `next/dynamic` entry group of its own — `StudioHost` with Studio's shell on `/editor`,
// `StudioHost` with the Auto-Rig shell on `/autorig` — exactly as `/editor` loaded one editor group before, so no
// route pays for a split. The entry registers its host component, the host's props and its shell here; this island,
// which Next keeps mounted across client navigations between the two routes, renders the first registered host once
// and swaps only the shell below it. Both entries share every module (Turbopack instantiates a module once per page,
// whichever chunk carried it), so the host, the EditorApp, the undo history, the cameras, autosave and the WebGL
// context survive a switch; only the arriving route's entry is fetched.

/** What a route's entry group registers: the page's host component, its props and the route's shell. */
export interface ShellEntry {
  readonly Host: ComponentType<StudioHostProps>;
  readonly props: StudioHostProps;
  readonly Shell: ComponentType;
}

const RegisterEntry = createContext<(entry: ShellEntry | null) => void>(() => {});

/** Registers a route entry while the route's page is mounted. */
export function useShellEntry(entry: ShellEntry): void {
  const register = useContext(RegisterEntry);
  useEffect(() => {
    register(entry);
    return () => register(null);
  }, [register, entry]);
}

export function StudioHostIsland(props: { readonly children: ReactNode }): JSX.Element {
  // The first entry's host stays for the page's life; the current entry gives the shell and the latest props.
  const [first, setFirst] = useState<ShellEntry | null>(null);
  const [entry, setEntry] = useState<ShellEntry | null>(null);
  const register = useCallback((next: ShellEntry | null) => {
    if (next !== null) setFirst((current) => current ?? next);
    setEntry(next);
  }, []);
  const Shell = entry?.Shell;
  return (
    <RegisterEntry value={register}>
      {props.children}
      {first === null ? null : (
        <first.Host {...(entry ?? first).props}>{Shell === undefined ? null : <Shell />}</first.Host>
      )}
    </RegisterEntry>
  );
}
