/** Slider positions in [0, 1] mapped to the AudioParam values they drive. */

export type DeckControl = 'lpf' | 'gain' | 'reverb';
export type MasterControl = 'hpf' | DeckControl;

const expo = (low: number, high: number) => (v: number) => low * Math.pow(high / low, v);

export const DECK_CONTROL: Record<DeckControl, (v: number) => number> = {
  lpf: expo(200, 20000),
  gain: (v) => 1.2 * v,
  reverb: (v) => 0.6 * v, // send gain
};

export const MASTER_CONTROL: Record<MasterControl, (v: number) => number> = {
  hpf: expo(20, 8000),
  ...DECK_CONTROL,
};

/** Filter open, unity gain (0.83 of the [0, 1.2] gain range), dry. */
export const DEFAULT_DECK_CONTROLS: Record<DeckControl, number> = { lpf: 1, gain: 0.83, reverb: 0 };
export const DEFAULT_MASTER_CONTROLS: Record<MasterControl, number> = { hpf: 0, ...DEFAULT_DECK_CONTROLS };
