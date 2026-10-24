// The remembered front door (STUDIO-TOUCH-SPEC §1.2, ST-2, ST-T3-5): using the layout switch updates the remembered
// entry — from Halo, a remembered Ekza Studio (`'halo'`) becomes Pro (`'studio'`); Ask and Auto-Rig stay. The same key
// and record as Studio Pro's `entryChoice.ts`, behind the same `HALO_ENTRY` flag (off until T12, when a stored
// `'halo'` starts to mean something); the integration flips both copies (and `entry-contract.test.ts` pins this one).

export const ENTRY_KEY = 'ekza-studio:entry:v1';
export const HALO_ENTRY = false;

/** ▤ Pro layout from Halo: a remembered `'halo'` becomes `'studio'` (no write while `HALO_ENTRY` is off). */
export function rememberProLayout(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocal()): void {
  if (!HALO_ENTRY || storage === null) return;
  try {
    const record: unknown = JSON.parse(storage.getItem(ENTRY_KEY) ?? 'null');
    const choice = typeof record === 'object' && record !== null ? (record as { choice?: unknown }).choice : null;
    if (choice === 'halo') storage.setItem(ENTRY_KEY, JSON.stringify({ choice: 'studio', at: Date.now() }));
  } catch {
    // blocked or malformed storage: the switch still happens
  }
}

function safeLocal(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
