import { BUNDLED_MACHINES } from '../engine/banks';
import { DIRT_SOUNDS, SOUNDFONTS } from '../engine/packs';

/** The drum names that play without a bank, the built-in synths and the bundled packs. */
export const SHIPPED = new Set([
  ...['bd', 'sd', 'rim', 'hh', 'oh', 'cp', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'perc', 'sh'],
  ...['sine', 'square', 'triangle', 'sawtooth', 'supersaw'],
  'piano',
  ...DIRT_SOUNDS,
  ...Object.keys(SOUNDFONTS),
]);
/** The short bank names `aliasBank` gives the bundled machines. */
const ALIASES: Record<string, string> = { tr909: 'RolandTR909', tr808: 'RolandTR808' };

type Hap = { value: { s?: string; bank?: string; note?: unknown } };

/** Each hap's sound is one the booth ships, and a pitched instrument has its note; `expect` from the calling test. */
export function expectShippedSounds(haps: Hap[], where: string): void {
  for (const h of haps) {
    const { s, bank } = h.value;
    if (s === undefined) continue;
    if (bank) expect(BUNDLED_MACHINES, `${where}: bank ${bank}`).toContain(ALIASES[bank] ?? bank);
    else expect(SHIPPED.has(s), `${where}: sound ${s}`).toBe(true);
    if (s.startsWith('gm_') || s === 'piano' || s === 'supersaw') expect(h.value.note, `${where}: ${s} has a note`).toBeDefined();
  }
}
