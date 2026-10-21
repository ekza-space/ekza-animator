// The animation icon set (research 09 §8.6): 16 px grid, 1.5 px stroke, round caps, `currentColor`. A tangent
// icon is the curve shape it produces through a key (the dot), so users learn them by sight. MIT, drawn for
// Ekza Studio.
import type { JSX, ReactNode, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Pixel size; default 16. */
  readonly size?: number;
  /** Accessible name; without it the icon is decorative (`aria-hidden`). */
  readonly title?: string;
}

export type IconComponent = (props: IconProps) => JSX.Element;

function icon(name: string, body: ReactNode): IconComponent {
  const Component = ({ size = 16, title, ...props }: IconProps): JSX.Element => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(title === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      data-icon={name}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}
      {body}
    </svg>
  );
  Component.displayName = `${name}Icon`;
  return Component;
}

const keyDot = (x = 8, y = 8): JSX.Element => <circle cx={x} cy={y} r={1.6} fill="currentColor" stroke="none" />;
const handle = (x1: number, y1: number, x2: number, y2: number): JSX.Element => (
  <path d={`M${x1} ${y1}L${x2} ${y2}`} strokeWidth={1} opacity={0.7} />
);

// ---------- tangent types ----------
export const TangentAutoIcon = icon('TangentAuto', [
  <path key="c" d="M2 12.5C4.5 12.5 5.5 5 8 5s3.5 7.5 6 7.5" />,
  <g key="k">{keyDot(8, 5)}</g>,
]);
export const TangentSplineIcon = icon('TangentSpline', [
  <path key="c" d="M2 13C5 13 5.5 8.5 8 7.5S11 3 14 3" />,
  <g key="k">{keyDot(8, 7.5)}</g>,
]);
export const TangentClampedIcon = icon('TangentClamped', [
  <path key="c" d="M2 12C4 12 6 8 8 8c1.5 0 2 0 6 0" />,
  <g key="k">{keyDot()}</g>,
]);
export const TangentLinearIcon = icon('TangentLinear', [
  <path key="c" d="M2 12.5L8 5l6 6" />,
  <g key="k">{keyDot(8, 5)}</g>,
]);
export const TangentFlatIcon = icon('TangentFlat', [
  <path key="c" d="M2 13C5.5 13 4.5 8 8 8s2.5-5 6-5" />,
  <g key="k">{keyDot()}</g>,
  <g key="h">{handle(5, 8, 11, 8)}</g>,
]);
export const TangentStepIcon = icon('TangentStep', [
  <path key="c" d="M2 11.5H8V4.5H14" />,
  <g key="k">{keyDot(8, 11.5)}</g>,
]);
export const TangentStepNextIcon = icon('TangentStepNext', [
  <path key="c" d="M2 11.5H2.5V4.5H14" />,
  <g key="k">{keyDot(8, 4.5)}</g>,
]);
export const TangentPlateauIcon = icon('TangentPlateau', [
  <path key="c" d="M2 12.5C4.5 12.5 5 6 8 6h1.5c2 0 2.5-2.5 4.5-2.5" />,
  <g key="k">{keyDot(8, 6)}</g>,
]);
export const TangentFixedIcon = icon('TangentFixed', [
  <path key="c" d="M2 12.5C4 12.5 5.5 9 8 8s3.5-5 6-5" />,
  <g key="k">{keyDot()}</g>,
  <g key="h">{handle(4.5, 10, 11.5, 6)}</g>,
  <circle key="e1" cx={4.5} cy={10} r={1} />,
  <circle key="e2" cx={11.5} cy={6} r={1} />,
]);
export const TangentBreakIcon = icon('TangentBreak', [
  <path key="a" d="M2 12L7 8" />,
  <path key="b" d="M9 6.5L14 4" />,
  <g key="k">{keyDot()}</g>,
  <path key="x" d="M6.5 3.5l3 9" strokeWidth={1} opacity={0.7} />,
]);
export const TangentUnifyIcon = icon('TangentUnify', [<path key="a" d="M2 12.5L14 3.5" />, <g key="k">{keyDot()}</g>]);
export const WeightedTangentIcon = icon('WeightedTangent', [
  <path key="c" d="M2 13C7 13 6 3 14 3" />,
  <path key="h" d="M2 13h7" strokeWidth={1} opacity={0.7} />,
  <rect key="w" x={8} y={11.5} width={3} height={3} rx={0.5} />,
]);
export const LockWeightIcon = icon('LockWeight', [
  <path key="h" d="M2 13h6" strokeWidth={1} opacity={0.7} />,
  <rect key="b" x={9} y={7.5} width={5} height={5} rx={1} />,
  <path key="s" d="M10 7.5V6a1.5 1.5 0 0 1 3 0v1.5" />,
]);

/** Tangent icons keyed by the anim-core `TangentType` names. */
export const TANGENT_ICONS: Readonly<Record<string, IconComponent>> = {
  auto: TangentAutoIcon,
  autoEase: TangentAutoIcon,
  autoMix: TangentAutoIcon,
  spline: TangentSplineIcon,
  clamped: TangentClampedIcon,
  plateau: TangentPlateauIcon,
  linear: TangentLinearIcon,
  flat: TangentFlatIcon,
  step: TangentStepIcon,
  stepNext: TangentStepNextIcon,
  fixed: TangentFixedIcon,
};

// ---------- infinity modes ----------
const dotted = { strokeDasharray: '1 2.5', opacity: 0.8 } as const;
export const InfinityConstantIcon = icon('InfinityConstant', [
  <path key="c" d="M5 11.5C6.5 11.5 7 6 8.5 6S10.5 6 11 6" />,
  <path key="d" d="M11.5 6H15M1 11.5h3" {...dotted} />,
]);
export const InfinityLinearIcon = icon('InfinityLinear', [
  <path key="c" d="M5 11C6.5 10 7.5 8 11 6" />,
  <path key="d" d="M11 6l4-2.5M1 13.5l4-2.5" {...dotted} />,
]);
export const InfinityCycleIcon = icon('InfinityCycle', [
  <path key="c" d="M5.5 11C6.5 11 7 5 8 5s1.5 6 2.5 6" />,
  <path key="d" d="M10.5 11c1 0 1.5-6 2.5-6s1.5 6 2.5 6M.5 11c1 0 1.5-6 2.5-6s1.5 6 2.5 6" {...dotted} />,
]);
export const InfinityCycleOffsetIcon = icon('InfinityCycleOffset', [
  <path key="c" d="M5.5 10.5C6.5 10.5 7 7 8.5 7" />,
  <path key="d" d="M8.5 7c1 0 1.5-3.5 2.5-3.5h4M.5 14c1 0 1.5-3.5 2.5-3.5h2.5" {...dotted} />,
]);
export const InfinityOscillateIcon = icon('InfinityOscillate', [
  <path key="c" d="M5.5 12L8 5" />,
  <path key="d" d="M8 5l2.5 7L13 5l2 6M3 5l2.5 7" {...dotted} />,
]);

/** Infinity icons keyed by the anim-core `InfinityMode` names. */
export const INFINITY_ICONS: Readonly<Record<string, IconComponent>> = {
  constant: InfinityConstantIcon,
  linear: InfinityLinearIcon,
  cycle: InfinityCycleIcon,
  cycleOffset: InfinityCycleOffsetIcon,
  oscillate: InfinityOscillateIcon,
};

// ---------- tools ----------
export const SelectToolIcon = icon('SelectTool', <path d="M3.5 2.5l9 5-4 1.2 2.6 4.3-1.7 1-2.6-4.4L3.5 12z" />);
export const MoveToolIcon = icon('MoveTool', [
  <path key="a" d="M8 1.5v13M1.5 8h13" />,
  <path key="h" d="M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2" />,
]);
export const RotateToolIcon = icon('RotateTool', [
  <ellipse key="a" cx={8} cy={8} rx={6} ry={6} />,
  <ellipse key="b" cx={8} cy={8} rx={6} ry={2.4} opacity={0.75} />,
  <ellipse key="c" cx={8} cy={8} rx={2.4} ry={6} opacity={0.75} />,
]);
export const ScaleToolIcon = icon('ScaleTool', [
  <path key="a" d="M3 13L12 4" />,
  <rect key="b" x={10.5} y={2} width={3.5} height={3.5} />,
  <rect key="c" x={2} y={10.5} width={3.5} height={3.5} />,
]);
export const InsertKeyToolIcon = icon('InsertKeyTool', [
  <path key="c" d="M1.5 13C5 13 5 5 8 5s3 8 6.5 8" />,
  <path key="p" d="M8 1.5v7M4.5 5h7" strokeWidth={1.25} />,
]);

// ---------- manipulator spaces ----------
export const SpaceObjectIcon = icon('SpaceObject', [
  <rect key="b" x={3.5} y={3.5} width={9} height={9} rx={1} transform="rotate(20 8 8)" />,
  <path key="a" d="M8 8l4.5-1.6M8 8L6.4 3.5" />,
]);
export const SpaceWorldIcon = icon('SpaceWorld', [
  <circle key="c" cx={8} cy={8} r={6} />,
  <path key="m" d="M2 8h12M8 2c-2.2 2.4-2.2 9.6 0 12M8 2c2.2 2.4 2.2 9.6 0 12" />,
]);
export const SpaceGimbalIcon = icon('SpaceGimbal', [
  <circle key="o" cx={8} cy={8} r={6.25} />,
  <ellipse key="m" cx={8} cy={8} rx={6.25} ry={2.6} transform="rotate(-25 8 8)" />,
  <ellipse key="i" cx={8} cy={8} rx={2.2} ry={4.6} transform="rotate(25 8 8)" />,
]);

// ---------- display ----------
export const DisplayMeshIcon = icon('DisplayMesh', [
  <path key="h" d="M8 2l5.5 3v6L8 14l-5.5-3V5z" />,
  <path key="e" d="M2.5 5L8 8l5.5-3M8 8v6" opacity={0.75} />,
]);
export const DisplaySkeletonIcon = icon('DisplaySkeleton', [
  <circle key="a" cx={8} cy={3} r={1.5} />,
  <path key="b" d="M8 4.5V9M8 9l-3 5M8 9l3 5M4 6.5h8" />,
]);
export const DisplayControlsIcon = icon('DisplayControls', [
  <circle key="a" cx={8} cy={8} r={5.5} />,
  <circle key="b" cx={8} cy={8} r={1.2} fill="currentColor" stroke="none" />,
]);
export const DisplayXrayIcon = icon('DisplayXray', [
  <rect key="b" x={2.5} y={2.5} width={8} height={8} rx={1} opacity={0.55} />,
  <rect key="f" x={5.5} y={5.5} width={8} height={8} rx={1} />,
]);
export const DisplayGridIcon = icon('DisplayGrid', <path d="M1.5 5.5h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13" />);
export const DisplayHudIcon = icon('DisplayHud', [
  <rect key="f" x={1.5} y={3} width={13} height={10} rx={1.5} />,
  <path key="t" d="M4 6h3M10 10.5h2" />,
]);

/** Display-toggle icons keyed by the editor-core `DisplayFlags` names. */
export const DISPLAY_ICONS: Readonly<Record<string, IconComponent>> = {
  mesh: DisplayMeshIcon,
  skeleton: DisplaySkeletonIcon,
  controls: DisplayControlsIcon,
  xray: DisplayXrayIcon,
  grid: DisplayGridIcon,
  hud: DisplayHudIcon,
};

// ---------- cameras, layouts, keys ----------
export const CameraLockedIcon = icon('CameraLocked', [
  <rect key="c" x={1.5} y={5} width={9} height={7} rx={1} />,
  <path key="l" d="M10.5 7.5L14.5 5.5v6l-4-2" />,
  <rect key="b" x={5} y={1} width={4} height={3} rx={0.5} fill="currentColor" stroke="none" />,
]);
export const CameraUnlockedIcon = icon('CameraUnlocked', [
  <rect key="c" x={1.5} y={5} width={9} height={7} rx={1} />,
  <path key="l" d="M10.5 7.5L14.5 5.5v6l-4-2" />,
]);
export const LayoutSingleIcon = icon('LayoutSingle', <rect x={1.5} y={2.5} width={13} height={11} rx={1} />);
export const LayoutSplitIcon = icon('LayoutSplit', [
  <rect key="r" x={1.5} y={2.5} width={13} height={11} rx={1} />,
  <path key="d" d="M8 2.5v11" />,
]);
export const LayoutQuadIcon = icon('LayoutQuad', [
  <rect key="r" x={1.5} y={2.5} width={13} height={11} rx={1} />,
  <path key="d" d="M8 2.5v11M1.5 8h13" />,
]);
/** Layout icons keyed by the editor-core `ViewportLayout` names. */
export const LAYOUT_ICONS: Readonly<Record<string, IconComponent>> = {
  single: LayoutSingleIcon,
  split: LayoutSplitIcon,
  quad: LayoutQuadIcon,
};

export const KeyframeIcon = icon('Keyframe', <path d="M8 2.5L13.5 8 8 13.5 2.5 8z" />);
export const AutoKeyIcon = icon('AutoKey', [
  <circle key="r" cx={8} cy={8} r={5.5} />,
  <circle key="d" cx={8} cy={8} r={3} fill="currentColor" stroke="none" />,
]);
export const MirrorPoseIcon = icon('MirrorPose', [
  <path key="m" d="M8 1.5v13" strokeDasharray="1.5 2" />,
  <path key="l" d="M6 4L2.5 8 6 12z" />,
  <path key="r" d="M10 4l3.5 4-3.5 4z" />,
]);
export const LoopOnceIcon = icon('LoopOnce', [
  <path key="a" d="M2 8h10" />,
  <path key="h" d="M9.5 5.5L12 8l-2.5 2.5M14 4v8" />,
]);
export const LoopIcon = icon('Loop', [
  <path key="a" d="M3 9.5V7a3 3 0 0 1 3-3h7" />,
  <path key="b" d="M11 2l2 2-2 2M13 6.5V9a3 3 0 0 1-3 3H3" />,
  <path key="c" d="M5 14l-2-2 2-2" />,
]);
export const LoopOscillateIcon = icon('LoopOscillate', [
  <path key="a" d="M2.5 6h11" />,
  <path key="b" d="M11 3.5L13.5 6 11 8.5M13.5 10.5h-11M5 8l-2.5 2.5L5 13" />,
]);
/** Loop-mode icons keyed by the editor-core `LoopMode` names. */
export const LOOP_ICONS: Readonly<Record<string, IconComponent>> = {
  once: LoopOnceIcon,
  loop: LoopIcon,
  oscillate: LoopOscillateIcon,
};

/** The Ekza Studio mark (menu bar). */
export const AppMarkIcon = icon('AppMark', [
  <path key="d" d="M8 1.5l6.5 6.5L8 14.5 1.5 8z" />,
  <circle key="c" cx={8} cy={8} r={2.2} fill="currentColor" stroke="none" />,
]);
