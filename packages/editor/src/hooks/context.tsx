import { EkzaError } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { createContext, type JSX, type ReactNode, useContext } from 'react';

const EditorAppContext = createContext<EditorApp | null>(null);

/** Makes `app` available to `useEditorApp` and the other editor hooks below it. */
export function EditorAppProvider(props: { readonly app: EditorApp; readonly children?: ReactNode }): JSX.Element {
  return <EditorAppContext value={props.app}>{props.children}</EditorAppContext>;
}

/** The EditorApp of the nearest EditorAppProvider; throws when there is none. */
export function useEditorApp(): EditorApp {
  const app = useContext(EditorAppContext);
  if (app === null) throw new EkzaError('internal', 'useEditorApp() must be called inside <EditorAppProvider>');
  return app;
}
