/** Drum machines from tidal-drum-machines that ship inside the app. */
export const BUNDLED_MACHINES: readonly string[] = [
  'RolandTR909',
  'RolandTR808',
  'RolandTR707',
  'RolandTR606',
  'RolandTR505',
  'LinnDrum',
  'AkaiMPC60',
  'EmuSP12',
  'BossDR110',
];

/** Keep `_base` and every entry whose machine prefix (before the first `_`) is in `machines`. */
export function filterManifest(
  manifest: Record<string, unknown>,
  machines: readonly string[],
): Record<string, unknown> {
  const keep = new Set(machines);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manifest)) {
    if (key === '_base' || keep.has(key.split('_')[0])) out[key] = value;
  }
  return out;
}

/**
 * The machines that play a drum name written without `.bank()`, as Strudel's own site plays one: the 808, and
 * the 909 for the voices the 808 lacks (its ride).
 */
export const PLAIN_MACHINES: readonly string[] = ['RolandTR808', 'RolandTR909'];

/**
 * Adds a plain name (`bd`, `hh`, …) for each voice of `machines`, the first machine with the voice winning, so
 * lesson code and code copied from strudel.cc sounds without a `.bank()`. A name the manifest has is left alone.
 */
export function withPlainNames(
  manifest: Record<string, unknown>,
  machines: readonly string[] = PLAIN_MACHINES,
): Record<string, unknown> {
  const out = { ...manifest };
  for (const machine of machines) {
    const prefix = machine + '_';
    for (const [key, value] of Object.entries(manifest)) {
      if (key.startsWith(prefix) && !(key.slice(prefix.length) in out)) out[key.slice(prefix.length)] = value;
    }
  }
  return out;
}
