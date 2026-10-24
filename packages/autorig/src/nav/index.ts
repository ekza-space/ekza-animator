// Simple navigation (AUTORIG-SPEC §8.1; D3): moved into the viewport package (`viewport/src/navigation/touch/`,
// STUDIO-TOUCH-SPEC §20.3 item 1, T1). This module re-exports it for Auto-Rig's own imports and tests.
export {
  addNavigationClaim,
  installSimpleNavigation,
  type NavigationClaim,
  type SimplePress,
  simpleGesture,
  toolClaims,
} from '@ekza-studio/viewport';
