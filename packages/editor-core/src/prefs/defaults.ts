// Preferences (P state) defaults, MVP-SPEC §4.5 and M2A-SPEC §4.5.
import { DEFAULT_EXPORT_REDUCE } from '@ekza-animator/io';
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
    autoRigIk: { legs: true, arms: true },
    ikFkVisibility: 'hide',
    ikFkSwitchKey: 'auto',
    tweenOvershoot: false,
    arrowKeys: 'pickWalk',
    virtualSlider: { degPerPx: 0.5, metresPerPx: 0.01, unitsPerPx: 0.01, viewportMmb: true },
    exportReduce: { enabled: true, ...DEFAULT_EXPORT_REDUCE },
    autosave: { enabled: true, delayMs: 2000, maxIntervalMs: 30000 },
  };
}
