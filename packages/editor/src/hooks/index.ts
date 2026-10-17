// WP-0b stubs: final signatures (MVP-SPEC §7 WP-8); they throw until the shared test kit adds the real hooks.

import { EkzaError } from '@ekza-animator/anim-core';
import type { DocumentStore, TableName } from '@ekza-animator/doc';
import type { EditorApp, Prefs, SessionState } from '@ekza-animator/editor-core';
import type { JSX, ReactNode } from 'react';

export function EditorAppProvider(_props: { readonly app: EditorApp; readonly children?: ReactNode }): JSX.Element {
  throw new EkzaError('not-implemented', 'editor.EditorAppProvider');
}

export function useEditorApp(): EditorApp {
  throw new EkzaError('not-implemented', 'editor.useEditorApp');
}

export function useSession<T>(_selector: (s: SessionState) => T, _equality?: (a: T, b: T) => boolean): T {
  throw new EkzaError('not-implemented', 'editor.useSession');
}

export function usePrefs<T>(_selector: (p: Prefs) => T): T {
  throw new EkzaError('not-implemented', 'editor.usePrefs');
}

export function useDocQuery<T>(_read: (store: DocumentStore) => T, _tables: readonly TableName[]): T {
  throw new EkzaError('not-implemented', 'editor.useDocQuery');
}
