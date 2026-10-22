import type { Metadata } from 'next';
import type { JSX } from 'react';
import { EditorEntryIsland } from './EditorEntryIsland';

export const metadata: Metadata = {
  title: 'Editor',
};

/** `/editor` (Studio): its entry registers the host and Studio's shell with the `(studio)` layout (§4.4). */
export default function EditorPage(): JSX.Element {
  return <EditorEntryIsland />;
}
