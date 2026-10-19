import { onCleanup } from 'solid-js';
import { dragValue } from './knobDrag';

/** Knob indicator sweep in degrees, centred on twelve o'clock. */
const SWEEP_DEG = 270;

/**
 * A labelled knob: drag up to raise, down to lower; double-click resets to `default`.
 *
 * The drag listens on `window` rather than relying on pointer capture: WebKit starts a
 * native text selection on mousedown and cancels the capture once the pointer leaves
 * the dial, so `preventDefault` on pointerdown stops the selection and the window
 * listeners keep the drag alive wherever the pointer goes.
 */
export function Knob(props: { label: string; value: number; default: number; onChange: (v: number) => void }) {
  let startY = 0;
  let startValue = 0;

  const onMove = (e: PointerEvent) => props.onChange(dragValue(startValue, startY, e.clientY));
  const endDrag = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startY = e.clientY;
    startValue = props.value;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };
  onCleanup(endDrag);

  return (
    <div class="knob-wrap" title={`${props.label} ${Math.round(props.value * 100)}%`}>
      <div
        class="knob"
        role="slider"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={props.value}
        onPointerDown={onPointerDown}
        onDblClick={() => props.onChange(props.default)}
        style={{ transform: `rotate(${(props.value - 0.5) * SWEEP_DEG}deg)` }}
      />
      <span class="knob-label">{props.label}</span>
    </div>
  );
}
