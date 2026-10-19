/**
 * A labelled vertical slider in [0, 1]: a native range input laid out bottom-to-top,
 * so the whole travel sits inside the track and the pointer never has to leave it.
 * Being native, it also takes the keyboard: focus it and the arrow keys nudge it.
 * Double-click resets to `default`.
 */
export function Fader(props: {
  label: string;
  value: number;
  default: number;
  onChange: (v: number) => void;
  /** A channel-style fader: taller, for the control you ride during a mix. */
  tall?: boolean;
}) {
  return (
    <label class="fader-wrap" classList={{ tall: props.tall }} title={`${props.label} ${Math.round(props.value * 100)}%`}>
      <input
        class="fader"
        type="range"
        min={0}
        max={1}
        step={0.001}
        aria-label={props.label}
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.valueAsNumber)}
        onDblClick={() => props.onChange(props.default)}
      />
      <span class="fader-label">{props.label}</span>
    </label>
  );
}
