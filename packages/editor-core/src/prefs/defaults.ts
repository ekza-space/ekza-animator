// Preferences (P state) defaults, MVP-SPEC §4.5.
import type { Prefs } from '../types';

export function defaultPrefs(platform: 'mac' | 'other'): Prefs {
  return {
    version: 1,
    firstRunDone: false,
    navProfile: platform === 'mac' ? 'trackpad' : 'maya',
    spaceBehaviour: 'maya',
    keymapOverrides: [],
    defaultTangents: { in: 'auto', out: 'auto' },
    autoKey: false,
    autoKeyMode: 'keyed-only',
    graphHandles: 'selected',
    moveSpace: 'world',
    rotateSpace: 'object',
    reduceOnImport: 'auto',
    uiScale: 1,
  };
}
