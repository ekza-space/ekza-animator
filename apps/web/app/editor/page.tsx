import type { Metadata } from 'next';
import type { JSX } from 'react';
import { EditorIsland } from './EditorIsland';

export const metadata: Metadata = {
  title: 'Editor',
};

export default function EditorPage(): JSX.Element {
  return <EditorIsland />;
}
