/** Both decks stay at full gain while the fader sits inside this narrow centre band. */
const PLATEAU_LOW = 0.45;
const PLATEAU_HIGH = 0.55;
const EPSILON = 1e-9;

/** cos() of the quarter turn is ~6e-17, not 0: snap near-ends so the ends are exact. */
const snap = (g: number): number => (g < EPSILON ? 0 : g > 1 - EPSILON ? 1 : g);

/**
 * Taper from 1 (t = 0) down to 0 (t = 1). A squared cosine falls faster than the
 * equal-power cosine, so the far deck is already well down a fifth of the way in,
 * the way a DJ expects a crossfader to cut; the plateau means the two tapers never
 * overlap, so there is no power dip to compensate for.
 */
const taper = (t: number): number => snap(Math.pow(Math.cos((t * Math.PI) / 2), 2));

/**
 * Crossfader curve. `x` runs 0 (full deck A) to 1 (full deck B); both decks are at
 * full gain across the centre plateau, and each tapers to silence at the far end.
 */
export function crossfadeGains(x: number): [a: number, b: number] {
  const pos = Math.min(1, Math.max(0, x));
  if (pos > PLATEAU_HIGH) return [taper((pos - PLATEAU_HIGH) / (1 - PLATEAU_HIGH)), 1];
  if (pos < PLATEAU_LOW) return [1, taper((PLATEAU_LOW - pos) / PLATEAU_LOW)];
  return [1, 1];
}
