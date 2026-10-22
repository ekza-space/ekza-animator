import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Editor',
};

/**
 * `/editor` (Studio). The `(studio)` layout's host mounts the Studio shell for this route (AUTORIG-SPEC §4.4); the
 * page itself renders nothing of its own.
 */
export default function EditorPage(): null {
  return null;
}
