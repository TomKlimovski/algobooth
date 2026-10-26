// Each deck (and the Rip tab's result) is a channel with its own superdough orbits, its lanes. Pattern code picks a
// lane with Strudel's own `.orbit(n)` and ducks one with `.duckorbit(n)`, so the strudel.cc sidechain idiom works
// inside a deck: `.orbit(2)` on the pads and `.duckorbit(2)` on the kick. The numbers are the deck's own: deck A's
// lane 2 and deck B's lane 2 are different orbits, and no code can reach the other deck's channel.

/** Lanes per channel, `.orbit(1)` to `.orbit(8)`. */
export const LANES = 8;

/** Channels, by their main orbit: 1 = deck A, 2 = deck B, 3 = the rip result. */
const CHANNELS = [1, 2, 3];

/** A lane number from pattern code: a whole number in 1..LANES, anything else lane 1. */
export function lane(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, LANES);
}

/**
 * The superdough orbit for lane `n` of the channel whose main orbit is `channel`. Lane 1 is the channel's own
 * orbit (what it always played on), lane n > 1 is `channel * 10 + n`: deck A's lanes are 12 to 18, deck B's 22 to 28.
 */
export const laneOrbit = (channel: number, n: unknown): number => (lane(n) === 1 ? channel : channel * 10 + lane(n));

/** The channel an orbit belongs to (its main orbit), or null for an orbit no channel owns. */
export function channelOf(orbit: number): number | null {
  if (CHANNELS.includes(orbit)) return orbit;
  const channel = Math.floor(orbit / 10);
  const n = orbit % 10;
  return CHANNELS.includes(channel) && n >= 2 && n <= LANES ? channel : null;
}

type Value = Record<string, unknown>;

/** One hap value on `channel`: its `orbit` and every `duckorbit` target become the channel's lane orbits. */
export function routeValue(value: Value, channel: number): Value {
  const out: Value = { ...value, orbit: laneOrbit(channel, value.orbit) };
  const duck = value.duckorbit;
  if (duck != null) out.duckorbit = Array.isArray(duck) ? duck.map((d) => laneOrbit(channel, d)) : laneOrbit(channel, duck);
  return out;
}

/** A pattern routed onto `channel`'s lanes, whatever orbits its code names. A bare value (no sound) passes as it is. */
export const routeToChannel = <P extends { withValue(f: (v: any) => any): P }>(pat: P, channel: number): P =>
  pat.withValue((v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? routeValue(v, channel) : v));
