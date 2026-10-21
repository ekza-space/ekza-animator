// Preferences (P state) defaults, MVP-SPEC §4.5, M2A-SPEC §4.5 and M6A-SPEC §4.6.
import { DEFAULT_EXPORT_REDUCE } from '@ekza-studio/io';
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
    // M6a (M6A-SPEC §4.6)
    lastWorkspace: 'animate',
    modeling: defaultModelingPrefs(),
  };
}

/** `Prefs.modeling` defaults (M6A-SPEC §4.6). */
export function defaultModelingPrefs(): Prefs['modeling'] {
  return {
    primitiveDefaults: 'low-poly',
    numericCapture: 'auto',
    undoSelection: { model: true, animate: false },
    undoBudgetMB: 256,
    journalBudgetMB: 64,
    symmetryTolerance: 0.001,
    gridStep: 0.1,
    increments: { move: 0.1, rotate: Math.PI / 12, scale: 0.1 },
    vertexSnapRadiusPx: 12,
    multiCutSnapStep: 0.25,
    optionDefaults: {},
    toolkitCollapsed: [],
    paletteRecents: [],
    convertOnModeSwitch: false,
  };
}
