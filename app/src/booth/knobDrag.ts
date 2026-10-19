/** Pixels of vertical drag that sweep a knob across its whole [0, 1] range. */
export const DRAG_RANGE_PX = 150;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Knob value for a drag that started at `startValue` with the pointer at `startY` and is now at `clientY`. */
export const dragValue = (startValue: number, startY: number, clientY: number): number =>
  clamp01(startValue + (startY - clientY) / DRAG_RANGE_PX);
