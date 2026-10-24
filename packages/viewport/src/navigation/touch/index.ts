// Touch navigation of the viewport (STUDIO-TOUCH-SPEC §20.3 item 1; T1): Auto-Rig's Simple navigation and its
// two-finger stage, moved here so every shell that keeps one finger eager can install them (Auto-Rig re-imports them).
export {
  addNavigationClaim,
  BRUSH_TOOLS,
  installSimpleNavigation,
  MESH_TOOLS,
  type NavigationClaim,
  type SimplePress,
  simpleGesture,
  toolClaims,
} from './simple';
export { createTwoFingerStage, type Finger, twoFingerStep } from './pair';
