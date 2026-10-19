/** Pixels of vertical drag that sweep the knob across its whole [0, 1] range. */
const DRAG_RANGE_PX = 150;
/** Knob indicator sweep in degrees, centred on twelve o'clock. */
const SWEEP_DEG = 270;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A labelled knob: drag up to raise, down to lower; double-click resets to `default`. */
export function Knob(props: { label: string; value: number; default: number; onChange: (v: number) => void }) {
  let startY = 0;
  let startValue = 0;

  const onPointerDown = (e: PointerEvent) => {
    startY = e.clientY;
    startValue = props.value;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    props.onChange(clamp01(startValue + (startY - e.clientY) / DRAG_RANGE_PX));
  };

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
        onPointerMove={onPointerMove}
        onDblClick={() => props.onChange(props.default)}
        style={{ transform: `rotate(${(props.value - 0.5) * SWEEP_DEG}deg)` }}
      />
      <span class="knob-label">{props.label}</span>
    </div>
  );
}
