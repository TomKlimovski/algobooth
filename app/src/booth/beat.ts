import { BEATS_PER_CYCLE } from './deckState';
import type { Quantise } from './keys/bindings';

/** Where a deck's clock stands, counted from 1 like a CDJ's bar.beat readout. */
export interface BeatPosition {
  bar: number;
  beat: number;
  /** The first part of the beat, when the meter and the waiting keys light up. */
  flash: boolean;
}

/** How much of each beat the flash lasts. */
const FLASH = 0.3;

/**
 * The bar and beat at a scheduler cycle (`Cyclist.now()`). The deck's clock triggers `latency` after it
 * queries and `now()` trails the tick by `clock.duration`; with DECK_CLOCK both are 50 ms, so the cycle
 * `now()` reports is the one being heard. The clock lead before cycle 0 counts as the first beat.
 */
export function beatAt(cycle: number): BeatPosition {
  const beats = Math.max(0, cycle) * BEATS_PER_CYCLE;
  const whole = Math.floor(beats);
  return {
    bar: Math.floor(whole / BEATS_PER_CYCLE) + 1,
    beat: (whole % BEATS_PER_CYCLE) + 1,
    flash: beats - whole < FLASH,
  };
}

/** The beat (1 to 4) a press made on `beat` lands on; null when it lands at once. */
export function landingBeat(beat: number, q: Quantise): number | null {
  if (q === 'now') return null;
  return q === 'bar' ? 1 : (beat % BEATS_PER_CYCLE) + 1;
}
