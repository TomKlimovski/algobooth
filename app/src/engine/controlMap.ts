/** Slider positions in [0, 1] mapped to the AudioParam values they drive. */

/** gain is the trim at the top of the channel; volume is the fader at the bottom. */
export type DeckControl = 'lpf' | 'gain' | 'reverb' | 'volume';
export type MasterControl = 'hpf' | 'lpf' | 'volume' | 'reverb' | 'glue';

const expo = (low: number, high: number) => (v: number) => low * Math.pow(high / low, v);
const linear = (v: number) => v;

export const DECK_CONTROL: Record<DeckControl, (v: number) => number> = {
  lpf: expo(200, 20000),
  gain: (v) => 1.2 * v,
  reverb: (v) => 0.6 * v, // send gain
  volume: linear,
};

export const MASTER_CONTROL: Record<MasterControl, (v: number) => number> = {
  hpf: expo(20, 8000),
  lpf: expo(200, 20000),
  volume: linear,
  reverb: (v) => 0.6 * v,
  glue: (v) => glue(v).threshold,
};

/**
 * The master bus compressor for a glue position: off at 0 (a 0 dB threshold at 1:1), up to a -18 dB threshold at
 * 3:1 at the top. No makeup gain here: a DynamicsCompressorNode adds its own (the Web Audio spec's automatic
 * makeup), so turning glue up thickens the mix without making it quieter; the limiter after it catches the rest.
 */
export function glue(v: number): { threshold: number; ratio: number } {
  return { threshold: -18 * v, ratio: 1 + 2 * v };
}

/** Filter open, unity trim (0.83 of the [0, 1.2] gain range), dry, fader up. */
export const DEFAULT_DECK_CONTROLS: Record<DeckControl, number> = { lpf: 1, gain: 0.83, reverb: 0, volume: 1 };
/** Master: filters open, unity volume, dry, and a little glue (about 1.7:1 from -6 dB), on from the start. */
export const DEFAULT_MASTER_CONTROLS: Record<MasterControl, number> = { hpf: 0, lpf: 1, volume: 1, reverb: 0, glue: 0.35 };

/** Every control name, derived from the defaults so a list and its mapping can never drift apart. */
export const DECK_CONTROLS = Object.keys(DEFAULT_DECK_CONTROLS) as DeckControl[];
export const MASTER_CONTROLS = Object.keys(DEFAULT_MASTER_CONTROLS) as MasterControl[];
