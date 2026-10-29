import { createEffect, createSignal, For, onCleanup, type Accessor } from 'solid-js';
import { beatAt, landingBeat, type BeatPosition } from './beat';
import type { Quantise } from './keys/bindings';

const LAMPS = [1, 2, 3, 4];

/**
 * The deck's bar and beat, read from its scheduler every animation frame while it plays; null while stopped.
 * The signal only changes when the beat or its flash does, so the header redraws a few times a beat.
 */
export function createBeatClock(scheduler: () => { now(): number }, playing: Accessor<boolean>): Accessor<BeatPosition | null> {
  const [pos, setPos] = createSignal<BeatPosition | null>(null, {
    equals: (a, b) => a?.bar === b?.bar && a?.beat === b?.beat && a?.flash === b?.flash,
  });
  createEffect(() => {
    if (!playing()) {
      setPos(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      setPos(beatAt(scheduler().now()));
      frame = requestAnimationFrame(tick);
    };
    tick();
    onCleanup(() => cancelAnimationFrame(frame));
  });
  return pos;
}

/**
 * A CDJ-style beat counter: bar.beat and four lamps, the downbeat's in red. While presses wait for the
 * quantise line, the lamp they land on blinks on every beat until they do.
 */
export function BeatMeter(props: { pos: BeatPosition | null; waiting: boolean; quantise: Quantise }) {
  const landing = () => (props.pos && props.waiting ? landingBeat(props.pos.beat, props.quantise) : null);
  return (
    <span class="beat-meter" classList={{ waiting: landing() !== null }} aria-hidden="true">
      <span class="beat-count">{props.pos ? `${props.pos.bar}.${props.pos.beat}` : '-.-'}</span>
      <For each={LAMPS}>
        {(n) => (
          <span
            class="beat-lamp"
            classList={{
              down: n === 1,
              lit: props.pos?.beat === n,
              flash: props.pos?.beat === n && props.pos.flash,
              landing: landing() === n,
              blink: landing() === n && !!props.pos?.flash,
            }}
          />
        )}
      </For>
    </span>
  );
}
