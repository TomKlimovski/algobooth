/** Horizontal crossfader: 0 is full deck A, 1 is full deck B. */
export function Crossfader(props: { value: number; onChange: (v: number) => void }) {
  return (
    <div class="crossfader">
      <span class="crossfader-label">A</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        aria-label="crossfader"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.valueAsNumber)}
      />
      <span class="crossfader-label">B</span>
    </div>
  );
}
