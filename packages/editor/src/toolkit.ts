// `@ekza-studio/editor/toolkit` (STUDIO-TOUCH-SPEC §6.3, §20.1; T5c): the option-box logic of Studio Pro's Toolkit that
// Halo's Options surfaces render at touch density — the label's virtual slider (`startParamSlide`, the rate and clamp
// rules of every ParamField), the param-group sections of a field list and the option defaults that *Make default*
// writes. Number formatting and parsing are editor-core's (`formatParamValue`, `paramEditText`, `parseParamInput`,
// `visibleParams`). Lazy chunks in Pro: a Halo import costs `/editor` 0 B (measured). `paramSections` and
// `setOptionDefault` live in Pro's React field and option-box modules, which come with them (≈ 3.3 kB gzip): Halo
// loads its Options sheet lazily.
export { LABEL_DRAG_PX, type ParamSlide, type ParamSlideHandlers, startParamSlide } from './panels/toolkit/slider';
export { paramSections } from './panels/toolkit/ParamField';
export { setOptionDefault } from './panels/toolkit/OptionBoxView';
