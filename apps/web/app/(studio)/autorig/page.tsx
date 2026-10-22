import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Auto-Rig',
};

/**
 * `/autorig` (AUTORIG-SPEC §3.1): the Auto-Rig wizard. The `(studio)` layout's host mounts the Auto-Rig shell for this
 * route (§4.4); the page itself renders nothing of its own.
 */
export default function AutoRigPage(): null {
  return null;
}
