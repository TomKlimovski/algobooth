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
